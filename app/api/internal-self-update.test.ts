import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createMockRequest, createMockResponse } from '../test/helpers.js';
import {
  createFinalizeSelfUpdateHandler,
  getSelfUpdateFinalizeSecret,
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
});
