// @ts-nocheck
const { mockRouter } = vi.hoisted(() => ({
    mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

vi.mock('express', () => ({
    default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('express-session', () => ({
    default: vi.fn(() => 'session-middleware'),
}));

vi.mock('connect-loki', () => ({
    default: vi.fn(() => vi.fn()),
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

vi.mock('../log', () => ({ default: { warn: vi.fn() } }));

vi.mock('../configuration', () => ({
    getVersion: vi.fn(() => '1.0.0'),
}));

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

            expect(passport.authenticate).toHaveBeenCalledWith(
                auth.getAllIds(),
                { session: true },
            );
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

        test('should register /strategies, /login, /logout, /user routes', () => {
            const app = createApp();
            registry.getState.mockReturnValue({ authentication: {} });
            auth.init(app);

            const getRoutes = mockRouter.get.mock.calls.map((c) => c[0]);
            const postRoutes = mockRouter.post.mock.calls.map((c) => c[0]);

            expect(getRoutes).toContain('/strategies');
            expect(getRoutes).toContain('/user');
            expect(postRoutes).toContain('/login');
            expect(postRoutes).toContain('/logout');
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

            const strategiesCall = mockRouter.get.mock.calls.find(
                (c) => c[0] === '/strategies',
            );
            const handler = strategiesCall[1];
            const res = createResponse();
            handler({}, res);

            // Should be sorted by name and deduplicated
            expect(res.json).toHaveBeenCalledWith([
                { type: 'oauth', name: 'a' },
                { type: 'basic', name: 'b' },
            ]);
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

        test('logout should call req.logout and return logoutUrl', () => {
            const handler = getRouteHandler('post', '/logout');
            const req = { logout: vi.fn() };
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

            const logoutCall = mockRouter.post.mock.calls.find(
                (c) => c[0] === '/logout',
            );
            const handler = logoutCall[1];
            const req = { logout: vi.fn() };
            const res = createResponse();
            handler(req, res);
            expect(res.json).toHaveBeenCalledWith({ logoutUrl: undefined });
        });
    });
});
