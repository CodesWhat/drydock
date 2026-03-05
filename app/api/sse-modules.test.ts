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

describe('sse extraction modules', () => {
  test('ActiveSseClientRegistry tracks add/remove across indexes', () => {
    const registry = new ActiveSseClientRegistry();
    const response = createResponse();
    const client = createClient(response, 'token-1');

    registry.add(client);
    expect(registry.getByResponse(response)).toBe(client);
    expect(registry.getByTokenHashHex(client.clientTokenHashHex)).toBe(client);
    expect(registry.sizeByToken()).toBe(1);
    expect(registry.sizeByTokenHash()).toBe(1);
    expect(registry.sizeByResponse()).toBe(1);

    registry.remove(client);
    expect(registry.sizeByToken()).toBe(0);
    expect(registry.sizeByTokenHash()).toBe(0);
    expect(registry.sizeByResponse()).toBe(0);
  });

  test('ActiveSseClientRegistry does not remove entries for stale client references', () => {
    const registry = new ActiveSseClientRegistry();
    const response = createResponse();
    const client = createClient(response, 'token-1', 'client-1');
    registry.add(client);

    const staleClientReference: ActiveSseClient = {
      ...client,
    };
    registry.remove(staleClientReference);

    expect(registry.getByResponse(response)).toBe(client);
    expect(registry.sizeByToken()).toBe(1);
    expect(registry.sizeByTokenHash()).toBe(1);
    expect(registry.sizeByResponse()).toBe(1);
  });

  test('ActiveSseClientRegistry drift helper is a no-op for unknown responses', () => {
    const registry = new ActiveSseClientRegistry();
    const response = createResponse();

    expect(() => registry.simulateTokenHashOnlyDrift(response)).not.toThrow();
    expect(registry.sizeByToken()).toBe(0);
    expect(registry.sizeByTokenHash()).toBe(0);
    expect(registry.sizeByResponse()).toBe(0);
  });

  test('ActiveSseClientRegistry drift helper tolerates token index reassignment', () => {
    const registry = new ActiveSseClientRegistry();
    const firstResponse = createResponse();
    const secondResponse = createResponse();
    const firstClient = createClient(firstResponse, 'shared-token', 'client-1');
    const secondClient = createClient(secondResponse, 'shared-token', 'client-2');
    registry.add(firstClient);
    registry.add(secondClient);

    registry.simulateTokenHashOnlyDrift(firstResponse);

    expect(registry.getByResponse(firstResponse)).toBeUndefined();
    expect(registry.getByResponse(secondResponse)).toBe(secondClient);
    expect(registry.sizeByToken()).toBe(1);
    expect(registry.sizeByTokenHash()).toBe(1);
    expect(registry.sizeByResponse()).toBe(1);
  });

  test('self-update ack protocol accepts valid acknowledgements', () => {
    const response = createResponse();
    const client = createClient(response, 'token-1');
    const registry = new ActiveSseClientRegistry();
    registry.add(client);
    const clients = new Set<FlushableResponse>([response]);
    const protocol = createSelfUpdateAckProtocol({
      clients,
      activeClientRegistry: registry,
      defaultAckTimeoutMs: 3000,
    });

    void protocol.broadcastSelfUpdate({
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
  });

  test('self-update ack protocol ignores self-update events without operation id', async () => {
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

  test('self-update ack protocol ignores undefined payload', async () => {
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

  test('self-update ack protocol validates missing operationId', () => {
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

  test('self-update ack protocol ignores stale timeout callback after pending map is cleared', () => {
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

  test('self-update ack protocol rejects mismatched clientId for a valid token', async () => {
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

  test('self-update ack protocol sweep removes already-resolved pending acknowledgements', () => {
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

  test('self-update ack protocol sweep keeps fresh unresolved pending acknowledgements', () => {
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
