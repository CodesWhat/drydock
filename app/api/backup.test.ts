import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockRequest, createMockResponse } from '../test/helpers.js';
import { attachCreatedContainerCandidate } from '../triggers/providers/docker/created-container-candidate.js';
import Docker from '../triggers/providers/docker/Docker.js';

const {
  mockRouter,
  mockGetContainer,
  mockGetContainers,
  mockGetBackupsByName,
  mockGetBackupsForContainer,
  mockGetAllBackups,
  mockGetBackup,
  mockIsBackupInScope,
  mockGetState,
  mockGetAgent,
} = vi.hoisted(() => {
  const getBackupsByName = vi.fn();
  return {
    mockRouter: { use: vi.fn(), get: vi.fn(), post: vi.fn() },
    mockGetContainer: vi.fn(),
    mockGetContainers: vi.fn().mockReturnValue([]),
    mockGetBackupsByName: getBackupsByName,
    mockGetBackupsForContainer: vi.fn((scope) => getBackupsByName(scope.containerName)),
    mockGetAllBackups: vi.fn(),
    mockGetBackup: vi.fn(),
    mockIsBackupInScope: vi.fn(
      (entry, scope) =>
        entry.containerName === scope.containerName &&
        (entry.containerIdentityKey === undefined
          ? scope.includeLegacy
          : entry.containerIdentityKey === scope.containerIdentityKey),
    ),
    mockGetState: vi.fn(),
    mockGetAgent: vi.fn(),
  };
});

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/container', () => ({
  getContainer: mockGetContainer,
  getContainers: mockGetContainers,
}));

vi.mock('../store/backup', () => ({
  getBackupsByName: mockGetBackupsByName,
  getBackupsForContainer: mockGetBackupsForContainer,
  getAllBackups: mockGetAllBackups,
  getBackup: mockGetBackup,
  isBackupInScope: mockIsBackupInScope,
  pruneOldBackups: vi.fn(),
}));

vi.mock('../registry', () => ({
  getState: mockGetState,
}));

vi.mock('../agent/manager', () => ({
  getAgent: mockGetAgent,
}));

const { mockBackupLog } = vi.hoisted(() => ({
  mockBackupLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../log', () => ({
  default: { child: vi.fn(() => mockBackupLog) },
}));

import * as backupRouter from './backup.js';

function getHandler(method, path) {
  backupRouter.init();
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  return call[call.length - 1];
}

describe('Backup Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    test('should register routes', () => {
      backupRouter.init();
      expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
      expect(mockRouter.get).toHaveBeenCalledWith('/backups', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/:id/backups', expect.any(Function));
      expect(mockRouter.post).toHaveBeenCalledWith(
        '/:id/rollback',
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  describe('getBackups', () => {
    test('should return all backups when no containerId filter', () => {
      const handler = getHandler('get', '/backups');
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
      expect(res.json).toHaveBeenCalledWith({ data: allBackups, total: allBackups.length });
    });

    test('should return filtered backups when containerName provided', () => {
      const handler = getHandler('get', '/backups');
      const filtered = [{ id: 'b1', containerName: 'nginx' }];
      mockGetBackupsByName.mockReturnValue(filtered);

      const req = createMockRequest({ query: { containerName: 'nginx' } });
      const res = createMockResponse();
      handler(req, res);

      expect(mockGetBackupsByName).toHaveBeenCalledWith('nginx');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: filtered, total: filtered.length });
    });
  });

  describe('getContainerBackups', () => {
    test('should return 404 when container not found', () => {
      const handler = getHandler('get', '/:id/backups');
      mockGetContainer.mockReturnValue(undefined);

      const req = createMockRequest({ params: { id: 'missing' } });
      const res = createMockResponse();
      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('should return backups for existing container', () => {
      const handler = getHandler('get', '/:id/backups');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      const backups = [{ id: 'b1', containerName: 'nginx', imageTag: '1.24' }];
      mockGetBackupsByName.mockReturnValue(backups);

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      handler(req, res);

      expect(mockGetBackupsByName).toHaveBeenCalledWith('nginx');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: backups, total: backups.length });
    });

    test('should isolate same-named container backups by canonical identity', () => {
      const handler = getHandler('get', '/:id/backups');
      const target = { id: 'a1', name: 'web', watcher: 'watcher-a' };
      const sibling = { id: 'b1', name: 'web', watcher: 'watcher-b' };
      const targetBackups = [
        {
          id: 'backup-a',
          containerName: 'web',
          containerIdentityKey: '::watcher-a::web',
          imageTag: '1.0.0',
        },
      ];
      mockGetContainer.mockReturnValue(target);
      mockGetContainers.mockReturnValueOnce([target, sibling]);
      mockGetBackupsForContainer.mockReturnValueOnce(targetBackups);

      const req = createMockRequest({ params: { id: 'a1' } });
      const res = createMockResponse();
      handler(req, res);

      expect(mockGetBackupsForContainer).toHaveBeenCalledWith({
        containerName: 'web',
        containerIdentityKey: '::watcher-a::web',
        includeLegacy: false,
      });
      expect(res.json).toHaveBeenCalledWith({ data: targetBackups, total: 1 });
    });

    test('should use first id when route param id is an array', () => {
      const handler = getHandler('get', '/:id/backups');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetBackupsByName.mockReturnValue([]);

      const req = createMockRequest({ params: { id: ['c1', 'ignored'] } });
      const res = createMockResponse();
      handler(req, res);

      expect(mockGetContainer).toHaveBeenCalledWith('c1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: [], total: 0 });
    });

    test('should return empty array when container has no backups', () => {
      const handler = getHandler('get', '/:id/backups');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetBackupsByName.mockReturnValue([]);

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: [], total: 0 });
    });
  });

  describe('rollbackContainer', () => {
    test('should require destructive confirmation header', async () => {
      backupRouter.init();
      const call = mockRouter.post.mock.calls.find((c) => c[0] === '/:id/rollback');
      const confirmationMiddleware = call?.[1];

      const req = createMockRequest({
        params: { id: 'c1' },
        headers: {},
      });
      const res = createMockResponse();
      const next = vi.fn();

      confirmationMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(428);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Confirmation required: X-DD-Confirm-Action=container-rollback',
      });
    });

    test('should return 404 when container not found', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue(undefined);

      const req = createMockRequest({ params: { id: 'missing' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('should return 404 when no backups found', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetBackupsByName.mockReturnValue([]);

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('No backups found'),
      });
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
      mockGetBackup.mockReturnValue({ id: 'b2', containerName: 'redis' });

      const req = createMockRequest({ params: { id: 'c1' }, body: { backupId: 'b2' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockGetBackup).toHaveBeenCalledWith('b2');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Backup not found for this container' });
    });

    test('should reject an explicit backupId from a same-named sibling identity before pull', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const target = {
        id: 'a1',
        name: 'web',
        watcher: 'watcher-a',
        image: { registry: { name: 'hub' } },
      };
      const sibling = { id: 'b1', name: 'web', watcher: 'watcher-b' };
      const siblingBackup = {
        id: 'backup-b',
        containerName: 'web',
        containerIdentityKey: '::watcher-b::web',
        imageName: 'registry.example/b-web',
        imageTag: '9.0.0',
      };
      mockGetContainer.mockReturnValue(target);
      mockGetContainers.mockReturnValueOnce([target, sibling]);
      mockGetBackup.mockReturnValue(siblingBackup);
      mockIsBackupInScope.mockReturnValueOnce(false);

      const req = createMockRequest({ params: { id: 'a1' }, body: { backupId: 'backup-b' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockIsBackupInScope).toHaveBeenCalledWith(siblingBackup, {
        containerName: 'web',
        containerIdentityKey: '::watcher-a::web',
        includeLegacy: false,
      });
      expect(mockGetState).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Backup not found for this container' });
    });

    test('should reject a legacy backup when active same-named identities are ambiguous', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const target = {
        id: 'a1',
        name: 'web',
        watcher: 'watcher-a',
        image: { registry: { name: 'hub' } },
      };
      const sibling = { id: 'b1', name: 'web', watcher: 'watcher-b' };
      const legacyBackup = {
        id: 'legacy-backup',
        containerName: 'web',
        imageName: 'registry.example/legacy-web',
        imageTag: '1.0.0',
      };
      mockGetContainer.mockReturnValue(target);
      mockGetContainers.mockReturnValueOnce([target, sibling]);
      mockGetBackup.mockReturnValue(legacyBackup);

      const req = createMockRequest({
        params: { id: 'a1' },
        body: { backupId: 'legacy-backup' },
      });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockIsBackupInScope).toHaveBeenCalledWith(legacyBackup, {
        containerName: 'web',
        containerIdentityKey: '::watcher-a::web',
        includeLegacy: false,
      });
      expect(mockGetState).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('should return 404 when no docker trigger found', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue({ id: 'c1', name: 'nginx' });
      mockGetBackupsByName.mockReturnValue([
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
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('No docker trigger found'),
      });
    });

    test('should return 404 when a capable agent has no docker trigger registered yet', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        agent: 'edge-1',
        watcher: 'edge-1',
      });
      mockGetBackupsByName.mockReturnValue([
        {
          id: 'b1',
          containerId: 'c1',
          imageName: 'library/nginx',
          imageTag: '1.24',
        },
      ]);
      mockGetState.mockReturnValue({ trigger: {} });
      mockGetAgent.mockReturnValue({ hasControllerDockerTransport: vi.fn(() => true) });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('No docker trigger found'),
      });
    });

    test('should return 404, not 501, when the agent is unknown or disconnected', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        agent: 'edge-1',
        watcher: 'edge-1',
      });
      mockGetBackupsByName.mockReturnValue([
        {
          id: 'b1',
          containerId: 'c1',
          imageName: 'library/nginx',
          imageTag: '1.24',
        },
      ]);
      mockGetState.mockReturnValue({ trigger: {} });
      mockGetAgent.mockReturnValue(undefined);

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('No docker trigger found'),
      });
    });

    test('should return 501 when the agent-owned container agent lacks controller docker transport', async () => {
      const handler = getHandler('post', '/:id/rollback');
      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        agent: 'edge-1',
        watcher: 'edge-1',
      });
      mockGetBackupsByName.mockReturnValue([
        {
          id: 'b1',
          containerId: 'c1',
          imageName: 'library/nginx',
          imageTag: '1.24',
        },
      ]);
      mockGetState.mockReturnValue({ trigger: {} });
      mockGetAgent.mockReturnValue({ hasControllerDockerTransport: vi.fn(() => false) });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(501);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("container's agent connection"),
      });
    });

    test('should return 501, not 500, when a legacy incapable AgentTrigger is registered for the container', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const legacyAgentTrigger = {
        type: 'docker',
        agent: 'edge-1',
        getWatcher: vi.fn(() => {
          throw new Error(
            'AgentTrigger docker.edge-1 cannot provide local Docker capability getWatcher; the agent does not advertise controller Docker transport',
          );
        }),
      };
      mockGetContainer.mockReturnValue({
        id: 'c1',
        name: 'nginx',
        agent: 'edge-1',
        watcher: 'edge-1',
      });
      mockGetBackupsByName.mockReturnValue([
        {
          id: 'b1',
          containerId: 'c1',
          imageName: 'library/nginx',
          imageTag: '1.24',
        },
      ]);
      mockGetState.mockReturnValue({ trigger: { 'docker.edge-1': legacyAgentTrigger } });
      mockGetAgent.mockReturnValue({ hasControllerDockerTransport: vi.fn(() => false) });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(legacyAgentTrigger.getWatcher).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(501);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("container's agent connection"),
      });
    });

    test('should roll back an agent-owned container whose agent advertises controller docker transport', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        agent: 'edge-1',
        watcher: 'edge-1',
        image: { registry: { name: 'hub' } },
      };
      const latestBackup = {
        id: 'b1',
        containerId: 'c1',
        imageName: 'library/nginx',
        imageTag: '1.24',
      };

      mockGetContainer.mockReturnValue(container);
      mockGetBackupsByName.mockReturnValue([latestBackup]);
      mockGetAgent.mockReturnValue({ hasControllerDockerTransport: vi.fn(() => true) });

      const mockCurrentContainer = {};
      const mockContainerSpec = { State: { Running: true } };
      const mockTrigger = {
        type: 'docker',
        agent: 'edge-1',
        getWatcher: vi.fn(() => ({ dockerApi: {} })),
        pullImage: vi.fn().mockResolvedValue(undefined),
        getCurrentContainer: vi.fn().mockResolvedValue(mockCurrentContainer),
        inspectContainer: vi.fn().mockResolvedValue(mockContainerSpec),
        stopAndRemoveContainer: vi.fn().mockResolvedValue(undefined),
        recreateContainer: vi.fn().mockResolvedValue(undefined),
      };
      mockGetState.mockReturnValue({
        trigger: { 'docker.edge-1': mockTrigger },
        registry: { hub: { getAuthPull: vi.fn().mockResolvedValue({}) } },
      });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockTrigger.pullImage).toHaveBeenCalled();
      expect(mockTrigger.stopAndRemoveContainer).toHaveBeenCalled();
      expect(mockTrigger.recreateContainer).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container rolled back successfully',
        backup: latestBackup,
      });
    });

    test('should rollback successfully', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        watcher: 'local',
        image: { registry: { name: 'hub' } },
      };
      const latestBackup = {
        id: 'b1',
        containerId: 'c1',
        containerName: 'nginx',
        containerIdentityKey: '::local::nginx',
        imageName: 'library/nginx',
        imageTag: '1.24',
        imageDigest: 'sha256:old',
      };

      mockGetContainer.mockReturnValue(container);
      mockGetContainers.mockReturnValueOnce([container]);
      mockGetBackupsByName.mockReturnValue([latestBackup]);

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

      expect(mockGetBackupsForContainer).toHaveBeenCalledWith({
        containerName: 'nginx',
        containerIdentityKey: '::local::nginx',
        includeLegacy: true,
      });
      expect(mockTrigger.pullImage).toHaveBeenCalledWith(
        {},
        {},
        'library/nginx@sha256:old',
        expect.anything(),
      );
      expect(mockTrigger.stopAndRemoveContainer).toHaveBeenCalled();
      expect(mockTrigger.recreateContainer).toHaveBeenCalledWith(
        {},
        mockContainerSpec,
        'library/nginx@sha256:old',
        container,
        expect.anything(),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container rolled back successfully',
        backup: latestBackup,
      });
    });

    test('should rollback successfully with a dockercompose trigger', async () => {
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
      mockGetBackupsByName.mockReturnValue([latestBackup]);

      const mockCurrentContainer = {};
      const mockContainerSpec = { State: { Running: true } };
      const composeTrigger = {
        type: 'dockercompose',
        getWatcher: vi.fn(() => ({ dockerApi: {} })),
        pullImage: vi.fn().mockResolvedValue(undefined),
        getCurrentContainer: vi.fn().mockResolvedValue(mockCurrentContainer),
        inspectContainer: vi.fn().mockResolvedValue(mockContainerSpec),
        stopAndRemoveContainer: vi.fn().mockResolvedValue(undefined),
        recreateContainer: vi.fn().mockResolvedValue(undefined),
      };
      mockGetState.mockReturnValue({
        trigger: { 'dockercompose.default': composeTrigger },
        registry: { hub: { getAuthPull: vi.fn().mockResolvedValue({}) } },
      });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(composeTrigger.pullImage).toHaveBeenCalled();
      expect(composeTrigger.stopAndRemoveContainer).toHaveBeenCalled();
      expect(composeTrigger.recreateContainer).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container rolled back successfully',
        backup: latestBackup,
      });
      expect(composeTrigger.pullImage).toHaveBeenCalledWith(
        {},
        {},
        'library/nginx:1.24',
        expect.anything(),
      );
      expect(composeTrigger.recreateContainer).toHaveBeenCalledWith(
        {},
        mockContainerSpec,
        'library/nginx:1.24',
        container,
        expect.anything(),
      );
    });

    test('should rollback successfully when a valid backupId is provided', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        watcher: 'local',
        image: { registry: { name: 'hub' } },
      };
      const selectedBackup = {
        id: 'b2',
        containerName: 'nginx',
        imageName: 'library/nginx',
        imageTag: '1.25',
      };

      mockGetContainer.mockReturnValue(container);
      mockGetContainers.mockReturnValueOnce([container]);
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
      expect(mockIsBackupInScope).toHaveBeenCalledWith(selectedBackup, {
        containerName: 'nginx',
        containerIdentityKey: '::local::nginx',
        includeLegacy: true,
      });
      expect(mockGetBackupsByName).not.toHaveBeenCalled();
      expect(mockTrigger.pullImage).toHaveBeenCalled();
      expect(mockTrigger.stopAndRemoveContainer).toHaveBeenCalled();
      expect(mockTrigger.recreateContainer).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Container rolled back successfully',
        backup: selectedBackup,
      });
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
      mockGetBackupsByName.mockReturnValue([latestBackup]);

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
      mockGetBackupsByName.mockReturnValue([
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
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to complete container action' });
    });

    test('should stringify non-Error rollback failures', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { registry: { name: 'hub' } },
      };
      mockGetContainer.mockReturnValue(container);
      mockGetBackupsByName.mockReturnValue([
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
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to complete container action' });
    });

    test('cleans up an orphaned candidate attached to a recreateContainer failure', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { registry: { name: 'hub' } },
      };
      mockGetContainer.mockReturnValue(container);
      mockGetBackupsByName.mockReturnValue([
        {
          id: 'b1',
          containerId: 'c1',
          imageName: 'library/nginx',
          imageTag: '1.24',
        },
      ]);

      const orphanCandidate = {
        stop: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      const connectError = new Error('connect EACCES: denied by socket proxy');
      attachCreatedContainerCandidate(connectError, orphanCandidate);

      const mockCurrentContainer = {};
      const mockContainerSpec = { State: { Running: true } };
      const mockTrigger = {
        type: 'docker',
        getWatcher: vi.fn(() => ({ dockerApi: {} })),
        pullImage: vi.fn().mockResolvedValue(undefined),
        getCurrentContainer: vi.fn().mockResolvedValue(mockCurrentContainer),
        inspectContainer: vi.fn().mockResolvedValue(mockContainerSpec),
        stopAndRemoveContainer: vi.fn().mockResolvedValue(undefined),
        recreateContainer: vi.fn().mockRejectedValue(connectError),
      };
      mockGetState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
        registry: { hub: { getAuthPull: vi.fn().mockResolvedValue({}) } },
      });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(orphanCandidate.stop).toHaveBeenCalledTimes(1);
      expect(orphanCandidate.remove).toHaveBeenCalledWith({ force: true });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to complete container action' });
    });

    test('warns but still reports rollback error when orphaned-candidate cleanup itself fails', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { registry: { name: 'hub' } },
      };
      mockGetContainer.mockReturnValue(container);
      mockGetBackupsByName.mockReturnValue([
        {
          id: 'b1',
          containerId: 'c1',
          imageName: 'library/nginx',
          imageTag: '1.24',
        },
      ]);

      const orphanCandidate = {
        stop: vi.fn().mockRejectedValue(new Error('stop exploded')),
        remove: vi.fn().mockRejectedValue('remove exploded as string'),
      };
      const connectError = new Error('connect EACCES: denied by socket proxy');
      attachCreatedContainerCandidate(connectError, orphanCandidate);

      const mockCurrentContainer = {};
      const mockContainerSpec = { State: { Running: true } };
      const mockTrigger = {
        type: 'docker',
        getWatcher: vi.fn(() => ({ dockerApi: {} })),
        pullImage: vi.fn().mockResolvedValue(undefined),
        getCurrentContainer: vi.fn().mockResolvedValue(mockCurrentContainer),
        inspectContainer: vi.fn().mockResolvedValue(mockContainerSpec),
        stopAndRemoveContainer: vi.fn().mockResolvedValue(undefined),
        recreateContainer: vi.fn().mockRejectedValue(connectError),
      };
      mockGetState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
        registry: { hub: { getAuthPull: vi.fn().mockResolvedValue({}) } },
      });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(mockBackupLog.warn).toHaveBeenCalledWith(
        'Unable to stop orphaned replacement container nginx (stop exploded)',
      );
      expect(mockBackupLog.warn).toHaveBeenCalledWith(
        'Unable to remove orphaned replacement container nginx (remove exploded as string)',
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to complete container action' });
    });

    test('recovers the orphan through the REAL Docker.recreateContainer create-then-start path when start fails', async () => {
      const handler = getHandler('post', '/:id/rollback');
      const container = {
        id: 'c1',
        name: 'nginx',
        image: { registry: { name: 'hub' } },
      };
      mockGetContainer.mockReturnValue(container);
      mockGetBackupsByName.mockReturnValue([
        {
          id: 'b1',
          containerId: 'c1',
          imageName: 'library/nginx',
          imageTag: '1.24',
        },
      ]);

      const realDocker = new Docker();
      vi.spyOn(realDocker, 'cloneContainer').mockReturnValue({ Name: '/nginx' });

      const newContainerHandle = {
        start: vi.fn().mockRejectedValue(new Error('start failed: denied by socket proxy')),
        stop: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      const dockerApi = {
        createContainer: vi.fn().mockResolvedValue(newContainerHandle),
      };

      const mockCurrentContainer = {};
      const mockContainerSpec = { State: { Running: true } };
      const mockTrigger = {
        type: 'docker',
        getWatcher: vi.fn(() => ({ dockerApi })),
        pullImage: vi.fn().mockResolvedValue(undefined),
        getCurrentContainer: vi.fn().mockResolvedValue(mockCurrentContainer),
        inspectContainer: vi.fn().mockResolvedValue(mockContainerSpec),
        stopAndRemoveContainer: vi.fn().mockResolvedValue(undefined),
        recreateContainer: realDocker.recreateContainer.bind(realDocker),
      };
      mockGetState.mockReturnValue({
        trigger: { 'docker.default': mockTrigger },
        registry: { hub: { getAuthPull: vi.fn().mockResolvedValue({}) } },
      });

      const req = createMockRequest({ params: { id: 'c1' } });
      const res = createMockResponse();
      await handler(req, res);

      expect(dockerApi.createContainer).toHaveBeenCalledTimes(1);
      expect(newContainerHandle.start).toHaveBeenCalledTimes(1);
      expect(newContainerHandle.stop).toHaveBeenCalledTimes(1);
      expect(newContainerHandle.remove).toHaveBeenCalledWith({ force: true });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unable to complete container action' });
    });
  });
});
