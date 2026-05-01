import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import express from 'express';
import type {
  BatchUpdateCompletedEventPayload,
  ContainerLifecycleEventPayload,
  ContainerUpdateAppliedEvent,
  ContainerUpdateAppliedEventPayload,
  ContainerUpdateFailedEventPayload,
  SelfUpdateStartingEventPayload,
} from '../event/index.js';
import {
  getContainerUpdateAppliedEventContainerName,
  registerAgentConnected,
  registerAgentDisconnected,
  registerBatchUpdateCompleted,
  registerContainerAdded,
  registerContainerRemoved,
  registerContainerUpdateApplied,
  registerContainerUpdated,
  registerContainerUpdateFailed,
  registerSelfUpdateStarting,
  registerUpdateOperationChanged,
} from '../event/index.js';
import log from '../log/index.js';
import { hashToken } from '../util/crypto.js';
import { sendErrorResponse } from './error-response.js';
import {
  type ActiveSseClient,
  ActiveSseClientRegistry,
  createActiveSseClientRegistryTestAdapter,
  type FlushableResponse,
} from './sse-active-client-registry.js';
import { enrichContainerLifecyclePayloadWithEligibility } from './sse-container-enrichment.js';
import { bootId, SseEventBuffer } from './sse-event-buffer.js';
import { createSelfUpdateAckProtocol } from './sse-self-update-ack-protocol.js';

const router = express.Router();
let initialized = false;

// Per-IP and per-session connection tracking to prevent connection exhaustion.
const MAX_CONNECTIONS_PER_IP = 10;
const MAX_CONNECTIONS_PER_SESSION = 10;
const connectionsPerIp = new Map<string, number>();
const connectionsPerSession = new Map<string, number>();
const DEFAULT_SELF_UPDATE_ACK_TIMEOUT_MS = 3000;
const SSE_HEARTBEAT_INTERVAL_MS = 15000;
const SSE_STALE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SSE_STALE_ENTRY_TTL_MS = 30 * 60 * 1000;
const ALLOWED_CONTAINER_EVENT_NAMES = new Set<string>([
  'dd:agent-connected',
  'dd:agent-disconnected',
  'dd:container-added',
  'dd:container-removed',
  'dd:container-updated',
  'dd:resync-required',
  'dd:update-operation-changed',
  'dd:update-applied',
  'dd:update-failed',
  'dd:batch-update-completed',
]);

// Events that carry no id: line because they are ephemeral (not cross-client
// durable state). Heartbeats and per-client handshakes must not be buffered.
const EPHEMERAL_EVENT_NAMES = new Set<string>(['dd:connected', 'dd:heartbeat']);

// Per-process monotonic counter. Incremented for every buffered broadcast.
let eventCounter = 0;

// 5-minute ring buffer shared across all SSE connections.
const sseEventBuffer = new SseEventBuffer();
const clients = new Set<FlushableResponse>();
const heartbeatBackpressuredClients = new Set<FlushableResponse>();
const sseClientRegistry = new ActiveSseClientRegistry();
const activeSseClientRegistryTestAdapter =
  createActiveSseClientRegistryTestAdapter(sseClientRegistry);
const selfUpdateAckProtocol = createSelfUpdateAckProtocol({
  clients,
  activeClientRegistry: sseClientRegistry,
  defaultAckTimeoutMs: DEFAULT_SELF_UPDATE_ACK_TIMEOUT_MS,
  broadcastFn: (eventName, payload) => broadcastWithId(eventName, payload),
});
const pendingSelfUpdateAcks = selfUpdateAckProtocol.pendingSelfUpdateAcks;
let staleSweepIntervalHandle: ReturnType<typeof globalThis.setInterval> | undefined;
let sharedHeartbeatIntervalHandle: ReturnType<typeof globalThis.setInterval> | undefined;
const eventListenerDeregistrations: Array<() => void> = [];
const PROCESS_SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
let processShutdownHandlersRegistered = false;

// Per-process salt for SSE log IP hashing. Regenerated on each start so hashed
// identifiers cannot be correlated across process restarts.
const SSE_LOG_IP_SALT = randomBytes(16);

function getClientIp(req: Request): string {
  return req.ip ?? 'unknown';
}

function formatIpForLog(ip: string): string {
  if (process.env.DD_SSE_DEBUG_LOG_IP === 'true') {
    return `source IP ${ip}`;
  }
  const hashHex = createHash('sha256').update(SSE_LOG_IP_SALT).update(ip).digest('hex').slice(0, 8);
  return `source IP hash h:${hashHex}`;
}

function getClientSessionKey(req: Request): string {
  const sessionId = (req as Request & { sessionID?: unknown }).sessionID;
  if (typeof sessionId === 'string' && sessionId.trim() !== '') {
    return sessionId;
  }
  return `ip:${getClientIp(req)}`;
}

function issueServerClientId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function isResponseClosed(response: FlushableResponse): boolean {
  const writableEnded = (response as Response & { writableEnded?: boolean }).writableEnded;
  const writableFinished = (response as Response & { writableFinished?: boolean }).writableFinished;
  const destroyed = (response as Response & { destroyed?: boolean }).destroyed;
  return writableEnded === true || writableFinished === true || destroyed === true;
}

function dropActiveClient(client: ActiveSseClient): void {
  clients.delete(client.response);
  heartbeatBackpressuredClients.delete(client.response);
  sseClientRegistry.remove(client);
}

function writeHeartbeat(response: FlushableResponse): void {
  if (heartbeatBackpressuredClients.has(response)) {
    return;
  }

  const writeAccepted = response.write('event: dd:heartbeat\ndata: {}\n\n');
  if (writeAccepted === false) {
    heartbeatBackpressuredClients.add(response);
    response.once?.('drain', () => {
      heartbeatBackpressuredClients.delete(response);
    });
  }
}

function startSharedHeartbeatIntervalIfNeeded(): void {
  if (sharedHeartbeatIntervalHandle || clients.size === 0) {
    return;
  }
  sharedHeartbeatIntervalHandle = globalThis.setInterval(() => {
    for (const client of clients) {
      writeHeartbeat(client);
    }
  }, SSE_HEARTBEAT_INTERVAL_MS);
}

function stopSharedHeartbeatIntervalIfIdle(): void {
  if (!sharedHeartbeatIntervalHandle || clients.size > 0) {
    return;
  }
  globalThis.clearInterval(sharedHeartbeatIntervalHandle);
  sharedHeartbeatIntervalHandle = undefined;
  heartbeatBackpressuredClients.clear();
}

/**
 * Broadcast an event to all connected SSE clients. If the event is not in the
 * ephemeral list it is assigned a monotonic id, pushed to the ring buffer, and
 * written to the wire with an `id:` line so clients can use Last-Event-ID on
 * reconnect. Ephemeral events (heartbeat, per-client handshake) are NOT
 * buffered or given ids.
 */
function broadcastWithId(eventName: string, payload: unknown): void {
  if (EPHEMERAL_EVENT_NAMES.has(eventName)) {
    // Ephemeral: write directly, no id, no buffer.
    const data = JSON.stringify(payload ?? {});
    for (const client of clients) {
      client.write(`event: ${eventName}\ndata: ${data}\n\n`);
      client.flush?.();
    }
    return;
  }

  eventCounter += 1;
  const id = `${bootId}:${eventCounter}`;
  sseEventBuffer.push(id, eventName, payload, Date.now());

  const data = JSON.stringify(payload ?? {});
  const chunk = `id: ${id}\nevent: ${eventName}\ndata: ${data}\n\n`;
  for (const client of clients) {
    client.write(chunk);
    client.flush?.();
  }
}

function sweepStaleSseState(nowMs = Date.now()): void {
  for (const activeClient of sseClientRegistry.listClients()) {
    const ageMs = nowMs - activeClient.connectedAtMs;
    const missingClientSetEntry = !clients.has(activeClient.response);
    const missingRegistryEntry = !sseClientRegistry.hasConsistentReferences(activeClient);
    const responseClosed = isResponseClosed(activeClient.response);
    const staleByAge =
      (missingClientSetEntry || missingRegistryEntry) && ageMs >= SSE_STALE_ENTRY_TTL_MS;
    if (responseClosed || staleByAge) {
      dropActiveClient(activeClient);
    }
  }
  selfUpdateAckProtocol.sweepStalePendingSelfUpdateAcks({
    nowMs,
    staleSweepIntervalMs: SSE_STALE_SWEEP_INTERVAL_MS,
    staleEntryTtlMs: SSE_STALE_ENTRY_TTL_MS,
  });

  stopSharedHeartbeatIntervalIfIdle();
}

function eventsHandler(req: Request, res: Response): void {
  const client = res as FlushableResponse;
  const logger = log.child({ component: 'sse' });
  const ip = getClientIp(req);
  const sessionKey = getClientSessionKey(req);
  const currentIpCount = connectionsPerIp.get(ip) ?? 0;
  const currentSessionCount = connectionsPerSession.get(sessionKey) ?? 0;

  if (currentIpCount >= MAX_CONNECTIONS_PER_IP) {
    logger.warn(
      `SSE per-IP connection limit reached for ${formatIpForLog(ip)} (${currentIpCount})`,
    );
    sendErrorResponse(res, 429, 'Too many SSE connections');
    return;
  }

  if (currentSessionCount >= MAX_CONNECTIONS_PER_SESSION) {
    logger.warn(`SSE session connection limit reached (${currentSessionCount})`);
    sendErrorResponse(res, 429, 'Too many SSE connections');
    return;
  }

  connectionsPerIp.set(ip, currentIpCount + 1);
  connectionsPerSession.set(sessionKey, currentSessionCount + 1);

  client.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  client.flushHeaders?.();

  const clientToken = issueServerClientId('sse-token');
  const clientTokenHash = hashToken(clientToken);
  const activeClient: ActiveSseClient = {
    clientId: issueServerClientId('sse-client'),
    clientToken,
    clientTokenHash,
    clientTokenHashHex: clientTokenHash.toString('hex'),
    response: client,
    connectedAtMs: Date.now(),
  };
  sseClientRegistry.add(activeClient);

  // --- Last-Event-ID replay (W3C SSE reconnection protocol) ---
  // Node normalizes header names to lowercase, so we read 'last-event-id'.
  // We iterate the buffer synchronously before adding this client to `clients`,
  // so replay events are written in isolation on the single Node.js event-loop
  // tick. Any broadcast that fires concurrently will be queued after this
  // synchronous block, and the client will receive it via the live fan-out
  // because we add `client` to `clients` immediately after this block.
  const lastEventId = req.headers?.['last-event-id'];
  if (typeof lastEventId === 'string' && lastEventId.length > 0) {
    const replayResult = sseEventBuffer.replaySince(lastEventId, Date.now());
    if (replayResult.kind === 'resync-required') {
      eventCounter += 1;
      const resyncId = `${bootId}:${eventCounter}`;
      const reason = lastEventId.startsWith(bootId) ? 'buffer-evicted' : 'boot-mismatch';
      client.write(
        `id: ${resyncId}\nevent: dd:resync-required\ndata: ${JSON.stringify({ reason })}\n\n`,
      );
      client.flush?.();
    } else {
      for (const bufferedEvent of replayResult.events) {
        client.write(
          `id: ${bufferedEvent.id}\nevent: ${bufferedEvent.event}\ndata: ${JSON.stringify(bufferedEvent.data)}\n\n`,
        );
      }
      if (replayResult.events.length > 0) {
        client.flush?.();
      }
    }
  }

  // Send initial per-client handshake (ephemeral — no id:)
  client.write(
    `event: dd:connected\ndata: ${JSON.stringify({
      clientId: activeClient.clientId,
      clientToken: activeClient.clientToken,
    })}\n\n`,
  );
  client.flush?.();

  clients.add(client);
  logger.debug(
    `SSE client connected: client ID ${activeClient.clientId} from ${formatIpForLog(ip)} (${clients.size} total)`,
  );
  startSharedHeartbeatIntervalIfNeeded();

  let disconnected = false;
  const cleanup = () => {
    if (disconnected) {
      return;
    }
    disconnected = true;
    const disconnectedClient = sseClientRegistry.getByResponse(client);
    if (disconnectedClient) {
      dropActiveClient(disconnectedClient);
    } else {
      clients.delete(client);
    }
    stopSharedHeartbeatIntervalIfIdle();
    const count = connectionsPerIp.get(ip);
    if (count === undefined || count <= 1) {
      connectionsPerIp.delete(ip);
    } else {
      connectionsPerIp.set(ip, count - 1);
    }
    const sessionCount = connectionsPerSession.get(sessionKey);
    if (sessionCount === undefined || sessionCount <= 1) {
      connectionsPerSession.delete(sessionKey);
    } else {
      connectionsPerSession.set(sessionKey, sessionCount - 1);
    }
    logger.debug(
      `SSE client disconnected: client ID ${activeClient.clientId} from ${formatIpForLog(ip)} (${clients.size} total)`,
    );
  };

  req.once('close', cleanup);
  req.once('aborted', cleanup);
  client.once('close', cleanup);
  client.once('error', cleanup);
}

async function broadcastSelfUpdate(payload: SelfUpdateStartingEventPayload): Promise<void> {
  await selfUpdateAckProtocol.broadcastSelfUpdate(payload);
}

function acknowledgeSelfUpdate(req: Request, res: Response): void {
  selfUpdateAckProtocol.acknowledgeSelfUpdate(req, res);
}

function clearPendingSelfUpdateAcks(): void {
  selfUpdateAckProtocol.clearPendingSelfUpdateAcks();
}

function trackEventListenerDeregistration(maybeDeregister: undefined | (() => void)): void {
  if (typeof maybeDeregister === 'function') {
    eventListenerDeregistrations.push(maybeDeregister);
  }
}

function deregisterEventListeners(): void {
  for (const deregister of eventListenerDeregistrations.splice(0)) {
    deregister();
  }
}

function clearRuntimeIntervals(): void {
  if (staleSweepIntervalHandle) {
    globalThis.clearInterval(staleSweepIntervalHandle);
    staleSweepIntervalHandle = undefined;
  }
  if (sharedHeartbeatIntervalHandle) {
    globalThis.clearInterval(sharedHeartbeatIntervalHandle);
    sharedHeartbeatIntervalHandle = undefined;
  }
  heartbeatBackpressuredClients.clear();
}

function cleanupOnProcessShutdown(): void {
  deregisterEventListeners();
  clearRuntimeIntervals();
}

function registerProcessShutdownHandlersIfNeeded(): void {
  if (processShutdownHandlersRegistered) {
    return;
  }
  for (const signal of PROCESS_SHUTDOWN_SIGNALS) {
    process.on(signal, cleanupOnProcessShutdown);
  }
  processShutdownHandlersRegistered = true;
}

function unregisterProcessShutdownHandlersForTests(): void {
  if (!processShutdownHandlersRegistered) {
    return;
  }
  for (const signal of PROCESS_SHUTDOWN_SIGNALS) {
    process.off(signal, cleanupOnProcessShutdown);
  }
  processShutdownHandlersRegistered = false;
}

function buildUpdateAppliedSsePayload(
  payload: ContainerUpdateAppliedEvent,
): Record<string, unknown> {
  const containerName = getContainerUpdateAppliedEventContainerName(payload) ?? '';
  if (typeof payload === 'string') {
    return { containerName, timestamp: new Date().toISOString() };
  }
  const container =
    payload && typeof payload === 'object' && 'container' in payload
      ? (payload.container as Record<string, unknown> | undefined)
      : undefined;
  const topLevelContainerId =
    typeof payload.containerId === 'string' && payload.containerId !== ''
      ? payload.containerId
      : '';
  const containerId =
    typeof container?.id === 'string' && container.id !== '' ? container.id : topLevelContainerId;
  const imageName =
    container?.image && typeof (container.image as Record<string, unknown>)?.name === 'string'
      ? ((container.image as Record<string, unknown>).name as string)
      : undefined;
  const imageDigest =
    container?.image && typeof (container.image as Record<string, unknown>)?.digest === 'string'
      ? ((container.image as Record<string, unknown>).digest as string)
      : null;
  return {
    operationId: (payload as ContainerUpdateAppliedEventPayload).operationId ?? '',
    containerId,
    containerName,
    imageName,
    previousDigest: null,
    newDigest: imageDigest,
    batchId: (payload as ContainerUpdateAppliedEventPayload).batchId ?? null,
    timestamp: new Date().toISOString(),
  };
}

function buildUpdateFailedSsePayload(
  payload: ContainerUpdateFailedEventPayload,
): Record<string, unknown> {
  return {
    operationId: payload.operationId ?? '',
    containerId: payload.containerId ?? '',
    containerName: payload.containerName,
    error: payload.error,
    phase: payload.phase ?? '',
    batchId: payload.batchId ?? null,
    timestamp: new Date().toISOString(),
    ...(typeof payload.rollbackReason === 'string' && payload.rollbackReason !== ''
      ? { rollbackReason: payload.rollbackReason }
      : {}),
  };
}

export function broadcastScanStarted(containerId: string): void {
  broadcastWithId('dd:scan-started', { containerId });
}

export function broadcastScanCompleted(containerId: string, status: string): void {
  broadcastWithId('dd:scan-completed', { containerId, status });
}

function broadcastContainerEvent(eventName: string, payload: unknown): void {
  if (!ALLOWED_CONTAINER_EVENT_NAMES.has(eventName)) {
    log.child({ component: 'sse' }).warn(`Dropping invalid SSE container event name: ${eventName}`);
    return;
  }
  broadcastWithId(eventName, payload);
}

export function init(): express.Router {
  registerProcessShutdownHandlersIfNeeded();
  if (!staleSweepIntervalHandle) {
    staleSweepIntervalHandle = globalThis.setInterval(() => {
      sweepStaleSseState();
    }, SSE_STALE_SWEEP_INTERVAL_MS);
  }
  if (initialized) {
    return router;
  }
  initialized = true;

  // Register for self-update events from the trigger system
  trackEventListenerDeregistration(
    registerSelfUpdateStarting(async (payload: SelfUpdateStartingEventPayload) => {
      await broadcastSelfUpdate(payload);
    }),
  );
  trackEventListenerDeregistration(
    registerContainerAdded((payload: ContainerLifecycleEventPayload) => {
      broadcastContainerEvent(
        'dd:container-added',
        enrichContainerLifecyclePayloadWithEligibility(payload),
      );
    }),
  );
  trackEventListenerDeregistration(
    registerContainerUpdated((payload: ContainerLifecycleEventPayload) => {
      broadcastContainerEvent(
        'dd:container-updated',
        enrichContainerLifecyclePayloadWithEligibility(payload),
      );
    }),
  );
  trackEventListenerDeregistration(
    registerContainerRemoved((payload: unknown) => {
      broadcastContainerEvent('dd:container-removed', payload);
    }),
  );
  trackEventListenerDeregistration(
    registerUpdateOperationChanged((payload: unknown) => {
      broadcastContainerEvent('dd:update-operation-changed', payload);
    }),
  );
  trackEventListenerDeregistration(
    registerAgentConnected((payload: unknown) => {
      broadcastContainerEvent('dd:agent-connected', payload);
    }),
  );
  trackEventListenerDeregistration(
    registerAgentDisconnected((payload: unknown) => {
      broadcastContainerEvent('dd:agent-disconnected', payload);
    }),
  );

  // High order (1000) ensures these SSE broadcasts run AFTER trigger notification dispatch,
  // which uses the default order (100). This preserves the existing notification ordering.
  trackEventListenerDeregistration(
    registerContainerUpdateApplied(
      (payload: ContainerUpdateAppliedEvent) => {
        broadcastContainerEvent('dd:update-applied', buildUpdateAppliedSsePayload(payload));
      },
      { order: 1000 },
    ),
  );
  trackEventListenerDeregistration(
    registerContainerUpdateFailed(
      (payload: ContainerUpdateFailedEventPayload) => {
        broadcastContainerEvent('dd:update-failed', buildUpdateFailedSsePayload(payload));
      },
      { order: 1000 },
    ),
  );
  trackEventListenerDeregistration(
    registerBatchUpdateCompleted(
      (payload: BatchUpdateCompletedEventPayload) => {
        broadcastContainerEvent('dd:batch-update-completed', payload);
      },
      { order: 1000 },
    ),
  );

  router.get('/', eventsHandler);
  router.post('/self-update/:operationId/ack', acknowledgeSelfUpdate);
  return router;
}

function resetEventCounterForTests(): void {
  eventCounter = 0;
}

function resetInitializationStateForTests(): void {
  initialized = false;
  deregisterEventListeners();
  clearRuntimeIntervals();
  unregisterProcessShutdownHandlersForTests();
}

// For testing
export {
  activeSseClientRegistryTestAdapter as _activeSseClientRegistry,
  bootId as _bootId,
  broadcastContainerEvent as _broadcastContainerEvent,
  broadcastScanCompleted as _broadcastScanCompleted,
  broadcastScanStarted as _broadcastScanStarted,
  broadcastSelfUpdate as _broadcastSelfUpdate,
  broadcastWithId as _broadcastWithId,
  clearPendingSelfUpdateAcks as _clearPendingSelfUpdateAcks,
  clients as _clients,
  connectionsPerIp as _connectionsPerIp,
  connectionsPerSession as _connectionsPerSession,
  MAX_CONNECTIONS_PER_IP as _MAX_CONNECTIONS_PER_IP,
  MAX_CONNECTIONS_PER_SESSION as _MAX_CONNECTIONS_PER_SESSION,
  pendingSelfUpdateAcks as _pendingSelfUpdateAcks,
  resetEventCounterForTests as _resetEventCounterForTests,
  resetInitializationStateForTests as _resetInitializationStateForTests,
  SSE_HEARTBEAT_INTERVAL_MS as _SSE_HEARTBEAT_INTERVAL_MS,
  sseEventBuffer as _sseEventBuffer,
  sweepStaleSseState as _sweepStaleSseState,
};
