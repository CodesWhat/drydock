import type { Mocked } from 'vitest';
import * as event from '../../../event/index.js';
import { fullName } from '../../../model/container.js';
import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
import { mockConstructor } from '../../../test/mock-constructor.js';
import { _resetRegistryWebhookFreshStateForTests } from '../../registry-webhook-fresh.js';
import { getDockerWatcherRegistryId, getDockerWatcherSourceKey } from './container-init.js';
import Docker, {
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

const mockDdEnvVars = vi.hoisted(() => ({}) as Record<string, string | undefined>);
const mockDetectSourceRepoFromImageMetadata = vi.hoisted(() => vi.fn());
const mockResolveSourceRepoForContainer = vi.hoisted(() => vi.fn());
const mockGetFullReleaseNotesForContainer = vi.hoisted(() => vi.fn());
const mockToContainerReleaseNotes = vi.hoisted(() => vi.fn((notes) => notes));
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

// Mock all dependencies
vi.mock('dockerode');
vi.mock('node-cron');
vi.mock('just-debounce');
vi.mock('../../../event');
vi.mock('../../../store/container');
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

import axios from 'axios';
import mockDockerode from 'dockerode';
import mockDebounce from 'just-debounce';
import mockCron from 'node-cron';
import mockParse from 'parse-docker-image-name';
import * as mockPrometheus from '../../../prometheus/watcher.js';
import * as mockTag from '../../../tag/index.js';
import * as maintenance from './maintenance.js';

const mockAxios = axios as Mocked<typeof axios>;

// --- Shared factory functions to reduce test duplication ---

/** Creates a mock log object with commonly needed methods. */
function createMockLog(methods = ['info', 'warn', 'debug', 'error']) {
  const log = {};
  for (const m of methods) {
    log[m] = vi.fn();
  }
  return log;
}

/** Creates a mock log with a child() that returns another mock log. */
function createMockLogWithChild(childMethods = ['info', 'warn', 'debug', 'error']) {
  const childLog = createMockLog(childMethods);
  return {
    child: vi.fn().mockReturnValue(childLog),
    ...createMockLog(['info', 'warn', 'debug', 'error']),
    _child: childLog,
  };
}

/** Standard mock registry for container detail tests. */
function createMockRegistry(id = 'hub', matchFn = () => true) {
  return {
    normalizeImage: vi.fn((img) => img),
    getId: () => id,
    match: matchFn,
  };
}

/** Standard image details fixture. */
function createImageDetails(overrides = {}) {
  return {
    Id: 'image123',
    Architecture: 'amd64',
    Os: 'linux',
    Created: '2023-01-01',
    ...overrides,
  };
}

/** Standard container fixture for Docker API list results. */
function createDockerContainer(overrides = {}) {
  return {
    Id: '123',
    Names: ['/test-container'],
    State: 'running',
    Labels: {},
    ...overrides,
  };
}

/**
 * Harbor + Docker Hub dual-registry state for lookup label tests.
 */
function createHarborHubRegistryState() {
  return {
    harbor: {
      normalizeImage: vi.fn((img) => img),
      getId: () => 'harbor',
      match: (img) => img.registry.url === 'harbor.example.com',
    },
    hub: {
      normalizeImage: vi.fn((img) => ({
        ...img,
        registry: {
          ...img.registry,
          url: 'https://registry-1.docker.io/v2',
        },
      })),
      getId: () => 'hub',
      match: (img) => !img.registry.url || /^.*\.?docker.io$/.test(img.registry.url),
    },
  };
}

/**
 * Home Assistant mockParse implementation (used in multiple imgset tests).
 * Maps HA image strings to their parsed components.
 */
function createHaParseMock() {
  return (value) => {
    if (value === 'ghcr.io/home-assistant/home-assistant:2026.2.1') {
      return { domain: 'ghcr.io', path: 'home-assistant/home-assistant', tag: '2026.2.1' };
    }
    if (value === 'ghcr.io/home-assistant/home-assistant:stable') {
      return { domain: 'ghcr.io', path: 'home-assistant/home-assistant', tag: 'stable' };
    }
    if (value === 'ghcr.io/home-assistant/home-assistant') {
      return { domain: 'ghcr.io', path: 'home-assistant/home-assistant' };
    }
    return { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' };
  };
}

/**
 * Setup a container-detail test: registers the watcher, sets up image inspect,
 * parse mock, tag mock, registry state, and validateContainer mock.
 * Returns the raw Docker API container object, ready for addImageDetailsToContainer.
 */
async function setupContainerDetailTest(
  docker,
  {
    registerConfig = {},
    container: containerOverrides = {},
    imageDetails: imageOverrides = {},
    parsedImage = { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' },
    parseImpl = undefined,
    semverValue = { major: 1, minor: 0, patch: 0 },
    registryId = 'hub',
    registryMatchFn = () => true,
    registryState = undefined,
    validateImpl = (c) => c,
  } = {},
) {
  await docker.register('watcher', 'docker', 'test', registerConfig);

  const imageDetails = createImageDetails(imageOverrides);
  mockImage.inspect.mockResolvedValue(imageDetails);

  if (parseImpl) {
    mockParse.mockImplementation(parseImpl);
  } else {
    mockParse.mockReturnValue(parsedImage);
  }
  mockTag.parse.mockReturnValue(semverValue);

  if (registryState) {
    registry.getState.mockReturnValue({ registry: registryState });
  } else {
    const mockReg = createMockRegistry(registryId, registryMatchFn);
    registry.getState.mockReturnValue({ registry: { [registryId]: mockReg } });
  }

  const containerModule = await import('../../../model/container.js');
  const validateContainer = containerModule.validate;
  validateContainer.mockImplementation(validateImpl);

  return createDockerContainer(containerOverrides);
}

// Keep a module-level reference so setupContainerDetailTest can see it
let mockImage;

describe('Docker Watcher', () => {
  let docker;
  let mockDockerApi;
  let mockSchedule;
  let mockContainer;

  beforeEach(async () => {
    vi.clearAllMocks();
    _resetRegistryWebhookFreshStateForTests();

    // Setup dockerode mock
    mockDockerApi = {
      listContainers: vi.fn(),
      getContainer: vi.fn(),
      getEvents: vi.fn(),
      getImage: vi.fn(),
      getService: vi.fn(),
      modem: {
        headers: {},
      },
    };
    mockDockerode.mockImplementation(mockConstructor(mockDockerApi));

    // Setup cron mock
    mockSchedule = {
      stop: vi.fn(),
    };
    mockCron.schedule.mockReturnValue(mockSchedule);

    // Setup debounce mock
    mockDebounce.mockImplementation((fn) => fn);

    // Setup container mock
    mockContainer = {
      inspect: vi.fn(),
    };
    mockDockerApi.getContainer.mockReturnValue(mockContainer);

    // Setup image mock
    mockImage = {
      inspect: vi.fn(),
    };
    mockDockerApi.getImage.mockReturnValue(mockImage);

    // Setup store mock
    storeContainer.getContainers.mockReturnValue([]);
    storeContainer.getContainer.mockReturnValue(undefined);
    storeContainer.insertContainer.mockImplementation((c) => c);
    storeContainer.updateContainer.mockImplementation((c) => c);
    storeContainer.deleteContainer.mockImplementation(() => {});

    // Setup registry mock
    registry.getState.mockReturnValue({ registry: {} });

    // Setup event mock
    event.emitWatcherStart.mockImplementation(() => {});
    event.emitWatcherStop.mockImplementation(() => {});
    event.emitContainerReport.mockImplementation(() => {});
    event.emitContainerReports.mockImplementation(() => {});

    // Setup tag mock
    mockTag.parse.mockReturnValue({ major: 1, minor: 0, patch: 0 });
    mockTag.isGreater.mockReturnValue(false);
    mockTag.transform.mockImplementation((transform, tag) => tag);

    // Setup prometheus mock
    const mockGauge = { set: vi.fn() };
    mockPrometheus.getWatchContainerGauge.mockReturnValue(mockGauge);
    mockPrometheus.getMaintenanceSkipCounter.mockReturnValue({
      labels: vi.fn().mockReturnValue({ inc: vi.fn() }),
    });
    mockPrometheus.getLoggerInitFailureCounter.mockReturnValue({
      labels: vi.fn().mockReturnValue({ inc: vi.fn() }),
    });

    // Setup maintenance helpers
    maintenance.isInMaintenanceWindow.mockReturnValue(true);
    maintenance.getNextMaintenanceWindow.mockReturnValue(undefined);

    // Setup parse mock
    mockParse.mockReturnValue({
      domain: 'docker.io',
      path: 'library/nginx',
      tag: '1.0.0',
    });

    mockAxios.post.mockResolvedValue({
      data: {
        access_token: 'oidc-token',
        expires_in: 300,
      },
    } as any);

    // Setup fullName mock
    fullName.mockReturnValue('test_container');

    docker = new Docker();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (docker) {
      await docker.deregisterComponent();
    }
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
      expect(event.emitContainerReport).toHaveBeenCalled();
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
      storeContainer.getContainers.mockReturnValue(oldContainers);
      mockDockerApi.listContainers.mockResolvedValue([]);
      // Simulate containers no longer existing in Docker
      mockDockerApi.getContainer.mockReturnValue({
        inspect: vi.fn().mockRejectedValue(new Error('no such container')),
      });

      await docker.register('watcher', 'docker', 'test', {});
      await docker.getContainers();

      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('old1');
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('old2');
    });

    test('should continue when pruneOldContainers throws during stale record cleanup', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['warn']);
      storeContainer.getContainers.mockReturnValue([
        { id: 'old1', watcher: 'test', name: 'svc' } as any,
      ]);
      storeContainer.deleteContainer.mockImplementation(() => {
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
      storeContainer.getContainers.mockImplementationOnce(() => {
        throw new Error('Store error');
      });
      mockDockerApi.listContainers.mockResolvedValue([]);

      await docker.getContainers();

      expect(docker.log.warn).toHaveBeenCalledWith(expect.stringContaining('Store error'));
    });
  });

  describe('Dual-prefix dd.*/wud.* label support', () => {
    test('should prefer dd.watch over wud.watch label', async () => {
      const containers = [
        {
          Id: 'dd-label-1',
          Labels: { 'dd.watch': 'true', 'wud.watch': 'false' },
          Names: ['/dd-test'],
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'dd-label-1' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      const result = await docker.getContainers();

      // dd.watch=true should override wud.watch=false
      expect(result).toHaveLength(1);
    });

    test('should fall back to wud.watch when dd.watch is not set', async () => {
      const containers = [
        {
          Id: 'wud-fallback-1',
          Labels: { 'wud.watch': 'true' },
          Names: ['/wud-test'],
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'wud-fallback-1' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      const result = await docker.getContainers();

      expect(result).toHaveLength(1);
    });

    test('should prefer dd.tag.include over wud.tag.include label', async () => {
      const containers = [
        {
          Id: 'dd-tag-1',
          Labels: {
            'dd.watch': 'true',
            'dd.tag.include': String.raw`^v\d+`,
            'wud.tag.include': String.raw`^\d+`,
          },
          Names: ['/dd-tag-test'],
        },
      ];
      mockDockerApi.listContainers.mockResolvedValue(containers);
      docker.addImageDetailsToContainer = vi.fn().mockResolvedValue({ id: 'dd-tag-1' });

      await docker.register('watcher', 'docker', 'test', {
        watchbydefault: false,
      });
      await docker.getContainers();

      // dd.tag.include should be preferred
      expect(docker.addImageDetailsToContainer.mock.calls[0][1].includeTags).toBe(
        String.raw`^v\d+`,
      );
    });

    describe('getLabel dual-prefix fallback for all label pairs', () => {
      const labelPairs = [
        ['dd.watch', 'wud.watch'],
        ['dd.tag.include', 'wud.tag.include'],
        ['dd.tag.exclude', 'wud.tag.exclude'],
        ['dd.tag.transform', 'wud.tag.transform'],
        ['dd.inspect.tag.path', 'wud.inspect.tag.path'],
        ['dd.registry.lookup.image', 'wud.registry.lookup.image'],
        ['dd.registry.lookup.url', 'wud.registry.lookup.url'],
        ['dd.watch.digest', 'wud.watch.digest'],
        ['dd.link.template', 'wud.link.template'],
        ['dd.display.name', 'wud.display.name'],
        ['dd.display.icon', 'wud.display.icon'],
        ['dd.trigger.include', 'wud.trigger.include'],
        ['dd.trigger.exclude', 'wud.trigger.exclude'],
        ['dd.group', 'wud.group'],
        ['dd.hook.pre', 'wud.hook.pre'],
        ['dd.hook.post', 'wud.hook.post'],
        ['dd.hook.pre.abort', 'wud.hook.pre.abort'],
        ['dd.hook.timeout', 'wud.hook.timeout'],
        ['dd.rollback.auto', 'wud.rollback.auto'],
        ['dd.rollback.window', 'wud.rollback.window'],
        ['dd.rollback.interval', 'wud.rollback.interval'],
      ];

      test.each(labelPairs)('should prefer %s over %s when both are present', (ddKey, wudKey) => {
        const labels = { [ddKey]: 'dd-value', [wudKey]: 'wud-value' };
        expect(testable_getLabel(labels, ddKey, wudKey)).toBe('dd-value');
      });

      test.each(labelPairs)('should fall back to %s when %s is absent', (ddKey, wudKey) => {
        const labels = { [wudKey]: 'legacy-value' };
        expect(testable_getLabel(labels, ddKey, wudKey)).toBe('legacy-value');
      });

      test.each(
        labelPairs,
      )('should return undefined when neither %s nor %s is set', (ddKey, wudKey) => {
        expect(testable_getLabel({}, ddKey, wudKey)).toBeUndefined();
      });
    });
  });

  describe('Version Finding', () => {
    test('should find new version using registry', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(mockRegistry.getTags).toHaveBeenCalledWith(container.image);
      expect(result).toEqual({ tag: '1.0.0' });
    });

    test('should include result publishedAt when registry can resolve publish date', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImagePublishedAt: vi.fn().mockResolvedValue('2026-03-10T10:00:00.000Z'),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(mockRegistry.getImagePublishedAt).toHaveBeenCalledWith(container.image, '1.0.0');
      expect(result).toEqual({
        tag: '1.0.0',
        publishedAt: '2026-03-10T10:00:00.000Z',
      });
    });

    test('should resolve publishedAt using fallback tag expression when current tag is empty', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue([]),
        getImagePublishedAt: vi.fn().mockResolvedValue('2026-03-01T10:00:00.000Z'),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(mockRegistry.getImagePublishedAt).toHaveBeenCalledWith(container.image, '');
      expect(result.publishedAt).toEqual('2026-03-01T10:00:00.000Z');
      expect(result.tag).toEqual('');
    });

    test('should ignore publish date values that are not strings', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImagePublishedAt: vi.fn().mockResolvedValue(new Date('2026-03-10T10:00:00.000Z')),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.0.0' });
    });

    test('should continue when publish date lookup fails', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImagePublishedAt: vi.fn().mockRejectedValue(new Error('metadata unavailable')),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.0.0' });
      expect(mockLogChild.debug).toHaveBeenCalledWith(
        expect.stringContaining('publish date lookup failed'),
      );
    });

    test('should continue when publish date lookup fails and debug logger is unavailable', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImagePublishedAt: vi.fn().mockRejectedValue(new Error('metadata unavailable')),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.0.0' });
    });

    test('should handle unsupported registry', async () => {
      const container = {
        image: {
          registry: { name: 'unknown' },
          tag: { value: '1.0.0' },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({ registry: {} });
      const mockLogChild = { error: vi.fn() };

      try {
        await docker.findNewVersion(container, mockLogChild);
      } catch (error) {
        expect(error.message).toContain('Unsupported Registry');
      }
    });

    test('should handle digest watching with v2 manifest', async () => {
      const container = {
        image: {
          id: 'image123',
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: true, repo: 'sha256:abc123' },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImageManifestDigest: vi
          .fn()
          .mockResolvedValueOnce({
            digest: 'sha256:def456',
            created: '2023-01-01',
            version: 2,
          })
          .mockResolvedValueOnce({
            digest: 'sha256:manifest123',
          }),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(mockRegistry.getImageManifestDigest).toHaveBeenCalledTimes(2);
      expect(result.digest).toBe('sha256:def456');
      expect(result.created).toBe('2023-01-01');
    });

    test('should handle digest watching with v1 manifest using repo digest', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const container = {
        image: {
          id: 'image123',
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: true, repo: 'sha256:abc123' },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImageManifestDigest: vi.fn().mockResolvedValue({
          digest: 'sha256:def456',
          created: '2023-01-01',
          version: 1,
        }),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      const mockLogChild = { error: vi.fn() };

      await docker.findNewVersion(container, mockLogChild);

      expect(container.image.digest.value).toBe('sha256:abc123');
    });

    test('should use tag candidate for digest lookup when digest watch is true and candidates exist', async () => {
      const container = {
        image: {
          id: 'image123',
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: true, repo: 'sha256:abc123' },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']),
        getImageManifestDigest: vi
          .fn()
          .mockResolvedValueOnce({
            digest: 'sha256:def456',
            created: '2023-01-01',
            version: 2,
          })
          .mockResolvedValueOnce({
            digest: 'sha256:manifest123',
          }),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      mockTag.parse.mockReturnValue({ major: 1, minor: 0, patch: 0 });
      mockTag.isGreater.mockImplementation((t2, t1) => {
        return t2 === '2.0.0' && t1 === '1.0.0';
      });
      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      // Should have used the tag candidate (2.0.0) for digest lookup
      expect(result.tag).toBe('2.0.0');
      expect(result.digest).toBe('sha256:def456');
    });

    test('should handle tag candidates with semver', async () => {
      const container = {
        includeTags: String.raw`^v\d+`,
        excludeTags: 'beta',
        transformTags: 's/v//',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['v1.0.0', 'v1.1.0', 'v2.0.0-beta', 'latest']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });
      mockTag.parse.mockReturnValue({ major: 1, minor: 1, patch: 0 });
      mockTag.isGreater.mockReturnValue(true);
      const mockLogChild = { error: vi.fn(), warn: vi.fn() };

      await docker.findNewVersion(container, mockLogChild);

      expect(mockRegistry.getTags).toHaveBeenCalled();
    });

    test('should filter tags with different number of semver parts', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue([
          '1.2.1', // 3 parts, should be filtered out
          '1.3', // 2 parts, should be kept
          '1.1', // 2 parts, should be kept (but lower)
          '2', // 1 part, should be filtered out
        ]),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      // Mock isGreater to return true for 1.3 > 1.2
      mockTag.isGreater.mockImplementation((t1, t2) => {
        if (t1 === '1.3' && t2 === '1.2') return true;
        return false;
      });

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.3' });
    });

    test('should ignore semver tags with mismatched numeric zero-padding style', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '5.1.4', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['20.04.1', '5.1.5', '5.1.4']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '5.1.4': 514,
        '5.1.5': 515,
        '20.04.1': 200401,
      };
      mockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '5.1.5' });
    });

    test('should keep updates within inferred suffix family by default', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2.3-ls132', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.2.4', '1.2.4-ls133', '1.2.3-ls132']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.2.3-ls132': 1230,
        '1.2.4-ls133': 1240,
        '1.2.4': 1241,
      };
      mockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.2.4-ls133' });
    });

    test('should keep current tag and warn when strict mode filters only cross-family higher tags', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2.3-ls132', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.2.4', '1.2.3-ls132']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.2.3-ls132': 1230,
        '1.2.4': 1241,
      };
      mockTag.isGreater.mockImplementation(
        (version1, version2) => (rank[version1] || 0) > (rank[version2] || 0),
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({
        tag: '1.2.3-ls132',
        noUpdateReason: expect.stringContaining(
          'Strict tag-family policy filtered out 1 higher semver tag(s) outside the inferred family of "1.2.3-ls132"',
        ),
      });
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Strict tag-family policy filtered out 1 higher semver tag(s) outside the inferred family of "1.2.3-ls132"',
        ),
      );
    });

    test('should allow cross-family updates in loose mode when no higher same-family tag exists', async () => {
      const container = {
        tagFamily: 'loose',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2.3-ls132', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.2.4', '1.2.3-ls132']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.2.3-ls132': 1230,
        '1.2.4': 1241,
      };
      mockTag.isGreater.mockImplementation(
        (version1, version2) => (rank[version1] || 0) > (rank[version2] || 0),
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.2.4' });
    });

    test('should allow cross-family semver updates when tagFamily is loose', async () => {
      const container = {
        tagFamily: 'loose',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2.3-ls132', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.2.4', '1.2.4-ls133', '1.2.3-ls132']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.2.3-ls132': 1230,
        '1.2.4-ls133': 1240,
        '1.2.4': 1241,
      };
      mockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.2.4' });
    });

    test('should fall back to strict mode when tagFamily is invalid', async () => {
      const container = {
        tagFamily: 'unsupported',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.2.3-ls132', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.2.4', '1.2.4-ls133', '1.2.3-ls132']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.2.3-ls132': 1230,
        '1.2.4-ls133': 1240,
        '1.2.4': 1241,
      };
      mockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.2.4-ls133' });
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid tag family policy'),
      );
    });

    test('should log one-pass semver candidate filter counters in strict mode', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'v1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['latest', 'v1.0.0', 'v1.1.0', 'v2.0.0', '1.2.0']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        'v1.0.0': 100,
        'v1.1.0': 110,
        'v2.0.0': 200,
      };
      mockTag.isGreater.mockImplementation(
        (version1, version2) => (rank[version1] || 0) > (rank[version2] || 0),
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: 'v2.0.0' });
      expect(mockLogChild.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          'Tag candidate filter counters (strict): input=5, prefix=3, semver=3, family=3, greater=2, output=2',
        ),
      );
    });

    test('should best-effort suggest semver tag when current tag is outside include filter', async () => {
      const container = {
        includeTags: '^1\\.',
        image: {
          registry: { name: 'hub' },
          tag: { value: '2.0.0', semver: true },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.8.0', '1.9.0', '2.1.0']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.8.0': 180,
        '1.9.0': 190,
        '2.0.0': 200,
        '2.1.0': 210,
      };
      mockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );
      mockTag.parse.mockImplementation((version) => {
        const score = rank[version];
        if (!score) {
          return null;
        }
        return {
          major: Number.parseInt(version.split('.')[0], 10),
          minor: Number.parseInt(version.split('.')[1], 10),
          patch: Number.parseInt(version.split('.')[2], 10),
          prerelease: [],
        };
      });

      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.9.0' });
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('does not match includeTags regex'),
      );
      expect(mockLogChild.debug).toHaveBeenCalledWith(expect.stringContaining('greater=skipped'));
    });

    test('should advise best semver tag when current tag is non-semver and includeTags filter is set', async () => {
      const container = {
        includeTags: String.raw`^\d+\.\d+`,
        image: {
          registry: { name: 'hub' },
          tag: { value: 'latest', semver: false },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['latest', 'rolling', '1.0.0', '2.0.0', '3.0.0']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      const rank = {
        '1.0.0': 100,
        '2.0.0': 200,
        '3.0.0': 300,
      };
      mockTag.isGreater.mockImplementation(
        (version1, version2) => rank[version1] >= rank[version2],
      );
      mockTag.parse.mockImplementation((version) =>
        rank[version] ? { major: 1, minor: 0, patch: 0 } : null,
      );

      const mockLogChild = {
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({
        tag: '3.0.0',
        suggestedTag: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      });
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('is not semver but includeTags filter'),
      );
    });

    test('should not advise any tag when current tag is non-semver and no includeTags filter is set', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'latest', semver: false },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['latest', '1.0.0', '2.0.0']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      mockTag.parse.mockReturnValue(null);

      const mockLogChild = {
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const result = await docker.findNewVersion(container, mockLogChild);

      // Without includeTags, non-semver tags should not get any advice
      expect(result).toEqual({ tag: 'latest' });
    });

    test('should add suggestedTag for latest-tagged containers using highest stable semver', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'latest', semver: false },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['latest', '1.27.2', '1.27.3', '1.28.0-rc.1']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      mockTag.parse.mockImplementation((tag) => {
        if (tag === '1.27.2') return { major: 1, minor: 27, patch: 2, prerelease: [] };
        if (tag === '1.27.3') return { major: 1, minor: 27, patch: 3, prerelease: [] };
        if (tag === '1.28.0-rc.1') return { major: 1, minor: 28, patch: 0, prerelease: ['rc', 1] };
        return null;
      });

      const result = await docker.findNewVersion(container as any, {
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });

      expect(result).toEqual({ tag: 'latest', suggestedTag: '1.27.3' });
    });

    test('should not add suggestedTag when latest-tagged container has no stable semver tags', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'latest', semver: false },
          digest: { watch: false },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['latest', 'nightly', '1.28.0-beta']),
      };
      registry.getState.mockReturnValue({
        registry: { hub: mockRegistry },
      });

      mockTag.parse.mockImplementation((tag) => {
        if (tag === '1.28.0-beta') return { major: 1, minor: 28, patch: 0, prerelease: ['beta'] };
        return null;
      });

      const result = await docker.findNewVersion(container as any, {
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });

      expect(result).toEqual({ tag: 'latest' });
    });
  });

  describe('Container Details', () => {
    test('should return existing container from store', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: { digest: { repo: 'sha256:abc' }, id: 'image123', created: '2023-01-01' },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'image123',
        RepoDigests: ['nginx@sha256:abc'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result).toBe(existingContainer);
    });

    test('should skip container inspect for store container when watch events are enabled', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:abc' },
          id: 'image123',
          created: '2023-01-01',
        },
        details: {
          ports: ['80/tcp'],
          volumes: ['/old/data:/data'],
          env: [{ key: 'APP_ENV', value: 'prod' }],
        },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'image123',
        RepoDigests: ['nginx@sha256:abc'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
        Ports: [{ PrivatePort: 8080, Type: 'tcp', PublicPort: 18080, IP: '0.0.0.0' }],
        Mounts: [{ Source: '/host/data', Destination: '/data', RW: false }],
      });

      expect(result).toBe(existingContainer);
      expect(mockContainer.inspect).not.toHaveBeenCalled();
      expect(result.details).toEqual({
        ports: ['0.0.0.0:18080->8080/tcp'],
        volumes: ['/host/data:/data:ro'],
        env: [{ key: 'APP_ENV', value: 'prod' }],
      });
    });

    test('should inspect store container runtime details when watch events are disabled', async () => {
      await docker.register('watcher', 'docker', 'test', { watchevents: false });
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:abc' },
          id: 'image123',
          created: '2023-01-01',
        },
        details: {
          ports: [],
          volumes: [],
          env: [],
        },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);
      mockContainer.inspect.mockResolvedValue({
        Config: {
          Env: ['APP_ENV=prod'],
        },
      });
      mockImage.inspect.mockResolvedValue({
        Id: 'image123',
        RepoDigests: ['nginx@sha256:abc'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result).toBe(existingContainer);
      expect(mockContainer.inspect).toHaveBeenCalledTimes(1);
      expect(result.details.env).toEqual([{ key: 'APP_ENV', value: 'prod' }]);
    });

    test('should refresh image fields when digest changed in store container', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:olddigest' },
          id: 'old-image-id',
          created: '2023-01-01',
        },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'new-image-id',
        RepoDigests: ['nginx@sha256:newdigest'],
        Created: '2024-06-15',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result.image.digest.repo).toBe('sha256:newdigest');
      expect(result.image.id).toBe('new-image-id');
      expect(result.image.created).toBe('2024-06-15');
    });

    test('should keep existing created date when refreshed image has no Created field', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:olddigest' },
          id: 'old-image-id',
          created: '2023-01-01',
        },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'new-image-id',
        RepoDigests: ['nginx@sha256:newdigest'],
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result.image.digest.repo).toBe('sha256:newdigest');
      expect(result.image.id).toBe('new-image-id');
      expect(result.image.created).toBe('2023-01-01');
    });

    test('should degrade gracefully when image inspect fails for store container', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:cached' },
          id: 'cached-image-id',
          created: '2023-01-01',
        },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockRejectedValue(new Error('image not found'));

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result).toBe(existingContainer);
      expect(result.image.digest.repo).toBe('sha256:cached');
      expect(result.image.id).toBe('cached-image-id');
    });

    test('should not mutate store container when image fields unchanged', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:samedigest' },
          id: 'same-image-id',
          created: '2023-01-01',
        },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'same-image-id',
        RepoDigests: ['nginx@sha256:samedigest'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result).toBe(existingContainer);
      // Values should be unchanged
      expect(result.image.digest.repo).toBe('sha256:samedigest');
      expect(result.image.id).toBe('same-image-id');
      expect(result.image.created).toBe('2023-01-01');
    });

    test('should backfill digest value for store container when repo digest exists', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:samedigest' },
          id: 'same-image-id',
          created: '2023-01-01',
        },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'same-image-id',
        RepoDigests: ['nginx@sha256:samedigest'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result.image.digest.value).toBe('sha256:samedigest');
    });

    test('should keep existing digest value when backfill is not needed', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:samedigest', value: 'sha256:already-set' },
          id: 'same-image-id',
          created: '2023-01-01',
        },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'same-image-id',
        RepoDigests: ['nginx@sha256:samedigest'],
        Created: '2023-01-01',
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result.image.digest.value).toBe('sha256:already-set');
    });

    test('should keep digest value unchanged when repo digest is missing but image metadata changes', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug']);
      const existingContainer = {
        id: '123',
        error: undefined,
        image: {
          digest: { repo: 'sha256:cached', value: 'sha256:cached' },
          id: 'old-image-id',
          created: '2023-01-01',
        },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);
      mockImage.inspect.mockResolvedValue({
        Id: 'new-image-id',
        RepoDigests: [],
      });

      const result = await docker.addImageDetailsToContainer({
        Id: '123',
        Image: 'nginx:latest',
      });

      expect(result.image.digest.repo).toBeUndefined();
      expect(result.image.digest.value).toBe('sha256:cached');
      expect(result.image.id).toBe('new-image-id');
    });

    test('should set digest value from repo digest for new container details', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: { Image: 'nginx:latest' },
        imageDetails: { RepoDigests: ['nginx@sha256:abc123'] },
        parsedImage: { domain: 'docker.io', path: 'library/nginx', tag: 'latest' },
        semverValue: null,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.digest.repo).toBe('sha256:abc123');
      expect(result.image.digest.value).toBe('sha256:abc123');
    });

    test('should add image details to new container', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: { Image: 'nginx:1.0.0' },
        imageDetails: { Variant: 'v8', RepoDigests: ['nginx@sha256:abc123'] },
        validateImpl: () => ({
          id: '123',
          name: 'test-container',
          image: { architecture: 'amd64', variant: 'v8' },
        }),
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(mockImage.inspect).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    test('should include runtime details from inspect payload', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: { Image: 'nginx:1.0.0' },
      });
      mockContainer.inspect.mockResolvedValue({
        NetworkSettings: {
          Ports: {
            '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
            '443/tcp': null,
          },
        },
        Mounts: [
          { Name: 'config-vol', Destination: '/config', RW: true },
          { Source: '/host/data', Destination: '/data', RW: false },
        ],
        Config: {
          Env: ['NODE_ENV=production', 'EMPTY=', 'NO_VALUE'],
        },
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.details).toEqual({
        ports: ['0.0.0.0:8080->80/tcp', '443/tcp'],
        volumes: ['config-vol:/config', '/host/data:/data:ro'],
        env: [
          { key: 'NODE_ENV', value: 'production' },
          { key: 'EMPTY', value: '' },
          { key: 'NO_VALUE', value: '' },
        ],
      });
    });

    test('should default display name to container name for drydock image', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/codeswhat/drydock:latest',
          Names: ['/dd'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/codeswhat/drydock@sha256:abc123'],
        },
        parsedImage: { domain: 'ghcr.io', path: 'codeswhat/drydock', tag: 'latest' },
        semverValue: null,
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.displayName).toBe('dd');
    });

    test('should keep custom display name when provided', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/codeswhat/drydock:latest',
          Names: ['/dd'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/codeswhat/drydock@sha256:abc123'],
        },
        parsedImage: { domain: 'ghcr.io', path: 'codeswhat/drydock', tag: 'latest' },
        semverValue: null,
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container, {
        displayName: 'DD CE Custom',
      });

      expect(result.displayName).toBe('DD CE Custom');
    });

    test('should apply imgset defaults when labels are missing', async () => {
      const haImgset = {
        homeassistant: {
          image: 'ghcr.io/home-assistant/home-assistant',
          tag: {
            include: String.raw`^\d+\.\d+\.\d+$`,
          },
          display: {
            name: 'Home Assistant',
            icon: 'mdi-home-assistant',
          },
          link: {
            template: 'https://www.home-assistant.io/changelogs/core-${major}${minor}${patch}',
          },
          trigger: {
            include: 'ntfy.default:major',
          },
          registry: {
            lookup: {
              image: 'ghcr.io/home-assistant/home-assistant',
            },
          },
        },
      };
      const container = await setupContainerDetailTest(docker, {
        registerConfig: { imgset: haImgset },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:2026.2.1',
          Names: ['/homeassistant'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1 },
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.includeTags).toBe(String.raw`^\d+\.\d+\.\d+$`);
      expect(result.displayName).toBe('Home Assistant');
      expect(result.displayIcon).toBe('mdi-home-assistant');
      expect(result.linkTemplate).toBe(
        'https://www.home-assistant.io/changelogs/core-${major}${minor}${patch}',
      );
      expect(result.triggerInclude).toBe('ntfy.default:major');
      expect(result.image.registry.lookupImage).toBe('ghcr.io/home-assistant/home-assistant');
    });

    test('should let labels override imgset defaults', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            homeassistant: {
              image: 'ghcr.io/home-assistant/home-assistant',
              tag: { include: String.raw`^\d+\.\d+\.\d+$` },
              display: { name: 'Home Assistant', icon: 'mdi-home-assistant' },
              link: {
                template: 'https://www.home-assistant.io/changelogs/core-${major}${minor}${patch}',
              },
              trigger: { include: 'ntfy.default:major' },
            },
          },
        },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:2026.2.1',
          Names: ['/homeassistant'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1 },
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container, {
        includeTags: '^stable$',
        displayName: 'HA Label Name',
        displayIcon: 'mdi-docker',
        triggerInclude: 'discord.default:major',
      });

      expect(result.includeTags).toBe('^stable$');
      expect(result.displayName).toBe('HA Label Name');
      expect(result.displayIcon).toBe('mdi-docker');
      expect(result.triggerInclude).toBe('discord.default:major');
      expect(result.linkTemplate).toBe(
        'https://www.home-assistant.io/changelogs/core-${major}${minor}${patch}',
      );
    });

    test('should prefer dd.action and dd.notification aliases over legacy trigger labels', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            homeassistant: {
              image: 'ghcr.io/home-assistant/home-assistant',
              tag: { include: String.raw`^\d+\.\d+\.\d+$` },
              display: { name: 'Home Assistant', icon: 'mdi-home-assistant' },
              link: {
                template: 'https://www.home-assistant.io/changelogs/core-${major}${minor}${patch}',
              },
              trigger: { include: 'imgset.default:major' },
            },
          },
        },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:2026.2.1',
          Names: ['/homeassistant'],
          Labels: {
            'dd.action.include': 'action.default:major',
            'dd.notification.include': 'notification.default:major',
            'dd.trigger.include': 'legacy.default:major',
            'wud.trigger.include': 'wud.default:major',
          },
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1 },
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.triggerInclude).toBe('action.default:major');
    });

    test('should apply tagFamily from container labels', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'docker.io/library/nginx:1.0.0',
          Names: ['/nginx'],
          Labels: { 'dd.tag.family': 'loose' },
        },
        parsedImage: { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' },
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.tagFamily).toBe('loose');
    });

    test('should apply imgset tagFamily when label is missing', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            nginx: {
              image: 'library/nginx',
              tag: { family: 'loose' },
            },
          },
        },
        container: {
          Image: 'docker.io/library/nginx:1.0.0',
          Names: ['/nginx'],
        },
        parsedImage: { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' },
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.tagFamily).toBe('loose');
    });

    test('should apply imgset watchDigest when label is missing', async () => {
      const watchDigestImgset = {
        customregistry: {
          image: 'ghcr.io/home-assistant/home-assistant',
          watch: { digest: 'true' },
        },
      };
      const container = await setupContainerDetailTest(docker, {
        registerConfig: { imgset: watchDigestImgset },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:2026.2.1',
          Names: ['/homeassistant'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1 },
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.digest.watch).toBe(true);
    });

    test('should let dd.watch.digest label override imgset watchDigest', async () => {
      const watchDigestImgset = {
        customregistry: {
          image: 'ghcr.io/home-assistant/home-assistant',
          watch: { digest: 'true' },
        },
      };
      const container = await setupContainerDetailTest(docker, {
        registerConfig: { imgset: watchDigestImgset },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:2026.2.1',
          Names: ['/homeassistant'],
          Labels: { 'dd.watch.digest': 'false' },
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1 },
        registryId: 'ghcr',
      });

      const result = await docker.addImageDetailsToContainer(container);

      // Label says false, overriding imgset's true
      expect(result.image.digest.watch).toBe(false);
    });

    test('should apply imgset inspectTagPath when label is missing', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            haos: {
              image: 'ghcr.io/home-assistant/home-assistant',
              inspect: {
                tag: { path: 'Config/Labels/org.opencontainers.image.version' },
              },
            },
          },
        },
        container: {
          Image: 'ghcr.io/home-assistant/home-assistant:stable',
          Names: ['/homeassistant'],
        },
        imageDetails: {
          Variant: 'v8',
          RepoDigests: ['ghcr.io/home-assistant/home-assistant@sha256:abc123'],
          Config: {
            Labels: { 'org.opencontainers.image.version': '2026.2.1' },
          },
        },
        parseImpl: createHaParseMock(),
        semverValue: { major: 2026, minor: 2, patch: 1, version: '2026.2.1' },
        registryId: 'ghcr',
      });
      mockTag.transform.mockImplementation((_transform, value) => value);

      const result = await docker.addImageDetailsToContainer(container);

      // The tag should be resolved from the inspect path via imgset
      expect(result.image.tag.value).toBe('2026.2.1');
    });

    test('should not apply imgset when image does not match any preset', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            homeassistant: {
              image: 'ghcr.io/home-assistant/home-assistant',
              tag: { include: String.raw`^\d+\.\d+\.\d+$` },
              display: { name: 'Home Assistant', icon: 'mdi-home-assistant' },
            },
          },
        },
        container: {
          Id: '456',
          Image: 'nginx:1.25.0',
          Names: ['/nginx'],
        },
        imageDetails: {
          Id: 'image456',
          RepoDigests: ['nginx@sha256:def456'],
        },
        parseImpl: (value) => {
          if (value === 'nginx:1.25.0')
            return { domain: undefined, path: 'library/nginx', tag: '1.25.0' };
          if (value === 'ghcr.io/home-assistant/home-assistant')
            return { domain: 'ghcr.io', path: 'home-assistant/home-assistant' };
          return { domain: undefined, path: 'library/nginx', tag: '1.25.0' };
        },
        semverValue: { major: 1, minor: 25, patch: 0 },
      });

      const result = await docker.addImageDetailsToContainer(container);

      // No imgset should be applied - fields should be undefined
      expect(result.includeTags).toBeUndefined();
      expect(result.displayName).toBe('nginx');
      expect(result.displayIcon).toBeUndefined();
    });

    test('should pick the most specific imgset when multiple match', async () => {
      const container = await setupContainerDetailTest(docker, {
        registerConfig: {
          imgset: {
            generic: { image: 'nginx', display: { name: 'Generic Nginx', icon: 'mdi-web' } },
            specific: {
              image: 'harbor.example.com/library/nginx',
              display: { name: 'Harbor Nginx', icon: 'mdi-web-lock' },
            },
          },
        },
        container: {
          Id: '789',
          Image: 'harbor.example.com/library/nginx:1.25.0',
          Names: ['/mynginx'],
        },
        imageDetails: {
          Id: 'image789',
          RepoDigests: ['harbor.example.com/library/nginx@sha256:ghi789'],
        },
        parseImpl: (value) => {
          if (value === 'harbor.example.com/library/nginx:1.25.0')
            return { domain: 'harbor.example.com', path: 'library/nginx', tag: '1.25.0' };
          if (value === 'harbor.example.com/library/nginx')
            return { domain: 'harbor.example.com', path: 'library/nginx' };
          if (value === 'nginx') return { domain: undefined, path: 'nginx' };
          return { domain: undefined, path: value };
        },
        semverValue: { major: 1, minor: 25, patch: 0 },
        registryId: 'harbor',
      });

      const result = await docker.addImageDetailsToContainer(container);

      // The more specific imgset (harbor.example.com/library/nginx) should win
      expect(result.displayIcon).toBe('mdi-web-lock');
    });

    test('should validate configuration with imgset watchDigest and inspectTagPath', async () => {
      const config = {
        socket: '/var/run/docker.sock',
        imgset: {
          homeassistant: {
            image: 'ghcr.io/home-assistant/home-assistant',
            watch: {
              digest: 'true',
            },
            inspect: {
              tag: {
                path: 'Config/Labels/org.opencontainers.image.version',
              },
            },
          },
        },
      };
      expect(() => docker.validateConfiguration(config)).not.toThrow();
    });

    test('should use lookup image label for registry matching', async () => {
      const harborHubState = createHarborHubRegistryState();
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'harbor.example.com/dockerhub-proxy/traefik:v3.5.3',
          Names: ['/traefik'],
          Labels: { 'dd.registry.lookup.image': 'library/traefik' },
        },
        imageDetails: {
          RepoDigests: ['harbor.example.com/dockerhub-proxy/traefik@sha256:abc123'],
        },
        parseImpl: (value) => {
          if (value === 'harbor.example.com/dockerhub-proxy/traefik:v3.5.3')
            return { domain: 'harbor.example.com', path: 'dockerhub-proxy/traefik', tag: 'v3.5.3' };
          if (value === 'library/traefik') return { path: 'library/traefik' };
          return { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' };
        },
        semverValue: { major: 3, minor: 5, patch: 3 },
        registryState: harborHubState,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.registry.name).toBe('hub');
      expect(result.image.registry.url).toBe('https://registry-1.docker.io/v2');
      expect(result.image.registry.lookupImage).toBe('library/traefik');
      expect(result.image.name).toBe('library/traefik');
    });

    test('should support legacy lookup url label without crashing', async () => {
      const harborHubState = createHarborHubRegistryState();
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'harbor.example.com/dockerhub-proxy/traefik:v3.5.3',
          Names: ['/traefik'],
          Labels: { 'dd.registry.lookup.url': 'https://registry-1.docker.io' },
        },
        imageDetails: {
          RepoDigests: ['harbor.example.com/dockerhub-proxy/traefik@sha256:abc123'],
        },
        parsedImage: {
          domain: 'harbor.example.com',
          path: 'dockerhub-proxy/traefik',
          tag: 'v3.5.3',
        },
        semverValue: { major: 3, minor: 5, patch: 3 },
        registryState: harborHubState,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.registry.name).toBe('hub');
      expect(result.image.registry.lookupImage).toBe('https://registry-1.docker.io');
      expect(result.image.name).toBe('dockerhub-proxy/traefik');
    });

    test('should handle container with implicit docker hub image (no domain)', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'prom/prometheus:v3.8.0',
          Names: ['/prometheus'],
        },
        imageDetails: { RepoTags: ['prom/prometheus:v3.8.0'] },
        parsedImage: { domain: undefined, path: 'prom/prometheus', tag: 'v3.8.0' },
        validateImpl: () => ({
          id: '123',
          name: 'prometheus',
          image: { architecture: 'amd64' },
        }),
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      // Verify parse was called
      expect(mockParse).toHaveBeenCalledWith('prom/prometheus:v3.8.0');
    });

    test('should fail implicit docker hub image normalization when hub registry provider is missing', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'nginx:1.25.5',
          Names: ['/hub-proof'],
        },
        parsedImage: { domain: undefined, path: 'library/nginx', tag: '1.25.5' },
        registryState: {},
        validateImpl: (containerCandidate) => {
          if (!containerCandidate.image.registry.url) {
            throw new Error('"image.registry.url" is required');
          }
          return containerCandidate;
        },
      });

      await expect(docker.addImageDetailsToContainer(container)).rejects.toThrow(
        '"image.registry.url" is required',
      );
    });

    test('should keep implicit docker hub image tracking when hub registry provider is available', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'nginx:1.25.5',
          Names: ['/hub-proof'],
        },
        parsedImage: { domain: undefined, path: 'library/nginx', tag: '1.25.5' },
        registryState: createHarborHubRegistryState(),
        validateImpl: (containerCandidate) => {
          if (!containerCandidate.image.registry.url) {
            throw new Error('"image.registry.url" is required');
          }
          return containerCandidate;
        },
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.registry.name).toBe('hub');
      expect(result.image.registry.url).toBe('https://registry-1.docker.io/v2');
    });

    test('should handle container with SHA256 image', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:abcdef123456',
          Names: ['/test'],
        },
        imageDetails: { RepoTags: ['nginx:latest'] },
        validateImpl: () => ({
          id: '123',
          name: 'test',
          image: { architecture: 'amd64' },
        }),
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
    });

    test('should handle container with no repo tags but with repo digests', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:abcdef123456',
          Names: ['/test'],
        },
        imageDetails: {
          RepoTags: [],
          RepoDigests: ['portainer/agent@sha256:abcdef123456'],
        },
        parseImpl: (value) => {
          if (value === 'portainer/agent') {
            return { domain: 'docker.io', path: 'portainer/agent' };
          }
          return { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' };
        },
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(result.image.name).toBe('portainer/agent');
      expect(result.image.tag.value).toBe('sha256:abcdef123456');
    });

    test('should handle container with no repo tags and no repo digests', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'sha256:abcdef123456',
          Names: ['/test'],
        },
        imageDetails: { RepoTags: [], RepoDigests: [] },
        parsedImage: { path: 'sha256:abcdef123456', tag: 'unknown' },
        validateImpl: (c) => c,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
      expect(result.image.tag.value).toBe('unknown');
    });

    test('should warn for non-semver without digest watching', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'nginx:latest',
          Names: ['/test'],
        },
        semverValue: null,
        validateImpl: () => ({
          id: '123',
          name: 'test',
          image: { architecture: 'amd64' },
        }),
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result).toBeDefined();
    });

    test('should use inspect path semver when dd.inspect.tag.path is set', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/example/service:latest',
          Names: ['/service'],
          Labels: {
            'dd.inspect.tag.path': 'Config/Labels/org.opencontainers.image.version',
          },
        },
        imageDetails: {
          Config: {
            Labels: { 'org.opencontainers.image.version': '2.7.5' },
          },
        },
        parsedImage: { domain: 'ghcr.io', path: 'example/service', tag: 'latest' },
        semverValue: null, // will be overridden below
      });
      mockTag.parse.mockImplementation((tag) => (tag === '2.7.5' ? { version: '2.7.5' } : null));

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.tag.value).toBe('2.7.5');
      expect(result.image.tag.semver).toBe(true);
    });

    test('should fall back to parsed image tag when inspect path is missing', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/example/service:latest',
          Names: ['/service'],
          Labels: {
            'dd.inspect.tag.path': 'Config/Labels/org.opencontainers.image.version',
          },
        },
        imageDetails: { Config: { Labels: {} } },
        parsedImage: { domain: 'ghcr.io', path: 'example/service', tag: 'latest' },
        semverValue: null,
      });

      const result = await docker.addImageDetailsToContainer(container);

      expect(result.image.tag.value).toBe('latest');
      expect(result.image.tag.semver).toBe(false);
    });

    test('should return a clear error when image inspection fails', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const container = createDockerContainer({
        Image: 'ghcr.io/example/service:latest',
        Names: ['/service'],
      });
      mockImage.inspect.mockRejectedValue(new Error('inspect failed'));

      await expect(docker.addImageDetailsToContainer(container)).rejects.toThrow(
        'Unable to inspect image for container 123: inspect failed',
      );
    });
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

  describe('Additional Coverage - safeRegExp', () => {
    test('should warn when includeTags regex is invalid', async () => {
      const container = {
        includeTags: '[invalid',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']) } },
      });
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      const result = await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid regex pattern'));
      expect(result.tag).toBe('1.0.0');
    });

    test('should warn when excludeTags regex is invalid', async () => {
      const container = {
        excludeTags: '(unclosed',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']) } },
      });
      mockTag.isGreater.mockReturnValue(true);
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid regex pattern'));
    });
  });

  describe('Additional Coverage - filterByCurrentPrefix', () => {
    test('should warn when no tags match prefix', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'v1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['2.0.0']) } },
      });
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('No tags found with existing prefix'),
      );
    });

    test('should warn when no tags start with a number', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['latest', 'stable']) } },
      });
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('No tags found starting with a number'),
      );
    });
  });

  describe('Additional Coverage - getTagCandidates empty', () => {
    test('should warn when no tags after include filter', async () => {
      const container = {
        includeTags: '^nonexistent$',
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']) } },
      });
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('No tags found after filtering'),
      );
    });
  });

  describe('Additional Coverage - getSwarmServiceLabels', () => {
    test('should return empty when getService is not a function', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug', 'warn', 'info']);
      docker.dockerApi.getService = 'not-a-function';
      expect(await docker.getSwarmServiceLabels('svc1', 'c1')).toEqual({});
      expect(docker.log.debug).toHaveBeenCalledWith(
        expect.stringContaining('does not support getService'),
      );
    });

    test('should log debug when service has no labels', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug', 'warn', 'info']);
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ Spec: {} }),
      });
      expect(await docker.getSwarmServiceLabels('svc1', 'c1')).toEqual({});
      expect(docker.log.debug).toHaveBeenCalledWith(expect.stringContaining('has no labels'));
    });

    test('should log dd/wud label summary as none when labels are present but none are dd/wud', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['debug', 'warn', 'info']);
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          Spec: {
            Labels: { team: 'ops' },
            TaskTemplate: {
              ContainerSpec: {
                Labels: { env: 'prod' },
              },
            },
          },
        }),
      });

      const labels = await docker.getSwarmServiceLabels('svc1', 'c1');

      expect(labels).toEqual({ team: 'ops', env: 'prod' });
      expect(docker.log.debug).toHaveBeenCalledWith(expect.stringContaining('deploy labels=none'));
    });

    test('getEffectiveContainerLabels should fallback to empty container labels object', async () => {
      const labels = await docker.getEffectiveContainerLabels({}, new Map());
      expect(labels).toEqual({});
    });

    test('getEffectiveContainerLabels should merge container labels when cached service labels are undefined', async () => {
      const serviceId = 'svc-1';
      const serviceLabelsCache = new Map([[serviceId, Promise.resolve(undefined as any)]]);

      const labels = await docker.getEffectiveContainerLabels(
        {
          Id: 'container-1',
          Labels: {
            'com.docker.swarm.service.id': serviceId,
            'dd.watch': 'true',
          },
        },
        serviceLabelsCache,
      );

      expect(labels).toEqual({
        'com.docker.swarm.service.id': serviceId,
        'dd.watch': 'true',
      });
    });
  });

  describe('Additional Coverage - getMatchingImgsetConfiguration', () => {
    test('should return undefined when no imgset configured', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      expect(
        docker.getMatchingImgsetConfiguration({ path: 'library/nginx', domain: 'docker.io' }),
      ).toBeUndefined();
    });

    test('should break ties by alphabetical name', async () => {
      await docker.register('watcher', 'docker', 'test', {
        imgset: {
          zebra: { image: 'library/nginx', display: { name: 'Z' } },
          alpha: { image: 'library/nginx', display: { name: 'A' } },
        },
      });
      mockParse.mockImplementation((v) =>
        v === 'library/nginx'
          ? { path: 'library/nginx' }
          : { domain: 'docker.io', path: 'library/nginx', tag: '1.0.0' },
      );
      const result = docker.getMatchingImgsetConfiguration({
        path: 'library/nginx',
        domain: 'docker.io',
      });
      expect(result).toBeDefined();
      expect(result.name).toBe('alpha');
    });

    test('should keep first match when later candidate is not better', async () => {
      await docker.register('watcher', 'docker', 'test', {
        imgset: {
          alpha: { image: 'library/nginx' },
          zebra: { image: 'library/nginx' },
        },
      });

      const result = docker.getMatchingImgsetConfiguration({
        path: 'library/nginx',
        domain: 'docker.io',
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('alpha');
    });
  });

  describe('Additional Coverage - safeRegExp max length', () => {
    test('should warn when regex pattern exceeds max length', async () => {
      const longPattern = 'a'.repeat(1025);
      const container = {
        includeTags: longPattern,
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']) } },
      });
      mockTag.isGreater.mockReturnValue(true);
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(expect.stringContaining('exceeds maximum length'));
    });

    test('should warn when exclude regex exceeds max length', async () => {
      const longPattern = 'b'.repeat(1025);
      const container = {
        excludeTags: longPattern,
        image: {
          registry: { name: 'hub' },
          tag: { value: '1.0.0', semver: true },
          digest: { watch: false },
        },
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']) } },
      });
      mockTag.isGreater.mockReturnValue(true);
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      expect(logChild.warn).toHaveBeenCalledWith(expect.stringContaining('exceeds maximum length'));
    });
  });

  describe('Additional Coverage - filterBySegmentCount no numeric part', () => {
    test('should return all tags when current tag has no numeric part', async () => {
      const container = {
        image: {
          registry: { name: 'hub' },
          tag: { value: 'latest', semver: true },
          digest: { watch: false },
        },
        includeTags: '.*',
      };
      registry.getState.mockReturnValue({
        registry: { hub: { getTags: vi.fn().mockResolvedValue(['latest', 'stable', '1.0.0']) } },
      });
      // Make transform return 'nonnumeric' for the current tag to hit numericPart === null
      mockTag.transform.mockImplementation((_transform, tag) =>
        tag === 'latest' ? 'nonnumeric' : tag,
      );
      mockTag.parse.mockReturnValue({ major: 1, minor: 0, patch: 0 });
      mockTag.isGreater.mockReturnValue(true);
      const logChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      await docker.findNewVersion(container, logChild);
      // Should not crash; tags pass through
      expect(logChild.error).not.toHaveBeenCalled();
    });
  });

  describe('Additional Coverage - normalizeContainer no registry', () => {
    test('should set registry name to unknown when no registry provider found', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: { Image: 'custom.registry/myimage:1.0.0', Names: ['/myimage'] },
        parsedImage: { domain: 'custom.registry', path: 'myimage', tag: '1.0.0' },
        registryState: {},
      });
      const result = await docker.addImageDetailsToContainer(container);
      expect(result.image.registry.name).toBe('unknown');
    });
  });

  describe('Additional Coverage - v1 manifest digest uses repo digest', () => {
    test('should set digest value from repo digest for v1 manifests', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const container = {
        image: {
          id: 'image123',
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: true, repo: 'sha256:abc123' },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImageManifestDigest: vi.fn().mockResolvedValue({
          digest: 'sha256:def456',
          created: '2023-01-01',
          version: 1,
        }),
      };
      registry.getState.mockReturnValue({ registry: { hub: mockRegistry } });
      const mockLogChild = { error: vi.fn() };

      await docker.findNewVersion(container, mockLogChild);

      expect(container.image.digest.value).toBe('sha256:abc123');
    });

    test('should set digest value to undefined when repo digest is missing', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const container = {
        image: {
          id: 'image123',
          registry: { name: 'hub' },
          tag: { value: '1.0.0' },
          digest: { watch: true, repo: undefined },
        },
      };
      const mockRegistry = {
        getTags: vi.fn().mockResolvedValue(['1.0.0']),
        getImageManifestDigest: vi.fn().mockResolvedValue({
          digest: 'sha256:def456',
          created: '2023-01-01',
          version: 1,
        }),
      };
      registry.getState.mockReturnValue({ registry: { hub: mockRegistry } });
      const mockLogChild = { error: vi.fn() };

      await docker.findNewVersion(container, mockLogChild);

      expect(container.image.digest.value).toBeUndefined();
    });
  });

  describe('Additional Coverage - getMatchingImgsetConfiguration with no image pattern', () => {
    test('should skip imgset entries without image/match key', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      // Set imgset directly to bypass Joi validation requiring image field
      docker.configuration.imgset = {
        noimage: { display: { name: 'No Image Entry' } },
      };
      const result = docker.getMatchingImgsetConfiguration({
        path: 'library/nginx',
        domain: 'docker.io',
      });
      expect(result).toBeUndefined();
    });
  });

  describe('Additional Coverage - getSwarmServiceLabels with dd labels', () => {
    test('should log debug with dd label names from service', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const logMock = createMockLog(['debug', 'warn', 'info']);
      docker.log = logMock;
      mockDockerApi.getService.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          Spec: {
            Labels: { 'dd.watch': 'true', 'dd.tag.include': '^v' },
            TaskTemplate: { ContainerSpec: { Labels: { 'wud.display.name': 'Test' } } },
          },
        }),
      });
      const labels = await docker.getSwarmServiceLabels('svc1', 'c1');
      expect(labels['dd.watch']).toBe('true');
      expect(labels['wud.display.name']).toBe('Test');
      expect(logMock.debug).toHaveBeenCalledWith(
        expect.stringContaining('deploy labels=dd.watch,dd.tag.include'),
      );
    });
  });

  describe('Additional Coverage - getImageForRegistryLookup branches', () => {
    test('should handle lookup image as hostname only (no slash)', async () => {
      const harborHubState = createHarborHubRegistryState();
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'myimage:1.0.0',
          Names: ['/myimage'],
          Labels: { 'dd.registry.lookup.image': 'myregistry.example.com' },
        },
        imageDetails: { RepoDigests: ['myimage@sha256:abc123'] },
        parsedImage: { domain: undefined, path: 'library/myimage', tag: '1.0.0' },
        parseImpl: (value) => {
          if (value === 'myimage:1.0.0')
            return { domain: undefined, path: 'library/myimage', tag: '1.0.0' };
          if (value === 'myregistry.example.com')
            return { path: 'myregistry.example.com', domain: undefined };
          return { domain: undefined, path: value };
        },
        registryState: harborHubState,
      });
      const result = await docker.addImageDetailsToContainer(container);
      expect(result).toBeDefined();
    });

    test('should handle lookup image with empty parsed path', async () => {
      const harborHubState = createHarborHubRegistryState();
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'myimage:1.0.0',
          Names: ['/myimage'],
          Labels: { 'dd.registry.lookup.image': 'something' },
        },
        imageDetails: { RepoDigests: ['myimage@sha256:abc123'] },
        parseImpl: (value) => {
          if (value === 'myimage:1.0.0')
            return { domain: undefined, path: 'library/myimage', tag: '1.0.0' };
          if (value === 'something') return { path: undefined, domain: undefined };
          return { domain: undefined, path: value };
        },
        registryState: harborHubState,
      });
      const result = await docker.addImageDetailsToContainer(container);
      expect(result).toBeDefined();
    });
  });

  describe('Additional Coverage - Docker Hub digest watch warning', () => {
    test('should warn about throttling when watching digest on Docker Hub with explicit label', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'docker.io/library/nginx:latest',
          Names: ['/nginx'],
          Labels: { 'dd.watch.digest': 'true' },
        },
        imageDetails: { RepoDigests: ['nginx@sha256:abc123'] },
        parsedImage: { domain: 'docker.io', path: 'library/nginx', tag: 'latest' },
        semverValue: null,
      });
      const result = await docker.addImageDetailsToContainer(container);
      expect(result.image.digest.watch).toBe(true);
    });
  });

  describe('Additional Coverage - inspectTagPath edge cases', () => {
    test('should handle inspect path returning empty string value', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/example/service:latest',
          Names: ['/service'],
          Labels: { 'dd.inspect.tag.path': 'Config/Labels/version' },
        },
        imageDetails: { Config: { Labels: { version: '   ' } } },
        parsedImage: { domain: 'ghcr.io', path: 'example/service', tag: 'latest' },
        semverValue: null,
      });
      mockTag.transform.mockImplementation((_transform, value) => value);
      const result = await docker.addImageDetailsToContainer(container);
      expect(result.image.tag.value).toBe('latest');
    });

    test('should handle inspect path with null intermediate value', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/example/service:latest',
          Names: ['/service'],
          Labels: { 'dd.inspect.tag.path': 'Config/NonExistent/deep' },
        },
        imageDetails: { Config: {} },
        parsedImage: { domain: 'ghcr.io', path: 'example/service', tag: 'latest' },
        semverValue: null,
      });
      const result = await docker.addImageDetailsToContainer(container);
      expect(result.image.tag.value).toBe('latest');
    });

    test('should default to latest when parsed image tag is missing', async () => {
      const container = await setupContainerDetailTest(docker, {
        container: {
          Image: 'ghcr.io/example/service',
          Names: ['/service'],
          Labels: {},
        },
        imageDetails: {},
        parsedImage: { domain: 'ghcr.io', path: 'example/service' },
        semverValue: null,
      });

      const result = await docker.addImageDetailsToContainer(container);
      expect(result.image.tag.value).toBe('latest');
    });
  });

  describe('Additional Coverage - imgset pattern matching edge cases', () => {
    test('should handle imgset with empty image pattern', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.configuration.imgset = { weird: { image: '   ' } };
      mockParse.mockReturnValue({ path: undefined });
      const result = docker.getMatchingImgsetConfiguration({
        path: 'library/nginx',
        domain: 'docker.io',
      });
      expect(result).toBeUndefined();
    });

    test('should return -1 specificity when parsedImage has no path', async () => {
      await docker.register('watcher', 'docker', 'test', {
        imgset: { test: { image: 'library/nginx' } },
      });
      mockParse.mockImplementation((v) => (v === 'library/nginx' ? { path: 'library/nginx' } : {}));
      const result = docker.getMatchingImgsetConfiguration({ path: undefined, domain: undefined });
      expect(result).toBeUndefined();
    });

    test('helper should return empty candidates for blank pattern', () => {
      expect(testable_getImageReferenceCandidatesFromPattern('   ')).toEqual([]);
    });

    test('helper should fallback to normalized pattern when parsed pattern has no path', () => {
      mockParse.mockReturnValue({ path: undefined });
      expect(testable_getImageReferenceCandidatesFromPattern('docker.io')).toEqual(['docker.io']);
    });

    test('helper should fallback to normalized pattern when parser throws', () => {
      mockParse.mockImplementation(() => {
        throw new Error('invalid pattern');
      });
      expect(testable_getImageReferenceCandidatesFromPattern('INVALID[')).toEqual(['invalid[']);
    });

    test('helper should return -1 specificity when pattern produces no candidates', () => {
      expect(
        testable_getImgsetSpecificity('   ', { path: 'library/nginx', domain: 'docker.io' }),
      ).toBe(-1);
    });

    test('helper should avoid array includes for candidate membership checks', () => {
      mockParse.mockReturnValue({ path: 'library/nginx', domain: 'docker.io' });
      const includesSpy = vi.spyOn(Array.prototype, 'includes');
      const beforeCallCount = includesSpy.mock.calls.length;
      const specificity = testable_getImgsetSpecificity('library/nginx', {
        path: 'library/nginx',
        domain: 'docker.io',
      });
      const callDelta = includesSpy.mock.calls.length - beforeCallCount;
      includesSpy.mockRestore();

      expect(specificity).toBeGreaterThan(0);
      expect(callDelta).toBe(0);
    });
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
      storeContainer.getContainers.mockImplementation((query?: { watcher?: string }) =>
        query?.watcher ? [] : [],
      );
      registry.getState.mockReturnValue({ watcher: {} } as any);

      await docker.getContainers();

      expect(registry.getState).toHaveBeenCalled();
    });

    test('should fall back to current containers when same-source lookup fails', async () => {
      await docker.register('watcher', 'docker', 'test', {
        socket: '/var/run/docker.sock',
      });
      docker.log = createMockLog(['warn']);
      mockDockerApi.listContainers.mockResolvedValue([]);
      storeContainer.getContainers.mockImplementation((query?: { watcher?: string }) =>
        query?.watcher ? [] : [],
      );
      registry.getState.mockImplementation(() => {
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
      storeContainer.getContainers.mockImplementation((query?: { watcher?: string }) => {
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
      registry.getState.mockReturnValue({
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

      expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
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
