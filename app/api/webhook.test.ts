import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockRequest, createMockResponse } from '../test/helpers.js';

const {
  mockRouter,
  mockGetWebhookConfiguration,
  mockGetContainers,
  mockGetState,
  mockInsertAudit,
  mockGetAuditCounter,
  mockGetWebhookCounter,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), post: vi.fn() },
  mockGetWebhookConfiguration: vi.fn(() => ({ enabled: true, token: 'test-token' })),
  mockGetContainers: vi.fn(() => []),
  mockGetState: vi.fn(() => ({ watcher: {}, trigger: {} })),
  mockInsertAudit: vi.fn(),
  mockGetAuditCounter: vi.fn(),
  mockGetWebhookCounter: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => 'rate-limit-middleware'),
}));

vi.mock('../configuration/index.js', () => ({
  getWebhookConfiguration: mockGetWebhookConfiguration,
  getServerConfiguration: vi.fn(() => ({ feature: { webhook: true } })),
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
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })),
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

describe('Webhook Router', () => {
  let mockAuditInc;
  let mockWebhookInc;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWebhookConfiguration.mockReturnValue({ enabled: true, token: 'test-token' });
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Missing or invalid') }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('should return 401 with wrong token', () => {
      const middleware = getAuthMiddleware();
      const req = createMockRequest({ headers: { authorization: 'Bearer wrong-token' } });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Invalid token') }),
      );
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
      mockGetWebhookConfiguration.mockReturnValue({ enabled: false, token: 'test-token' });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({ headers: { authorization: 'Bearer test-token' } });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('disabled') }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('should return 500 when webhook token is empty (misconfiguration)', () => {
      mockGetWebhookConfiguration.mockReturnValue({ enabled: true, token: '' });
      const middleware = getAuthMiddleware();
      const req = createMockRequest({ headers: { authorization: 'Bearer ' } });
      const res = createMockResponse();
      const next = vi.fn();
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('misconfigured') }),
      );
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
        watchers: 2,
      });
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
        watchers: 0,
      });
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
    test('should return 404 when container not found', async () => {
      mockGetContainers.mockReturnValue([]);

      const handler = getHandler('post', '/watch/:containerName');
      const req = createMockRequest({ params: { containerName: 'missing-container' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('missing-container') }),
      );
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
        container: 'my-nginx',
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
    test('should return 404 when container not found', async () => {
      mockGetContainers.mockReturnValue([]);

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'missing-container' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('missing-container') }),
      );
    });

    test('should return 404 when no docker trigger found', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
      mockGetContainers.mockReturnValue([container]);
      mockGetState.mockReturnValue({ watcher: {}, trigger: {} });

      const handler = getHandler('post', '/update/:containerName');
      const req = createMockRequest({ params: { containerName: 'my-nginx' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('No docker trigger found') }),
      );
    });

    test('should trigger update and return 200', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
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

      expect(mockTrigger).toHaveBeenCalledWith(container);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Update triggered for container my-nginx',
        container: 'my-nginx',
      });
    });

    test('should return 500 on trigger error without leaking internal details', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
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

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error updating container my-nginx' });
    });

    test('should stringify non-Error update failures for audit details', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
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

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error updating container my-nginx' });
      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({ details: 'trigger failed as string' }),
      );
    });

    test('should insert audit entry for successful update', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
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

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook-update',
          containerName: 'my-nginx',
          status: 'success',
        }),
      );
    });

    test('should insert audit entry on update error', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
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

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'webhook-update',
          status: 'error',
          details: 'Update error',
        }),
      );
    });

    test('should increment prometheus counters for update', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
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
      const container = { name: 'my-nginx', agent: 'agent1', image: { name: 'nginx' } };
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

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockTriggerFn).toHaveBeenCalledWith(container);
      expect(mockOtherTriggerFn).not.toHaveBeenCalled();
    });

    test('should skip non-docker triggers when finding trigger', async () => {
      const container = { name: 'my-nginx', image: { name: 'nginx' } };
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('No docker trigger found') }),
      );
    });
  });
});
