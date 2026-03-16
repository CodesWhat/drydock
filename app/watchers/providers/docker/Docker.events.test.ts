import type { Mocked } from 'vitest';
import * as event from '../../../event/index.js';
import { fullName } from '../../../model/container.js';
import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
import { mockConstructor } from '../../../test/mock-constructor.js';
import {
  _resetRegistryWebhookFreshStateForTests,
  markContainerFreshForScheduledPollSkip,
} from '../../registry-webhook-fresh.js';
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
vi.mock('../../../registry');
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

import mockFs from 'node:fs';
import axios from 'axios';
import mockDockerode from 'dockerode';
import mockDebounce from 'just-debounce';
import mockCron from 'node-cron';
import mockParse from 'parse-docker-image-name';
import * as mockPrometheus from '../../../prometheus/watcher.js';
import * as mockTag from '../../../tag/index.js';
import * as maintenance from './maintenance.js';
import * as oidcModule from './oidc.js';
import {
  applyRemoteOidcTokenPayload,
  getOidcGrantType,
  handleTokenErrorResponse,
  initializeRemoteOidcStateFromConfiguration,
  isRemoteOidcTokenRefreshRequired,
  OIDC_DEVICE_URL_PATHS,
  OIDC_GRANT_TYPE_PATHS,
  performDeviceCodeFlow,
  pollDeviceCodeToken,
  refreshRemoteOidcAccessToken,
} from './oidc.js';

const mockAxios = axios as Mocked<typeof axios>;

// --- Shared factory functions to reduce test duplication ---

/** Base OIDC auth configuration for remote Docker API tests. */
function createOidcConfig(oidcOverrides = {}, configOverrides = {}) {
  return {
    host: 'docker-api.example.com',
    port: 443,
    protocol: 'https',
    auth: {
      type: 'oidc',
      oidc: {
        tokenurl: 'https://idp.example.com/oauth/token',
        ...oidcOverrides,
      },
    },
    ...configOverrides,
  };
}

/** Device flow OIDC config (adds deviceurl + clientid to base OIDC). */
function createDeviceFlowConfig(oidcOverrides = {}, configOverrides = {}) {
  return createOidcConfig(
    {
      deviceurl: 'https://idp.example.com/oauth/device/code',
      clientid: 'dd-device-client',
      ...oidcOverrides,
    },
    configOverrides,
  );
}

/** Standard device authorization response from the IdP. */
function createDeviceCodeResponse(overrides = {}) {
  return {
    device_code: 'device-code-123',
    user_code: 'ABCD-1234',
    verification_uri: 'https://idp.example.com/device',
    interval: 1,
    expires_in: 300,
    ...overrides,
  };
}

/** Token response from the IdP. */
function createTokenResponse(overrides = {}) {
  return {
    access_token: 'test-token',
    expires_in: 3600,
    ...overrides,
  };
}

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

function createDockerOidcStateAdapter(docker) {
  return {
    get accessToken() {
      return docker.remoteOidcAccessToken;
    },
    set accessToken(value) {
      docker.remoteOidcAccessToken = value;
    },
    get refreshToken() {
      return docker.remoteOidcRefreshToken;
    },
    set refreshToken(value) {
      docker.remoteOidcRefreshToken = value;
    },
    get accessTokenExpiresAt() {
      return docker.remoteOidcAccessTokenExpiresAt;
    },
    set accessTokenExpiresAt(value) {
      docker.remoteOidcAccessTokenExpiresAt = value;
    },
    get deviceCodeCompleted() {
      return docker.remoteOidcDeviceCodeCompleted;
    },
    set deviceCodeCompleted(value) {
      docker.remoteOidcDeviceCodeCompleted = value;
    },
  };
}

function createDockerOidcContext(docker) {
  return {
    watcherName: docker.name,
    log: docker.log,
    state: createDockerOidcStateAdapter(docker),
    getOidcAuthString: (paths) => docker.getOidcAuthString(paths),
    getOidcAuthNumber: (paths) => docker.getOidcAuthNumber(paths),
    normalizeNumber: testable_normalizeConfigNumberValue,
    sleep: (ms) => docker.sleep(ms),
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

  describe('Docker Events', () => {
    test('should listen to docker events', async () => {
      const mockStream = { on: vi.fn() };
      mockDockerApi.getEvents.mockImplementation((options, callback) => {
        callback(null, mockStream);
      });
      await docker.register('watcher', 'docker', 'test', {});
      await docker.listenDockerEvents();
      expect(mockDockerApi.getEvents).toHaveBeenCalledWith(
        {
          filters: {
            type: ['container'],
            event: [
              'create',
              'destroy',
              'start',
              'stop',
              'pause',
              'unpause',
              'die',
              'update',
              'rename',
            ],
          },
        },
        expect.any(Function),
      );
    });

    test('should forward docker stream data events to onDockerEvent', async () => {
      const eventHandlers: Record<string, (chunk: any) => Promise<void> | void> = {};
      const mockStream = {
        on: vi.fn((eventName, handler) => {
          eventHandlers[eventName] = handler;
        }),
      };
      mockDockerApi.getEvents.mockImplementation((options, callback) => {
        callback(null, mockStream);
      });
      docker.onDockerEvent = vi.fn().mockResolvedValue(undefined);

      await docker.register('watcher', 'docker', 'test', {});
      await docker.listenDockerEvents();
      await eventHandlers.data(Buffer.from('{"Action":"create","id":"container123"}\n'));

      expect(mockStream.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockStream.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockStream.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockStream.on).toHaveBeenCalledWith('end', expect.any(Function));
      expect(docker.onDockerEvent).toHaveBeenCalledWith(
        Buffer.from('{"Action":"create","id":"container123"}\n'),
      );
    });

    test('should handle docker events error', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const mockLog = createMockLog(['warn', 'debug', 'info']);
      docker.log = mockLog;
      mockDockerApi.getEvents.mockImplementation((options, callback) => {
        callback(new Error('Connection failed'));
      });
      await docker.listenDockerEvents();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Connection failed'));
    });

    test('should ignore getEvents error when warn logger is unavailable', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['info']);
      mockDockerApi.getEvents.mockImplementation((options, callback) => {
        callback(new Error('Connection failed'));
      });

      await expect(docker.listenDockerEvents()).resolves.toBeUndefined();
    });

    test('should reconnect docker events stream after stream failure', async () => {
      vi.useFakeTimers();
      try {
        const eventHandlers: Record<string, (...args: any[]) => void> = {};
        const mockStream = {
          on: vi.fn((eventName, handler) => {
            eventHandlers[eventName] = handler;
          }),
          removeAllListeners: vi.fn(),
          destroy: vi.fn(),
        };
        mockDockerApi.getEvents.mockImplementation((options, callback) => {
          callback(null, mockStream);
        });

        await docker.register('watcher', 'docker', 'test', {
          watchevents: false,
        });
        docker.configuration.watchevents = true;
        docker.isDockerEventsListenerActive = true;
        docker.log = createMockLog(['warn', 'debug', 'info']);

        await docker.listenDockerEvents();
        expect(docker.dockerEventsReconnectDelayMs).toBe(1000);

        eventHandlers.error(new Error('Stream dropped'));
        expect(docker.log.warn).toHaveBeenCalledWith(
          expect.stringContaining('reconnect attempt #1'),
        );
        expect(docker.dockerEventsReconnectTimeout).toBeDefined();
        expect(docker.dockerEventsReconnectDelayMs).toBe(2000);

        const reconnectTimeout = docker.dockerEventsReconnectTimeout;
        eventHandlers.close();
        expect(docker.dockerEventsReconnectTimeout).toBe(reconnectTimeout);

        await vi.advanceTimersByTimeAsync(1000);
        expect(mockDockerApi.getEvents).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    test('should exponentially back off reconnect delay on repeated getEvents failures', async () => {
      vi.useFakeTimers();
      try {
        const recoveredStream = {
          on: vi.fn(),
          removeAllListeners: vi.fn(),
          destroy: vi.fn(),
        };
        mockDockerApi.getEvents
          .mockImplementationOnce((options, callback) => {
            callback(new Error('Connection failed (1)'));
          })
          .mockImplementationOnce((options, callback) => {
            callback(new Error('Connection failed (2)'));
          })
          .mockImplementation((options, callback) => {
            callback(null, recoveredStream);
          });

        await docker.register('watcher', 'docker', 'test', {
          watchevents: false,
        });
        docker.configuration.watchevents = true;
        docker.isDockerEventsListenerActive = true;
        docker.log = createMockLog(['warn', 'debug', 'info']);

        await docker.listenDockerEvents();
        expect(docker.dockerEventsReconnectAttempt).toBe(1);
        expect(docker.dockerEventsReconnectDelayMs).toBe(2000);

        await vi.advanceTimersByTimeAsync(1000);
        expect(docker.dockerEventsReconnectAttempt).toBe(2);
        expect(docker.dockerEventsReconnectDelayMs).toBe(4000);

        await vi.advanceTimersByTimeAsync(2000);
        expect(mockDockerApi.getEvents).toHaveBeenCalledTimes(3);
        expect(docker.dockerEventsReconnectAttempt).toBe(0);
        expect(docker.dockerEventsReconnectDelayMs).toBe(1000);
      } finally {
        vi.useRealTimers();
      }
    });

    test('should stop reconnect scheduling when watcher is deregistered', async () => {
      vi.useFakeTimers();
      try {
        const eventHandlers: Record<string, (...args: any[]) => void> = {};
        const mockStream = {
          on: vi.fn((eventName, handler) => {
            eventHandlers[eventName] = handler;
          }),
          removeAllListeners: vi.fn(),
          destroy: vi.fn(),
        };
        mockDockerApi.getEvents.mockImplementation((options, callback) => {
          callback(null, mockStream);
        });

        await docker.register('watcher', 'docker', 'test', {
          watchevents: false,
        });
        docker.configuration.watchevents = true;
        docker.isDockerEventsListenerActive = true;
        docker.log = createMockLog(['warn', 'debug', 'info']);

        await docker.listenDockerEvents();
        eventHandlers.end();
        expect(docker.dockerEventsReconnectTimeout).toBeDefined();
        expect(mockStream.removeAllListeners).toHaveBeenCalled();

        await docker.deregisterComponent();
        await vi.advanceTimersByTimeAsync(5000);

        expect(mockDockerApi.getEvents).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    test('should process create/destroy events', async () => {
      docker.watchCronDebounced = vi.fn();
      const event = JSON.stringify({
        Action: 'create',
        id: 'container123',
      });
      await docker.onDockerEvent(Buffer.from(event));
      expect(docker.watchCronDebounced).toHaveBeenCalled();
    });

    test('should update container status on other events', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const mockLog = createMockLogWithChild(['info']);
      docker.log = mockLog;
      mockContainer.inspect.mockResolvedValue({
        State: { Status: 'running' },
      });
      const existingContainer = { id: 'container123', status: 'stopped' };
      storeContainer.getContainer.mockReturnValue(existingContainer);

      const event = JSON.stringify({
        Action: 'start',
        id: 'container123',
      });
      await docker.onDockerEvent(Buffer.from(event));

      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(storeContainer.updateContainer).toHaveBeenCalled();
    });

    test('should update container name on rename events', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const mockLog = createMockLogWithChild(['info']);
      docker.log = mockLog;
      mockContainer.inspect.mockResolvedValue({
        Name: '/renamed-container',
        State: { Status: 'running' },
        Config: { Labels: {} },
      });
      const existingContainer = {
        id: 'container123',
        name: 'old-temp-name',
        displayName: 'old-temp-name',
        status: 'running',
        image: { name: 'library/nginx' },
        labels: {},
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);

      const event = JSON.stringify({
        Action: 'rename',
        id: 'container123',
      });
      await docker.onDockerEvent(Buffer.from(event));

      expect(existingContainer.name).toBe('renamed-container');
      expect(existingContainer.displayName).toBe('renamed-container');
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(existingContainer);
    });

    test('should apply custom display name from labels when processing events', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLogWithChild(['info']);
      mockContainer.inspect.mockResolvedValue({
        Name: '/renamed-container',
        State: { Status: 'running' },
        Config: { Labels: { 'wud.display.name': 'Custom Label Name' } },
      });
      const existingContainer = {
        id: 'container123',
        name: 'old-name',
        displayName: 'old-name',
        status: 'running',
        image: { name: 'library/nginx' },
        labels: {},
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);

      await docker.onDockerEvent(Buffer.from('{"Action":"rename","id":"container123"}\n'));

      expect(existingContainer.displayName).toBe('Custom Label Name');
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(existingContainer);
    });

    test('should skip store update when inspect payload does not change tracked fields', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLogWithChild(['info']);
      mockContainer.inspect.mockResolvedValue({
        Name: '/same-name',
        State: { Status: 'running' },
        Config: { Labels: { foo: 'bar' } },
      });
      const existingContainer = {
        id: 'container123',
        name: 'same-name',
        displayName: 'custom-name',
        status: 'running',
        image: { name: 'library/nginx' },
        labels: { foo: 'bar' },
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);

      await docker.onDockerEvent(Buffer.from('{"Action":"start","id":"container123"}\n'));

      expect(storeContainer.updateContainer).not.toHaveBeenCalled();
    });

    test('should compute fallback display name even when image metadata is missing', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLogWithChild(['info']);
      mockContainer.inspect.mockResolvedValue({
        Name: '/renamed-container',
        State: { Status: 'running' },
        Config: { Labels: {} },
      });
      const existingContainer = {
        id: 'container123',
        name: 'old-temp-name',
        displayName: '',
        status: 'running',
        labels: {},
      };
      storeContainer.getContainer.mockReturnValue(existingContainer);

      await docker.onDockerEvent(Buffer.from('{"Action":"rename","id":"container123"}\n'));

      expect(existingContainer.displayName).toBe('renamed-container');
    });

    test('should handle container not found during event processing', async () => {
      const mockLog = createMockLog(['debug']);
      docker.log = mockLog;
      mockDockerApi.getContainer.mockImplementation(() => {
        throw new Error('No such container');
      });

      const event = JSON.stringify({
        Action: 'start',
        id: 'nonexistent',
      });
      await docker.onDockerEvent(Buffer.from(event));

      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('Unable to get container'),
      );
    });

    test('should skip updates when docker event container is not found in store', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLogWithChild(['info', 'debug']);
      mockContainer.inspect.mockResolvedValue({
        Name: '/existing-container',
        State: { Status: 'running' },
        Config: { Labels: {} },
      });
      storeContainer.getContainer.mockReturnValue(undefined);

      await docker.onDockerEvent(Buffer.from('{"Action":"start","id":"container123"}\n'));

      expect(storeContainer.updateContainer).not.toHaveBeenCalled();
    });

    test('should handle malformed docker event payload', async () => {
      const mockLog = createMockLog(['debug']);
      docker.log = mockLog;

      await docker.onDockerEvent(Buffer.from('{invalid-json\n'));

      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('Unable to process Docker event'),
      );
    });

    test('isRecoverableDockerEventParseError should return false when error has no message', () => {
      expect(docker.isRecoverableDockerEventParseError({})).toBe(false);
    });

    test('should buffer split docker event payloads until complete', async () => {
      docker.watchCronDebounced = vi.fn();
      await docker.onDockerEvent(Buffer.from('{"Action":"create","id":"container'));

      expect(docker.watchCronDebounced).not.toHaveBeenCalled();
      expect(docker.dockerEventsBuffer).toContain('"container');

      await docker.onDockerEvent(Buffer.from('123"}\n'));

      expect(docker.watchCronDebounced).toHaveBeenCalledTimes(1);
      expect(docker.dockerEventsBuffer).toBe('');
    });

    test('should process multiple docker events from a single chunk', async () => {
      docker.watchCronDebounced = vi.fn();

      await docker.onDockerEvent(
        Buffer.from(
          '{"Action":"create","id":"container123"}\n{"Action":"destroy","id":"container456"}\n',
        ),
      );

      expect(docker.watchCronDebounced).toHaveBeenCalledTimes(2);
    });

    test('should keep buffer when opportunistic parse returns partial result', async () => {
      docker.processDockerEventPayload = vi.fn().mockResolvedValue(false);
      docker.dockerEventsBuffer = '';

      await docker.onDockerEvent(Buffer.from('{"Action":"create","id":"c1"}'));

      expect(docker.processDockerEventPayload).toHaveBeenCalledWith(
        '{"Action":"create","id":"c1"}',
        true,
      );
      expect(docker.dockerEventsBuffer).toBe('{"Action":"create","id":"c1"}');
    });

    test('should reconnect when docker events buffer exceeds 1MB', async () => {
      vi.useFakeTimers();
      try {
        await docker.register('watcher', 'docker', 'test', {
          watchevents: false,
        });
        docker.configuration.watchevents = true;
        docker.isDockerEventsListenerActive = true;
        docker.log = createMockLog(['warn', 'debug']);
        docker.processDockerEventPayload = vi.fn().mockResolvedValue(false);
        docker.dockerEventsBuffer = 'a'.repeat(1024 * 1024 - 10);

        await docker.onDockerEvent(Buffer.from('{"Action":"create","id":"overflow"}'));

        expect(docker.log.warn).toHaveBeenCalledWith(expect.stringContaining('buffer overflow'));
        expect(docker.dockerEventsReconnectAttempt).toBe(1);
        expect(docker.dockerEventsReconnectTimeout).toBeDefined();
        expect(docker.dockerEventsBuffer).toBe('');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Additional Coverage - ensureRemoteAuthHeaders and listenDockerEvents', () => {
    test('should fail closed when OIDC auth is configured without HTTPS', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 2375,
        protocol: 'http',
      });
      docker.configuration.auth = { type: 'oidc', oidc: { tokenurl: 'https://idp/token' } };
      await expect(docker.ensureRemoteAuthHeaders()).rejects.toThrow(
        'HTTPS is required for OIDC auth',
      );
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    test('should allow non-HTTPS OIDC fallback when auth.insecure=true', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 2375,
        protocol: 'http',
      });
      docker.configuration.auth = {
        type: 'oidc',
        insecure: true,
        oidc: { tokenurl: 'https://idp/token' },
      };
      const logMock = createMockLog(['warn', 'info', 'debug']);
      docker.log = logMock;
      await docker.ensureRemoteAuthHeaders();
      expect(mockAxios.post).not.toHaveBeenCalled();
      expect(logMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('continuing because auth.insecure=true'),
      );
    });

    test('should warn when ensureRemoteAuthHeaders fails in listenDockerEvents', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: { type: 'oidc', oidc: { tokenurl: 'https://idp/token' } },
      });
      mockAxios.post.mockRejectedValue(new Error('Network error'));
      const logMock = createMockLog(['warn', 'info', 'debug']);
      docker.log = logMock;
      await docker.listenDockerEvents();
      expect(logMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unable to initialize remote watcher auth'),
      );
    });

    test('should return early when ensureLogger produces a non-functional log', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      // Override ensureLogger to set a log that lacks info()
      docker.ensureLogger = () => {
        docker.log = {};
      };
      await docker.listenDockerEvents();
      expect(mockDockerApi.getEvents).not.toHaveBeenCalled();
    });

    test('should expose and update deviceCodeCompleted through OIDC state adapter accessors', async () => {
      await docker.register('watcher', 'docker', 'test', createOidcConfig());
      docker.remoteOidcDeviceCodeCompleted = true;

      const state = (docker as any).getOidcStateAdapter();
      expect(state.deviceCodeCompleted).toBe(true);

      state.deviceCodeCompleted = false;
      expect(docker.remoteOidcDeviceCodeCompleted).toBe(false);
    });

    test('should throw when OIDC refresh succeeds without returning an access token', async () => {
      await docker.register('watcher', 'docker', 'test', createOidcConfig());
      docker.remoteOidcAccessToken = undefined;
      docker.remoteOidcAccessTokenExpiresAt = 0;
      const refreshSpy = vi
        .spyOn(oidcModule, 'refreshRemoteOidcAccessToken')
        .mockResolvedValue(undefined as any);

      try {
        await expect(docker.ensureRemoteAuthHeaders()).rejects.toThrow(
          'no OIDC access token available',
        );
      } finally {
        refreshSpy.mockRestore();
      }
    });

    test('listenDockerEvents should return early when watchevents is disabled', async () => {
      await docker.register('watcher', 'docker', 'test', { watchevents: false });
      docker.isDockerEventsListenerActive = true;

      await docker.listenDockerEvents();

      expect(mockDockerApi.getEvents).not.toHaveBeenCalled();
    });

    test('listenDockerEvents should clear stale reconnect timeout before opening stream', async () => {
      await docker.register('watcher', 'docker', 'test', { watchevents: true });
      docker.isDockerEventsListenerActive = true;
      const reconnectTimeout = setTimeout(() => {}, 10_000) as any;
      docker.dockerEventsReconnectTimeout = reconnectTimeout;
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      vi.spyOn(docker, 'ensureRemoteAuthHeaders').mockResolvedValue(undefined);
      mockDockerApi.getEvents.mockRejectedValueOnce(new Error('events failed'));

      await docker.listenDockerEvents();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(reconnectTimeout);
      clearTimeoutSpy.mockRestore();
      clearTimeout(reconnectTimeout);
    });
  });

  describe('Additional Coverage - processDockerEventPayload', () => {
    test('should treat empty payload as processed', async () => {
      docker.log = createMockLog(['debug']);
      expect(await docker.processDockerEventPayload('   ')).toBe(true);
    });

    test('should return false for recoverable partial JSON when flag is set', async () => {
      docker.log = createMockLog(['debug']);
      // Use a payload that gives "Unexpected end of JSON input"
      const result = await docker.processDockerEventPayload('{"Action":"cre', true);
      expect(result).toBe(false);
    });

    test('should return true for non-recoverable JSON error', async () => {
      docker.log = createMockLog(['debug']);
      expect(await docker.processDockerEventPayload('not-json-at-all', true)).toBe(true);
    });
  });

  describe('Additional Coverage - updateContainerFromInspect', () => {
    test('should update labels and custom display name on events', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLogWithChild(['info']);
      const existing = {
        id: 'c1',
        name: 'mycontainer',
        displayName: 'mycontainer',
        status: 'running',
        labels: { old: 'label' },
        image: { name: 'library/nginx' },
      };
      storeContainer.getContainer.mockReturnValue(existing);
      mockContainer.inspect.mockResolvedValue({
        Name: '/mycontainer',
        State: { Status: 'running' },
        Config: { Labels: { 'dd.display.name': 'Custom Name', new: 'label' } },
      });
      await docker.onDockerEvent(Buffer.from('{"Action":"update","id":"c1"}\n'));
      expect(existing.labels).toEqual({ 'dd.display.name': 'Custom Name', new: 'label' });
      expect(existing.displayName).toBe('Custom Name');
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(existing);
    });

    test('should not update when custom display name label matches existing value', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLogWithChild(['info']);
      const existing = {
        id: 'c1',
        name: 'mycontainer',
        displayName: 'Custom Name',
        status: 'running',
        labels: { 'dd.display.name': 'Custom Name' },
        image: { name: 'library/nginx' },
      };
      storeContainer.getContainer.mockReturnValue(existing);
      mockContainer.inspect.mockResolvedValue({
        Name: '/mycontainer',
        State: { Status: 'running' },
        Config: { Labels: { 'dd.display.name': 'Custom Name' } },
      });

      await docker.onDockerEvent(Buffer.from('{"Action":"update","id":"c1"}\n'));

      expect(storeContainer.updateContainer).not.toHaveBeenCalled();
    });

    test('should update runtime details when inspect metadata changes', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLogWithChild(['info']);
      const existing = {
        id: 'c1',
        name: 'mycontainer',
        displayName: 'mycontainer',
        status: 'running',
        labels: {},
        image: { name: 'library/nginx' },
        details: {
          ports: ['80/tcp'],
          volumes: [],
          env: [],
        },
      };
      storeContainer.getContainer.mockReturnValue(existing);
      mockContainer.inspect.mockResolvedValue({
        Name: '/mycontainer',
        State: { Status: 'running' },
        Config: { Labels: {}, Env: ['APP_ENV=prod'] },
        NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }] } },
        Mounts: [{ Source: '/srv/data', Destination: '/data', RW: true }],
      });

      await docker.onDockerEvent(Buffer.from('{"Action":"update","id":"c1"}\n'));

      expect(existing.details).toEqual({
        ports: ['0.0.0.0:8080->80/tcp'],
        volumes: ['/srv/data:/data'],
        env: [{ key: 'APP_ENV', value: 'prod' }],
      });
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(existing);
    });
  });
});
