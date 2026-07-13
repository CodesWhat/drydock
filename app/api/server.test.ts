// Mock the configuration module
vi.mock('../configuration', () => ({
  getServerConfiguration: vi.fn(() => ({
    port: 3000,
    cors: {},
    enabled: true,
    feature: { delete: true },
    tls: {},
  })),
  getWebhookConfiguration: vi.fn(() => ({
    enabled: false,
  })),
  getLogLevel: vi.fn(() => 'info'),
  getLogFormat: vi.fn(() => 'json'),
  getLogBufferEnabled: vi.fn(() => true),
}));

const mockAssetManager = vi.hoisted(() => ({
  pull: vi.fn(async (provider: string) => ({ provider, state: 'ready' })),
  warm: vi.fn(async (provider: string) => ({ provider, state: 'ready' })),
}));

vi.mock('../security/runtime.js', () => ({
  getSecurityRuntimeStatus: vi.fn(async () => ({
    ready: true,
    scanner: { status: 'ready', command: 'trivy', commandAvailable: true },
  })),
  getScannerAssetManager: vi.fn(() => mockAssetManager),
}));

vi.mock('./audit-events.js', () => ({ recordAuditEvent: vi.fn() }));

vi.mock('../prometheus/compatibility.js', () => ({
  getLegacyInputSummary: vi.fn(() => ({
    total: 3,
    env: { total: 1, keys: ['WUD_SERVER_PORT'] },
    label: { total: 2, keys: ['wud.watch'] },
  })),
}));

vi.mock('../compatibility/curl-healthcheck.js', () => ({
  getCurlHealthcheckOverrideCompatibility: vi.fn(async () => ({
    detected: false,
  })),
}));

// Mock express modules
vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => ({
      use: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
    })),
  },
}));

vi.mock('nocache', () => ({ default: vi.fn() }));

import * as serverRouter from './server.js';

describe('Server Router', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  test('should initialize router with nocache and route', async () => {
    const router = serverRouter.init();

    expect(router).toBeDefined();
    expect(router.use).toHaveBeenCalled();
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
    expect(router.get).toHaveBeenCalledWith('/security/runtime', expect.any(Function));
    expect(router.post).toHaveBeenCalledWith(
      '/security/assets/:provider/:operation',
      expect.any(Function),
    );
  });

  test('should call getServerConfiguration when route handler is called', async () => {
    const { getServerConfiguration } = await import('../configuration/index.js');
    const { getCurlHealthcheckOverrideCompatibility } = await import(
      '../compatibility/curl-healthcheck.js'
    );
    const router = serverRouter.init();

    // Get the route handler function
    const routeHandler = router.get.mock.calls[0][1];
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await routeHandler({}, mockRes);

    expect(getServerConfiguration).toHaveBeenCalled();
    expect(getCurlHealthcheckOverrideCompatibility).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      configuration: {
        port: 3000,
        cors: {},
        enabled: true,
        feature: { delete: true },
        tls: {},
        webhook: { enabled: false },
      },
      compatibility: {
        legacyInputs: {
          total: 3,
          env: { total: 1, keys: ['WUD_SERVER_PORT'] },
          label: { total: 2, keys: ['wud.watch'] },
        },
        curlHealthcheckOverride: {
          detected: false,
        },
      },
    });
  });

  test('should strip tls key and cert paths from server configuration response', async () => {
    const { getServerConfiguration } = await import('../configuration/index.js');
    vi.mocked(getServerConfiguration).mockReturnValueOnce({
      port: 3000,
      cors: {},
      enabled: true,
      feature: { delete: true },
      tls: {
        enabled: true,
        key: '/etc/certs/tls.key',
        cert: '/etc/certs/tls.cert',
      },
    });
    const router = serverRouter.init();

    const routeHandler = router.get.mock.calls[0][1];
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await routeHandler({}, mockRes);

    const payload = mockRes.json.mock.calls[0][0];
    expect(payload.configuration.tls).toEqual({
      enabled: true,
    });
    expect(payload.configuration.tls).not.toHaveProperty('key');
    expect(payload.configuration.tls).not.toHaveProperty('cert');
  });

  test('should preserve non-object tls values as-is', async () => {
    const { getServerConfiguration } = await import('../configuration/index.js');
    vi.mocked(getServerConfiguration).mockReturnValueOnce({
      port: 3000,
      cors: {},
      enabled: true,
      feature: { delete: true },
      tls: false,
    });
    const router = serverRouter.init();

    const routeHandler = router.get.mock.calls[0][1];
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await routeHandler({}, mockRes);

    const payload = mockRes.json.mock.calls[0][0];
    expect(payload.configuration.tls).toBe(false);
  });

  test('should return security runtime status on runtime route', async () => {
    const { getSecurityRuntimeStatus } = await import('../security/runtime.js');
    const router = serverRouter.init();

    const runtimeRoute = router.get.mock.calls.find((call) => call[0] === '/security/runtime');
    const runtimeHandler = runtimeRoute[1];
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await runtimeHandler({}, mockRes);

    expect(getSecurityRuntimeStatus).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ready: true,
      }),
    );
  });

  test('should return 500 when security runtime status lookup throws', async () => {
    const { getSecurityRuntimeStatus } = await import('../security/runtime.js');
    vi.mocked(getSecurityRuntimeStatus).mockRejectedValueOnce(new Error('runtime unavailable'));
    const router = serverRouter.init();

    const runtimeRoute = router.get.mock.calls.find((call) => call[0] === '/security/runtime');
    const runtimeHandler = runtimeRoute[1];
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await runtimeHandler({}, mockRes);

    expect(getSecurityRuntimeStatus).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Error loading security runtime status',
    });
  });

  test('should run scanner asset pull and return lifecycle status', async () => {
    const { getScannerAssetManager } = await import('../security/runtime.js');
    const router = serverRouter.init();
    const assetRoute = router.post.mock.calls.find(
      (call) => call[0] === '/security/assets/:provider/:operation',
    );
    const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await assetRoute[1](
      {
        params: { provider: 'grype', operation: 'pull' },
        body: { username: 'registry-user', password: 'registry-token', ignored: 'value' },
      },
      mockRes,
    );

    expect(getScannerAssetManager().pull).toHaveBeenCalledWith('grype', {
      username: 'registry-user',
      password: 'registry-token',
    });
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ provider: 'grype', state: 'ready' });
  });

  test.each([
    { params: {}, reason: 'missing parameters' },
    {
      params: { provider: 'unknown', operation: 'pull' },
      reason: 'unsupported provider',
    },
    {
      params: { provider: 'trivy', operation: 'delete' },
      reason: 'unsupported operation',
    },
  ])('should reject scanner asset requests with $reason', async ({ params }) => {
    const router = serverRouter.init();
    const assetRoute = router.post.mock.calls.find(
      (call) => call[0] === '/security/assets/:provider/:operation',
    );
    const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await assetRoute[1]({ params }, mockRes);

    expect(mockAssetManager.pull).not.toHaveBeenCalled();
    expect(mockAssetManager.warm).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Unsupported scanner asset operation',
    });
  });

  test('should warm a scanner asset without forwarding non-object authentication', async () => {
    const router = serverRouter.init();
    const assetRoute = router.post.mock.calls.find(
      (call) => call[0] === '/security/assets/:provider/:operation',
    );
    const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await assetRoute[1](
      {
        params: { provider: 'syft', operation: 'warm' },
        body: 'not-an-auth-object',
      },
      mockRes,
    );

    expect(mockAssetManager.pull).not.toHaveBeenCalled();
    expect(mockAssetManager.warm).toHaveBeenCalledWith('syft');
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ provider: 'syft', state: 'ready' });
  });

  test('should omit empty authentication when pulling a scanner asset', async () => {
    const router = serverRouter.init();
    const assetRoute = router.post.mock.calls.find(
      (call) => call[0] === '/security/assets/:provider/:operation',
    );
    const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await assetRoute[1](
      {
        params: { provider: 'trivy', operation: 'pull' },
        body: { username: 123, password: null },
      },
      mockRes,
    );

    expect(mockAssetManager.pull).toHaveBeenCalledWith('trivy', undefined);
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  test('should return 503 when a scanner asset operation fails', async () => {
    mockAssetManager.pull.mockRejectedValueOnce(new Error('registry unavailable'));
    const router = serverRouter.init();
    const assetRoute = router.post.mock.calls.find(
      (call) => call[0] === '/security/assets/:provider/:operation',
    );
    const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await assetRoute[1](
      {
        params: { provider: 'grype', operation: 'pull' },
        body: {},
      },
      mockRes,
    );

    expect(mockRes.status).toHaveBeenCalledWith(503);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Scanner asset operation failed' });
  });
});
