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
vi.mock('express-healthcheck', () => ({ default: vi.fn(() => 'healthcheck-middleware') }));

import * as healthRouter from './health.js';

describe('Health Router', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  test('should initialize router with nocache and healthcheck', async () => {
    const router = healthRouter.init();

    expect(router).toBeDefined();
    expect(router.use).toHaveBeenCalled();
    expect(router.get).toHaveBeenCalledWith('/', 'healthcheck-middleware');
  });

  test('should use express-healthcheck middleware', async () => {
    const { default: expressHealthcheck } = await import('express-healthcheck');
    healthRouter.init();

    expect(expressHealthcheck).toHaveBeenCalled();
  });
});
