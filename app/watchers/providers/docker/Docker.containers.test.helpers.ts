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

export type DockerContainersTestState = {
  docker: Docker;
  mockDockerApi: {
    listContainers: ReturnType<typeof vi.fn>;
    getContainer: ReturnType<typeof vi.fn>;
    getEvents: ReturnType<typeof vi.fn>;
    getImage: ReturnType<typeof vi.fn>;
    getService: ReturnType<typeof vi.fn>;
    modem: {
      headers: Record<string, unknown>;
    };
  };
  mockSchedule: {
    stop: ReturnType<typeof vi.fn>;
  };
  mockContainer: {
    inspect: ReturnType<typeof vi.fn>;
  };
  mockImage: {
    inspect: ReturnType<typeof vi.fn>;
  };
};

export function setupDockerWatcherContainerSuite(
  assignState: (state: DockerContainersTestState) => void,
) {
  let docker: Docker;
  let mockDockerApi: DockerContainersTestState['mockDockerApi'];
  let mockSchedule: DockerContainersTestState['mockSchedule'];
  let mockContainer: DockerContainersTestState['mockContainer'];
  let localMockImage: DockerContainersTestState['mockImage'];

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
    localMockImage = {
      inspect: vi.fn(),
    };
    mockImage = localMockImage;
    mockDockerApi.getImage.mockReturnValue(localMockImage);

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
    assignState({
      docker,
      mockDockerApi,
      mockSchedule,
      mockContainer,
      mockImage: localMockImage,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (docker) {
      await docker.deregisterComponent();
    }
  });
}

export {
  createDeviceCodeResponse,
  createDeviceFlowConfig,
  createDockerContainer,
  createDockerOidcContext,
  createDockerOidcStateAdapter,
  createHaParseMock,
  createHarborHubRegistryState,
  createImageDetails,
  createMockLog,
  createMockLogWithChild,
  createMockRegistry,
  createOidcConfig,
  createTokenResponse,
  Docker,
  event,
  fullName,
  getDockerWatcherRegistryId,
  getDockerWatcherSourceKey,
  maintenance,
  mockAxios,
  mockDdEnvVars,
  mockDetectSourceRepoFromImageMetadata,
  mockGetFullReleaseNotesForContainer,
  mockParse,
  mockPrometheus,
  mockResolveSourceRepoForContainer,
  mockTag,
  mockToContainerReleaseNotes,
  registry,
  setupContainerDetailTest,
  storeContainer,
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
};
