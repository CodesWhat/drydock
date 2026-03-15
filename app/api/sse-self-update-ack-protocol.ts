import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { SelfUpdateStartingEventPayload } from '../event/index.js';
import { hashToken } from '../util/crypto.js';
import { sendErrorResponse } from './error-response.js';
import type {
  ActiveSseClient,
  ActiveSseClientRegistry,
  FlushableResponse,
} from './sse-active-client-registry.js';

interface PendingSelfUpdateAck {
  operationId: string;
  requiresAck: boolean;
  ackTimeoutMs: number;
  createdAtMs: number;
  clientsAtEmit: number;
  eligibleClientTokens: Buffer[];
  ackedClientIds: Set<string>;
  resolved: boolean;
  resolveWaiter?: () => void;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

export interface SelfUpdateAckProtocolDependencies {
  clients: Set<FlushableResponse>;
  activeClientRegistry: ActiveSseClientRegistry;
  defaultAckTimeoutMs: number;
}

interface SelfUpdateAckSweepOptions {
  nowMs: number;
  staleSweepIntervalMs: number;
  staleEntryTtlMs: number;
}

interface SelfUpdateAckProtocol {
  pendingSelfUpdateAcks: Map<string, PendingSelfUpdateAck>;
  broadcastSelfUpdate(payload: SelfUpdateStartingEventPayload): Promise<void>;
  acknowledgeSelfUpdate(req: Request, res: Response): void;
  clearPendingSelfUpdateAcks(): void;
  sweepStalePendingSelfUpdateAcks(options: SelfUpdateAckSweepOptions): void;
}

const DUMMY_CLIENT_TOKEN_HASH = hashToken('drydock-sse-dummy-client-token');

interface SelfUpdateAckProtocolContext {
  clients: Set<FlushableResponse>;
  activeClientRegistry: ActiveSseClientRegistry;
  defaultAckTimeoutMs: number;
  pendingSelfUpdateAcks: Map<string, PendingSelfUpdateAck>;
}

interface ParsedAckRequest {
  operationId: string;
  clientId: string;
  clientToken: string;
}

function parseAckTimeoutMs(value: unknown, defaultAckTimeoutMs: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultAckTimeoutMs;
  }
  return parsed;
}

function parseAckRequest(req: Request): ParsedAckRequest {
  return {
    operationId: String(req.params.operationId || '').trim(),
    clientId: String(req.body?.clientId || '').trim(),
    clientToken: String(req.body?.clientToken || '').trim(),
  };
}

function validateAckRequestFields(res: Response, fields: ParsedAckRequest): boolean {
  if (!fields.operationId) {
    sendErrorResponse(res, 400, 'operationId is required');
    return false;
  }
  if (!fields.clientId) {
    sendErrorResponse(res, 400, 'clientId is required');
    return false;
  }
  if (!fields.clientToken) {
    sendErrorResponse(res, 400, 'clientToken is required');
    return false;
  }
  return true;
}

function finalizePendingAck(context: SelfUpdateAckProtocolContext, operationId: string): void {
  const pending = context.pendingSelfUpdateAcks.get(operationId);
  if (!pending) {
    return;
  }
  if (pending.resolved) {
    context.pendingSelfUpdateAcks.delete(operationId);
    return;
  }
  pending.resolved = true;
  if (pending.timeoutHandle) {
    globalThis.clearTimeout(pending.timeoutHandle);
    pending.timeoutHandle = undefined;
  }
  context.pendingSelfUpdateAcks.delete(operationId);
  if (pending.resolveWaiter) {
    pending.resolveWaiter();
    pending.resolveWaiter = undefined;
  }
}

function findActiveClientByTokenConstantTime(
  activeClientRegistry: ActiveSseClientRegistry,
  clientToken: string,
): ActiveSseClient | undefined {
  const providedTokenHash = hashToken(clientToken);
  const activeClient = activeClientRegistry.getByTokenHashHex(providedTokenHash.toString('hex'));
  const comparisonHash = activeClient?.clientTokenHash ?? DUMMY_CLIENT_TOKEN_HASH;
  const hashMatches = timingSafeEqual(providedTokenHash, comparisonHash);
  return hashMatches && activeClient ? activeClient : undefined;
}

function hasEligibleClientTokenConstantTime(
  eligibleClientTokens: readonly Buffer[],
  clientToken: string,
): boolean {
  const providedTokenHash = hashToken(clientToken);
  let hasMatch = false;
  for (const candidateTokenHash of eligibleClientTokens) {
    hasMatch = timingSafeEqual(providedTokenHash, candidateTokenHash) || hasMatch;
  }
  return hasMatch;
}

function writeSelfUpdateEventToAllClients(
  clients: ReadonlySet<FlushableResponse>,
  serializedPayload: string,
): void {
  for (const client of clients) {
    client.write(`event: dd:self-update\ndata: ${serializedPayload}\n\n`);
    client.flush?.();
  }
}

function waitForSelfUpdateAckOrTimeout(
  context: SelfUpdateAckProtocolContext,
  operationId: string,
  ackTimeoutMs: number,
  eligibleClientTokenHashes: readonly Buffer[],
): Promise<void> {
  return new Promise<void>((resolve) => {
    const pending: PendingSelfUpdateAck = {
      operationId,
      requiresAck: true,
      ackTimeoutMs,
      createdAtMs: Date.now(),
      clientsAtEmit: eligibleClientTokenHashes.length,
      eligibleClientTokens: [...eligibleClientTokenHashes],
      ackedClientIds: new Set<string>(),
      resolved: false,
      resolveWaiter: resolve,
      timeoutHandle: globalThis.setTimeout(() => {
        finalizePendingAck(context, operationId);
      }, ackTimeoutMs),
    };
    context.pendingSelfUpdateAcks.set(operationId, pending);
  });
}

async function broadcastSelfUpdate(
  context: SelfUpdateAckProtocolContext,
  payload: SelfUpdateStartingEventPayload,
): Promise<void> {
  const operationId = String(payload?.opId || '').trim();
  if (!operationId) {
    return;
  }
  const requiresAck = payload?.requiresAck === true;
  const ackTimeoutMs = parseAckTimeoutMs(payload?.ackTimeoutMs, context.defaultAckTimeoutMs);
  const startedAt = payload?.startedAt || new Date().toISOString();
  const eventPayload = {
    opId: operationId,
    requiresAck,
    ackTimeoutMs,
    startedAt,
  };
  const serializedPayload = JSON.stringify(eventPayload);
  const eligibleClientTokenHashes = Array.from(
    context.activeClientRegistry.listClientTokens(),
    (token) => hashToken(token),
  );

  writeSelfUpdateEventToAllClients(context.clients, serializedPayload);

  if (!requiresAck || eligibleClientTokenHashes.length === 0) {
    return;
  }

  await waitForSelfUpdateAckOrTimeout(
    context,
    operationId,
    ackTimeoutMs,
    eligibleClientTokenHashes,
  );
}

function acknowledgeSelfUpdate(
  context: SelfUpdateAckProtocolContext,
  req: Request,
  res: Response,
): void {
  const fields = parseAckRequest(req);
  if (!validateAckRequestFields(res, fields)) {
    return;
  }

  const pending = context.pendingSelfUpdateAcks.get(fields.operationId);
  if (!pending) {
    res.status(202).json({
      status: 'ignored',
      operationId: fields.operationId,
      reason: 'no-pending-ack',
    });
    return;
  }

  const activeClient = findActiveClientByTokenConstantTime(
    context.activeClientRegistry,
    fields.clientToken,
  );
  if (!activeClient) {
    res.status(403).json({
      status: 'rejected',
      operationId: fields.operationId,
      reason: 'invalid-or-expired-client-token',
    });
    return;
  }
  if (activeClient.clientId !== fields.clientId) {
    res.status(403).json({
      status: 'rejected',
      operationId: fields.operationId,
      reason: 'client-token-mismatch',
    });
    return;
  }
  if (!hasEligibleClientTokenConstantTime(pending.eligibleClientTokens, fields.clientToken)) {
    res.status(403).json({
      status: 'rejected',
      operationId: fields.operationId,
      reason: 'client-not-bound-to-operation',
    });
    return;
  }

  pending.ackedClientIds.add(activeClient.clientId);
  finalizePendingAck(context, fields.operationId);

  res.status(202).json({
    status: 'accepted',
    operationId: fields.operationId,
    ackedClients: pending.ackedClientIds.size,
    clientsAtEmit: pending.clientsAtEmit,
  });
}

function clearPendingSelfUpdateAcks(context: SelfUpdateAckProtocolContext): void {
  for (const operationId of context.pendingSelfUpdateAcks.keys()) {
    finalizePendingAck(context, operationId);
  }
}

function sweepStalePendingSelfUpdateAcks(
  context: SelfUpdateAckProtocolContext,
  { nowMs, staleSweepIntervalMs, staleEntryTtlMs }: SelfUpdateAckSweepOptions,
): void {
  for (const [operationId, pending] of context.pendingSelfUpdateAcks) {
    const ageMs = nowMs - pending.createdAtMs;
    const staleThresholdMs = Math.max(pending.ackTimeoutMs + staleSweepIntervalMs, staleEntryTtlMs);
    if (pending.resolved || ageMs >= staleThresholdMs) {
      finalizePendingAck(context, operationId);
    }
  }
}

export function createSelfUpdateAckProtocol(
  dependencies: SelfUpdateAckProtocolDependencies,
): SelfUpdateAckProtocol {
  const pendingSelfUpdateAcks = new Map<string, PendingSelfUpdateAck>();
  const context: SelfUpdateAckProtocolContext = {
    ...dependencies,
    pendingSelfUpdateAcks,
  };

  return {
    pendingSelfUpdateAcks,
    broadcastSelfUpdate: (payload) => broadcastSelfUpdate(context, payload),
    acknowledgeSelfUpdate: (req, res) => acknowledgeSelfUpdate(context, req, res),
    clearPendingSelfUpdateAcks: () => clearPendingSelfUpdateAcks(context),
    sweepStalePendingSelfUpdateAcks: (options) => sweepStalePendingSelfUpdateAcks(context, options),
  };
}
