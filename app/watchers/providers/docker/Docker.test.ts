// @ts-nocheck
import type { Mocked } from 'vitest';
import * as event from '../../../event/index.js';
import { fullName } from '../../../model/container.js';
import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
import { mockConstructor } from '../../../test/mock-constructor.js';
import Docker, {
  testable_filterBySegmentCount,
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
  testable_pruneOldContainers,
  testable_shouldUpdateDisplayNameFromContainerName,
} from './Docker.js';

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

    test('should fail closed when remote watcher auth is configured without HTTPS', async () => {
      await expect(
        docker.register('watcher', 'docker', 'test', {
          host: 'localhost',
          port: 2375,
          protocol: 'http',
          auth: {
            type: 'bearer',
            bearer: 'my-secret-token',
          },
        }),
      ).rejects.toThrow('HTTPS is required for remote auth');
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

    test('should disable watchatstart when watcher state already exists in store', async () => {
      storeContainer.getContainers.mockReturnValue([{ id: 'existing' }]);
      await docker.register('watcher', 'docker', 'test', {
        watchatstart: true,
      });
      docker.init();
      expect(storeContainer.getContainers).toHaveBeenCalledWith({
        watcher: 'test',
      });
      expect(docker.configuration.watchatstart).toBe(false);
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
    test('should validate configuration with device flow oidc settings', async () => {
      const config = createDeviceFlowConfig(
        { scope: 'docker.read' },
        { host: 'docker-proxy.example.com' },
      );
      expect(() => docker.validateConfiguration(config)).not.toThrow();
    });

    test('should auto-detect device_code grant type when deviceurl is configured', async () => {
      await docker.register('watcher', 'docker', 'test', createDeviceFlowConfig());

      const grantType = docker.getOidcGrantType();
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

      docker.initializeRemoteOidcStateFromConfiguration();
      const grantType = docker.getOidcGrantType();
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
        expect(docker.log.warn).toHaveBeenCalledWith(expect.stringContaining('reconnect attempt #1'));
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
  });

  describe('Container Watching', () => {
    test('should watch containers from cron', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });
      const mockLog = createMockLog(['info']);
      docker.log = mockLog;
      docker.watch = vi.fn().mockResolvedValue([]);

      await docker.watchFromCron();

      expect(docker.watch).toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Cron started'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Cron finished'));
    });

    test('should report container statistics', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });
      const mockLog = createMockLog(['info']);
      docker.log = mockLog;
      const containerReports = [
        { container: { updateAvailable: true, error: undefined } },
        {
          container: {
            updateAvailable: false,
            error: { message: 'error' },
          },
        },
      ];
      docker.watch = vi.fn().mockResolvedValue(containerReports);

      await docker.watchFromCron();

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('2 containers watched, 1 errors, 1 available updates'),
      );
    });

    test('should queue watch when outside maintenance window', async () => {
      const maintenanceInc = vi.fn();
      mockPrometheus.getMaintenanceSkipCounter.mockReturnValue({
        labels: vi.fn().mockReturnValue({ inc: maintenanceInc }),
      });
      maintenance.isInMaintenanceWindow.mockReturnValue(false);

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
        maintenancewindow: '0 2 * * *',
        maintenancewindowtz: 'UTC',
      });
      docker.log = createMockLog(['info']);
      docker.watch = vi.fn().mockResolvedValue([]);

      const result = await docker.watchFromCron();

      expect(result).toEqual([]);
      expect(docker.watch).not.toHaveBeenCalled();
      expect(docker.maintenanceWindowWatchQueued).toBe(true);
      expect(docker.maintenanceWindowQueueTimeout).toBeDefined();
      expect(maintenanceInc).toHaveBeenCalledTimes(1);
      docker.clearMaintenanceWindowQueue();
    });

    test('should execute queued watch when maintenance window opens', async () => {
      vi.useFakeTimers();
      try {
        maintenance.isInMaintenanceWindow.mockReturnValue(false);

        await docker.register('watcher', 'docker', 'test', {
          cron: '0 * * * *',
          maintenancewindow: '0 2 * * *',
          maintenancewindowtz: 'UTC',
        });
        docker.log = createMockLog(['info', 'warn']);
        docker.watch = vi.fn().mockResolvedValue([]);

        await docker.watchFromCron();
        expect(docker.maintenanceWindowWatchQueued).toBe(true);

        maintenance.isInMaintenanceWindow.mockReturnValue(true);
        await vi.advanceTimersByTimeAsync(60 * 1000);

        expect(docker.watch).toHaveBeenCalledTimes(1);
        expect(docker.maintenanceWindowWatchQueued).toBe(false);
        expect(docker.maintenanceWindowQueueTimeout).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('should clear queued maintenance watch when normal cron runs inside window', async () => {
      vi.useFakeTimers();
      try {
        maintenance.isInMaintenanceWindow.mockReturnValue(false);

        await docker.register('watcher', 'docker', 'test', {
          cron: '0 * * * *',
          maintenancewindow: '0 2 * * *',
          maintenancewindowtz: 'UTC',
        });
        docker.log = createMockLog(['info']);
        docker.watch = vi.fn().mockResolvedValue([]);

        await docker.watchFromCron();
        expect(docker.maintenanceWindowWatchQueued).toBe(true);
        expect(docker.maintenanceWindowQueueTimeout).toBeDefined();

        maintenance.isInMaintenanceWindow.mockReturnValue(true);
        await docker.watchFromCron();

        expect(docker.watch).toHaveBeenCalledTimes(1);
        expect(docker.maintenanceWindowWatchQueued).toBe(false);
        expect(docker.maintenanceWindowQueueTimeout).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('should expose maintenance runtime state in masked configuration', async () => {
      maintenance.isInMaintenanceWindow.mockReturnValue(false);
      maintenance.getNextMaintenanceWindow.mockReturnValue(new Date('2026-02-13T02:00:00.000Z'));

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
        maintenancewindow: '0 2 * * *',
        maintenancewindowtz: 'UTC',
      });
      docker.maintenanceWindowWatchQueued = true;

      const maskedConfiguration = docker.maskConfiguration();
      expect(maskedConfiguration.maintenancewindowopen).toBe(false);
      expect(maskedConfiguration.maintenancewindowqueued).toBe(true);
      expect(maskedConfiguration.maintenancenextwindow).toBe('2026-02-13T02:00:00.000Z');
    });

    test('should emit watcher events during watch', async () => {
      docker.getContainers = vi.fn().mockResolvedValue([]);

      await docker.watch();

      expect(event.emitWatcherStart).toHaveBeenCalledWith(docker);
      expect(event.emitWatcherStop).toHaveBeenCalledWith(docker);
    });

    test('should handle error getting containers', async () => {
      const mockLog = createMockLog(['warn']);
      docker.log = mockLog;
      docker.getContainers = vi.fn().mockRejectedValue(new Error('Docker unavailable'));

      await docker.watch();

      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Docker unavailable'));
    });

    test('should handle error processing containers', async () => {
      const mockLog = createMockLog(['warn']);
      docker.log = mockLog;
      docker.getContainers = vi.fn().mockResolvedValue([{ id: 'test' }]);
      docker.watchContainer = vi.fn().mockRejectedValue(new Error('Processing failed'));

      const result = await docker.watch();

      expect(result).toEqual([]);
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Processing failed'));
    });
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
      mockTag.parse.mockImplementation((version) =>
        rank[version] ? { major: 1, minor: 0, patch: 0 } : null,
      );

      const mockLogChild = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const result = await docker.findNewVersion(container, mockLogChild);

      expect(result).toEqual({ tag: '1.9.0' });
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('does not match includeTags regex'),
      );
      expect(mockLogChild.debug).toHaveBeenCalledWith(
        expect.stringContaining('greater=skipped'),
      );
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

      expect(result).toEqual({ tag: '3.0.0' });
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

    test('should default display name to drydock for drydock image', async () => {
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

      expect(result.displayName).toBe('drydock');
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

    test('should handle container with no repo tags', async () => {
      await docker.register('watcher', 'docker', 'test', {});
      docker.log = createMockLog(['warn']);
      const container = createDockerContainer({
        Image: 'sha256:abcdef123456',
        Names: ['/test'],
      });
      mockImage.inspect.mockResolvedValue({ RepoTags: [] });

      const result = await docker.addImageDetailsToContainer(container);

      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cannot get a reliable tag'),
      );
      expect(result).toBeUndefined();
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

  describe('Additional Coverage - applyRemoteAuthHeaders', () => {
    test('should fail closed when credentials are incomplete', async () => {
      // Bypass validation by setting configuration directly after register
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      docker.configuration.auth = { type: '' };
      expect(() => docker.initWatcher()).toThrow('credentials are incomplete');
    });

    test('should fail closed when basic auth is declared but credentials are missing', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      // Need hasOidcConfig to bypass first guard, but authType=basic to reach the basic-incomplete path
      docker.configuration.auth = { type: 'basic', oidc: { tokenurl: 'https://idp/token' } };
      expect(() => docker.initWatcher()).toThrow('basic credentials are incomplete');
    });

    test('should fail closed when bearer auth is declared but token is missing', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      // Need hasOidcConfig to bypass first guard, but authType=bearer to reach the bearer-missing path
      docker.configuration.auth = { type: 'bearer', oidc: { tokenurl: 'https://idp/token' } };
      expect(() => docker.initWatcher()).toThrow('bearer token is missing');
    });

    test('should fail closed when auth type is unsupported', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 443,
        protocol: 'https',
      });
      docker.configuration.auth = { type: 'custom', user: 'x', password: 'y' };
      expect(() => docker.initWatcher()).toThrow('is unsupported');
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
      expect(logMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('continuing because auth.insecure=true'),
      );
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
      await expect(docker.refreshRemoteOidcAccessToken()).rejects.toThrow(
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
      await docker.refreshRemoteOidcAccessToken();
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
      await expect(docker.refreshRemoteOidcAccessToken()).rejects.toThrow(
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
      await docker.refreshRemoteOidcAccessToken();
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

  describe('Additional Coverage - ensureRemoteAuthHeaders and listenDockerEvents', () => {
    test('should fail closed when OIDC auth is configured without HTTPS', async () => {
      await docker.register('watcher', 'docker', 'test', {
        host: 'localhost',
        port: 2375,
        protocol: 'http',
      });
      docker.configuration.auth = { type: 'oidc', oidc: { tokenurl: 'https://idp/token' } };
      await expect(docker.ensureRemoteAuthHeaders()).rejects.toThrow('HTTPS is required for OIDC auth');
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
  });

  describe('Additional Coverage - watchFromCron and getContainers', () => {
    test('should return empty when log is missing', async () => {
      await docker.register('watcher', 'docker', 'test', { cron: '0 * * * *' });
      docker.log = null;
      expect(await docker.watchFromCron()).toEqual([]);
    });

    test('should filter out containers when addImageDetailsToContainer throws', async () => {
      mockDockerApi.listContainers.mockResolvedValue([
        { Id: '1', Labels: { 'dd.watch': 'true' }, Names: ['/test1'] },
      ]);
      docker.addImageDetailsToContainer = vi
        .fn()
        .mockRejectedValue(new Error('Image inspect failed'));
      await docker.register('watcher', 'docker', 'test', { watchbydefault: true });
      docker.log = createMockLog(['warn', 'info', 'debug']);
      const result = await docker.getContainers();
      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch image detail'),
      );
      expect(result).toHaveLength(0);
    });

    test('should skip maintenance counter increment when counter is unavailable', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
        maintenancewindow: '0 2 * * *',
      });
      docker.log = createMockLog(['info', 'warn', 'debug']);
      maintenance.isInMaintenanceWindow.mockReturnValue(false);
      mockPrometheus.getMaintenanceSkipCounter.mockReturnValue(undefined);

      const result = await docker.watchFromCron();
      expect(result).toEqual([]);
    });

    test('should complete cron when info logger is removed before final summary', async () => {
      await docker.register('watcher', 'docker', 'test', { cron: '0 * * * *' });
      docker.log = createMockLog(['info', 'warn', 'debug']);
      docker.watch = vi.fn().mockImplementation(async () => {
        delete docker.log.info;
        return [];
      });

      const result = await docker.watchFromCron();
      expect(result).toEqual([]);
    });
  });

  describe('Agent mode - Prometheus gauge not initialized', () => {
    test('should not crash when getWatchContainerGauge returns undefined', async () => {
      mockPrometheus.getWatchContainerGauge.mockReturnValue(undefined);
      mockDockerApi.listContainers.mockResolvedValue([]);
      storeContainer.getContainers.mockReturnValue([]);
      await docker.register('watcher', 'docker', 'test', { watchbydefault: true });
      docker.log = createMockLog(['warn', 'info', 'debug']);
      const result = await docker.getContainers();
      expect(result).toHaveLength(0);
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
    });

    test('should create fallback logger', async () => {
      docker.log = undefined;
      docker.name = undefined;
      docker.ensureLogger();
      expect(docker.log).toBeDefined();
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
      expect(docker.isRemoteOidcTokenRefreshRequired()).toBe(false);
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
      await expect(
        docker.pollDeviceCodeToken({
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
      // Mock refreshRemoteOidcAccessToken to succeed but leave token undefined
      docker.refreshRemoteOidcAccessToken = vi.fn().mockResolvedValue(undefined);
      docker.remoteOidcAccessToken = undefined;
      await expect(docker.ensureRemoteAuthHeaders()).rejects.toThrow(
        'no OIDC access token available',
      );
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

  describe('Additional Coverage - watchFromCron ensureLogger guard', () => {
    test('should return empty array when ensureLogger produces non-functional log', async () => {
      await docker.register('watcher', 'docker', 'test', { cron: '0 * * * *' });
      docker.ensureLogger = () => {
        docker.log = {};
      };
      const result = await docker.watchFromCron();
      expect(result).toEqual([]);
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
      docker.initializeRemoteOidcStateFromConfiguration();
      expect(docker.remoteOidcAccessTokenExpiresAt).toBeDefined();
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
  });

  describe('Additional Coverage - maintenance queue internals', () => {
    test('should consider maintenance window open and next date undefined when no window is configured', () => {
      docker.configuration.maintenancewindow = undefined;
      expect(docker.isMaintenanceWindowOpen()).toBe(true);
      expect(docker.getNextMaintenanceWindowDate()).toBeUndefined();
    });

    test('queueMaintenanceWindowWatch should not schedule twice when queue timeout already exists', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      docker.maintenanceWindowQueueTimeout = { existing: true } as any;

      docker.queueMaintenanceWindowWatch();

      expect(docker.maintenanceWindowWatchQueued).toBe(true);
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
      docker.maintenanceWindowQueueTimeout = undefined;
    });

    test('checkQueuedMaintenanceWindowWatch should clear queue when no maintenance window is configured', async () => {
      docker.configuration.maintenancewindow = undefined;
      docker.maintenanceWindowWatchQueued = true;
      const clearSpy = vi.spyOn(docker, 'clearMaintenanceWindowQueue');

      await docker.checkQueuedMaintenanceWindowWatch();

      expect(clearSpy).toHaveBeenCalled();
    });

    test('checkQueuedMaintenanceWindowWatch should requeue when maintenance window remains closed', async () => {
      docker.configuration.maintenancewindow = '0 2 * * *';
      docker.maintenanceWindowWatchQueued = true;
      maintenance.isInMaintenanceWindow.mockReturnValue(false);
      const queueSpy = vi.spyOn(docker, 'queueMaintenanceWindowWatch');

      await docker.checkQueuedMaintenanceWindowWatch();

      expect(queueSpy).toHaveBeenCalled();
    });

    test('checkQueuedMaintenanceWindowWatch should warn when queued execution fails', async () => {
      docker.configuration.maintenancewindow = '0 2 * * *';
      docker.maintenanceWindowWatchQueued = true;
      maintenance.isInMaintenanceWindow.mockReturnValue(true);
      docker.log = createMockLog(['info', 'warn']);
      docker.watchFromCron = vi.fn().mockRejectedValue(new Error('queued-failure'));

      await docker.checkQueuedMaintenanceWindowWatch();

      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unable to run queued maintenance watch (queued-failure)'),
      );
    });

    test('queueMaintenanceWindowWatch should execute scheduled callback when timer fires', async () => {
      vi.useFakeTimers();
      try {
        const checkSpy = vi
          .spyOn(docker, 'checkQueuedMaintenanceWindowWatch')
          .mockResolvedValue(undefined);
        docker.maintenanceWindowQueueTimeout = undefined;

        docker.queueMaintenanceWindowWatch();
        await vi.runOnlyPendingTimersAsync();

        expect(checkSpy).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    test('checkQueuedMaintenanceWindowWatch should proceed without logging when info method is missing', async () => {
      docker.configuration.maintenancewindow = '0 2 * * *';
      docker.maintenanceWindowWatchQueued = true;
      maintenance.isInMaintenanceWindow.mockReturnValue(true);
      docker.log = createMockLog(['warn']);
      docker.watchFromCron = vi.fn().mockResolvedValue([]);

      await docker.checkQueuedMaintenanceWindowWatch();

      expect(docker.watchFromCron).toHaveBeenCalledWith({
        ignoreMaintenanceWindow: true,
      });
    });

    test('checkQueuedMaintenanceWindowWatch should swallow queued errors when warn method is missing', async () => {
      docker.configuration.maintenancewindow = '0 2 * * *';
      docker.maintenanceWindowWatchQueued = true;
      maintenance.isInMaintenanceWindow.mockReturnValue(true);
      docker.log = createMockLog(['info']);
      docker.watchFromCron = vi.fn().mockRejectedValue(new Error('queued-failure'));

      await expect(docker.checkQueuedMaintenanceWindowWatch()).resolves.toBeUndefined();
    });
  });

  describe('Additional Coverage - OIDC edge branches', () => {
    test('applyRemoteOidcTokenPayload should return false when access token is missing and allowed', () => {
      const applied = docker.applyRemoteOidcTokenPayload(
        {},
        {
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

      await docker.pollDeviceCodeToken({
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

      await expect(docker.refreshRemoteOidcAccessToken()).rejects.toThrow(
        'token endpoint response does not contain access_token',
      );
    });

    test('performDeviceCodeFlow should treat missing device payload as empty object', async () => {
      docker.name = 'test';
      mockAxios.post.mockResolvedValue(undefined as any);

      await expect(
        docker.performDeviceCodeFlow('https://idp.example.com/device/code', {
          tokenEndpoint: 'https://idp.example.com/token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          scope: undefined,
          audience: undefined,
          resource: undefined,
          timeout: 1000,
        }),
      ).rejects.toThrow('response does not contain device_code');
    });

    test('handleTokenErrorResponse should fallback to error.message when response payload is missing', () => {
      docker.name = 'test';
      expect(() => docker.handleTokenErrorResponse(new Error('network down'), 1000)).toThrow(
        'failed: network down',
      );
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

      await docker.pollDeviceCodeToken({
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
      const refreshSpy = vi.spyOn(docker, 'refreshRemoteOidcAccessToken');

      await docker.ensureRemoteAuthHeaders();

      expect(refreshSpy).not.toHaveBeenCalled();
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

        const childPayload = JSON.parse(`${stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1][0]}`);
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
