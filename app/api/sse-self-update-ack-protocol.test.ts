import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  type ActiveSseClient,
  ActiveSseClientRegistry,
  type FlushableResponse,
} from './sse-active-client-registry.js';
import { createSelfUpdateAckProtocol } from './sse-self-update-ack-protocol.js';

function createResponse(): FlushableResponse {
  return {
    write: vi.fn(),
    flush: vi.fn(),
    on: vi.fn(),
  } as unknown as FlushableResponse;
}

function createClient(
  response: FlushableResponse,
  token: string,
  clientId = 'client-1',
): ActiveSseClient {
  const tokenHash = createHash('sha256').update(token, 'utf8').digest();
  return {
    clientId,
    clientToken: token,
    clientTokenHash: tokenHash,
    clientTokenHashHex: tokenHash.toString('hex'),
    response,
    connectedAtMs: Date.now(),
  };
}

function createJsonResponse(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

describe('sse-self-update-ack-protocol', () => {
  test('accepts valid acknowledgements', async () => {
    const response = createResponse();
    const client = createClient(response, 'token-1');
    const registry = new ActiveSseClientRegistry();
    registry.add(client);
    const protocol = createSelfUpdateAckProtocol({
      clients: new Set<FlushableResponse>([response]),
      activeClientRegistry: registry,
      defaultAckTimeoutMs: 3000,
    });

    const broadcastPromise = protocol.broadcastSelfUpdate({
      opId: 'op-1',
      requiresAck: true,
      ackTimeoutMs: 1000,
    });

    const req = {
      params: { operationId: 'op-1' },
      body: { clientId: client.clientId, clientToken: client.clientToken },
    } as Request;
    const res = createJsonResponse();

    protocol.acknowledgeSelfUpdate(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'accepted',
        operationId: 'op-1',
      }),
    );
    await broadcastPromise;
  });

  test('ignores self-update events without operation id', async () => {
    const response = createResponse();
    const protocol = createSelfUpdateAckProtocol({
      clients: new Set<FlushableResponse>([response]),
      activeClientRegistry: new ActiveSseClientRegistry(),
      defaultAckTimeoutMs: 3000,
    });

    await protocol.broadcastSelfUpdate({
      opId: '   ',
      requiresAck: true,
      ackTimeoutMs: 1000,
    });

    expect(response.write).not.toHaveBeenCalled();
    expect(protocol.pendingSelfUpdateAcks.size).toBe(0);
  });

  test('ignores undefined payload', async () => {
    const response = createResponse();
    const protocol = createSelfUpdateAckProtocol({
      clients: new Set<FlushableResponse>([response]),
      activeClientRegistry: new ActiveSseClientRegistry(),
      defaultAckTimeoutMs: 3000,
    });

    await protocol.broadcastSelfUpdate(undefined as unknown as { opId: string });

    expect(response.write).not.toHaveBeenCalled();
    expect(protocol.pendingSelfUpdateAcks.size).toBe(0);
  });

  test('validates missing operationId', () => {
    const protocol = createSelfUpdateAckProtocol({
      clients: new Set<FlushableResponse>(),
      activeClientRegistry: new ActiveSseClientRegistry(),
      defaultAckTimeoutMs: 3000,
    });

    const req = {
      params: {},
      body: { clientId: 'client-1', clientToken: 'token-1' },
    } as Request;
    const res = createJsonResponse();

    protocol.acknowledgeSelfUpdate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'operationId is required' });
  });

  test('ignores stale timeout callback after pending map is cleared', () => {
    vi.useFakeTimers();
    const response = createResponse();
    const client = createClient(response, 'token-1');
    const registry = new ActiveSseClientRegistry();
    registry.add(client);
    const protocol = createSelfUpdateAckProtocol({
      clients: new Set<FlushableResponse>([response]),
      activeClientRegistry: registry,
      defaultAckTimeoutMs: 3000,
    });

    const broadcastPromise = protocol.broadcastSelfUpdate({
      opId: 'op-timeout-callback',
      requiresAck: true,
      ackTimeoutMs: 1000,
    });
    expect(protocol.pendingSelfUpdateAcks.has('op-timeout-callback')).toBe(true);

    protocol.pendingSelfUpdateAcks.delete('op-timeout-callback');
    expect(protocol.pendingSelfUpdateAcks.has('op-timeout-callback')).toBe(false);

    vi.advanceTimersByTime(1000);
    void broadcastPromise;
    vi.useRealTimers();
  });

  test('rejects mismatched clientId for a valid token', async () => {
    const response = createResponse();
    const client = createClient(response, 'token-1', 'client-1');
    const registry = new ActiveSseClientRegistry();
    registry.add(client);
    const protocol = createSelfUpdateAckProtocol({
      clients: new Set<FlushableResponse>([response]),
      activeClientRegistry: registry,
      defaultAckTimeoutMs: 3000,
    });

    const broadcastPromise = protocol.broadcastSelfUpdate({
      opId: 'op-2',
      requiresAck: true,
      ackTimeoutMs: 1000,
    });

    const req = {
      params: { operationId: 'op-2' },
      body: { clientId: 'different-client', clientToken: client.clientToken },
    } as Request;
    const res = createJsonResponse();

    protocol.acknowledgeSelfUpdate(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        operationId: 'op-2',
        reason: 'client-token-mismatch',
      }),
    );

    protocol.clearPendingSelfUpdateAcks();
    await broadcastPromise;
  });

  test('sweep removes already-resolved pending acknowledgements', () => {
    const protocol = createSelfUpdateAckProtocol({
      clients: new Set<FlushableResponse>(),
      activeClientRegistry: new ActiveSseClientRegistry(),
      defaultAckTimeoutMs: 3000,
    });
    protocol.pendingSelfUpdateAcks.set('op-resolved', {
      operationId: 'op-resolved',
      requiresAck: true,
      ackTimeoutMs: 1000,
      createdAtMs: Date.now(),
      clientsAtEmit: 1,
      eligibleClientTokens: [],
      ackedClientIds: new Set<string>(),
      resolved: true,
    });

    protocol.sweepStalePendingSelfUpdateAcks({
      nowMs: Date.now(),
      staleSweepIntervalMs: 1000,
      staleEntryTtlMs: 30 * 60 * 1000,
    });

    expect(protocol.pendingSelfUpdateAcks.has('op-resolved')).toBe(false);
  });

  test('sweep keeps fresh unresolved pending acknowledgements', () => {
    const protocol = createSelfUpdateAckProtocol({
      clients: new Set<FlushableResponse>(),
      activeClientRegistry: new ActiveSseClientRegistry(),
      defaultAckTimeoutMs: 3000,
    });
    protocol.pendingSelfUpdateAcks.set('op-fresh', {
      operationId: 'op-fresh',
      requiresAck: true,
      ackTimeoutMs: 1000,
      createdAtMs: Date.now(),
      clientsAtEmit: 1,
      eligibleClientTokens: [],
      ackedClientIds: new Set<string>(),
      resolved: false,
    });

    protocol.sweepStalePendingSelfUpdateAcks({
      nowMs: Date.now(),
      staleSweepIntervalMs: 1000,
      staleEntryTtlMs: 30 * 60 * 1000,
    });

    expect(protocol.pendingSelfUpdateAcks.has('op-fresh')).toBe(true);
  });
});
