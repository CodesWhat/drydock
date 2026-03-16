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

  describe('Configuration', () => {
    test('should create instance', async () => {
      expect(docker).toBeDefined();
      expect(docker).toBeInstanceOf(Docker);
    });

    test('should have correct configuration schema', async () => {
      const schema = docker.getConfigurationSchema();
      expect(schema).toBeDefined();
    });

    test('should validate configuration', async () => {
      const config = { socket: '/var/run/docker.sock' };
      expect(() => docker.validateConfiguration(config)).not.toThrow();
    });

    test('should validate configuration with watchall option', async () => {
      const config = { socket: '/var/run/docker.sock', watchall: true };
      expect(() => docker.validateConfiguration(config)).not.toThrow();
    });

    test('should validate configuration with custom cron', async () => {
      const config = {
        socket: '/var/run/docker.sock',
        cron: '*/5 * * * *',
      };
      expect(() => docker.validateConfiguration(config)).not.toThrow();
    });

    test('should validate configuration with imgset presets', async () => {
      const config = {
        socket: '/var/run/docker.sock',
        imgset: {
          homeassistant: {
            image: 'ghcr.io/home-assistant/home-assistant',
            tag: {
              include: String.raw`^\d+\.\d+\.\d+$`,
            },
            display: {
              icon: 'mdi-home-assistant',
            },
            link: {
              template: 'https://example.com/changelog/${major}',
            },
          },
        },
      };
      expect(() => docker.validateConfiguration(config)).not.toThrow();
    });

    test('should validate configuration with oidc remote auth', async () => {
      const config = createOidcConfig(
        {
          clientid: 'dd-client',
          clientsecret: 'super-secret',
          scope: 'docker.read',
        },
        { host: 'docker-proxy.example.com' },
      );
      expect(() => docker.validateConfiguration(config)).not.toThrow();
    });

    test('should validate configuration with insecure remote auth override', async () => {
      const config = {
        host: 'docker-proxy.example.com',
        port: 443,
        protocol: 'https',
        auth: {
          type: 'bearer',
          bearer: 'test-token',
          insecure: true,
        },
      };
      expect(() => docker.validateConfiguration(config)).not.toThrow();
    });
  });

  describe('Initialization', () => {
    test('should initialize docker client with socket', async () => {
      await docker.register('watcher', 'docker', 'test', {
        socket: '/var/run/docker.sock',
      });
      expect(mockDockerode).toHaveBeenCalledWith({
        socketPath: '/var/run/docker.sock',
      });
    });

    test('should initialize with host configuration', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 2376,
      });
      expect(mockDockerode).toHaveBeenCalledWith({
        host: 'localhost',
        port: 2376,
      });
    });

    test('should initialize with SSL configuration', async () => {
      mockFs.readFileSync.mockReturnValue('cert-content');
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 2376,
        cafile: '/ca.pem',
        certfile: '/cert.pem',
        keyfile: '/key.pem',
      });
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(3);
      expect(mockDockerode).toHaveBeenCalledWith({
        host: 'localhost',
        port: 2376,
        ca: 'cert-content',
        cert: 'cert-content',
        key: 'cert-content',
      });
    });

    test('should initialize with HTTPS bearer auth configuration', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: {
          type: 'bearer',
          bearer: 'my-secret-token',
        },
      });
      expect(mockDockerode).toHaveBeenCalledWith({
        host: 'localhost',
        port: 443,
        protocol: 'https',
        headers: {
          Authorization: 'Bearer my-secret-token',
        },
      });
    });

    test('should initialize with HTTPS basic auth configuration', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: {
          type: 'basic',
          user: 'john',
          password: 'doe',
        },
      });
      expect(mockDockerode).toHaveBeenCalledWith({
        host: 'localhost',
        port: 443,
        protocol: 'https',
        headers: {
          Authorization: 'Basic am9objpkb2U=',
        },
      });
    });

    test('should initialize with OIDC access token when provided', async () => {
      await docker.register(
        'watcher',
        'docker',
        'test',
        createOidcConfig(
          {
            accesstoken: 'seed-access-token',
            expiresin: 300,
          },
          { host: 'localhost' },
        ),
      );
      expect(mockDockerode).toHaveBeenCalledWith({
        host: 'localhost',
        port: 443,
        protocol: 'https',
        headers: {
          Authorization: 'Bearer seed-access-token',
        },
      });
    });

    test('should keep watcher registered but block remote sync when auth is configured without HTTPS', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 2375,
        protocol: 'http',
        auth: {
          type: 'bearer',
          bearer: 'my-secret-token',
        },
      });
      expect(docker.remoteAuthBlockedReason).toContain('HTTPS is required for remote auth');
      expect(mockDockerode).toHaveBeenCalledWith({
        host: 'localhost',
        port: 2375,
        protocol: 'http',
      });
    });

    test('should allow insecure auth fallback when auth.insecure=true', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 2375,
        protocol: 'http',
        auth: {
          type: 'bearer',
          bearer: 'my-secret-token',
          insecure: true,
        },
      });
      expect(mockDockerode).toHaveBeenCalledWith({
        host: 'localhost',
        port: 2375,
        protocol: 'http',
      });
    });

    test('should schedule cron job on init', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });
      docker.init();
      expect(mockCron.schedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function), {
        maxRandomDelay: 60000,
      });
    });

    test('should warn about deprecated watchdigest', async () => {
      await docker.register('watcher', 'docker', 'test', {
        watchdigest: true,
      });
      const mockLog = { warn: vi.fn(), info: vi.fn() };
      docker.log = mockLog;
      docker.init();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
    });

    test('should warn about deprecated watchatstart when env var is explicitly set', async () => {
      mockDdEnvVars.DD_WATCHER_TEST_WATCHATSTART = 'true';
      try {
        await docker.register('watcher', 'docker', 'test', {
          watchatstart: true,
        });
        const mockLog = { warn: vi.fn(), info: vi.fn() };
        docker.log = mockLog;
        docker.init();
        expect(mockLog.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            'DD_WATCHER_TEST_WATCHATSTART environment variable is deprecated',
          ),
        );
      } finally {
        delete mockDdEnvVars.DD_WATCHER_TEST_WATCHATSTART;
      }
    });

    test('should not warn about watchatstart when env var is not explicitly set', async () => {
      await docker.register('watcher', 'docker', 'test', {
        watchatstart: true,
      });
      const mockLog = { warn: vi.fn(), info: vi.fn() };
      docker.log = mockLog;
      docker.init();
      expect(mockLog.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('WATCHATSTART environment variable is deprecated'),
      );
    });

    test('should setup docker events listener', async () => {
      await docker.register('watcher', 'docker', 'test', {
        watchevents: true,
      });
      docker.init();
      expect(mockDebounce).toHaveBeenCalled();
    });

    test('should not setup events when disabled', async () => {
      await docker.register('watcher', 'docker', 'test', {
        watchevents: false,
      });
      docker.init();
      expect(mockDebounce).not.toHaveBeenCalled();
    });

    test('should keep watchatstart enabled when watcher state already exists in store', async () => {
      storeContainer.getContainers.mockReturnValue([{ id: 'existing' }]);
      await docker.register('watcher', 'docker', 'test', {
        watchatstart: true,
        watchevents: false,
      });
      docker.init();
      expect(docker.configuration.watchatstart).toBe(true);
      expect(docker.watchCronTimeout).toBeDefined();
    });

    test('should keep watchatstart disabled when explicitly set to false', async () => {
      storeContainer.getContainers.mockReturnValue([]);
      await docker.register('watcher', 'docker', 'test', {
        watchatstart: false,
      });
      docker.init();
      expect(docker.configuration.watchatstart).toBe(false);
    });

    test('should execute scheduled cron callback by delegating to watchFromCron', async () => {
      storeContainer.getContainers.mockReturnValue([]);
      await docker.register('watcher', 'docker', 'test', {
        watchatstart: false,
      });
      docker.watchFromCron = vi.fn().mockResolvedValue([]);

      await docker.init();

      const scheduledCallback = mockCron.schedule.mock.calls[0][1];
      await scheduledCallback();

      expect(docker.watchFromCron).toHaveBeenCalledTimes(1);
    });
  });

  describe('Deregistration', () => {
    test('should stop cron and clear timeouts on deregister', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.init();
      await docker.deregisterComponent();
      expect(mockSchedule.stop).toHaveBeenCalled();
    });

    test('should stop watchCron when it is set explicitly', async () => {
      const stop = vi.fn();
      docker.watchCron = { stop };

      await docker.deregisterComponent();

      expect(stop).toHaveBeenCalled();
      expect(docker.watchCron).toBeUndefined();
    });

    test('should clear watch/listen timeouts when they are set', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      docker.watchCronTimeout = setTimeout(() => {}, 10_000) as any;
      docker.listenDockerEventsTimeout = setTimeout(() => {}, 10_000) as any;

      try {
        await docker.deregisterComponent();
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
      } finally {
        clearTimeoutSpy.mockRestore();
      }
    });

    test('should safely deregister when cron and timeouts are unset', async () => {
      docker.watchCron = undefined;
      docker.watchCronTimeout = undefined;
      docker.listenDockerEventsTimeout = undefined;

      await expect(docker.deregisterComponent()).resolves.toBeUndefined();
    });
  });

  describe('OIDC Remote Auth', () => {
    test('should fetch oidc access token before listing containers', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      await docker.register(
        'watcher',
        'docker',
        'test',
        createOidcConfig({
          clientid: 'dd-client',
          clientsecret: 'dd-secret',
          scope: 'docker.read',
        }),
      );

      await docker.getContainers();

      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://idp.example.com/oauth/token',
        expect.stringContaining('grant_type=client_credentials'),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );
      expect(mockDockerApi.modem.headers.Authorization).toBe('Bearer oidc-token');
      expect(mockDockerApi.listContainers).toHaveBeenCalled();
    });

    test('should use refresh_token grant when refresh token is available', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      await docker.register(
        'watcher',
        'docker',
        'test',
        createOidcConfig({
          refreshtoken: 'refresh-token-1',
        }),
      );

      await docker.getContainers();

      const tokenRequestBody = mockAxios.post.mock.calls[0][1];
      expect(tokenRequestBody).toContain('grant_type=refresh_token');
      expect(tokenRequestBody).toContain('refresh_token=refresh-token-1');
    });

    test('should reuse cached oidc token until close to expiry', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockResolvedValue({
        data: createTokenResponse({
          access_token: 'cached-token',
        }),
      } as any);
      await docker.register('watcher', 'docker', 'test', createOidcConfig());

      await docker.getContainers();
      await docker.getContainers();

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockDockerApi.listContainers).toHaveBeenCalledTimes(2);
    });
  });

  describe('OIDC Device Code Flow', () => {
    test('should not expose legacy OIDC passthrough helper methods', async () => {
      await docker.register('watcher', 'docker', 'test', createOidcConfig());

      expect(docker.getOidcGrantType).toBeUndefined();
      expect(docker.initializeRemoteOidcStateFromConfiguration).toBeUndefined();
      expect(docker.isRemoteOidcTokenRefreshRequired).toBeUndefined();
      expect(docker.applyRemoteOidcTokenPayload).toBeUndefined();
      expect(docker.performDeviceCodeFlow).toBeUndefined();
      expect(docker.handleTokenErrorResponse).toBeUndefined();
      expect(docker.pollDeviceCodeToken).toBeUndefined();
      expect(docker.refreshRemoteOidcAccessToken).toBeUndefined();
    });

    test('should validate configuration with device flow oidc settings', async () => {
      const config = createDeviceFlowConfig(
        { scope: 'docker.read' },
        { host: 'docker-proxy.example.com' },
      );
      expect(() => docker.validateConfiguration(config)).not.toThrow();
    });

    test('should auto-detect device_code grant type when deviceurl is configured', async () => {
      await docker.register('watcher', 'docker', 'test', createDeviceFlowConfig());

      const grantType = getOidcGrantType({
        configuredGrantType: docker.getOidcAuthString(OIDC_GRANT_TYPE_PATHS),
        refreshToken: docker.remoteOidcRefreshToken,
        deviceUrl: docker.getOidcAuthString(OIDC_DEVICE_URL_PATHS),
      });
      expect(grantType).toBe('urn:ietf:params:oauth:grant-type:device_code');
    });

    test('should prefer refresh_token grant over device_code when refresh token exists', async () => {
      await docker.register(
        'watcher',
        'docker',
        'test',
        createDeviceFlowConfig({
          refreshtoken: 'existing-refresh-token',
        }),
      );

      const context = createDockerOidcContext(docker);
      initializeRemoteOidcStateFromConfiguration(context);
      const grantType = getOidcGrantType({
        configuredGrantType: docker.getOidcAuthString(OIDC_GRANT_TYPE_PATHS),
        refreshToken: context.state.refreshToken,
        deviceUrl: docker.getOidcAuthString(OIDC_DEVICE_URL_PATHS),
      });
      expect(grantType).toBe('refresh_token');
    });

    test('should perform device code flow: request device code and poll for token', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);

      // First call: device authorization endpoint returns device_code
      // Second call: token endpoint returns authorization_pending
      // Third call: token endpoint returns access_token
      let postCallCount = 0;
      mockAxios.post.mockImplementation((url) => {
        postCallCount++;
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({ data: createDeviceCodeResponse() });
        }
        if (url === 'https://idp.example.com/oauth/token' && postCallCount === 2) {
          return Promise.reject({
            response: { data: { error: 'authorization_pending' } },
          });
        }
        return Promise.resolve({
          data: createTokenResponse({
            access_token: 'device-flow-token',
            refresh_token: 'device-flow-refresh',
          }),
        });
      });

      await docker.register(
        'watcher',
        'docker',
        'test',
        createDeviceFlowConfig({
          scope: 'docker.read',
        }),
      );

      // Mock sleep to avoid real delays in tests
      docker.sleep = vi.fn().mockResolvedValue(undefined);

      await docker.getContainers();

      // Verify device authorization request
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://idp.example.com/oauth/device/code',
        expect.stringContaining('client_id=dd-device-client'),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      // Verify token polling request included device_code
      const tokenCalls = mockAxios.post.mock.calls.filter(
        (call) => call[0] === 'https://idp.example.com/oauth/token',
      );
      expect(tokenCalls.length).toBeGreaterThanOrEqual(1);
      expect(tokenCalls[0][1]).toContain(
        'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code',
      );
      expect(tokenCalls[0][1]).toContain('device_code=device-code-123');

      // Verify the token was set
      expect(docker.remoteOidcAccessToken).toBe('device-flow-token');
      expect(docker.remoteOidcRefreshToken).toBe('device-flow-refresh');
      expect(docker.remoteOidcDeviceCodeCompleted).toBe(true);
      expect(mockDockerApi.modem.headers.Authorization).toBe('Bearer device-flow-token');
    });

    test('should handle slow_down error by increasing poll interval', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      let postCallCount = 0;
      mockAxios.post.mockImplementation((url) => {
        postCallCount++;
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({
            data: createDeviceCodeResponse({
              device_code: 'device-code-456',
              user_code: 'EFGH-5678',
            }),
          });
        }
        if (postCallCount === 2) {
          return Promise.reject({
            response: { data: { error: 'slow_down' } },
          });
        }
        return Promise.resolve({
          data: createTokenResponse({
            access_token: 'slow-down-token',
          }),
        });
      });

      await docker.register('watcher', 'docker', 'test', createDeviceFlowConfig());

      docker.sleep = vi.fn().mockResolvedValue(undefined);

      await docker.getContainers();

      // First sleep with original interval (1s), second with increased (1s + 5s = 6s)
      expect(docker.sleep).toHaveBeenCalledTimes(2);
      expect(docker.sleep).toHaveBeenNthCalledWith(1, 1000);
      expect(docker.sleep).toHaveBeenNthCalledWith(2, 6000);

      expect(docker.remoteOidcAccessToken).toBe('slow-down-token');
    });

    test('should cancel device code polling when watcher is deregistered during sleep', async () => {
      mockAxios.post.mockImplementation((url) => {
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({
            data: createDeviceCodeResponse({
              device_code: 'cancel-code',
              user_code: 'CANC-1234',
              interval: 1,
              expires_in: 60,
            }),
          });
        }
        return Promise.resolve({
          data: createTokenResponse({
            access_token: 'should-not-be-used',
          }),
        });
      });

      docker.name = 'test';
      docker.type = 'docker';
      docker.log = createMockLog(['info', 'warn', 'debug', 'error']);
      docker.configuration = docker.validateConfiguration(createDeviceFlowConfig()) as any;
      docker.dockerApi = mockDockerApi as any;

      docker.sleep = vi.fn().mockImplementation(async () => {
        await docker.deregisterComponent();
      });

      await expect(docker.ensureRemoteAuthHeaders()).rejects.toThrow(
        'cancelled because watcher was deregistered',
      );

      const tokenCalls = mockAxios.post.mock.calls.filter(
        (call) => call[0] === 'https://idp.example.com/oauth/token',
      );
      expect(tokenCalls).toHaveLength(0);
      expect(docker.remoteOidcAccessToken).toBeUndefined();
    });

    test.each([
      [
        'expired_token',
        'expired-device-code',
        'XXXX-0000',
        'device code expired before user authorization',
      ],
      ['access_denied', 'denied-device-code', 'DENY-0001', 'user denied the authorization request'],
    ])('should throw on %s error', async (errorCode, deviceCode, userCode, expectedMessage) => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockImplementation((url) => {
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({
            data: createDeviceCodeResponse({
              device_code: deviceCode,
              user_code: userCode,
            }),
          });
        }
        return Promise.reject({
          response: { data: { error: errorCode } },
        });
      });

      await docker.register('watcher', 'docker', 'test', createDeviceFlowConfig());

      docker.sleep = vi.fn().mockResolvedValue(undefined);

      await expect(docker.getContainers()).rejects.toThrow(expectedMessage);
    });

    test('should throw when device authorization endpoint returns no device_code', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockImplementation((url) => {
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({
            data: {
              // Missing device_code
              user_code: 'NO-CODE',
              verification_uri: 'https://idp.example.com/device',
            },
          });
        }
        return Promise.resolve({ data: {} });
      });

      await docker.register('watcher', 'docker', 'test', createDeviceFlowConfig());

      docker.sleep = vi.fn().mockResolvedValue(undefined);

      await expect(docker.getContainers()).rejects.toThrow('response does not contain device_code');
    });

    test('should fall back to client_credentials when deviceurl is missing but grant type is device_code', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockResolvedValue({
        data: createTokenResponse({
          access_token: 'fallback-cc-token',
          expires_in: 300,
        }),
      } as any);

      await docker.register(
        'watcher',
        'docker',
        'test',
        createOidcConfig({
          granttype: 'urn:ietf:params:oauth:grant-type:device_code',
          // No deviceurl configured
        }),
      );

      await docker.getContainers();

      // Should have fallen back to client_credentials
      const tokenRequestBody = mockAxios.post.mock.calls[0][1];
      expect(tokenRequestBody).toContain('grant_type=client_credentials');
      expect(docker.remoteOidcAccessToken).toBe('fallback-cc-token');
    });

    test('should log verification_uri_complete when provided by server', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockImplementation((url) => {
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({
            data: createDeviceCodeResponse({
              device_code: 'complete-uri-code',
              user_code: 'COMP-1234',
              verification_uri_complete: 'https://idp.example.com/device?user_code=COMP-1234',
            }),
          });
        }
        return Promise.resolve({
          data: createTokenResponse({
            access_token: 'complete-uri-token',
          }),
        });
      });

      await docker.register('watcher', 'docker', 'test', createDeviceFlowConfig());

      const mockLog = createMockLogWithChild();
      mockLog.child.mockReturnThis();
      docker.log = mockLog;
      docker.sleep = vi.fn().mockResolvedValue(undefined);

      await docker.ensureRemoteAuthHeaders();

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining(
          'visit https://idp.example.com/device?user_code=COMP-1234 to authorize this device',
        ),
      );
    });

    test('should send scope and audience in device authorization request', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockImplementation((url) => {
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({
            data: createDeviceCodeResponse({
              device_code: 'scoped-code',
              user_code: 'SCOP-1234',
            }),
          });
        }
        return Promise.resolve({
          data: createTokenResponse({
            access_token: 'scoped-token',
          }),
        });
      });

      await docker.register(
        'watcher',
        'docker',
        'test',
        createDeviceFlowConfig({
          scope: 'docker.read openid',
          audience: 'https://docker-api.example.com',
        }),
      );

      docker.sleep = vi.fn().mockResolvedValue(undefined);

      await docker.getContainers();

      // Verify the device authorization request included scope and audience
      const deviceCall = mockAxios.post.mock.calls.find(
        (call) => call[0] === 'https://idp.example.com/oauth/device/code',
      );
      expect(deviceCall).toBeDefined();
      const deviceBody = deviceCall[1];
      expect(deviceBody).toContain('scope=docker.read+openid');
      expect(deviceBody).toContain('audience=https%3A%2F%2Fdocker-api.example.com');
    });

    test('should use refresh_token for subsequent token refreshes after device code flow completes', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);

      // First call sequence: device flow
      let postCallCount = 0;
      mockAxios.post.mockImplementation((url) => {
        postCallCount++;
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({
            data: createDeviceCodeResponse({
              device_code: 'initial-device-code',
              user_code: 'INIT-0001',
            }),
          });
        }
        return Promise.resolve({
          data: createTokenResponse({
            access_token: 'device-token-1',
            refresh_token: 'device-refresh-1',
            expires_in: 1, // Expires almost immediately
          }),
        });
      });

      await docker.register('watcher', 'docker', 'test', createDeviceFlowConfig());

      docker.sleep = vi.fn().mockResolvedValue(undefined);

      // First getContainers triggers device flow
      await docker.getContainers();
      expect(docker.remoteOidcAccessToken).toBe('device-token-1');
      expect(docker.remoteOidcRefreshToken).toBe('device-refresh-1');

      // Force token to be expired so next call refreshes
      docker.remoteOidcAccessTokenExpiresAt = Date.now() - 1000;

      // Reset mock for the refresh call
      mockAxios.post.mockResolvedValue({
        data: createTokenResponse({
          access_token: 'refreshed-token-2',
          refresh_token: 'refreshed-refresh-2',
        }),
      } as any);

      await docker.getContainers();

      // The refresh should use refresh_token grant, not device_code
      const lastCall = mockAxios.post.mock.calls[mockAxios.post.mock.calls.length - 1];
      expect(lastCall[1]).toContain('grant_type=refresh_token');
      expect(lastCall[1]).toContain('refresh_token=device-refresh-1');
      expect(docker.remoteOidcAccessToken).toBe('refreshed-token-2');
    });
  });

  describe('Additional Coverage - applyRemoteAuthHeaders', () => {
    test('should keep remote watcher registered in blocked mode when credentials are incomplete', async () => {
      // Bypass validation by setting configuration directly after register
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      docker.configuration.auth = { type: '' };
      docker.initWatcher();
      expect(docker.remoteAuthBlockedReason).toBe(
        'Unable to authenticate remote watcher test: credentials are incomplete',
      );
    });

    test('should keep remote watcher registered in blocked mode when basic auth credentials are missing', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      // Need hasOidcConfig to bypass first guard, but authType=basic to reach the basic-incomplete path
      docker.configuration.auth = { type: 'basic', oidc: { tokenurl: 'https://idp/token' } };
      docker.initWatcher();
      expect(docker.remoteAuthBlockedReason).toBe(
        'Unable to authenticate remote watcher test: basic credentials are incomplete',
      );
    });

    test('should keep remote watcher registered in blocked mode when bearer token is missing', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      // Need hasOidcConfig to bypass first guard, but authType=bearer to reach the bearer-missing path
      docker.configuration.auth = { type: 'bearer', oidc: { tokenurl: 'https://idp/token' } };
      docker.initWatcher();
      expect(docker.remoteAuthBlockedReason).toBe(
        'Unable to authenticate remote watcher test: bearer token is missing',
      );
    });

    test('should keep remote watcher registered in blocked mode when auth type is unsupported', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      docker.configuration.auth = { type: 'custom', user: 'x', password: 'y' };
      docker.initWatcher();
      expect(docker.remoteAuthBlockedReason).toBe(
        'Unable to authenticate remote watcher test: auth type "custom" is unsupported',
      );
    });

    test('should warn and continue when auth.insecure=true and credentials are incomplete', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      docker.configuration.auth = { type: '', insecure: true };
      const logMock = createMockLog(['warn', 'info', 'debug']);
      docker.log = logMock;
      docker.initWatcher();
      expect(docker.remoteAuthBlockedReason).toBeUndefined();
      expect(logMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('continuing because auth.insecure=true'),
      );
    });

    test('should block getContainers when watcher auth is blocked', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      docker.configuration.auth = { type: '' };
      docker.initWatcher();
      mockDockerApi.listContainers.mockResolvedValue([]);

      await expect(docker.getContainers()).rejects.toThrow('credentials are incomplete');
      expect(mockDockerApi.listContainers).not.toHaveBeenCalled();
    });
  });

  describe('Additional Coverage - getRemoteAuthResolution auto-detect', () => {
    test('should auto-detect bearer, basic, and oidc auth types', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: { bearer: 'tok' },
      });
      expect(docker.getRemoteAuthResolution(docker.configuration.auth).authType).toBe('bearer');

      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: { user: 'j', password: 'd' },
      });
      expect(docker.getRemoteAuthResolution(docker.configuration.auth).authType).toBe('basic');

      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: { oidc: { tokenurl: 'https://idp/token' } },
      });
      expect(docker.getRemoteAuthResolution(docker.configuration.auth).authType).toBe('oidc');
    });
  });

  describe('Additional Coverage - OIDC edge cases', () => {
    test('should throw when token endpoint missing', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: { type: 'oidc', oidc: {} },
      });
      await expect(refreshRemoteOidcAccessToken(createDockerOidcContext(docker))).rejects.toThrow(
        'missing auth.oidc token endpoint',
      );
    });

    test('should fallback for missing refresh token and unsupported grant', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: { type: 'oidc', oidc: { tokenurl: 'https://idp/token', granttype: 'refresh_token' } },
      });
      const logMock = createMockLog(['warn', 'info', 'debug']);
      docker.log = logMock;
      await refreshRemoteOidcAccessToken(createDockerOidcContext(docker));
      expect(logMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('refresh token is missing'),
      );
    });

    test('should throw when token response has no access_token', async () => {
      mockAxios.post.mockResolvedValue({ data: {} } as any);
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: { type: 'oidc', oidc: { tokenurl: 'https://idp/token' } },
      });
      await expect(refreshRemoteOidcAccessToken(createDockerOidcContext(docker))).rejects.toThrow(
        'does not contain access_token',
      );
    });

    test('should fallback when grant type is unsupported', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: { type: 'oidc', oidc: { tokenurl: 'https://idp/token', granttype: 'custom_grant' } },
      });
      const logMock = createMockLog(['warn', 'info', 'debug']);
      docker.log = logMock;
      await refreshRemoteOidcAccessToken(createDockerOidcContext(docker));
      expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('unsupported'));
    });

    test('should include resource in token request', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: {
          type: 'oidc',
          oidc: {
            tokenurl: 'https://idp/token',
            clientid: 'c1',
            resource: 'https://api.example.com',
          },
        },
      });
      await docker.getContainers();
      expect(mockAxios.post.mock.calls[0][1]).toContain('resource=https%3A%2F%2Fapi.example.com');
    });
  });

  describe('Additional Coverage - maskConfiguration and ensureLogger', () => {
    test('should mask auth credentials', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
        auth: {
          type: 'oidc',
          oidc: {
            tokenurl: 'https://idp/token',
            clientsecret: 'super-secret',
            accesstoken: 'initial-token',
          },
        },
      });
      const masked = docker.maskConfiguration();
      expect(masked.auth.oidc.tokenurl).toBe('https://idp/token');
      expect(masked.auth.oidc.clientsecret).not.toBe('super-secret');
      expect(masked.authblocked).toBe(false);
      expect(masked.authblockedreason).toBeUndefined();
    });

    test('should expose blocked remote auth reason in masked configuration', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      docker.configuration.auth = { type: '' };
      docker.initWatcher();

      const masked = docker.maskConfiguration();
      expect(masked.authblocked).toBe(true);
      expect(masked.authblockedreason).toContain('credentials are incomplete');
    });

    test('should create fallback logger', async () => {
      docker.log = undefined;
      docker.name = undefined;
      docker.ensureLogger();
      expect(docker.log).toBeDefined();
    });
  });

  describe('Additional Coverage - setRemoteAuthorizationHeader', () => {
    test('should do nothing when authorization value is empty', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.setRemoteAuthorizationHeader('');
      // modem headers should not be set
      expect(docker.dockerApi.modem.headers.Authorization).toBeUndefined();
    });

    test('should create modem object when missing', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.dockerApi.modem = undefined;
      docker.setRemoteAuthorizationHeader('Bearer test-token');
      expect(docker.dockerApi.modem.headers.Authorization).toBe('Bearer test-token');
    });
  });

  describe('Additional Coverage - isRemoteOidcTokenRefreshRequired', () => {
    test('should return false when expiresAt is undefined but token exists', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.remoteOidcAccessToken = 'some-token';
      docker.remoteOidcAccessTokenExpiresAt = undefined;
      expect(
        isRemoteOidcTokenRefreshRequired({
          accessToken: docker.remoteOidcAccessToken,
          accessTokenExpiresAt: docker.remoteOidcAccessTokenExpiresAt,
        }),
      ).toBe(false);
    });
  });

  describe('Additional Coverage - OIDC token refresh additional params', () => {
    test('should include audience in token request', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      await docker.register(
        'watcher',
        'docker',
        'test',
        createOidcConfig({
          clientid: 'c1',
          audience: 'https://api.example.com',
        }),
      );
      await docker.getContainers();
      expect(mockAxios.post.mock.calls[0][1]).toContain('audience=https%3A%2F%2Fapi.example.com');
    });

    test('should store refresh token from token response', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockResolvedValue({
        data: createTokenResponse({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
      } as any);
      await docker.register('watcher', 'docker', 'test', createOidcConfig());
      await docker.getContainers();
      expect(docker.remoteOidcRefreshToken).toBe('new-refresh');
    });

    test('should use default TTL when expires_in is not in response', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockResolvedValue({
        data: { access_token: 'no-expiry-token' },
      } as any);
      await docker.register('watcher', 'docker', 'test', createOidcConfig());
      await docker.getContainers();
      expect(docker.remoteOidcAccessToken).toBe('no-expiry-token');
      expect(docker.remoteOidcAccessTokenExpiresAt).toBeDefined();
    });
  });

  describe('Additional Coverage - device code flow resource param', () => {
    test('should send resource in device authorization request', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockImplementation((url) => {
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({ data: createDeviceCodeResponse() });
        }
        return Promise.resolve({ data: createTokenResponse() });
      });
      await docker.register(
        'watcher',
        'docker',
        'test',
        createDeviceFlowConfig({
          resource: 'https://resource.example.com',
        }),
      );
      docker.sleep = vi.fn().mockResolvedValue(undefined);
      await docker.getContainers();
      const deviceCall = mockAxios.post.mock.calls.find(
        (call) => call[0] === 'https://idp.example.com/oauth/device/code',
      );
      expect(deviceCall[1]).toContain('resource=https%3A%2F%2Fresource.example.com');
    });

    test('should send client_secret in device code token poll', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockImplementation((url) => {
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({ data: createDeviceCodeResponse() });
        }
        return Promise.resolve({ data: createTokenResponse() });
      });
      await docker.register(
        'watcher',
        'docker',
        'test',
        createDeviceFlowConfig({
          clientsecret: 'device-secret',
        }),
      );
      docker.sleep = vi.fn().mockResolvedValue(undefined);
      await docker.getContainers();
      const tokenCall = mockAxios.post.mock.calls.find(
        (call) => call[0] === 'https://idp.example.com/oauth/token',
      );
      expect(tokenCall[1]).toContain('client_secret=device-secret');
    });
  });

  describe('Additional Coverage - device code flow timeout', () => {
    test('should throw when polling times out', async () => {
      await docker.register('watcher', 'docker', 'test', createDeviceFlowConfig());
      // Directly call pollDeviceCodeToken with a very short timeout so it exits immediately
      docker.sleep = vi.fn().mockResolvedValue(undefined);
      mockAxios.post.mockRejectedValue({ response: { data: { error: 'authorization_pending' } } });
      const context = createDockerOidcContext(docker);
      await expect(
        pollDeviceCodeToken(context, {
          tokenEndpoint: 'https://idp.example.com/oauth/token',
          deviceCode: 'device-code',
          clientId: 'client',
          clientSecret: undefined,
          timeout: undefined,
          pollIntervalMs: 1,
          pollTimeoutMs: 0,
        }),
      ).rejects.toThrow('polling timed out');
    });
  });

  describe('Additional Coverage - device code unknown error', () => {
    test('should throw with error description for unknown token errors', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockImplementation((url) => {
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({ data: createDeviceCodeResponse() });
        }
        return Promise.reject({
          response: { data: { error: 'server_error', error_description: 'Internal server error' } },
        });
      });
      await docker.register('watcher', 'docker', 'test', createDeviceFlowConfig());
      docker.sleep = vi.fn().mockResolvedValue(undefined);
      await expect(docker.getContainers()).rejects.toThrow('Internal server error');
    });
  });

  describe('Additional Coverage - ensureRemoteAuthHeaders no token', () => {
    test('should throw when no OIDC access token available after refresh', async () => {
      await docker.register('watcher', 'docker', 'test', createOidcConfig());
      mockAxios.post.mockResolvedValue({ data: {} } as any);
      docker.remoteOidcAccessToken = undefined;
      await expect(docker.ensureRemoteAuthHeaders()).rejects.toThrow(
        'token endpoint response does not contain access_token',
      );
    });
  });

  describe('Additional Coverage - device code flow log fallback', () => {
    test('should log generic info when verification_uri and user_code are missing', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      mockAxios.post.mockImplementation((url) => {
        if (url === 'https://idp.example.com/oauth/device/code') {
          return Promise.resolve({
            data: {
              device_code: 'code-no-uri',
              // No user_code, no verification_uri
            },
          });
        }
        return Promise.resolve({ data: createTokenResponse() });
      });
      await docker.register('watcher', 'docker', 'test', createDeviceFlowConfig());
      const mockLog = createMockLogWithChild();
      mockLog.child.mockReturnThis();
      docker.log = mockLog;
      docker.sleep = vi.fn().mockResolvedValue(undefined);
      await docker.ensureRemoteAuthHeaders();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('user_code=N/A'));
    });
  });

  describe('Additional Coverage - OIDC custom timeout', () => {
    test('should use custom timeout in token request', async () => {
      mockDockerApi.listContainers.mockResolvedValue([]);
      await docker.register(
        'watcher',
        'docker',
        'test',
        createOidcConfig({
          timeout: 10000,
        }),
      );
      await docker.getContainers();
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ timeout: 10000 }),
      );
    });
  });

  describe('Additional Coverage - normalizeConfigNumberValue string parsing', () => {
    test('should parse string number values in OIDC expires_in config', async () => {
      await docker.register(
        'watcher',
        'docker',
        'test',
        createOidcConfig({
          expiresin: '600',
          accesstoken: 'string-expires-token',
        }),
      );
      initializeRemoteOidcStateFromConfiguration(createDockerOidcContext(docker));
      expect(docker.remoteOidcAccessTokenExpiresAt).toBeDefined();
    });
  });

  describe('Additional Coverage - OIDC edge branches', () => {
    test('applyRemoteOidcTokenPayload should return false when access token is missing and allowed', () => {
      const applied = applyRemoteOidcTokenPayload(
        createDockerOidcStateAdapter(docker),
        {},
        {
          watcherName: docker.name,
          normalizeNumber: testable_normalizeConfigNumberValue,
          allowMissingAccessToken: true,
        },
      );
      expect(applied).toBe(false);
    });

    test('pollDeviceCodeToken should continue polling when access token is missing in first response', async () => {
      docker.name = 'test';
      docker.sleep = vi.fn().mockResolvedValue(undefined);
      mockAxios.post
        .mockResolvedValueOnce({
          data: {},
        })
        .mockResolvedValueOnce({
          data: {
            access_token: 'device-token',
            expires_in: 60,
          },
        });

      await pollDeviceCodeToken(createDockerOidcContext(docker), {
        tokenEndpoint: 'https://idp.example.com/token',
        deviceCode: 'device-code',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        timeout: 1000,
        pollIntervalMs: 1,
        pollTimeoutMs: 1000,
      });

      expect(docker.sleep).toHaveBeenCalledTimes(2);
      expect(docker.remoteOidcAccessToken).toBe('device-token');
    });

    test('sleep should resolve after timeout', async () => {
      vi.useFakeTimers();
      try {
        const sleepPromise = docker.sleep(25);
        await vi.advanceTimersByTimeAsync(25);
        await expect(sleepPromise).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('getOidcAuthConfiguration should return empty object when auth config is missing', () => {
      docker.configuration = {};
      expect(docker.getOidcAuthConfiguration()).toEqual({});
    });

    test('refreshRemoteOidcAccessToken should treat missing token payload as empty object', async () => {
      docker.name = 'test';
      docker.configuration = createOidcConfig();
      mockAxios.post.mockResolvedValue(undefined as any);

      await expect(refreshRemoteOidcAccessToken(createDockerOidcContext(docker))).rejects.toThrow(
        'token endpoint response does not contain access_token',
      );
    });

    test('performDeviceCodeFlow should treat missing device payload as empty object', async () => {
      docker.name = 'test';
      mockAxios.post.mockResolvedValue(undefined as any);

      await expect(
        performDeviceCodeFlow(
          createDockerOidcContext(docker),
          'https://idp.example.com/device/code',
          {
            tokenEndpoint: 'https://idp.example.com/token',
            clientId: 'client-id',
            clientSecret: 'client-secret',
            scope: undefined,
            audience: undefined,
            resource: undefined,
            timeout: 1000,
          },
        ),
      ).rejects.toThrow('response does not contain device_code');
    });

    test('handleTokenErrorResponse should fallback to error.message when response payload is missing', () => {
      docker.name = 'test';
      expect(() =>
        handleTokenErrorResponse(new Error('network down'), 1000, {
          watcherName: docker.name,
          log: docker.log,
        }),
      ).toThrow('failed: network down');
    });

    test('pollDeviceCodeToken should continue when first token response is undefined', async () => {
      docker.name = 'test';
      docker.sleep = vi.fn().mockResolvedValue(undefined);
      mockAxios.post.mockResolvedValueOnce(undefined as any).mockResolvedValueOnce({
        data: {
          access_token: 'device-token-2',
          expires_in: 60,
        },
      });

      await pollDeviceCodeToken(createDockerOidcContext(docker), {
        tokenEndpoint: 'https://idp.example.com/token',
        deviceCode: 'device-code',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        timeout: 1000,
        pollIntervalMs: 1,
        pollTimeoutMs: 1000,
      });

      expect(docker.remoteOidcAccessToken).toBe('device-token-2');
    });

    test('ensureRemoteAuthHeaders should return early for non-oidc auth type', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'docker-api.example.com',
        protocol: 'https',
        auth: {
          type: 'basic',
          user: 'user',
          password: 'password',
        },
      });
      mockAxios.post.mockClear();

      await docker.ensureRemoteAuthHeaders();

      expect(mockAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('Additional Coverage - ensureLogger catch block', () => {
    test('should create stderr fallback logger when log.child throws', async () => {
      docker.log = undefined;
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const loggerInitFailureCounter = {
        labels: vi.fn().mockReturnValue({ inc: vi.fn() }),
      };
      mockPrometheus.getLoggerInitFailureCounter.mockReturnValue(loggerInitFailureCounter);
      const originalModule = await import('../../../log/index.js');
      const origChild = originalModule.default.child;
      try {
        originalModule.default.child = () => {
          throw new Error('log init failed');
        };

        docker.ensureLogger();

        expect(docker.log).toBeDefined();
        docker.log.info('test');
        docker.log.warn('test');
        docker.log.error('test');
        docker.log.debug('test');
        docker.log.child({ scope: 'child' }).warn('child-test');

        expect(loggerInitFailureCounter.labels).toHaveBeenCalledWith({
          type: 'docker',
          name: 'default',
        });
        expect(stderrSpy).toHaveBeenCalled();

        const firstPayload = JSON.parse(`${stderrSpy.mock.calls[0][0]}`);
        expect(firstPayload.level).toBe('error');
        expect(firstPayload.msg).toContain('Failed to initialize watcher logger');
        expect(firstPayload.fallback).toBe('stderr-json');

        const childPayload = JSON.parse(
          `${stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1][0]}`,
        );
        expect(childPayload.scope).toBe('child');
      } finally {
        originalModule.default.child = origChild;
        stderrSpy.mockRestore();
      }
    });
  });
});

describe('isDigestToWatch Logic', () => {
  let docker;
  let mockImage;

  beforeEach(async () => {
    // Setup dockerode mock
    const mockDockerApi = {
      getImage: vi.fn(),
    };
    mockDockerode.mockImplementation(mockConstructor(mockDockerApi));

    mockImage = {
      inspect: vi.fn(),
    };
    mockDockerApi.getImage.mockReturnValue(mockImage);

    // Setup store mock
    storeContainer.getContainer.mockReturnValue(undefined);
    storeContainer.insertContainer.mockImplementation((c) => c);
    storeContainer.updateContainer.mockImplementation((c) => c);

    // Setup registry mock
    registry.getState.mockReturnValue({ registry: {} });

    // Setup event mock
    event.emitContainerReport.mockImplementation(() => {});

    // Setup prometheus mock
    const mockGauge = { set: vi.fn() };
    mockPrometheus.getWatchContainerGauge.mockReturnValue(mockGauge);

    // Setup fullName mock
    fullName.mockReturnValue('test_container');

    docker = new Docker();
    docker.name = 'test';
    docker.dockerApi = mockDockerApi;
    docker.ensureLogger();
  });

  // Helper to setup the environment for addImageDetailsToContainer
  const setupTest = async (labels, domain, tag, isSemver = false) => {
    const container = {
      Id: '123',
      Image: `${domain ? `${domain}/` : ''}repo/image:${tag}`,
      Names: ['/test'],
      State: 'running',
      Labels: labels || {},
    };
    const imageDetails = {
      Id: 'image123',
      Architecture: 'amd64',
      Os: 'linux',
      Created: '2023-01-01',
      RepoDigests: ['repo/image@sha256:abc'],
      RepoTags: [`${domain ? `${domain}/` : ''}repo/image:${tag}`],
    };
    mockImage.inspect.mockResolvedValue(imageDetails);
    // Mock parse to return appropriate structure
    mockParse.mockReturnValue({
      domain: domain,
      path: 'repo/image',
      tag: tag,
    });

    // Mock semver check
    if (isSemver) {
      mockTag.parse.mockReturnValue({ major: 1, minor: 0, patch: 0 });
    } else {
      mockTag.parse.mockReturnValue(null);
    }

    const mockRegistry = {
      normalizeImage: vi.fn((img) => img),
      getId: () => 'registry',
      match: () => true,
    };
    registry.getState.mockReturnValue({
      registry: { registry: mockRegistry },
    });

    const containerModule = await import('../../../model/container.js');
    const validateContainer = containerModule.validate;
    // @ts-expect-error
    validateContainer.mockImplementation((c) => c);

    return container;
  };

  // Case 1: Explicit Label present - label value always wins regardless of semver
  test.each([
    ['true', 'my.registry', '1.0.0', true, true, 'label=true, semver'],
    ['true', 'my.registry', 'latest', false, true, 'label=true, non-semver'],
    ['false', 'my.registry', '1.0.0', true, false, 'label=false, semver'],
    ['false', 'my.registry', 'latest', false, false, 'label=false, non-semver'],
  ])('should respect explicit dd.watch.digest=%s (%s)', async (labelValue, domain, tag, isSemver, expected) => {
    const container = await setupTest({ 'dd.watch.digest': labelValue }, domain, tag, isSemver);
    const result = await docker.addImageDetailsToContainer(container);
    expect(result.image.digest.watch).toBe(expected);
  });

  // Case 2: Semver (no label) -> default false
  test.each([
    ['my.registry', 'Custom Registry'],
    ['docker.io', 'Docker Hub'],
  ])('should NOT watch digest by default for semver images (%s)', async (domain) => {
    const container = await setupTest({}, domain, '1.0.0', true);
    const result = await docker.addImageDetailsToContainer(container);
    expect(result.image.digest.watch).toBe(false);
  });

  // Case 3: Non-Semver (no label) -> default true, EXCEPT Docker Hub
  test('should watch digest by default for non-semver images (Custom Registry)', async () => {
    const container = await setupTest({}, 'my.registry', 'latest', false);
    const result = await docker.addImageDetailsToContainer(container);
    expect(result.image.digest.watch).toBe(true);
  });

  test.each([
    ['docker.io', 'Docker Hub Explicit'],
    ['registry-1.docker.io', 'Docker Hub Registry-1'],
    [undefined, 'Docker Hub Implicit'],
  ])('should NOT watch digest by default for non-semver images (%s)', async (domain) => {
    const container = await setupTest({}, domain, 'latest', false);
    const result = await docker.addImageDetailsToContainer(container);
    expect(result.image.digest.watch).toBe(false);
  });
});
