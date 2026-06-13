/**
 * EdgeAgentAdapter — drives the existing AgentClient pipeline for edge agents
 * that connect via the lookout/1.0 WebSocket protocol instead of the SSE path.
 *
 * After a successful hello/welcome handshake the gateway calls:
 *   new EdgeAgentAdapter(client, ws, hello, config)
 * The adapter then owns the WebSocket and translates incoming lookout frames
 * into AgentClient pipeline calls.
 */
import { emitAgentConnected, emitAgentDisconnected } from '../event/index.js';
import logger from '../log/index.js';
import type { Container } from '../model/container.js';
import { getErrorMessage } from '../util/error.js';
import { uuidv7 } from '../util/uuid.js';
import type { AgentClient, AgentClientConfig } from './AgentClient.js';
import { addAgent, removeAgent } from './index.js';

const MAX_EXEC_SESSIONS = 100;
const MAX_PENDING_REQUESTS = 100;
const PING_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
const CONTAINER_SYNC_WARN_MS = 30_000;

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

export interface EdgeAgentAdapterConfig {
  pollInterval: number;
  agentId: string;
  version: string;
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
}

interface AgentComponentDescriptor {
  type: string;
  name: string;
  configuration: Record<string, unknown>;
}

interface LookoutFrame {
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
  private readonly hello: HelloMessage;
  private readonly adapterConfig: EdgeAgentAdapterConfig;
  private readonly agentName: string;
  private readonly execSessions: Map<string, ExecSession>;
  private readonly pendingRequests: Map<string, PendingRequest>;
  private pingInterval: ReturnType<typeof setInterval> | undefined;
  private containerSyncWarnTimer: ReturnType<typeof setTimeout> | undefined;
  private connected = false;

  constructor(
    client: AgentClient,
    ws: WebSocketLike,
    hello: HelloMessage,
    adapterConfig: EdgeAgentAdapterConfig,
  ) {
    this.client = client;
    this.ws = ws;
    this.hello = hello;
    this.adapterConfig = adapterConfig;
    this.agentName = client.name;
    this.execSessions = new Map();
    this.pendingRequests = new Map();
  }

  /**
   * Begin the ongoing frame loop after welcome has been sent.
   * Registers the agent in the manager and starts the ping interval.
   */
  activate(): void {
    addAgent(this.client);

    this.pingInterval = setInterval(() => {
      try {
        this.ws.send(JSON.stringify({ type: 'ping', data: { timestamp: Date.now() } }));
      } catch {
        // connection may already be closing
      }
    }, PING_INTERVAL_MS);

    // Warn if container_sync does not arrive within 30 seconds
    this.containerSyncWarnTimer = setTimeout(() => {
      this.containerSyncWarnTimer = undefined;
      if (!this.connected) {
        log.warn(`Edge agent ${this.agentName} did not send dd:container_sync within 30s`);
      }
    }, CONTAINER_SYNC_WARN_MS);

    this.ws.on('message', (raw: unknown) => {
      void this.onMessage(raw).catch((err: unknown) => {
        log.error(`Frame handling error on ${this.agentName}: ${getErrorMessage(err)}`);
      });
    });

    this.ws.on('close', () => {
      void this.onDisconnect();
    });

    this.ws.on('error', (err: unknown) => {
      log.error(`WebSocket error on ${this.agentName}: ${getErrorMessage(err)}`);
      void this.onDisconnect();
    });
  }

  private async onMessage(raw: unknown): Promise<void> {
    let frame: LookoutFrame;
    try {
      frame = JSON.parse(String(raw)) as LookoutFrame;
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
        // no-op — reply to server-initiated ping
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

    this.client.info = {
      ...this.client.info,
      memoryGb: memoryTotal > 0 ? memoryTotal / 1e9 : this.client.info.memoryGb,
      uptimeSeconds: uptime > 0 ? uptime : this.client.info.uptimeSeconds,
      lastSeen: new Date().toISOString(),
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

  private handleContainerLogResponse(data: Record<string, unknown>): void {
    // Resolve any pending log request keyed by containerId
    const containerId = typeof data.containerId === 'string' ? data.containerId : undefined;
    if (!containerId) {
      return;
    }
    const pending = this.pendingRequests.get(`log:${containerId}`);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(`log:${containerId}`);
      pending.resolve(data.logs);
    }
  }

  private handleResponse(data: Record<string, unknown>): void {
    const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;
    if (!requestId) {
      return;
    }
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);
    pending.resolve(data);
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
    const pending = this.pendingRequests.get(`stream:${requestId}`);
    if (pending) {
      log.debug(`${this.agentName}: stream chunk for ${requestId}`);
    }
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
      pending.resolve({ complete: true, reason: data.reason });
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
   * The pending entry is keyed as `log:${containerId}` to match the
   * dd:container_log_response handler.
   */
  requestContainerLogs(
    containerId: string,
    options: { tail?: number; since?: string; until?: string; follow?: boolean } = {},
  ): Promise<string> {
    const pendingKey = `log:${containerId}`;
    if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error('concurrent request limit reached'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(pendingKey);
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

      try {
        this.ws.send(
          JSON.stringify({
            type: 'dd:container_log_request',
            data: { containerId, ...options },
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

    // Close all exec sessions
    for (const session of this.execSessions.values()) {
      session.close();
    }
    this.execSessions.clear();

    const wasConnected = this.connected;
    this.connected = false;
    this.client.isConnected = false;

    removeAgent(this.agentName);

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
