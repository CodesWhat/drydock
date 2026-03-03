vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => ({
      use: vi.fn(),
      get: vi.fn(),
    })),
  },
}));

vi.mock('passport', () => ({
  default: {
    authenticate: vi.fn(() => 'auth-middleware'),
  },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../prometheus', () => ({
  output: vi.fn(async () => 'metrics-output'),
}));

vi.mock('../configuration', () => ({
  getServerConfiguration: vi.fn(() => ({
    metrics: {},
  })),
}));

vi.mock('./auth', () => ({
  getAllIds: vi.fn(() => ['basic.default']),
}));

import passport from 'passport';
import { getServerConfiguration } from '../configuration/index.js';
import { output } from '../prometheus/index.js';
import * as auth from './auth.js';
import * as prometheusRouter from './prometheus.js';

describe('Prometheus Router', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    getServerConfiguration.mockReturnValue({
      metrics: {},
    });
  });

  test('should initialize router with auth by default', async () => {
    const router = prometheusRouter.init();

    expect(router).toBeDefined();
    expect(auth.getAllIds).toHaveBeenCalled();
    expect(passport.authenticate).toHaveBeenCalledWith(['basic.default']);
    expect(router.use).toHaveBeenCalledWith('auth-middleware');
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
  });

  test('should allow unauthenticated metrics when disabled in configuration', async () => {
    getServerConfiguration.mockReturnValue({
      metrics: {
        auth: false,
      },
    });

    const router = prometheusRouter.init();

    expect(router).toBeDefined();
    expect(passport.authenticate).not.toHaveBeenCalled();
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
  });

  test('should output metrics payload', async () => {
    const router = prometheusRouter.init();
    const outputHandler = router.get.mock.calls[0][1];
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await outputHandler({}, response);

    expect(output).toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.type).toHaveBeenCalledWith('text');
    expect(response.send).toHaveBeenCalledWith('metrics-output');
  });
});
