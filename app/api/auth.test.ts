const { mockRouter, mockLokiStore } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
  mockLokiStore: vi.fn(),
}));
const mockGetServerConfiguration = vi.hoisted(() => vi.fn(() => ({ cookie: {} })));
const mockRecordAuditEvent = vi.hoisted(() => vi.fn());

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('express-session', () => ({
  default: vi.fn(() => 'session-middleware'),
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

vi.mock('getmac', () => ({
  default: vi.fn(() => '00:00:00:00:00:00'),
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
}));

vi.mock('../log', () => ({ default: { warn: vi.fn(), info: vi.fn() } }));

vi.mock('../configuration', () => ({
  getVersion: vi.fn(() => '1.0.0'),
  getServerConfiguration: mockGetServerConfiguration,
}));
vi.mock('./audit-events.js', () => ({
  recordAuditEvent: mockRecordAuditEvent,
}));

import session from 'express-session';
import passport from 'passport';
import log from '../log/index.js';
import * as registry from '../registry/index.js';
import * as auth from './auth.js';

function createApp() {
  return {
    use: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
}

function createResponse() {
  return {
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
  return call ? call[1] : undefined;
}

describe('Auth Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the strategy IDs array between tests
    auth.getAllIds().length = 0;
    mockGetServerConfiguration.mockReturnValue({ cookie: {} });
  });

  describe('getAllIds', () => {
    test('should return strategy ids array', () => {
      const ids = auth.getAllIds();
      expect(Array.isArray(ids)).toBe(true);
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

    test('should record failed login audit when credentials are invalid', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const req = {
        isAuthenticated: vi.fn(() => false),
        method: 'POST',
        path: '/login',
      };
      const res = createResponse();
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

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
      expect(res.sendStatus).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('should call next with login authentication errors', () => {
      const error = new Error('auth blew up');
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(error, false, undefined, 500);
      });

      const req = {
        isAuthenticated: vi.fn(() => false),
        method: 'POST',
        path: '/login',
      };
      const res = createResponse();
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    });

    test('should continue to login handler when login credentials are valid', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, { username: 'john' }, undefined, 200);
      });

      const req = {
        isAuthenticated: vi.fn(() => false),
        method: 'POST',
        path: '/login',
        login: vi.fn((user, options, done) => {
          req.user = user;
          done();
        }),
      };
      const res = createResponse();
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

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

    test('should continue when login credentials are valid and req.login is unavailable', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, { username: 'john' }, undefined, 200);
      });

      const req = {
        isAuthenticated: vi.fn(() => false),
        method: 'POST',
        path: '/login',
      };
      const res = createResponse();
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

      expect(req.user).toEqual({ username: 'john' });
      expect(next).toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
    });

    test('should call next with req.login errors while validating login credentials', () => {
      const loginError = new Error('login callback failed');
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, { username: 'john' }, undefined, 200);
      });

      const req = {
        isAuthenticated: vi.fn(() => false),
        method: 'POST',
        path: '/login',
        login: vi.fn((_user, _options, done) => done(loginError)),
      };
      const res = createResponse();
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

      expect(next).toHaveBeenCalledWith(loginError);
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
      expect(res.sendStatus).not.toHaveBeenCalled();
    });

    test('should handle login requests even when response has no sendStatus/end helpers', () => {
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

      expect(authMiddleware).toHaveBeenCalledWith(req, res, next);
    });

    test('should fall back to res.status(401).end() when sendStatus is unavailable', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const statusEnd = vi.fn();
      const req = {
        isAuthenticated: vi.fn(() => false),
        method: 'POST',
        path: '/login',
      };
      const res = {
        status: vi.fn(() => ({ end: statusEnd })),
      };
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(statusEnd).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });

    test('should fall back to res.end with statusCode when status response has no end', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const req = {
        isAuthenticated: vi.fn(() => false),
        method: 'POST',
        path: '/login',
      };
      const res = {
        status: vi.fn(() => ({})),
        end: vi.fn(),
        statusCode: 200,
      };
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.statusCode).toBe(401);
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });

    test('should set statusCode when no response helpers are available', () => {
      passport.authenticate.mockImplementation((_ids, _options, callback) => {
        return () => callback(null, false, undefined, 401);
      });

      const req = {
        isAuthenticated: vi.fn(() => false),
        method: 'POST',
        path: '/login',
      };
      const res = {
        statusCode: 200,
      };
      const next = vi.fn();

      auth.requireAuthentication(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
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

    test('should force secure cookies when sameSite is none', () => {
      mockGetServerConfiguration.mockReturnValue({ cookie: { samesite: 'none' } });
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

    test('should register legacy public auth methods endpoint for compatibility', () => {
      const app = createApp();
      auth.init(app);

      expect(app.get).toHaveBeenCalledWith('/api/auth/methods', expect.any(Function));
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

    test('should register /strategies, /remember, /login, /logout, /user routes', () => {
      const app = createApp();
      registry.getState.mockReturnValue({ authentication: {} });
      auth.init(app);

      const getRoutes = mockRouter.get.mock.calls.map((c) => c[0]);
      const postRoutes = mockRouter.post.mock.calls.map((c) => c[0]);

      expect(getRoutes).toContain('/strategies');
      expect(getRoutes).toContain('/user');
      expect(postRoutes).toContain('/remember');
      expect(postRoutes).toContain('/login');
      expect(postRoutes).toContain('/logout');
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

      // Should be sorted by name and deduplicated
      expect(res.json).toHaveBeenCalledWith([
        { type: 'oauth', name: 'a' },
        { type: 'basic', name: 'b' },
      ]);
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

    test('getUser should return req.user when present', () => {
      const handler = getRouteHandler('get', '/user');
      const res = createResponse();
      handler({ user: { username: 'john' } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
    });

    test('getUser should return anonymous when no user on request', () => {
      const handler = getRouteHandler('get', '/user');
      const res = createResponse();
      handler({}, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'anonymous' });
    });

    test('login should return user info', () => {
      const handler = getRouteHandler('post', '/login');
      const res = createResponse();
      const req = {
        user: { username: 'john' },
        session: { cookie: {}, regenerate: vi.fn((done) => done()) },
        login: vi.fn((_user, done) => done()),
      };
      handler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'success',
        }),
      );
    });

    test('login should regenerate session and rebind authenticated user', () => {
      const handler = getRouteHandler('post', '/login');
      const res = createResponse();
      const req = {
        body: { remember: true },
        user: { username: 'john' },
        session: { cookie: {}, regenerate: vi.fn() },
        login: vi.fn((_user, done) => done()),
      };
      req.session.regenerate.mockImplementation((done) => done());

      handler(req, res);

      expect(req.session.regenerate).toHaveBeenCalledTimes(1);
      expect(req.login).toHaveBeenCalledWith({ username: 'john' }, expect.any(Function));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
    });

    test('login should return user without req.login when session is already established', () => {
      const handler = getRouteHandler('post', '/login');
      const res = createResponse();
      const req = {
        user: { username: 'john' },
        session: { regenerate: vi.fn((done) => done()) },
      };

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth-login',
          status: 'success',
        }),
      );
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

    test('login should apply remember-me cookie max age', () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        body: { remember: true },
        user: { username: 'john' },
        session: { cookie: {}, regenerate: vi.fn((done) => done()) },
        login: vi.fn((_user, done) => done()),
      };
      const res = createResponse();

      handler(req, res);

      expect(req.session.rememberMe).toBe(true);
      expect(req.session.cookie.maxAge).toBe(3600 * 1000 * 24 * 30);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
    });

    test('login should convert remember-me cookie to a session cookie when remember is false', () => {
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

      handler(req, res);

      expect(req.session.rememberMe).toBe(false);
      expect(req.session.cookie.expires).toBe(false);
      expect(req.session.cookie.maxAge).toBeNull();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
    });

    test('login should record failed login audit when session is unavailable', () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: { username: 'john' },
      };
      const res = createResponse();

      handler(req, res);

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

    test('login should record failed login audit when session regeneration fails', () => {
      const handler = getRouteHandler('post', '/login');
      const req = {
        user: { username: 'john' },
        session: {
          cookie: {},
          regenerate: vi.fn((done) => done(new Error('regenerate failed'))),
        },
      };
      const res = createResponse();

      handler(req, res);

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

    test('login should record failed login audit when req.login fails', () => {
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

      handler(req, res);

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

    test('logout should call req.logout and return logoutUrl', () => {
      const handler = getRouteHandler('post', '/logout');
      const req = {
        logout: vi.fn((done) => {
          done();
        }),
      };
      const res = createResponse();
      handler(req, res);
      expect(req.logout).toHaveBeenCalled();
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
      const req = { logout: vi.fn() };
      const res = createResponse();
      handler(req, res);
      expect(res.json).toHaveBeenCalledWith({ logoutUrl: undefined });
    });
  });
});
