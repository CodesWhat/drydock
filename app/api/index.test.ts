const { mockApp, mockFs, mockHttps, mockGetServerConfiguration, mockHttpServer, mockHttpsServer } =
  vi.hoisted(() => {
    const mockHttpServer = {
      on: vi.fn(),
    };
    const mockHttpsServer = {
      on: vi.fn(),
      listen: vi.fn((port, cb) => cb()),
    };
    return {
      mockApp: {
        disable: vi.fn(),
        set: vi.fn(),
        use: vi.fn(),
        listen: vi.fn((port, cb) => {
          cb();
          return mockHttpServer;
        }),
      },
      mockFs: {
        readFileSync: vi.fn(),
      },
      mockHttpServer,
      mockHttpsServer,
      mockHttps: {
        createServer: vi.fn(() => mockHttpsServer),
      },
      mockGetServerConfiguration: vi.fn(() => ({
        enabled: true,
        port: 3000,
        cors: {},
        tls: {},
      })),
    };
  });
const mockLog = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
const mockDdEnvVars = vi.hoisted(() => ({}) as Record<string, string | undefined>);
const mockHelmet = vi.hoisted(() => vi.fn(() => 'helmet-middleware'));
const mockIsInternetlessModeEnabled = vi.hoisted(() => vi.fn(() => false));
const mockGetSessionMiddleware = vi.hoisted(() => vi.fn(() => vi.fn()));
const mockAttachContainerLogStreamWebSocketServer = vi.hoisted(() => vi.fn());
const mockAttachSystemLogStreamWebSocketServer = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  default: mockFs,
}));

vi.mock('node:https', () => ({
  default: mockHttps,
}));

vi.mock('express', () => ({
  default: Object.assign(
    vi.fn(() => mockApp),
    {
      json: vi.fn(() => 'json-middleware'),
    },
  ),
}));

vi.mock('cors', () => ({
  default: vi.fn(() => 'cors-middleware'),
}));

vi.mock('compression', () => {
  const compression = vi.fn(() => 'compression-middleware');
  compression.filter = vi.fn(() => true);
  return { default: compression };
});

vi.mock('helmet', () => ({
  default: mockHelmet,
}));

vi.mock('../log', () => ({
  default: {
    child: vi.fn(() => mockLog),
  },
}));

vi.mock('./auth', () => ({
  init: vi.fn(),
  getSessionMiddleware: mockGetSessionMiddleware,
}));

vi.mock('./api', () => ({
  init: vi.fn(() => 'api-router'),
}));

vi.mock('./ui', () => ({
  init: vi.fn(() => 'ui-router'),
}));

vi.mock('./prometheus', () => ({
  init: vi.fn(() => 'prometheus-router'),
}));

vi.mock('./health', () => ({
  init: vi.fn(() => 'health-router'),
}));

vi.mock('./container/log-stream', () => ({
  attachContainerLogStreamWebSocketServer: mockAttachContainerLogStreamWebSocketServer,
}));

vi.mock('./log-stream', () => ({
  attachSystemLogStreamWebSocketServer: mockAttachSystemLogStreamWebSocketServer,
}));

vi.mock('../configuration', () => ({
  getServerConfiguration: mockGetServerConfiguration,
  ddEnvVars: mockDdEnvVars,
}));

vi.mock('../store/settings', () => ({
  isInternetlessModeEnabled: mockIsInternetlessModeEnabled,
}));

// The index module reads configuration at module level, so we must
// re-import after setting the desired mock return value.
describe('API Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.disable.mockClear();
    mockApp.set.mockClear();
    mockApp.use.mockClear();
    mockApp.listen.mockClear();
    mockHttpServer.on.mockClear();
    mockHttpsServer.listen.mockClear();
    mockHttpsServer.on.mockClear();
    mockHelmet.mockClear();
    mockIsInternetlessModeEnabled.mockReturnValue(false);
    mockGetSessionMiddleware.mockReset();
    mockGetSessionMiddleware.mockReturnValue(vi.fn());
    mockAttachContainerLogStreamWebSocketServer.mockClear();
    mockAttachSystemLogStreamWebSocketServer.mockClear();
    Object.keys(mockDdEnvVars).forEach((key) => delete mockDdEnvVars[key]);
  });

  test('should not start server when disabled', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: false,
      port: 3000,
      cors: {},
      tls: {},
    });

    // Re-import to pick up the new configuration
    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    // auth.init should not have been called since server is disabled
    // We need to check the freshly imported auth mock
    const freshAuth = await import('./auth.js');
    expect(freshAuth.init).not.toHaveBeenCalled();
  });

  test('should start HTTP server when enabled', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
    expect(mockAttachContainerLogStreamWebSocketServer).toHaveBeenCalledWith({
      server: mockHttpServer,
      sessionMiddleware: expect.any(Function),
      serverConfiguration: expect.objectContaining({ enabled: true }),
      isRateLimited: expect.any(Function),
    });
    expect(mockAttachSystemLogStreamWebSocketServer).toHaveBeenCalledWith({
      server: mockHttpServer,
      sessionMiddleware: expect.any(Function),
      serverConfiguration: expect.objectContaining({ enabled: true }),
      isRateLimited: expect.any(Function),
    });
  });

  test('should share a single rate limiter across both WebSocket log stream gateways', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    const containerIsRateLimited =
      mockAttachContainerLogStreamWebSocketServer.mock.calls[0][0].isRateLimited;
    const systemIsRateLimited =
      mockAttachSystemLogStreamWebSocketServer.mock.calls[0][0].isRateLimited;
    expect(containerIsRateLimited).toBe(systemIsRateLimited);
  });

  test('isRateLimited callback should execute and report allowed traffic for a fresh key', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    const isRateLimited =
      mockAttachContainerLogStreamWebSocketServer.mock.calls[0][0].isRateLimited;
    expect(isRateLimited('127.0.0.1')).toBe(false);
  });

  test('should start HTTP server when TLS is explicitly disabled', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: { enabled: false },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
    expect(mockHttps.createServer).not.toHaveBeenCalled();
  });

  test('should not start HTTPS server when tls.enabled is truthy but not boolean true', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {
        enabled: 'true' as unknown as boolean,
        key: '/path/to/key',
        cert: '/path/to/cert',
      },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
    expect(mockFs.readFileSync).not.toHaveBeenCalled();
    expect(mockHttps.createServer).not.toHaveBeenCalled();
  });

  test('should enable CORS when configured', async () => {
    mockDdEnvVars.DD_SERVER_CORS_ORIGIN = 'https://example.com';
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {
        enabled: true,
        origin: 'https://example.com',
        methods: 'GET,POST',
      },
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.use).toHaveBeenCalledWith('cors-middleware');
  });

  test('should throw when CORS is enabled without DD_SERVER_CORS_ORIGIN', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {
        enabled: true,
        origin: '*',
        methods: 'GET,POST',
      },
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await expect(indexRouter.init()).rejects.toThrow(
      'DD_SERVER_CORS_ORIGIN must be configured when CORS is enabled',
    );
    expect(mockApp.use).not.toHaveBeenCalledWith('cors-middleware');
  });

  test('should allow explicit wildcard CORS origin only when DD_SERVER_CORS_ORIGIN is set', async () => {
    mockDdEnvVars.DD_SERVER_CORS_ORIGIN = '*';
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {
        enabled: true,
        origin: '*',
        methods: 'GET,POST',
      },
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.use).toHaveBeenCalledWith('cors-middleware');
  });

  test('should allow explicit trusted CORS origin when DD_SERVER_CORS_ORIGIN is set', async () => {
    mockDdEnvVars.DD_SERVER_CORS_ORIGIN = 'https://example.com';
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {
        enabled: true,
        origin: 'https://example.com',
        methods: 'GET,POST',
      },
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.use).toHaveBeenCalledWith('cors-middleware');
  });

  test('should warn about deprecated unversioned /api/* path at startup', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: { enabled: false },
      tls: { enabled: false },
      compression: { enabled: false },
      trustproxy: false,
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockLog.warn).toHaveBeenCalledWith(
      'Unversioned /api/* path is deprecated and will be removed in v1.6.0. Use /api/v1/* instead.',
    );
  });

  test('should mount all routers', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.use).toHaveBeenCalledWith('/health', 'health-router');
    expect(mockApp.use).toHaveBeenCalledWith('/api/v1', 'api-router');
    expect(mockApp.use).toHaveBeenCalledWith('/api', 'api-router');
    expect(mockApp.use).toHaveBeenCalledWith('/metrics', 'prometheus-router');
    expect(mockApp.use).toHaveBeenCalledWith('/', 'ui-router');
  });

  test('should skip mounting UI router when DD_SERVER_UI_ENABLED=false', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      ui: { enabled: false },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.use).toHaveBeenCalledWith('/health', 'health-router');
    expect(mockApp.use).toHaveBeenCalledWith('/api/v1', 'api-router');
    expect(mockApp.use).toHaveBeenCalledWith('/api', 'api-router');
    expect(mockApp.use).toHaveBeenCalledWith('/metrics', 'prometheus-router');
    expect(mockApp.use).not.toHaveBeenCalledWith('/', 'ui-router');
  });

  test('should not mount legacy error-response normalization middleware', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    const functionMiddlewareNames = mockApp.use.mock.calls
      .filter((call) => typeof call[0] === 'function')
      .map((call) => call[0].name);
    expect(functionMiddlewareNames).not.toContain('normalizeErrorResponsePayload');
  });

  test('should enable helmet security headers with CSP allowing Iconify CDN', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockHelmet).toHaveBeenCalledWith({
      strictTransportSecurity: false,
      crossOriginEmbedderPolicy: { policy: 'require-corp' },
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'style-src-attr': ["'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': [
            "'self'",
            'https://api.iconify.design',
            'https://api.simplesvg.com',
            'https://api.unisvg.com',
          ],
          'upgrade-insecure-requests': null,
        },
      },
    });
    expect(mockApp.use).toHaveBeenCalledWith('helmet-middleware');
  });

  test('should not allow Iconify CDN in CSP connect-src when internetless mode is enabled', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });
    mockIsInternetlessModeEnabled.mockReturnValue(true);

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockHelmet).toHaveBeenCalledWith({
      strictTransportSecurity: false,
      crossOriginEmbedderPolicy: { policy: 'require-corp' },
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'style-src-attr': ["'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'upgrade-insecure-requests': null,
        },
      },
    });
  });

  test('should enable HSTS and upgrade-insecure-requests when TLS is enabled', async () => {
    mockFs.readFileSync.mockReturnValueOnce('key-content').mockReturnValueOnce('cert-content');
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: { enabled: true, key: '/path/to/key', cert: '/path/to/cert' },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockHelmet).toHaveBeenCalledWith({
      strictTransportSecurity: true,
      crossOriginEmbedderPolicy: { policy: 'require-corp' },
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'style-src-attr': ["'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': [
            "'self'",
            'https://api.iconify.design',
            'https://api.simplesvg.com',
            'https://api.unisvg.com',
          ],
          'upgrade-insecure-requests': [],
        },
      },
    });
  });

  test('should enable compression by default', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      compression: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.use).toHaveBeenCalledWith('compression-middleware');
  });

  test('compression filter should skip SSE routes and defer to default filter otherwise', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      compression: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    const compressionModule = await import('compression');
    await indexRouter.init();

    const compressionOptions = compressionModule.default.mock.calls[0][0];
    expect(compressionOptions.filter({ path: '/api/events/stream', headers: {} }, {})).toBe(false);
    expect(compressionOptions.filter({ path: '/api/v1/events/stream', headers: {} }, {})).toBe(
      false,
    );
    expect(compressionOptions.filter({ path: '/events/ui', headers: {} }, {})).toBe(false);
    expect(
      compressionOptions.filter(
        { path: '/api/containers', headers: { accept: 'text/event-stream' } },
        {},
      ),
    ).toBe(false);
    expect(compressionOptions.filter({ path: '/api/containers', headers: {} }, {})).toBe(true);
    expect(compressionModule.default.filter).toHaveBeenCalledWith(
      { path: '/api/containers', headers: {} },
      {},
    );
  });

  test('should disable compression when configured', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      compression: { enabled: false },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    const compressionCall = mockApp.use.mock.calls.find((c) => c[0] === 'compression-middleware');
    expect(compressionCall).toBeUndefined();
  });

  test('should not register a global json parser middleware', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.use).not.toHaveBeenCalledWith('json-middleware');
  });

  test('should register helmet middleware before auth init', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    const freshAuth = await import('./auth.js');
    await indexRouter.init();

    const helmetCallIndex = mockApp.use.mock.calls.findIndex((c) => c[0] === 'helmet-middleware');
    expect(helmetCallIndex).toBeGreaterThanOrEqual(0);

    const helmetCallOrder = mockApp.use.mock.invocationCallOrder[helmetCallIndex];
    const authInitCallOrder = freshAuth.init.mock.invocationCallOrder[0];
    expect(helmetCallOrder).toBeLessThan(authInitCallOrder);
  });

  test('should set Permissions-Policy header via custom middleware', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    // Find the middleware function that sets Permissions-Policy
    const permissionsPolicyMiddleware = mockApp.use.mock.calls
      .filter((call) => typeof call[0] === 'function' && call[0].length === 3)
      .map((call) => call[0])
      .find((fn) => {
        const mockRes = { setHeader: vi.fn() };
        fn({}, mockRes, vi.fn());
        return mockRes.setHeader.mock.calls.some((c) => c[0] === 'Permissions-Policy');
      });

    expect(permissionsPolicyMiddleware).toBeDefined();

    const mockRes = { setHeader: vi.fn() };
    const mockNext = vi.fn();
    permissionsPolicyMiddleware({}, mockRes, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
    );
    expect(mockNext).toHaveBeenCalled();
  });

  test('should not set trust proxy when default (false)', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      trustproxy: false,
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.set).not.toHaveBeenCalledWith('trust proxy', expect.anything());
    expect(mockApp.set).toHaveBeenCalledWith('json replacer', expect.any(Function));
  });

  test('should set trust proxy when configured as hop count', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      trustproxy: 1,
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.set).toHaveBeenCalledWith('trust proxy', 1);
  });

  test('should set trust proxy when configured as true', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      trustproxy: true,
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.set).toHaveBeenCalledWith('trust proxy', true);
  });

  test('should set json replacer', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      trustproxy: false,
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.set).toHaveBeenCalledWith('json replacer', expect.any(Function));

    // Test the json replacer function
    const replacerCall = mockApp.set.mock.calls.find((c) => c[0] === 'json replacer');
    const replacer = replacerCall[1];
    expect(replacer('key', undefined)).toBeNull();
    expect(replacer('key', 'value')).toBe('value');
    expect(replacer('key', 0)).toBe(0);
  });

  test('should start HTTPS server when TLS enabled', async () => {
    mockFs.readFileSync.mockReturnValueOnce('key-content').mockReturnValueOnce('cert-content');
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {
        enabled: true,
        key: '/path/to/key',
        cert: '/path/to/cert',
      },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockFs.readFileSync).toHaveBeenCalledWith('/path/to/key');
    expect(mockFs.readFileSync).toHaveBeenCalledWith('/path/to/cert');
    expect(mockHttps.createServer).toHaveBeenCalledWith(
      { key: 'key-content', cert: 'cert-content' },
      mockApp,
    );
  });

  test('should throw when TLS key file cannot be read', async () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('File not found');
    });
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {
        enabled: true,
        key: '/bad/path',
        cert: '/path/to/cert',
      },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await expect(indexRouter.init()).rejects.toThrow('File not found');
  });

  test('should throw when TLS cert file cannot be read', async () => {
    mockFs.readFileSync.mockReturnValueOnce('key-content').mockImplementationOnce(() => {
      throw new Error('Cert not found');
    });
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {
        enabled: true,
        key: '/path/to/key',
        cert: '/bad/cert',
      },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await expect(indexRouter.init()).rejects.toThrow('Cert not found');
  });

  test('global error handler should use err.status and keep message generic', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    await import('./index.js').then((m) => m.init());

    const errorHandler = mockApp.use.mock.calls.find(
      (call) => typeof call[0] === 'function' && call[0].length === 4,
    )?.[0];
    expect(errorHandler).toBeDefined();

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const err = { status: 422, message: 'Validation failed' };
    errorHandler(err, {}, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  test('global error handler should default to 500 and generic message', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    await import('./index.js').then((m) => m.init());

    const errorHandler = mockApp.use.mock.calls.find(
      (call) => typeof call[0] === 'function' && call[0].length === 4,
    )?.[0];
    expect(errorHandler).toBeDefined();

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    errorHandler({}, {}, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });
});
