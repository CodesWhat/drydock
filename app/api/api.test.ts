const {
  createMockRouter,
  mockInit,
  mockExpressJson,
  mockJsonMiddleware,
  mockRateLimit,
  mockRateLimitMiddleware,
  mockRouterCallLog,
  mockCreateOuterApiRateLimitKeyGenerator,
  mockIsIdentityAwareRateLimitKeyingEnabled,
  mockIsRequestAuthenticated,
  resetMockRouterCallLog,
} = vi.hoisted(() => {
  const jsonMiddleware = vi.fn();
  const outerApiRateLimitKeyGenerator = vi.fn(() => 'ip:127.0.0.1');
  const rateLimitMiddleware = vi.fn((_, __, next) => next());
  const mockRouterCallLog: Array<{ arg: unknown; type: 'get' | 'post' | 'use' }> = [];

  const createTrackedMethod = (type: 'get' | 'post' | 'use') =>
    vi.fn((...args: unknown[]) => {
      mockRouterCallLog.push({ type, arg: args[0] });
    });

  const createMockRouter = () => ({
    use: createTrackedMethod('use'),
    get: createTrackedMethod('get'),
    post: createTrackedMethod('post'),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    head: vi.fn(),
    options: vi.fn(),
    all: vi.fn(),
  });

  return {
    createMockRouter,
    mockInit: () => ({ init: vi.fn(() => createMockRouter()) }),
    mockJsonMiddleware: jsonMiddleware,
    mockExpressJson: vi.fn(() => jsonMiddleware),
    mockRateLimit: vi.fn(() => rateLimitMiddleware),
    mockRateLimitMiddleware: rateLimitMiddleware,
    mockRouterCallLog,
    mockCreateOuterApiRateLimitKeyGenerator: vi.fn(() => outerApiRateLimitKeyGenerator),
    mockIsIdentityAwareRateLimitKeyingEnabled: vi.fn(() => false),
    mockIsRequestAuthenticated: vi.fn(
      (req: { principal?: unknown }) => req.principal !== undefined,
    ),
    resetMockRouterCallLog: () => {
      mockRouterCallLog.length = 0;
    },
  };
});

vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => createMockRouter()),
    json: mockExpressJson,
  },
}));
vi.mock('express-rate-limit', () => ({
  default: mockRateLimit,
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
vi.mock('./preferences', mockInit);
vi.mock('./store', mockInit);
vi.mock('./debug', mockInit);
vi.mock('./server', mockInit);
vi.mock('./agent', mockInit);
vi.mock('./preview', mockInit);
vi.mock('./backup', mockInit);
vi.mock('./container-actions', mockInit);
vi.mock('./internal-self-update', mockInit);
vi.mock('./approvals', mockInit);
vi.mock('./audit', mockInit);
vi.mock('./webhook', mockInit);
vi.mock('./webhooks', mockInit);
vi.mock('./sse', mockInit);
vi.mock('./auth', () => ({
  requireAuthentication: vi.fn((req, res, next) => next()),
}));
vi.mock('./csrf', () => ({
  requireSameOriginForMutations: vi.fn((req, res, next) => next()),
}));
vi.mock('./outer-api-rate-limit-key.js', () => ({
  createOuterApiRateLimitKeyGenerator: mockCreateOuterApiRateLimitKeyGenerator,
}));
vi.mock('./rate-limit-key.js', () => ({
  getAuthenticatedRouteRateLimitKey: mockGetAuthenticatedRouteRateLimitKey,
  isIdentityAwareRateLimitKeyingEnabled: mockIsIdentityAwareRateLimitKeyingEnabled,
  isRequestAuthenticated: mockIsRequestAuthenticated,
}));

const mockGetAuthenticatedRouteRateLimitKey = vi.hoisted(() => vi.fn(() => 'ip:127.0.0.1'));
const mockGetExperimentalPortwingEnabled = vi.hoisted(() => vi.fn(() => false));
vi.mock('../configuration/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../configuration/index.js')>();
  return {
    ...actual,
    getExperimentalPortwingEnabled: mockGetExperimentalPortwingEnabled,
  };
});
vi.mock('./portwing', mockInit);

describe('API Router', () => {
  let api;
  let router;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetMockRouterCallLog();
    mockIsIdentityAwareRateLimitKeyingEnabled.mockReturnValue(false);
    mockGetExperimentalPortwingEnabled.mockReturnValue(false);
    vi.resetModules();
    api = await import('./api.js');
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
        c[0] !== csrf.requireSameOriginForMutations &&
        // Phase 11.1 mounts a second rate limiter, the per-API-key budget,
        // between requireAuthentication and the routers. Both limiters are the
        // same mock function, so they are excluded by identity here rather
        // than by position.
        c[0] !== mockRateLimitMiddleware
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

  test('should capture raw mutation request body in json verify hook', () => {
    const jsonOptions = mockExpressJson.mock.calls[0]?.[0];
    expect(jsonOptions).toBeDefined();
    expect(jsonOptions.limit).toBe('256kb');
    expect(typeof jsonOptions.verify).toBe('function');

    const req = {} as { rawBody?: Buffer };
    const body = Buffer.from('{"hello":"world"}');
    jsonOptions.verify(req, {}, body);

    expect(req.rawBody).toEqual(Buffer.from('{"hello":"world"}'));
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
        c[0] !== csrf.requireSameOriginForMutations &&
        // Phase 11.1 mounts a second rate limiter, the per-API-key budget,
        // between requireAuthentication and the routers. Both limiters are the
        // same mock function, so they are excluded by identity here rather
        // than by position.
        c[0] !== mockRateLimitMiddleware
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
    const { openApiDocument } = await import('./openapi.js');
    const getCalls = router.get.mock.calls;
    const openapiCall = getCalls.find((c) => c[0] === '/openapi.json');
    expect(openapiCall).toBeDefined();

    const openapiRouteIndex = mockRouterCallLog.findIndex(
      (entry) => entry.type === 'get' && entry.arg === '/openapi.json',
    );
    const authIndex = mockRouterCallLog.findIndex(
      (entry) => entry.type === 'use' && entry.arg === auth.requireAuthentication,
    );
    expect(authIndex).toBeGreaterThan(-1);
    expect(openapiRouteIndex).toBeGreaterThan(-1);
    expect(openapiRouteIndex).toBeLessThan(authIndex);

    const res = {
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    await openapiCall[1]({}, res);
    expect(res.type).toHaveBeenCalledWith('application/json');
    expect(res.send).toHaveBeenCalledWith(JSON.stringify(openApiDocument));
  });

  test('should lazy-load openapi document module when openapi endpoint is requested', async () => {
    vi.resetModules();
    const openApiModuleLoadSpy = vi.fn();
    const mockedOpenApiDocument = { openapi: '3.1.0' };
    vi.doMock('./openapi.js', () => {
      openApiModuleLoadSpy();
      return { openApiDocument: mockedOpenApiDocument };
    });

    try {
      const isolatedApi = await import('./api.js');
      const isolatedRouter = isolatedApi.init();
      const openapiCall = isolatedRouter.get.mock.calls.find((c) => c[0] === '/openapi.json');
      expect(openapiCall).toBeDefined();
      expect(openApiModuleLoadSpy).not.toHaveBeenCalled();

      const res = {
        type: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };
      await openapiCall[1]({}, res);
      expect(res.type).toHaveBeenCalledWith('application/json');
      expect(res.send).toHaveBeenCalledWith(JSON.stringify(mockedOpenApiDocument));
      expect(openApiModuleLoadSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('./openapi.js');
    }
  });

  test('should serve identical cached JSON string on repeated openapi.json requests', async () => {
    vi.resetModules();
    const openApiModuleLoadSpy = vi.fn();
    const mockedOpenApiDocument = { openapi: '3.1.0', info: { title: 'Test' } };
    vi.doMock('./openapi.js', () => {
      openApiModuleLoadSpy();
      return { openApiDocument: mockedOpenApiDocument };
    });

    try {
      const isolatedApi = await import('./api.js');
      const isolatedRouter = isolatedApi.init();
      const openapiCall = isolatedRouter.get.mock.calls.find((c) => c[0] === '/openapi.json');
      expect(openapiCall).toBeDefined();

      const makeRes = () => ({ type: vi.fn().mockReturnThis(), send: vi.fn() });
      const res1 = makeRes();
      const res2 = makeRes();

      await openapiCall[1]({}, res1);
      await openapiCall[1]({}, res2);

      // Module only loaded once (cache hit on second call)
      expect(openApiModuleLoadSpy).toHaveBeenCalledTimes(1);

      // Both responses receive the exact same serialized string
      const body1 = res1.send.mock.calls[0][0] as string;
      const body2 = res2.send.mock.calls[0][0] as string;
      expect(typeof body1).toBe('string');
      expect(body1).toBe(body2);
      expect(body1.length).toBe(body2.length);
    } finally {
      vi.doUnmock('./openapi.js');
    }
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
    const preferencesRouter = await import('./preferences.js');
    const storeRouter = await import('./store.js');
    const debugRouter = await import('./debug.js');
    const serverRouter = await import('./server.js');
    const agentRouter = await import('./agent.js');
    const previewRouter = await import('./preview.js');
    const backupRouter = await import('./backup.js');
    const containerActionsRouter = await import('./container-actions.js');
    const internalSelfUpdateRouter = await import('./internal-self-update.js');
    const approvalsRouter = await import('./approvals.js');
    const auditRouter = await import('./audit.js');
    const webhookRouter = await import('./webhook.js');
    const webhooksRouter = await import('./webhooks.js');
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
    expect(preferencesRouter.init).toHaveBeenCalled();
    expect(storeRouter.init).toHaveBeenCalled();
    expect(debugRouter.init).toHaveBeenCalled();
    expect(serverRouter.init).toHaveBeenCalled();
    expect(agentRouter.init).toHaveBeenCalled();
    expect(previewRouter.init).toHaveBeenCalled();
    expect(backupRouter.init).toHaveBeenCalled();
    expect(containerActionsRouter.init).toHaveBeenCalled();
    expect(internalSelfUpdateRouter.init).toHaveBeenCalled();
    expect(approvalsRouter.init).toHaveBeenCalled();
    expect(auditRouter.init).toHaveBeenCalled();
    expect(webhookRouter.init).toHaveBeenCalled();
    expect(webhooksRouter.init).toHaveBeenCalled();
  });

  test('should mount backup routes before generic container id routes', async () => {
    const backupRouter = await import('./backup.js');
    const containerRouter = await import('./container.js');
    const backupRouterInstance = vi.mocked(backupRouter.init).mock.results[0]?.value;
    const containerRouterInstance = vi.mocked(containerRouter.init).mock.results[0]?.value;
    const useCalls = router.use.mock.calls;

    const backupIndex = useCalls.findIndex(
      (call) => call[0] === '/containers' && call[1] === backupRouterInstance,
    );
    const containerIndex = useCalls.findIndex(
      (call) => call[0] === '/containers' && call[1] === containerRouterInstance,
    );

    expect(backupIndex).toBeGreaterThan(-1);
    expect(containerIndex).toBeGreaterThan(-1);
    expect(backupIndex).toBeLessThan(containerIndex);
  });

  test('should use requireAuthentication middleware', async () => {
    const auth = await import('./auth.js');
    expect(router.use).toHaveBeenCalledWith(auth.requireAuthentication);
  });

  test('should mount /app after requireAuthentication middleware', async () => {
    const auth = await import('./auth.js');
    const useCalls = router.use.mock.calls;

    const authIndex = useCalls.findIndex((c) => c[0] === auth.requireAuthentication);
    const appIndex = useCalls.findIndex((c) => c[0] === '/app');

    expect(authIndex).toBeGreaterThan(-1);
    expect(appIndex).toBeGreaterThan(-1);
    expect(appIndex).toBeGreaterThan(authIndex);
  });

  test('should mount internal self-update routes before requireAuthentication middleware', async () => {
    const auth = await import('./auth.js');
    const useCalls = router.use.mock.calls;

    const internalIndex = useCalls.findIndex((c) => c[0] === '/internal');
    const authIndex = useCalls.findIndex((c) => c[0] === auth.requireAuthentication);

    expect(internalIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeGreaterThan(-1);
    expect(internalIndex).toBeLessThan(authIndex);
  });

  test('should mount the webhook routers before requireAuthentication middleware', async () => {
    // The webhook routers carry their own bearer scheme. Mounting them ahead of
    // the chain is what keeps the API key authenticator out of their path, so a
    // webhook token is never offered to it and never has to survive it.
    const auth = await import('./auth.js');
    const useCalls = router.use.mock.calls;

    const authIndex = useCalls.findIndex((c) => c[0] === auth.requireAuthentication);
    const webhookIndex = useCalls.findIndex((c) => c[0] === '/webhook');
    const webhooksIndex = useCalls.findIndex((c) => c[0] === '/webhooks');

    expect(authIndex).toBeGreaterThan(-1);
    expect(webhookIndex).toBeGreaterThan(-1);
    expect(webhooksIndex).toBeGreaterThan(-1);
    expect(webhookIndex).toBeLessThan(authIndex);
    expect(webhooksIndex).toBeLessThan(authIndex);
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
    expect(res.json).toHaveBeenCalledWith({
      error: 'Route not found',
    });
  });

  test.each([
    ['identity keying is off', false],
    ['identity keying is on', true],
  ])('keys the outer API limiter by presented key even when %s', async (_label, enabled) => {
    // Unconditional, unlike the identity-aware generator it replaced: with the
    // flag off the outer limiter was purely IP-keyed, so every integration
    // behind one reverse proxy shared its budget.
    const keyGenerator = vi.fn(() => 'ip:198.51.100.7');
    mockIsIdentityAwareRateLimitKeyingEnabled.mockReturnValue(enabled);
    mockCreateOuterApiRateLimitKeyGenerator.mockReturnValue(keyGenerator);

    vi.resetModules();
    const isolatedApi = await import('./api.js');
    isolatedApi.init();

    expect(mockCreateOuterApiRateLimitKeyGenerator).toHaveBeenCalledWith(enabled);
    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        keyGenerator,
      }),
    );
  });

  test('should retain the secure default outer API request budget', () => {
    expect(mockRateLimit.mock.calls[0]?.[0]).toMatchObject({
      max: 1000,
      windowMs: 15 * 60 * 1000,
    });
  });

  test('should use the configured outer API rate-limit maximum', async () => {
    const configuration = await import('../configuration/index.js');
    configuration.ddEnvVars.DD_SERVER_RATELIMIT_MAX = '10000';
    try {
      // The outer limiter is built first and the per-key limiter after it, so
      // the assertion names the call rather than taking the last one.
      mockRateLimit.mockClear();
      api.init();
      expect(mockRateLimit).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          max: 10000,
        }),
      );
    } finally {
      delete configuration.ddEnvVars.DD_SERVER_RATELIMIT_MAX;
    }
  });

  test('should exempt only valid icon reads from the outer API rate limiter', async () => {
    const limiterOptions = mockRateLimit.mock.calls[0]?.[0];
    expect(limiterOptions).toBeDefined();
    expect(typeof limiterOptions.skip).toBe('function');

    const authenticated = { principal: { kind: 'basic', username: 'alice' } };
    const unauthenticated = { principal: undefined };

    expect(
      await limiterOptions.skip({ ...authenticated, method: 'GET', path: '/icons/selfhst/docker' }),
    ).toBe(true);
    expect(
      await limiterOptions.skip({
        ...authenticated,
        method: 'HEAD',
        path: '/icons/selfhst/docker/',
      }),
    ).toBe(true);
    expect(
      await limiterOptions.skip({
        ...unauthenticated,
        method: 'GET',
        path: '/icons/selfhst/docker',
      }),
    ).toBe(false);
    expect(await limiterOptions.skip({ method: 'GET', path: '/icons/selfhst/docker' })).toBe(false);
    expect(
      await limiterOptions.skip({ ...authenticated, method: 'DELETE', path: '/icons/cache' }),
    ).toBe(false);
    expect(
      await limiterOptions.skip({ ...authenticated, method: 'GET', path: '/containers' }),
    ).toBe(false);
    expect(
      await limiterOptions.skip({
        ...authenticated,
        method: 'GET',
        path: '/icons/selfhst/docker/extra',
      }),
    ).toBe(false);
    expect(await limiterOptions.skip({ ...authenticated, method: 'GET', path: '/icons' })).toBe(
      false,
    );
  });

  describe('the per-key rate limiter', () => {
    // The outer IP limiter is built first and this one second, so the index is
    // the identity of the limiter under test, not an arbitrary pick.
    function perKeyOptions() {
      return mockRateLimit.mock.calls[1]?.[0];
    }

    const apiKeyRequest = (rateLimitMax?: number) => ({
      principal: { kind: 'api-key', keyId: 'abcdef012345', name: 'ci', rateLimitMax },
    });

    test('is registered after the outer one', () => {
      expect(mockRateLimit).toHaveBeenCalledTimes(2);
      expect(perKeyOptions()).toMatchObject({
        windowMs: 15 * 60 * 1000,
        requestPropertyName: 'apiKeyRateLimit',
      });
    });

    test('spends the per-key ceiling when the key carries one', () => {
      expect(perKeyOptions().limit(apiKeyRequest(25))).toBe(25);
    });

    test('falls back to the server-wide maximum when the key carries none', () => {
      expect(perKeyOptions().limit(apiKeyRequest())).toBe(1000);
    });

    test('leaves a non-key principal on the server-wide maximum', () => {
      expect(perKeyOptions().limit({ principal: { kind: 'basic', username: 'alice' } })).toBe(1000);
    });

    test('skips every principal that is not a key, including none at all', () => {
      expect(perKeyOptions().skip(apiKeyRequest())).toBe(false);
      expect(perKeyOptions().skip({ principal: { kind: 'session', username: 'alice' } })).toBe(
        true,
      );
      expect(perKeyOptions().skip({})).toBe(true);
    });

    test('buckets on the key rather than the client IP, whatever the keying flag says', () => {
      // Unconditional by design: with DD_SERVER_RATELIMIT_IDENTITYKEYING off,
      // IP keying would put every integration behind one reverse proxy in the
      // same bucket, which is the deployment this limiter exists for.
      // A sentinel rather than a realistic `apikey:<keyId>` bucket name: what
      // this test owns is that the limiter delegates to the shared generator,
      // and a credential-shaped literal here trips the repository's own secret
      // scan. The real bucket format is pinned in rate-limit-key.test.ts.
      const bucket = 'bucket-from-the-shared-generator';
      mockGetAuthenticatedRouteRateLimitKey.mockReturnValue(bucket);

      expect(perKeyOptions().keyGenerator(apiKeyRequest())).toBe(bucket);
      expect(mockIsIdentityAwareRateLimitKeyingEnabled).toHaveReturnedWith(false);
    });
  });

  test('should mount only /portwing router when DD_EXPERIMENTAL_PORTWING is enabled', async () => {
    mockGetExperimentalPortwingEnabled.mockReturnValue(true);

    vi.resetModules();
    const isolatedApi = await import('./api.js');
    const isolatedRouter = isolatedApi.init();

    const useCalls = isolatedRouter.use.mock.calls;
    const portwingMount = useCalls.find((c) => c[0] === '/portwing');
    expect(portwingMount).toBeDefined();
  });

  test('should not mount /portwing router when DD_EXPERIMENTAL_PORTWING is disabled', async () => {
    mockGetExperimentalPortwingEnabled.mockReturnValue(false);

    vi.resetModules();
    const isolatedApi = await import('./api.js');
    const isolatedRouter = isolatedApi.init();

    const useCalls = isolatedRouter.use.mock.calls;
    const portwingMount = useCalls.find((c) => c[0] === '/portwing');
    expect(portwingMount).toBeUndefined();
  });
});
