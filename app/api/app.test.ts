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

  test('should call getAppInfos when route handler is called', async () => {
    const storeApp = await import('../store/app.js');
    const router = appRouter.init();

    // Get the route handler function
    const routeHandler = router.get.mock.calls[0][1];
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    routeHandler({}, mockRes);

    expect(storeApp.getAppInfos).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      version: '1.0.0',
      name: 'drydock',
    });
  });
});
