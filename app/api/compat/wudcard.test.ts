import { createMockRequest, createMockResponse } from '../../test/helpers.js';

const mockRouterUse = vi.hoisted(() => vi.fn());
const mockRouter = vi.hoisted(() => vi.fn(() => ({ use: mockRouterUse })));

vi.mock('express', () => ({
  default: {
    Router: mockRouter,
  },
}));

import { init, wudCardCompatMiddleware } from './wudcard.js';

function runMiddleware(method: string, path: string) {
  const req = createMockRequest({ method, path });
  const res = createMockResponse();
  const next = vi.fn();
  wudCardCompatMiddleware(req, res, next);
  return { req, res, next };
}

describe('wud-card compat middleware', () => {
  test('GET /containers reshapes the collection envelope into a bare array', () => {
    const { res, next } = runMiddleware('GET', '/containers');
    expect(next).toHaveBeenCalledOnce();

    res.json({ data: [{ id: 'c1' }], total: 1, limit: 0, offset: 0, hasMore: false });
    expect(res.body).toEqual([{ id: 'c1' }]);
  });

  test('GET /containers/:id/triggers reshapes the collection envelope into a bare array', () => {
    const { res, next } = runMiddleware('GET', '/containers/abc123/triggers');
    expect(next).toHaveBeenCalledOnce();

    res.json({ data: [{ id: 'docker.mydocker', type: 'docker', name: 'mydocker' }], total: 1 });
    expect(res.body).toEqual([{ id: 'docker.mydocker', type: 'docker', name: 'mydocker' }]);
  });

  test('GET /containers/:id/triggers 404 error body passes through unshaped', () => {
    const { res } = runMiddleware('GET', '/containers/missing/triggers');
    res.json({ error: 'Container not found' });
    expect(res.body).toEqual({ error: 'Container not found' });
  });

  test('POST /containers/watch reshapes the collection envelope on 200', () => {
    const { res, next } = runMiddleware('POST', '/containers/watch');
    expect(next).toHaveBeenCalledOnce();

    res.json({
      data: [{ id: 'c1' }],
      total: 1,
      limit: 0,
      offset: 0,
      hasMore: false,
      _links: { self: '/api/v1/containers/watch' },
    });
    expect(res.body).toEqual([{ id: 'c1' }]);
  });

  test('POST /containers/watch error body passes through unshaped', () => {
    const { res } = runMiddleware('POST', '/containers/watch');
    res.json({ error: 'Error when watching images (boom)' });
    expect(res.body).toEqual({ error: 'Error when watching images (boom)' });
  });

  test('POST /containers/:id/triggers/:type/:name is whitelisted but never reshaped (pure pass-through)', () => {
    const { res, next } = runMiddleware('POST', '/containers/abc123/triggers/docker/mydocker');
    expect(next).toHaveBeenCalledOnce();

    res.json({ operationId: 'op-1' });
    expect(res.body).toEqual({ operationId: 'op-1' });
  });

  test('POST /containers/:id/triggers/:type/:name/:agent (5-segment remote-agent variant) is not whitelisted', () => {
    const { res } = runMiddleware('POST', '/containers/abc123/triggers/docker/mydocker/agent1');
    res.json({ data: [1], total: 1 });
    expect(res.body).toEqual({ data: [1], total: 1 });
  });

  test('POST /containers/:id/watch (single-container rescan) is not whitelisted', () => {
    const { res } = runMiddleware('POST', '/containers/abc123/watch');
    res.json({ data: [1], total: 1 });
    expect(res.body).toEqual({ data: [1], total: 1 });
  });

  test('non-whitelisted GET path passes through untouched', () => {
    const { res, next } = runMiddleware('GET', '/settings');
    expect(next).toHaveBeenCalledOnce();

    res.json({ data: [1], total: 1 });
    expect(res.body).toEqual({ data: [1], total: 1 });
  });

  test('array body on a reshape route passes through untouched (not already an envelope)', () => {
    const { res } = runMiddleware('GET', '/containers');
    res.json([{ id: 'c1' }]);
    expect(res.body).toEqual([{ id: 'c1' }]);
  });

  test('null body on a reshape route passes through untouched', () => {
    const { res } = runMiddleware('GET', '/containers');
    res.json(null);
    expect(res.body).toBeNull();
  });

  test('body with a non-numeric total on a reshape route passes through untouched', () => {
    const { res } = runMiddleware('GET', '/containers');
    res.json({ data: [], total: '1' });
    expect(res.body).toEqual({ data: [], total: '1' });
  });

  test('body with an unexpected extra key on a reshape route passes through untouched', () => {
    const { res } = runMiddleware('GET', '/containers');
    res.json({ data: [], total: 0, unexpectedKey: 'x' });
    expect(res.body).toEqual({ data: [], total: 0, unexpectedKey: 'x' });
  });

  test('body missing a data array on a reshape route passes through untouched', () => {
    const { res } = runMiddleware('GET', '/containers');
    res.json({ total: 0 });
    expect(res.body).toEqual({ total: 0 });
  });
});

describe('wud-card compat router init', () => {
  test('mounts wudCardCompatMiddleware on the router', () => {
    mockRouterUse.mockClear();
    mockRouter.mockClear();

    const router = init();

    expect(mockRouter).toHaveBeenCalledOnce();
    expect(mockRouterUse).toHaveBeenCalledWith(wudCardCompatMiddleware);
    expect(router).toBeDefined();
  });
});
