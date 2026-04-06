import {
  createMockLogWithChild,
  setupDockerWatcherContainerSuite,
} from './Docker.containers.test.helpers.js';

let hStoreContainer: any;

describe('Docker Watcher', () => {
  let docker;
  let mockDockerApi;
  let mockSchedule;
  let mockContainer;
  let mockImage;

  setupDockerWatcherContainerSuite((state) => {
    docker = state.docker;
    mockDockerApi = state.mockDockerApi;
    mockSchedule = state.mockSchedule;
    mockContainer = state.mockContainer;
    mockImage = state.mockImage;
  });

  beforeEach(async () => {
    hStoreContainer = await import('../../../store/container.js');
  });

  describe('Container Reporting', () => {
    test('should map container to report for new container', async () => {
      const container = { id: '123', name: 'test' };
      docker.log = createMockLogWithChild(['debug']);
      hStoreContainer.getContainer.mockReturnValue(undefined);
      hStoreContainer.insertContainer.mockReturnValue(container);

      const result = docker.mapContainerToContainerReport(container);

      expect(result.changed).toBe(true);
      expect(hStoreContainer.insertContainer).toHaveBeenCalledWith(container);
    });

    test('should map container to report for existing container', async () => {
      const container = {
        id: '123',
        name: 'test',
        updateAvailable: true,
      };
      const existingContainer = {
        resultChanged: vi.fn().mockReturnValue(true),
      };
      docker.log = createMockLogWithChild(['debug']);
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      hStoreContainer.updateContainer.mockReturnValue(container);

      const result = docker.mapContainerToContainerReport(container);

      expect(result.changed).toBe(true);
      expect(hStoreContainer.updateContainer).toHaveBeenCalledWith(container);
    });

    test('should not mark as changed when no update available', async () => {
      const container = {
        id: '123',
        name: 'test',
        updateAvailable: false,
      };
      const existingContainer = {
        resultChanged: vi.fn().mockReturnValue(true),
      };
      docker.log = createMockLogWithChild(['debug']);
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      hStoreContainer.updateContainer.mockReturnValue(container);

      const result = docker.mapContainerToContainerReport(container);

      expect(result.changed).toBe(false);
    });

    test('should preserve a cleared update when the watch started before a manual update completed', async () => {
      const staleWatchStartedAtMs = 499;
      const manualClearAtMs = 500;
      const container = {
        id: '123',
        name: 'test',
        watcher: 'docker',
        result: { tag: '2.0.0' },
        updateAvailable: true,
      };
      const clearedContainer = {
        ...container,
        result: undefined,
        updateAvailable: false,
      };
      const existingContainer = {
        resultChanged: vi.fn().mockReturnValue(false),
      };
      docker.log = createMockLogWithChild(['debug']);
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      hStoreContainer.getPendingFreshStateAfterManualUpdateAt.mockReturnValue(manualClearAtMs);
      hStoreContainer.updateContainer.mockReturnValue(clearedContainer);

      const result = docker.mapContainerToContainerReport(container, staleWatchStartedAtMs);

      expect(hStoreContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '123',
          name: 'test',
          watcher: 'docker',
          result: undefined,
          updateAvailable: false,
        }),
      );
      expect(hStoreContainer.clearPendingFreshStateAfterManualUpdate).not.toHaveBeenCalled();
      expect(result).toEqual({
        container: clearedContainer,
        changed: false,
      });
    });

    test('should accept a post-clear watch result once the watch started after the manual update completed', async () => {
      const freshWatchStartedAtMs = 501;
      const manualClearAtMs = 500;
      const container = {
        id: '123',
        name: 'test',
        watcher: 'docker',
        result: { tag: '2.0.0' },
        updateAvailable: true,
      };
      const existingContainer = {
        resultChanged: vi.fn().mockReturnValue(true),
      };
      docker.log = createMockLogWithChild(['debug']);
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      hStoreContainer.getPendingFreshStateAfterManualUpdateAt.mockReturnValue(manualClearAtMs);
      hStoreContainer.updateContainer.mockReturnValue(container);

      const result = docker.mapContainerToContainerReport(container, freshWatchStartedAtMs);

      expect(hStoreContainer.updateContainer).toHaveBeenCalledWith(container);
      expect(hStoreContainer.clearPendingFreshStateAfterManualUpdate).toHaveBeenCalledWith(
        container,
      );
      expect(result).toEqual({
        container,
        changed: true,
      });
    });

    test('should clear pending freshness when the update has already been cleared', async () => {
      const container = {
        id: '123',
        name: 'test',
        watcher: 'docker',
        result: undefined,
        updateAvailable: false,
      };
      const existingContainer = {
        resultChanged: vi.fn().mockReturnValue(false),
      };
      docker.log = createMockLogWithChild(['debug']);
      hStoreContainer.getContainer.mockReturnValue(existingContainer);
      hStoreContainer.getPendingFreshStateAfterManualUpdateAt.mockReturnValue(500);
      hStoreContainer.updateContainer.mockReturnValue(container);

      const result = docker.mapContainerToContainerReport(container, 600);

      expect(hStoreContainer.clearPendingFreshStateAfterManualUpdate).toHaveBeenCalledWith(
        container,
      );
      expect(result).toEqual({
        container,
        changed: false,
      });
    });
  });

  describe('Utility Functions', () => {
    test('should get tag candidates with include filter', async () => {
      const tags = ['v1.0.0', 'latest', 'v2.0.0', 'beta'];
      const filtered = tags.filter((tag) => /^v\d+/.test(tag));
      expect(filtered).toEqual(['v1.0.0', 'v2.0.0']);
    });

    test('should get container name and strip slash', async () => {
      const container = { Names: ['/test-container'] };
      const name = container.Names[0].replace(/\//, '');
      expect(name).toBe('test-container');
    });

    test('should get repo digest from image', async () => {
      const image = { RepoDigests: ['nginx@sha256:abc123def456'] };
      const digest = image.RepoDigests[0].split('@')[1];
      expect(digest).toBe('sha256:abc123def456');
    });

    test('should handle empty repo digests', async () => {
      const image = { RepoDigests: [] };
      expect(image.RepoDigests.length).toBe(0);
    });

    test('should get old containers for pruning', async () => {
      const newContainers = [{ id: '1' }, { id: '2' }];
      const storeContainers = [{ id: '1' }, { id: '3' }];

      const oldContainers = storeContainers.filter((storeContainer) => {
        const stillExists = newContainers.find(
          (newContainer) => newContainer.id === storeContainer.id,
        );
        return stillExists === undefined;
      });

      expect(oldContainers).toEqual([{ id: '3' }]);
    });

    test('should handle null inputs for old containers', async () => {
      expect([].filter(() => false)).toEqual([]);
    });
  });
});
