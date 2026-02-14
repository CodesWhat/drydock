import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockRequest, createMockResponse } from '../test/helpers.js';

const {
  mockRouter,
  mockGetContainer,
  mockGetBackups,
  mockGetAllBackups,
  mockGetBackup,
  mockGetState,
} = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
  mockGetContainer: vi.fn(),
  mockGetBackups: vi.fn(),
  mockGetAllBackups: vi.fn(),
  mockGetBackup: vi.fn(),
  mockGetState: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/container', () => ({
  getContainer: mockGetContainer,
}));

vi.mock('../store/backup', () => ({
  getBackups: mockGetBackups,
  getAllBackups: mockGetAllBackups,
  getBackup: mockGetBackup,
}));

vi.mock('../registry', () => ({
  getState: mockGetState,
}));

vi.mock('../log', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
}));

import * as backupRouter from './backup.js';

function getHandler(method, path) {
  backupRouter.init();
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  return call[1];
}

describe('Backup Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    test('should register routes', () => {
      backupRouter.init();
      expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
      expect(mockRouter.get).toHaveBeenCalledWith('/', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/:id/backups', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith('/:id/rollback', expect.any(Function));
    });
  });

  describe('getBackups', () => {
    test('should return all backups when no containerId filter', () => {
      const handler = getHandler('get', '/');
      const allBackups = [
        { id: 'b1', containerId: 'c1' },
        { id: 'b2', containerId: 'c2' },
      ];
      mockGetAllBackups.mockReturnValue(allBackups);

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      handler(req, res);

      expect(mockGetAllBackups).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(allBackups);
    });

    test('should return filtered backups when containerId provided', () => {
      const handler = getHandler('get', '/');
      const filtered = [{ id: 'b1', containerId: 'c1' }];
      mockGetBackups.mockReturnValue(filtered);

      const req = createMockRequest({ query: { containerId: 'c1' } });
      const res = createMockResponse();
      handler(req, res);

      expect(mockGetBackups).toHaveBeenCalledWith('c1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(filtered);
    });
  });

  describe('getContainerBackups', () => {
    test('should return 404 when container not found', () => {
      const handler = getHandler('get', '/:id/backups');
      mockGetContainer.mockReturnValue(undefined);

      const req = createMockRequest({ params: { id: 'missing' } });
      const res = createMockResponse();
      handler(req, res);

      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return backups for existing container', () => {
      const handler = getHandler('get', '/:id/backups');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      const backups = [{ id: 'b1', containerId: 'c1', imageTag: '1.24' }];
      mockGetBackups.mockReturnValue(backups);

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      handler(req, res);

      expect(mockGetBackups).toHaveBeenCalledWith('c1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(backups);
    });

    test('should return empty array when container has no backups', () => {
      const handler = getHandler('get', '/:id/backups');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetBackups.mockReturnValue([]);

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([]);
    });
  });

  describe('rollbackContainer', () => {
    test('should return 404 when container not found', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue(undefined);

      const req = createMockRequest({ params: { id: 'missing' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return 404 when no backups found', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetBackups.mockReturnValue([]);

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('No backups found') }),
      );
    });

    test('should return 404 when backupId does not exist', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetBackup.mockReturnValue(undefined);

      const req = createMockRequest({ params: { id: 'c1' }, body: { backupId: 'missing-backup' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockGetBackup).toHaveBeenCalledWith('missing-backup');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Backup not found for this container' });
    });

    test('should return 404 when backupId belongs to another container', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetBackup.mockReturnValue({ id: 'b2', containerId: 'c2' });

      const req = createMockRequest({ params: { id: 'c1' }, body: { backupId: 'b2' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockGetBackup).toHaveBeenCalledWith('b2');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Backup not found for this container' });
    });

    test('should return 404 when no docker trigger found', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetBackups.mockReturnValue([
        {
          id: 'b1',
          containerId: 'c1',
          imageName: 'library/nginx',
          imageTag: '1.24',
        },
      ]);
      mockGetState.mockReturnValue({ trigger: {} });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('No docker trigger found') }),
      );
    });

    test('should rollback successfully', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { registry: { name: 'hub' } },
      };
      const latestBackup = {
        id: 'b1',
        containerId: 'c1',
        imageName: 'library/nginx',
        imageTag: '1.24',
      };

      mockGetContainer.mockReturnValue(container);
      mockGetBackups.mockReturnValue([latestBackup]);

      const mockCurrentContainer = {};
      const mockContainerSpec = { State: { Running: true } };
      const mockTrigger = {
        type: 'docker',
        getWatcher: vi.fn(() => ({ dockerApi: {} })),
        pullImage: vi.fn().mockResolvedValue(undefined),
        getCurrentContainer: vi.fn().mockResolvedValue(mockCurrentContainer),
        inspectContainer: vi.fn().mockResolvedValue(mockContainerSpec),
        stopAndRemoveContainer: vi.fn().mockResolvedValue(undefined),
        recreateContainer: vi.fn().mockResolvedValue(undefined),
      };
      mockGetState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
        registry: { hub: { getAuthPull: vi.fn().mockResolvedValue({}) } },
      });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockTrigger.pullImage).toHaveBeenCalled();
      expect(mockTrigger.stopAndRemoveContainer).toHaveBeenCalled();
      expect(mockTrigger.recreateContainer).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Container rolled back successfully',
          backup: latestBackup,
        }),
      );
    });

    test('should rollback successfully when a valid backupId is provided', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { registry: { name: 'hub' } },
      };
      const selectedBackup = {
        id: 'b2',
        containerId: 'c1',
        imageName: 'library/nginx',
        imageTag: '1.25',
      };

      mockGetContainer.mockReturnValue(container);
      mockGetBackup.mockReturnValue(selectedBackup);

      const mockCurrentContainer = {};
      const mockContainerSpec = { State: { Running: true } };
      const mockTrigger = {
        type: 'docker',
        getWatcher: vi.fn(() => ({ dockerApi: {} })),
        pullImage: vi.fn().mockResolvedValue(undefined),
        getCurrentContainer: vi.fn().mockResolvedValue(mockCurrentContainer),
        inspectContainer: vi.fn().mockResolvedValue(mockContainerSpec),
        stopAndRemoveContainer: vi.fn().mockResolvedValue(undefined),
        recreateContainer: vi.fn().mockResolvedValue(undefined),
      };
      mockGetState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
        registry: { hub: { getAuthPull: vi.fn().mockResolvedValue({}) } },
      });

      const req = createMockRequest({ params: { id: 'c1' }, body: { backupId: 'b2' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockGetBackup).toHaveBeenCalledWith('b2');
      expect(mockGetBackups).not.toHaveBeenCalled();
      expect(mockTrigger.pullImage).toHaveBeenCalled();
      expect(mockTrigger.stopAndRemoveContainer).toHaveBeenCalled();
      expect(mockTrigger.recreateContainer).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Container rolled back successfully',
          backup: selectedBackup,
        }),
      );
    });

    test('should return 500 when current container cannot be found in Docker', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { registry: { name: 'hub' } },
      };
      const latestBackup = {
        id: 'b1',
        containerId: 'c1',
        imageName: 'library/nginx',
        imageTag: '1.24',
      };

      mockGetContainer.mockReturnValue(container);
      mockGetBackups.mockReturnValue([latestBackup]);

      const mockTrigger = {
        type: 'docker',
        getWatcher: vi.fn(() => ({ dockerApi: {} })),
        pullImage: vi.fn().mockResolvedValue(undefined),
        getCurrentContainer: vi.fn().mockResolvedValue(undefined),
      };
      mockGetState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
        registry: { hub: { getAuthPull: vi.fn().mockResolvedValue({}) } },
      });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found in Docker' });
    });

    test('should return 500 when rollback fails', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { registry: { name: 'hub' } },
      };
      mockGetContainer.mockReturnValue(container);
      mockGetBackups.mockReturnValue([
        {
          id: 'b1',
          containerId: 'c1',
          imageName: 'library/nginx',
          imageTag: '1.24',
        },
      ]);

      const mockTrigger = {
        type: 'docker',
        getWatcher: vi.fn(() => ({ dockerApi: {} })),
        pullImage: vi.fn().mockRejectedValue(new Error('Pull failed')),
      };
      mockGetState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
        registry: { hub: { getAuthPull: vi.fn().mockResolvedValue({}) } },
      });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Pull failed') }),
      );
    });

    test('should stringify non-Error rollback failures', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { registry: { name: 'hub' } },
      };
      mockGetContainer.mockReturnValue(container);
      mockGetBackups.mockReturnValue([
        {
          id: 'b1',
          containerId: 'c1',
          imageName: 'library/nginx',
          imageTag: '1.24',
        },
      ]);

      const mockTrigger = {
        type: 'docker',
        getWatcher: vi.fn(() => ({ dockerApi: {} })),
        pullImage: vi.fn().mockRejectedValue('pull failed as string'),
      };
      mockGetState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
        registry: { hub: { getAuthPull: vi.fn().mockResolvedValue({}) } },
      });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('pull failed as string') }),
      );
    });
  });
});
