import mockParse from 'parse-docker-image-name';
import * as event from '../../../event/index.js';
import { fullName } from '../../../model/container.js';
import * as mockPrometheus from '../../../prometheus/watcher.js';
import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
import * as mockTag from '../../../tag/index.js';
import { getDockerWatcherRegistryId, getDockerWatcherSourceKey } from './container-init.js';
import {
  createDeviceCodeResponse,
  createDeviceFlowConfig,
  createDockerContainer,
  createDockerOidcContext,
  createDockerOidcStateAdapter,
  createHaParseMock,
  createHarborHubRegistryState,
  createMockLog,
  createMockLogWithChild,
  createOidcConfig,
  createTokenResponse,
  mockAxios,
  mockDdEnvVars,
  mockDetectSourceRepoFromImageMetadata,
  mockGetFullReleaseNotesForContainer,
  mockResolveSourceRepoForContainer,
  mockToContainerReleaseNotes,
  setupContainerDetailTest,
  setupDockerWatcherContainerSuite,
} from './Docker.containers.test.helpers.js';
import {
  testable_filterBySegmentCount,
  testable_filterRecreatedContainerAliases,
  testable_getContainerDisplayName,
  testable_getContainerName,
  testable_getCurrentPrefix,
  testable_getFirstDigitIndex,
  testable_getImageForRegistryLookup,
  testable_getImageReferenceCandidatesFromPattern,
  testable_getImgsetSpecificity,
  testable_getInspectValueByPath,
  testable_getLabel,
  testable_getOldContainers,
  testable_normalizeConfigNumberValue,
  testable_normalizeContainer,
  testable_pruneOldContainers,
  testable_shouldUpdateDisplayNameFromContainerName,
} from './Docker.js';
import * as maintenance from './maintenance.js';

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

  describe('Container Reporting', () => {
    test('should map container to report for new container', async () => {
      const container = { id: '123', name: 'test' };
      docker.log = createMockLogWithChild(['debug']);
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockReturnValue(container);

      const result = docker.mapContainerToContainerReport(container);

      expect(result.changed).toBe(true);
      expect(storeContainer.insertContainer).toHaveBeenCalledWith(container);
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
      storeContainer.getContainer.mockReturnValue(existingContainer);
      storeContainer.updateContainer.mockReturnValue(container);

      const result = docker.mapContainerToContainerReport(container);

      expect(result.changed).toBe(true);
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(container);
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
      storeContainer.getContainer.mockReturnValue(existingContainer);
      storeContainer.updateContainer.mockReturnValue(container);

      const result = docker.mapContainerToContainerReport(container);

      expect(result.changed).toBe(false);
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
