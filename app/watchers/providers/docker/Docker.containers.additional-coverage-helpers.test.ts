const mockDdEnvVars = vi.hoisted(() => ({}) as Record<string, string | undefined>);
const mockDetectSourceRepoFromImageMetadata = vi.hoisted(() => vi.fn());
const mockResolveSourceRepoForContainer = vi.hoisted(() => vi.fn());
const mockGetFullReleaseNotesForContainer = vi.hoisted(() => vi.fn());
const mockToContainerReleaseNotes = vi.hoisted(() => vi.fn((notes: unknown) => notes));
vi.mock('../../../configuration/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../configuration/index.js')>()),
  ddEnvVars: mockDdEnvVars,
}));
vi.mock('../../../release-notes/index.js', () => ({
  detectSourceRepoFromImageMetadata: (...args: unknown[]) =>
    mockDetectSourceRepoFromImageMetadata(...args),
  resolveSourceRepoForContainer: (...args: unknown[]) => mockResolveSourceRepoForContainer(...args),
  getFullReleaseNotesForContainer: (...args: unknown[]) =>
    mockGetFullReleaseNotesForContainer(...args),
  toContainerReleaseNotes: (...args: unknown[]) => mockToContainerReleaseNotes(...args),
}));
vi.mock('dockerode');
vi.mock('node-cron');
vi.mock('just-debounce');
vi.mock('../../../event');
vi.mock('../../../store/container.js');
vi.mock('../../../registry/index.js');
vi.mock('../../../model/container');
vi.mock('../../../tag');
vi.mock('../../../prometheus/watcher');
vi.mock('parse-docker-image-name');
vi.mock('node:fs');
vi.mock('axios');
vi.mock('./maintenance.js', () => ({
  isInMaintenanceWindow: vi.fn(() => true),
  getNextMaintenanceWindow: vi.fn(() => undefined),
}));

import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
import { getDockerWatcherRegistryId, getDockerWatcherSourceKey } from './container-init.js';
import {
  createMockLog,
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
  testable_getInspectValueByPath,
  testable_getLabel,
  testable_getOldContainers,
  testable_normalizeConfigNumberValue,
  testable_normalizeContainer,
  testable_pruneOldContainers,
  testable_shouldUpdateDisplayNameFromContainerName,
} from './Docker.js';

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

  describe('Additional Coverage - Docker helper functions', () => {
    test('getLabel should fallback to wud key when dd key is absent', () => {
      const labels = {
        'wud.display.name': 'Legacy Name',
      };
      expect(testable_getLabel(labels, 'dd.display.name', 'wud.display.name')).toBe('Legacy Name');
    });

    test('getLabel should prefer dd key when both dd and wud keys are present', () => {
      const labels = {
        'dd.display.name': 'Preferred',
        'wud.display.name': 'Legacy Name',
      };
      expect(testable_getLabel(labels, 'dd.display.name', 'wud.display.name')).toBe('Preferred');
    });

    test('getLabel should return undefined when fallback key is not provided', () => {
      expect(testable_getLabel({}, 'dd.display.name')).toBeUndefined();
    });

    test.each([
      {
        aliasKey: 'dd.action.include',
        legacyKey: 'dd.trigger.include',
        fallbackKey: 'wud.trigger.include',
        preferredValue: 'action-include',
      },
      {
        aliasKey: 'dd.notification.exclude',
        legacyKey: 'dd.trigger.exclude',
        fallbackKey: 'wud.trigger.exclude',
        preferredValue: 'notification-exclude',
      },
    ])('getLabel should prefer $aliasKey over $legacyKey and warn once for the legacy key', ({
      aliasKey,
      legacyKey,
      fallbackKey,
      preferredValue,
    }) => {
      const warnedLegacyTriggerLabels = new Set<string>();
      const warn = vi.fn();
      const labels = {
        [aliasKey]: preferredValue,
        [legacyKey]: 'legacy-value',
        [fallbackKey]: 'legacy-fallback',
      } as Record<string, string>;

      expect(
        testable_getLabel(labels, legacyKey, fallbackKey, {
          warn,
          warnedLegacyTriggerLabels,
        }),
      ).toBe(preferredValue);
      expect(
        testable_getLabel(
          {
            [legacyKey]: 'legacy-value',
            [fallbackKey]: 'legacy-fallback',
          } as Record<string, string>,
          legacyKey,
          fallbackKey,
          {
            warn,
            warnedLegacyTriggerLabels,
          },
        ),
      ).toBe('legacy-value');

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(legacyKey);
    });

    test('getCurrentPrefix should return the non-numeric prefix before the first digit', () => {
      expect(testable_getCurrentPrefix('v2026.2.1')).toBe('v');
    });

    test('getCurrentPrefix should return empty string when there are no digits', () => {
      expect(testable_getCurrentPrefix('latest')).toBe('');
    });

    test('filterBySegmentCount should drop tags without numeric groups', () => {
      const filtered = testable_filterBySegmentCount(['latest', '1.2.4', '1.3.0'], {
        transformTags: undefined,
        image: {
          tag: {
            value: '1.2.3',
          },
        },
      });

      expect(filtered).toEqual(['1.2.4', '1.3.0']);
    });

    test('filterBySegmentCount should enforce numeric zero-padding style by segment', () => {
      const filtered = testable_filterBySegmentCount(['5.1.5', '20.04.1', '5.01.6'], {
        transformTags: undefined,
        image: {
          tag: {
            value: '5.1.4',
          },
        },
      });

      expect(filtered).toEqual(['5.1.5']);
    });

    test('filterBySegmentCount should allow non-padded segments when current tag is padded', () => {
      const filtered = testable_filterBySegmentCount(['20.10.1', '20.04.2'], {
        transformTags: undefined,
        image: {
          tag: {
            value: '20.04.1',
          },
        },
      });

      expect(filtered).toEqual(['20.10.1', '20.04.2']);
    });

    test('filterBySegmentCount should preserve current prefix family', () => {
      const filtered = testable_filterBySegmentCount(['1.2.4', 'v1.2.4'], {
        transformTags: undefined,
        image: {
          tag: {
            value: 'v1.2.3',
          },
        },
      });

      expect(filtered).toEqual(['v1.2.4']);
    });

    test('filterBySegmentCount should preserve suffix family template', () => {
      const filtered = testable_filterBySegmentCount(['1.2.4', '1.2.4-ls133', '1.2.4-r1'], {
        transformTags: undefined,
        image: {
          tag: {
            value: '1.2.3-ls132',
          },
        },
      });

      expect(filtered).toEqual(['1.2.4-ls133']);
    });

    test('getContainerName should extract first docker name entry and strip slash', () => {
      expect(testable_getContainerName({ Names: ['/my-container'] })).toBe('my-container');
    });

    test('getContainerName should return empty string when names are missing', () => {
      expect(testable_getContainerName({})).toBe('');
    });

    test('filterRecreatedContainerAliases should skip self-id-prefixed aliases when base name exists in store', () => {
      const result = testable_filterRecreatedContainerAliases(
        [
          {
            Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
            Names: ['/7ea6b8a42686_termix'],
          },
        ],
        [
          {
            id: 'termix-current',
            watcher: 'docker-test',
            name: 'termix',
          } as any,
        ],
      );

      expect(result.containersToWatch).toHaveLength(0);
      expect(result.skippedContainerIds.size).toBe(1);
      expect(
        result.skippedContainerIds.has(
          '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
        ),
      ).toBe(true);
    });

    test('filterRecreatedContainerAliases should ignore containers with missing Id or Names', () => {
      const result = testable_filterRecreatedContainerAliases(
        [
          { Names: ['/abc123_myapp'] },
          { Id: 'name-missing' },
          { Id: '', Names: ['/def456_myapp'] },
          { Id: 'valid1', Names: ['/valid1_myapp'] },
        ],
        [],
      );
      expect(result.containersToWatch).toHaveLength(4);
      expect(result.skippedContainerIds.size).toBe(0);
    });

    test('filterRecreatedContainerAliases should keep alias when no sibling and no store match', () => {
      const result = testable_filterRecreatedContainerAliases(
        [
          {
            Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
            Names: ['/7ea6b8a42686_termix'],
          },
        ],
        [],
      );
      expect(result.containersToWatch).toHaveLength(1);
      expect(result.skippedContainerIds.size).toBe(0);
    });

    test('filterRecreatedContainerAliases should keep alias when base-name map only has the same container id', () => {
      const result = testable_filterRecreatedContainerAliases(
        [
          {
            Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
            Names: ['/7ea6b8a42686_termix'],
          },
          {
            Id: '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10',
            Names: ['/termix'],
          },
        ],
        [],
      );
      expect(result.containersToWatch).toHaveLength(2);
      expect(result.skippedContainerIds.size).toBe(0);
    });

    test('filterRecreatedContainerAliases should skip alias when a sibling container already uses the base name', () => {
      const aliasContainerId = '7ea6b8a42686fbe3a9cb18f1b0d4d4a24f02f9fe6cb9f6e85e6fce7b2a1c9a10';
      const result = testable_filterRecreatedContainerAliases(
        [
          {
            Id: aliasContainerId,
            Names: ['/7ea6b8a42686_termix'],
          },
          {
            Id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            Names: ['/termix'],
          },
        ],
        [],
      );

      expect(result.containersToWatch).toHaveLength(1);
      expect(result.skippedContainerIds.size).toBe(1);
      expect(result.skippedContainerIds.has(aliasContainerId)).toBe(true);
    });

    test('filterRecreatedContainerAliases should keep names that are not self-id-prefixed aliases', () => {
      const result = testable_filterRecreatedContainerAliases(
        [
          {
            Id: 'aaaaaaaaaaaa1111111111111111111111111111111111111111111111111111',
            Names: ['/7ea6b8a42686_termix'],
          },
        ],
        [
          {
            id: 'termix-current',
            watcher: 'docker-test',
            name: 'termix',
          } as any,
        ],
      );

      expect(result.containersToWatch).toHaveLength(1);
      expect(result.skippedContainerIds.size).toBe(0);
    });

    test('getContainerDisplayName should fallback to container name when parsed image path is missing', () => {
      expect(testable_getContainerDisplayName('my-container', undefined, undefined)).toBe(
        'my-container',
      );
    });

    test('normalizeConfigNumberValue should return undefined for non-finite numeric strings', () => {
      expect(testable_normalizeConfigNumberValue('NaN')).toBeUndefined();
    });

    test('shouldUpdateDisplayNameFromContainerName should support empty old display names', () => {
      expect(testable_shouldUpdateDisplayNameFromContainerName('new-name', 'old-name', '')).toBe(
        true,
      );
    });

    test('getFirstDigitIndex should return -1 when no digit exists', () => {
      expect(testable_getFirstDigitIndex('latest')).toBe(-1);
    });

    test('getImageForRegistryLookup should ignore invalid legacy lookup url', () => {
      const image = {
        registry: {
          url: 'harbor.example.com',
          lookupUrl: 'https://%',
        },
        name: 'dockerhub-proxy/traefik',
        tag: {
          value: 'v3.5.3',
        },
      };
      expect(testable_getImageForRegistryLookup(image)).toBe(image);
    });

    test('getDockerWatcherRegistryId should normalize watcher and agent values', () => {
      expect(getDockerWatcherRegistryId('watcher')).toBe('docker.watcher');
      expect(getDockerWatcherRegistryId('watcher', 'agent-1')).toBe('agent-1.docker.watcher');
      expect(getDockerWatcherRegistryId('   ', 'agent-1')).toBe('');
    });

    test('getDockerWatcherSourceKey should build tcp and socket keys with defaults', () => {
      expect(
        getDockerWatcherSourceKey({
          agent: 'agent-1',
          configuration: {
            host: 'Docker.Example.Com',
            protocol: 'HTTPS',
            port: 4242,
          },
        } as any),
      ).toBe('agent:agent-1|tcp:https://docker.example.com:4242');

      expect(
        getDockerWatcherSourceKey({
          agent: '',
          configuration: {
            host: 'Docker.Example.Com',
            protocol: '',
            port: 0,
          },
        } as any),
      ).toBe('agent:|tcp:http://docker.example.com:2375');

      expect(
        getDockerWatcherSourceKey({
          agent: 'agent-2',
          configuration: {
            socket: '',
          },
        } as any),
      ).toBe('agent:agent-2|socket:/var/run/docker.sock');
    });

    test('normalizeContainer should not mutate the input container object', async () => {
      const containerModule = await import('../../../model/container.js');
      const realContainerModule = await vi.importActual<
        typeof import('../../../model/container.js')
      >('../../../model/container.js');
      containerModule.validate.mockImplementation(realContainerModule.validate);

      const container = {
        id: 'c1',
        name: 'container-1',
        watcher: 'docker',
        image: {
          id: 'sha256:abc123',
          registry: {
            name: 'original-registry',
            url: 'custom.registry',
          },
          name: 'myimage',
          tag: {
            value: '1.0.0',
            semver: true,
          },
          digest: {
            watch: false,
          },
          architecture: 'amd64',
          os: 'linux',
        },
      };

      registry.getState.mockReturnValue({ registry: {} });
      const result = testable_normalizeContainer(container);

      expect(result).toBeDefined();
      expect(result.image.registry.name).toBe('unknown');
      expect(container.image.registry.name).toBe('original-registry');
      expect(result.image).not.toBe(container.image);
    });

    test('getInspectValueByPath should return undefined for empty path', () => {
      expect(testable_getInspectValueByPath({ Config: { Labels: {} } }, '')).toBeUndefined();
    });

    test('getOldContainers should return empty array when arguments are missing', () => {
      expect(testable_getOldContainers(undefined, [])).toEqual([]);
      expect(testable_getOldContainers([], undefined)).toEqual([]);
    });

    test('getOldContainers should remove containers that still exist in new snapshot', () => {
      const result = testable_getOldContainers(
        [{ id: 'current-1' }],
        [{ id: 'current-1' }, { id: 'stale-1' }],
      );

      expect(result).toEqual([{ id: 'stale-1' }]);
    });

    test('getOldContainers should perform near-linear id lookups', () => {
      let newIdReads = 0;
      let storeIdReads = 0;
      const newContainers = Array.from({ length: 30 }, (_, index) => {
        const container = {};
        Object.defineProperty(container, 'id', {
          enumerable: true,
          get: () => {
            newIdReads += 1;
            return `id-${index}`;
          },
        });
        return container;
      });
      const containersFromStore = Array.from({ length: 30 }, (_, index) => {
        const container = {};
        Object.defineProperty(container, 'id', {
          enumerable: true,
          get: () => {
            storeIdReads += 1;
            return `id-${index + 15}`;
          },
        });
        return container;
      });

      const result = testable_getOldContainers(newContainers, containersFromStore);

      expect(result).toHaveLength(15);
      expect(newIdReads).toBeLessThanOrEqual(60);
      expect(storeIdReads).toBeLessThanOrEqual(60);
    });

    test('pruneOldContainers should update status when stale container still exists in docker', async () => {
      const dockerApi = {
        getContainer: vi.fn().mockReturnValue({
          inspect: vi.fn().mockResolvedValue({
            State: {
              Status: 'exited',
            },
          }),
        }),
      };

      await testable_pruneOldContainers([], [{ id: 'old-1', name: 'old-container' }], dockerApi);

      expect(storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'old-1',
          status: 'exited',
        }),
      );
    });

    test('pruneOldContainers should delete stale entries when a same-name replacement exists', async () => {
      const dockerApi = {
        getContainer: vi.fn(),
      };

      await testable_pruneOldContainers(
        [
          {
            id: 'new-1',
            watcher: 'docker',
            name: 'app',
          },
        ] as any,
        [
          {
            id: 'old-1',
            watcher: 'docker',
            name: 'app',
          },
        ] as any,
        dockerApi as any,
      );

      expect(dockerApi.getContainer).not.toHaveBeenCalled();
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('old-1');
    });

    test('pruneOldContainers should delete stale same-name entries from same-source cross-watcher candidates', async () => {
      const dockerApi = {
        getContainer: vi.fn(),
      };

      await testable_pruneOldContainers(
        [
          {
            id: 'new-1',
            watcher: 'docker',
            name: 'app',
          },
        ] as any,
        [] as any,
        dockerApi as any,
        {
          sameSourceContainersFromStore: [
            {
              id: 'old-2',
              watcher: 'docker-alias',
              name: 'app',
            },
          ],
        },
      );

      expect(dockerApi.getContainer).not.toHaveBeenCalled();
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('old-2');
    });

    test('pruneOldContainers should treat missing watcher as an empty watcher key', async () => {
      const dockerApi = {
        getContainer: vi.fn(),
      };

      await testable_pruneOldContainers(
        [
          {
            id: 'new-1',
            name: 'app',
          },
        ] as any,
        [
          {
            id: 'old-1',
            watcher: '',
            name: 'app',
          },
        ] as any,
        dockerApi as any,
      );

      expect(dockerApi.getContainer).not.toHaveBeenCalled();
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('old-1');
    });

    test('pruneOldContainers should force-delete stale ids skipped during alias filtering', async () => {
      const dockerApi = {
        getContainer: vi.fn().mockReturnValue({
          inspect: vi.fn().mockResolvedValue({
            State: {
              Status: 'exited',
            },
          }),
        }),
      };

      await testable_pruneOldContainers(
        [],
        [
          {
            id: 'alias-1',
            watcher: 'docker',
            name: '7ea6b8a42686_termix',
          },
        ] as any,
        dockerApi as any,
        {
          forceRemoveContainerIds: new Set(['alias-1']),
        },
      );

      expect(dockerApi.getContainer).not.toHaveBeenCalled();
      expect(storeContainer.updateContainer).not.toHaveBeenCalled();
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('alias-1');
    });
  });

  describe('Additional Coverage - getContainers same-source filtering', () => {
    // Docker.ts gets its registry/storeContainer references from a mock version
    // created by the helpers file's runtime vi.mock() call, which differs from
    // the test file's static import. Use dynamic imports to get the same instance.
    let hRegistry: any;
    let hStoreContainer: any;

    beforeEach(async () => {
      hRegistry = await import('../../../registry/index.js');
      hStoreContainer = await import('../../../store/container.js');
    });

    test('should normalize a non-string watcher agent when grouping same-source containers', async () => {
      await docker.register(
        'watcher',
        'docker',
        'test',
        {
          socket: '/var/run/docker.sock',
          host: 'socket-proxy.internal',
          protocol: 'http',
          port: 2375,
        },
        'agent-1',
      );
      docker.agent = 42 as any;
      mockDockerApi.listContainers.mockResolvedValue([]);
      hStoreContainer.getContainers.mockImplementation((query?: { watcher?: string }) =>
        query?.watcher ? [] : [],
      );
      hRegistry.getState.mockReturnValue({ watcher: {} } as any);

      await docker.getContainers();

      expect(hRegistry.getState).toHaveBeenCalled();
    });

    test('should fall back to current containers when same-source lookup fails', async () => {
      await docker.register('watcher', 'docker', 'test', {
        socket: '/var/run/docker.sock',
      });
      docker.log = createMockLog(['warn']);
      mockDockerApi.listContainers.mockResolvedValue([]);
      hStoreContainer.getContainers.mockImplementation((query?: { watcher?: string }) =>
        query?.watcher ? [] : [],
      );
      hRegistry.getState.mockImplementation(() => {
        throw new Error('Registry unavailable');
      });

      await expect(docker.getContainers()).resolves.toEqual([]);
      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error when trying to get same-source containers from the store'),
      );
    });

    test('should keep same-source containers and skip invalid cross-watcher records', async () => {
      await docker.register(
        'watcher',
        'docker',
        'test',
        {
          socket: '/var/run/docker.sock',
          host: 'socket-proxy.internal',
          protocol: 'http',
          port: 2375,
        },
        '',
      );
      mockDockerApi.listContainers.mockResolvedValue([]);
      hStoreContainer.getContainers.mockImplementation((query?: { watcher?: string }) => {
        if (query?.watcher) {
          return [];
        }

        return [
          {
            id: 'same-source',
            watcher: 'docker-same-source',
            agent: '',
            name: 'service',
          },
          {
            id: 'empty-watcher',
            watcher: '',
            agent: '',
            name: 'service',
          },
          {
            id: 'whitespace-watcher',
            watcher: '   ',
            agent: '',
            name: 'service',
          },
          {
            id: 'non-docker-watcher',
            watcher: 'docker-queue',
            agent: '',
            name: 'service',
          },
          {
            id: 'different-agent',
            watcher: 'docker-same-source',
            agent: 'remote-agent',
            name: 'service',
          },
        ] as any;
      });
      hRegistry.getState.mockReturnValue({
        watcher: {
          'docker.docker-same-source': {
            type: 'docker',
            name: 'docker-same-source',
            configuration: {
              host: 'socket-proxy.internal',
              protocol: 'http',
              port: 2375,
              socket: '/var/run/docker.sock',
            },
          },
          'docker.docker-queue': {
            type: 'queue',
            name: 'docker-queue',
            configuration: {
              host: 'socket-proxy.internal',
              protocol: 'http',
              port: 2375,
              socket: '/var/run/docker.sock',
            },
          },
        },
      } as any);

      await docker.getContainers();

      expect(hStoreContainer.deleteContainer).not.toHaveBeenCalled();
    });
  });

  describe('Additional Coverage - findNewVersion unsupported registry', () => {
    test('should return current tag and log error when registry provider is unsupported', async () => {
      const logChild = createMockLog(['error']);
      const container = {
        image: {
          registry: {
            name: 'unknown',
          },
          tag: {
            value: '1.2.3',
          },
          digest: {
            watch: false,
          },
        },
      };

      const result = await docker.findNewVersion(container, logChild);
      expect(result).toEqual({ tag: '1.2.3' });
      expect(logChild.error).toHaveBeenCalledWith('Unsupported registry (unknown)');
    });
  });
});
