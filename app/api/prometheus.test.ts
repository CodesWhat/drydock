vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => ({
      use: vi.fn(),
      get: vi.fn(),
    })),
  },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

// The API key authenticator imported below reaches the store, which builds a
// component logger at import time.
vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })),
  },
}));

vi.mock('../prometheus', () => ({
  output: vi.fn(async () => 'metrics-output'),
}));

vi.mock('../configuration', () => ({
  getServerConfiguration: vi.fn(() => ({
    metrics: {},
  })),
}));

const { mockRequireAuthentication } = vi.hoisted(() => ({
  mockRequireAuthentication: vi.fn(),
}));
vi.mock('./auth', () => ({
  requireAuthentication: mockRequireAuthentication,
}));

const { mockRateLimit } = vi.hoisted(() => ({
  mockRateLimit: vi.fn(() => 'metrics-auth-limiter'),
}));
vi.mock('express-rate-limit', () => ({ default: mockRateLimit }));

import { getServerConfiguration } from '../configuration/index.js';
import { output } from '../prometheus/index.js';
import { apiKeyAuthenticator } from './api-key-auth.js';
import { clearAuthenticators, registerAuthenticator } from './authenticator-chain.js';
import * as prometheusRouter from './prometheus.js';
import { getRouteScope } from './route-scopes.js';

describe('Prometheus Router', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    getServerConfiguration.mockReturnValue({
      metrics: {},
    });
  });

  test('should initialize router with the authenticator chain by default', async () => {
    const router = prometheusRouter.init();

    expect(router).toBeDefined();
    expect(router.use).toHaveBeenCalledWith(mockRequireAuthentication);
    expect(router.get).toHaveBeenCalledWith('/', expect.any(Function));
  });

  test('should charge only failed attempts against the credential fallback budget', () => {
    const router = prometheusRouter.init();

    expect(mockRateLimit).toHaveBeenCalledWith({
      windowMs: 15 * 60 * 1000,
      max: 100,
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
    });
    // The budget has to sit in front of the credential check, or a guess is
    // answered before it is counted.
    const useArguments = router.use.mock.calls.map(([middleware]) => middleware);
    expect(useArguments.indexOf('metrics-auth-limiter')).toBeGreaterThanOrEqual(0);
    expect(useArguments.indexOf('metrics-auth-limiter')).toBeLessThan(
      useArguments.indexOf(mockRequireAuthentication),
    );
  });

  describe('the scope a key needs to scrape', () => {
    // /metrics is mounted on the app, not under the /api/v1 router, so the
    // completeness walk cannot see it and `scoped()` is the only thing that
    // puts a scope on it. Without one, requireAuthentication accepted any
    // valid key: a triggers:test-only key could read the container inventory
    // it is not otherwise allowed to see.
    test('declares read, on both the credential and the fallback branch', () => {
      const fallbackRouter = prometheusRouter.init();
      expect(getRouteScope(fallbackRouter.get.mock.calls[0][1])).toBe('read');

      getServerConfiguration.mockReturnValue({ metrics: { auth: true, token: 'metrics-secret' } });
      const credentialRouter = prometheusRouter.init();
      expect(getRouteScope(credentialRouter.get.mock.calls[0][1])).toBe('read');
    });

    test('a key without read is refused before any metric is rendered', async () => {
      const router = prometheusRouter.init();
      const handler = router.get.mock.calls[0][1];
      const res = {
        status: vi.fn().mockReturnThis(),
        type: vi.fn().mockReturnThis(),
        send: vi.fn(),
        json: vi.fn(),
      };

      await handler(
        {
          principal: {
            kind: 'api-key',
            keyId: 'abcdef012345',
            name: 'ci',
            scopes: ['triggers:test'],
          },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(output).not.toHaveBeenCalled();
    });

    test('a read key scrapes, and so does an admin key that implies it', async () => {
      const router = prometheusRouter.init();
      const handler = router.get.mock.calls[0][1];

      for (const scopes of [['read'], ['admin']]) {
        const res = {
          status: vi.fn().mockReturnThis(),
          type: vi.fn().mockReturnThis(),
          send: vi.fn(),
          json: vi.fn(),
        };
        await handler(
          { principal: { kind: 'api-key', keyId: 'abcdef012345', name: 'ci', scopes } },
          res,
        );
        expect(res.status).toHaveBeenCalledWith(200);
      }
    });

    test('a session scrape is not gated by the scope at all', async () => {
      const router = prometheusRouter.init();
      const handler = router.get.mock.calls[0][1];
      const res = {
        status: vi.fn().mockReturnThis(),
        type: vi.fn().mockReturnThis(),
        send: vi.fn(),
        json: vi.fn(),
      };

      await handler({ principal: { kind: 'session', username: 'scott' } }, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  test('should allow unauthenticated metrics when disabled in configuration', async () => {
    getServerConfiguration.mockReturnValue({
      metrics: {
        auth: false,
      },
    });

    const router = prometheusRouter.init();

    expect(router).toBeDefined();
    expect(router.use).not.toHaveBeenCalledWith(mockRequireAuthentication);
    expect(mockRateLimit).not.toHaveBeenCalled();
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

    function initMetricsTokenAuth(token = testToken) {
      getServerConfiguration.mockReturnValue({
        metrics: {
          auth: true,
          token,
        },
      });

      prometheusRouter.init();
    }

    test('should use bearer token middleware when token is configured', () => {
      const router = prometheusRouter.init();

      expect(router.use).not.toHaveBeenCalledWith(mockRequireAuthentication);
      expect(router.use).toHaveBeenCalledWith(prometheusRouter.authenticateMetricsToken);
      // A single configured secret compared in constant time; no budget needed.
      expect(mockRateLimit).not.toHaveBeenCalled();
    });

    test('should return 200 for valid bearer token', () => {
      initMetricsTokenAuth();
      const req = { headers: { authorization: `Bearer ${testToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should return 401 for invalid bearer token', () => {
      initMetricsTokenAuth();
      const req = { headers: { authorization: 'Bearer wrong-token' } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    test('should return 401 when authorization header is missing', () => {
      initMetricsTokenAuth();
      const req = { headers: {} };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    test('should accept lowercase "bearer" scheme (RFC 7235)', () => {
      initMetricsTokenAuth();
      const req = { headers: { authorization: `bearer ${testToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should return 401 for wrong auth scheme', () => {
      initMetricsTokenAuth();
      const req = { headers: { authorization: `Basic ${testToken}` } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    test('should fall back to the authenticator chain when token is empty string', () => {
      getServerConfiguration.mockReturnValue({
        metrics: {
          auth: true,
          token: '',
        },
      });

      const router = prometheusRouter.init();

      expect(router.use).toHaveBeenCalledWith(mockRequireAuthentication);
    });

    test('should use timing-safe comparison to prevent timing attacks', () => {
      initMetricsTokenAuth();
      // Verify that different-length tokens don't cause crashes or bypass.
      // The SHA-256 hash normalization ensures buffers are always the same length.
      const req = { headers: { authorization: 'Bearer x' } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      prometheusRouter.authenticateMetricsToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should keep using the expected token hash computed during init', () => {
      const initialToken = 'initial-token';
      const rotatedToken = 'rotated-token';

      initMetricsTokenAuth(initialToken);

      getServerConfiguration.mockReturnValue({
        metrics: {
          auth: true,
          token: rotatedToken,
        },
      });

      const initialReq = { headers: { authorization: `Bearer ${initialToken}` } };
      const initialRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const initialNext = vi.fn();
      prometheusRouter.authenticateMetricsToken(initialReq, initialRes, initialNext);

      const rotatedReq = { headers: { authorization: `Bearer ${rotatedToken}` } };
      const rotatedRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const rotatedNext = vi.fn();
      prometheusRouter.authenticateMetricsToken(rotatedReq, rotatedRes, rotatedNext);

      expect(initialNext).toHaveBeenCalled();
      expect(initialRes.status).not.toHaveBeenCalled();
      expect(rotatedNext).not.toHaveBeenCalled();
      expect(rotatedRes.status).toHaveBeenCalledWith(401);
      expect(rotatedRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    describe('coexistence with API key authentication', () => {
      /**
       * When a metrics token is configured this route never reaches the
       * authenticator chain, so the API key authenticator cannot see the
       * header and cannot consume it. These pin that, because a future change
       * that mounted requireAuthentication here would silently hand every
       * `ddk_` bearer to the key authenticator instead.
       */
      test('never mounts the authenticator chain when a token is configured', () => {
        getServerConfiguration.mockReturnValue({ metrics: { auth: true, token: testToken } });

        const router = prometheusRouter.init();

        expect(router.use).toHaveBeenCalledWith(prometheusRouter.authenticateMetricsToken);
        expect(router.use).not.toHaveBeenCalledWith(mockRequireAuthentication);
      });

      test('a Prometheus scrape still authenticates with the key authenticator registered', () => {
        registerAuthenticator(apiKeyAuthenticator);
        initMetricsTokenAuth();
        const req = { headers: { authorization: `Bearer ${testToken}` } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();

        prometheusRouter.authenticateMetricsToken(req, res, next);

        expect(next).toHaveBeenCalled();
        clearAuthenticators();
      });

      test('a ddk_ bearer is compared against the metrics secret, not rescued by a key', () => {
        registerAuthenticator(apiKeyAuthenticator);
        initMetricsTokenAuth();
        const req = {
          headers: { authorization: `Bearer ddk_${'a'.repeat(12)}_${'A'.repeat(43)}` },
        };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();

        prometheusRouter.authenticateMetricsToken(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        clearAuthenticators();
      });
    });
  });
});
