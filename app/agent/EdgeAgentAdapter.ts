/**
 * EdgeAgentAdapter — drives the existing AgentClient pipeline for edge agents
 * that connect via the portwing/1.0 WebSocket protocol instead of the SSE path.
 *
 * After a successful hello/welcome handshake the gateway calls:
 *   new EdgeAgentAdapter(client, ws)
 * The adapter then owns the WebSocket and translates incoming Portwing frames
 * into AgentClient pipeline calls.
 */
import { emitAgentConnected, emitAgentDisconnected } from '../event/index.js';
import logger from '../log/index.js';
import type { Container } from '../model/container.js';
import { getErrorMessage } from '../util/error.js';
import { uuidv7 } from '../util/uuid.js';
import type { AgentClient, AgentClientConfig } from './AgentClient.js';
import { addAgent, getAgent, removeAgent } from './index.js';

const MAX_EXEC_SESSIONS = 100;
const MAX_PENDING_REQUESTS = 100;
const PING_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
const CONTAINER_SYNC_WARN_MS = 30_000;
// Number of consecutive server-initiated ping cycles that may pass without a
// pong reply before the connection is considered dead. 2 cycles × 30s = 60s,
// matching portwing's own readDeadline of max(2*heartbeat, 60s) for symmetry.
const PONG_MISS_THRESHOLD = 2;

export interface HelloMessage {
  version: string;
  protocol: string;
  agentId: string;
  agentName: string;
  dockerVersion: string;
  hostname: string;
  capabilities: string[];
  tokenHash?: string;
  drydockCompat?: string;
  watcherTypes?: string[];
  triggerTypes?: string[];
  pubKeyId?: string;
  timestamp?: number;
  nonce?: string;
  signature?: string;
}

interface ExecSession {
  execId: string;
  outputHandler?: (data: Buffer) => void;
  close: () => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  // Stream accumulation fields (set by handleResponse / handleStream for stream: keys)
  statusCode?: number;
  headers?: Record<string, string>;
  chunks?: Buffer[];
}

interface AgentComponentDescriptor {
  type: string;
  name: string;
  configuration: Record<string, unknown>;
}

interface PortwingFrame {
  type: string;
  data: Record<string, unknown>;
}

export type WebSocketLike = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
};

const log = logger.child({ component: 'edge-agent-adapter' });

/**
 * Sentinel config used to construct AgentClient for edge agents.
 * host must be an http:// URL so parseBaseUrl() succeeds.
 * secret must be empty so rejectSecretConfiguredOverHttp() does not throw.
 */
export function buildEdgeSentinelConfig(agentId: string): AgentClientConfig {
  return {
    host: `http://edge-agent-placeholder-${agentId}`,
    port: 0,
    secret: '',
  };
}

export class EdgeAgentAdapter {
  private readonly client: AgentClient;
  private readonly ws: WebSocketLike;
  private readonly agentName: string;
  private readonly execSessions: Map<string, ExecSession>;
  private readonly pendingRequests: Map<string, PendingRequest>;
  private pingInterval: ReturnType<typeof setInterval> | undefined;
  private containerSyncWarnTimer: ReturnType<typeof setTimeout> | undefined;
  private connected = false;
  private lastPongAt = 0;
  // Idempotency guard (Bug 3, leg 1): onDisconnect() can legitimately be invoked
  // more than once for the same adapter instance — a forced close in
  // checkLivenessAndPing() runs it synchronously, and (absent leg 2, kept as
  // defense-in-depth) the underlying transport's real 'close'/'error' event can
  // still fire afterwards and run it again. Without this guard the second run
  // would re-execute cleanup (including the registry removal below) a second
  // time for what may by then be a totally different agent occupying this name.
  private disconnected = false;
  // FIFO fallback for correlating dd:container_log_response /
  // dd:container_delete_response frames from a *legacy* portwing agent that does
  // not echo our requestId (Bug 4). A current portwing agent echoes the
  // requestId back on both frames, so takePendingContainerResponse() resolves
  // the exact originating request and never consults these queues — correct even
  // when two requests for the same container finish out of order. Only when the
  // echo is absent does a response fall back to "the oldest still-outstanding
  // request for this containerId". Keyed the same way pendingRequests used to be
  // (`log:${containerId}` / `delete:${containerId}`); values are ordered arrays
  // of the corresponding unique pendingRequests keys.
  private readonly containerRequestQueues: Map<string, string[]>;
  // Bound listener references (Bug 3, leg 2) so checkLivenessAndPing() can
  // detach them from the real WebSocket before forcing a close — see there.
  private readonly messageListener: (raw: unknown) => void;
  private readonly closeListener: () => void;
  private readonly errorListener: (err: unknown) => void;

  constructor(client: AgentClient, ws: WebSocketLike) {
    this.client = client;
    this.ws = ws;
    this.agentName = client.name;
    this.execSessions = new Map();
    this.pendingRequests = new Map();
    this.containerRequestQueues = new Map();

    this.messageListener = (raw: unknown): void => {
      void this.onMessage(raw).catch((err: unknown) => {
        log.error(`Frame handling error on ${this.agentName}: ${getErrorMessage(err)}`);
      });
    };
    this.closeListener = (): void => {
      void this.onDisconnect();
    };
    this.errorListener = (err: unknown): void => {
      log.error(`WebSocket error on ${this.agentName}: ${getErrorMessage(err)}`);
      void this.onDisconnect();
    };
  }

  /**
   * Begin the ongoing frame loop after welcome has been sent.
   * Registers the agent in the manager and starts the ping interval.
   */
  activate(): void {
    addAgent(this.client);
    this.lastPongAt = Date.now();

    this.pingInterval = setInterval(() => {
      this.checkLivenessAndPing();
    }, PING_INTERVAL_MS);

    // Warn if container_sync does not arrive within 30 seconds
    this.containerSyncWarnTimer = setTimeout(() => {
      this.containerSyncWarnTimer = undefined;
      if (!this.connected) {
        log.warn(`Edge agent ${this.agentName} did not send dd:container_sync within 30s`);
      }
    }, CONTAINER_SYNC_WARN_MS);

    this.ws.on('message', this.messageListener);
    this.ws.on('close', this.closeListener);
    this.ws.on('error', this.errorListener);
  }

  /**
   * Runs every PING_INTERVAL_MS. If no pong has been received within
   * PONG_MISS_THRESHOLD ping cycles, the connection is considered dead: force
   * close it and run the same cleanup path a real 'close' event would trigger
   * so the agent slot is freed immediately rather than left dangling until the
   * underlying transport eventually notices. Otherwise, send the next ping.
   */
  private checkLivenessAndPing(): void {
    const staleMs = Date.now() - this.lastPongAt;
    if (staleMs >= PING_INTERVAL_MS * PONG_MISS_THRESHOLD) {
      log.warn(
        `Edge agent ${this.agentName} missed ${PONG_MISS_THRESHOLD} pong cycles (${staleMs}ms); closing connection`,
      );
      // Bug 3, leg 2: detach the close/error listeners BEFORE forcing the close
      // below. We are about to run onDisconnect() synchronously ourselves; the
      // underlying transport's real 'close' (and possibly 'error') event still
      // fires once ws.close() completes, and without detaching first that event
      // would run onDisconnect() a second time on a connection this adapter has
      // already torn down. The idempotency guard in onDisconnect() covers any
      // WebSocketLike implementation that doesn't support `off`.
      this.ws.off?.('close', this.closeListener);
      this.ws.off?.('error', this.errorListener);
      try {
        this.ws.close(1001, 'ping timeout');
      } catch {
        // connection may already be closing
      }
      void this.onDisconnect();
      return;
    }

    try {
      this.ws.send(JSON.stringify({ type: 'ping', data: { timestamp: Date.now() } }));
    } catch {
      // connection may already be closing
    }
  }

  private async onMessage(raw: unknown): Promise<void> {
    let frame: PortwingFrame;
    try {
      frame = JSON.parse(String(raw)) as PortwingFrame;
    } catch {
      log.warn(`${this.agentName}: non-JSON frame received`);
      return;
    }

    const { type, data } = frame;
    if (typeof type !== 'string' || !data || typeof data !== 'object') {
      log.warn(`${this.agentName}: malformed frame (type=${String(type)})`);
      return;
    }

    // Translate underscore to hyphen for AgentClient event names where applicable
    const agentEventName = type.replace(/_/g, '-');

    switch (type) {
      case 'dd:container_sync':
        await this.handleContainerSync(data);
        return;
      case 'dd:component_sync':
        await this.handleComponentSync(data);
        return;
      case 'metrics':
        this.handleMetrics(data);
        return;
      case 'ping':
        this.handlePing(data);
        return;
      case 'pong':
        this.handlePong();
        return;
      case 'dd:watch_response':
        log.debug(`${this.agentName}: dd:watch_response (no-op in M5)`);
        return;
      case 'dd:watch_container_response':
        log.debug(`${this.agentName}: dd:watch_container_response (no-op in M5)`);
        return;
      case 'dd:trigger_response':
        log.debug(`${this.agentName}: dd:trigger_response (no-op in M5)`);
        return;
      case 'dd:container_log_response':
        this.handleContainerLogResponse(data);
        return;
      case 'dd:container_delete_response':
        this.handleContainerDeleteResponse(data);
        return;
      case 'response':
        this.handleResponse(data);
        return;
      case 'stream':
        this.handleStream(data);
        return;
      case 'stream_end':
        this.handleStreamEnd(data);
        return;
      case 'error':
        this.handleErrorFrame(data);
        return;
      case 'exec_ready':
        this.handleExecReady(data);
        return;
      case 'exec_output':
        this.handleExecOutput(data);
        return;
      case 'exec_end':
        this.handleExecEnd(data);
        return;
      case 'dd:container_added':
      case 'dd:container_updated':
        await this.client.handleEvent(agentEventName, (data as { container?: unknown }).container);
        return;
      case 'dd:container_removed':
        await this.client.handleEvent(agentEventName, { id: data.id, name: data.name });
        return;
      default:
        log.debug(`${this.agentName}: unhandled frame type ${type}`);
        return;
    }
  }

  private async handleContainerSync(data: Record<string, unknown>): Promise<void> {
    clearTimeout(this.containerSyncWarnTimer);
    this.containerSyncWarnTimer = undefined;

    const containers = Array.isArray(data.containers) ? (data.containers as Container[]) : [];
    await this.client.handleContainerSync(containers);

    if (!this.connected) {
      this.connected = true;
      this.client.isConnected = true;
      const reconnected = false; // edge agents always do a fresh hello
      void emitAgentConnected({ agentName: this.agentName, reconnected }).catch((err: unknown) => {
        log.debug(`Failed to emit agentConnected: ${getErrorMessage(err)}`);
      });
    }
  }

  private async handleComponentSync(data: Record<string, unknown>): Promise<void> {
    const watchers = Array.isArray(data.watchers)
      ? (data.watchers as AgentComponentDescriptor[])
      : [];
    const triggers = Array.isArray(data.triggers)
      ? (data.triggers as AgentComponentDescriptor[])
      : [];
    await this.client.handleComponentSync(watchers, triggers);
  }

  private handleMetrics(data: Record<string, unknown>): void {
    const memoryTotal = typeof data.memoryTotal === 'number' ? data.memoryTotal : 0;
    const uptime = typeof data.uptime === 'number' ? data.uptime : 0;

    const cpuUsage = typeof data.cpuUsage === 'number' ? data.cpuUsage : undefined;
    const cpuCores = typeof data.cpuCores === 'number' ? data.cpuCores : undefined;
    const memoryUsed = typeof data.memoryUsed === 'number' ? data.memoryUsed : undefined;
    const memoryFree = typeof data.memoryFree === 'number' ? data.memoryFree : undefined;
    const diskTotal = typeof data.diskTotal === 'number' ? data.diskTotal : undefined;
    const diskUsed = typeof data.diskUsed === 'number' ? data.diskUsed : undefined;
    const diskFree = typeof data.diskFree === 'number' ? data.diskFree : undefined;
    const networkRxBytes =
      typeof data.networkRxBytes === 'number' ? data.networkRxBytes : undefined;
    const networkTxBytes =
      typeof data.networkTxBytes === 'number' ? data.networkTxBytes : undefined;

    this.client.info = {
      ...this.client.info,
      // GiB (1024^3), matching portwing's canonical MemoryTotalGB() definition
      // (internal/metrics/collector.go) — not decimal GB (1e9).
      memoryGb: memoryTotal > 0 ? memoryTotal / 1024 ** 3 : this.client.info.memoryGb,
      uptimeSeconds: uptime > 0 ? uptime : this.client.info.uptimeSeconds,
      lastSeen: new Date().toISOString(),
      ...(cpuUsage !== undefined ? { cpuUsage } : {}),
      ...(cpuCores !== undefined ? { cpuCores } : {}),
      ...(memoryUsed !== undefined ? { memoryUsed } : {}),
      ...(memoryFree !== undefined ? { memoryFree } : {}),
      ...(diskTotal !== undefined ? { diskTotal } : {}),
      ...(diskUsed !== undefined ? { diskUsed } : {}),
      ...(diskFree !== undefined ? { diskFree } : {}),
      ...(networkRxBytes !== undefined ? { networkRxBytes } : {}),
      ...(networkTxBytes !== undefined ? { networkTxBytes } : {}),
    };
    this.client.scheduleStatsChangedPublic();
  }

  private handlePing(data: Record<string, unknown>): void {
    try {
      this.ws.send(JSON.stringify({ type: 'pong', data: { timestamp: data.timestamp } }));
    } catch {
      // connection may be closing
    }
  }

  /** Reply to our own server-initiated ping — marks the connection as alive. */
  private handlePong(): void {
    this.lastPongAt = Date.now();
  }

  /**
   * Registers a new in-flight requestContainerLogs()/deleteContainer() call in
   * the FIFO queue for its containerId (Bug 4). See containerRequestQueues.
   */
  private enqueueContainerRequest(queueKey: string, pendingKey: string): void {
    const queue = this.containerRequestQueues.get(queueKey);
    if (queue) {
      queue.push(pendingKey);
    } else {
      this.containerRequestQueues.set(queueKey, [pendingKey]);
    }
  }

  /**
   * Removes and returns the OLDEST pendingRequests key queued for queueKey, or
   * undefined if none are outstanding. Legacy fallback used only when a response
   * frame carries no echoed requestId (older portwing agent); the oldest
   * still-outstanding request is then the best available correlation.
   */
  private dequeueOldestContainerRequest(queueKey: string): string | undefined {
    const queue = this.containerRequestQueues.get(queueKey);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const pendingKey = queue.shift();
    if (queue.length === 0) {
      this.containerRequestQueues.delete(queueKey);
    }
    return pendingKey;
  }

  /**
   * Removes one specific pendingKey from queueKey's queue without disturbing
   * the FIFO order of the rest. Used when a request's own timeout fires before
   * any response arrives, so it doesn't leave a dangling reference that would
   * cause a later response to be matched to the wrong (already-timed-out) slot.
   */
  private removeContainerRequestFromQueue(queueKey: string, pendingKey: string): void {
    const queue = this.containerRequestQueues.get(queueKey);
    if (!queue) {
      return;
    }
    const index = queue.indexOf(pendingKey);
    if (index !== -1) {
      queue.splice(index, 1);
    }
    if (queue.length === 0) {
      this.containerRequestQueues.delete(queueKey);
    }
  }

  /**
   * Correlate a dd:container_{log,delete}_response frame to the pendingRequests
   * entry that originated it, remove that entry from pendingRequests and its
   * container queue, and return it (timer already cleared). Returns undefined
   * when nothing matches.
   *
   * A current portwing agent echoes back the requestId we sent, so when
   * `data.requestId` is present we resolve that exact request — correct even
   * when two requests for the same container complete out of order. A miss on an
   * echoed id means that specific request already timed out; we do NOT then fall
   * back to FIFO, because that would steal a different still-outstanding
   * request's response. Only a legacy agent that omits the echo falls back to
   * oldest-outstanding-by-containerId (Bug 4).
   */
  private takePendingContainerResponse(
    kind: 'log' | 'delete',
    containerId: string,
    data: Record<string, unknown>,
  ): PendingRequest | undefined {
    const queueKey = `${kind}:${containerId}`;
    // Distinguish "requestId field absent" (legacy agent → FIFO fallback) from
    // "field present but empty or non-string" (a current/malformed agent →
    // exact-match miss, never FIFO). A present-but-unusable id collapses to ''
    // so it takes the exact-match branch and misses, rather than stealing a
    // different in-flight request via the oldest-outstanding fallback.
    const echoedId = Object.hasOwn(data, 'requestId')
      ? typeof data.requestId === 'string'
        ? data.requestId
        : ''
      : undefined;

    let pendingKey: string | undefined;
    if (echoedId !== undefined) {
      // A requestId field is present (echo-capable agent), including the
      // degenerate empty/non-string case coerced to '': correlate strictly by
      // exact key and, on a miss, drop rather than fall back to FIFO — falling
      // back could resolve a different still-outstanding request for this
      // container. Only a truly absent requestId (legacy agent) uses the
      // oldest-outstanding fallback.
      const exactKey = `${queueKey}:${echoedId}`;
      if (this.pendingRequests.has(exactKey)) {
        pendingKey = exactKey;
        this.removeContainerRequestFromQueue(queueKey, exactKey);
      }
    } else {
      pendingKey = this.dequeueOldestContainerRequest(queueKey);
    }

    if (!pendingKey) {
      return undefined;
    }
    const pending = this.pendingRequests.get(pendingKey);
    if (!pending) {
      return undefined;
    }
    clearTimeout(pending.timer);
    this.pendingRequests.delete(pendingKey);
    return pending;
  }

  private handleContainerLogResponse(data: Record<string, unknown>): void {
    const containerId = typeof data.containerId === 'string' ? data.containerId : undefined;
    if (!containerId) {
      return;
    }
    const pending = this.takePendingContainerResponse('log', containerId, data);
    if (!pending) {
      return;
    }
    pending.resolve(data.logs);
  }

  private handleContainerDeleteResponse(data: Record<string, unknown>): void {
    const containerId = typeof data.containerId === 'string' ? data.containerId : undefined;
    if (!containerId) {
      return;
    }
    const pending = this.takePendingContainerResponse('delete', containerId, data);
    if (!pending) {
      return;
    }
    if (data.success === true) {
      pending.resolve(undefined);
    } else {
      pending.reject(new Error(typeof data.error === 'string' ? data.error : 'delete failed'));
    }
  }

  private handleResponse(data: Record<string, unknown>): void {
    const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;
    if (!requestId) {
      return;
    }

    // Check bare key first (non-stream requests)
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.resolve(data);
      return;
    }

    // O9: portwing sends a response frame with isStream=true BEFORE stream chunks.
    // sendStreamRequest registers the entry under `stream:${requestId}`, so the bare
    // lookup above misses. Fall back to the stream: key; stash statusCode/headers and
    // do NOT resolve — handleStreamEnd will resolve once all chunks are received.
    const streamKey = `stream:${requestId}`;
    const streamPending = this.pendingRequests.get(streamKey);
    if (streamPending && data.isStream === true) {
      if (typeof data.statusCode === 'number') {
        streamPending.statusCode = data.statusCode;
      }
      if (data.headers && typeof data.headers === 'object' && !Array.isArray(data.headers)) {
        streamPending.headers = data.headers as Record<string, string>;
      }
      // Reset the inactivity timer (O4) — initial response counts as activity
      clearTimeout(streamPending.timer);
      streamPending.timer = setTimeout(() => {
        this.pendingRequests.delete(streamKey);
        streamPending.reject(
          new Error(`Stream request ${requestId} timed out after ${REQUEST_TIMEOUT_MS}ms`),
        );
      }, REQUEST_TIMEOUT_MS);
    }
  }

  private handleStream(data: Record<string, unknown>): void {
    const requestId =
      typeof data.requestId === 'string'
        ? data.requestId
        : typeof data.sessionId === 'string'
          ? data.sessionId
          : undefined;
    if (!requestId) {
      return;
    }
    // Confirm the stream is known; do NOT resolve the promise here.
    // Resolution is deferred to handleStreamEnd so that callers of
    // sendStreamRequest receive the complete event, not individual chunks.
    const streamKey = `stream:${requestId}`;
    const pending = this.pendingRequests.get(streamKey);
    if (!pending) {
      return;
    }

    log.debug(`${this.agentName}: stream chunk for ${requestId}`);

    // O10: accumulate base64-decoded chunk on the pending entry
    if (typeof data.data === 'string') {
      const chunk = Buffer.from(data.data, 'base64');
      if (!pending.chunks) {
        pending.chunks = [];
      }
      pending.chunks.push(chunk);
    }

    // O4: reset the inactivity timer so a stream lasting >30s is not rejected
    // as long as chunks keep arriving within 30s of each other.
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.pendingRequests.delete(streamKey);
      pending.reject(
        new Error(`Stream request ${requestId} timed out after ${REQUEST_TIMEOUT_MS}ms`),
      );
    }, REQUEST_TIMEOUT_MS);
  }

  private handleStreamEnd(data: Record<string, unknown>): void {
    const requestId =
      typeof data.requestId === 'string'
        ? data.requestId
        : typeof data.sessionId === 'string'
          ? data.sessionId
          : undefined;
    if (!requestId) {
      return;
    }
    const pending = this.pendingRequests.get(`stream:${requestId}`);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(`stream:${requestId}`);
      // O10: assemble accumulated chunks into a single body Buffer (O9 stashed
      // statusCode/headers on the pending entry from the initial response frame).
      const body =
        pending.chunks && pending.chunks.length > 0
          ? Buffer.concat(pending.chunks)
          : Buffer.alloc(0);
      pending.resolve({
        complete: true,
        reason: data.reason,
        body,
        statusCode: pending.statusCode,
        headers: pending.headers,
      });
    }
  }

  private handleErrorFrame(data: Record<string, unknown>): void {
    const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;
    if (!requestId) {
      return;
    }
    // Check bare key first (non-stream requests); fall back to stream: prefix for streaming requests.
    const pendingKey = this.pendingRequests.has(requestId) ? requestId : `stream:${requestId}`;
    const pending = this.pendingRequests.get(pendingKey);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(pendingKey);
      pending.reject(new Error(typeof data.message === 'string' ? data.message : 'agent error'));
    }
  }

  private handleExecReady(data: Record<string, unknown>): void {
    const execId = typeof data.execId === 'string' ? data.execId : undefined;
    if (!execId) {
      return;
    }
    // startExec() pre-registers the session (with outputHandler) before sending
    // exec_start.  exec_ready is the agent's confirmation that the process
    // started; we only need to create a session here for the (unusual) case
    // where exec_ready arrives for an execId we did not initiate (e.g. server
    // restart mid-session).  Preserve any existing session to keep outputHandler.
    if (!this.execSessions.has(execId)) {
      const session: ExecSession = {
        execId,
        close: () => {
          this.execSessions.delete(execId);
        },
      };
      this.execSessions.set(execId, session);
    }
  }

  private handleExecOutput(data: Record<string, unknown>): void {
    const execId = typeof data.execId === 'string' ? data.execId : undefined;
    const rawData = typeof data.data === 'string' ? data.data : undefined;
    if (!execId || !rawData) {
      return;
    }
    const session = this.execSessions.get(execId);
    if (!session) {
      return;
    }
    const decoded = Buffer.from(rawData, 'base64');
    session.outputHandler?.(decoded);
  }

  private handleExecEnd(data: Record<string, unknown>): void {
    const execId = typeof data.execId === 'string' ? data.execId : undefined;
    if (!execId) {
      return;
    }
    const session = this.execSessions.get(execId);
    if (session) {
      session.close();
    }
  }

  /**
   * Request container logs from the edge agent.
   * Returns a promise that resolves with the log text, or rejects after 30s.
   *
   * Bug 4: a unique per-call requestId is embedded in the pendingRequests key
   * (`log:${containerId}:${requestId}`) so a second concurrent request for the
   * same containerId gets its own entry instead of clobbering the first's. The
   * requestId is sent on the wire and a current portwing agent echoes it back on
   * dd:container_log_response, so takePendingContainerResponse() correlates the
   * exact originating request (see there). A legacy agent that omits the echo
   * falls back to oldest-outstanding-by-containerId (containerRequestQueues).
   *
   * Punch-list #5: `timestamps` is now honored end to end.
   * AgentClient.getContainerLogs() forwards `timestamps` from the caller's query,
   * portwing's protocol.DDContainerLogRequestMessage carries the field, and its
   * handler (handleContainerLogRequest in internal/adapter/drydock/adapter.go)
   * reads it — so the UI "show timestamps" toggle reaches the edge agent.
   * `until`/`follow` are wire-protocol-capable (the message carries them and
   * portwing's handler will honor `follow` as a bounded live window if sent) but
   * no current drydock caller populates them: the one-shot log download path
   * never sets them, and they remain here for a future streaming caller.
   */
  requestContainerLogs(
    containerId: string,
    options: {
      tail?: number;
      since?: string;
      until?: string;
      follow?: boolean;
      timestamps?: boolean;
    } = {},
  ): Promise<string> {
    if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error('concurrent request limit reached'));
    }

    const requestId = uuidv7();
    const queueKey = `log:${containerId}`;
    const pendingKey = `${queueKey}:${requestId}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(pendingKey);
        this.removeContainerRequestFromQueue(queueKey, pendingKey);
        reject(
          new Error(
            `Container log request for ${containerId} timed out after ${REQUEST_TIMEOUT_MS}ms`,
          ),
        );
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(pendingKey, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.enqueueContainerRequest(queueKey, pendingKey);

      try {
        this.ws.send(
          JSON.stringify({
            type: 'dd:container_log_request',
            data: { containerId, requestId, ...options },
          }),
        );
      } catch (err: unknown) {
        clearTimeout(timer);
        this.pendingRequests.delete(pendingKey);
        this.removeContainerRequestFromQueue(queueKey, pendingKey);
        reject(err);
      }
    });
  }

  /**
   * Delete a container on the edge agent.
   * Returns a promise that resolves once the agent confirms deletion, or
   * rejects after 30s / on an error response.
   *
   * Bug 4: same unique-requestId-per-call correlation as requestContainerLogs()
   * above — a current portwing agent echoes the requestId on
   * dd:container_delete_response for exact matching, with FIFO-by-containerId as
   * the legacy fallback. See that doc comment for the full explanation.
   */
  deleteContainer(containerId: string): Promise<void> {
    if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error('concurrent request limit reached'));
    }

    const requestId = uuidv7();
    const queueKey = `delete:${containerId}`;
    const pendingKey = `${queueKey}:${requestId}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(pendingKey);
        this.removeContainerRequestFromQueue(queueKey, pendingKey);
        reject(
          new Error(
            `Container delete request for ${containerId} timed out after ${REQUEST_TIMEOUT_MS}ms`,
          ),
        );
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(pendingKey, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.enqueueContainerRequest(queueKey, pendingKey);

      try {
        this.ws.send(
          JSON.stringify({
            type: 'dd:container_delete_request',
            data: { containerId, requestId },
          }),
        );
      } catch (err: unknown) {
        clearTimeout(timer);
        this.pendingRequests.delete(pendingKey);
        this.removeContainerRequestFromQueue(queueKey, pendingKey);
        reject(err);
      }
    });
  }

  /**
   * Send a streaming tunnel request frame to the edge agent.
   * The pending entry is registered under `stream:${requestId}` so that
   * handleStream() and handleStreamEnd() can find it — those handlers look up
   * the `stream:` prefix, not the bare requestId.
   * Resolves with { complete: true, reason } on stream_end.
   */
  sendStreamRequest(
    method: string,
    path: string,
    headers?: Record<string, string>,
    body?: unknown,
  ): Promise<unknown> {
    if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error('concurrent request limit reached'));
    }

    const requestId = uuidv7();
    const pendingKey = `stream:${requestId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(pendingKey);
        reject(new Error(`Stream request ${requestId} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(pendingKey, { resolve, reject, timer });

      try {
        this.ws.send(
          JSON.stringify({
            type: 'request',
            data: { requestId, method, path, headers, body },
          }),
        );
      } catch (err: unknown) {
        clearTimeout(timer);
        this.pendingRequests.delete(pendingKey);
        reject(err);
      }
    });
  }

  /**
   * Send a tunnel request frame to the edge agent.
   * Returns a promise that resolves with the response or rejects after 30s.
   */
  sendRequest(
    method: string,
    path: string,
    headers?: Record<string, string>,
    body?: unknown,
  ): Promise<unknown> {
    if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
      const requestId = uuidv7();
      try {
        this.ws.send(
          JSON.stringify({
            type: 'error',
            data: {
              message: 'concurrent request limit reached',
              code: 'stream-limit',
              requestId,
            },
          }),
        );
      } catch {
        // connection may be closing
      }
      return Promise.reject(new Error('concurrent request limit reached'));
    }

    const requestId = uuidv7();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      try {
        this.ws.send(
          JSON.stringify({
            type: 'request',
            data: { requestId, method, path, headers, body },
          }),
        );
      } catch (err: unknown) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(err);
      }
    });
  }

  /**
   * Start an exec session on the edge agent.
   * Returns the execId once the exec_start frame is sent.
   * outputCallback receives decoded bytes for each exec_output frame.
   */
  startExec(
    containerId: string,
    cmd: string[],
    options?: {
      user?: string;
      cols?: number;
      rows?: number;
      tty?: boolean;
      outputCallback?: (data: Buffer) => void;
    },
  ): Promise<string> {
    if (this.execSessions.size >= MAX_EXEC_SESSIONS) {
      return Promise.reject(new Error('session limit reached'));
    }

    const execId = uuidv7();
    const outputCallback = options?.outputCallback;

    // Pre-register the session with the callback so exec_output frames arriving
    // before the caller has a chance to wire up the handler are not lost.
    const session: ExecSession = {
      execId,
      outputHandler: outputCallback,
      close: () => {
        // O5: notify the edge so it can tear down the Docker exec process/goroutine.
        this.sendExecEnd(execId);
        this.execSessions.delete(execId);
      },
    };
    this.execSessions.set(execId, session);

    try {
      this.ws.send(
        JSON.stringify({
          type: 'exec_start',
          data: {
            execId,
            containerId,
            cmd,
            user: options?.user,
            cols: options?.cols ?? 80,
            rows: options?.rows ?? 24,
            tty: options?.tty ?? true,
          },
        }),
      );
    } catch (err: unknown) {
      this.execSessions.delete(execId);
      return Promise.reject(err);
    }

    return Promise.resolve(execId);
  }

  /**
   * Notify the edge agent that an exec session has ended.
   * Portwing handles inbound exec_end by tearing down the Docker exec process;
   * without this the edge leaks goroutines and Docker exec processes (O5).
   */
  private sendExecEnd(execId: string): void {
    try {
      this.ws.send(JSON.stringify({ type: 'exec_end', data: { execId } }));
    } catch {
      // connection may be closing
    }
  }

  /**
   * Send stdin bytes to an active exec session.
   * data is encoded as base64 (standard) before transmission, matching
   * the base64 decoding in handleExecOutput.
   */
  sendInput(execId: string, stdinBytes: Buffer): void {
    try {
      this.ws.send(
        JSON.stringify({
          type: 'exec_input',
          data: { execId, data: stdinBytes.toString('base64') },
        }),
      );
    } catch {
      // connection may be closing
    }
  }

  /**
   * Send a terminal resize event to an active exec session.
   */
  sendResize(execId: string, cols: number, rows: number): void {
    try {
      this.ws.send(
        JSON.stringify({
          type: 'exec_resize',
          data: { execId, cols, rows },
        }),
      );
    } catch {
      // connection may be closing
    }
  }

  async onDisconnect(): Promise<void> {
    // Bug 3, leg 1: idempotency guard — see the `disconnected` field comment.
    if (this.disconnected) {
      return;
    }
    this.disconnected = true;

    if (this.pingInterval !== undefined) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
    if (this.containerSyncWarnTimer !== undefined) {
      clearTimeout(this.containerSyncWarnTimer);
      this.containerSyncWarnTimer = undefined;
    }

    // Reject all pending requests
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('connection closed'));
      this.pendingRequests.delete(requestId);
    }
    this.containerRequestQueues.clear();

    // Close all exec sessions — session.close() sends exec_end before deleting (O5)
    for (const session of this.execSessions.values()) {
      session.close();
    }
    this.execSessions.clear();

    const wasConnected = this.connected;
    this.connected = false;
    this.client.isConnected = false;

    // Bug 3, leg 3: instance-checked removal. manager.removeAgent() matches
    // purely by name string and removes every registry entry with that name —
    // if a newly-reconnected agent has already re-registered under this same
    // (stable, identity-derived) name, a blind removeAgent(name) here would
    // evict it too. Only remove when the registry's current entry for this
    // name is still THIS adapter's own client instance.
    if (getAgent(this.agentName) === this.client) {
      removeAgent(this.agentName);
    }

    if (wasConnected) {
      void emitAgentDisconnected({
        agentName: this.agentName,
        reason: 'WebSocket closed',
      }).catch((err: unknown) => {
        log.debug(`Failed to emit agentDisconnected: ${getErrorMessage(err)}`);
      });
    }
  }
}
