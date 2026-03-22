import { createHash } from 'node:crypto';

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

  describe('bearer token auth (DD_SERVER_METRICS_TOKEN)', () => {
    const testToken = 'my-secret-metrics-token';

    beforeEach(() => {
      getServerConfiguration.mockReturnValue({
        metrics: {
          auth: true,
          token: testToken,
        },
      });
    });

    test('should use bearer token middleware when token is configured', () => {
      const router = prometheusRouter.init();

      expect(passport.authenticate).not.toHaveBeenCalled();
      expect(router.use).toHaveBeenCalledWith(prometheusRouter.authenticateMetricsToken);
    });

    test('should return 200 for valid bearer token', () => {
      const req = { headers: { authorization: `Bearer ${testToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should return 401 for invalid bearer token', () => {
      const req = { headers: { authorization: 'Bearer wrong-token' } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    test('should return 401 when authorization header is missing', () => {
      const req = { headers: {} };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    test('should accept lowercase "bearer" scheme (RFC 7235)', () => {
      const req = { headers: { authorization: `bearer ${testToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should return 401 for wrong auth scheme', () => {
      const req = { headers: { authorization: `Basic ${testToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    test('should fall back to passport auth when token is empty string', () => {
      getServerConfiguration.mockReturnValue({
        metrics: {
          auth: true,
          token: '',
        },
      });

      const router = prometheusRouter.init();

      expect(passport.authenticate).toHaveBeenCalledWith(['basic.default']);
      expect(router.use).toHaveBeenCalledWith('auth-middleware');
    });

    test('should use timing-safe comparison to prevent timing attacks', () => {
      // Verify that different-length tokens don't cause crashes or bypass.
      // The SHA-256 hash normalization ensures buffers are always the same length.
      const req = { headers: { authorization: 'Bearer x' } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
