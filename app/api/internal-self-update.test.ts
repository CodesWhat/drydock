import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createMockRequest, createMockResponse } from '../test/helpers.js';
import {
  createFinalizeSelfUpdateHandler,
  getSelfUpdateFinalizeSecret,
  init,
  isLoopbackAddress,
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
    mockGetOperationById.mockReturnValue({
      id: 'op-123',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
    });

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
    mockGetOperationById.mockReturnValue({
      id: 'op-123',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
    });

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
    mockGetOperationById.mockReturnValue({
      id: 'op-123',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
    });

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

  test('marks terminal payloads without phases and trims blank lastError text', () => {
    const handler = createFinalizeSelfUpdateHandler();

    mockGetOperationById.mockReturnValue({
      id: 'op-succeeded',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
    });
    handler(
      createFinalizeRequest({
        body: {
          operationId: 'op-succeeded',
          status: 'succeeded',
        },
      }),
      createMockResponse(),
    );

    mockGetOperationById.mockReturnValue({
      id: 'op-rolled-back',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
    });
    handler(
      createFinalizeRequest({
        body: {
          operationId: 'op-rolled-back',
          status: 'rolled-back',
        },
      }),
      createMockResponse(),
    );

    mockGetOperationById.mockReturnValue({
      id: 'op-failed',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
    });
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

    expect(mockMarkOperationTerminal).toHaveBeenNthCalledWith(1, 'op-succeeded', {
      status: 'succeeded',
    });
    expect(mockMarkOperationTerminal).toHaveBeenNthCalledWith(2, 'op-rolled-back', {
      status: 'rolled-back',
    });
    expect(mockMarkOperationTerminal).toHaveBeenNthCalledWith(3, 'op-failed', {
      status: 'failed',
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

  test('rejects loopback callers without the finalize secret', () => {
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

  test('rejects loopback callers with a mismatched finalize secret length', () => {
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
});
