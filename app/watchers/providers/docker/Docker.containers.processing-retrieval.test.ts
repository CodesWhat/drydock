import {
  createMockLog,
  createMockLogWithChild,
  mockGetFullReleaseNotesForContainer,
  mockResolveSourceRepoForContainer,
  mockToContainerReleaseNotes,
  setupDockerWatcherContainerSuite,
} from './Docker.containers.test.helpers.js';

describe('Docker Watcher', () => {
  let docker;
  let mockDockerApi;
  let mockSchedule;
  let mockContainer;
  let mockImage;
  let hEvent: any;
  let hStoreContainer: any;

  setupDockerWatcherContainerSuite((state) => {
    docker = state.docker;
    mockDockerApi = state.mockDockerApi;
    mockSchedule = state.mockSchedule;
    mockContainer = state.mockContainer;
    mockImage = state.mockImage;
  });

  beforeEach(async () => {
    hEvent = await import('../../../event/index.js');
    hStoreContainer = await import('../../../store/container.js');
  });

  describe('Container Processing', () => {
    test('should watch individual container', async () => {
      const container = { id: 'test123', name: 'test' };
      const mockLog = createMockLogWithChild(['debug']);
      docker.log = mockLog;
      docker.findNewVersion = vi.fn().mockResolvedValue({ tag: '2.0.0' });
      docker.mapContainerToContainerReport = vi.fn().mockReturnValue({ container, changed: false });

      await docker.watchContainer(container);

      expect(docker.findNewVersion).toHaveBeenCalledWith(container, expect.any(Object));
      expect(hEvent.emitContainerReport).toHaveBeenCalled();
    });

    test('should handle container processing error', async () => {
      const container = { id: 'test123', name: 'test' };
      const mockLog = createMockLogWithChild(['warn', 'debug']);
      docker.log = mockLog;
      docker.findNewVersion = vi.fn().mockRejectedValue(new Error('Registry error'));
      docker.mapContainerToContainerReport = vi.fn().mockReturnValue({ container, changed: false });

      await docker.watchContainer(container);

      expect(mockLog._child.warn).toHaveBeenCalledWith(expect.stringContaining('Registry error'));
      expect(container.error).toEqual({ message: 'Registry error' });
    });

    test('should fallback to a non-empty message when container processing error is empty', async () => {
      const container = { id: 'test123', name: 'test' };
      const mockLog = createMockLogWithChild(['warn', 'debug']);
      docker.log = mockLog;
      docker.findNewVersion = vi.fn().mockRejectedValue(new Error(''));
      docker.mapContainerToContainerReport = vi.fn().mockReturnValue({ container, changed: false });

      await docker.watchContainer(container);

      expect(mockLog._child.warn).toHaveBeenCalledWith(
        'Error when processing (Unexpected container processing error)',
      );
      expect(container.error).toEqual({ message: 'Unexpected container processing error' });
    });

    test('should attach release notes and source repo for update-available containers', async () => {
      const container = {
        id: 'test123',
        name: 'test',
        updateAvailable: true,
        image: {
          name: 'acme/service',
          registry: {
            url: 'ghcr.io',
          },
          tag: {
            value: '1.0.0',
          },
        },
      };
      const mockLog = createMockLogWithChild(['warn', 'debug']);
      docker.log = mockLog;
      docker.findNewVersion = vi.fn().mockResolvedValue({ tag: '2.0.0' });
      docker.mapContainerToContainerReport = vi.fn().mockReturnValue({ container, changed: false });
      mockResolveSourceRepoForContainer.mockResolvedValue('github.com/acme/service');
      mockGetFullReleaseNotesForContainer.mockResolvedValue({
        title: 'v2.0.0',
        body: 'Release body',
        url: 'https://github.com/acme/service/releases/tag/v2.0.0',
        publishedAt: '2026-03-01T00:00:00.000Z',
        provider: 'github',
      });
      mockToContainerReleaseNotes.mockReturnValue({
        title: 'v2.0.0',
        body: 'Release body',
        url: 'https://github.com/acme/service/releases/tag/v2.0.0',
        publishedAt: '2026-03-01T00:00:00.000Z',
        provider: 'github',
      });

      await docker.watchContainer(container as any);

      expect(mockResolveSourceRepoForContainer).toHaveBeenCalledWith(container);
      expect(mockGetFullReleaseNotesForContainer).toHaveBeenCalledWith(container);
      expect(container.sourceRepo).toBe('github.com/acme/service');
      expect(container.result?.releaseNotes).toEqual({
        title: 'v2.0.0',
        body: 'Release body',
        url: 'https://github.com/acme/service/releases/tag/v2.0.0',
        publishedAt: '2026-03-01T00:00:00.000Z',
        provider: 'github',
      });
    });

    test('should ignore release notes failures', async () => {
      const container = {
        id: 'test123',
        name: 'test',
        updateAvailable: true,
        image: {
          name: 'acme/service',
          registry: {
            url: 'ghcr.io',
          },
          tag: {
            value: '1.0.0',
          },
        },
      };
      const mockLog = createMockLogWithChild(['warn', 'debug']);
      docker.log = mockLog;
      docker.findNewVersion = vi.fn().mockResolvedValue({ tag: '2.0.0' });
      docker.mapContainerToContainerReport = vi.fn().mockReturnValue({ container, changed: false });
      mockResolveSourceRepoForContainer.mockResolvedValue('github.com/acme/service');
      mockGetFullReleaseNotesForContainer.mockRejectedValue(new Error('rate limited'));

      await docker.watchContainer(container as any);

      expect(container.error).toBeUndefined();
      expect(mockLog._child.debug).toHaveBeenCalledWith(
        expect.stringContaining('Unable to fetch release notes'),
      );
    });
  });

  describe('Container Retrieval', () => {
    test('should get containers with default options', async () => {
      const containers = [
        {
          Id: '123',
          Labels: { 'dd.watch': 'true' },
          Names: ['/test'],
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: '123' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: true,
      });
      const result = await docker.getContainers();

      expect(mockDockerApi.listContainers).toHaveBeenCalledWith({});
      expect(result).toHaveLength(1);
    });

    test('should get all containers when watchall enabled', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);

      await docker.register('watcher', 'docker', 'test', {
        watchall: true,
      });
      await docker.getContainers();

      expect(mockDockerApi.listContainers).toHaveBeenCalledWith({
        all: true,
      });
    });

    test('should filter containers based on watch label', async () => {
      const containers = [
        { Id: '1', Labels: { 'dd.watch': 'true' }, Names: ['/test1'] },
        {
          Id: '2',
          Labels: { 'dd.watch': 'false' },
          Names: ['/test2'],
        },
        { Id: '3', Labels: {}, Names: ['/test3'] },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: '1' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      const result = await docker.getContainers();

      expect(result).toHaveLength(1);
    });

    test('should apply swarm service deploy labels to container filtering and tag include', async () => {
      const containers = [
        {
          Id: 'swarm-task-1',
          Image: 'authelia/authelia:4.39.15',
          Names: ['/authelia_authelia.1.xxxxx'],
          Labels: {
            'com.docker.swarm.service.id': 'service123',
          },
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          Spec: {
            Labels: {
              'dd.watch': 'true',
              'dd.tag.include': String.raw`^\d+\.\d+\.\d+$`,
            },
          },
        }),
      });
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'swarm-task-1' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      const result = await docker.getContainers();

      expect(result).toHaveLength(1);
      expect(mockDockerApi.getService).toHaveBeenCalledWith('service123');
      expect(docker.addImageDetailsToContainer).toHaveBeenCalledTimes(1);
      expect(docker.addImageDetailsToContainer.mock.calls[0][1].includeTags).toBe(
        String.raw`^\d+\.\d+\.\d+$`,
      );
    });

    test('should let container labels override swarm service labels', async () => {
      const containers = [
        {
          Id: 'swarm-task-2',
          Image: 'grafana/alloy:v1.12.2',
          Names: ['/monitoring_alloy.1.yyyyy'],
          Labels: {
            'com.docker.swarm.service.id': 'service456',
            'dd.watch': 'true',
            'dd.tag.include': String.raw`^v\d+\.\d+\.\d+$`,
          },
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          Spec: {
            Labels: {
              'dd.watch': 'false',
              'dd.tag.include': String.raw`^\d+\.\d+\.\d+$`,
            },
          },
        }),
      });
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'swarm-task-2' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      const result = await docker.getContainers();

      expect(result).toHaveLength(1);
      expect(docker.addImageDetailsToContainer.mock.calls[0][1].includeTags).toBe(
        String.raw`^v\d+\.\d+\.\d+$`,
      );
    });

    test('should cache swarm service label lookups per service', async () => {
      const containers = [
        {
          Id: 'swarm-task-3a',
          Image: 'example/service:1.0.0',
          Names: ['/svc.1.a'],
          Labels: {
            'com.docker.swarm.service.id': 'service789',
          },
        },
        {
          Id: 'swarm-task-3b',
          Image: 'example/service:1.0.0',
          Names: ['/svc.2.b'],
          Labels: {
            'com.docker.swarm.service.id': 'service789',
          },
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          Spec: {
            Labels: {
              'dd.watch': 'true',
            },
          },
        }),
      });
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'ok' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      await docker.getContainers();

      expect(mockDockerApi.getService).toHaveBeenCalledTimes(1);
      expect(mockDockerApi.getService).toHaveBeenCalledWith('service789');
    });

    test('should pick up dd labels from deploy-only labels (Spec.Labels) when container has no dd labels', async () => {
      // Simulates: docker-compose deploy: labels: dd.tag.include (NOT root labels:)
      // In Swarm, deploy labels go to Spec.Labels but NOT to container.Labels
      const containers = [
        {
          Id: 'swarm-deploy-only',
          Image: 'authelia/authelia:4.39.15',
          Names: ['/authelia_authelia.1.xxxxx'],
          Labels: {
            'com.docker.swarm.service.id': 'svc-deploy-labels',
            'com.docker.swarm.task.id': 'task1',
            'com.docker.swarm.task.name': 'authelia_authelia.1.xxxxx',
            // NO dd.* labels — they only exist in Spec.Labels
          },
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          Spec: {
            Labels: {
              'dd.watch': 'true',
              'dd.tag.include': String.raw`^\d+\.\d+\.\d+$`,
            },
            TaskTemplate: {
              ContainerSpec: {
                // No Labels here — deploy labels don't go to TaskTemplate
              },
            },
          },
        }),
      });
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'swarm-deploy-only' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      const result = await docker.getContainers();

      expect(result).toHaveLength(1);
      expect(docker.addImageDetailsToContainer).toHaveBeenCalledTimes(1);
      // The tag include regex should come from Spec.Labels
      expect(docker.addImageDetailsToContainer.mock.calls[0][1].includeTags).toBe(
        String.raw`^\d+\.\d+\.\d+$`,
      );
    });

    test('should gracefully handle swarm service inspect failure without losing container', async () => {
      const containers = [
        {
          Id: 'swarm-inspect-fail',
          Image: 'example/app:1.0.0',
          Names: ['/app.1.xxxxx'],
          Labels: {
            'com.docker.swarm.service.id': 'svc-fail',
            'dd.watch': 'true',
          },
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockRejectedValue(new Error('service not found')),
      });
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'swarm-inspect-fail' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      const result = await docker.getContainers();

      // Container should still be watched using its own labels
      expect(result).toHaveLength(1);
      // tag.include should be undefined since service inspect failed and
      // the container itself has no dd.tag.include
      expect(docker.addImageDetailsToContainer.mock.calls[0][1].includeTags).toBeUndefined();
    });

    test('should handle mixed label sources: deploy labels + root labels across services', async () => {
      // Simulates: authelia with deploy labels, alloy with root labels
      const containers = [
        {
          Id: 'swarm-authelia',
          Image: 'authelia/authelia:4.39.15',
          Names: ['/authelia_authelia.1.aaa'],
          Labels: {
            'com.docker.swarm.service.id': 'svc-authelia',
            // deploy: labels: go to Spec.Labels, NOT here
          },
        },
        {
          Id: 'swarm-alloy',
          Image: 'grafana/alloy:v1.12.2',
          Names: ['/monitoring_alloy.1.bbb'],
          Labels: {
            'com.docker.swarm.service.id': 'svc-alloy',
            // Root labels: ARE on the container
            'dd.watch': 'true',
            'dd.tag.include': String.raw`^v\d+\.\d+\.\d+$`,
          },
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      mockDockerApi.getService.mockImplementation((serviceId: string) => ({
        inspect: vi.fn().mockResolvedValue(
          serviceId === 'svc-authelia'
            ? {
                Spec: {
                  Labels: {
                    'dd.watch': 'true',
                    'dd.tag.include': String.raw`^\d+\.\d+\.\d+$`,
                  },
                },
              }
            : {
                Spec: {
                  TaskTemplate: {
                    ContainerSpec: {
                      Labels: {
                        'dd.watch': 'true',
                        'dd.tag.include': String.raw`^v\d+\.\d+\.\d+$`,
                      },
                    },
                  },
                },
              },
        ),
      }));
      docker.addImageDetailsToContainer = vi
        .fn()
        .mockImplementation((_container: any, labelOverrides: any) =>
          Promise.resolve({ id: _container.Id, includeTags: labelOverrides?.includeTags }),
        );

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      const result = await docker.getContainers();

      expect(result).toHaveLength(2);
      // Authelia's tag include should come from Spec.Labels (deploy labels)
      const autheliaCall = docker.addImageDetailsToContainer.mock.calls.find(
        (call: any) => call[0].Id === 'swarm-authelia',
      );
      expect(autheliaCall[1].includeTags).toBe(String.raw`^\d+\.\d+\.\d+$`);
      // Alloy's tag include should come from container labels (root labels)
      const alloyCall = docker.addImageDetailsToContainer.mock.calls.find(
        (call: any) => call[0].Id === 'swarm-alloy',
      );
      expect(alloyCall[1].includeTags).toBe(String.raw`^v\d+\.\d+\.\d+$`);
    });

    test('should prune old containers', async () => {
      const oldContainers = [{ id: 'old1' }, { id: 'old2' }];
      hStoreContainer.getContainers.mockReturnValue(oldContainers);
      mockDockerApi.listContainers.mockResolvedValue([]);
      // Simulate containers no longer existing in Docker
      mockDockerApi.getContainer.mockReturnValue({
        inspect: vi.fn().mockRejectedValue(new Error('no such container')),
      });

      await docker.register('watcher', 'docker', 'test', {});
      await docker.getContainers();

      expect(hStoreContainer.deleteContainer).toHaveBeenCalledWith('old1');
      expect(hStoreContainer.deleteContainer).toHaveBeenCalledWith('old2');
    });

    test('should continue when pruneOldContainers throws during stale record cleanup', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['warn']);
      hStoreContainer.getContainers.mockReturnValue([
        { id: 'old1', watcher: 'test', name: 'svc' } as any,
      ]);
      hStoreContainer.deleteContainer.mockImplementation(() => {
        throw new Error('Delete failed');
      });
      mockDockerApi.listContainers.mockResolvedValue([
        {
          Id: 'new1',
          Labels: { 'dd.watch': 'true' },
          Names: ['/svc'],
        },
      ]);
      docker.addImageDetailsToContainer = vi
        .fn()
        .mockResolvedValue({ id: 'new1', watcher: 'test', name: 'svc' });

      const result = await docker.getContainers();

      expect(result).toEqual([{ id: 'new1', watcher: 'test', name: 'svc' }]);
      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error when trying to prune the old containers (Delete failed)'),
      );
    });

    test('should handle pruning error', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['warn']);
      hStoreContainer.getContainers.mockImplementationOnce(() => {
        throw new Error('Store error');
      });
      mockDockerApi.listContainers.mockResolvedValue([]);

      await docker.getContainers();

      expect(docker.log.warn).toHaveBeenCalledWith(expect.stringContaining('Store error'));
    });
  });
});
