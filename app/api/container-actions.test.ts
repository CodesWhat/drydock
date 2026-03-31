import { createMockRequest, createMockResponse } from '../test/helpers.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const {
  mockRouter,
  mockGetContainer,
  mockUpdateContainer,
  mockGetState,
  mockInsertAudit,
  mockGetAuditCounter,
  mockGetContainerActionsCounter,
  mockGetServerConfiguration,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), post: vi.fn() },
  mockGetContainer: vi.fn(),
  mockUpdateContainer: vi.fn((c) => c),
  mockGetState: vi.fn(),
  mockInsertAudit: vi.fn(),
  mockGetAuditCounter: vi.fn(),
  mockGetContainerActionsCounter: vi.fn(),
  mockGetServerConfiguration: vi.fn(() => ({ feature: { containeractions: true } })),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/container', () => ({
  getContainer: mockGetContainer,
  updateContainer: mockUpdateContainer,
}));

vi.mock('../registry', () => ({
  getState: mockGetState,
}));

vi.mock('../store/audit', () => ({
  insertAudit: mockInsertAudit,
}));

vi.mock('../prometheus/audit', () => ({
  getAuditCounter: mockGetAuditCounter,
}));

vi.mock('../prometheus/container-actions', () => ({
  getContainerActionsCounter: mockGetContainerActionsCounter,
}));

vi.mock('../configuration', () => ({
  getServerConfiguration: mockGetServerConfiguration,
  getVersion: vi.fn(() => 'test-version'),
}));

vi.mock('../log', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
}));

import * as containerActionsRouter from './container-actions.js';

function getHandler(method, path) {
  containerActionsRouter.init();
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  return call[1];
}

function createDockerTrigger(overrides = {}) {
  const mockDockerContainer = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ State: { Status: 'running' } }),
  };
  return {
    trigger: {
      type: 'docker',
      getWatcher: vi.fn(() => ({
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      })),
      ...overrides,
    },
    dockerContainer: mockDockerContainer,
  };
}

describe('Container Actions Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: true } });
    const mockAuditInc = vi.fn();
    mockGetAuditCounter.mockReturnValue({ inc: mockAuditInc });
    const mockActionsInc = vi.fn();
    mockGetContainerActionsCounter.mockReturnValue({ inc: mockActionsInc });
  });

  describe('init', () => {
    test('should register routes', () => {
      containerActionsRouter.init();
      expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
      expect(mockRouter.post).toHaveBeenCalledWith('/:id/start', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/:id/stop', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/:id/restart', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/:id/update', expect.any(Function));
    });
  });

  describe('startContainer', () => {
    test('should start container successfully', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger, dockerContainer } = createDockerTrigger();
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(dockerContainer.start).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container started successfully',
        result: expect.any(Object),
      });
      const contractValidation = validateOpenApiJsonResponse({
        path: '/api/containers/{id}/start',
        method: 'post',
        statusCode: '200',
        payload: res.json.mock.calls[0][0],
      });
      expect(contractValidation.valid).toBe(true);
      expect(contractValidation.errors).toStrictEqual([]);
    });

    test('should return 404 when container not found', async () => {
      mockGetContainer.mockReturnValue(undefined);

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'missing' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('should return 404 when no docker trigger found', async () => {
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetState.mockReturnValue({ trigger: {} });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('No docker trigger found'),
      });
    });

    test('should return 403 when feature flag is disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container actions are disabled' });
    });

    test('should return 500 when Docker API throws error', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger, dockerContainer } = createDockerTrigger();
      dockerContainer.start.mockRejectedValue(new Error('container already started'));
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'container already started' });
    });

    test('should stringify non-Error Docker API failures', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger, dockerContainer } = createDockerTrigger();
      dockerContainer.start.mockRejectedValue('start failed as string');
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'start failed as string' });
    });

    test('should insert audit entry on success', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger } = createDockerTrigger();
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'container-start',
          containerName: 'nginx',
          status: 'success',
        }),
      );
    });

    test('should insert audit entry on error', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger, dockerContainer } = createDockerTrigger();
      dockerContainer.start.mockRejectedValue(new Error('Docker error'));
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'container-start',
          status: 'error',
          details: 'Docker error',
        }),
      );
    });

    test('should increment counters on success', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger } = createDockerTrigger();
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const mockAuditInc = vi.fn();
      mockGetAuditCounter.mockReturnValue({ inc: mockAuditInc });
      const mockActionsInc = vi.fn();
      mockGetContainerActionsCounter.mockReturnValue({ inc: mockActionsInc });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockAuditInc).toHaveBeenCalledWith({ action: 'container-start' });
      expect(mockActionsInc).toHaveBeenCalledWith({ action: 'container-start' });
    });

    test('should return original container when status refresh lookups are unavailable', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer
        .mockReturnValueOnce(container)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined);
      const { trigger } = createDockerTrigger();
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockUpdateContainer).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container started successfully',
        result: container,
      });
    });
  });

  describe('stopContainer', () => {
    test('should stop container successfully', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger, dockerContainer } = createDockerTrigger();
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/stop');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(dockerContainer.stop).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container stopped successfully',
        result: expect.any(Object),
      });
    });

    test('should return 403 when feature flag is disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

      const handler = getHandler('post', '/:id/stop');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container actions are disabled' });
    });

    test('should return 500 when Docker API throws error', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger, dockerContainer } = createDockerTrigger();
      dockerContainer.stop.mockRejectedValue(new Error('stop failed'));
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/stop');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'stop failed' });
    });
  });

  describe('restartContainer', () => {
    test('should restart container successfully', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger, dockerContainer } = createDockerTrigger();
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/restart');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(dockerContainer.restart).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container restarted successfully',
        result: expect.any(Object),
      });
    });

    test('should return 403 when feature flag is disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

      const handler = getHandler('post', '/:id/restart');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container actions are disabled' });
    });

    test('should insert audit entry with correct action', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger } = createDockerTrigger();
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/restart');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'container-restart',
          status: 'success',
        }),
      );
    });

    test('should return 500 when Docker API throws error', async () => {
      const container = { id: 'c1', name: 'nginx', image: { name: 'nginx' } };
      mockGetContainer.mockReturnValue(container);
      const { trigger, dockerContainer } = createDockerTrigger();
      dockerContainer.restart.mockRejectedValue(new Error('restart failed'));
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/restart');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'restart failed' });
    });
  });

  describe('updateContainer', () => {
    test('should update container successfully', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        result: { digest: 'sha256:new' },
        updateAvailable: true,
      };
      const clearedContainer = {
        ...container,
        image: { name: 'nginx:latest' },
        result: undefined,
        updateAvailable: false,
      };
      mockGetContainer
        .mockReturnValueOnce(container) // initial lookup
        .mockReturnValueOnce(container) // post-trigger check (still has updateAvailable)
        .mockReturnValueOnce(clearedContainer); // after updateContainer clears flag
      mockUpdateContainer.mockReturnValue(clearedContainer);
      const mockTriggerFn = vi.fn().mockResolvedValue(undefined);
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockTriggerFn).toHaveBeenCalledWith(container);
      expect(mockUpdateContainer).toHaveBeenCalledWith(
        expect.objectContaining({ result: undefined, updateAvailable: false }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container updated successfully',
        result: clearedContainer,
      });
    });

    test('should update container successfully with a dockercompose trigger', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        result: { digest: 'sha256:new' },
        updateAvailable: true,
      };
      const clearedContainer = {
        ...container,
        image: { name: 'nginx:latest' },
        result: undefined,
        updateAvailable: false,
      };
      mockGetContainer
        .mockReturnValueOnce(container) // initial lookup
        .mockReturnValueOnce(container) // post-trigger check
        .mockReturnValueOnce(clearedContainer); // after clearing flag
      mockUpdateContainer.mockReturnValue(clearedContainer);
      const mockTriggerFn = vi.fn().mockResolvedValue(undefined);
      const trigger = { type: 'dockercompose', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'dockercompose.default': trigger } });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockTriggerFn).toHaveBeenCalledWith(container);
      expect(mockUpdateContainer).toHaveBeenCalledWith(
        expect.objectContaining({ result: undefined, updateAvailable: false }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container updated successfully',
        result: clearedContainer,
      });
    });

    test('should not clear updateAvailable when the post-trigger container is already up to date', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      const updatedContainer = {
        ...container,
        image: { name: 'nginx:latest' },
        updateAvailable: false,
      };
      mockGetContainer
        .mockReturnValueOnce(container)
        .mockReturnValueOnce(updatedContainer)
        .mockReturnValueOnce(updatedContainer);
      const mockTriggerFn = vi.fn().mockResolvedValue(undefined);
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockTriggerFn).toHaveBeenCalledWith(container);
      expect(mockUpdateContainer).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container updated successfully',
        result: updatedContainer,
      });
    });

    test('should select the dockercompose trigger matching container compose labels', async () => {
      const container = {
        id: 'c1',
        name: 'apprise',
        image: { name: 'apprise' },
        updateAvailable: true,
        labels: {
          'com.docker.compose.project.config_files': '/opt/drydock/test/monitoring.yml',
        },
      };
      const updatedContainer = { ...container, image: { name: 'apprise:latest' } };
      mockGetContainer.mockReturnValueOnce(container).mockReturnValueOnce(updatedContainer);

      const mysqlTriggerFn = vi.fn().mockResolvedValue(undefined);
      const monitoringTriggerFn = vi.fn().mockResolvedValue(undefined);
      const mysqlTrigger = {
        type: 'dockercompose',
        configuration: { file: '/opt/drydock/test/mysql.yml' },
        getDefaultComposeFilePath: vi.fn(() => '/opt/drydock/test/mysql.yml'),
        getComposeFilesForContainer: vi.fn(() => ['/opt/drydock/test/monitoring.yml']),
        trigger: mysqlTriggerFn,
      };
      const monitoringTrigger = {
        type: 'dockercompose',
        configuration: { file: '/opt/drydock/test/monitoring.yml' },
        getDefaultComposeFilePath: vi.fn(() => '/opt/drydock/test/monitoring.yml'),
        getComposeFilesForContainer: vi.fn(() => ['/opt/drydock/test/monitoring.yml']),
        trigger: monitoringTriggerFn,
      };
      mockGetState.mockReturnValue({
        trigger: {
          'dockercompose.mysql': mysqlTrigger,
          'dockercompose.monitoring': monitoringTrigger,
        },
      });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(monitoringTriggerFn).toHaveBeenCalledWith(container);
      expect(mysqlTriggerFn).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should return 404 when container not found', async () => {
      mockGetContainer.mockReturnValue(undefined);

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'missing' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('should return 400 when no update available', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: false,
      };
      mockGetContainer.mockReturnValue(container);

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'No update available for this container' });
    });

    test('should return 409 when target is a temporary rollback -old container', async () => {
      const container = {
        id: 'c1',
        name: 'nginx-old-1773933154786',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      const mockTriggerFn = vi.fn().mockResolvedValue(undefined);
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('temporary rollback container'),
      });
      expect(mockTriggerFn).not.toHaveBeenCalled();
    });

    test('should return 409 when update is blocked by a security scan', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
        security: {
          scan: {
            status: 'blocked',
          },
        },
      };
      mockGetContainer.mockReturnValue(container);

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Update blocked by security scan. Use force-update to override.',
      });
    });

    test('should return 404 when no docker trigger found', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      mockGetState.mockReturnValue({ trigger: {} });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('No docker trigger found'),
      });
    });

    test('should return 403 when feature flag is disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container actions are disabled' });
    });

    test('should return 500 when trigger throws error', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      const mockTriggerFn = vi.fn().mockRejectedValue(new Error('pull failed'));
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'pull failed' });
    });

    test('should insert audit entry on success', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      const mockTriggerFn = vi.fn().mockResolvedValue(undefined);
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'container-update',
          containerName: 'nginx',
          status: 'success',
        }),
      );
    });

    test('should insert audit entry on error', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      const mockTriggerFn = vi.fn().mockRejectedValue(new Error('Docker error'));
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'container-update',
          status: 'error',
          details: 'Docker error',
        }),
      );
    });

    test('should increment counters on success', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      const mockTriggerFn = vi.fn().mockResolvedValue(undefined);
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const mockAuditInc = vi.fn();
      mockGetAuditCounter.mockReturnValue({ inc: mockAuditInc });
      const mockActionsInc = vi.fn();
      mockGetContainerActionsCounter.mockReturnValue({ inc: mockActionsInc });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockAuditInc).toHaveBeenCalledWith({ action: 'container-update' });
      expect(mockActionsInc).toHaveBeenCalledWith({ action: 'container-update' });
    });

    test('should stringify non-Error trigger failures', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      const mockTriggerFn = vi.fn().mockRejectedValue('update failed as string');
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'update failed as string' });
    });
  });
});
