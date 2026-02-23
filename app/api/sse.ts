import type { Request, Response } from 'express';
import express from 'express';
import type { SelfUpdateStartingEventPayload } from '../event/index.js';
import { registerSelfUpdateStarting } from '../event/index.js';
import log from '../log/index.js';

const router = express.Router();

const clients = new Set<Response>();
const pendingSelfUpdateAcks = new Map<string, any>();

// Per-IP connection tracking to prevent connection exhaustion
const MAX_CONNECTIONS_PER_IP = 10;
const connectionsPerIp = new Map<string, number>();
const DEFAULT_SELF_UPDATE_ACK_TIMEOUT_MS = 3000;

function getClientIp(req: Request): string {
  return req.ip ?? 'unknown';
}

function eventsHandler(req: Request, res: Response): void {
  const logger = log.child({ component: 'sse' });
  const ip = getClientIp(req);
  const currentCount = connectionsPerIp.get(ip) ?? 0;

  if (currentCount >= MAX_CONNECTIONS_PER_IP) {
    logger.warn(`SSE connection limit reached for ${ip} (${currentCount})`);
    res.status(429).json({ message: 'Too many SSE connections' });
    return;
  }

  connectionsPerIp.set(ip, currentCount + 1);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send initial connection event
  res.write('event: dd:connected\ndata: {}\n\n');

  clients.add(res);
  logger.debug(`SSE client connected (${clients.size} total)`);

  // Heartbeat every 15s
  const heartbeatInterval = globalThis.setInterval(() => {
    res.write('event: dd:heartbeat\ndata: {}\n\n');
  }, 15000);

  req.on('close', () => {
    globalThis.clearInterval(heartbeatInterval);
    clients.delete(res);
    const count = connectionsPerIp.get(ip) ?? 1;
    if (count <= 1) {
      connectionsPerIp.delete(ip);
    } else {
      connectionsPerIp.set(ip, count - 1);
    }
    logger.debug(`SSE client disconnected (${clients.size} total)`);
  });
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

  for (const client of clients) {
    client.write(`event: dd:self-update\ndata: ${serializedPayload}\n\n`);
  }

  if (!requiresAck || clients.size === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const pending = {
      operationId,
      requiresAck,
      ackTimeoutMs,
      clientsAtEmit: clients.size,
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
  if (!operationId) {
    res.status(400).json({ error: 'operationId is required' });
    return;
  }
  if (!clientId) {
    res.status(400).json({ error: 'clientId is required' });
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

  pending.ackedClientIds.add(clientId);
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
  }
}

export function broadcastScanCompleted(containerId: string, status: string): void {
  const data = JSON.stringify({ containerId, status });
  for (const client of clients) {
    client.write(`event: dd:scan-completed\ndata: ${data}\n\n`);
  }
}

export function init(): express.Router {
  // Register for self-update events from the trigger system
  registerSelfUpdateStarting(async (payload: SelfUpdateStartingEventPayload) => {
    await broadcastSelfUpdate(payload);
  });

  router.get('/', eventsHandler);
  router.post('/self-update/:operationId/ack', acknowledgeSelfUpdate);
  return router;
}

// For testing
export {
  clients as _clients,
  connectionsPerIp as _connectionsPerIp,
  MAX_CONNECTIONS_PER_IP as _MAX_CONNECTIONS_PER_IP,
  pendingSelfUpdateAcks as _pendingSelfUpdateAcks,
  clearPendingSelfUpdateAcks as _clearPendingSelfUpdateAcks,
  broadcastSelfUpdate as _broadcastSelfUpdate,
  acknowledgeSelfUpdate as _acknowledgeSelfUpdate,
  broadcastScanStarted as _broadcastScanStarted,
  broadcastScanCompleted as _broadcastScanCompleted,
};
