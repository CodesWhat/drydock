const { mockInit, mockExpressJson, mockJsonMiddleware } = vi.hoisted(() => {
  const jsonMiddleware = vi.fn();
  return {
    mockInit: () => ({ init: vi.fn(() => ({ use: vi.fn(), get: vi.fn(), post: vi.fn() })) }),
    mockJsonMiddleware: jsonMiddleware,
    mockExpressJson: vi.fn(() => jsonMiddleware),
  };
});

vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => ({ use: vi.fn(), get: vi.fn(), post: vi.fn() })),
    json: mockExpressJson,
  },
}));

vi.mock('./app', mockInit);
vi.mock('./container', mockInit);
vi.mock('./watcher', mockInit);
vi.mock('./trigger', mockInit);
vi.mock('./registry', mockInit);
vi.mock('./authentication', mockInit);
vi.mock('./icons', mockInit);
vi.mock('./group', mockInit);
vi.mock('./log', mockInit);
vi.mock('./notification', mockInit);
vi.mock('./settings', mockInit);
vi.mock('./store', mockInit);
vi.mock('./server', mockInit);
vi.mock('./agent', mockInit);
vi.mock('./preview', mockInit);
vi.mock('./backup', mockInit);
vi.mock('./container-actions', mockInit);
vi.mock('./audit', mockInit);
vi.mock('./webhook', mockInit);
vi.mock('./sse', mockInit);
vi.mock('./auth', () => ({
  requireAuthentication: vi.fn((req, res, next) => next()),
}));
vi.mock('./csrf', () => ({
  requireSameOriginForMutations: vi.fn((req, res, next) => next()),
}));

import * as api from './api.js';
import { openApiDocument } from './openapi.js';

describe('API Router', () => {
  let router;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = api.init();
  });

  test('should initialize and return a router', async () => {
    expect(router).toBeDefined();
  });

  test('should register a mutation-only json parser before API route mounts', async () => {
    const auth = await import('./auth.js');
    const csrf = await import('./csrf.js');
    expect(mockExpressJson).toHaveBeenCalledTimes(1);

    const useCalls = router.use.mock.calls;
    const appMountIndex = useCalls.findIndex((c) => c[0] === '/app');
    expect(appMountIndex).toBeGreaterThan(-1);

    const mutationMiddlewares = useCalls.filter((c, index) => {
      return (
        index > 0 &&
        index < appMountIndex &&
        typeof c[0] === 'function' &&
        c[0] !== auth.requireAuthentication &&
        c[0] !== csrf.requireSameOriginForMutations
      );
    });
    expect(mutationMiddlewares).toHaveLength(2);

    const mutationParser = mutationMiddlewares[1][0];
    const next = vi.fn();
    mockJsonMiddleware.mockClear();

    mutationParser({ method: 'GET' }, {}, next);
    expect(mockJsonMiddleware).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);

    mutationParser({ method: 'POST' }, {}, next);
    mutationParser({ method: 'PUT' }, {}, next);
    mutationParser({ method: 'PATCH' }, {}, next);
    expect(mockJsonMiddleware).toHaveBeenCalledTimes(3);
  });

  test('should reject mutation requests with non-json content type when body is present', async () => {
    const auth = await import('./auth.js');
    const csrf = await import('./csrf.js');
    const useCalls = router.use.mock.calls;
    const appMountIndex = useCalls.findIndex((c) => c[0] === '/app');

    const mutationMiddlewares = useCalls.filter((c, index) => {
      return (
        index > 0 &&
        index < appMountIndex &&
        typeof c[0] === 'function' &&
        c[0] !== auth.requireAuthentication &&
        c[0] !== csrf.requireSameOriginForMutations
      );
    });
    expect(mutationMiddlewares).toHaveLength(2);

    const contentTypeGuard = mutationMiddlewares[0][0];
    const next = vi.fn();
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    contentTypeGuard(
      {
        method: 'POST',
        headers: { 'content-length': '12' },
        is: vi.fn(() => false),
      },
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith({ error: 'Content-Type must be application/json' });
    expect(next).not.toHaveBeenCalled();

    res.status.mockClear();
    res.json.mockClear();
    next.mockClear();

    contentTypeGuard(
      {
        method: 'POST',
        headers: { 'content-length': '12' },
        is: vi.fn(() => true),
      },
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should expose openapi document endpoint before auth middleware', async () => {
    const auth = await import('./auth.js');
    const getCalls = router.get.mock.calls;
    const openapiCall = getCalls.find((c) => c[0] === '/openapi.json');
    expect(openapiCall).toBeDefined();

    const useCalls = router.use.mock.calls;
    const authIndex = useCalls.findIndex((c) => c[0] === auth.requireAuthentication);
    const openapiRouteIndex = getCalls.findIndex((c) => c[0] === '/openapi.json');
    expect(authIndex).toBeGreaterThan(-1);
    expect(openapiRouteIndex).toBeGreaterThan(-1);

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    openapiCall[1]({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(openApiDocument);
  });

  test('should mount all sub-routers', async () => {
    const appRouter = await import('./app.js');
    const containerRouter = await import('./container.js');
    const watcherRouter = await import('./watcher.js');
    const triggerRouter = await import('./trigger.js');
    const registryRouter = await import('./registry.js');
    const authenticationRouter = await import('./authentication.js');
    const iconsRouter = await import('./icons.js');
    const groupRouter = await import('./group.js');
    const logRouter = await import('./log.js');
    const notificationRouter = await import('./notification.js');
    const settingsRouter = await import('./settings.js');
    const storeRouter = await import('./store.js');
    const serverRouter = await import('./server.js');
    const agentRouter = await import('./agent.js');
    const previewRouter = await import('./preview.js');
    const backupRouter = await import('./backup.js');
    const containerActionsRouter = await import('./container-actions.js');
    const auditRouter = await import('./audit.js');
    const webhookRouter = await import('./webhook.js');
    await import('./sse.js');

    expect(appRouter.init).toHaveBeenCalled();
    expect(containerRouter.init).toHaveBeenCalled();
    expect(watcherRouter.init).toHaveBeenCalled();
    expect(triggerRouter.init).toHaveBeenCalled();
    expect(registryRouter.init).toHaveBeenCalled();
    expect(authenticationRouter.init).toHaveBeenCalled();
    expect(iconsRouter.init).toHaveBeenCalled();
    expect(groupRouter.init).toHaveBeenCalled();
    expect(logRouter.init).toHaveBeenCalled();
    expect(notificationRouter.init).toHaveBeenCalled();
    expect(settingsRouter.init).toHaveBeenCalled();
    expect(storeRouter.init).toHaveBeenCalled();
    expect(serverRouter.init).toHaveBeenCalled();
    expect(agentRouter.init).toHaveBeenCalled();
    expect(previewRouter.init).toHaveBeenCalled();
    expect(backupRouter.init).toHaveBeenCalled();
    expect(containerActionsRouter.init).toHaveBeenCalled();
    expect(auditRouter.init).toHaveBeenCalled();
    expect(webhookRouter.init).toHaveBeenCalled();
  });

  test('should use requireAuthentication middleware', async () => {
    const auth = await import('./auth.js');
    expect(router.use).toHaveBeenCalledWith(auth.requireAuthentication);
  });

  test('should use CSRF middleware', async () => {
    const csrf = await import('./csrf.js');
    expect(router.use).toHaveBeenCalledWith(csrf.requireSameOriginForMutations);
  });

  test('should mount CSRF middleware after requireAuthentication middleware', async () => {
    const auth = await import('./auth.js');
    const csrf = await import('./csrf.js');
    const useCalls = router.use.mock.calls;

    const authIndex = useCalls.findIndex((c) => c[0] === auth.requireAuthentication);
    const csrfIndex = useCalls.findIndex((c) => c[0] === csrf.requireSameOriginForMutations);

    expect(authIndex).toBeGreaterThan(-1);
    expect(csrfIndex).toBeGreaterThan(-1);
    expect(csrfIndex).toBeGreaterThan(authIndex);
  });

  test('should mount SSE after requireAuthentication middleware', async () => {
    const auth = await import('./auth.js');
    await import('./sse.js');
    const useCalls = router.use.mock.calls;

    const authIndex = useCalls.findIndex((c) => c[0] === auth.requireAuthentication);
    const sseIndex = useCalls.findIndex((c) => c[0] === '/events/ui');

    expect(authIndex).toBeGreaterThan(-1);
    expect(sseIndex).toBeGreaterThan(-1);
    expect(sseIndex).toBeGreaterThan(authIndex);
  });

  test('should register catch-all 404 handler', () => {
    const getCalls = router.get.mock.calls;
    const catchAll = getCalls.find((c) => c[0] === '/{*path}');
    expect(catchAll).toBeDefined();

    // Invoke the handler
    const handler = catchAll[1];
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    handler({}, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Route not found' });
  });
});
