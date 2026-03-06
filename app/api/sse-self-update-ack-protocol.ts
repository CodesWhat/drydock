import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { SelfUpdateStartingEventPayload } from '../event/index.js';
import { hashToken } from '../util/crypto.js';
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

interface SelfUpdateAckProtocolDependencies {
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

export function createSelfUpdateAckProtocol(
  dependencies: SelfUpdateAckProtocolDependencies,
): SelfUpdateAckProtocol {
  const { clients, activeClientRegistry, defaultAckTimeoutMs } = dependencies;
  const pendingSelfUpdateAcks = new Map<string, PendingSelfUpdateAck>();

  function parseAckTimeoutMs(value: unknown): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return defaultAckTimeoutMs;
    }
    return parsed;
  }

  function finalizePendingAck(operationId: string): void {
    const pending = pendingSelfUpdateAcks.get(operationId);
    if (!pending) {
      return;
    }
    if (pending.resolved) {
      pendingSelfUpdateAcks.delete(operationId);
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

  function findActiveClientByTokenConstantTime(clientToken: string): ActiveSseClient | undefined {
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
    const eligibleClientTokens = activeClientRegistry.listClientTokens();
    const eligibleClientTokenHashes = Array.from(eligibleClientTokens, (token) => hashToken(token));

    for (const client of clients) {
      client.write(`event: dd:self-update\ndata: ${serializedPayload}\n\n`);
      client.flush?.();
    }

    if (!requiresAck || eligibleClientTokenHashes.length === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      const pending: PendingSelfUpdateAck = {
        operationId,
        requiresAck,
        ackTimeoutMs,
        createdAtMs: Date.now(),
        clientsAtEmit: eligibleClientTokenHashes.length,
        eligibleClientTokens: eligibleClientTokenHashes,
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

  function sweepStalePendingSelfUpdateAcks({
    nowMs,
    staleSweepIntervalMs,
    staleEntryTtlMs,
  }: SelfUpdateAckSweepOptions): void {
    for (const [operationId, pending] of pendingSelfUpdateAcks) {
      const ageMs = nowMs - pending.createdAtMs;
      const staleThresholdMs = Math.max(
        pending.ackTimeoutMs + staleSweepIntervalMs,
        staleEntryTtlMs,
      );
      if (pending.resolved || ageMs >= staleThresholdMs) {
        finalizePendingAck(operationId);
      }
    }
  }

  return {
    pendingSelfUpdateAcks,
    broadcastSelfUpdate,
    acknowledgeSelfUpdate,
    clearPendingSelfUpdateAcks,
    sweepStalePendingSelfUpdateAcks,
  };
}
