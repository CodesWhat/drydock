import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createMockRequest, createMockResponse } from '../../test/helpers.js';

import { createWudCardCompatMiddleware, init } from './wudcard.js';

function runMiddleware(method: string, path: string, internalApiRouter = vi.fn()) {
  const req = createMockRequest({ method, path });
  const res = createMockResponse();
  const next = vi.fn();
  const middleware = createWudCardCompatMiddleware(internalApiRouter);
  middleware(req, res, next);
  return { req, res, next, internalApiRouter };
}

async function startServer(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('wud-card compat middleware', () => {
  test('GET /containers dispatches to the internal apiRouter and reshapes the collection envelope into a bare array', () => {
    const { req, res, next, internalApiRouter } = runMiddleware('GET', '/containers');
    expect(internalApiRouter).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();

    res.json({ data: [{ id: 'c1' }], total: 1, limit: 0, offset: 0, hasMore: false });
    expect(res.body).toEqual([{ id: 'c1' }]);
  });

  test('GET /containers/:id/triggers dispatches to the internal apiRouter and reshapes the collection envelope into a bare array', () => {
    const { req, res, next, internalApiRouter } = runMiddleware(
      'GET',
      '/containers/abc123/triggers',
    );
    expect(internalApiRouter).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();

    res.json({ data: [{ id: 'docker.mydocker', type: 'docker', name: 'mydocker' }], total: 1 });
    expect(res.body).toEqual([{ id: 'docker.mydocker', type: 'docker', name: 'mydocker' }]);
  });

  test('GET /containers/:id/triggers 404 error body passes through unshaped', () => {
    const { res } = runMiddleware('GET', '/containers/missing/triggers');
    res.json({ error: 'Container not found' });
    expect(res.body).toEqual({ error: 'Container not found' });
  });

  test('POST /containers/watch dispatches to the internal apiRouter and reshapes the collection envelope on 200', () => {
    const { req, res, next, internalApiRouter } = runMiddleware('POST', '/containers/watch');
    expect(internalApiRouter).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();

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

  test('POST /containers/:id/triggers/:type/:name is whitelisted, dispatches to the internal apiRouter, but is never reshaped (pure pass-through)', () => {
    const { req, res, next, internalApiRouter } = runMiddleware(
      'POST',
      '/containers/abc123/triggers/docker/mydocker',
    );
    expect(internalApiRouter).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();

    res.json({ operationId: 'op-1' });
    expect(res.body).toEqual({ operationId: 'op-1' });
  });

  test('POST /containers/:id/triggers/:type/:name/:agent (5-segment remote-agent variant) is not whitelisted', () => {
    const { res, next, internalApiRouter } = runMiddleware(
      'POST',
      '/containers/abc123/triggers/docker/mydocker/agent1',
    );
    expect(next).toHaveBeenCalledOnce();
    expect(internalApiRouter).not.toHaveBeenCalled();
    res.json({ data: [1], total: 1 });
    expect(res.body).toEqual({ data: [1], total: 1 });
  });

  test('POST /containers/:id/watch (single-container rescan) is not whitelisted', () => {
    const { res, next, internalApiRouter } = runMiddleware('POST', '/containers/abc123/watch');
    expect(next).toHaveBeenCalledOnce();
    expect(internalApiRouter).not.toHaveBeenCalled();
    res.json({ data: [1], total: 1 });
    expect(res.body).toEqual({ data: [1], total: 1 });
  });

  test('non-whitelisted GET path passes through untouched (never dispatched to the internal apiRouter)', () => {
    const { res, next, internalApiRouter } = runMiddleware('GET', '/settings');
    expect(next).toHaveBeenCalledOnce();
    expect(internalApiRouter).not.toHaveBeenCalled();

    res.json({ data: [1], total: 1 });
    expect(res.body).toEqual({ data: [1], total: 1 });
  });

  test('POST /containers (wrong method for the GET list pattern) is not whitelisted', () => {
    const { res, next, internalApiRouter } = runMiddleware('POST', '/containers');
    expect(next).toHaveBeenCalledOnce();
    expect(internalApiRouter).not.toHaveBeenCalled();
    res.json({ data: [1], total: 1 });
    expect(res.body).toEqual({ data: [1], total: 1 });
  });

  test('GET /containers/watch (wrong method for the POST watch pattern) is not whitelisted', () => {
    const { res, next, internalApiRouter } = runMiddleware('GET', '/containers/watch');
    expect(next).toHaveBeenCalledOnce();
    expect(internalApiRouter).not.toHaveBeenCalled();
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
  test('mounts the compat middleware bound to the SAME apiRouter instance passed in, not a second/independent one', () => {
    const internalRouterStub = vi.fn();

    const router = init(internalRouterStub);

    // Real Express Router: a callable function with exactly one middleware
    // layer registered — the compat middleware bound to the internal
    // apiRouter instance we passed in.
    expect(typeof router).toBe('function');
    expect(router.stack).toHaveLength(1);

    // Dispatch a whitelisted request through the returned layer to prove the
    // mounted middleware is genuinely bound to the exact instance we passed
    // in (not some other/unbound/newly-constructed one).
    const req = createMockRequest({ method: 'GET', path: '/containers' });
    const res = createMockResponse();
    const next = vi.fn();
    router.stack[0].handle(req, res, next);
    expect(internalRouterStub).toHaveBeenCalledWith(req, res, next);
  });
});

describe('wud-card compat router shares rate limiting with /api/v1 (no independent budget)', () => {
  function buildRateLimitedInternalApiRouter(budget: { remaining: number }): express.Router {
    const router = express.Router();
    // Stand-in for the real apiLimiter (express-rate-limit) mounted inside
    // apiRouter.init() (app/api/api.ts) — a stateful middleware whose
    // consumed budget must be shared, not duplicated, between /api/v1 and
    // the wud-card compat mount.
    router.use((_req, res, next) => {
      if (budget.remaining <= 0) {
        res.status(429).json({ error: 'Too Many Requests' });
        return;
      }
      budget.remaining -= 1;
      next();
    });
    router.get('/containers', (_req, res) => {
      res.json({ data: [{ id: 'c1' }], total: 1 });
    });
    return router;
  }

  test('a request against a whitelisted compat route consumes the same limiter budget as /api/v1, exhausting it for both', async () => {
    const budget = { remaining: 2 };
    const sharedApiRouter = buildRateLimitedInternalApiRouter(budget);

    const app = express();
    // Mirrors index.ts: apiRouter.init() built exactly once...
    app.use('/api/v1', sharedApiRouter);
    // ...and that SAME instance handed to the compat router (init's new
    // parameter), instead of building a second, independent one.
    app.use('/api', init(sharedApiRouter));

    const { server, baseUrl } = await startServer(app);
    try {
      const v1Res = await fetch(`${baseUrl}/api/v1/containers`);
      expect(v1Res.status).toBe(200);

      const compatRes = await fetch(`${baseUrl}/api/containers`);
      expect(compatRes.status).toBe(200);
      expect(await compatRes.json()).toEqual([{ id: 'c1' }]);

      // The budget of 2 is now exhausted by one /api/v1 request plus one
      // compat-route request — proving both mounts draw from the exact same
      // limiter state instead of each getting an independent budget.
      const exhaustedRes = await fetch(`${baseUrl}/api/v1/containers`);
      expect(exhaustedRes.status).toBe(429);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});

describe('wud-card compat router topology (self-sufficiency without the deprecated /api alias)', () => {
  function buildStubInternalApiRouter(): express.Router {
    const router = express.Router();
    router.get('/containers', (_req, res) => {
      res.json({ data: [{ id: 'c1' }], total: 1, limit: 0, offset: 0, hasMore: false });
    });
    router.get('/containers/:id/triggers', (_req, res) => {
      res.json({ data: [{ id: 'docker.mydocker', type: 'docker', name: 'mydocker' }], total: 1 });
    });
    router.post('/containers/watch', (_req, res) => {
      res.json({ data: [{ id: 'c1' }], total: 1, limit: 0, offset: 0, hasMore: false });
    });
    router.post('/containers/:id/triggers/:type/:name', (_req, res) => {
      res.status(202).json({ operationId: 'op-1' });
    });
    router.use((_req, res) => {
      res.status(404).json({ error: 'Route not found' });
    });
    return router;
  }

  test('the 4 whitelisted endpoints keep working with no /api alias mounted, and a non-whitelisted /api route 404s as JSON, not the SPA', async () => {
    const app = express();
    app.use(express.json());
    // Compat router mounted alone at /api — deliberately no
    // app.use('/api', apiRouter.init()) alias mount behind it, simulating
    // the world after the deprecated alias is eventually removed.
    app.use('/api', init(buildStubInternalApiRouter()));
    // A generic API 404 (JSON), standing in for whatever the real
    // post-alias-removal API surface keeps for genuinely unmatched /api/*
    // routes — proving non-whitelisted requests still fall through past the
    // compat router rather than being swallowed by it.
    app.use('/api', (_req, res) => {
      res.status(404).json({ error: 'Route not found' });
    });
    // Stand-in SPA catch-all, mounted after /api, to prove non-whitelisted
    // /api requests never fall all the way through to it.
    app.get('/{*path}', (_req, res) => {
      res.type('html').send('<!doctype html><title>SPA</title>');
    });

    const { server, baseUrl } = await startServer(app);
    try {
      const containersRes = await fetch(`${baseUrl}/api/containers`);
      expect(containersRes.status).toBe(200);
      expect(await containersRes.json()).toEqual([{ id: 'c1' }]);

      const triggersRes = await fetch(`${baseUrl}/api/containers/abc123/triggers`);
      expect(triggersRes.status).toBe(200);
      expect(await triggersRes.json()).toEqual([
        { id: 'docker.mydocker', type: 'docker', name: 'mydocker' },
      ]);

      const watchRes = await fetch(`${baseUrl}/api/containers/watch`, { method: 'POST' });
      expect(watchRes.status).toBe(200);
      expect(await watchRes.json()).toEqual([{ id: 'c1' }]);

      const triggerRunRes = await fetch(
        `${baseUrl}/api/containers/abc123/triggers/docker/mydocker`,
        { method: 'POST' },
      );
      expect(triggerRunRes.status).toBe(202);
      expect(await triggerRunRes.json()).toEqual({ operationId: 'op-1' });

      const nonWhitelistedRes = await fetch(`${baseUrl}/api/settings`);
      expect(nonWhitelistedRes.status).toBe(404);
      expect(nonWhitelistedRes.headers.get('content-type')).toContain('application/json');
      expect(await nonWhitelistedRes.json()).toEqual({ error: 'Route not found' });
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
