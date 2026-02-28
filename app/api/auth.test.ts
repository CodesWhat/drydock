// @ts-nocheck
const { mockRouter, mockLokiStore } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
  mockLokiStore: vi.fn(),
}));
const mockGetServerConfiguration = vi.hoisted(() => vi.fn(() => ({ cookie: {} })));

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

import session from 'express-session';
import log from '../log/index.js';
import passport from 'passport';
import * as registry from '../registry/index.js';
import * as auth from './auth.js';

function createApp() {
  return {
    use: vi.fn(),
    set: vi.fn(),
  };
}

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    sendStatus: vi.fn(),
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

    test('should mount auth routes on the app', () => {
      const app = createApp();
      auth.init(app);

      expect(app.use).toHaveBeenCalledWith('/auth', expect.anything());
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
      handler({ user: { username: 'john' } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
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
        session: { cookie: {} },
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
        session: { rememberMe: true, cookie: { maxAge: 12345, expires: new Date() } },
      };
      const res = createResponse();

      handler(req, res);

      expect(req.session.rememberMe).toBe(false);
      expect(req.session.cookie.expires).toBe(false);
      expect(req.session.cookie.maxAge).toBeNull();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ username: 'john' });
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
