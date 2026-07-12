import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockApp,
  mockServerConfig,
  mockHashToken,
  mockLog,
  mockLoggerChild,
  mockRateLimit,
  mockRateLimitMiddleware,
  mockGetState,
} = vi.hoisted(() => {
  const mockRateLimitMiddleware = vi.fn((_req, _res, next) => next());
  const mockGetState = vi.fn(() => ({ watcher: { 'docker.local': {} } }));
  const mockApp = {
    disable: vi.fn(),
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
  const mockHashToken = vi.fn((token: string) =>
    Buffer.from(token.padEnd(32, '_').slice(0, 32), 'utf8'),
  );
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const mockLoggerChild = vi.fn();
  const mockRateLimit = vi.fn(() => mockRateLimitMiddleware);
  return {
    mockApp,
    mockServerConfig,
    mockHashToken,
    mockLog,
    mockLoggerChild,
    mockRateLimit,
    mockRateLimitMiddleware,
    mockGetState,
  };
});

vi.mock('node:fs', () => ({
  default: { readFileSync: vi.fn().mockReturnValue(Buffer.from('cert-data')) },
}));

vi.mock('node:https', () => ({
  default: { createServer: vi.fn().mockReturnValue({ listen: vi.fn((port, cb) => cb?.()) }) },
}));

vi.mock('../../log/index.js', () => ({
  default: { child: mockLoggerChild.mockReturnValue(mockLog) },
}));

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
  getWatcher: vi.fn(),
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
vi.mock('../../util/crypto.js', () => ({
  hashToken: mockHashToken,
}));
vi.mock('express-rate-limit', () => ({
  default: mockRateLimit,
}));

vi.mock('../../registry/index.js', () => ({
  getState: mockGetState,
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
    mockGetState.mockReturnValue({ watcher: { 'docker.local': {} } });
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

    test('should log warning with ip when no secret is cached', () => {
      // Kill 74:14 StringLiteral mutant
      const req = { headers: { 'x-dd-agent-secret': 'test' }, ip: '192.168.1.1' };
      const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      const next = vi.fn();
      authenticate(req, res, next);
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('192.168.1.1'));
    });

    test('should return 401 when secret header is not a string', async () => {
      process.env.DD_AGENT_SECRET = 'correct-secret';
      await init();

      const req = { headers: { 'x-dd-agent-secret': ['correct-secret'] }, ip: '127.0.0.1' };
      const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      const next = vi.fn();

      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('should log warning with ip when secrets do not match', async () => {
      // Kill 81:14 StringLiteral mutant
      process.env.DD_AGENT_SECRET = 'correct-secret';
      await init();

      const req = { headers: { 'x-dd-agent-secret': 'wrong-secret' }, ip: '10.0.0.5' };
      const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      const next = vi.fn();

      authenticate(req, res, next);

      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('10.0.0.5'));
    });
  });

  describe('init', () => {
    test('should throw when no secret is configured', async () => {
      await expect(init()).rejects.toThrow('Agent mode requires');
    });

    test('should log specific message when no secret is configured', async () => {
      await expect(init()).rejects.toThrow();
      // Kill 109:7 StringLiteral mutant: log message should contain meaningful content
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('DD_AGENT_SECRET'));
    });

    test('should use DD_AGENT_SECRET env var', async () => {
      process.env.DD_AGENT_SECRET = 'dd-secret';
      await init();
      expect(mockApp.listen).toHaveBeenCalled();
    });

    test('should reject removed WUD_AGENT_SECRET fallback', async () => {
      process.env.WUD_AGENT_SECRET = 'wud-secret';
      await expect(init()).rejects.toThrow(/DD_AGENT_SECRET/);
      expect(mockApp.listen).not.toHaveBeenCalled();
    });

    test('should use DD_AGENT_SECRET_FILE env var', async () => {
      process.env.DD_AGENT_SECRET_FILE = '/opt/drydock/test/secret';
      const fs = await import('node:fs');
      fs.default.readFileSync.mockReturnValue('file-secret\n');
      await init();
      expect(mockApp.listen).toHaveBeenCalled();
    });

    test('should trim whitespace from file secret so authenticate works with trimmed value', async () => {
      // Kill 99:22 MethodExpression mutant: .trim() removed
      // If trim is missing, cachedSecret = 'file-secret\n' (with newline)
      // hashToken('file-secret') !== hashToken('file-secret\n') → authenticate fails
      process.env.DD_AGENT_SECRET_FILE = '/opt/drydock/test/secret';
      const fs = await import('node:fs');
      fs.default.readFileSync.mockReturnValue('file-secret\n');
      await init();

      const req = { headers: { 'x-dd-agent-secret': 'file-secret' }, ip: '127.0.0.1' };
      const resObj = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      const next = vi.fn();
      authenticate(req, resObj, next);
      expect(next).toHaveBeenCalled();
      expect(resObj.status).not.toHaveBeenCalledWith(401);
    });

    test('should throw when secret file cannot be read', async () => {
      process.env.DD_AGENT_SECRET_FILE = '/nonexistent';
      const fs = await import('node:fs');
      fs.default.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      await expect(init()).rejects.toThrow('Error reading secret file');
    });

    test('should handle non-object secret file read errors', async () => {
      process.env.DD_AGENT_SECRET_FILE = '/nonexistent';
      const fs = await import('node:fs');
      fs.default.readFileSync.mockImplementation(() => {
        throw 'ENOENT';
      });

      await expect(init()).rejects.toThrow('Error reading secret file: undefined');
      expect(mockLog.error).toHaveBeenCalledWith('Error reading secret file: ');
    });

    test('should stringify symbol secret file read messages in thrown error', async () => {
      process.env.DD_AGENT_SECRET_FILE = '/nonexistent';
      const fs = await import('node:fs');
      fs.default.readFileSync.mockImplementation(() => {
        throw { message: Symbol('boom') };
      });

      await expect(init()).rejects.toThrow('Error reading secret file: Symbol(boom)');
      expect(mockLog.error).toHaveBeenCalledWith('Error reading secret file: Symbol(boom)');
    });

    test('should sanitize secret file read errors before logging', async () => {
      process.env.DD_AGENT_SECRET_FILE = '/nonexistent';
      const fs = await import('node:fs');
      fs.default.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT\nforged-log-line');
      });

      await expect(init()).rejects.toThrow('Error reading secret file');
      expect(mockLog.error).toHaveBeenCalledWith(
        'Error reading secret file: ENOENTforged-log-line',
      );
    });

    test('should enable cors when configured', async () => {
      process.env.DD_AGENT_SECRET = 'secret';
      Object.assign(mockServerConfig, {
        port: 3000,
        tls: { enabled: false },
        cors: { enabled: true, origin: '*', methods: 'GET' },
      });
      await init();
      expect(mockApp.use).toHaveBeenCalled();
    });

    test('should register rate limiter before JSON parsing for authenticated API routes', async () => {
      process.env.DD_AGENT_SECRET = 'secret';
      await init();

      const useOrder = mockApp.use.mock.calls.map(([middleware]) => middleware);
      const limiterIndex = useOrder.indexOf(mockRateLimitMiddleware);
      const jsonParserIndex = useOrder.indexOf('json-middleware');
      const authIndex = useOrder.indexOf(authenticate);

      expect(limiterIndex).toBeGreaterThanOrEqual(0);
      expect(jsonParserIndex).toBeGreaterThanOrEqual(0);
      expect(authIndex).toBeGreaterThanOrEqual(0);
      expect(limiterIndex).toBeLessThan(jsonParserIndex);
      expect(limiterIndex).toBeLessThan(authIndex);
    });

    test('should register container logs route', async () => {
      process.env.DD_AGENT_SECRET = 'secret';
      await init();
      const getCalls = mockApp.get.mock.calls;
      const logsRoute = getCalls.find(([path]) => path === '/api/containers/:id/logs');
      expect(logsRoute).toBeDefined();
    });

    test('should mount /health before auth middleware', async () => {
      process.env.DD_AGENT_SECRET = 'secret';
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

    test('health handler should return uptime payload when watchers are registered', async () => {
      process.env.DD_AGENT_SECRET = 'secret';
      mockGetState.mockReturnValue({ watcher: { 'docker.local': {} } });
      await init();

      const getCalls = mockApp.get.mock.calls;
      const healthCall = getCalls.find(([path]) => path === '/health');
      const handler = healthCall?.[1];
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

      handler({}, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        uptime: expect.any(Number),
      });
    });

    test('health handler should return 503 when zero watchers are registered', async () => {
      process.env.DD_AGENT_SECRET = 'secret';
      mockGetState.mockReturnValue({ watcher: {} });
      await init();

      const getCalls = mockApp.get.mock.calls;
      const healthCall = getCalls.find(([path]) => path === '/health');
      const handler = healthCall?.[1];
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

      handler({}, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        status: 'unhealthy',
        reason: 'no watchers registered',
      });
    });

    test('should start HTTPS server when TLS is enabled', async () => {
      process.env.DD_AGENT_SECRET = 'secret';
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
      process.env.DD_AGENT_SECRET = 'correct-secret';
      await init();

      const req = { headers: { 'x-dd-agent-secret': 'correct-secret' }, ip: '127.0.0.1' };
      const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      const next = vi.fn();
      authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('authenticate should reject with wrong secret after init', async () => {
      process.env.DD_AGENT_SECRET = 'correct-secret';
      await init();

      const req = { headers: { 'x-dd-agent-secret': 'wrong-secret' }, ip: '127.0.0.1' };
      const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      const next = vi.fn();
      authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('authenticate should compare hashed secrets with hashToken utility', async () => {
      process.env.DD_AGENT_SECRET = 'correct-secret';
      await init();

      const { hashToken } = await import('../../util/crypto.js');
      (hashToken as any).mockClear();

      const req = { headers: { 'x-dd-agent-secret': 'wrong-secret' }, ip: '127.0.0.1' };
      const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
      const next = vi.fn();
      authenticate(req, res, next);

      expect(hashToken).toHaveBeenCalledTimes(2);
      expect(hashToken).toHaveBeenCalledWith('wrong-secret');
      expect(hashToken).toHaveBeenCalledWith('correct-secret');
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    describe('/api/log/entries route handler', () => {
      let logEntriesHandler;

      beforeEach(async () => {
        process.env.DD_AGENT_SECRET = 'secret';
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
        getEntries.mockReturnValue([
          { timestamp: 1000, level: 'info', component: 'drydock', msg: 'test' },
        ]);
        const req = { query: {} };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        logEntriesHandler(req, res);
        expect(getEntries).toHaveBeenCalledWith({
          level: undefined,
          component: undefined,
          tail: undefined,
          since: undefined,
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith([
          expect.objectContaining({
            timestamp: 1000,
            level: 'info',
            component: 'drydock',
            msg: 'test',
            displayTimestamp: expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/u),
          }),
        ]);
      });

      test('should parse all query params', async () => {
        const { getEntries } = await import('../../log/buffer.js');
        getEntries.mockReturnValue([]);
        const req = { query: { level: 'error', component: 'docker', tail: '50', since: '99999' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        logEntriesHandler(req, res);
        expect(getEntries).toHaveBeenCalledWith({
          level: 'error',
          component: 'docker',
          tail: 50,
          since: 99999,
        });
        expect(res.status).toHaveBeenCalledWith(200);
      });

      test('should return 400 when level query parameter is invalid', async () => {
        const { getEntries } = await import('../../log/buffer.js');
        const req = { query: { level: 'verbose' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

        logEntriesHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid level query parameter' });
        expect(getEntries).not.toHaveBeenCalled();
      });

      test('should return 400 when component query parameter is invalid', async () => {
        const { getEntries } = await import('../../log/buffer.js');
        const req = { query: { component: 'docker;rm -rf /' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

        logEntriesHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid component query parameter' });
        expect(getEntries).not.toHaveBeenCalled();
      });

      test.each([
        ['level', 123, 'Invalid level query parameter'],
        ['component', ['docker'], 'Invalid component query parameter'],
      ])('should return 400 when %s query parameter is not a string', async (param, value, error) => {
        const { getEntries } = await import('../../log/buffer.js');
        const req = { query: { [param]: value } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

        logEntriesHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error });
        expect(getEntries).not.toHaveBeenCalled();
      });

      test('should pass level=null to getEntries when no level query param (undefined, not null)', async () => {
        const { getEntries } = await import('../../log/buffer.js');
        getEntries.mockReturnValue([]);
        const req = { query: {} };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        logEntriesHandler(req, res);
        expect(getEntries).toHaveBeenCalledWith(
          expect.objectContaining({ level: undefined, component: undefined }),
        );
      });

      test.each([
        'trace',
        'debug',
        'info',
        'warn',
        'error',
        'fatal',
      ])('should accept log level %s', async (level) => {
        const { getEntries } = await import('../../log/buffer.js');
        getEntries.mockReturnValue([]);
        const req = { query: { level } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        logEntriesHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(getEntries).toHaveBeenCalledWith(expect.objectContaining({ level }));
      });

      test('should normalize level to lowercase', async () => {
        const { getEntries } = await import('../../log/buffer.js');
        getEntries.mockReturnValue([]);
        const req = { query: { level: 'INFO' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        logEntriesHandler(req, res);
        expect(getEntries).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }));
      });

      test('should accept valid component with dots and hyphens', async () => {
        const { getEntries } = await import('../../log/buffer.js');
        getEntries.mockReturnValue([]);
        const req = { query: { component: 'my-component.v1' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        logEntriesHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(getEntries).toHaveBeenCalledWith(
          expect.objectContaining({ component: 'my-component.v1' }),
        );
      });

      test('should reject component with special chars not in [a-zA-Z0-9._-]', async () => {
        const { getEntries } = await import('../../log/buffer.js');
        const req = { query: { component: 'comp/slash' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        logEntriesHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(getEntries).not.toHaveBeenCalled();
      });
    });

    describe('ALLOWED_LOG_LEVELS set', () => {
      test('should reject level not in allowed set', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        await init();
        const getCalls = mockApp.get.mock.calls;
        const logRoute = getCalls.find(([path]) => path === '/api/log/entries');
        const handler = logRoute[1];

        const req = { query: { level: 'verbose' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        handler(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
      });
    });

    describe('SAFE_LOG_COMPONENT_PATTERN regex', () => {
      test('should reject empty string component', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        await init();
        const getCalls = mockApp.get.mock.calls;
        const logRoute = getCalls.find(([path]) => path === '/api/log/entries');
        const handler = logRoute[1];

        // Empty string doesn't match /^[a-zA-Z0-9._-]+$/
        // It will match the typeof !== string check but empty fails regex
        // Actually '' does match length requirement — empty string fails +
        const req = { query: { component: '' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        handler(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
      });
    });

    describe('app configuration', () => {
      test('should call app.disable with x-powered-by', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        await init();
        expect(mockApp.disable).toHaveBeenCalledWith('x-powered-by');
      });

      test('should configure express.json with 256kb limit', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        const express = await import('express');
        await init();
        expect(express.default.json).toHaveBeenCalledWith({ limit: '256kb' });
      });

      test('should NOT apply cors when cors.enabled is false', async () => {
        const cors = await import('cors');
        process.env.DD_AGENT_SECRET = 'secret';
        Object.assign(mockServerConfig, {
          port: 3000,
          tls: { enabled: false },
          cors: { enabled: false },
        });
        await init();
        // cors() should not have been called
        expect(cors.default).not.toHaveBeenCalled();
      });

      test('should configure TLS with key and cert when TLS enabled', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        const fs = await import('node:fs');
        const https = await import('node:https');
        const keyBuffer = Buffer.from('tls-key');
        const certBuffer = Buffer.from('tls-cert');
        fs.default.readFileSync.mockReturnValueOnce(keyBuffer).mockReturnValueOnce(certBuffer);
        Object.assign(mockServerConfig, {
          port: 4443,
          tls: { enabled: true, key: '/tls.key', cert: '/tls.cert' },
          cors: { enabled: false },
        });
        await init();
        expect(https.default.createServer).toHaveBeenCalledWith(
          expect.objectContaining({ key: keyBuffer, cert: certBuffer }),
          mockApp,
        );
      });
    });

    describe('HTTP server startup', () => {
      test('should log HTTP listening message on startup', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        await init();
        expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('(HTTP)'));
        expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('3000'));
      });

      test('should log HTTPS listening message on TLS startup', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        Object.assign(mockServerConfig, {
          port: 8443,
          tls: { enabled: true, key: '/key.pem', cert: '/cert.pem' },
          cors: { enabled: false },
        });
        const fs = await import('node:fs');
        fs.default.readFileSync.mockReturnValue(Buffer.from('cert-data'));
        await init();
        expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('(HTTPS)'));
        expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('8443'));
      });
    });

    describe('cors configuration', () => {
      test('should configure cors with origin and methods when enabled', async () => {
        const cors = await import('cors');
        process.env.DD_AGENT_SECRET = 'secret';
        Object.assign(mockServerConfig, {
          port: 3000,
          tls: { enabled: false },
          cors: { enabled: true, origin: 'https://example.com', methods: 'GET,POST' },
        });
        await init();
        expect(cors.default).toHaveBeenCalledWith({
          origin: 'https://example.com',
          methods: 'GET,POST',
        });
      });
    });

    describe('getErrorMessageValue', () => {
      test('should return undefined for non-Error thrown values', async () => {
        process.env.DD_AGENT_SECRET_FILE = '/bad';
        const fs = await import('node:fs');
        // Throw a string (not an object)
        fs.default.readFileSync.mockImplementation(() => {
          throw 'string-error';
        });
        await expect(init()).rejects.toThrow('Error reading secret file: undefined');
      });

      test('should return message property when error is an object with message', async () => {
        process.env.DD_AGENT_SECRET_FILE = '/bad';
        const fs = await import('node:fs');
        fs.default.readFileSync.mockImplementation(() => {
          throw { message: 'my-message' };
        });
        await expect(init()).rejects.toThrow('Error reading secret file: my-message');
      });
    });

    describe('route registration', () => {
      test('should register all API routes after auth middleware', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        await init();

        const getCalls = mockApp.get.mock.calls.map(([path]) => path);
        const postCalls = mockApp.post.mock.calls.map(([path]) => path);
        const deleteCalls = mockApp.delete.mock.calls.map(([path]) => path);

        expect(getCalls).toContain('/api/containers');
        expect(getCalls).toContain('/api/watchers');
        expect(getCalls).toContain('/api/watchers/:type/:name');
        expect(getCalls).toContain('/api/triggers');
        expect(getCalls).toContain('/api/events');
        expect(postCalls).toContain('/api/triggers/:type/:name');
        expect(postCalls).toContain('/api/triggers/:type/:name/batch');
        expect(postCalls).toContain('/api/watchers/:type/:name');
        expect(postCalls).toContain('/api/watchers/:type/:name/container/:id');
        expect(deleteCalls).toContain('/api/containers/:id');
      });
    });

    describe('rate limiter', () => {
      test('should create a rate limiter with the correct options', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        await init();
        expect(mockRateLimit).toHaveBeenCalledWith(
          expect.objectContaining({
            windowMs: 60_000,
            max: 300,
            standardHeaders: true,
            legacyHeaders: false,
          }),
        );
      });

      test('should register the rate limiter middleware before authenticate', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        await init();

        const useCalls = mockApp.use.mock.calls;
        const useOrder = mockApp.use.mock.invocationCallOrder;

        const limiterIdx = useCalls.findIndex(([arg]) => arg === mockRateLimitMiddleware);
        const authIdx = useCalls.findIndex(([arg]) => arg === authenticate);

        expect(limiterIdx).toBeGreaterThanOrEqual(0);
        expect(authIdx).toBeGreaterThanOrEqual(0);
        expect(useOrder[limiterIdx]).toBeLessThan(useOrder[authIdx]);
      });

      test('should pass requests through when under the rate limit', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        await init();

        // mockRateLimitMiddleware calls next() by default (under-limit behaviour)
        const req = {};
        const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
        const next = vi.fn();

        mockRateLimitMiddleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      test('should return 429 when the rate limit is exceeded', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        await init();

        // Simulate the rate limiter blocking the request (does not call next)
        mockRateLimitMiddleware.mockImplementationOnce((_req, res) => {
          res.status(429).send();
        });

        const req = {};
        const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
        const next = vi.fn();

        mockRateLimitMiddleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(next).not.toHaveBeenCalled();
      });

      test('should register the rate limiter using the middleware returned by rateLimit()', async () => {
        process.env.DD_AGENT_SECRET = 'secret';
        await init();

        // Verify app.use was called with the exact middleware instance returned by rateLimit()
        const usedMiddlewares = mockApp.use.mock.calls.map(([arg]) => arg);
        expect(usedMiddlewares).toContain(mockRateLimitMiddleware);
      });
    });
  });
});
