import { createMockRequest, createMockResponse } from '../test/helpers.js';
import * as requestUpdate from '../updates/request-update.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const {
  mockRouter,
  mockGetContainer,
  mockUpdateContainer,
  mockMarkPendingFreshStateAfterManualUpdate,
  mockGetState,
  mockInsertAudit,
  mockGetAuditCounter,
  mockGetContainerActionsCounter,
  mockGetServerConfiguration,
  mockMarkOperationTerminal,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), post: vi.fn() },
  mockGetContainer: vi.fn(),
  mockUpdateContainer: vi.fn((c) => c),
  mockMarkPendingFreshStateAfterManualUpdate: vi.fn(),
  mockGetState: vi.fn(),
  mockInsertAudit: vi.fn(),
  mockGetAuditCounter: vi.fn(),
  mockGetContainerActionsCounter: vi.fn(),
  mockGetServerConfiguration: vi.fn(() => ({ feature: { containeractions: true } })),
  mockMarkOperationTerminal: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/container', () => ({
  getContainer: mockGetContainer,
  updateContainer: mockUpdateContainer,
  markPendingFreshStateAfterManualUpdate: mockMarkPendingFreshStateAfterManualUpdate,
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

vi.mock('../store/update-operation', () => ({
  listActiveOperations: vi.fn(() => []),
  insertOperation: vi.fn((op) => ({ id: op.id || 'op-mock', ...op })),
  updateOperation: vi.fn(),
  markOperationTerminal: mockMarkOperationTerminal,
  getOperationById: vi.fn(),
  getOperationsByContainerName: vi.fn(() => []),
  getInProgressOperationByContainerName: vi.fn(),
  getInProgressOperationByContainerId: vi.fn(),
  getActiveOperationByContainerName: vi.fn(),
  getActiveOperationByContainerId: vi.fn(),
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

async function flushAcceptedUpdateWork() {
  await Promise.resolve();
  await Promise.resolve();
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
    vi.resetAllMocks();
    mockUpdateContainer.mockImplementation((c) => c);
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
      expect(mockRouter.post).toHaveBeenCalledWith('/update', expect.any(Function));
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
    test('should accept update immediately and clear detected update state after trigger succeeds', async () => {
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

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container update accepted',
        operationId: expect.any(String),
      });
      const accepted = res.json.mock.calls[0][0];
      expect(mockTriggerFn).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'nginx' }),
        expect.objectContaining({ operationId: accepted.operationId }),
      );
      await flushAcceptedUpdateWork();
      expect(mockUpdateContainer).toHaveBeenCalledWith(
        expect.objectContaining({ result: undefined, updateAvailable: false }),
      );
      expect(mockMarkPendingFreshStateAfterManualUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'nginx' }),
        expect.any(Number),
      );
      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'container-update',
          containerName: 'nginx',
          status: 'success',
        }),
      );
      const contractValidation = validateOpenApiJsonResponse({
        path: '/api/containers/{id}/update',
        method: 'post',
        statusCode: '202',
        payload: accepted,
      });
      expect(contractValidation.valid).toBe(true);
      expect(contractValidation.errors).toStrictEqual([]);
    });

    test('should ignore client-authored batch queue metadata on single accepted updates', async () => {
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
      const updateOperationStore = await import('../store/update-operation');

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({
        params: { id: 'c1' },
        body: {
          batchId: 'batch-1',
          queuePosition: 2,
          queueTotal: 4,
        },
      });
      const res = createMockResponse();
      await handler(req, res);

      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          containerId: 'c1',
          containerName: 'nginx',
          status: 'queued',
          phase: 'queued',
        }),
      );
      expect(updateOperationStore.insertOperation).not.toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: expect.any(String),
        }),
      );
    });

    test('should accept update immediately with a dockercompose trigger', async () => {
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

      expect(res.status).toHaveBeenCalledWith(202);
      const accepted = res.json.mock.calls[0][0];
      expect(mockTriggerFn).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'nginx' }),
        expect.objectContaining({ operationId: accepted.operationId }),
      );
      await flushAcceptedUpdateWork();
      expect(mockUpdateContainer).toHaveBeenCalledWith(
        expect.objectContaining({ result: undefined, updateAvailable: false }),
      );
      expect(mockMarkPendingFreshStateAfterManualUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'nginx' }),
        expect.any(Number),
      );
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

      expect(res.status).toHaveBeenCalledWith(202);
      const accepted = res.json.mock.calls[0][0];
      expect(mockTriggerFn).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'nginx' }),
        expect.objectContaining({ operationId: accepted.operationId }),
      );
      await flushAcceptedUpdateWork();
      expect(mockUpdateContainer).not.toHaveBeenCalled();
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

      expect(res.status).toHaveBeenCalledWith(202);
      const accepted = res.json.mock.calls[0][0];
      expect(monitoringTriggerFn).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'apprise' }),
        expect.objectContaining({ operationId: accepted.operationId }),
      );
      expect(mysqlTriggerFn).not.toHaveBeenCalled();
      await flushAcceptedUpdateWork();
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

    test('should return 409 when a fresh update operation is already active for the container', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      const updateOperationStore = await import('../store/update-operation');
      (
        updateOperationStore.getActiveOperationByContainerId as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        id: 'op-active',
        containerId: 'c1',
        containerName: 'nginx',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-09T12:00:00.000Z',
      });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(updateOperationStore.getActiveOperationByContainerId).toHaveBeenCalledWith('c1');
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Container update already in progress',
      });
      expect(updateOperationStore.insertOperation).not.toHaveBeenCalled();
    });

    test('should return 409 when a legacy queued update is already tracked by container name', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      const updateOperationStore = await import('../store/update-operation');
      (
        updateOperationStore.getActiveOperationByContainerName as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        id: 'op-queued',
        containerName: 'nginx',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-09T12:00:00.000Z',
      });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(updateOperationStore.getActiveOperationByContainerId).toHaveBeenCalledWith('c1');
      expect(updateOperationStore.getActiveOperationByContainerName).toHaveBeenCalledWith('nginx');
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Container update already queued',
      });
    });

    test('should ignore name-based operations that already include a container id', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: false,
      };
      mockGetContainer.mockReturnValue(container);
      const updateOperationStore = await import('../store/update-operation');
      (
        updateOperationStore.getActiveOperationByContainerName as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        id: 'op-current-shape',
        containerId: 'c1',
        containerName: 'nginx',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-09T12:00:00.000Z',
      });

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'No update available for this container',
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

    test('should return 500 when update acceptance throws unexpectedly', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      mockGetState.mockReturnValue({
        trigger: {
          'docker.default': { type: 'docker', trigger: vi.fn() },
        },
      });
      const spy = vi
        .spyOn(requestUpdate, 'requestContainerUpdate')
        .mockRejectedValueOnce(new Error('accept blew up'));

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);
      spy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to accept container update' });
    });

    test('should return 500 when update acceptance throws a non-Error value', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      mockGetState.mockReturnValue({
        trigger: {
          'docker.default': { type: 'docker', trigger: vi.fn() },
        },
      });
      const spy = vi
        .spyOn(requestUpdate, 'requestContainerUpdate')
        .mockRejectedValueOnce('accept blew up as string');

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);
      spy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to accept container update' });
    });

    test('should accept update and record an error when trigger fails asynchronously', async () => {
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

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container update accepted',
        operationId: expect.any(String),
      });
      await flushAcceptedUpdateWork();
      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'container-update',
          status: 'error',
          details: 'pull failed',
        }),
      );
    });

    test('should mark a still-queued accepted update as failed when the trigger throws early', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      const mockTriggerFn = vi.fn().mockRejectedValue(new Error('Security scan blocked update'));
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });
      const updateOperationStore = await import('../store/update-operation');
      (updateOperationStore.getOperationById as ReturnType<typeof vi.fn>).mockImplementation(
        (id: string) => ({
          id,
          status: 'queued',
          phase: 'queued',
        }),
      );

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      const accepted = res.json.mock.calls[0][0];
      await flushAcceptedUpdateWork();

      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        accepted.operationId,
        {
          status: 'failed',
          phase: 'failed',
          lastError: 'Security scan blocked update',
        },
      );
    });

    test('should stringify a still-queued accepted update failure when the trigger throws a string', async () => {
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      mockGetContainer.mockReturnValue(container);
      const mockTriggerFn = vi.fn().mockRejectedValue('Security scan blocked update');
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });
      const updateOperationStore = await import('../store/update-operation');
      (updateOperationStore.getOperationById as ReturnType<typeof vi.fn>).mockImplementation(
        (id: string) => ({
          id,
          status: 'queued',
          phase: 'queued',
        }),
      );

      const handler = getHandler('post', '/:id/update');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      const accepted = res.json.mock.calls[0][0];
      await flushAcceptedUpdateWork();

      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        accepted.operationId,
        {
          status: 'failed',
          phase: 'failed',
          lastError: 'Security scan blocked update',
        },
      );
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

      expect(res.status).toHaveBeenCalledWith(202);
      await flushAcceptedUpdateWork();
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

      expect(res.status).toHaveBeenCalledWith(202);
      await flushAcceptedUpdateWork();
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

      expect(res.status).toHaveBeenCalledWith(202);
      await flushAcceptedUpdateWork();
      expect(mockAuditInc).toHaveBeenCalledWith({ action: 'container-update' });
      expect(mockActionsInc).toHaveBeenCalledWith({ action: 'container-update' });
    });

    test('should stringify non-Error trigger failures after accepting the update request', async () => {
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

      expect(res.status).toHaveBeenCalledWith(202);
      await flushAcceptedUpdateWork();
      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'container-update',
          status: 'error',
          details: 'update failed as string',
        }),
      );
    });
  });

  describe('updateContainers', () => {
    test('should return 403 when bulk updates are disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

      const handler = getHandler('post', '/update');
      const req = createMockRequest({ body: { containerIds: ['c1'] } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container actions are disabled' });
    });

    test('should return 400 when bulk body is missing containerIds', async () => {
      const handler = getHandler('post', '/update');
      const req = createMockRequest({ body: undefined });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'containerIds must be a non-empty array of container ids',
      });
    });

    test('should return 400 when bulk body normalizes to no valid ids', async () => {
      const handler = getHandler('post', '/update');
      const req = createMockRequest({
        body: { containerIds: [' ', '\n', 123, null] },
      });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'containerIds must be a non-empty array of container ids',
      });
    });

    test('should return 400 when bulk containerIds is not an array', async () => {
      const handler = getHandler('post', '/update');
      const req = createMockRequest({
        body: { containerIds: 'nginx' },
      });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'containerIds must be a non-empty array of container ids',
      });
    });

    test('should accept a bulk update request and return accepted and rejected containers', async () => {
      const nginx = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      };
      const redis = {
        id: 'c2',
        name: 'redis',
        image: { name: 'redis' },
        updateAvailable: false,
      };
      mockGetContainer.mockImplementation((id: string) => {
        if (id === 'c1') {
          return nginx;
        }
        if (id === 'c2') {
          return redis;
        }
        return undefined;
      });
      const mockTriggerFn = vi.fn().mockResolvedValue(undefined);
      const trigger = { type: 'docker', trigger: mockTriggerFn };
      mockGetState.mockReturnValue({ trigger: { 'docker.default': trigger } });

      const handler = getHandler('post', '/update');
      const req = createMockRequest({
        body: {
          containerIds: ['c1', 'c2'],
        },
      });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container update requests processed',
        accepted: [
          {
            containerId: 'c1',
            containerName: 'nginx',
            operationId: expect.any(String),
          },
        ],
        rejected: [
          {
            containerId: 'c2',
            containerName: 'redis',
            statusCode: 400,
            message: 'No update available for this container',
          },
        ],
      });
      expect(mockTriggerFn).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', name: 'nginx' }),
        expect.objectContaining({ operationId: expect.any(String) }),
      );
    });

    test('should record errors for bulk accepted updates that fail asynchronously', async () => {
      const nginx = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
        result: { digest: 'sha256:new' },
      };
      mockGetContainer.mockReturnValue(nginx);
      const mockTriggerFn = vi.fn().mockRejectedValue(new Error('bulk trigger failed'));
      mockGetState.mockReturnValue({
        trigger: { 'docker.default': { type: 'docker', trigger: mockTriggerFn } },
      });

      const handler = getHandler('post', '/update');
      const req = createMockRequest({
        body: {
          containerIds: ['c1'],
        },
      });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockInsertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'container-update',
          status: 'error',
          details: 'bulk trigger failed',
        }),
      );
    });

    test('should dedupe bulk container ids and merge rejected entries from the update layer', async () => {
      const nginx = {
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
        result: { digest: 'sha256:new' },
      };
      const redis = {
        id: 'c2',
        name: 'redis',
        image: { name: 'redis' },
        updateAvailable: false,
      };
      mockGetContainer.mockImplementation((id: string) => {
        if (id === 'c1') {
          return nginx;
        }
        if (id === 'c2') {
          return redis;
        }
        return undefined;
      });
      mockGetState.mockReturnValue({
        trigger: {
          'docker.default': { type: 'docker', trigger: vi.fn().mockResolvedValue(undefined) },
        },
      });
      const handler = getHandler('post', '/update');
      const req = createMockRequest({
        body: {
          containerIds: ['c1', 'c1', 'c2', 'missing'],
        },
      });
      const res = createMockResponse();
      await handler(req, res);
      await flushAcceptedUpdateWork();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accepted: [
            expect.objectContaining({
              containerId: 'c1',
              containerName: 'nginx',
              operationId: expect.any(String),
            }),
          ],
          rejected: expect.arrayContaining([
            expect.objectContaining({
              containerId: 'missing',
              containerName: 'missing',
              statusCode: 404,
              message: 'Container not found',
            }),
            expect.objectContaining({
              containerId: 'c2',
              containerName: 'redis',
              statusCode: 400,
              message: 'No update available for this container',
            }),
          ]),
        }),
      );
    });

    test('should return 500 when bulk acceptance throws unexpectedly', async () => {
      const spy = vi
        .spyOn(requestUpdate, 'requestContainerUpdates')
        .mockRejectedValueOnce(new Error('bulk blew up'));

      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      });

      const handler = getHandler('post', '/update');
      const req = createMockRequest({ body: { containerIds: ['c1'] } });
      const res = createMockResponse();
      await handler(req, res);
      spy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to accept container updates' });
    });

    test('should return 500 when bulk acceptance throws a non-Error value', async () => {
      const spy = vi
        .spyOn(requestUpdate, 'requestContainerUpdates')
        .mockRejectedValueOnce('bulk blew up as string');

      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        image: { name: 'nginx' },
        updateAvailable: true,
      });

      const handler = getHandler('post', '/update');
      const req = createMockRequest({ body: { containerIds: ['c1'] } });
      const res = createMockResponse();
      await handler(req, res);
      spy.mockRestore();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to accept container updates' });
    });
  });
});
