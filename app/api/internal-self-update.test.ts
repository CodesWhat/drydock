import crypto from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createMockRequest, createMockResponse } from '../test/helpers.js';
import {
  createFinalizeSelfUpdateHandler,
  getSelfUpdateFinalizeSecret,
  getSelfUpdateFinalizeSecretForOperation,
  init,
  isLoopbackAddress,
  issueSelfUpdateFinalizeSecret,
  SELF_UPDATE_FINALIZE_SECRET_HEADER,
} from './internal-self-update.js';

const mockGetOperationById = vi.hoisted(() => vi.fn());
const mockMarkOperationTerminal = vi.hoisted(() => vi.fn());

vi.mock('../store/update-operation.js', () => ({
  getOperationById: (...args: unknown[]) => mockGetOperationById(...args),
  markOperationTerminal: (...args: unknown[]) => mockMarkOperationTerminal(...args),
}));

describe('internal-self-update', () => {
  const finalizeSecret = getSelfUpdateFinalizeSecret();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createActiveSelfUpdateOp(overrides: Record<string, unknown> = {}) {
    return {
      id: 'op-123',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
      ...overrides,
    };
  }

  function createFinalizeRequest(overrides: Record<string, unknown> = {}) {
    const headers = new Map<string, string>([[SELF_UPDATE_FINALIZE_SECRET_HEADER, finalizeSecret]]);
    const overrideHeaders = overrides.headers as Record<string, string> | undefined;
    if (overrideHeaders) {
      for (const [key, value] of Object.entries(overrideHeaders)) {
        headers.set(key.toLowerCase(), value);
      }
    }

    return createMockRequest({
      socket: { remoteAddress: '127.0.0.1' },
      header: (name: string) => headers.get(name.toLowerCase()),
      ...overrides,
    });
  }

  test('accepts common loopback address formats', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress(' 127.0.0.1 ')).toBe(true);
    expect(isLoopbackAddress('10.0.0.1')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  test('marks an active self-update operation terminal from a loopback request', () => {
    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp());

    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        operationId: 'op-123',
        status: 'rolled-back',
        phase: 'rolled-back',
        lastError: 'health gate failed',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith('op-123', {
      status: 'rolled-back',
      phase: 'rolled-back',
      lastError: 'health gate failed',
    });
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test('marks an active self-update operation as succeeded', () => {
    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp());

    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        operationId: 'op-123',
        status: 'succeeded',
        phase: 'succeeded',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith('op-123', {
      status: 'succeeded',
      phase: 'succeeded',
    });
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test('marks an active self-update operation as failed', () => {
    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp());

    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        operationId: 'op-123',
        status: 'failed',
        phase: 'failed',
        lastError: 'controller failure',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith('op-123', {
      status: 'failed',
      phase: 'failed',
      lastError: 'controller failure',
    });
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test('marks an active self-update operation as expired', () => {
    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp());

    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        operationId: 'op-123',
        status: 'expired',
        phase: 'expired',
        lastError: 'finalize timeout',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith('op-123', {
      status: 'expired',
      phase: 'expired',
      lastError: 'finalize timeout',
    });
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test('marks terminal payloads without phases and trims blank lastError text', () => {
    const handler = createFinalizeSelfUpdateHandler();

    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp({ id: 'op-succeeded' }));
    handler(
      createFinalizeRequest({
        body: {
          operationId: 'op-succeeded',
          status: 'succeeded',
        },
      }),
      createMockResponse(),
    );

    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp({ id: 'op-rolled-back' }));
    handler(
      createFinalizeRequest({
        body: {
          operationId: 'op-rolled-back',
          status: 'rolled-back',
        },
      }),
      createMockResponse(),
    );

    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp({ id: 'op-failed' }));
    handler(
      createFinalizeRequest({
        body: {
          operationId: 'op-failed',
          status: 'failed',
          lastError: '   ',
        },
      }),
      createMockResponse(),
    );

    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp({ id: 'op-expired' }));
    handler(
      createFinalizeRequest({
        body: {
          operationId: 'op-expired',
          status: 'expired',
        },
      }),
      createMockResponse(),
    );

    expect(mockMarkOperationTerminal).toHaveBeenNthCalledWith(1, 'op-succeeded', {
      status: 'succeeded',
    });
    expect(mockMarkOperationTerminal).toHaveBeenNthCalledWith(2, 'op-rolled-back', {
      status: 'rolled-back',
    });
    expect(mockMarkOperationTerminal).toHaveBeenNthCalledWith(3, 'op-failed', {
      status: 'failed',
    });
    expect(mockMarkOperationTerminal).toHaveBeenNthCalledWith(4, 'op-expired', {
      status: 'expired',
    });
  });

  test('rejects finalize requests with a missing operation id', () => {
    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        status: 'succeeded',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects finalize requests without a request body', () => {
    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: undefined,
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects finalize requests with a non-terminal status', () => {
    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        operationId: 'op-123',
        status: 'queued',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects finalize requests with an invalid terminal phase', () => {
    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        operationId: 'op-123',
        status: 'succeeded',
        phase: 'prepare',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects non-loopback callers', () => {
    const handler = createFinalizeSelfUpdateHandler();
    const req = createMockRequest({
      socket: { remoteAddress: '10.0.0.2' },
      header: (name: string) =>
        name.toLowerCase() === SELF_UPDATE_FINALIZE_SECRET_HEADER ? finalizeSecret : undefined,
      body: {
        operationId: 'op-123',
        status: 'succeeded',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('rejects loopback callers without the finalize secret (fallback path, no stored hash)', () => {
    // Op without a stored hash — falls back to process-level secret check.
    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp());
    const handler = createFinalizeSelfUpdateHandler();
    const req = createMockRequest({
      socket: { remoteAddress: '127.0.0.1' },
      header: () => undefined,
      body: {
        operationId: 'op-123',
        status: 'succeeded',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('rejects loopback callers with a mismatched finalize secret length (fallback path)', () => {
    // Op without a stored hash — falls back to process-level secret check.
    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp());
    const handler = createFinalizeSelfUpdateHandler();
    const req = createMockRequest({
      socket: { remoteAddress: '127.0.0.1' },
      header: (name: string) =>
        name.toLowerCase() === SELF_UPDATE_FINALIZE_SECRET_HEADER ? 'wrong' : undefined,
      body: {
        operationId: 'op-123',
        status: 'succeeded',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('ignores already-terminal operations without rewriting them', () => {
    mockGetOperationById.mockReturnValue({
      id: 'op-123',
      status: 'succeeded',
      phase: 'succeeded',
      kind: 'self-update',
    });

    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        operationId: 'op-123',
        status: 'succeeded',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ignored',
        operationId: 'op-123',
        reason: 'already-terminal',
      }),
    );
  });

  test('ignores already-expired operations without rewriting them', () => {
    mockGetOperationById.mockReturnValue({
      id: 'op-123',
      status: 'expired',
      phase: 'expired',
      kind: 'self-update',
    });

    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        operationId: 'op-123',
        status: 'failed',
        phase: 'failed',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ignored',
        operationId: 'op-123',
        reason: 'already-terminal',
      }),
    );
  });

  test('rejects finalize requests for non-self-update operations', () => {
    mockGetOperationById.mockReturnValue({
      id: 'op-123',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'container-update',
    });

    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        operationId: 'op-123',
        status: 'succeeded',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('rejects finalize requests for unknown operations', () => {
    mockGetOperationById.mockReturnValue(undefined);

    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: {
        operationId: 'missing-op',
        status: 'succeeded',
      },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('init registers the finalize route', () => {
    const router = init();

    expect(
      router.stack.some(
        (layer) => layer.route?.path === '/self-update/finalize' && layer.route.methods.post,
      ),
    ).toBe(true);
  });

  test('issueSelfUpdateFinalizeSecret generates a secret and its sha256 hash', () => {
    const { secret, secretHash } = issueSelfUpdateFinalizeSecret('op-issue-test');

    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(0);
    const expectedHash = crypto.createHash('sha256').update(secret).digest('hex');
    expect(secretHash).toBe(expectedHash);
  });

  test('getSelfUpdateFinalizeSecretForOperation returns the issued secret', () => {
    const { secret } = issueSelfUpdateFinalizeSecret('op-retrieve-test');
    expect(getSelfUpdateFinalizeSecretForOperation('op-retrieve-test')).toBe(secret);
  });

  test('getSelfUpdateFinalizeSecretForOperation falls back to process secret for unknown ops', () => {
    expect(getSelfUpdateFinalizeSecretForOperation('op-never-issued')).toBe(finalizeSecret);
  });

  test('per-op hash validation succeeds when correct secret is supplied', () => {
    const { secret, secretHash } = issueSelfUpdateFinalizeSecret('op-per-hash');
    mockGetOperationById.mockReturnValue(
      createActiveSelfUpdateOp({ id: 'op-per-hash', finalizeSecretHash: secretHash }),
    );

    const handler = createFinalizeSelfUpdateHandler();
    const req = createMockRequest({
      socket: { remoteAddress: '127.0.0.1' },
      header: (name: string) =>
        name.toLowerCase() === SELF_UPDATE_FINALIZE_SECRET_HEADER ? secret : undefined,
      body: { operationId: 'op-per-hash', status: 'succeeded' },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith('op-per-hash', { status: 'succeeded' });
  });

  test('per-op hash validation fails when wrong secret is supplied', () => {
    const { secretHash } = issueSelfUpdateFinalizeSecret('op-wrong-secret');
    mockGetOperationById.mockReturnValue(
      createActiveSelfUpdateOp({ id: 'op-wrong-secret', finalizeSecretHash: secretHash }),
    );

    const handler = createFinalizeSelfUpdateHandler();
    const req = createMockRequest({
      socket: { remoteAddress: '127.0.0.1' },
      header: (name: string) =>
        name.toLowerCase() === SELF_UPDATE_FINALIZE_SECRET_HEADER ? 'wrong-secret' : undefined,
      body: { operationId: 'op-wrong-secret', status: 'succeeded' },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
  });

  test('per-op hash validation fails when no secret is supplied', () => {
    const { secretHash } = issueSelfUpdateFinalizeSecret('op-no-secret');
    mockGetOperationById.mockReturnValue(
      createActiveSelfUpdateOp({ id: 'op-no-secret', finalizeSecretHash: secretHash }),
    );

    const handler = createFinalizeSelfUpdateHandler();
    const req = createMockRequest({
      socket: { remoteAddress: '127.0.0.1' },
      header: () => undefined,
      body: { operationId: 'op-no-secret', status: 'succeeded' },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
  });

  test('map is cleaned up after successful finalize', () => {
    const { secret } = issueSelfUpdateFinalizeSecret('op-cleanup');
    mockGetOperationById.mockReturnValue(createActiveSelfUpdateOp({ id: 'op-cleanup' }));

    // Use process-level secret (op has no stored hash, fallback path)
    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: { operationId: 'op-cleanup', status: 'succeeded' },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    // After cleanup, the per-op secret is no longer in the map
    expect(getSelfUpdateFinalizeSecretForOperation('op-cleanup')).toBe(finalizeSecret);
    // The secret we originally issued is gone
    expect(getSelfUpdateFinalizeSecretForOperation('op-cleanup')).not.toBe(secret);
  });

  test('map is cleaned up on the already-terminal path too', () => {
    issueSelfUpdateFinalizeSecret('op-already-terminal');
    mockGetOperationById.mockReturnValue({
      id: 'op-already-terminal',
      status: 'succeeded',
      phase: 'succeeded',
      kind: 'self-update',
    });

    const handler = createFinalizeSelfUpdateHandler();
    const req = createFinalizeRequest({
      body: { operationId: 'op-already-terminal', status: 'succeeded' },
    });
    const res = createMockResponse();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(getSelfUpdateFinalizeSecretForOperation('op-already-terminal')).toBe(finalizeSecret);
  });
});
