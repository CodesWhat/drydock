// @ts-nocheck
import { createMockRequest, createMockResponse } from '../test/helpers.js';

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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Container started successfully' }),
      );
    });

    test('should return 404 when container not found', async () => {
      mockGetContainer.mockReturnValue(undefined);

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'missing' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return 404 when no docker trigger found', async () => {
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetState.mockReturnValue({ trigger: {} });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('No docker trigger found') }),
      );
    });

    test('should return 403 when feature flag is disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

      const handler = getHandler('post', '/:id/start');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.sendStatus).toHaveBeenCalledWith(403);
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('container already started') }),
      );
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('start failed as string') }),
      );
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Container stopped successfully' }),
      );
    });

    test('should return 403 when feature flag is disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

      const handler = getHandler('post', '/:id/stop');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.sendStatus).toHaveBeenCalledWith(403);
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('stop failed') }),
      );
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Container restarted successfully' }),
      );
    });

    test('should return 403 when feature flag is disabled', async () => {
      mockGetServerConfiguration.mockReturnValue({ feature: { containeractions: false } });

      const handler = getHandler('post', '/:id/restart');
      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.sendStatus).toHaveBeenCalledWith(403);
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('restart failed') }),
      );
    });
  });
});
