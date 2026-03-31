const {
  mockRouter,
  mockLokiStore,
  mockExpressJson,
  mockJsonMiddleware,
  mockFs,
  mockRateLimit,
  mockCreateAuthenticatedRouteRateLimitKeyGenerator,
  mockIsIdentityAwareRateLimitKeyingEnabled,
} = vi.hoisted(() => {
  const jsonMiddleware = vi.fn();
  const rateLimitMiddleware = vi.fn((_, __, next) => next());
  return {
    mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
    mockLokiStore: vi.fn(),
    mockJsonMiddleware: jsonMiddleware,
    mockExpressJson: vi.fn(() => jsonMiddleware),
    mockFs: {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
    mockRateLimit: vi.fn(() => rateLimitMiddleware),
    mockCreateAuthenticatedRouteRateLimitKeyGenerator: vi.fn(() => undefined),
    mockIsIdentityAwareRateLimitKeyingEnabled: vi.fn(() => false),
  };
});
const LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS = 5;
const { previousMaxTrackedLockoutIdentities } = vi.hoisted(() => {
  const previous = process.env.DD_AUTH_LOCKOUT_MAX_TRACKED_IDENTITIES;
  process.env.DD_AUTH_LOCKOUT_MAX_TRACKED_IDENTITIES = '5';
  return { previousMaxTrackedLockoutIdentities: previous };
});
const mockGetServerConfiguration = vi.hoisted(() => vi.fn(() => ({ cookie: {} })));
const mockRecordAuditEvent = vi.hoisted(() => vi.fn());
const mockValidateOpenApiJsonResponse = vi.hoisted(() =>
  vi.fn(() => ({ valid: true, errors: [] })),
);

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter), json: mockExpressJson },
}));

vi.mock('express-session', () => ({
  default: vi.fn(() => 'session-middleware'),
}));
vi.mock('express-rate-limit', () => ({
  default: mockRateLimit,
}));

vi.mock('connect-loki', () => ({
  default: vi.fn(() => mockLokiStore),
}));

vi.mock('passport', () => ({
  default: {
    use: vi.fn(),
    initialize: vi.fn(() => 'passport-init'),
    session: vi.fn(() => 'passport-session'),
    authenticate: vi.fn(() => vi.fn()),
    serializeUser: vi.fn(),
    deserializeUser: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v5: vi.fn(() => 'mock-uuid-v5'),
}));

vi.mock('node:fs', () => ({
  default: mockFs,
}));

vi.mock('../store', () => ({
  getConfiguration: vi.fn(() => ({
    path: '/test/store',
    file: 'db.json',
  })),
}));

vi.mock('../registry', () => ({
  getState: vi.fn(() => ({
    authentication: {},
  })),
  getRegistrationWarnings: vi.fn(() => []),
  getAuthenticationRegistrationErrors: vi.fn(() => []),
}));

vi.mock('../log', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('../configuration', () => ({
  getVersion: vi.fn(() => '1.0.0'),
  getServerConfiguration: mockGetServerConfiguration,
}));
vi.mock('./audit-events.js', () => ({
  recordAuditEvent: mockRecordAuditEvent,
}));
vi.mock('./openapi-contract.js', () => ({
  validateOpenApiJsonResponse: mockValidateOpenApiJsonResponse,
}));
vi.mock('./rate-limit-key.js', () => ({
  createAuthenticatedRouteRateLimitKeyGenerator: mockCreateAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled: mockIsIdentityAwareRateLimitKeyingEnabled,
}));

import session from 'express-session';
import passport from 'passport';
import log from '../log/index.js';
import * as registry from '../registry/index.js';
import * as auth from './auth.js';
import * as authSession from './auth-session.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const lockoutStateFiles = new Map<string, string>();
const LOCKOUT_STATE_PATH = '/test/store/db.json.auth-lockouts.json';

function createApp() {
  return {
    use: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
}

function createResponse() {
  return {
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    sendStatus: vi.fn(),
    end: vi.fn(),
  };
}

function getRouteHandler(method, path) {
  const app = createApp();
  registry.getState.mockReturnValue({
    authentication: {
      'oauth.provider': {
        getId: vi.fn(() => 'oauth.provider'),
        getStrategy: vi.fn(() => ({})),
        getStrategyDescription: vi.fn(() => ({
          type: 'oauth',
          name: 'provider',
          logoutUrl: 'https://logout.example.com',
        })),
      },
    },
  });
  auth.init(app);
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  if (!call) return undefined;
  // Return the last handler in the chain (route-level middleware precedes it)
  return call[call.length - 1];
}

function getRouteMiddleware(method, path) {
  const app = createApp();
  registry.getState.mockReturnValue({
    authentication: {
      'oauth.provider': {
        getId: vi.fn(() => 'oauth.provider'),
        getStrategy: vi.fn(() => ({})),
        getStrategyDescription: vi.fn(() => ({
          type: 'oauth',
          name: 'provider',
          logoutUrl: 'https://logout.example.com',
        })),
      },
    },
  });
  auth.init(app);
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  if (!call) return [];
  // Return all middleware handlers (everything between route path and final handler)
  return call.slice(1, -1);
}

describe('Auth Router', () => {
  afterAll(() => {
    if (previousMaxTrackedLockoutIdentities === undefined) {
      delete process.env.DD_AUTH_LOCKOUT_MAX_TRACKED_IDENTITIES;
      return;
    }

    process.env.DD_AUTH_LOCKOUT_MAX_TRACKED_IDENTITIES = previousMaxTrackedLockoutIdentities;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsIdentityAwareRateLimitKeyingEnabled.mockReturnValue(false);
    mockCreateAuthenticatedRouteRateLimitKeyGenerator.mockReturnValue(undefined);
    lockoutStateFiles.clear();
    mockFs.existsSync.mockImplementation((candidate: unknown) =>
      lockoutStateFiles.has(`${candidate}`),
    );
    mockFs.readFileSync.mockImplementation((candidate: unknown) => {
      const value = lockoutStateFiles.get(`${candidate}`);
      if (value === undefined) {
        throw new Error('ENOENT: lockout file missing');
      }
      return value;
    });
    mockFs.writeFileSync.mockImplementation((candidate: unknown, content: unknown) => {
      lockoutStateFiles.set(`${candidate}`, `${content}`);
    });
    mockFs.mkdirSync.mockImplementation(() => undefined);
    // Reset the strategy IDs array between tests
    auth._resetStrategyIdsForTests();
    mockGetServerConfiguration.mockReturnValue({ cookie: {} });
    auth._resetLoginLockoutStateForTests();
  });

  describe('getAllIds', () => {
    test('should return strategy ids array', () => {
      const ids = auth.getAllIds();
      expect(Array.isArray(ids)).toBe(true);
    });

    test('should not expose internal strategy ids for mutation', () => {
      const app = createApp();
      registry.getState.mockReturnValue({
        authentication: {
          'basic.default': {
            getId: vi.fn(() => 'basic.default'),
            getStrategy: vi.fn(() => ({})),
            getStrategyDescription: vi.fn(() => ({ type: 'basic', name: 'default' })),
          },
        },
      });
      auth.init(app);

      const ids = auth.getAllIds();
      ids.length = 0;

      expect(auth.getAllIds()).toContain('basic.default');
    });
  });

  describe('getSessionMiddleware', () => {
    test('returns the initialized session middleware', () => {
      const app = createApp();
      registry.getState.mockReturnValue({
        authentication: {},
      });

      auth.init(app);

      expect(auth.getSessionMiddleware()).toBe('session-middleware');
    });
  });

  describe('requireAuthentication', () => {
    test('should call next when user is authenticated', () => {
      const req = { isAuthenticated: vi.fn(() => true) };
      const res = {};
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('should call passport.authenticate when user is not authenticated', () => {
      const authMiddleware = vi.fn();
      passport.authenticate.mockReturnValue(authMiddleware);

      const req = { isAuthenticated: vi.fn(() => false) };
      const res = {};
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

      expect(passport.authenticate).toHaveBeenCalledWith(auth.getAllIds(), { session: true });
      expect(authMiddleware).toHaveBeenCalledWith(req, res, next);
    });

    test('should not special-case POST /login (handled by route-level middleware)', () => {
      const authMiddleware = vi.fn();
      passport.authenticate.mockReturnValue(authMiddleware);

      const req = {
        isAuthenticated: vi.fn(() => false),
        method: 'POST',
        path: '/login',
      };
      const res = {};
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

      expect(passport.authenticate).toHaveBeenCalledWith(auth.getAllIds(), { session: true });
      expect(authMiddleware).toHaveBeenCalledWith(req, res, next);
    });
  });

  describe('authenticateLogin (route-level middleware)', () => {
    function getLoginMiddleware() {
      return getRouteMiddleware('post', '/login')[0];
    }

    test('should record failed login audit when credentials are invalid', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {};
      const res = createResponse();
      const next = vi.fn();

      authenticateLoginFn(req, res, next);

      expect(passport.authenticate).toHaveBeenCalledWith(
        auth.getAllIds(),
        { session: false },
        expect.any(Function),
      );
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'error',
        }),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(next).not.toHaveBeenCalled();
    });

    test('should call next with login authentication errors', () => {
      const error = new Error('auth blew up');
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(error, false, undefined, 500);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {};
      const res = createResponse();
      const next = vi.fn();

      authenticateLoginFn(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    });

    test('should continue to login handler when credentials are valid', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, { username: 'john' }, undefined, 200);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        login: vi.fn((user, options, done) => {
          req.user = user;
          done();
        }),
      };
      const res = createResponse();
      const next = vi.fn();

      authenticateLoginFn(req, res, next);

      expect(req.login).toHaveBeenCalledWith(
        { username: 'john' },
        { session: false },
        expect.any(Function),
      );
      expect(req.user).toEqual({ username: 'john' });
      expect(next).toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
    });

    test('should continue when credentials are valid and req.login is unavailable', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, { username: 'john' }, undefined, 200);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {};
      const res = createResponse();
      const next = vi.fn();

      authenticateLoginFn(req, res, next);

      expect(req.user).toEqual({ username: 'john' });
      expect(next).toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
    });

    test('should call next with req.login errors', () => {
      const loginError = new Error('login callback failed');
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, { username: 'john' }, undefined, 200);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        login: vi.fn((_user, _options, done) => done(loginError)),
      };
      const res = createResponse();
      const next = vi.fn();

      authenticateLoginFn(req, res, next);

      expect(next).toHaveBeenCalledWith(loginError);
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
    });

    test('should lock account after repeated failed login attempts', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        headers: {
          authorization: `Basic ${Buffer.from('alice:bad-pass').toString('base64')}`,
        },
        ip: '203.0.113.10',
      };
      const next = vi.fn();

      for (let index = 0; index < 4; index += 1) {
        const res = createResponse();
        authenticateLoginFn(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
      }

      const lockoutResponse = createResponse();
      authenticateLoginFn(req, lockoutResponse, next);
      expect(lockoutResponse.status).toHaveBeenCalledWith(423);
      expect(lockoutResponse.json).toHaveBeenCalledWith({
        error: 'Account temporarily locked due to repeated failed login attempts',
      });
    });

    test('should keep lockout pressure after lockout expires when failures continue', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      try {
        const authenticateLoginFn = getLoginMiddleware();
        const req = {
          headers: {
            authorization: `Basic ${Buffer.from('sustained-user:bad-pass').toString('base64')}`,
          },
          ip: '203.0.113.30',
        };
        const next = vi.fn();

        for (let index = 0; index < 4; index += 1) {
          const res = createResponse();
          authenticateLoginFn(req, res, next);
          expect(res.status).toHaveBeenCalledWith(401);
        }

        const firstLockoutRes = createResponse();
        authenticateLoginFn(req, firstLockoutRes, next);
        expect(firstLockoutRes.status).toHaveBeenCalledWith(423);

        vi.setSystemTime(new Date('2026-01-01T00:15:00.000Z'));
        const afterExpiryRes = createResponse();
        authenticateLoginFn(req, afterExpiryRes, next);

        expect(afterExpiryRes.status).toHaveBeenCalledWith(423);
      } finally {
        vi.useRealTimers();
      }
    });

    test('should reject locked accounts before running authentication middleware', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        headers: {
          authorization: `Basic ${Buffer.from('alice:bad-pass').toString('base64')}`,
        },
        ip: '203.0.113.10',
      };
      const next = vi.fn();

      for (let index = 0; index < 5; index += 1) {
        authenticateLoginFn(req, createResponse(), next);
      }
      const authenticateCallCount = passport.authenticate.mock.calls.length;

      const lockedResponse = createResponse();
      authenticateLoginFn(req, lockedResponse, next);
      expect(passport.authenticate.mock.calls.length).toBe(authenticateCallCount);
      expect(lockedResponse.status).toHaveBeenCalledWith(423);
      expect(lockedResponse.json).toHaveBeenCalledWith({
        error: 'Account temporarily locked due to repeated failed login attempts',
      });
    });

    test('should derive login identity from request body username', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        body: { username: ' Alice ' },
        ip: '203.0.113.11',
      };
      const res = createResponse();
      const next = vi.fn();

      authenticateLoginFn(req, res, next);

      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.stringContaining('user=Alice'),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should handle blank basic auth credentials as missing login identity', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        headers: {
          authorization: 'Basic     ',
        },
        ip: '203.0.113.12',
      };
      const res = createResponse();
      const next = vi.fn();

      authenticateLoginFn(req, res, next);

      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.stringContaining('user=unknown'),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should handle malformed basic auth payload decoding failures', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const originalBufferFrom = Buffer.from.bind(Buffer);
      const bufferFromSpy = vi.spyOn(Buffer, 'from').mockImplementation(((
        input: any,
        encoding?: any,
      ) => {
        if (encoding === 'base64') {
          throw new Error('decode failed');
        }
        return originalBufferFrom(input, encoding);
      }) as any);

      try {
        const req = {
          headers: {
            authorization: 'Basic Zm9vOmJhcg==',
          },
          ip: '203.0.113.13',
        };
        const res = createResponse();
        const next = vi.fn();

        authenticateLoginFn(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
      } finally {
        bufferFromSpy.mockRestore();
      }
    });

    test('should extract identity from the first authorization header value when headers are arrays', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        headers: {
          authorization: [
            `Basic ${Buffer.from('array-user').toString('base64')}`,
            `Basic ${Buffer.from('ignored-user:pass').toString('base64')}`,
          ],
        },
        ip: '203.0.113.21',
      };
      const res = createResponse();
      const next = vi.fn();

      authenticateLoginFn(req, res, next);

      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.stringContaining('user=array-user'),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should ignore blank username candidates from body/basic auth and fall back to unknown audit user', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        body: { username: '   ' },
        headers: {
          authorization: `Basic ${Buffer.from('   :password').toString('base64')}`,
        },
        ip: '   ',
      };
      const res = createResponse();
      const next = vi.fn();

      authenticateLoginFn(req, res, next);

      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.stringContaining('user=unknown'),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should set Retry-After header when lockout is active and response supports setHeader', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        headers: {
          authorization: `Basic ${Buffer.from('lockout-user:bad-pass').toString('base64')}`,
        },
        ip: '203.0.113.14',
      };
      const next = vi.fn();

      for (let index = 0; index < 4; index += 1) {
        authenticateLoginFn(req, createResponse(), next);
      }

      const res = {
        ...createResponse(),
        setHeader: vi.fn(),
      };
      authenticateLoginFn(req, res as any, next);

      expect(res.status).toHaveBeenCalledWith(423);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    });

    test('should reset failed-attempt window after lockout window elapses', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        headers: {
          authorization: `Basic ${Buffer.from('window-user:bad-pass').toString('base64')}`,
        },
        ip: '203.0.113.15',
      };
      const next = vi.fn();

      authenticateLoginFn(req, createResponse(), next);

      vi.setSystemTime(new Date('2026-01-01T00:16:00.000Z'));
      const afterWindowRes = createResponse();
      authenticateLoginFn(req, afterWindowRes, next);

      expect(afterWindowRes.status).toHaveBeenCalledWith(401);
      vi.useRealTimers();
    });

    test('should prune stale unlocked lockout entries before tracking a new identity', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      authenticateLoginFn(
        {
          body: { username: 'stale-user' },
          ip: '203.0.113.19',
        },
        createResponse(),
        vi.fn(),
      );

      vi.setSystemTime(new Date('2026-01-01T00:16:00.000Z'));
      const freshResponse = createResponse();
      authenticateLoginFn(
        {
          body: { username: 'fresh-user' },
          ip: '203.0.113.20',
        },
        freshResponse,
        vi.fn(),
      );

      expect(freshResponse.status).toHaveBeenCalledWith(401);
      vi.useRealTimers();
    });

    test('should prune lockout entries when tracked identities exceed the cap', () => {
      vi.useFakeTimers();
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      try {
        const authenticateLoginFn = getLoginMiddleware();
        const next = vi.fn();
        const startedAt = Date.parse('2026-01-01T00:00:00.000Z');

        for (let index = 0; index <= LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS; index += 1) {
          vi.setSystemTime(new Date(startedAt + index));
          authenticateLoginFn(
            {
              body: { username: `bulk-user-${index}` },
              ip: `198.51.100.${index % 255}`,
            },
            createResponse(),
            next,
          );
        }

        vi.advanceTimersByTime(1000);

        const persisted = JSON.parse(lockoutStateFiles.get(LOCKOUT_STATE_PATH) ?? '{}');
        expect(Object.keys(persisted.account)).toHaveLength(
          LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS,
        );
        expect(persisted.account['bulk-user-0']).toBeUndefined();
        expect(persisted.account[`bulk-user-${LOCKOUT_TRACKED_IDENTITIES_CAP_FOR_TESTS}`]).toEqual(
          expect.objectContaining({ failedAttempts: 1 }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    test('should persist lockout state after failed login attempts', () => {
      vi.useFakeTimers();
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      try {
        const authenticateLoginFn = getLoginMiddleware();
        authenticateLoginFn(
          {
            body: { username: 'persist-user' },
            ip: '203.0.113.40',
          },
          createResponse(),
          vi.fn(),
        );

        vi.advanceTimersByTime(1000);

        expect(mockFs.writeFileSync).toHaveBeenCalledWith(LOCKOUT_STATE_PATH, expect.any(String), {
          encoding: 'utf8',
          mode: 0o600,
        });
        const persistedState = JSON.parse(lockoutStateFiles.get(LOCKOUT_STATE_PATH) ?? '{}');
        expect(persistedState.account['persist-user']).toEqual(
          expect.objectContaining({
            failedAttempts: 1,
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    test('should warn when persisting lockout state fails', () => {
      vi.useFakeTimers();
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('persist write failed');
      });

      try {
        const authenticateLoginFn = getLoginMiddleware();
        authenticateLoginFn(
          {
            body: { username: 'persist-error-user' },
            ip: '203.0.113.60',
          },
          createResponse(),
          vi.fn(),
        );

        vi.advanceTimersByTime(1000);

        expect(log.warn).toHaveBeenCalledWith(
          expect.stringContaining('Unable to persist login lockout state (persist write failed)'),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    test('should restore active lockout state from persisted storage on init', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      lockoutStateFiles.set(
        LOCKOUT_STATE_PATH,
        JSON.stringify({
          account: {
            'restored-user': {
              failedAttempts: 5,
              windowStartAt: Date.parse('2026-01-01T00:00:00.000Z'),
              lockedUntil: Date.parse('2026-01-01T00:10:00.000Z'),
              lastAttemptAt: Date.parse('2026-01-01T00:00:00.000Z'),
            },
          },
          ip: {},
        }),
      );

      try {
        const authenticateLoginFn = getLoginMiddleware();
        const res = createResponse();

        authenticateLoginFn(
          {
            body: { username: 'restored-user' },
            ip: '203.0.113.41',
          },
          res,
          vi.fn(),
        );

        expect(passport.authenticate).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(423);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Account temporarily locked due to repeated failed login attempts',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    test('should ignore non-object persisted lockout state payloads', () => {
      lockoutStateFiles.set(LOCKOUT_STATE_PATH, JSON.stringify('not-an-object'));
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const res = createResponse();
      authenticateLoginFn(
        {
          body: { username: 'payload-user' },
          ip: '203.0.113.61',
        },
        res,
        vi.fn(),
      );

      expect(passport.authenticate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should skip hydration for persisted account/ip payloads that are not objects', () => {
      lockoutStateFiles.set(
        LOCKOUT_STATE_PATH,
        JSON.stringify({
          account: null,
          ip: 42,
        }),
      );
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const res = createResponse();
      authenticateLoginFn(
        {
          body: { username: 'no-hydrate-user' },
          ip: '203.0.113.62',
        },
        res,
        vi.fn(),
      );

      expect(passport.authenticate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should ignore invalid persisted lockout entries during hydration', () => {
      lockoutStateFiles.set(
        LOCKOUT_STATE_PATH,
        JSON.stringify({
          account: {
            'invalid-number': 123,
            'invalid-shape': {
              failedAttempts: '5',
              windowStartAt: Date.parse('2026-01-01T00:00:00.000Z'),
              lockedUntil: Date.parse('2026-01-01T00:10:00.000Z'),
              lastAttemptAt: Date.parse('2026-01-01T00:00:00.000Z'),
            },
          },
          ip: {},
        }),
      );
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const res = createResponse();
      authenticateLoginFn(
        {
          body: { username: 'invalid-number' },
          ip: '203.0.113.63',
        },
        res,
        vi.fn(),
      );

      expect(passport.authenticate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should warn when persisted lockout state cannot be parsed', () => {
      lockoutStateFiles.set(LOCKOUT_STATE_PATH, '{"account":');

      getLoginMiddleware();

      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unable to load login lockout state'),
      );
    });

    test('should prune stale lockout entries on a maintenance timer', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      lockoutStateFiles.set(
        LOCKOUT_STATE_PATH,
        JSON.stringify({
          account: {
            'timer-user': {
              failedAttempts: 1,
              windowStartAt: Date.parse('2026-01-01T00:00:00.000Z'),
              lockedUntil: 0,
              lastAttemptAt: Date.parse('2026-01-01T00:00:00.000Z'),
            },
          },
          ip: {},
        }),
      );

      try {
        getLoginMiddleware();

        vi.setSystemTime(new Date('2026-01-01T00:16:00.000Z'));
        vi.advanceTimersByTime(16 * 60 * 1000);

        const persistedState = JSON.parse(lockoutStateFiles.get(LOCKOUT_STATE_PATH) ?? '{}');
        expect(persistedState.account['timer-user']).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('should continue successful authentication when identity keys have no existing lockout entries', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, { username: 'clear-branch-user' }, undefined, 200);
      });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        body: { username: 'clear-branch-user' },
        ip: '203.0.113.64',
        login: vi.fn((_user, _options, done) => done()),
      };
      const next = vi.fn();

      authenticateLoginFn(req, createResponse(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({ username: 'clear-branch-user' });
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    test('should clear lockout state after successful authentication', () => {
      passport.authenticate
        .mockImplementationOnce((_ids, _options, callback) => {
          return () => callback(null, false, undefined, 401);
        })
        .mockImplementationOnce((_ids, _options, callback) => {
          return () => callback(null, { username: 'alice' }, undefined, 200);
        });

      const authenticateLoginFn = getLoginMiddleware();
      const req = {
        headers: {
          authorization: `Basic ${Buffer.from('alice:good-pass').toString('base64')}`,
        },
        ip: '203.0.113.16',
      };
      const next = vi.fn();

      authenticateLoginFn(req, createResponse(), next);
      authenticateLoginFn(req, createResponse(), next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('init', () => {
    test('should initialize session, passport, and routes on the app', () => {
      const app = createApp();
      auth.init(app);

      expect(app.use).toHaveBeenCalled();
      expect(passport.initialize).toHaveBeenCalled();
      expect(passport.session).toHaveBeenCalled();
      expect(passport.serializeUser).toHaveBeenCalled();
      expect(passport.deserializeUser).toHaveBeenCalled();
    });

    test('should load persisted lockout state only during the first init call', () => {
      lockoutStateFiles.set(
        LOCKOUT_STATE_PATH,
        JSON.stringify({
          account: {},
          ip: {},
        }),
      );

      auth.init(createApp());
      auth.init(createApp());

      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);
    });

    test('should default session cookie sameSite to lax for OIDC compatibility', () => {
      const app = createApp();
      auth.init(app);

      const sessionConfig = (session as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sessionConfig.cookie).toEqual(
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          secure: 'auto',
        }),
      );
    });

    test('should allow overriding session cookie sameSite to strict', () => {
      mockGetServerConfiguration.mockReturnValue({ cookie: { samesite: 'strict' } });
      const app = createApp();
      auth.init(app);

      const sessionConfig = (session as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sessionConfig.cookie).toEqual(
        expect.objectContaining({
          sameSite: 'strict',
          secure: 'auto',
        }),
      );
    });

    test('should force secure cookies when TLS is enabled', () => {
      mockGetServerConfiguration.mockReturnValue({
        cookie: { samesite: 'strict' },
        tls: { enabled: true },
      });
      const app = createApp();
      auth.init(app);

      const sessionConfig = (session as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sessionConfig.cookie).toEqual(
        expect.objectContaining({
          sameSite: 'strict',
          secure: true,
        }),
      );
    });

    test('should force secure cookies when sameSite is none', () => {
      mockGetServerConfiguration.mockReturnValue({
        cookie: { samesite: 'none' },
        tls: { enabled: true },
      });
      const app = createApp();
      auth.init(app);

      const sessionConfig = (session as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sessionConfig.cookie).toEqual(
        expect.objectContaining({
          sameSite: 'none',
          secure: true,
        }),
      );
      expect(log.warn).toHaveBeenCalledWith(
        'DD_SERVER_COOKIE_SAMESITE=none requires HTTPS; forcing secure session cookie',
      );
    });

    test('should throw when sameSite is none without HTTPS configuration', () => {
      mockGetServerConfiguration.mockReturnValue({
        cookie: { samesite: 'none' },
        tls: { enabled: false },
        trustproxy: false,
      });
      const app = createApp();

      expect(() => auth.init(app)).toThrow(
        'DD_SERVER_COOKIE_SAMESITE=none requires HTTPS. Enable DD_SERVER_TLS_ENABLED=true or configure DD_SERVER_TRUSTPROXY for HTTPS reverse proxies.',
      );
      expect(session).not.toHaveBeenCalled();
    });

    test.each([
      ['enabled boolean', true],
      ['positive hop count', 1],
      ['truthy string', 'true'],
    ])('should allow sameSite none when trustproxy is an %s value', (_label, trustproxy) => {
      mockGetServerConfiguration.mockReturnValue({
        cookie: { samesite: 'none' },
        tls: { enabled: false },
        trustproxy,
      });
      const app = createApp();

      expect(() => auth.init(app)).not.toThrow();
      const sessionConfig = (session as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sessionConfig.cookie).toEqual(
        expect.objectContaining({
          sameSite: 'none',
          secure: true,
        }),
      );
    });

    test('should register strategies from the registry', () => {
      const mockStrategy = { type: 'mock' };
      const mockAuth = {
        getId: vi.fn(() => 'basic.default'),
        getStrategy: vi.fn(() => mockStrategy),
        getStrategyDescription: vi.fn(() => ({
          type: 'basic',
          name: 'default',
        })),
      };
      registry.getState.mockReturnValue({
        authentication: { 'basic.default': mockAuth },
      });

      const app = createApp();
      auth.init(app);

      expect(passport.use).toHaveBeenCalledWith('basic.default', mockStrategy);
      expect(auth.getAllIds()).toContain('basic.default');
    });

    test('should handle strategy registration failure gracefully', () => {
      const mockAuth = {
        getId: vi.fn(() => 'bad.strategy'),
        getStrategy: vi.fn(() => {
          throw new Error('Strategy error');
        }),
      };
      registry.getState.mockReturnValue({
        authentication: { 'bad.strategy': mockAuth },
      });

      const app = createApp();
      // Should not throw
      auth.init(app);
    });

    test('should stringify non-Error strategy registration failures', () => {
      const mockAuth = {
        getId: vi.fn(() => 'bad.strategy.string'),
        getStrategy: vi.fn(() => {
          throw 'strategy failure as string';
        }),
      };
      registry.getState.mockReturnValue({
        authentication: { 'bad.strategy.string': mockAuth },
      });

      const app = createApp();
      auth.init(app);

      expect(log.warn).toHaveBeenCalledWith(
        'Unable to apply authentication bad.strategy.string (strategy failure as string)',
      );
    });

    test('should mount auth routes on the app', () => {
      const app = createApp();
      auth.init(app);

      expect(app.use).toHaveBeenCalledWith('/auth', expect.anything());
    });

    test('should register a mutation-only json parser on the auth router', () => {
      const app = createApp();
      auth.init(app);

      expect(mockExpressJson).toHaveBeenCalledTimes(1);

      const authMiddlewareIndex = mockRouter.use.mock.calls.findIndex(
        (c) => c[0] === auth.requireAuthentication,
      );
      const mutationMiddlewares = mockRouter.use.mock.calls.filter(
        (c, index) =>
          index > 0 && typeof c[0] === 'function' && c[0] !== auth.requireAuthentication,
      );

      expect(authMiddlewareIndex).toBeGreaterThan(0);
      expect(mutationMiddlewares).toHaveLength(2);
      const contentTypeGuardIndex = mockRouter.use.mock.calls.findIndex(
        (c) => c[0] === mutationMiddlewares[0][0],
      );
      const mutationParserIndex = mockRouter.use.mock.calls.findIndex(
        (c) => c[0] === mutationMiddlewares[1][0],
      );
      expect(contentTypeGuardIndex).toBeGreaterThan(0);
      expect(mutationParserIndex).toBeGreaterThan(contentTypeGuardIndex);
      expect(mutationParserIndex).toBeLessThan(authMiddlewareIndex);

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

    test('should reject auth mutation requests with non-json content type when body is present', () => {
      const app = createApp();
      auth.init(app);

      const mutationMiddlewares = mockRouter.use.mock.calls.filter(
        (c, index) =>
          index > 0 && typeof c[0] === 'function' && c[0] !== auth.requireAuthentication,
      );
      expect(mutationMiddlewares).toHaveLength(2);

      const contentTypeGuard = mutationMiddlewares[0][0];
      const next = vi.fn();
      const res = createResponse();

      contentTypeGuard(
        {
          method: 'POST',
          headers: { 'content-length': '8' },
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
          headers: { 'content-length': '8' },
          is: vi.fn(() => true),
        },
        res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should register legacy public auth methods endpoint for compatibility with rate limiting', () => {
      const app = createApp();
      auth.init(app);

      const authLimiter = mockRouter.use.mock.calls[0][0];
      expect(app.get).toHaveBeenCalledWith('/api/auth/methods', authLimiter, expect.any(Function));
    });

    test('should register public auth status endpoints for login-time diagnostics', () => {
      const app = createApp();
      auth.init(app);

      const authLimiter = mockRouter.use.mock.calls[0][0];
      expect(app.get).toHaveBeenCalledWith(
        '/api/v1/auth/status',
        authLimiter,
        expect.any(Function),
      );
      expect(app.get).toHaveBeenCalledWith('/api/auth/status', authLimiter, expect.any(Function));
    });

    test('should include identity-aware key generator in auth limiter when enabled', () => {
      const keyGenerator = vi.fn(() => 'session:test');
      mockIsIdentityAwareRateLimitKeyingEnabled.mockReturnValue(true);
      mockCreateAuthenticatedRouteRateLimitKeyGenerator.mockReturnValue(keyGenerator);
      const app = createApp();

      auth.init(app);

      expect(mockRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          keyGenerator,
        }),
      );
    });

    test('should configure serialize and deserialize user', () => {
      const app = createApp();
      auth.init(app);

      // Test serializeUser callback
      const serializeCb = passport.serializeUser.mock.calls[0][0];
      const done = vi.fn();
      serializeCb({ username: 'test' }, done);
      expect(done).toHaveBeenCalledWith(null, JSON.stringify({ username: 'test' }));

      // Test deserializeUser callback
      const deserializeCb = passport.deserializeUser.mock.calls[0][0];
      const done2 = vi.fn();
      deserializeCb(JSON.stringify({ username: 'test' }), done2);
      expect(done2).toHaveBeenCalledWith(null, { username: 'test' });
    });

    test('should reject deserialized users when payload is not a JSON string', () => {
      const app = createApp();
      auth.init(app);

      const deserializeCb = passport.deserializeUser.mock.calls[0][0];
      const done = vi.fn();
      deserializeCb({ username: 'test' }, done);

      expect(done).toHaveBeenCalledWith(null, false);
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Serialized user must be a JSON string'),
      );
    });

    test('should reject deserialized users when payload JSON is malformed', () => {
      const app = createApp();
      auth.init(app);

      const deserializeCb = passport.deserializeUser.mock.calls[0][0];
      const done = vi.fn();
      deserializeCb('{"username"', done);

      expect(done).toHaveBeenCalledWith(null, false);
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Serialized user JSON is malformed'),
      );
    });

    test('should reject deserialized users with unexpected fields', () => {
      const app = createApp();
      auth.init(app);

      const deserializeCb = passport.deserializeUser.mock.calls[0][0];
      const done = vi.fn();
      deserializeCb(JSON.stringify({ username: 'test', role: 'admin' }), done);

      expect(done).toHaveBeenCalledWith(null, false);
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unable to deserialize session user'),
      );
    });

    test('should register /strategies, /status, /remember, /login, /logout, /user routes', () => {
      const app = createApp();
      registry.getState.mockReturnValue({ authentication: {} });
      auth.init(app);

      const getRoutes = mockRouter.get.mock.calls.map((c) => c[0]);
      const postRoutes = mockRouter.post.mock.calls.map((c) => c[0]);

      expect(getRoutes).toContain('/strategies');
      expect(getRoutes).toContain('/status');
      expect(getRoutes).toContain('/user');
      expect(postRoutes).toContain('/remember');
      expect(postRoutes).toContain('/login');
      expect(postRoutes).toContain('/logout');
    });

    test('should register /login before authentication middleware with authenticateLogin', () => {
      const app = createApp();
      auth.init(app);

      const loginRouteIndex = mockRouter.post.mock.calls.findIndex((c) => c[0] === '/login');
      const loginRouteOrder = mockRouter.post.mock.invocationCallOrder[loginRouteIndex];

      const authMiddlewareIndex = mockRouter.use.mock.calls.findIndex(
        (c) => c[0] === auth.requireAuthentication,
      );
      const authMiddlewareOrder = mockRouter.use.mock.invocationCallOrder[authMiddlewareIndex];

      expect(loginRouteIndex).toBeGreaterThanOrEqual(0);
      expect(authMiddlewareIndex).toBeGreaterThanOrEqual(0);
      expect(loginRouteOrder).toBeLessThan(authMiddlewareOrder);

      // Verify authenticateLogin is registered as route-level middleware
      const loginCall = mockRouter.post.mock.calls[loginRouteIndex];
      expect(loginCall).toHaveLength(3); // path, authenticateLogin, login
      expect(typeof loginCall[1]).toBe('function'); // authenticateLogin middleware
      expect(typeof loginCall[2]).toBe('function'); // login handler
    });

    test('should register /remember after authentication middleware', () => {
      const app = createApp();
      auth.init(app);

      const rememberRouteIndex = mockRouter.post.mock.calls.findIndex((c) => c[0] === '/remember');
      const rememberRouteOrder = mockRouter.post.mock.invocationCallOrder[rememberRouteIndex];

      const authMiddlewareIndex = mockRouter.use.mock.calls.findIndex(
        (c) => c[0] === auth.requireAuthentication,
      );
      const authMiddlewareOrder = mockRouter.use.mock.invocationCallOrder[authMiddlewareIndex];

      expect(rememberRouteIndex).toBeGreaterThanOrEqual(0);
      expect(authMiddlewareIndex).toBeGreaterThanOrEqual(0);
      expect(rememberRouteOrder).toBeGreaterThan(authMiddlewareOrder);
    });

    test('should configure store ttl for remember-me duration', () => {
      const app = createApp();
      auth.init(app);

      expect(mockLokiStore).toHaveBeenCalledWith(
        expect.objectContaining({
          ttl: 3600 * 24 * 30,
        }),
      );
    });

    test('should use DD_SESSION_SECRET when environment variable is set', () => {
      const app = createApp();
      const previousSessionSecret = process.env.DD_SESSION_SECRET;
      process.env.DD_SESSION_SECRET = 'session-secret-from-env';

      try {
        auth.init(app);
      } finally {
        if (previousSessionSecret === undefined) {
          delete process.env.DD_SESSION_SECRET;
        } else {
          process.env.DD_SESSION_SECRET = previousSessionSecret;
        }
      }

      expect(session).toHaveBeenCalledWith(
        expect.objectContaining({
          secret: 'session-secret-from-env',
        }),
      );
      expect(log.info).toHaveBeenCalledWith(
        'Using session secret from DD_SESSION_SECRET environment variable',
      );
    });

    test('should log an error when DD_SESSION_SECRET is missing in production', async () => {
      const previousSessionSecret = process.env.DD_SESSION_SECRET;
      const previousNodeEnv = process.env.NODE_ENV;
      delete process.env.DD_SESSION_SECRET;
      process.env.NODE_ENV = 'production';

      vi.resetModules();
      const freshAuth = await import('./auth.js');
      const freshLog = (await import('../log/index.js')).default;
      const app = createApp();

      try {
        freshAuth.init(app);
      } finally {
        if (previousSessionSecret === undefined) {
          delete process.env.DD_SESSION_SECRET;
        } else {
          process.env.DD_SESSION_SECRET = previousSessionSecret;
        }

        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }

      expect(freshLog.error).toHaveBeenCalledWith(
        'DD_SESSION_SECRET is not set; using an ephemeral session secret. Set DD_SESSION_SECRET to a strong persistent value.',
      );
    });

    test('should fall back to default lockout settings when env values are invalid', async () => {
      const previous = {
        account: process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS,
        ip: process.env.DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS,
        window: process.env.DD_AUTH_LOCKOUT_WINDOW_MS,
        duration: process.env.DD_AUTH_LOCKOUT_DURATION_MS,
      };
      process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS = 'NaN';
      process.env.DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS = '0';
      process.env.DD_AUTH_LOCKOUT_WINDOW_MS = '-1';
      process.env.DD_AUTH_LOCKOUT_DURATION_MS = 'oops';

      try {
        vi.resetModules();
        const freshAuth = await import('./auth.js');
        const freshPassport = (await import('passport')).default as any;
        freshAuth._resetStrategyIdsForTests();

        const app = createApp();
        freshAuth.init(app);
        freshPassport.authenticate.mockImplementation((_ids, _options, callback) => {
          return () => callback(null, false, undefined, 401);
        });

        const loginCall = mockRouter.post.mock.calls.find((c) => c[0] === '/login');
        const authenticateLoginFn = loginCall[1];
        const req = {
          body: { username: 'fallback-user' },
          ip: '203.0.113.17',
        };

        const first = createResponse();
        authenticateLoginFn(req, first, vi.fn());
        expect(first.status).toHaveBeenCalledWith(401);
      } finally {
        process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS = previous.account;
        process.env.DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS = previous.ip;
        process.env.DD_AUTH_LOCKOUT_WINDOW_MS = previous.window;
        process.env.DD_AUTH_LOCKOUT_DURATION_MS = previous.duration;
      }
    });

    test('should accept positive lockout settings from env', async () => {
      const previous = {
        account: process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS,
        ip: process.env.DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS,
        window: process.env.DD_AUTH_LOCKOUT_WINDOW_MS,
        duration: process.env.DD_AUTH_LOCKOUT_DURATION_MS,
      };
      process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS = '1';
      process.env.DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS = '1';
      process.env.DD_AUTH_LOCKOUT_WINDOW_MS = '900000';
      process.env.DD_AUTH_LOCKOUT_DURATION_MS = '900000';

      try {
        vi.resetModules();
        const freshAuth = await import('./auth.js');
        const freshPassport = (await import('passport')).default as any;
        freshAuth._resetStrategyIdsForTests();

        const app = createApp();
        freshAuth.init(app);
        freshPassport.authenticate.mockImplementation((_ids, _options, callback) => {
          return () => callback(null, false, undefined, 401);
        });

        const loginCall = mockRouter.post.mock.calls.find((c) => c[0] === '/login');
        const authenticateLoginFn = loginCall[1];
        const req = {
          body: { username: 'single-attempt-user' },
          ip: '203.0.113.18',
        };

        const first = createResponse();
        authenticateLoginFn(req, first, vi.fn());
        expect(first.status).toHaveBeenCalledWith(401);

        const second = createResponse();
        authenticateLoginFn(req, second, vi.fn());
        expect(second.status).toHaveBeenCalledWith(423);
      } finally {
        process.env.DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS = previous.account;
        process.env.DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS = previous.ip;
        process.env.DD_AUTH_LOCKOUT_WINDOW_MS = previous.window;
        process.env.DD_AUTH_LOCKOUT_DURATION_MS = previous.duration;
      }
    });
  });

  describe('route handlers', () => {
    test('getStrategies should return unique sorted strategies', () => {
      const mockAuth1 = {
        getId: vi.fn(() => 'basic.b'),
        getStrategy: vi.fn(() => ({})),
        getStrategyDescription: vi.fn(() => ({
          type: 'basic',
          name: 'b',
        })),
      };
      const mockAuth2 = {
        getId: vi.fn(() => 'oauth.a'),
        getStrategy: vi.fn(() => ({})),
        getStrategyDescription: vi.fn(() => ({
          type: 'oauth',
          name: 'a',
        })),
      };
      // Duplicate to test dedup
      const mockAuth3 = {
        getId: vi.fn(() => 'basic.b2'),
        getStrategy: vi.fn(() => ({})),
        getStrategyDescription: vi.fn(() => ({
          type: 'basic',
          name: 'b',
        })),
      };
      registry.getState.mockReturnValue({
        authentication: {
          'basic.b': mockAuth1,
          'oauth.a': mockAuth2,
          'basic.b2': mockAuth3,
        },
      });

      const app = createApp();
      auth.init(app);

      const strategiesCall = mockRouter.get.mock.calls.find((c) => c[0] === '/strategies');
      const handler = strategiesCall[1];
      const res = createResponse();
      handler({}, res);

      // Should be sorted by name and deduplicated, wrapped in { strategies, warnings }
      expect(res.json).toHaveBeenCalledWith({
        strategies: [
          { type: 'oauth', name: 'a' },
          { type: 'basic', name: 'b' },
        ],
        warnings: [],
      });
    });

    test('getStrategies should deduplicate with near-linear type lookups', () => {
      let typeReads = 0;
      const authentication = Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => {
          const id = `oauth.${index}`;
          return [
            id,
            {
              getId: vi.fn(() => id),
              getStrategy: vi.fn(() => ({})),
              getStrategyDescription: vi.fn(() => {
                const strategy = {};
                Object.defineProperty(strategy, 'type', {
                  enumerable: true,
                  get: () => {
                    typeReads += 1;
                    return 'oauth';
                  },
                });
                Object.defineProperty(strategy, 'name', {
                  enumerable: true,
                  value: `provider-${String(index).padStart(2, '0')}`,
                });
                return strategy;
              }),
            },
          ];
        }),
      );
      registry.getState.mockReturnValue({ authentication });

      const app = createApp();
      auth.init(app);
      const strategiesCall = mockRouter.get.mock.calls.find((c) => c[0] === '/strategies');
      const handler = strategiesCall[1];
      const res = createResponse();
      handler({}, res);

      expect(res.json).toHaveBeenCalled();
      expect(typeReads).toBeLessThanOrEqual(80);
    });

    test('getStatus should return providers and auth registration errors', () => {
      registry.getState.mockReturnValue({
        authentication: {
          'oauth.provider': {
            getId: vi.fn(() => 'oauth.provider'),
            getStrategy: vi.fn(() => ({})),
            getStrategyDescription: vi.fn(() => ({
              type: 'oauth',
              name: 'provider',
              logoutUrl: 'https://logout.example.com',
            })),
          },
        },
      });
      registry.getAuthenticationRegistrationErrors.mockReturnValue([
        { provider: 'basic:andi', error: 'hash is required' },
      ]);
      const app = createApp();
      auth.init(app);

      const statusCall = mockRouter.get.mock.calls.find((c) => c[0] === '/status');
      const handler = statusCall[1];
      const res = createResponse();
      handler({}, res);

      expect(res.json).toHaveBeenCalledWith({
        providers: [{ type: 'oauth', name: 'provider', logoutUrl: 'https://logout.example.com' }],
        errors: [{ provider: 'basic:andi', error: 'hash is required' }],
      });
    });

    test('getUser should return req.user when present', () => {
      const handler = getRouteHandler('get', '/user');
      const res = createResponse();
      handler({ user: { username: 'john' } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
      const contractValidation = validateOpenApiJsonResponse({
        path: '/auth/user',
        method: 'get',
        statusCode: '200',
        payload: res.json.mock.calls[0][0],
      });
      expect(contractValidation.valid).toBe(true);
      expect(contractValidation.errors).toStrictEqual([]);
    });

    test('getUser should set no-store cache headers', () => {
      const handler = getRouteHandler('get', '/user');
      const res = createResponse();
      handler({ user: { username: 'john' } }, res);
      expect(res.set).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-cache, no-store, must-revalidate',
      );
      expect(res.set).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(res.set).toHaveBeenCalledWith('Expires', '0');
    });

    test('getUser should return anonymous when no user on request', () => {
      const handler = getRouteHandler('get', '/user');
      const res = createResponse();
      handler({}, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'anonymous' });
    });

    test('login should return user info', async () => {
      const handler = getRouteHandler('post', '/login');
      const res = createResponse();
      const req = {
        user: { username: 'john' },
        session: { cookie: {}, regenerate: vi.fn((done) => done()) },
        login: vi.fn((_user, done) => done()),
      };
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'success',
        }),
      );
    });

    test('login should regenerate session and rebind authenticated user', async () => {
      const handler = getRouteHandler('post', '/login');
      const res = createResponse();
      const req = {
        body: { remember: true },
        user: { username: 'john' },
        session: { cookie: {}, regenerate: vi.fn() },
        login: vi.fn((_user, done) => done()),
      };
      req.session.regenerate.mockImplementation((done) => done());

      await handler(req, res);

      expect(req.session.regenerate).toHaveBeenCalledTimes(1);
      expect(req.login).toHaveBeenCalledWith({ username: 'john' }, expect.any(Function));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
    });

    test('login should return user without req.login when session is already established', async () => {
      const handler = getRouteHandler('post', '/login');
      const res = createResponse();
      const req = {
        user: { username: 'john' },
        session: { regenerate: vi.fn((done) => done()) },
      };

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'success',
        }),
      );
    });

    test('login should continue without session-limit enforcement for blank usernames', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: { username: '   ' },
        session: { regenerate: vi.fn((done) => done()) },
        sessionStore: {
          all: vi.fn(),
          destroy: vi.fn(),
        },
      };
      const res = createResponse();

      await handler(req, res);

      expect(req.sessionStore.all).not.toHaveBeenCalled();
      expect(req.sessionStore.destroy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: '   ' });
    });

    test('login should continue without session-limit enforcement when username is missing', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: {},
        session: { regenerate: vi.fn((done) => done()) },
        sessionStore: {
          all: vi.fn(),
          destroy: vi.fn(),
        },
      };
      const res = createResponse();

      await handler(req, res);

      expect(req.sessionStore.all).not.toHaveBeenCalled();
      expect(req.sessionStore.destroy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({});
    });

    test('setRememberMe should persist preference on session', () => {
      const handler = getRouteHandler('post', '/remember');
      const req = {
        body: { remember: true },
        session: {},
      };
      const res = createResponse();

      handler(req, res);

      expect(req.session.rememberMe).toBe(true);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    test('setRememberMe should update cookie maxAge for the current session', () => {
      const handler = getRouteHandler('post', '/remember');
      const req = {
        body: { remember: true },
        session: {
          cookie: { maxAge: 12345 },
        },
      };
      const res = createResponse();

      handler(req, res);

      expect(req.session.rememberMe).toBe(true);
      expect(req.session.cookie.maxAge).toBe(3600 * 1000 * 24 * 30);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    test('setRememberMe should return 500 when session is unavailable', () => {
      const handler = getRouteHandler('post', '/remember');
      const req = {
        body: { remember: true },
      };
      const res = createResponse();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to access session' });
    });

    test('login should apply remember-me cookie max age', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        body: { remember: true },
        user: { username: 'john' },
        session: { cookie: {}, regenerate: vi.fn((done) => done()) },
        login: vi.fn((_user, done) => done()),
      };
      const res = createResponse();

      await handler(req, res);

      expect(req.session.rememberMe).toBe(true);
      expect(req.session.cookie.maxAge).toBe(3600 * 1000 * 24 * 30);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
    });

    test('login should convert remember-me cookie to a session cookie when remember is false', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        body: { remember: false },
        user: { username: 'john' },
        session: {
          rememberMe: true,
          cookie: { maxAge: 12345, expires: new Date() },
          regenerate: vi.fn((done) => done()),
        },
        login: vi.fn((_user, done) => done()),
      };
      const res = createResponse();

      await handler(req, res);

      expect(req.session.rememberMe).toBe(false);
      expect(req.session.cookie.expires).toBe(false);
      expect(req.session.cookie.maxAge).toBeNull();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
    });

    test('login should evict oldest sessions when concurrent session cap is reached', async () => {
      mockGetServerConfiguration.mockReturnValue({
        cookie: {},
        session: {
          maxconcurrentsessions: 2,
        },
      });

      const handler = getRouteHandler('post', '/login');
      const req = {
        body: { remember: true },
        user: { username: 'john' },
        sessionID: 'newly-regenerated-session',
        session: { cookie: {}, regenerate: vi.fn((done) => done()) },
        sessionStore: {
          all: vi.fn((done) =>
            done(null, {
              'session-oldest': {
                passport: {
                  user: JSON.stringify({ username: 'john' }),
                },
                cookie: {
                  expires: '2026-01-01T00:00:00.000Z',
                },
              },
              'session-newer': {
                passport: {
                  user: JSON.stringify({ username: 'john' }),
                },
                cookie: {
                  expires: '2026-01-02T00:00:00.000Z',
                },
              },
              'other-user-session': {
                passport: {
                  user: JSON.stringify({ username: 'jane' }),
                },
                cookie: {
                  expires: '2026-01-03T00:00:00.000Z',
                },
              },
            }),
          ),
          destroy: vi.fn((_sid, done) => done()),
        },
        login: vi.fn((_user, done) => done()),
      };
      const res = createResponse();

      await handler(req, res);

      expect(req.sessionStore.destroy).toHaveBeenCalledTimes(1);
      expect(req.sessionStore.destroy).toHaveBeenCalledWith('session-oldest', expect.any(Function));
      expect(req.login).toHaveBeenCalledWith({ username: 'john' }, expect.any(Function));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
    });

    test('login should serialize concurrent session enforcement per user', async () => {
      mockGetServerConfiguration.mockReturnValue({
        cookie: {},
        session: {
          maxconcurrentsessions: 2,
        },
      });

      const handler = getRouteHandler('post', '/login');
      const sessions = {
        'session-existing': {
          passport: {
            user: JSON.stringify({ username: 'john' }),
          },
          cookie: {
            expires: '2026-01-01T00:00:00.000Z',
          },
        },
      };
      const sessionStore = {
        all: vi.fn((done) => done(null, sessions)),
        destroy: vi.fn((sid, done) => {
          delete sessions[sid];
          done();
        }),
      };
      const createLoginRequest = (sessionId) => ({
        body: { remember: true },
        user: { username: 'john' },
        sessionID: sessionId,
        session: { cookie: {}, regenerate: vi.fn((done) => done()) },
        sessionStore,
        login: vi.fn((_user, done) => {
          sessions[sessionId] = {
            passport: {
              user: JSON.stringify({ username: 'john' }),
            },
            cookie: {
              expires: '2026-01-04T00:00:00.000Z',
            },
          };
          done();
        }),
      });
      const req1 = createLoginRequest('new-session-1');
      const req2 = createLoginRequest('new-session-2');
      const res1 = createResponse();
      const res2 = createResponse();

      await Promise.all([handler(req1, res1), handler(req2, res2)]);

      const userSessions = Object.values(sessions).filter((storedSession) => {
        const rawUser = storedSession.passport?.user;
        if (typeof rawUser !== 'string') {
          return false;
        }
        try {
          return JSON.parse(rawUser).username === 'john';
        } catch {
          return false;
        }
      });

      expect(req1.login).toHaveBeenCalledWith({ username: 'john' }, expect.any(Function));
      expect(req2.login).toHaveBeenCalledWith({ username: 'john' }, expect.any(Function));
      expect(sessionStore.destroy).toHaveBeenCalledTimes(1);
      expect(sessionStore.destroy).toHaveBeenCalledWith('session-existing', expect.any(Function));
      expect(userSessions).toHaveLength(2);
      expect(res1.status).toHaveBeenCalledWith(200);
      expect(res1.json).toHaveBeenCalledWith({ username: 'john' });
      expect(res2.status).toHaveBeenCalledWith(200);
      expect(res2.json).toHaveBeenCalledWith({ username: 'john' });
    });

    test('login should keep max=1 cap under concurrent logins that both require eviction', async () => {
      mockGetServerConfiguration.mockReturnValue({
        cookie: {},
        session: {
          maxconcurrentsessions: 1,
        },
      });

      const handler = getRouteHandler('post', '/login');
      const sessions = {
        'session-existing': {
          passport: {
            user: JSON.stringify({ username: 'john' }),
          },
          cookie: {
            expires: '2026-01-01T00:00:00.000Z',
          },
        },
      };
      const sessionStore = {
        all: vi.fn((done) => done(null, sessions)),
        destroy: vi.fn((sid, done) => {
          delete sessions[sid];
          setTimeout(() => done(), 5);
        }),
      };
      const createLoginRequest = (sessionId, expires) => ({
        body: { remember: true },
        user: { username: 'john' },
        sessionID: sessionId,
        session: { cookie: {}, regenerate: vi.fn((done) => done()) },
        sessionStore,
        login: vi.fn((_user, done) => {
          sessions[sessionId] = {
            passport: {
              user: JSON.stringify({ username: 'john' }),
            },
            cookie: {
              expires,
            },
          };
          done();
        }),
      });
      const req1 = createLoginRequest('new-session-1', '2026-01-02T00:00:00.000Z');
      const req2 = createLoginRequest('new-session-2', '2026-01-03T00:00:00.000Z');
      const res1 = createResponse();
      const res2 = createResponse();

      await Promise.all([handler(req1, res1), handler(req2, res2)]);

      const userSessionIds = Object.entries(sessions)
        .filter(([, storedSession]) => {
          const rawUser = storedSession.passport?.user;
          if (typeof rawUser !== 'string') {
            return false;
          }
          try {
            return JSON.parse(rawUser).username === 'john';
          } catch {
            return false;
          }
        })
        .map(([sid]) => sid)
        .sort();

      expect(req1.login).toHaveBeenCalledWith({ username: 'john' }, expect.any(Function));
      expect(req2.login).toHaveBeenCalledWith({ username: 'john' }, expect.any(Function));
      expect(sessionStore.destroy).toHaveBeenCalledTimes(2);
      expect(sessionStore.destroy).toHaveBeenNthCalledWith(
        1,
        'session-existing',
        expect.any(Function),
      );
      expect(sessionStore.destroy).toHaveBeenNthCalledWith(
        2,
        'new-session-1',
        expect.any(Function),
      );
      expect(userSessionIds).toEqual(['new-session-2']);
      expect(res1.status).toHaveBeenCalledWith(200);
      expect(res1.json).toHaveBeenCalledWith({ username: 'john' });
      expect(res2.status).toHaveBeenCalledWith(200);
      expect(res2.json).toHaveBeenCalledWith({ username: 'john' });
    });

    test('login should return 500 when concurrent session enforcement fails', async () => {
      mockGetServerConfiguration.mockReturnValue({
        cookie: {},
        session: {
          maxconcurrentsessions: 1,
        },
      });

      const handler = getRouteHandler('post', '/login');
      const req = {
        body: { remember: true },
        user: { username: 'john' },
        sessionID: 'newly-regenerated-session',
        session: { cookie: {}, regenerate: vi.fn((done) => done()) },
        sessionStore: {
          all: vi.fn((done) =>
            done(null, {
              'session-existing': {
                passport: {
                  user: JSON.stringify({ username: 'john' }),
                },
                cookie: {
                  expires: '2026-01-01T00:00:00.000Z',
                },
              },
            }),
          ),
          destroy: vi.fn((_sid, done) => done(new Error('destroy failed'))),
        },
        login: vi.fn((_user, done) => done()),
      };
      const res = createResponse();

      await handler(req, res);

      expect(req.login).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to establish session' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'error',
          details: expect.stringContaining('session limit'),
        }),
      );
    });

    test('login should return 500 when session-limit enforcement throws synchronously', async () => {
      const enforceSessionLimitSpy = vi
        .spyOn(authSession, 'enforceSessionLimitBeforeLogin')
        .mockImplementation(() => {
          throw new Error('session limit threw synchronously');
        });

      try {
        const handler = getRouteHandler('post', '/login');
        const req = {
          body: { remember: true },
          user: { username: 'john' },
          session: { cookie: {}, regenerate: vi.fn((done) => done()) },
          sessionStore: {
            all: vi.fn(),
            destroy: vi.fn(),
          },
          login: vi.fn((_user, done) => done()),
        };
        const res = createResponse();

        await handler(req, res);

        expect(req.login).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unable to establish session' });
        expect(log.warn).toHaveBeenCalledWith(
          'Unable to enforce session limit (session limit threw synchronously)',
        );
      } finally {
        enforceSessionLimitSpy.mockRestore();
      }
    });

    test('login should record failed login audit when session is unavailable', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: { username: 'john' },
      };
      const res = createResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to establish session' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'error',
          details: expect.stringContaining('session unavailable'),
        }),
      );
    });

    test('login should record failed login audit when session regeneration fails', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: { username: 'john' },
        session: {
          cookie: {},
          regenerate: vi.fn((done) => done(new Error('regenerate failed'))),
        },
      };
      const res = createResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to establish session' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'error',
          details: expect.stringContaining('regenerate failed'),
        }),
      );
    });

    test('login should record failed login audit when session regeneration throws synchronously', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: { username: 'john' },
        session: {
          cookie: {},
          regenerate: vi.fn(() => {
            throw new Error('regenerate threw');
          }),
        },
      };
      const res = createResponse();

      await expect(handler(req, res)).resolves.toBeUndefined();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to establish session' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'error',
          details: expect.stringContaining('regenerate threw'),
        }),
      );
    });

    test('login should resolve when session regenerate callback is invoked more than once', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: { username: 'john' },
        session: {
          cookie: {},
          regenerate: vi.fn((done) => {
            done(new Error('first regeneration failure'));
            done(new Error('second regeneration failure'));
          }),
        },
      };
      const res = createResponse();

      await expect(handler(req, res)).resolves.toBeUndefined();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to establish session' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'error',
          details: expect.stringContaining('first regeneration failure'),
        }),
      );
    });

    test('login should fail when session is unavailable after regenerate callback', async () => {
      const handler = getRouteHandler('post', '/login');
      const req: any = {
        user: { username: 'john' },
        session: {
          cookie: {},
          regenerate: vi.fn((done) => {
            req.session = undefined;
            done();
          }),
        },
      };
      const res = createResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to establish session' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'error',
          details: expect.stringContaining('persist session after regeneration'),
        }),
      );
    });

    test('login should record failed login audit when req.login fails', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: { username: 'john' },
        session: {
          cookie: {},
          regenerate: vi.fn((done) => done()),
        },
        login: vi.fn((_user, done) => done(new Error('persist failed'))),
      };
      const res = createResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to establish session' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'error',
          details: expect.stringContaining('persist failed'),
        }),
      );
    });

    test('login should record failed login audit when req.login throws synchronously', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: { username: 'john' },
        session: {
          cookie: {},
          regenerate: vi.fn((done) => done()),
        },
        login: vi.fn(() => {
          throw new Error('persist threw');
        }),
      };
      const res = createResponse();

      await expect(handler(req, res)).resolves.toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to establish session' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'error',
          details: expect.stringContaining('persist threw'),
        }),
      );
    });

    test('login should resolve when req.login callback fails and then throws', async () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: { username: 'john' },
        session: {
          cookie: {},
          regenerate: vi.fn((done) => done()),
        },
        login: vi.fn((_user, done) => {
          done(new Error('persist failed'));
          throw new Error('persist threw after callback');
        }),
      };
      const res = createResponse();

      await expect(handler(req, res)).resolves.toBeUndefined();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to establish session' });
    });

    test('logout should regenerate session after req.logout and return logoutUrl', () => {
      const handler = getRouteHandler('post', '/logout');
      const req = {
        logout: vi.fn((done) => {
          done();
        }),
        session: {
          regenerate: vi.fn((done) => done()),
        },
      };
      const res = createResponse();
      handler(req, res);
      expect(req.logout).toHaveBeenCalled();
      expect(req.session.regenerate).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        logoutUrl: 'https://logout.example.com',
      });
    });

    test('logout should return undefined logoutUrl when no strategy has one', () => {
      registry.getState.mockReturnValue({ authentication: {} });

      const app = createApp();
      auth.init(app);

      const logoutCall = mockRouter.post.mock.calls.find((c) => c[0] === '/logout');
      const handler = logoutCall[1];
      const req = {
        logout: vi.fn((done) => done()),
        session: {
          regenerate: vi.fn((done) => done()),
        },
      };
      const res = createResponse();
      handler(req, res);
      expect(res.json).toHaveBeenCalledWith({ logoutUrl: undefined });
    });

    test('logout should return 500 when session regeneration fails', () => {
      const handler = getRouteHandler('post', '/logout');
      const req = {
        logout: vi.fn((done) => {
          done();
        }),
        session: {
          regenerate: vi.fn((done) => done(new Error('regeneration failed'))),
        },
      };
      const res = createResponse();

      handler(req, res);

      expect(req.session.regenerate).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to clear session' });
    });

    test('logout should return 500 when req.logout fails', () => {
      const handler = getRouteHandler('post', '/logout');
      const req = {
        logout: vi.fn((done) => done(new Error('logout failed'))),
        session: {
          regenerate: vi.fn((done) => done()),
        },
      };
      const res = createResponse();

      handler(req, res);

      expect(req.logout).toHaveBeenCalled();
      expect(req.session.regenerate).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to clear session' });
    });

    test('logout should return 500 when session regenerate is unavailable', () => {
      const handler = getRouteHandler('post', '/logout');
      const req = {
        logout: vi.fn((done) => done()),
      };
      const res = createResponse();

      handler(req, res);

      expect(req.logout).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to clear session' });
    });
  });
});
