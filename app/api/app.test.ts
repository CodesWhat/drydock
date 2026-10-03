// Mock the store module
vi.mock('../store/app', () => ({
  getAppInfos: vi.fn(() => ({
    version: '1.0.0',
    name: 'drydock',
  })),
}));

// Mock express and nocache
vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => ({
      use: vi.fn(),
      get: vi.fn(),
    })),
  },
}));

vi.mock('nocache', () => ({ default: vi.fn() }));

import * as appRouter from './app.js';

describe('App Router', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  test('should initialize router with nocache and route', async () => {
    const router = appRouter.init();

    expect(router).toBeDefined();
    expect(router.use).toHaveBeenCalled();
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
  });

  function callRouteHandler() {
    const router = appRouter.init();
    const routeHandler = router.get.mock.calls[0][1];
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    routeHandler({}, mockRes);
    return mockRes;
  }

  test('should call getAppInfos when route handler is called', async () => {
    const storeApp = await import('../store/app.js');

    const mockRes = callRouteHandler();

    expect(storeApp.getAppInfos).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      version: '1.0.0',
      build: '1.0.0',
      name: 'drydock',
    });
  });

  test('should report the base version and keep the release candidate as the build', async () => {
    const storeApp = await import('../store/app.js');
    vi.mocked(storeApp.getAppInfos).mockReturnValueOnce({
      name: 'drydock',
      version: '1.6.1-rc.15',
    });

    const mockRes = callRouteHandler();

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      name: 'drydock',
      version: '1.6.1',
      build: '1.6.1-rc.15',
    });
  });

  test('should pass a non-semver build version through unchanged', async () => {
    const storeApp = await import('../store/app.js');
    vi.mocked(storeApp.getAppInfos).mockReturnValueOnce({ name: 'drydock', version: 'ci' });

    const mockRes = callRouteHandler();

    expect(mockRes.json).toHaveBeenCalledWith({ name: 'drydock', version: 'ci', build: 'ci' });
  });

  test('should return null when app infos are not stored yet', async () => {
    const storeApp = await import('../store/app.js');
    vi.mocked(storeApp.getAppInfos).mockReturnValueOnce(null);

    const mockRes = callRouteHandler();

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(null);
  });
});
