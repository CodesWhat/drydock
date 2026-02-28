// @ts-nocheck
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
}));

vi.mock('../security/runtime.js', () => ({
  getSecurityRuntimeStatus: vi.fn(async () => ({
    ready: true,
    scanner: { status: 'ready', command: 'trivy', commandAvailable: true },
  })),
}));

vi.mock('../prometheus/compatibility.js', () => ({
  getLegacyInputSummary: vi.fn(() => ({
    total: 3,
    env: { total: 1, keys: ['WUD_SERVER_PORT'] },
    label: { total: 2, keys: ['wud.watch'] },
  })),
}));

// Mock express modules
vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => ({
      use: vi.fn(),
      get: vi.fn(),
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
  });

  test('should call getServerConfiguration when route handler is called', async () => {
    const { getServerConfiguration } = await import('../configuration/index.js');
    const router = serverRouter.init();

    // Get the route handler function
    const routeHandler = router.get.mock.calls[0][1];
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    routeHandler({}, mockRes);

    expect(getServerConfiguration).toHaveBeenCalled();
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
      },
    });
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
});
