import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import express from 'express';
import type { SelfUpdateStartingEventPayload } from '../event/index.js';
import {
  registerAgentConnected,
  registerAgentDisconnected,
  registerContainerAdded,
  registerContainerRemoved,
  registerContainerUpdated,
  registerSelfUpdateStarting,
} from '../event/index.js';
import log from '../log/index.js';
import { hashToken } from '../util/crypto.js';
import {
  type ActiveSseClient,
  ActiveSseClientRegistry,
  createActiveSseClientRegistryTestAdapter,
  type FlushableResponse,
} from './sse-active-client-registry.js';
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
const clients = new Set<FlushableResponse>();
const sseClientRegistry = new ActiveSseClientRegistry();
const activeSseClientRegistryTestAdapter =
  createActiveSseClientRegistryTestAdapter(sseClientRegistry);
const selfUpdateAckProtocol = createSelfUpdateAckProtocol({
  clients,
  activeClientRegistry: sseClientRegistry,
  defaultAckTimeoutMs: DEFAULT_SELF_UPDATE_ACK_TIMEOUT_MS,
});
const pendingSelfUpdateAcks = selfUpdateAckProtocol.pendingSelfUpdateAcks;
let staleSweepIntervalHandle: ReturnType<typeof globalThis.setInterval> | undefined;
let sharedHeartbeatIntervalHandle: ReturnType<typeof globalThis.setInterval> | undefined;

function getClientIp(req: Request): string {
  return req.ip ?? 'unknown';
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
  sseClientRegistry.remove(client);
}

function writeHeartbeat(response: FlushableResponse): void {
  response.write('event: dd:heartbeat\ndata: {}\n\n');
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
}

function sweepStaleSseState(nowMs = Date.now()): void {
  for (const activeClient of sseClientRegistry.listClients()) {
    const ageMs = nowMs - activeClient.connectedAtMs;
    const missingClientSetEntry = !clients.has(activeClient.response);
    const missingRegistryEntry = !sseClientRegistry.hasConsistentReferences(activeClient);
    const shouldDrop =
      missingClientSetEntry || missingRegistryEntry || isResponseClosed(activeClient.response);
    if (shouldDrop && ageMs >= SSE_STALE_ENTRY_TTL_MS) {
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
    logger.warn(`SSE connection limit reached for ${ip} (${currentIpCount})`);
    res.status(429).json({ message: 'Too many SSE connections' });
    return;
  }

  if (currentSessionCount >= MAX_CONNECTIONS_PER_SESSION) {
    logger.warn(`SSE session connection limit reached (${currentSessionCount})`);
    res.status(429).json({ message: 'Too many SSE connections' });
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

  // Send initial connection event
  client.write(
    `event: dd:connected\ndata: ${JSON.stringify({
      clientId: activeClient.clientId,
      clientToken: activeClient.clientToken,
    })}\n\n`,
  );
  client.flush?.();

  clients.add(client);
  logger.debug(`SSE client connected (${clients.size} total)`);
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
    logger.debug(`SSE client disconnected (${clients.size} total)`);
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  client.on('close', cleanup);
  client.on('error', cleanup);
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

export function broadcastScanStarted(containerId: string): void {
  const data = JSON.stringify({ containerId });
  for (const client of clients) {
    client.write(`event: dd:scan-started\ndata: ${data}\n\n`);
    client.flush?.();
  }
}

export function broadcastScanCompleted(containerId: string, status: string): void {
  const data = JSON.stringify({ containerId, status });
  for (const client of clients) {
    client.write(`event: dd:scan-completed\ndata: ${data}\n\n`);
    client.flush?.();
  }
}

function broadcastContainerEvent(eventName: string, payload: unknown): void {
  const data = JSON.stringify(payload ?? {});
  for (const client of clients) {
    client.write(`event: ${eventName}\ndata: ${data}\n\n`);
    client.flush?.();
  }
}

export function init(): express.Router {
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
  registerSelfUpdateStarting(async (payload: SelfUpdateStartingEventPayload) => {
    await broadcastSelfUpdate(payload);
  });
  registerContainerAdded((payload: unknown) => {
    broadcastContainerEvent('dd:container-added', payload);
  });
  registerContainerUpdated((payload: unknown) => {
    broadcastContainerEvent('dd:container-updated', payload);
  });
  registerContainerRemoved((payload: unknown) => {
    broadcastContainerEvent('dd:container-removed', payload);
  });
  registerAgentConnected((payload: unknown) => {
    broadcastContainerEvent('dd:agent-connected', payload);
  });
  registerAgentDisconnected((payload: unknown) => {
    broadcastContainerEvent('dd:agent-disconnected', payload);
  });

  router.get('/', eventsHandler);
  router.post('/self-update/:operationId/ack', acknowledgeSelfUpdate);
  return router;
}

function resetInitializationStateForTests(): void {
  initialized = false;
  if (staleSweepIntervalHandle) {
    globalThis.clearInterval(staleSweepIntervalHandle);
    staleSweepIntervalHandle = undefined;
  }
  if (sharedHeartbeatIntervalHandle) {
    globalThis.clearInterval(sharedHeartbeatIntervalHandle);
    sharedHeartbeatIntervalHandle = undefined;
  }
}

// For testing
export {
  clients as _clients,
  activeSseClientRegistryTestAdapter as _activeSseClientRegistry,
  connectionsPerIp as _connectionsPerIp,
  connectionsPerSession as _connectionsPerSession,
  MAX_CONNECTIONS_PER_IP as _MAX_CONNECTIONS_PER_IP,
  MAX_CONNECTIONS_PER_SESSION as _MAX_CONNECTIONS_PER_SESSION,
  SSE_HEARTBEAT_INTERVAL_MS as _SSE_HEARTBEAT_INTERVAL_MS,
  SSE_STALE_SWEEP_INTERVAL_MS as _SSE_STALE_SWEEP_INTERVAL_MS,
  SSE_STALE_ENTRY_TTL_MS as _SSE_STALE_ENTRY_TTL_MS,
  pendingSelfUpdateAcks as _pendingSelfUpdateAcks,
  sweepStaleSseState as _sweepStaleSseState,
  clearPendingSelfUpdateAcks as _clearPendingSelfUpdateAcks,
  resetInitializationStateForTests as _resetInitializationStateForTests,
  broadcastSelfUpdate as _broadcastSelfUpdate,
  acknowledgeSelfUpdate as _acknowledgeSelfUpdate,
  broadcastScanStarted as _broadcastScanStarted,
  broadcastScanCompleted as _broadcastScanCompleted,
};
