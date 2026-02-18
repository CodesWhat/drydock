// @ts-nocheck
import joi from 'joi';
import log from '../../../log/index.js';
import Docker from './Docker.js';

const configurationValid = {
  prune: false,
  dryrun: false,
  threshold: 'all',
  mode: 'simple',
  once: true,
  auto: true,
  order: 100,
  autoremovetimeout: 10000,
  backupcount: 3,
  simpletitle: 'New ${container.updateKind.kind} found for container ${container.name}',
  simplebody:
    'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',
  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
};

const docker = new Docker();
docker.configuration = configurationValid;
docker.log = log;

const mockGetSecurityConfiguration = vi.hoisted(() => vi.fn());
vi.mock('../../../configuration/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../configuration/index.js')>(
    '../../../configuration/index.js',
  );
  return {
    ...actual,
    getSecurityConfiguration: (...args: any[]) => mockGetSecurityConfiguration(...args),
  };
});

const mockScanImageForVulnerabilities = vi.hoisted(() => vi.fn());
const mockVerifyImageSignature = vi.hoisted(() => vi.fn());
const mockGenerateImageSbom = vi.hoisted(() => vi.fn());
vi.mock('../../../security/scan.js', () => ({
  scanImageForVulnerabilities: mockScanImageForVulnerabilities,
  verifyImageSignature: mockVerifyImageSignature,
  generateImageSbom: mockGenerateImageSbom,
}));

vi.mock('../../../store/container.js', () => ({
  getContainer: vi.fn(),
  updateContainer: vi.fn((container) => container),
  cacheSecurityState: vi.fn(),
}));

vi.mock('../../../store/backup', () => ({
  insertBackup: vi.fn(),
  pruneOldBackups: vi.fn(),
}));

const mockRunHook = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/HookRunner.js', () => ({
  runHook: mockRunHook,
}));

const mockStartHealthMonitor = vi.hoisted(() => vi.fn().mockReturnValue({ abort: vi.fn() }));
vi.mock('./HealthMonitor.js', () => ({
  startHealthMonitor: mockStartHealthMonitor,
}));

vi.mock('../../../store/audit.js', () => ({
  insertAudit: vi.fn(),
}));

const mockAuditCounterInc = vi.hoisted(() => vi.fn());
vi.mock('../../../prometheus/audit.js', () => ({
  getAuditCounter: () => ({ inc: mockAuditCounterInc }),
}));

vi.mock('../../../registry', () => ({
  getState() {
    return {
      watcher: {
        'docker.test': {
          getId: () => 'docker.test',
          watch: () => Promise.resolve(),
          dockerApi: {
            getContainer: (id) => {
              if (id === '123456789') {
                return Promise.resolve({
                  inspect: () =>
                    Promise.resolve({
                      Name: '/container-name',
                      Id: '123456798',
                      State: {
                        Running: true,
                      },
                      NetworkSettings: {
                        Networks: {
                          test: {
                            Aliases: ['9708fc7b44f2', 'test'],
                          },
                        },
                      },
                    }),
                  stop: () => Promise.resolve(),
                  remove: () => Promise.resolve(),
                  start: () => Promise.resolve(),
                });
              }
              return Promise.reject(new Error('Error when getting container'));
            },
            createContainer: (container) => {
              if (container.name === 'container-name') {
                return Promise.resolve({
                  start: () => Promise.resolve(),
                });
              }
              return Promise.reject(new Error('Error when creating container'));
            },
            pull: (image) => {
              if (image === 'test/test:1.2.3' || image === 'my-registry/test/test:4.5.6') {
                return Promise.resolve();
              }
              return Promise.reject(new Error('Error when pulling image'));
            },
            getImage: (image) =>
              Promise.resolve({
                remove: () => {
                  if (image === 'test/test:1.2.3') {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Error when removing image'));
                },
              }),
            modem: {
              followProgress: (pullStream, res) => res(),
            },
          },
        },
      },
      registry: {
        hub: {
          getAuthPull: async () => undefined,
          getImageFullName: (image, tagOrDigest) =>
            `${image.registry.url}/${image.name}:${tagOrDigest}`,
        },
      },
    };
  },
}));

// --- Shared factories and helpers ---

/** Build a mock dockerApi for pruneImages tests */
function createPruneDockerApi(images, removeSpy = vi.fn().mockResolvedValue(undefined)) {
  return {
    listImages: vi.fn().mockResolvedValue(images),
    getImage: vi.fn().mockReturnValue({ name: 'image-to-remove', remove: removeSpy }),
  };
}

/** Standard normalizeImage mock that echoes registry name, image name, and tag */
function createEchoNormalizeRegistry(registryName = 'ecr') {
  return {
    normalizeImage: (img) => ({
      registry: { name: registryName },
      name: img.name,
      tag: { value: img.tag.value },
    }),
  };
}

/** Default container fixture for pruneImages tests */
function createPruneContainer(overrides = {}) {
  return {
    image: { registry: { name: 'ecr' }, name: 'repo', tag: { value: '1.0.0' } },
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
    ...overrides,
  };
}

/** Build a container payload for trigger tests */
function createTriggerContainer(overrides = {}) {
  return {
    watcher: 'test',
    id: '123456789',
    name: 'container-name',
    image: {
      name: 'test/test',
      registry: { name: 'hub', url: 'my-registry' },
      tag: { value: '1.0.0' },
    },
    updateKind: { kind: 'tag', remoteValue: '4.5.6' },
    ...overrides,
  };
}

function createSecurityScanResult(overrides = {}) {
  return {
    scanner: 'trivy',
    image: 'my-registry/test/test:4.5.6',
    scannedAt: new Date().toISOString(),
    status: 'passed',
    blockSeverities: ['CRITICAL', 'HIGH'],
    blockingCount: 0,
    summary: {
      unknown: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    },
    vulnerabilities: [],
    ...overrides,
  };
}

function createSignatureVerificationResult(overrides = {}) {
  return {
    verifier: 'cosign',
    image: 'my-registry/test/test:4.5.6',
    verifiedAt: new Date().toISOString(),
    status: 'verified',
    keyless: true,
    signatures: 1,
    ...overrides,
  };
}

function createSbomResult(overrides = {}) {
  return {
    generator: 'trivy',
    image: 'my-registry/test/test:4.5.6',
    generatedAt: new Date().toISOString(),
    status: 'generated',
    formats: ['spdx-json'],
    documents: {
      'spdx-json': { SPDXID: 'SPDXRef-DOCUMENT' },
    },
    ...overrides,
  };
}

function createSecurityConfiguration(overrides = {}) {
  return {
    enabled: true,
    scanner: 'trivy',
    blockSeverities: ['CRITICAL', 'HIGH'],
    trivy: { server: '', command: 'trivy', timeout: 120000 },
    signature: {
      verify: false,
      cosign: {
        command: 'cosign',
        timeout: 60000,
        key: '',
        identity: '',
        issuer: '',
      },
    },
    sbom: {
      enabled: false,
      formats: ['spdx-json'],
    },
    ...overrides,
  };
}

/** Spy on all Docker methods needed for trigger flow (non-dryrun, non-running) */
function stubTriggerFlow(opts = {}) {
  const { running = false, autoRemove = false, inspectOverrides = {} } = opts;

  const waitSpy = vi.fn().mockResolvedValue();
  vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue({
    inspect: () => Promise.resolve(),
    remove: vi.fn(),
    stop: () => Promise.resolve(),
    wait: waitSpy,
  });
  vi.spyOn(docker, 'inspectContainer').mockResolvedValue({
    Name: '/container-name',
    Id: '123',
    State: { Running: running },
    Config: {},
    HostConfig: { ...(autoRemove ? { AutoRemove: true } : {}) },
    NetworkSettings: { Networks: {} },
    ...inspectOverrides,
  });
  vi.spyOn(docker, 'pruneImages').mockResolvedValue();
  vi.spyOn(docker, 'pullImage').mockResolvedValue();
  vi.spyOn(docker, 'cloneContainer').mockReturnValue({ name: 'container-name' });
  vi.spyOn(docker, 'stopContainer').mockResolvedValue();
  vi.spyOn(docker, 'removeContainer').mockResolvedValue();
  vi.spyOn(docker, 'createContainer').mockResolvedValue({ start: vi.fn() });
  vi.spyOn(docker, 'startContainer').mockResolvedValue();
  const removeImageSpy = vi.spyOn(docker, 'removeImage').mockResolvedValue();

  return { waitSpy, removeImageSpy };
}

/** Create a mock log with common methods */
function createMockLog(...methods) {
  const mockLog = {};
  for (const m of methods) {
    mockLog[m] = vi.fn();
  }
  return mockLog;
}

beforeEach(async () => {
  vi.resetAllMocks();
  docker.configuration = configurationValid;
  docker.log = log;
  mockGetSecurityConfiguration.mockReturnValue({
    enabled: false,
    scanner: '',
    blockSeverities: ['CRITICAL', 'HIGH'],
    trivy: {
      server: '',
      command: 'trivy',
      timeout: 120000,
    },
    signature: {
      verify: false,
      cosign: {
        command: 'cosign',
        timeout: 60000,
        key: '',
        identity: '',
        issuer: '',
      },
    },
    sbom: {
      enabled: false,
      formats: ['spdx-json'],
    },
  });
  mockScanImageForVulnerabilities.mockResolvedValue({
    ...createSecurityScanResult(),
  });
  mockVerifyImageSignature.mockResolvedValue({
    ...createSignatureVerificationResult(),
  });
  mockGenerateImageSbom.mockResolvedValue({
    ...createSbomResult(),
  });
});

// --- Configuration validation ---

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = docker.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {
    url: 'git://xxx.com',
  };
  expect(() => {
    docker.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

// --- getWatcher ---

test('getWatcher should return watcher responsible for a container', async () => {
  expect(
    docker
      .getWatcher({
        watcher: 'test',
      })
      .getId(),
  ).toEqual('docker.test');
});

// --- getCurrentContainer ---

test('getCurrentContainer should return container from dockerApi', async () => {
  await expect(
    docker.getCurrentContainer(docker.getWatcher({ watcher: 'test' }).dockerApi, {
      id: '123456789',
    }),
  ).resolves.not.toBeUndefined();
});

test('getCurrentContainer should throw error when error occurs', async () => {
  await expect(
    docker.getCurrentContainer(docker.getWatcher({ watcher: 'test' }).dockerApi, { id: 'unknown' }),
  ).rejects.toThrowError('Error when getting container');
});

// --- inspectContainer ---

test('inspectContainer should return container details from dockerApi', async () => {
  await expect(
    docker.inspectContainer({ inspect: () => Promise.resolve({}) }, log),
  ).resolves.toEqual({});
});

test('inspectContainer should throw error when error occurs', async () => {
  await expect(
    docker.inspectContainer({ inspect: () => Promise.reject(new Error('No container')) }, log),
  ).rejects.toThrowError('No container');
});

// --- Container operations: stop, remove, wait, start (parametric) ---

describe.each([
  {
    method: 'stopContainer',
    action: 'stop',
    args: (stub) => [stub, 'name', 'id', log],
  },
  {
    method: 'removeContainer',
    action: 'remove',
    args: (stub) => [stub, 'name', 'id', log],
  },
  {
    method: 'waitContainerRemoved',
    action: 'wait',
    args: (stub) => [stub, 'name', 'id', log],
  },
  {
    method: 'startContainer',
    action: 'start',
    args: (stub) => [stub, 'name', log],
  },
])('$method', ({ method, action, args }) => {
  test('should resolve when successful', async () => {
    const stub = { [action]: () => Promise.resolve() };
    await expect(docker[method](...args(stub))).resolves.toBeUndefined();
  });

  test('should throw error when error occurs', async () => {
    const stub = { [action]: () => Promise.reject(new Error('No container')) };
    await expect(docker[method](...args(stub))).rejects.toThrowError('No container');
  });
});

// --- createContainer ---

test('createContainer should stop container from dockerApi', async () => {
  await expect(
    docker.createContainer(
      docker.getWatcher({ watcher: 'test' }).dockerApi,
      { name: 'container-name' },
      'name',
      log,
    ),
  ).resolves.not.toBeUndefined();
});

test('createContainer should throw error when error occurs', async () => {
  await expect(
    docker.createContainer(
      docker.getWatcher({ watcher: 'test' }).dockerApi,
      { name: 'ko' },
      'name',
      log,
    ),
  ).rejects.toThrowError('Error when creating container');
});

test('createContainer should connect additional networks after create', async () => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const getNetwork = vi.fn().mockReturnValue({ connect });
  const createContainer = vi.fn().mockResolvedValue({
    start: () => Promise.resolve(),
  });
  const logContainer = createMockLog('info', 'warn');

  const containerToCreate = {
    name: 'container-name',
    HostConfig: {
      NetworkMode: 'cloud_default',
    },
    NetworkingConfig: {
      EndpointsConfig: {
        cloud_default: { Aliases: ['container-name'] },
        postgres_default: { Aliases: ['container-name'] },
        valkey_default: { Aliases: ['container-name'] },
      },
    },
  };

  await docker.createContainer(
    { createContainer, getNetwork },
    containerToCreate,
    'container-name',
    logContainer,
  );

  expect(createContainer).toHaveBeenCalledWith({
    name: 'container-name',
    HostConfig: {
      NetworkMode: 'cloud_default',
    },
    NetworkingConfig: {
      EndpointsConfig: {
        cloud_default: { Aliases: ['container-name'] },
      },
    },
  });
  expect(getNetwork).toHaveBeenCalledTimes(2);
  expect(getNetwork).toHaveBeenCalledWith('postgres_default');
  expect(getNetwork).toHaveBeenCalledWith('valkey_default');
  expect(connect).toHaveBeenCalledTimes(2);
  expect(connect).toHaveBeenCalledWith({
    Container: 'container-name',
    EndpointConfig: { Aliases: ['container-name'] },
  });
});

// --- pullImage ---

test('pull should pull image from dockerApi', async () => {
  await expect(
    docker.pullImage(
      docker.getWatcher({ watcher: 'test' }).dockerApi,
      undefined,
      'test/test:1.2.3',
      log,
    ),
  ).resolves.toBeUndefined();
});

test('pull should throw error when error occurs', async () => {
  await expect(
    docker.pullImage(
      docker.getWatcher({ watcher: 'test' }).dockerApi,
      undefined,
      'test/test:unknown',
      log,
    ),
  ).rejects.toThrowError('Error when pulling image');
});

test('pull should emit progress logs from followProgress events', async () => {
  const dockerApi = {
    pull: vi.fn().mockResolvedValue({}),
    modem: {
      followProgress: vi.fn((pullStream, done, onProgress) => {
        onProgress({
          id: 'layer-1',
          status: 'Downloading',
          progressDetail: { current: 50, total: 100 },
        });
        done(null, [{ id: 'layer-1', status: 'Download complete' }]);
      }),
    },
  };
  const logContainer = createMockLog('info', 'warn', 'debug');

  await docker.pullImage(dockerApi, undefined, 'test/test:1.2.3', logContainer);

  expect(logContainer.debug).toHaveBeenCalledWith(
    expect.stringContaining('Pull progress for test/test:1.2.3'),
  );
  expect(logContainer.info).toHaveBeenCalledWith('Image test/test:1.2.3 pulled with success');
});

test('pull should throw error when followProgress reports an error', async () => {
  const dockerApi = {
    pull: vi.fn().mockResolvedValue({}),
    modem: {
      followProgress: vi.fn((pullStream, done) => {
        done(new Error('Pull progress failed'));
      }),
    },
  };
  const logContainer = createMockLog('info', 'warn', 'debug');

  await expect(
    docker.pullImage(dockerApi, undefined, 'test/test:1.2.3', logContainer),
  ).rejects.toThrowError('Pull progress failed');
});

// --- removeImage ---

test('removeImage should pull image from dockerApi', async () => {
  await expect(
    docker.removeImage(docker.getWatcher({ watcher: 'test' }).dockerApi, 'test/test:1.2.3', log),
  ).resolves.toBeUndefined();
});

test('removeImage should throw error when error occurs', async () => {
  await expect(
    docker.removeImage(docker.getWatcher({ watcher: 'test' }).dockerApi, 'test/test:unknown', log),
  ).rejects.toThrowError('Error when removing image');
});

// --- cloneContainer ---

test('clone should clone an existing container spec', async () => {
  const clone = docker.cloneContainer(
    {
      Name: '/test',
      Id: '123456789',
      HostConfig: { a: 'a', b: 'b' },
      Config: { configA: 'a', configB: 'b' },
      NetworkSettings: {
        Networks: {
          test: { Aliases: ['9708fc7b44f2', 'test'] },
        },
      },
    },
    'test/test:2.0.0',
  );
  expect(clone).toEqual({
    HostConfig: { a: 'a', b: 'b' },
    Image: 'test/test:2.0.0',
    configA: 'a',
    configB: 'b',
    name: 'test',
    NetworkingConfig: {
      EndpointsConfig: {
        test: { Aliases: ['9708fc7b44f2', 'test'] },
      },
    },
  });
});

test('clone should remove dynamic network endpoint fields and stale aliases', async () => {
  const clone = docker.cloneContainer(
    {
      Name: '/test',
      Id: '123456789abcdef',
      HostConfig: { NetworkMode: 'cloud_default' },
      Config: { configA: 'a' },
      NetworkSettings: {
        Networks: {
          cloud_default: {
            Aliases: ['123456789abc', 'nextcloud'],
            NetworkID: 'network-id',
            EndpointID: 'endpoint-id',
            Gateway: '172.18.0.1',
            IPAddress: '172.18.0.2',
            DriverOpts: { test: 'value' },
          },
        },
      },
    },
    'test/test:2.0.0',
  );

  expect(clone.NetworkingConfig.EndpointsConfig).toEqual({
    cloud_default: {
      Aliases: ['nextcloud'],
      DriverOpts: { test: 'value' },
    },
  });
});

test('cloneContainer should remove Hostname and ExposedPorts when NetworkMode starts with container:', () => {
  const clone = docker.cloneContainer(
    {
      Name: '/sidecar',
      Id: 'abc123',
      HostConfig: { NetworkMode: 'container:mainapp' },
      Config: {
        Hostname: 'sidecar-host',
        ExposedPorts: { '80/tcp': {} },
        configA: 'a',
      },
      NetworkSettings: { Networks: {} },
    },
    'test/test:2.0.0',
  );
  expect(clone.Hostname).toBeUndefined();
  expect(clone.ExposedPorts).toBeUndefined();
  expect(clone.HostConfig.NetworkMode).toBe('container:mainapp');
});

test('cloneContainer should handle missing NetworkSettings by using empty endpoint config', () => {
  const clone = docker.cloneContainer(
    {
      Name: '/no-network',
      Id: 'abc123',
      HostConfig: {},
      Config: { configA: 'a' },
    },
    'test/test:2.0.0',
  );

  expect(clone.NetworkingConfig).toEqual({ EndpointsConfig: {} });
});

// --- trigger ---

test('trigger should not throw when all is ok', async () => {
  await expect(
    docker.trigger({
      watcher: 'test',
      id: '123456789',
      Name: '/container-name',
      image: {
        name: 'test/test',
        registry: { name: 'hub', url: 'my-registry' },
        tag: { value: '1.0.0' },
      },
      updateKind: { remoteValue: '4.5.6' },
    }),
  ).resolves.toBeUndefined();
});

test('trigger should not throw in dryrun mode', async () => {
  docker.configuration = { ...configurationValid, dryrun: true };
  docker.log = log;
  await expect(
    docker.trigger(createTriggerContainer({ name: 'test-container' })),
  ).resolves.toBeUndefined();
});

test('trigger should use waitContainerRemoved when AutoRemove is true', async () => {
  docker.configuration = { ...configurationValid, dryrun: false, prune: false };
  docker.log = log;
  const { waitSpy } = stubTriggerFlow({ running: true, autoRemove: true });

  await docker.trigger(createTriggerContainer());

  expect(waitSpy).toHaveBeenCalled();
});

test('trigger should prune old image by tag after non-dryrun update', async () => {
  docker.configuration = { ...configurationValid, dryrun: false, prune: true };
  docker.log = log;
  const { removeImageSpy } = stubTriggerFlow();

  await docker.trigger(createTriggerContainer());

  expect(removeImageSpy).toHaveBeenCalled();
});

test('trigger should prune old image by digest repo after non-dryrun update', async () => {
  docker.configuration = { ...configurationValid, dryrun: false, prune: true };
  docker.log = log;
  const { removeImageSpy } = stubTriggerFlow();

  await docker.trigger(
    createTriggerContainer({
      image: {
        name: 'test/test',
        registry: { name: 'hub', url: 'my-registry' },
        tag: { value: 'latest' },
        digest: { repo: 'sha256:olddigest' },
      },
      updateKind: { kind: 'digest', remoteValue: 'sha256:newdigest' },
    }),
  );

  expect(removeImageSpy).toHaveBeenCalled();
});

test('trigger should catch error when removing digest image fails', async () => {
  docker.configuration = { ...configurationValid, dryrun: false, prune: true };
  docker.log = log;
  stubTriggerFlow();
  vi.spyOn(docker, 'removeImage').mockRejectedValue(new Error('remove failed'));

  // Should not throw
  await docker.trigger(
    createTriggerContainer({
      image: {
        name: 'test/test',
        registry: { name: 'hub', url: 'my-registry' },
        tag: { value: 'latest' },
        digest: { repo: 'sha256:olddigest' },
      },
      updateKind: { kind: 'digest', remoteValue: 'sha256:newdigest' },
    }),
  );
});

test('trigger should not throw when container does not exist', async () => {
  docker.configuration = { ...configurationValid, dryrun: false };
  docker.log = log;
  vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue(null);

  await expect(
    docker.trigger(createTriggerContainer({ name: 'test-container' })),
  ).resolves.toBeUndefined();
});

test('trigger should block update when security scan is blocked', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  mockScanImageForVulnerabilities.mockResolvedValue(
    createSecurityScanResult({
      status: 'blocked',
      blockingCount: 2,
      summary: {
        unknown: 0,
        low: 0,
        medium: 0,
        high: 2,
        critical: 0,
      },
      vulnerabilities: [
        { id: 'CVE-1', severity: 'HIGH' },
        { id: 'CVE-2', severity: 'HIGH' },
      ],
    }),
  );
  stubTriggerFlow({ running: true });
  const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Security scan blocked update',
  );

  expect(mockScanImageForVulnerabilities).toHaveBeenCalled();
  expect(executeContainerUpdateSpy).not.toHaveBeenCalled();
});

test('trigger should block update when security scan errors', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  mockScanImageForVulnerabilities.mockResolvedValue(
    createSecurityScanResult({
      status: 'error',
      error: 'Trivy command failed',
    }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Security scan failed: Trivy command failed',
  );
});

test('trigger should continue update when security scan passes', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());
  stubTriggerFlow({ running: true });
  const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockScanImageForVulnerabilities).toHaveBeenCalled();
  expect(executeContainerUpdateSpy).toHaveBeenCalled();
});

test('trigger should continue update when signature verification passes', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      signature: {
        verify: true,
        cosign: {
          command: 'cosign',
          timeout: 60000,
          key: '',
          identity: '',
          issuer: '',
        },
      },
    }),
  );
  mockVerifyImageSignature.mockResolvedValue(createSignatureVerificationResult());
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());
  stubTriggerFlow({ running: true });
  const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockVerifyImageSignature).toHaveBeenCalled();
  expect(executeContainerUpdateSpy).toHaveBeenCalled();
});

test('trigger should block update when signature verification is unverified', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      signature: {
        verify: true,
        cosign: {
          command: 'cosign',
          timeout: 60000,
          key: '',
          identity: '',
          issuer: '',
        },
      },
    }),
  );
  mockVerifyImageSignature.mockResolvedValue(
    createSignatureVerificationResult({
      status: 'unverified',
      signatures: 0,
      error: 'no matching signatures',
    }),
  );
  stubTriggerFlow({ running: true });
  const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Image signature verification failed',
  );

  expect(mockVerifyImageSignature).toHaveBeenCalled();
  expect(executeContainerUpdateSpy).not.toHaveBeenCalled();
});

test('trigger should generate sbom when enabled', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      sbom: {
        enabled: true,
        formats: ['spdx-json', 'cyclonedx-json'],
      },
    }),
  );
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());
  mockGenerateImageSbom.mockResolvedValue(
    createSbomResult({
      formats: ['spdx-json', 'cyclonedx-json'],
      documents: {
        'spdx-json': { SPDXID: 'SPDXRef-DOCUMENT' },
        'cyclonedx-json': { bomFormat: 'CycloneDX' },
      },
    }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockGenerateImageSbom).toHaveBeenCalledWith(
    expect.objectContaining({
      formats: ['spdx-json', 'cyclonedx-json'],
    }),
  );
});

test('trigger should continue update when sbom generation fails', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      sbom: {
        enabled: true,
        formats: ['spdx-json'],
      },
    }),
  );
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());
  mockGenerateImageSbom.mockResolvedValue(
    createSbomResult({
      status: 'error',
      documents: {},
      error: 'trivy unavailable',
    }),
  );
  stubTriggerFlow({ running: true });
  const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockGenerateImageSbom).toHaveBeenCalled();
  expect(executeContainerUpdateSpy).toHaveBeenCalled();
});

test('trigger should use fallback message when signature verification fails without error', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      signature: {
        verify: true,
        cosign: { command: 'cosign', timeout: 60000, key: '', identity: '', issuer: '' },
      },
    }),
  );
  mockVerifyImageSignature.mockResolvedValue(
    createSignatureVerificationResult({ status: 'unverified', signatures: 0, error: '' }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Image signature verification failed: no valid signatures found',
  );
});

test('trigger should use security-signature-failed action when signature status is error', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      signature: {
        verify: true,
        cosign: { command: 'cosign', timeout: 60000, key: '', identity: '', issuer: '' },
      },
    }),
  );
  mockVerifyImageSignature.mockResolvedValue(
    createSignatureVerificationResult({ status: 'error', signatures: 0, error: 'cosign crashed' }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Image signature verification failed: cosign crashed',
  );

  expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'security-signature-failed' });
});

test('trigger should use fallback message when sbom generation fails without error', async () => {
  mockGetSecurityConfiguration.mockReturnValue(
    createSecurityConfiguration({
      sbom: { enabled: true, formats: ['spdx-json'] },
    }),
  );
  mockScanImageForVulnerabilities.mockResolvedValue(createSecurityScanResult());
  mockGenerateImageSbom.mockResolvedValue(
    createSbomResult({ status: 'error', documents: {}, error: '' }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).resolves.toBeUndefined();

  expect(mockAuditCounterInc).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'security-sbom-failed' }),
  );
});

test('trigger should use fallback message when security scan errors without error', async () => {
  mockGetSecurityConfiguration.mockReturnValue(createSecurityConfiguration());
  mockScanImageForVulnerabilities.mockResolvedValue(
    createSecurityScanResult({ status: 'error', error: '' }),
  );
  stubTriggerFlow({ running: true });

  await expect(docker.trigger(createTriggerContainer())).rejects.toThrowError(
    'Security scan failed: unknown scanner error',
  );
});

test('persistSecurityState should warn when container store update fails', async () => {
  const storeContainer = await import('../../../store/container.js');
  storeContainer.updateContainer.mockImplementationOnce(() => {
    throw new Error('store unavailable');
  });
  const logContainer = createMockLog('warn');

  await docker.persistSecurityState(
    createTriggerContainer(),
    { scan: createSecurityScanResult() },
    logContainer,
  );

  expect(logContainer.warn).toHaveBeenCalledWith(
    expect.stringContaining('Unable to persist security state (store unavailable)'),
  );
});

test('persistSecurityState should merge with existing security state from store', async () => {
  const storeContainer = await import('../../../store/container.js');
  storeContainer.getContainer.mockReturnValue({
    id: '123456789',
    security: {
      scan: createSecurityScanResult(),
    },
  });
  const logContainer = createMockLog('warn');

  await docker.persistSecurityState(
    createTriggerContainer(),
    { signature: createSignatureVerificationResult() },
    logContainer,
  );

  expect(storeContainer.updateContainer).toHaveBeenCalledWith(
    expect.objectContaining({
      security: expect.objectContaining({
        scan: expect.any(Object),
        signature: expect.any(Object),
      }),
    }),
  );
});

// --- triggerBatch ---

test('triggerBatch should call trigger for each container', async () => {
  const triggerSpy = vi.spyOn(docker, 'trigger').mockResolvedValue();
  const containers = [{ name: 'c1' }, { name: 'c2' }];
  await docker.triggerBatch(containers);
  expect(triggerSpy).toHaveBeenCalledTimes(2);
  expect(triggerSpy).toHaveBeenCalledWith({ name: 'c1' });
  expect(triggerSpy).toHaveBeenCalledWith({ name: 'c2' });
});

// --- pruneImages (parametric: exclusion filters) ---

describe('pruneImages exclusion filters', () => {
  test.each([
    {
      scenario: 'should exclude the current tag when updateKind is digest',
      images: [
        { Id: 'image-current', RepoTags: ['ecr.example.com/repo:nginx-prod'] },
        { Id: 'image-other', RepoTags: ['ecr.example.com/repo:other-tag'] },
      ],
      container: createPruneContainer({
        image: { registry: { name: 'ecr' }, name: 'repo', tag: { value: 'nginx-prod' } },
        updateKind: {
          kind: 'digest',
          localValue: 'sha256:olddigest',
          remoteValue: 'sha256:newdigest',
        },
      }),
      expectedGetImageCalls: 1,
      expectedGetImageArgs: ['image-other'],
    },
    {
      scenario: 'should not exclude current tag when updateKind is tag',
      images: [
        { Id: 'image-current', RepoTags: ['ecr.example.com/repo:1.0.0'] },
        { Id: 'image-other', RepoTags: ['ecr.example.com/repo:0.9.0'] },
      ],
      container: createPruneContainer(),
      expectedGetImageCalls: 1,
      expectedGetImageArgs: ['image-other'],
    },
  ])('$scenario', async ({ images, container, expectedGetImageCalls, expectedGetImageArgs }) => {
    const mockDockerApi = createPruneDockerApi(images);

    await docker.pruneImages(mockDockerApi, createEchoNormalizeRegistry(), container, log);

    expect(mockDockerApi.getImage).toHaveBeenCalledTimes(expectedGetImageCalls);
    for (const arg of expectedGetImageArgs) {
      expect(mockDockerApi.getImage).toHaveBeenCalledWith(arg);
    }
  });
});

describe('pruneImages should not prune excluded images', () => {
  test.each([
    {
      scenario: 'images from different registries',
      images: [{ Id: 'image-diff-registry', RepoTags: ['other-registry.com/repo:1.0.0'] }],
      registryName: 'other-reg',
    },
    {
      scenario: 'images with different names',
      images: [{ Id: 'image-diff-name', RepoTags: ['ecr.example.com/other-repo:0.9.0'] }],
      registryName: 'ecr',
    },
    {
      scenario: 'images matching remoteValue',
      images: [{ Id: 'image-remote', RepoTags: ['ecr.example.com/repo:2.0.0'] }],
      registryName: 'ecr',
    },
  ])('$scenario', async ({ images, registryName }) => {
    const mockDockerApi = createPruneDockerApi(images);

    await docker.pruneImages(
      mockDockerApi,
      createEchoNormalizeRegistry(registryName),
      createPruneContainer(),
      log,
    );

    expect(mockDockerApi.getImage).not.toHaveBeenCalled();
  });
});

describe('pruneImages edge cases', () => {
  test.each([
    {
      scenario: 'should exclude images without RepoTags (null)',
      images: [{ Id: 'image-no-tags', RepoTags: null }],
    },
    {
      scenario: 'should exclude images without RepoTags (empty)',
      images: [{ Id: 'image-empty-tags', RepoTags: [] }],
    },
    {
      scenario: 'should exclude images without RepoTags (null and empty)',
      images: [
        { Id: 'image-no-tags', RepoTags: null },
        { Id: 'image-empty-tags', RepoTags: [] },
      ],
    },
  ])('$scenario', async ({ images }) => {
    const mockDockerApi = createPruneDockerApi(images);

    await docker.pruneImages(
      mockDockerApi,
      { normalizeImage: vi.fn() },
      createPruneContainer(),
      log,
    );

    expect(mockDockerApi.getImage).not.toHaveBeenCalled();
  });

  test('should warn when error occurs during pruning', async () => {
    const mockDockerApi = {
      listImages: vi.fn().mockRejectedValue(new Error('list failed')),
    };
    const logContainer = createMockLog('info', 'warn');

    await docker.pruneImages(mockDockerApi, {}, createPruneContainer(), logContainer);

    expect(logContainer.warn).toHaveBeenCalledWith(expect.stringContaining('list failed'));
  });

  test('should normalize listed images when parser returns no domain', async () => {
    const mockDockerApi = createPruneDockerApi([
      { Id: 'image-no-domain', RepoTags: ['repo:0.9.0'] },
    ]);
    const normalizeImage = vi.fn((img) => ({
      ...img,
      registry: { name: 'ecr', url: img.registry.url || '' },
      name: img.name,
      tag: { value: img.tag.value },
    }));

    await docker.pruneImages(
      mockDockerApi,
      { normalizeImage },
      createPruneContainer(),
      createMockLog('info', 'warn'),
    );

    expect(normalizeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        registry: expect.objectContaining({ url: '' }),
      }),
    );
  });
});

// --- Duplicate pruneImages tests (longer-form, kept for backward compatibility) ---

test('pruneImages should exclude images with different names', async () => {
  const mockDockerApi = createPruneDockerApi([
    { Id: 'image-different-name', RepoTags: ['ecr.example.com/different-repo:1.0.0'] },
  ]);
  const containerTagUpdate = createPruneContainer();

  await docker.pruneImages(mockDockerApi, createEchoNormalizeRegistry(), containerTagUpdate, log);

  expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should exclude candidate image (remoteValue)', async () => {
  const mockDockerApi = createPruneDockerApi([
    { Id: 'image-candidate', RepoTags: ['ecr.example.com/repo:2.0.0'] },
  ]);
  const containerTagUpdate = createPruneContainer();

  await docker.pruneImages(mockDockerApi, createEchoNormalizeRegistry(), containerTagUpdate, log);

  expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should exclude images without RepoTags', async () => {
  const mockDockerApi = createPruneDockerApi([
    { Id: 'image-no-tags', RepoTags: [] },
    { Id: 'image-null-tags' },
  ]);

  await docker.pruneImages(mockDockerApi, { normalizeImage: vi.fn() }, createPruneContainer(), log);

  expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should exclude images with different registry', async () => {
  const mockDockerApi = createPruneDockerApi([
    { Id: 'image-diff-registry', RepoTags: ['other-registry.io/repo:0.8.0'] },
  ]);

  await docker.pruneImages(
    mockDockerApi,
    createEchoNormalizeRegistry('other-registry'),
    createPruneContainer(),
    log,
  );

  expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should warn when error occurs during pruning', async () => {
  const mockDockerApi = {
    listImages: vi.fn().mockRejectedValue(new Error('list failed')),
  };
  const logContainer = createMockLog('info', 'warn');

  await docker.pruneImages(mockDockerApi, {}, createPruneContainer(), logContainer);

  expect(logContainer.warn).toHaveBeenCalledWith(expect.stringContaining('list failed'));
});

// --- getNewImageFullName ---

test('getNewImageFullName should use tag value for digest updates', () => {
  const mockRegistry = {
    getImageFullName: (image, tagOrDigest) => `${image.registry.url}/${image.name}:${tagOrDigest}`,
  };
  const containerDigest = {
    image: {
      name: 'test/test',
      tag: { value: 'nginx-prod' },
      registry: { url: 'my-registry' },
    },
    updateKind: { kind: 'digest', remoteValue: 'sha256:newdigest' },
  };
  const result = docker.getNewImageFullName(mockRegistry, containerDigest);
  expect(result).toBe('my-registry/test/test:nginx-prod');
});

test('getNewImageFullName should fall back to tag value when remoteValue is undefined', () => {
  const mockRegistry = {
    getImageFullName: (image, tagOrDigest) => `${image.registry.url}/${image.name}:${tagOrDigest}`,
  };
  const containerUnknown = {
    image: {
      name: 'test/test',
      tag: { value: 'latest' },
      registry: { url: 'my-registry' },
    },
    updateKind: { kind: 'unknown', remoteValue: undefined },
  };
  const result = docker.getNewImageFullName(mockRegistry, containerUnknown);
  expect(result).toBe('my-registry/test/test:latest');
});

// --- createPullProgressLogger ---

test('createPullProgressLogger should throttle duplicate snapshots within interval', () => {
  const logContainer = createMockLog('debug');
  const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');

  logger.onProgress({
    status: 'Downloading',
    id: 'layer-1',
    progressDetail: { current: 50, total: 100 },
  });
  expect(logContainer.debug).toHaveBeenCalledTimes(1);

  // Immediate repeat with same data should be throttled
  logger.onProgress({
    status: 'Downloading',
    id: 'layer-1',
    progressDetail: { current: 50, total: 100 },
  });
  expect(logContainer.debug).toHaveBeenCalledTimes(1);

  // Different data but within interval should still be throttled
  logger.onProgress({
    status: 'Downloading',
    id: 'layer-1',
    progressDetail: { current: 75, total: 100 },
  });
  expect(logContainer.debug).toHaveBeenCalledTimes(1);
});

test('createPullProgressLogger should handle null/undefined progressEvent', () => {
  const logContainer = createMockLog('debug');
  const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');
  logger.onProgress(null);
  logger.onProgress(undefined);
  expect(logContainer.debug).not.toHaveBeenCalled();
});

test('createPullProgressLogger onDone should force log regardless of interval', () => {
  const logContainer = createMockLog('debug');
  const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');
  logger.onProgress({
    status: 'Downloading',
    id: 'l1',
    progressDetail: { current: 50, total: 100 },
  });
  logger.onDone({ status: 'Download complete', id: 'l1' });
  expect(logContainer.debug).toHaveBeenCalledTimes(2);
});

test('createPullProgressLogger should use default status when progress event has no status', () => {
  const logContainer = createMockLog('debug');
  const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');

  logger.onProgress({});

  expect(logContainer.debug).toHaveBeenCalledWith('Pull progress for test:1.0: progress');
});

// --- formatPullProgress ---

test('formatPullProgress should return string progress when progressDetail is missing', () => {
  expect(docker.formatPullProgress({ progress: '[==> ] 50%' })).toBe('[==> ] 50%');
});

test('formatPullProgress should return undefined when no progress data', () => {
  expect(docker.formatPullProgress({ status: 'Waiting' })).toBeUndefined();
  expect(docker.formatPullProgress({})).toBeUndefined();
});

test('formatPullProgress should return formatted percentage', () => {
  expect(docker.formatPullProgress({ progressDetail: { current: 50, total: 200 } })).toBe(
    '50/200 (25%)',
  );
});

// --- sanitizeEndpointConfig ---

test('sanitizeEndpointConfig should return empty object for undefined config', () => {
  expect(docker.sanitizeEndpointConfig(undefined, 'abc')).toEqual({});
});

test('sanitizeEndpointConfig should copy IPAMConfig, Links, DriverOpts, MacAddress', () => {
  const config = {
    IPAMConfig: { IPv4Address: '10.0.0.5' },
    Links: ['link1'],
    DriverOpts: { opt: 'val' },
    MacAddress: '02:42:ac:11:00:02',
  };
  const result = docker.sanitizeEndpointConfig(config, 'abc');
  expect(result).toEqual(config);
});

// --- getPrimaryNetworkName ---

test('getPrimaryNetworkName should return NetworkMode when it exists in network names', () => {
  const container = { HostConfig: { NetworkMode: 'custom_net' } };
  expect(docker.getPrimaryNetworkName(container, ['bridge', 'custom_net'])).toBe('custom_net');
});

test('getPrimaryNetworkName should return first network when NetworkMode not in list', () => {
  const container = { HostConfig: { NetworkMode: 'host' } };
  expect(docker.getPrimaryNetworkName(container, ['bridge', 'custom'])).toBe('bridge');
});

// --- Lifecycle hooks ---

describe('lifecycle hooks', () => {
  beforeEach(() => {
    docker.configuration = { ...configurationValid, dryrun: false, prune: false };
    docker.log = log;
    stubTriggerFlow({ running: true });
    mockRunHook.mockReset();
    mockAuditCounterInc.mockReset();
  });

  test('trigger should run pre-hook before pull and post-hook after recreate', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.hook.pre': 'echo before', 'dd.hook.post': 'echo after' },
      }),
    );

    expect(mockRunHook).toHaveBeenCalledTimes(2);
    expect(mockRunHook).toHaveBeenCalledWith(
      'echo before',
      expect.objectContaining({ label: 'pre-update' }),
    );
    expect(mockRunHook).toHaveBeenCalledWith(
      'echo after',
      expect.objectContaining({ label: 'post-update' }),
    );
  });

  test('trigger should not call hooks when no hook labels are set', async () => {
    await docker.trigger(createTriggerContainer());

    expect(mockRunHook).not.toHaveBeenCalled();
  });

  test('trigger should abort when pre-hook fails and hookPreAbort is true (default)', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'err', timedOut: false });

    await expect(
      docker.trigger(
        createTriggerContainer({
          labels: { 'dd.hook.pre': 'exit 1' },
        }),
      ),
    ).rejects.toThrowError('Pre-update hook exited with code 1');

    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-pre-failed' });
  });

  test('trigger should continue when pre-hook fails and hookPreAbort is false', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'err', timedOut: false });

    await expect(
      docker.trigger(
        createTriggerContainer({
          labels: { 'dd.hook.pre': 'exit 1', 'dd.hook.pre.abort': 'false' },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-pre-failed' });
  });

  test('trigger should abort when pre-hook times out and hookPreAbort is true', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', timedOut: true });

    await expect(
      docker.trigger(
        createTriggerContainer({
          labels: { 'dd.hook.pre': 'sleep 100', 'dd.hook.timeout': '500' },
        }),
      ),
    ).rejects.toThrowError('Pre-update hook timed out after 500ms');
  });

  test('trigger should use wud.* labels as fallback', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'wud.hook.pre': 'echo legacy-pre', 'wud.hook.post': 'echo legacy-post' },
      }),
    );

    expect(mockRunHook).toHaveBeenCalledWith(
      'echo legacy-pre',
      expect.objectContaining({ label: 'pre-update' }),
    );
    expect(mockRunHook).toHaveBeenCalledWith(
      'echo legacy-post',
      expect.objectContaining({ label: 'post-update' }),
    );
  });

  test('trigger should not abort on post-hook failure', async () => {
    mockRunHook
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'post-err', timedOut: false });

    await expect(
      docker.trigger(
        createTriggerContainer({
          labels: { 'dd.hook.pre': 'echo before', 'dd.hook.post': 'exit 1' },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-pre-success' });
    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-post-failed' });
  });

  test('trigger should emit hook-post-success audit on successful post-hook', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: 'done', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.hook.post': 'echo done' },
      }),
    );

    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-post-success' });
  });

  test('trigger should pass hook environment variables', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.hook.pre': 'echo $DD_CONTAINER_NAME' },
      }),
    );

    expect(mockRunHook).toHaveBeenCalledWith(
      'echo $DD_CONTAINER_NAME',
      expect.objectContaining({
        env: expect.objectContaining({
          DD_CONTAINER_NAME: 'container-name',
          DD_IMAGE_NAME: 'test/test',
        }),
      }),
    );
  });

  test('trigger should use custom timeout from label', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.hook.pre': 'echo hi', 'dd.hook.timeout': '30000' },
      }),
    );

    expect(mockRunHook).toHaveBeenCalledWith(
      'echo hi',
      expect.objectContaining({ timeout: 30000 }),
    );
  });
});

// --- Auto-rollback / health monitor integration ---

describe('auto-rollback health monitor integration', () => {
  beforeEach(() => {
    docker.configuration = { ...configurationValid, dryrun: false, prune: false };
    docker.log = log;
    mockRunHook.mockReset();
    mockStartHealthMonitor.mockReset();
    mockStartHealthMonitor.mockReturnValue({ abort: vi.fn() });
  });

  test('trigger should start health monitor when dd.rollback.auto=true and HEALTHCHECK exists', async () => {
    stubTriggerFlow({
      running: true,
      inspectOverrides: { State: { Running: true, Health: { Status: 'healthy' } } },
    });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.rollback.auto': 'true' },
      }),
    );

    expect(mockStartHealthMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        containerId: '123456789',
        containerName: 'container-name',
        backupImageTag: '1.0.0',
        window: 300000,
        interval: 10000,
      }),
    );
  });

  test('trigger should NOT start health monitor when dd.rollback.auto is not set', async () => {
    stubTriggerFlow({ running: true });

    await docker.trigger(createTriggerContainer());

    expect(mockStartHealthMonitor).not.toHaveBeenCalled();
  });

  test('trigger should NOT start health monitor when dd.rollback.auto=false', async () => {
    stubTriggerFlow({ running: true });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.rollback.auto': 'false' },
      }),
    );

    expect(mockStartHealthMonitor).not.toHaveBeenCalled();
  });

  test('trigger should warn when auto-rollback enabled but no HEALTHCHECK', async () => {
    const warnSpy = vi.fn();
    const infoSpy = vi.fn();
    const debugSpy = vi.fn();
    docker.log = { child: () => ({ warn: warnSpy, info: infoSpy, debug: debugSpy }) };

    stubTriggerFlow({ running: true, inspectOverrides: { State: { Running: true } } });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.rollback.auto': 'true' },
      }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Auto-rollback enabled but container has no HEALTHCHECK defined'),
    );
    expect(mockStartHealthMonitor).not.toHaveBeenCalled();
  });

  test('trigger should use custom window and interval from labels', async () => {
    stubTriggerFlow({
      running: true,
      inspectOverrides: { State: { Running: true, Health: { Status: 'healthy' } } },
    });

    await docker.trigger(
      createTriggerContainer({
        labels: {
          'dd.rollback.auto': 'true',
          'dd.rollback.window': '60000',
          'dd.rollback.interval': '5000',
        },
      }),
    );

    expect(mockStartHealthMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        window: 60000,
        interval: 5000,
      }),
    );
  });

  test('trigger should use wud.* labels as fallback for auto-rollback', async () => {
    stubTriggerFlow({
      running: true,
      inspectOverrides: { State: { Running: true, Health: { Status: 'healthy' } } },
    });

    await docker.trigger(
      createTriggerContainer({
        labels: {
          'wud.rollback.auto': 'true',
          'wud.rollback.window': '120000',
          'wud.rollback.interval': '3000',
        },
      }),
    );

    expect(mockStartHealthMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        window: 120000,
        interval: 3000,
      }),
    );
  });
});

describe('getRollbackConfig timer validation', () => {
  beforeEach(() => {
    docker.log = {
      child: vi.fn().mockReturnValue({ warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    };
  });

  test('should return defaults when labels produce NaN', () => {
    const result = docker.getRollbackConfig({
      labels: {
        'dd.rollback.auto': 'true',
        'dd.rollback.window': 'abc',
        'dd.rollback.interval': 'xyz',
      },
    });
    expect(result.rollbackWindow).toBe(300000);
    expect(result.rollbackInterval).toBe(10000);
  });

  test('should return defaults when labels are negative', () => {
    const result = docker.getRollbackConfig({
      labels: {
        'dd.rollback.auto': 'true',
        'dd.rollback.window': '-5000',
        'dd.rollback.interval': '-1000',
      },
    });
    expect(result.rollbackWindow).toBe(300000);
    expect(result.rollbackInterval).toBe(10000);
  });

  test('should return defaults when labels are zero', () => {
    const result = docker.getRollbackConfig({
      labels: {
        'dd.rollback.auto': 'true',
        'dd.rollback.window': '0',
        'dd.rollback.interval': '0',
      },
    });
    expect(result.rollbackWindow).toBe(300000);
    expect(result.rollbackInterval).toBe(10000);
  });

  test('should use valid label values when provided', () => {
    const result = docker.getRollbackConfig({
      labels: {
        'dd.rollback.auto': 'true',
        'dd.rollback.window': '60000',
        'dd.rollback.interval': '5000',
      },
    });
    expect(result.rollbackWindow).toBe(60000);
    expect(result.rollbackInterval).toBe(5000);
  });

  test('should log warnings when falling back to defaults', () => {
    docker.getRollbackConfig({
      labels: {
        'dd.rollback.auto': 'true',
        'dd.rollback.window': 'bad',
        'dd.rollback.interval': '-1',
      },
    });
    const childLog = docker.log.child({});
    expect(childLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid rollback window label value'),
    );
    expect(childLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid rollback interval label value'),
    );
  });
});

describe('additional docker trigger coverage', () => {
  beforeEach(() => {
    docker.configuration = { ...configurationValid, dryrun: false, prune: false };
    docker.log = {
      child: vi.fn().mockReturnValue(createMockLog('info', 'warn', 'debug')),
    };
  });

  test('preview should return details when current container exists', async () => {
    const container = createTriggerContainer();
    vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue({ id: container.id });
    vi.spyOn(docker, 'inspectContainer').mockResolvedValue({
      State: { Running: true },
      NetworkSettings: { Networks: { bridge: {}, appnet: {} } },
    });

    const preview = await docker.preview(container);

    expect(preview).toMatchObject({
      containerName: 'container-name',
      newImage: 'my-registry/test/test:4.5.6',
      isRunning: true,
      networks: ['bridge', 'appnet'],
    });
  });

  test('preview should return an explicit error when container is not found', async () => {
    vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue(undefined);
    const preview = await docker.preview(createTriggerContainer());
    expect(preview).toEqual({ error: 'Container not found in Docker' });
  });

  test('preview should fallback to empty network list when NetworkSettings are missing', async () => {
    const container = createTriggerContainer();
    vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue({ id: container.id });
    vi.spyOn(docker, 'inspectContainer').mockResolvedValue({
      State: { Running: true },
    });

    const preview = await docker.preview(container);
    expect(preview.networks).toEqual([]);
  });

  test('maybeNotifySelfUpdate should wait before proceeding for drydock image', async () => {
    vi.useFakeTimers();
    try {
      const logContainer = createMockLog('info');
      const notifyPromise = docker.maybeNotifySelfUpdate(
        {
          image: {
            name: 'drydock',
          },
        },
        logContainer,
      );
      await vi.advanceTimersByTimeAsync(500);
      await notifyPromise;
      expect(logContainer.info).toHaveBeenCalledWith(
        'Self-update detected — notifying UI before proceeding',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test('maybeNotifySelfUpdate should no-op for non-drydock images', async () => {
    const logContainer = createMockLog('info');

    await expect(
      docker.maybeNotifySelfUpdate(
        {
          image: {
            name: 'nginx',
          },
        },
        logContainer,
      ),
    ).resolves.toBeUndefined();

    expect(logContainer.info).not.toHaveBeenCalled();
  });

  test('cleanupOldImages should remove digest image when prune is enabled and digest repo exists', async () => {
    docker.configuration.prune = true;
    const removeImageSpy = vi.spyOn(docker, 'removeImage').mockResolvedValue(undefined);
    const registryProvider = {
      getImageFullName: vi.fn(() => 'my-registry/test/test:sha256:old'),
    };

    await docker.cleanupOldImages(
      {},
      registryProvider,
      {
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/test',
          tag: { value: '1.0.0' },
          digest: { repo: 'sha256:old' },
        },
        updateKind: {
          kind: 'digest',
        },
      },
      createMockLog('debug'),
    );

    expect(removeImageSpy).toHaveBeenCalledWith(
      {},
      'my-registry/test/test:sha256:old',
      expect.any(Object),
    );
  });

  test('cleanupOldImages should skip digest pruning when digest repo is missing', async () => {
    docker.configuration.prune = true;
    const removeImageSpy = vi.spyOn(docker, 'removeImage').mockResolvedValue(undefined);

    await docker.cleanupOldImages(
      {},
      {
        getImageFullName: vi.fn(() => 'unused'),
      },
      {
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/test',
          tag: { value: '1.0.0' },
          digest: {},
        },
        updateKind: {
          kind: 'digest',
        },
      },
      createMockLog('debug'),
    );

    expect(removeImageSpy).not.toHaveBeenCalled();
  });

  test('buildHookConfig should default update env values to empty strings when missing', () => {
    const hookConfig = docker.buildHookConfig({
      id: 'container-id',
      name: 'container-name',
      image: {
        name: 'repo/name',
        tag: {
          value: '1.0.0',
        },
      },
      updateKind: {
        kind: 'unknown',
      },
      labels: {},
    });

    expect(hookConfig.hookEnv.DD_UPDATE_FROM).toBe('');
    expect(hookConfig.hookEnv.DD_UPDATE_TO).toBe('');
  });

  test('maybeStartAutoRollbackMonitor should return early when recreated container is missing', async () => {
    const getCurrentContainerSpy = vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue(null);
    const inspectContainerSpy = vi.spyOn(docker, 'inspectContainer');

    await docker.maybeStartAutoRollbackMonitor(
      {},
      {
        id: 'container-id',
        name: 'container-name',
        image: {
          tag: { value: '1.0.0' },
          digest: { repo: 'sha256:old' },
        },
      },
      {
        autoRollback: true,
        rollbackWindow: 10_000,
        rollbackInterval: 1_000,
      },
      createMockLog('info', 'warn'),
    );

    expect(getCurrentContainerSpy).toHaveBeenCalled();
    expect(inspectContainerSpy).not.toHaveBeenCalled();
  });
});

// --- Self-update ---

describe('isSelfUpdate', () => {
  test('should return true for drydock image', () => {
    expect(docker.isSelfUpdate({ image: { name: 'drydock' } })).toBe(true);
  });

  test('should return true for namespaced drydock image', () => {
    expect(docker.isSelfUpdate({ image: { name: 'codeswhat/drydock' } })).toBe(true);
  });

  test('should return false for non-drydock image', () => {
    expect(docker.isSelfUpdate({ image: { name: 'nginx' } })).toBe(false);
  });

  test('should return false for image name containing drydock as substring', () => {
    expect(docker.isSelfUpdate({ image: { name: 'drydock-proxy' } })).toBe(false);
  });
});

describe('findDockerSocketBind', () => {
  test('should find docker socket bind', () => {
    const spec = {
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      },
    };
    expect(docker.findDockerSocketBind(spec)).toBe('/var/run/docker.sock');
  });

  test('should find docker socket with custom host path', () => {
    const spec = {
      HostConfig: {
        Binds: ['/run/user/1000/docker.sock:/var/run/docker.sock'],
      },
    };
    expect(docker.findDockerSocketBind(spec)).toBe('/run/user/1000/docker.sock');
  });

  test('should return undefined when no binds', () => {
    expect(docker.findDockerSocketBind({ HostConfig: {} })).toBeUndefined();
  });

  test('should return undefined when no docker socket bind', () => {
    const spec = {
      HostConfig: {
        Binds: ['/data:/data'],
      },
    };
    expect(docker.findDockerSocketBind(spec)).toBeUndefined();
  });

  test('should return undefined when Binds is not an array', () => {
    expect(docker.findDockerSocketBind({ HostConfig: { Binds: null } })).toBeUndefined();
  });
});

describe('executeSelfUpdate', () => {
  function createSelfUpdateContext(overrides = {}) {
    const mockHelperContainer = { start: vi.fn().mockResolvedValue(undefined) };
    const mockNewContainer = {
      start: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ Id: 'new-container-id' }),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    const dockerApi = {
      createContainer: vi.fn().mockResolvedValue(mockHelperContainer),
      getContainer: vi.fn(),
      pull: vi.fn().mockResolvedValue(undefined),
      modem: { followProgress: (_s, res) => res() },
    };

    const currentContainer = {
      rename: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        Id: 'old-container-id',
        Name: '/drydock',
        State: { Running: true },
      }),
    };

    const currentContainerSpec = {
      Id: 'old-container-id',
      Name: '/drydock',
      Config: { Image: 'ghcr.io/codeswhat/drydock:1.0.0' },
      State: { Running: true },
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      },
      NetworkSettings: { Networks: {} },
    };

    vi.spyOn(docker, 'pullImage').mockResolvedValue(undefined);
    vi.spyOn(docker, 'cloneContainer').mockReturnValue({ name: 'drydock' });
    vi.spyOn(docker, 'createContainer').mockResolvedValue(mockNewContainer);

    return {
      dockerApi,
      registry: { getImageFullName: vi.fn() },
      auth: undefined,
      newImage: 'ghcr.io/codeswhat/drydock:2.0.0',
      currentContainer,
      currentContainerSpec,
      _mockHelperContainer: mockHelperContainer,
      _mockNewContainer: mockNewContainer,
      ...overrides,
    };
  }

  test('should rename old container, create new, and spawn helper', async () => {
    const context = createSelfUpdateContext();
    const logContainer = createMockLog('info', 'warn', 'debug');
    const container = createTriggerContainer({
      image: {
        name: 'codeswhat/drydock',
        registry: { name: 'ghcr' },
        tag: { value: '1.0.0' },
        digest: {},
      },
    });

    const result = await docker.executeSelfUpdate(context, container, logContainer);

    expect(result).toBe(true);
    expect(context.currentContainer.rename).toHaveBeenCalledWith({
      name: expect.stringContaining('drydock-old-'),
    });
    expect(docker.createContainer).toHaveBeenCalled();
    const helperCall = context.dockerApi.createContainer.mock.calls.find(
      (call) => call[0]?.Cmd?.[0] === 'sh',
    );
    expect(helperCall).toBeDefined();
    const script = helperCall[0].Cmd[2];
    expect(script).toContain('stop');
    expect(script).toContain('start');
    // Verify fallback: if new start fails, old is restarted
    expect(script).toMatch(/\(.*start.*\|\|.*start.*\)/);
    expect(helperCall[0].HostConfig.AutoRemove).toBe(true);
    expect(context._mockHelperContainer.start).toHaveBeenCalled();
  });

  test('should rollback rename when createContainer fails', async () => {
    const context = createSelfUpdateContext();
    const logContainer = createMockLog('info', 'warn', 'debug');
    const container = createTriggerContainer({
      image: {
        name: 'codeswhat/drydock',
        registry: { name: 'ghcr' },
        tag: { value: '1.0.0' },
        digest: {},
      },
    });

    vi.spyOn(docker, 'createContainer').mockRejectedValue(new Error('create failed'));

    await expect(docker.executeSelfUpdate(context, container, logContainer)).rejects.toThrow(
      'create failed',
    );

    // Verify rollback: old container renamed back to original name
    expect(context.currentContainer.rename).toHaveBeenCalledTimes(2);
    expect(context.currentContainer.rename).toHaveBeenLastCalledWith({ name: 'drydock' });
  });

  test('should rollback when helper container spawn fails', async () => {
    const context = createSelfUpdateContext();
    const logContainer = createMockLog('info', 'warn', 'debug');
    const container = createTriggerContainer({
      image: {
        name: 'codeswhat/drydock',
        registry: { name: 'ghcr' },
        tag: { value: '1.0.0' },
        digest: {},
      },
    });

    // First call is createContainer for the new drydock container (via spy on docker.createContainer)
    // Second call is dockerApi.createContainer for the helper — make it fail
    context.dockerApi.createContainer.mockRejectedValue(new Error('helper spawn failed'));

    await expect(docker.executeSelfUpdate(context, container, logContainer)).rejects.toThrow(
      'helper spawn failed',
    );

    // Verify rollback: new container removed, old renamed back
    expect(context._mockNewContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(context.currentContainer.rename).toHaveBeenLastCalledWith({ name: 'drydock' });
  });

  test('should rollback when inspecting new container fails', async () => {
    const context = createSelfUpdateContext();
    const logContainer = createMockLog('info', 'warn', 'debug');
    const container = createTriggerContainer({
      image: {
        name: 'codeswhat/drydock',
        registry: { name: 'ghcr' },
        tag: { value: '1.0.0' },
        digest: {},
      },
    });

    context._mockNewContainer.inspect.mockRejectedValue(new Error('inspect failed'));

    await expect(docker.executeSelfUpdate(context, container, logContainer)).rejects.toThrow(
      'inspect failed',
    );

    expect(context._mockNewContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(context.currentContainer.rename).toHaveBeenLastCalledWith({ name: 'drydock' });
    expect(context.dockerApi.createContainer).not.toHaveBeenCalled();
  });

  test('should throw when docker socket bind not found', async () => {
    const context = createSelfUpdateContext();
    context.currentContainerSpec.HostConfig.Binds = ['/data:/data'];
    const logContainer = createMockLog('info', 'warn', 'debug');
    const container = createTriggerContainer({
      image: {
        name: 'codeswhat/drydock',
        registry: { name: 'ghcr' },
        tag: { value: '1.0.0' },
        digest: {},
      },
    });

    await expect(docker.executeSelfUpdate(context, container, logContainer)).rejects.toThrow(
      'Self-update requires the Docker socket',
    );
  });

  test('should return false in dryrun mode', async () => {
    docker.configuration = { ...configurationValid, dryrun: true };
    const context = createSelfUpdateContext();
    const logContainer = createMockLog('info', 'warn', 'debug');
    const container = createTriggerContainer({
      image: {
        name: 'codeswhat/drydock',
        registry: { name: 'ghcr' },
        tag: { value: '1.0.0' },
        digest: {},
      },
    });

    const result = await docker.executeSelfUpdate(context, container, logContainer);

    expect(result).toBe(false);
    expect(context.currentContainer.rename).not.toHaveBeenCalled();
  });
});

describe('trigger self-update routing', () => {
  test('should route to executeSelfUpdate for drydock image', async () => {
    stubTriggerFlow({ running: true });
    const executeSelfUpdateSpy = vi.spyOn(docker, 'executeSelfUpdate').mockResolvedValue(true);
    const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

    await docker.trigger(
      createTriggerContainer({
        image: {
          name: 'codeswhat/drydock',
          registry: { name: 'hub', url: 'my-registry' },
          tag: { value: '1.0.0' },
        },
      }),
    );

    expect(executeSelfUpdateSpy).toHaveBeenCalled();
    expect(executeContainerUpdateSpy).not.toHaveBeenCalled();
  });

  test('should route to executeContainerUpdate for non-drydock image', async () => {
    stubTriggerFlow({ running: true });
    const executeSelfUpdateSpy = vi.spyOn(docker, 'executeSelfUpdate');
    const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

    await docker.trigger(createTriggerContainer());

    expect(executeContainerUpdateSpy).toHaveBeenCalled();
    expect(executeSelfUpdateSpy).not.toHaveBeenCalled();
  });

  test('should stop trigger flow when self-update returns false', async () => {
    stubTriggerFlow({ running: true });
    const maybeNotifySelfUpdateSpy = vi
      .spyOn(docker, 'maybeNotifySelfUpdate')
      .mockResolvedValue(undefined);
    const executeSelfUpdateSpy = vi.spyOn(docker, 'executeSelfUpdate').mockResolvedValue(false);
    const executeContainerUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate');

    await expect(
      docker.trigger(
        createTriggerContainer({
          image: {
            name: 'codeswhat/drydock',
            registry: { name: 'hub', url: 'my-registry' },
            tag: { value: '1.0.0' },
          },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(maybeNotifySelfUpdateSpy).toHaveBeenCalled();
    expect(executeSelfUpdateSpy).toHaveBeenCalled();
    expect(executeContainerUpdateSpy).not.toHaveBeenCalled();
  });
});
