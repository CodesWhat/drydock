import { beforeEach, describe, expect, test, vi } from 'vitest';
import { sanitizeLogParam } from '../log/sanitize.js';
import { createMockRequest, createMockResponse } from '../test/helpers.js';
import * as requestUpdate from '../updates/request-update.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const {
  mockRouter,
  mockGetWebhookConfiguration,
  mockGetContainers,
  mockGetState,
  mockInsertAudit,
  mockGetAuditCounter,
  mockGetWebhookCounter,
  mockCreateHash,
  mockTimingSafeEqual,
  mockLogWarn,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), post: vi.fn() },
  mockGetWebhookConfiguration: vi.fn(() => ({
    enabled: true,
    token: 'test-token',
    tokens: {
      watchall: '',
      watch: '',
      update: '',
    },
  })),
  mockGetContainers: vi.fn(() => []),
  mockGetState: vi.fn(() => ({ watcher: {}, trigger: {} })),
  mockInsertAudit: vi.fn(),
  mockGetAuditCounter: vi.fn(),
  mockGetWebhookCounter: vi.fn(),
  mockLogWarn: vi.fn(),
  mockCreateHash: vi.fn(() => {
    const chunks: Buffer[] = [];
    const hash = {
      update: vi.fn((value: string, encoding?: BufferEncoding) => {
        chunks.push(Buffer.from(value, encoding ?? 'utf8'));
        return hash;
      }),
      digest: vi.fn(() => {
        const data = Buffer.concat(chunks);
        const digest = Buffer.alloc(32);
        for (let i = 0; i < data.length; i += 1) {
          digest[i % 32] ^= data[i];
        }
        return digest;
      }),
    };
    return hash;
  }),
  mockTimingSafeEqual: vi.fn(
    (left: Buffer, right: Buffer) => left.length === right.length && left.equals(right),
  ),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => 'rate-limit-middleware'),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      createHash: mockCreateHash,
      timingSafeEqual: mockTimingSafeEqual,
      randomUUID: vi.fn(() => 'op-webhook-test'),
    },
    createHash: mockCreateHash,
    timingSafeEqual: mockTimingSafeEqual,
    randomUUID: vi.fn(() => 'op-webhook-test'),
  };
});

vi.mock('../configuration/index.js', () => ({
  getWebhookConfiguration: mockGetWebhookConfiguration,
  getServerConfiguration: vi.fn(() => ({ feature: {} })),
  getVersion: vi.fn(() => 'test-version'),
}));

vi.mock('../store/container.js', () => ({
  getContainers: mockGetContainers,
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../store/audit.js', () => ({
  insertAudit: mockInsertAudit,
}));

vi.mock('../prometheus/audit.js', () => ({
  getAuditCounter: mockGetAuditCounter,
}));

vi.mock('../prometheus/webhook.js', () => ({
  getWebhookCounter: mockGetWebhookCounter,
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: vi.fn(), warn: mockLogWarn, debug: vi.fn(), error: vi.fn() })),
  },
}));

import * as webhookRouter from './webhook.js';

/**
 * Get the registered middleware function by position in router.use calls.
 * The auth middleware is the third use() call (after rate limiter and nocache).
 */
function getAuthMiddleware() {
  webhookRouter.init();
  // use calls: [0] rate limiter, [1] nocache, [2] authenticateToken
  return mockRouter.use.mock.calls[2][0];
}

function getHandler(method, path) {
  webhookRouter.init();
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  return call[1];
}

async function flushAcceptedUpdateWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Webhook Router', () => {
  let mockAuditInc;
  let mockWebhookInc;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWebhookConfiguration.mockReturnValue({
      enabled: true,
      token: 'test-token',
      tokens: {
        watchall: '',
        watch: '',
        update: '',
      },
    });
    mockAuditInc = vi.fn();
    mockGetAuditCounter.mockReturnValue({ inc: mockAuditInc });
    mockWebhookInc = vi.fn();
    mockGetWebhookCounter.mockReturnValue({ inc: mockWebhookInc });
    mockGetContainers.mockReturnValue([]);
    mockGetState.mockReturnValue({ watcher: {}, trigger: {} });
  });

  describe('init', () => {
    test('should register routes and middleware', () => {
      webhookRouter.init();
      expect(mockRouter.use).toHaveBeenCalledWith('rate-limit-middleware');
      expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
      expect(mockRouter.use).toHaveBeenCalledWith(expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/watch', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/watch/:containerName', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/update/:containerName', expect.any(Function));
    });
  });

  describe('Authentication', () => {
    test('should return 401 without authorization header', () => {
      const middleware = getAuthMiddleware();
      const req = createMockRequest({ headers: {} });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('Missing or invalid'),
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('should return 401 with wrong token', () => {
      const middleware = getAuthMiddleware();
      const req = createMockRequest({ headers: { authorization: 'Bearer wrong-token' } });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Invalid token') });
      expect(next).not.toHaveBeenCalled();
    });

    test('should use timing-safe token comparison for different-length tokens', () => {
      const middleware = getAuthMiddleware();
      const req = createMockRequest({ headers: { authorization: 'Bearer x' } });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockTimingSafeEqual).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });

    test('should return 401 with non-Bearer auth scheme', () => {
      const middleware = getAuthMiddleware();
      const req = createMockRequest({ headers: { authorization: 'Basic abc123' } });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('should return 403 when webhooks are disabled', () => {
      mockGetWebhookConfiguration.mockReturnValue({
        enabled: false,
        token: 'test-token',
        tokens: {
          watchall: '',
          watch: '',
          update: '',
        },
      });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({ headers: { authorization: 'Bearer test-token' } });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('disabled') });
      expect(next).not.toHaveBeenCalled();
    });

    test('should return 500 when webhook token is empty (misconfiguration)', () => {
      mockGetWebhookConfiguration.mockReturnValue({
        enabled: true,
        token: '',
        tokens: {
          watchall: '',
          watch: '',
          update: '',
        },
      });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({ headers: { authorization: 'Bearer ' } });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('misconfigured') });
      expect(next).not.toHaveBeenCalled();
    });

    test('should call next with correct Bearer token', () => {
      const middleware = getAuthMiddleware();
      const req = createMockRequest({ headers: { authorization: 'Bearer test-token' } });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should use watch-all endpoint token for /watch and reject shared token when override exists', () => {
      mockGetWebhookConfiguration.mockReturnValue({
        enabled: true,
        token: 'shared-token',
        tokens: {
          watchall: 'watchall-token',
          watch: 'watch-token',
          update: 'update-token',
        },
      });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({
        path: '/watch',
        headers: { authorization: 'Bearer shared-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('should normalize trailing slash paths when selecting endpoint tokens', () => {
      mockGetWebhookConfiguration.mockReturnValue({
        enabled: true,
        token: 'shared-token',
        tokens: {
          watchall: 'watchall-token',
          watch: 'watch-token',
          update: '',
        },
      });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({
        path: '/watch/',
        headers: { authorization: 'Bearer watchall-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should use watch token for /watch/:containerName', () => {
      mockGetWebhookConfiguration.mockReturnValue({
        enabled: true,
        token: 'shared-token',
        tokens: {
          watchall: '',
          watch: 'watch-token',
          update: '',
        },
      });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({
        path: '/watch/my-nginx',
        headers: { authorization: 'Bearer watch-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should use update token for /update/:containerName', () => {
      mockGetWebhookConfiguration.mockReturnValue({
        enabled: true,
        token: 'shared-token',
        tokens: {
          watchall: '',
          watch: '',
          update: 'update-token',
        },
      });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({
        path: '/update/my-nginx',
        headers: { authorization: 'Bearer update-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should fall back to shared token for action routes when no endpoint-specific tokens are configured', () => {
      mockGetWebhookConfiguration.mockReturnValue({
        enabled: true,
        token: 'shared-token',
        tokens: {
          watchall: '',
          watch: '',
          update: '',
        },
      });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({
        path: '/update/my-nginx',
        headers: { authorization: 'Bearer shared-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should return 500 when endpoint-specific tokens are configured but target endpoint token is missing', () => {
      mockGetWebhookConfiguration.mockReturnValue({
        enabled: true,
        token: 'shared-token',
        tokens: {
          watchall: 'watchall-token',
          watch: '',
          update: '',
        },
      });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({
        path: '/update/my-nginx',
        headers: { authorization: 'Bearer shared-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('misconfigured') });
      expect(next).not.toHaveBeenCalled();
    });

    test('should fall back to shared token when request path is empty', () => {
      mockGetWebhookConfiguration.mockReturnValue({
        enabled: true,
        token: 'shared-token',
        tokens: {
          watchall: 'watchall-token',
          watch: 'watch-token',
          update: 'update-token',
        },
      });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({
        path: '',
        originalUrl: '',
        url: '',
        headers: { authorization: 'Bearer shared-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should return 500 when endpoint token is required but not configured', () => {
      mockGetWebhookConfiguration.mockReturnValue({
        enabled: true,
        token: '',
        tokens: {
          watchall: '',
          watch: '',
          update: 'update-token',
        },
      });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({
        path: '/watch/my-nginx',
        headers: { authorization: 'Bearer watch-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('misconfigured') });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('POST /watch', () => {
    test('should trigger watch on all watchers and return 200', async () => {
      const mockWatch1 = vi.fn().mockResolvedValue(undefined);
      const mockWatch2 = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: {
          'docker.local': { watch: mockWatch1 },
          'docker.remote': { watch: mockWatch2 },
        },
        trigger: {},
      });

      const handler = getHandler('post', '/watch');
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);

      expect(mockWatch1).toHaveBeenCalled();
      expect(mockWatch2).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Watch cycle triggered',
        result: { watchers: 2 },
      });
      const contractValidation = validateOpenApiJsonResponse({
        path: '/api/webhook/watch',
        method: 'post',
        statusCode: '200',
        payload: res.json.mock.calls[0][0],
      });
      expect(contractValidation.valid).toBe(true);
      expect(contractValidation.errors).toStrictEqual([]);
    });

    test('should return 200 with zero watchers', async () => {
      mockGetState.mockReturnValue({ watcher: {}, trigger: {} });

      const handler = getHandler('post', '/watch');
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Watch cycle triggered',
        result: { watchers: 0 },
      });
      const contractValidation = validateOpenApiJsonResponse({
        path: '/api/webhook/watch',
        method: 'post',
        statusCode: '200',
        payload: res.json.mock.calls[0][0],
      });
      expect(contractValidation.valid).toBe(true);
      expect(contractValidation.errors).toStrictEqual([]);
    });

    test('should return 500 on watcher error without leaking internal details', async () => {
      mockGetState.mockReturnValue({
        watcher: {
          'docker.local': { watch: vi.fn().mockRejectedValue(new Error('Watch failed')) },
        },
        trigger: {},
      });

      const handler = getHandler('post', '/watch');
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error triggering watch cycle' });
    });

    test('should stringify non-Error watch-all failures for audit details', async () => {
      mockGetState.mockReturnValue({
        watcher: {
          'docker.local': { watch: vi.fn().mockRejectedValue('watch failed as string') },
        },
        trigger: {},
      });

      const handler = getHandler('post', '/watch');
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error triggering watch cycle' });
      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({ details: 'watch failed as string' }),
      );
    });

    test('should sanitize watch-all failure details in warning logs', async () => {
      const rawErrorMessage = '\u001b[31mwatch failed\u001b[0m\nnext';
      const sanitizedErrorMessage = sanitizeLogParam(rawErrorMessage);
      mockGetState.mockReturnValue({
        watcher: {
          'docker.local': { watch: vi.fn().mockRejectedValue(new Error(rawErrorMessage)) },
        },
        trigger: {},
      });

      const handler = getHandler('post', '/watch');
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);

      expect(mockLogWarn).toHaveBeenCalledWith(
        `Error triggering watch cycle (${sanitizedErrorMessage})`,
      );
    });

    test('should sanitize watch-all failure details in audit events', async () => {
      const rawErrorMessage = '\u001b[31mwatch failed\u001b[0m\nnext';
      const sanitizedErrorMessage = sanitizeLogParam(rawErrorMessage);
      mockGetState.mockReturnValue({
        watcher: {
          'docker.local': { watch: vi.fn().mockRejectedValue(new Error(rawErrorMessage)) },
        },
        trigger: {},
      });

      const handler = getHandler('post', '/watch');
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook-watch',
          status: 'error',
          details: sanitizedErrorMessage,
        }),
      );
    });

    test('should insert audit entry on successful watch', async () => {
      mockGetState.mockReturnValue({
        watcher: { 'docker.local': { watch: vi.fn().mockResolvedValue(undefined) } },
        trigger: {},
      });

      const handler = getHandler('post', '/watch');
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook-watch',
          containerName: '*',
          status: 'success',
        }),
      );
    });

    test('should insert audit entry on watch error', async () => {
      mockGetState.mockReturnValue({
        watcher: {
          'docker.local': { watch: vi.fn().mockRejectedValue(new Error('Watch error')) },
        },
        trigger: {},
      });

      const handler = getHandler('post', '/watch');
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook-watch',
          status: 'error',
          details: 'Watch error',
        }),
      );
    });

    test('should increment prometheus counters', async () => {
      mockGetState.mockReturnValue({
        watcher: { 'docker.local': { watch: vi.fn().mockResolvedValue(undefined) } },
        trigger: {},
      });

      const handler = getHandler('post', '/watch');
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);

      expect(mockAuditInc).toHaveBeenCalledWith({ action: 'webhook-watch' });
      expect(mockWebhookInc).toHaveBeenCalledWith({ action: 'watch-all' });
    });
  });

  describe('POST /watch/:containerName', () => {
    test('should return 404 when container not found without reflecting raw containerName', async () => {
      mockGetContainers.mockReturnValue([]);

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: '<script>alert(1)</script>' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('should return 403 when container has dd.webhook.enabled=false', async () => {
      const container = {
        name: 'my-nginx',
        image: { name: 'nginx' },
        labels: { 'dd.webhook.enabled': 'false' },
      };
      mockGetContainers.mockReturnValue([container]);

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Webhooks are disabled for this container',
      });
    });

    test('should return 403 when container has wud.webhook.enabled=false (legacy)', async () => {
      const container = {
        name: 'my-nginx',
        image: { name: 'nginx' },
        labels: { 'wud.webhook.enabled': 'false' },
      };
      mockGetContainers.mockReturnValue([container]);

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('should allow watch when dd.webhook.enabled=true', async () => {
      const container = {
        name: 'my-nginx',
        image: { name: 'nginx' },
        labels: { 'dd.webhook.enabled': 'true' },
      };
      mockGetContainers.mockReturnValue([container]);
      const mockWatchContainer = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: { 'docker.local': { watchContainer: mockWatchContainer } },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should allow watch when container has no labels', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
      mockGetContainers.mockReturnValue([container]);
      const mockWatchContainer = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: { 'docker.local': { watchContainer: mockWatchContainer } },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should allow watch when labels exist but webhook label is not set', async () => {
      const container = {
        name: 'my-nginx',
        image: { name: 'nginx' },
        labels: { 'com.example.service': 'nginx' },
      };
      mockGetContainers.mockReturnValue([container]);
      const mockWatchContainer = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: { 'docker.local': { watchContainer: mockWatchContainer } },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockWatchContainer).toHaveBeenCalledWith(container);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should trigger watch on specific container', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
      mockGetContainers.mockReturnValue([container]);
      const mockWatchContainer = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: { 'docker.local': { watchContainer: mockWatchContainer } },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockWatchContainer).toHaveBeenCalledWith(container);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Watch triggered for container my-nginx',
        result: { container: 'my-nginx' },
      });
    });

    test('should sanitize reflected containerName in successful watch response', async () => {
      const containerName = '\u001b[31mmy-nginx\u001b[0m\nnext';
      const container = { name: containerName, image: { name: 'nginx' } };
      const sanitizedName = sanitizeLogParam(containerName);
      mockGetContainers.mockReturnValue([container]);
      const mockWatchContainer = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: { 'docker.local': { watchContainer: mockWatchContainer } },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: `Watch triggered for container ${sanitizedName}`,
        result: { container: sanitizedName },
      });
    });

    test('should return 500 on watch error without leaking internal details', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {
          'docker.local': {
            watchContainer: vi.fn().mockRejectedValue(new Error('Container watch failed')),
          },
        },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error watching container my-nginx' });
    });

    test('should sanitize reflected containerName in watch error response', async () => {
      const containerName = '\u001b[31mmy-nginx\u001b[0m\nnext';
      const container = { name: containerName, image: { name: 'nginx' } };
      const sanitizedName = sanitizeLogParam(containerName);
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {
          'docker.local': {
            watchContainer: vi.fn().mockRejectedValue(new Error('Container watch failed')),
          },
        },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: `Error watching container ${sanitizedName}`,
      });
    });

    test('should stringify non-Error watch-container failures for audit details', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {
          'docker.local': {
            watchContainer: vi.fn().mockRejectedValue('container watch failed as string'),
          },
        },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error watching container my-nginx' });
      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({ details: 'container watch failed as string' }),
      );
    });

    test('should sanitize watch-container failure details in audit events', async () => {
      const rawErrorMessage = '\u001b[31mcontainer watch failed\u001b[0m\nnext';
      const sanitizedErrorMessage = sanitizeLogParam(rawErrorMessage);
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {
          'docker.local': {
            watchContainer: vi.fn().mockRejectedValue(new Error(rawErrorMessage)),
          },
        },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook-watch-container',
          status: 'error',
          details: sanitizedErrorMessage,
        }),
      );
    });

    test('should insert audit entry for container watch', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: { 'docker.local': { watchContainer: vi.fn().mockResolvedValue(undefined) } },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook-watch-container',
          containerName: 'my-nginx',
          status: 'success',
        }),
      );
    });

    test('should increment prometheus counters for container watch', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: { 'docker.local': { watchContainer: vi.fn().mockResolvedValue(undefined) } },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockAuditInc).toHaveBeenCalledWith({ action: 'webhook-watch-container' });
      expect(mockWebhookInc).toHaveBeenCalledWith({ action: 'watch-container' });
    });

    test('should find container by name correctly among multiple', async () => {
      const containers = [
        { name: 'redis', image: { name: 'redis' } },
        { name: 'nginx', image: { name: 'nginx' } },
        { name: 'postgres', image: { name: 'postgres' } },
      ];
      mockGetContainers.mockReturnValue(containers);
      const mockWatchContainer = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: { 'docker.local': { watchContainer: mockWatchContainer } },
        trigger: {},
      });

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockWatchContainer).toHaveBeenCalledWith(containers[1]);
    });
  });

  describe('POST /update/:containerName', () => {
    test('should return 404 when container not found without reflecting raw containerName', async () => {
      mockGetContainers.mockReturnValue([]);

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: '\u001b[31mspoofed\u001b[0m' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('should return 403 when container has dd.webhook.enabled=false', async () => {
      const container = {
        name: 'my-nginx',
        image: { name: 'nginx' },
        labels: { 'dd.webhook.enabled': 'false' },
      };
      mockGetContainers.mockReturnValue([container]);

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Webhooks are disabled for this container',
      });
    });

    test('should return 403 when container has wud.webhook.enabled=false (legacy)', async () => {
      const container = {
        name: 'my-nginx',
        image: { name: 'nginx' },
        labels: { 'wud.webhook.enabled': 'false' },
      };
      mockGetContainers.mockReturnValue([container]);

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('should return 404 when no docker trigger found', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({ watcher: {}, trigger: {} });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('No docker trigger found'),
      });
    });

    test('should return 409 when update targets a temporary rollback container', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx-old-1234567890',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      const mockTrigger = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: { 'docker.default': { type: 'docker', trigger: mockTrigger } },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx-old-1234567890' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('temporary rollback container'),
      });
      expect(mockTrigger).not.toHaveBeenCalled();
    });

    test('should accept update and return 202', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      const mockTrigger = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: { 'docker.default': { type: 'docker', trigger: mockTrigger } },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(mockTrigger).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ operationId: expect.any(String) }),
      );
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Update accepted for container my-nginx',
        operationId: expect.any(String),
        result: { container: 'my-nginx' },
      });
    });

    test('should accept update and return 202 with a dockercompose trigger', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      const mockTrigger = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: { 'dockercompose.default': { type: 'dockercompose', trigger: mockTrigger } },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(mockTrigger).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ operationId: expect.any(String) }),
      );
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Update accepted for container my-nginx',
        operationId: expect.any(String),
        result: { container: 'my-nginx' },
      });
    });

    test('should return the UpdateRequestError status when update acceptance fails', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: {
          'docker.default': { type: 'docker', trigger: vi.fn() },
        },
      });
      const spy = vi
        .spyOn(requestUpdate, 'requestContainerUpdate')
        .mockRejectedValueOnce(new requestUpdate.UpdateRequestError(409, 'teapot'));

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);
      spy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'teapot' });
    });

    test('should return 500 when update acceptance fails unexpectedly', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: {
          'docker.default': { type: 'docker', trigger: vi.fn() },
        },
      });
      const spy = vi
        .spyOn(requestUpdate, 'requestContainerUpdate')
        .mockRejectedValueOnce(new Error('unexpected update failure'));

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);
      spy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error updating container my-nginx',
      });
    });

    test('should sanitize reflected containerName in successful update response', async () => {
      const containerName = '\u001b[31mmy-nginx\u001b[0m\nnext';
      const container = {
        id: 'c1',
        name: containerName,
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      const sanitizedName = sanitizeLogParam(containerName);
      mockGetContainers.mockReturnValue([container]);
      const mockTrigger = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: { 'docker.default': { type: 'docker', trigger: mockTrigger } },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        message: `Update accepted for container ${sanitizedName}`,
        operationId: expect.any(String),
        result: { container: sanitizedName },
      });
    });

    test('should accept update even when the trigger later fails', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: {
          'docker.default': {
            type: 'docker',
            trigger: vi.fn().mockRejectedValue(new Error('Trigger failed')),
          },
        },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Update accepted for container my-nginx',
        operationId: expect.any(String),
        result: { container: 'my-nginx' },
      });
      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook-update',
          status: 'error',
          details: 'Trigger failed',
        }),
      );
    });

    test('should stringify non-Error update failures for audit details', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: {
          'docker.default': {
            type: 'docker',
            trigger: vi.fn().mockRejectedValue('trigger failed as string'),
          },
        },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(res.status).toHaveBeenCalledWith(202);
      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({ details: 'trigger failed as string' }),
      );
    });

    test('should insert audit entry for successful update', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: {
          'docker.default': { type: 'docker', trigger: vi.fn().mockResolvedValue(undefined) },
        },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook-update',
          containerName: 'my-nginx',
          status: 'success',
        }),
      );
    });

    test('should insert audit entry on update error', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: {
          'docker.default': {
            type: 'docker',
            trigger: vi.fn().mockRejectedValue(new Error('Update error')),
          },
        },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook-update',
          status: 'error',
          details: 'Update error',
        }),
      );
    });

    test('should increment prometheus counters for update', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: {
          'docker.default': { type: 'docker', trigger: vi.fn().mockResolvedValue(undefined) },
        },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockAuditInc).toHaveBeenCalledWith({ action: 'webhook-update' });
      expect(mockWebhookInc).toHaveBeenCalledWith({ action: 'update-container' });
    });

    test('should find the correct docker trigger matching container agent', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        agent: 'agent1',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      const mockTriggerFn = vi.fn().mockResolvedValue(undefined);
      const mockOtherTriggerFn = vi.fn().mockResolvedValue(undefined);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: {
          'docker.default': { type: 'docker', agent: 'agent1', trigger: mockTriggerFn },
          'docker.other': { type: 'docker', agent: 'agent2', trigger: mockOtherTriggerFn },
          'slack.default': { type: 'slack', trigger: vi.fn() },
        },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(res.status).toHaveBeenCalledWith(202);
      expect(mockTriggerFn).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ operationId: expect.any(String) }),
      );
      expect(mockOtherTriggerFn).not.toHaveBeenCalled();
    });

    test('should skip non-docker triggers when finding trigger', async () => {
      const container = {
        id: 'c1',
        name: 'my-nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({
        watcher: {},
        trigger: {
          'slack.default': { type: 'slack', trigger: vi.fn() },
        },
      });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('No docker trigger found'),
      });
    });
  });
});
