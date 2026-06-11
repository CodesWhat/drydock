import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createMockRequest, createMockResponse } from '../test/helpers.js';
import { init } from './self-update.js';

const mockGetFreshSelfUpdateOperationById = vi.hoisted(() => vi.fn());

vi.mock('../store/update-operation.js', () => ({
  getFreshSelfUpdateOperationById: (...args: unknown[]) =>
    mockGetFreshSelfUpdateOperationById(...args),
}));

describe('self-update status endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRequest(params: Record<string, string>, overrides: Record<string, unknown> = {}) {
    return createMockRequest({ params, ...overrides });
  }

  test('returns 400 when operationId is missing', () => {
    const handler = getStatusHandler();

    const req = makeRequest({ operationId: '' });
    const res = createMockResponse();
    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockGetFreshSelfUpdateOperationById).not.toHaveBeenCalled();
  });

  test('returns 404 when operation is not found', () => {
    mockGetFreshSelfUpdateOperationById.mockReturnValue(undefined);

    const req = makeRequest({ operationId: 'unknown-op-id' });
    const res = createMockResponse();

    const handler = getStatusHandler();
    handler(req, res);

    expect(mockGetFreshSelfUpdateOperationById).toHaveBeenCalledWith('unknown-op-id');
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 200 with minimal fields for an active operation', () => {
    mockGetFreshSelfUpdateOperationById.mockReturnValue({
      id: 'op-active',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
      containerName: 'drydock',
      finalizeSecretHash: 'secret-hash',
      container: { name: 'drydock' },
      lastError: undefined,
    });

    const req = makeRequest({ operationId: 'op-active' });
    const res = createMockResponse();
    getStatusHandler()(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({
      operationId: 'op-active',
      status: 'in-progress',
      phase: 'prepare',
    });
    // Must not leak sensitive fields
    expect(body).not.toHaveProperty('finalizeSecretHash');
    expect(body).not.toHaveProperty('container');
    expect(body).not.toHaveProperty('lastError');
    expect(body).not.toHaveProperty('containerName');
    expect(body).not.toHaveProperty('completedAt');
  });

  test('returns 200 with completedAt for a terminal operation', () => {
    mockGetFreshSelfUpdateOperationById.mockReturnValue({
      id: 'op-terminal',
      status: 'succeeded',
      phase: 'succeeded',
      kind: 'self-update',
      containerName: 'drydock',
      completedAt: '2026-06-11T12:00:00.000Z',
    });

    const req = makeRequest({ operationId: 'op-terminal' });
    const res = createMockResponse();
    getStatusHandler()(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({
      operationId: 'op-terminal',
      status: 'succeeded',
      phase: 'succeeded',
      completedAt: '2026-06-11T12:00:00.000Z',
    });
  });

  test('stale active op is returned as expired (getFreshSelfUpdateOperationById handles this)', () => {
    // getFreshSelfUpdateOperationById expires stale ops and returns the expired row
    mockGetFreshSelfUpdateOperationById.mockReturnValue({
      id: 'op-expired',
      status: 'expired',
      phase: 'expired',
      kind: 'self-update',
      containerName: 'drydock',
      completedAt: '2026-06-11T11:00:00.000Z',
      lastError: 'exceeded grace window',
    });

    const req = makeRequest({ operationId: 'op-expired' });
    const res = createMockResponse();
    getStatusHandler()(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe('expired');
    expect(body).not.toHaveProperty('lastError');
  });

  test('init registers the status route', () => {
    const router = init();
    expect(
      router.stack.some(
        (layer) => layer.route?.path === '/:operationId/status' && layer.route.methods.get,
      ),
    ).toBe(true);
  });
});

// Helper to extract the status handler from the router without mounting it
function getStatusHandler() {
  const router = init();
  const layer = router.stack.find((l) => l.route?.path === '/:operationId/status');
  const handlers = layer?.route?.stack ?? [];
  // The nocache middleware is first; the actual handler is last
  const handle = handlers[handlers.length - 1]?.handle;
  if (!handle) throw new Error('Status handler not found in router');
  return handle as (req: unknown, res: unknown) => void;
}
