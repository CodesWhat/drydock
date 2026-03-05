import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
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

const router = express.Router();
let initialized = false;

interface ActiveSseClient {
  clientId: string;
  clientToken: string;
  clientTokenHash: Buffer;
  clientTokenHashHex: string;
  response: Response;
  connectedAtMs: number;
}

interface PendingSelfUpdateAck {
  operationId: string;
  requiresAck: boolean;
  ackTimeoutMs: number;
  createdAtMs: number;
  clientsAtEmit: number;
  eligibleClientTokens: Set<string>;
  ackedClientIds: Set<string>;
  resolved: boolean;
  resolveWaiter?: () => void;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

class ActiveSseClientRegistry {
  private readonly byToken = new Map<string, ActiveSseClient>();
  private readonly byTokenHash = new Map<string, ActiveSseClient>();
  private readonly byResponse = new Map<Response, ActiveSseClient>();

  add(client: ActiveSseClient): void {
    this.byResponse.set(client.response, client);
    this.byToken.set(client.clientToken, client);
    this.byTokenHash.set(client.clientTokenHashHex, client);
  }

  remove(client: ActiveSseClient): void {
    if (this.byToken.get(client.clientToken) === client) {
      this.byToken.delete(client.clientToken);
    }
    if (this.byTokenHash.get(client.clientTokenHashHex) === client) {
      this.byTokenHash.delete(client.clientTokenHashHex);
    }
    if (this.byResponse.get(client.response) === client) {
      this.byResponse.delete(client.response);
    }
  }

  clear(): void {
    this.byToken.clear();
    this.byTokenHash.clear();
    this.byResponse.clear();
  }

  hasByResponse(response: Response): boolean {
    return this.byResponse.has(response);
  }

  getByResponse(response: Response): ActiveSseClient | undefined {
    return this.byResponse.get(response);
  }

  getByTokenHashHex(tokenHashHex: string): ActiveSseClient | undefined {
    return this.byTokenHash.get(tokenHashHex);
  }

  listClientTokens(): Set<string> {
    return new Set(this.byToken.keys());
  }

  sizeByToken(): number {
    return this.byToken.size;
  }

  sizeByTokenHash(): number {
    return this.byTokenHash.size;
  }

  sizeByResponse(): number {
    return this.byResponse.size;
  }

  // Test helper used to validate stale-sweep behavior when indexes drift.
  simulateTokenHashOnlyDrift(response: Response): void {
    const client = this.byResponse.get(response);
    if (!client) {
      return;
    }
    if (this.byToken.get(client.clientToken) === client) {
      this.byToken.delete(client.clientToken);
    }
    this.byResponse.delete(response);
  }

  hasConsistentReferences(client: ActiveSseClient): boolean {
    return (
      this.byResponse.get(client.response) === client &&
      this.byToken.get(client.clientToken) === client &&
      this.byTokenHash.get(client.clientTokenHashHex) === client
    );
  }

  listClients(): IterableIterator<ActiveSseClient> {
    return this.byResponse.values();
  }
}

const clients = new Set<Response>();
const sseClientRegistry = new ActiveSseClientRegistry();
// Invariant: each ActiveSseClient is either absent from all indexes or present
// in all three maps with the same object reference.
const activeSseClientRegistryTestAdapter = {
  clear(): void {
    sseClientRegistry.clear();
  },
  hasByResponse(response: Response): boolean {
    return sseClientRegistry.hasByResponse(response);
  },
  getByResponse(response: Response): ActiveSseClient | undefined {
    return sseClientRegistry.getByResponse(response);
  },
  sizeByToken(): number {
    return sseClientRegistry.sizeByToken();
  },
  sizeByTokenHash(): number {
    return sseClientRegistry.sizeByTokenHash();
  },
  sizeByResponse(): number {
    return sseClientRegistry.sizeByResponse();
  },
  simulateTokenHashOnlyDrift(response: Response): void {
    sseClientRegistry.simulateTokenHashOnlyDrift(response);
  },
};
const pendingSelfUpdateAcks = new Map<string, PendingSelfUpdateAck>();
let staleSweepIntervalHandle: ReturnType<typeof globalThis.setInterval> | undefined;
let sharedHeartbeatIntervalHandle: ReturnType<typeof globalThis.setInterval> | undefined;

// Per-IP and per-session connection tracking to prevent connection exhaustion.
const MAX_CONNECTIONS_PER_IP = 10;
const MAX_CONNECTIONS_PER_SESSION = 10;
const connectionsPerIp = new Map<string, number>();
const connectionsPerSession = new Map<string, number>();
const DEFAULT_SELF_UPDATE_ACK_TIMEOUT_MS = 3000;
const SSE_HEARTBEAT_INTERVAL_MS = 15000;
const SSE_STALE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SSE_STALE_ENTRY_TTL_MS = 30 * 60 * 1000;

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

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

const DUMMY_CLIENT_TOKEN_HASH = hashToken('drydock-sse-dummy-client-token');

function findActiveClientByTokenConstantTime(clientToken: string): ActiveSseClient | undefined {
  const providedTokenHash = hashToken(clientToken);
  const activeClient = sseClientRegistry.getByTokenHashHex(providedTokenHash.toString('hex'));
  const comparisonHash = activeClient?.clientTokenHash ?? DUMMY_CLIENT_TOKEN_HASH;
  const hashMatches = timingSafeEqual(providedTokenHash, comparisonHash);
  return hashMatches && activeClient ? activeClient : undefined;
}

function hasEligibleClientTokenConstantTime(
  eligibleClientTokens: Set<string>,
  clientToken: string,
): boolean {
  const providedTokenHash = hashToken(clientToken);
  let hasMatch = false;
  for (const candidateToken of eligibleClientTokens) {
    const candidateTokenHash = hashToken(candidateToken);
    hasMatch = timingSafeEqual(providedTokenHash, candidateTokenHash) || hasMatch;
  }
  return hasMatch;
}

function isResponseClosed(response: Response): boolean {
  const writableEnded = (response as Response & { writableEnded?: boolean }).writableEnded;
  const writableFinished = (response as Response & { writableFinished?: boolean }).writableFinished;
  const destroyed = (response as Response & { destroyed?: boolean }).destroyed;
  return writableEnded === true || writableFinished === true || destroyed === true;
}

function dropActiveClient(client: ActiveSseClient): void {
  clients.delete(client.response);
  sseClientRegistry.remove(client);
}

function writeHeartbeat(response: Response): void {
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

  for (const [operationId, pending] of pendingSelfUpdateAcks) {
    const ageMs = nowMs - pending.createdAtMs;
    const staleThresholdMs = Math.max(
      pending.ackTimeoutMs + SSE_STALE_SWEEP_INTERVAL_MS,
      SSE_STALE_ENTRY_TTL_MS,
    );
    if (pending.resolved || ageMs >= staleThresholdMs) {
      finalizePendingAck(operationId);
    }
  }

  stopSharedHeartbeatIntervalIfIdle();
}

function eventsHandler(req: Request, res: Response): void {
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

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const clientToken = issueServerClientId('sse-token');
  const clientTokenHash = hashToken(clientToken);
  const activeClient: ActiveSseClient = {
    clientId: issueServerClientId('sse-client'),
    clientToken,
    clientTokenHash,
    clientTokenHashHex: clientTokenHash.toString('hex'),
    response: res,
    connectedAtMs: Date.now(),
  };
  sseClientRegistry.add(activeClient);

  // Send initial connection event
  res.write(
    `event: dd:connected\ndata: ${JSON.stringify({
      clientId: activeClient.clientId,
      clientToken: activeClient.clientToken,
    })}\n\n`,
  );
  (res as any).flush?.();

  clients.add(res);
  logger.debug(`SSE client connected (${clients.size} total)`);
  startSharedHeartbeatIntervalIfNeeded();

  let disconnected = false;
  const cleanup = () => {
    if (disconnected) {
      return;
    }
    disconnected = true;
    const disconnectedClient = sseClientRegistry.getByResponse(res);
    if (disconnectedClient) {
      dropActiveClient(disconnectedClient);
    } else {
      clients.delete(res);
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
  res.on('close', cleanup);
  res.on('error', cleanup);
}

function parseAckTimeoutMs(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SELF_UPDATE_ACK_TIMEOUT_MS;
  }
  return parsed;
}

function finalizePendingAck(operationId: string): void {
  const pending = pendingSelfUpdateAcks.get(operationId);
  if (!pending || pending.resolved) {
    return;
  }
  pending.resolved = true;
  if (pending.timeoutHandle) {
    globalThis.clearTimeout(pending.timeoutHandle);
    pending.timeoutHandle = undefined;
  }
  pendingSelfUpdateAcks.delete(operationId);
  if (pending.resolveWaiter) {
    pending.resolveWaiter();
    pending.resolveWaiter = undefined;
  }
}

async function broadcastSelfUpdate(payload: SelfUpdateStartingEventPayload): Promise<void> {
  const operationId = String(payload?.opId || '').trim();
  if (!operationId) {
    return;
  }
  const requiresAck = payload?.requiresAck === true;
  const ackTimeoutMs = parseAckTimeoutMs(payload?.ackTimeoutMs);
  const startedAt = payload?.startedAt || new Date().toISOString();
  const eventPayload = {
    opId: operationId,
    requiresAck,
    ackTimeoutMs,
    startedAt,
  };
  const serializedPayload = JSON.stringify(eventPayload);
  const eligibleClientTokens = sseClientRegistry.listClientTokens();

  for (const client of clients) {
    client.write(`event: dd:self-update\ndata: ${serializedPayload}\n\n`);
    (client as any).flush?.();
  }

  if (!requiresAck || eligibleClientTokens.size === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const pending: PendingSelfUpdateAck = {
      operationId,
      requiresAck,
      ackTimeoutMs,
      createdAtMs: Date.now(),
      clientsAtEmit: eligibleClientTokens.size,
      eligibleClientTokens,
      ackedClientIds: new Set<string>(),
      resolved: false,
      resolveWaiter: resolve,
      timeoutHandle: globalThis.setTimeout(() => {
        finalizePendingAck(operationId);
      }, ackTimeoutMs),
    };
    pendingSelfUpdateAcks.set(operationId, pending);
  });
}

function acknowledgeSelfUpdate(req: Request, res: Response): void {
  const operationId = String(req.params.operationId || '').trim();
  const clientId = String(req.body?.clientId || '').trim();
  const clientToken = String(req.body?.clientToken || '').trim();
  if (!operationId) {
    res.status(400).json({ error: 'operationId is required' });
    return;
  }
  if (!clientId) {
    res.status(400).json({ error: 'clientId is required' });
    return;
  }
  if (!clientToken) {
    res.status(400).json({ error: 'clientToken is required' });
    return;
  }

  const pending = pendingSelfUpdateAcks.get(operationId);
  if (!pending) {
    res.status(202).json({
      status: 'ignored',
      operationId,
      reason: 'no-pending-ack',
    });
    return;
  }

  const activeClient = findActiveClientByTokenConstantTime(clientToken);
  if (!activeClient) {
    res.status(403).json({
      status: 'rejected',
      operationId,
      reason: 'invalid-or-expired-client-token',
    });
    return;
  }
  if (activeClient.clientId !== clientId) {
    res.status(403).json({
      status: 'rejected',
      operationId,
      reason: 'client-token-mismatch',
    });
    return;
  }
  if (!hasEligibleClientTokenConstantTime(pending.eligibleClientTokens, clientToken)) {
    res.status(403).json({
      status: 'rejected',
      operationId,
      reason: 'client-not-bound-to-operation',
    });
    return;
  }

  pending.ackedClientIds.add(activeClient.clientId);
  finalizePendingAck(operationId);

  res.status(202).json({
    status: 'accepted',
    operationId,
    ackedClients: pending.ackedClientIds.size,
    clientsAtEmit: pending.clientsAtEmit,
  });
}

function clearPendingSelfUpdateAcks(): void {
  for (const operationId of pendingSelfUpdateAcks.keys()) {
    finalizePendingAck(operationId);
  }
}

export function broadcastScanStarted(containerId: string): void {
  const data = JSON.stringify({ containerId });
  for (const client of clients) {
    client.write(`event: dd:scan-started\ndata: ${data}\n\n`);
    (client as any).flush?.();
  }
}

export function broadcastScanCompleted(containerId: string, status: string): void {
  const data = JSON.stringify({ containerId, status });
  for (const client of clients) {
    client.write(`event: dd:scan-completed\ndata: ${data}\n\n`);
    (client as any).flush?.();
  }
}

function broadcastContainerEvent(eventName: string, payload: unknown): void {
  const data = JSON.stringify(payload ?? {});
  for (const client of clients) {
    client.write(`event: ${eventName}\ndata: ${data}\n\n`);
    (client as any).flush?.();
  }
}

export function init(): express.Router {
  if (initialized) {
    return router;
  }
  initialized = true;
  if (!staleSweepIntervalHandle) {
    staleSweepIntervalHandle = globalThis.setInterval(() => {
      sweepStaleSseState();
    }, SSE_STALE_SWEEP_INTERVAL_MS);
  }

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
