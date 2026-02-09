// @ts-nocheck
// Mock all the router modules
jest.mock('express', () => ({
    Router: jest.fn(() => ({
        use: jest.fn(),
        get: jest.fn(),
    })),
}));

jest.mock('./app', () => ({
    init: jest.fn(() => ({ use: jest.fn(), get: jest.fn() })),
}));
jest.mock('./container', () => ({
    init: jest.fn(() => ({ use: jest.fn(), get: jest.fn() })),
}));
jest.mock('./watcher', () => ({
    init: jest.fn(() => ({ use: jest.fn(), get: jest.fn() })),
}));
jest.mock('./trigger', () => ({
    init: jest.fn(() => ({ use: jest.fn(), get: jest.fn() })),
}));
jest.mock('./registry', () => ({
    init: jest.fn(() => ({ use: jest.fn(), get: jest.fn() })),
}));
jest.mock('./authentication', () => ({
    init: jest.fn(() => ({ use: jest.fn(), get: jest.fn() })),
}));
jest.mock('./log', () => ({
    init: jest.fn(() => ({ use: jest.fn(), get: jest.fn() })),
}));
jest.mock('./store', () => ({
    init: jest.fn(() => ({ use: jest.fn(), get: jest.fn() })),
}));
jest.mock('./server', () => ({
    init: jest.fn(() => ({ use: jest.fn(), get: jest.fn() })),
}));
jest.mock('./agent', () => ({
    init: jest.fn(() => ({ use: jest.fn(), get: jest.fn() })),
}));
jest.mock('./auth', () => ({
    requireAuthentication: jest.fn((req, res, next) => next()),
}));

import * as api from './api';

describe('API Router', () => {
    let router;

    beforeEach(async () => {
        jest.clearAllMocks();
        router = api.init();
    });

    test('should initialize and return a router', async () => {
        expect(router).toBeDefined();
    });

    test('should mount all sub-routers', async () => {
        const appRouter = await import('./app');
        const containerRouter = await import('./container');
        const watcherRouter = await import('./watcher');
        const triggerRouter = await import('./trigger');
        const registryRouter = await import('./registry');
        const authenticationRouter = await import('./authentication');
        const logRouter = await import('./log');
        const storeRouter = await import('./store');
        const serverRouter = await import('./server');
        const agentRouter = await import('./agent');

        expect(appRouter.init).toHaveBeenCalled();
        expect(containerRouter.init).toHaveBeenCalled();
        expect(watcherRouter.init).toHaveBeenCalled();
        expect(triggerRouter.init).toHaveBeenCalled();
        expect(registryRouter.init).toHaveBeenCalled();
        expect(authenticationRouter.init).toHaveBeenCalled();
        expect(logRouter.init).toHaveBeenCalled();
        expect(storeRouter.init).toHaveBeenCalled();
        expect(serverRouter.init).toHaveBeenCalled();
        expect(agentRouter.init).toHaveBeenCalled();
    });

    test('should use requireAuthentication middleware', async () => {
        const auth = await import('./auth');
        expect(router.use).toHaveBeenCalledWith(auth.requireAuthentication);
    });
});
