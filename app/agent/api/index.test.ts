// @ts-nocheck
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockApp, mockServerConfig } = vi.hoisted(() => {
    const mockApp = {
        use: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
        listen: vi.fn((port, cb) => cb?.()),
    };
    const mockServerConfig = {
        port: 3000,
        tls: { enabled: false },
        cors: { enabled: false },
    };
    return { mockApp, mockServerConfig };
});

vi.mock('node:fs', () => ({
    default: { readFileSync: vi.fn().mockReturnValue(Buffer.from('cert-data')) },
}));

vi.mock('node:https', () => ({
    default: { createServer: vi.fn().mockReturnValue({ listen: vi.fn((port, cb) => cb?.()) }) },
}));

vi.mock('../../log/index.js', () => ({ default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

vi.mock('../../configuration/index.js', () => ({
    getServerConfiguration: () => mockServerConfig,
}));

vi.mock('express', () => {
    const expressFn = vi.fn().mockReturnValue(mockApp);
    expressFn.json = vi.fn().mockReturnValue('json-middleware');
    return { default: expressFn };
});
vi.mock('cors', () => ({
    default: vi.fn().mockReturnValue('cors-middleware'),
}));
vi.mock('./container.js', () => ({
    getContainers: vi.fn(),
    getContainerLogs: vi.fn(),
    deleteContainer: vi.fn(),
}));
vi.mock('./watcher.js', () => ({
    getWatchers: vi.fn(),
    watchWatcher: vi.fn(),
    watchContainer: vi.fn(),
}));
vi.mock('./trigger.js', () => ({
    getTriggers: vi.fn(),
    runTrigger: vi.fn(),
    runTriggerBatch: vi.fn(),
}));
vi.mock('./event.js', () => ({
    initEvents: vi.fn(),
    subscribeEvents: vi.fn(),
}));
vi.mock('../../log/buffer.js', () => ({
    getEntries: vi.fn().mockReturnValue([]),
}));

import { authenticate, init } from './index.js';

describe('Agent API index', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.DD_AGENT_SECRET;
        delete process.env.WUD_AGENT_SECRET;
        delete process.env.DD_AGENT_SECRET_FILE;
        delete process.env.WUD_AGENT_SECRET_FILE;
        vi.clearAllMocks();
        Object.assign(mockServerConfig, {
            port: 3000,
            tls: { enabled: false },
            cors: { enabled: false },
        });
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('authenticate', () => {
        test('should return 401 when no secret is cached', () => {
            const req = { headers: { 'x-dd-agent-secret': 'test' }, ip: '127.0.0.1' };
            const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
            const next = vi.fn();
            authenticate(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('init', () => {
        test('should throw when no secret is configured', async () => {
            await expect(init()).rejects.toThrow('Agent mode requires');
        });

        test('should use DD_AGENT_SECRET env var', async () => {
            process.env.DD_AGENT_SECRET = 'dd-secret'; // NOSONAR - test fixture, not a real credential
            await init();
            expect(mockApp.listen).toHaveBeenCalled();
        });

        test('should use WUD_AGENT_SECRET as fallback', async () => {
            process.env.WUD_AGENT_SECRET = 'wud-secret'; // NOSONAR - test fixture, not a real credential
            await init();
            expect(mockApp.listen).toHaveBeenCalled();
        });

        test('should use DD_AGENT_SECRET_FILE env var', async () => {
            process.env.DD_AGENT_SECRET_FILE = '/opt/drydock/test/secret';
            const fs = await import('node:fs');
            fs.default.readFileSync.mockReturnValue('file-secret\n'); // NOSONAR - test fixture, not a real credential
            await init();
            expect(mockApp.listen).toHaveBeenCalled();
        });

        test('should use WUD_AGENT_SECRET_FILE as fallback', async () => {
            process.env.WUD_AGENT_SECRET_FILE = '/opt/drydock/test/secret';
            const fs = await import('node:fs');
            fs.default.readFileSync.mockReturnValue('file-secret\n'); // NOSONAR - test fixture, not a real credential
            await init();
            expect(mockApp.listen).toHaveBeenCalled();
        });

        test('should throw when secret file cannot be read', async () => {
            process.env.DD_AGENT_SECRET_FILE = '/nonexistent';
            const fs = await import('node:fs');
            fs.default.readFileSync.mockImplementation(() => {
                throw new Error('ENOENT');
            });
            await expect(init()).rejects.toThrow('Error reading secret file');
        });

        test('should enable cors when configured', async () => {
            process.env.DD_AGENT_SECRET = 'secret'; // NOSONAR - test fixture, not a real credential
            Object.assign(mockServerConfig, {
                port: 3000,
                tls: { enabled: false },
                cors: { enabled: true, origin: '*', methods: 'GET' }, // NOSONAR - test fixture
            });
            await init();
            expect(mockApp.use).toHaveBeenCalled();
        });

        test('should register container logs route', async () => {
            process.env.DD_AGENT_SECRET = 'secret'; // NOSONAR - test fixture, not a real credential
            await init();
            const getCalls = mockApp.get.mock.calls;
            const logsRoute = getCalls.find(([path]) => path === '/api/containers/:id/logs');
            expect(logsRoute).toBeDefined();
        });

        test('should mount /health before auth middleware', async () => {
            process.env.DD_AGENT_SECRET = 'secret'; // NOSONAR - test fixture, not a real credential
            await init();
            const getCalls = mockApp.get.mock.calls;
            const healthCall = getCalls.find(([path]) => path === '/health');
            expect(healthCall).toBeDefined();

            // /health should be registered before authenticate middleware
            const useCallOrder = mockApp.use.mock.invocationCallOrder;
            const authUseIndex = mockApp.use.mock.calls.findIndex(([arg]) => arg === authenticate);
            const getCallOrder = mockApp.get.mock.invocationCallOrder;
            const healthGetIdx = getCalls.findIndex(([path]) => path === '/health');
            expect(getCallOrder[healthGetIdx]).toBeLessThan(useCallOrder[authUseIndex]);
        });

        test('should start HTTPS server when TLS is enabled', async () => {
            process.env.DD_AGENT_SECRET = 'secret'; // NOSONAR - test fixture, not a real credential
            Object.assign(mockServerConfig, {
                port: 3000,
                tls: { enabled: true, key: '/key.pem', cert: '/cert.pem' },
                cors: { enabled: false },
            });
            const fs = await import('node:fs');
            fs.default.readFileSync.mockReturnValue(Buffer.from('cert-data'));
            const https = await import('node:https');
            await init();
            expect(https.default.createServer).toHaveBeenCalled();
        });

        test('authenticate should pass with correct secret after init', async () => {
            process.env.DD_AGENT_SECRET = 'correct-secret'; // NOSONAR - test fixture, not a real credential
            await init();

            const req = { headers: { 'x-dd-agent-secret': 'correct-secret' }, ip: '127.0.0.1' }; // NOSONAR
            const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
            const next = vi.fn();
            authenticate(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        test('authenticate should reject with wrong secret after init', async () => {
            process.env.DD_AGENT_SECRET = 'correct-secret'; // NOSONAR - test fixture, not a real credential
            await init();

            const req = { headers: { 'x-dd-agent-secret': 'wrong-secret' }, ip: '127.0.0.1' }; // NOSONAR
            const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
            const next = vi.fn();
            authenticate(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        describe('/api/log/entries route handler', () => {
            let logEntriesHandler;

            beforeEach(async () => {
                process.env.DD_AGENT_SECRET = 'secret'; // NOSONAR - test fixture
                await init();
                const getCalls = mockApp.get.mock.calls;
                const logRoute = getCalls.find(([path]) => path === '/api/log/entries');
                logEntriesHandler = logRoute[1];
            });

            test('should register /api/log/entries route', () => {
                expect(logEntriesHandler).toBeTypeOf('function');
            });

            test('should return entries with empty query', async () => {
                const { getEntries } = await import('../../log/buffer.js');
                getEntries.mockReturnValue([{ msg: 'test' }]);
                const req = { query: {} };
                const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
                logEntriesHandler(req, res);
                expect(getEntries).toHaveBeenCalledWith({ level: undefined, component: undefined, tail: undefined, since: undefined });
                expect(res.status).toHaveBeenCalledWith(200);
                expect(res.json).toHaveBeenCalledWith([{ msg: 'test' }]);
            });

            test('should parse all query params', async () => {
                const { getEntries } = await import('../../log/buffer.js');
                getEntries.mockReturnValue([]);
                const req = { query: { level: 'error', component: 'docker', tail: '50', since: '99999' } };
                const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
                logEntriesHandler(req, res);
                expect(getEntries).toHaveBeenCalledWith({ level: 'error', component: 'docker', tail: 50, since: 99999 });
                expect(res.status).toHaveBeenCalledWith(200);
            });
        });
    });
});
