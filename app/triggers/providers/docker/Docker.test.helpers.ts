import log from '../../../log/index.js';
import Docker from './Docker.js';

export { log };

export const configurationValid = {
  prune: false,
  dryrun: false,
  threshold: 'all',
  mode: 'simple',
  once: true,
  auto: 'all',
  order: 100,
  autoremovetimeout: 10000,
  backupcount: 3,
  simpletitle: 'New ${container.updateKind.kind} found for container ${container.name}',
  simplebody:
    'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',
  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
  digestcron: '0 8 * * *',
};

export const docker = new Docker();
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
  clearDigestScanCache: vi.fn(),
  getDigestScanCacheSize: vi.fn().mockReturnValue(0),
  updateDigestScanCache: vi.fn(),
  scanImageWithDedup: vi.fn(),
}));

vi.mock('../../../store/container.js', () => ({
  getContainer: vi.fn(),
  updateContainer: vi.fn((container) => container),
  cacheSecurityState: vi.fn(),
}));

vi.mock('../../../store/backup', () => ({
  insertBackup: vi.fn(),
  pruneOldBackups: vi.fn(),
  getBackupsByName: vi.fn().mockReturnValue([]),
}));

const mockRunHook = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/HookRunner.js', () => ({
  runHook: mockRunHook,
}));

const mockStartHealthMonitor = vi.hoisted(() => vi.fn().mockReturnValue({ abort: vi.fn() }));
vi.mock('./HealthMonitor.js', () => ({
  startHealthMonitor: mockStartHealthMonitor,
}));

const mockInsertAudit = vi.hoisted(() => vi.fn());
vi.mock('../../../store/audit.js', () => ({
  insertAudit: (...args: any[]) => mockInsertAudit(...args),
}));

const mockAuditCounterInc = vi.hoisted(() => vi.fn());
vi.mock('../../../prometheus/audit.js', () => ({
  getAuditCounter: () => ({ inc: mockAuditCounterInc }),
}));

const mockRollbackCounterInc = vi.hoisted(() => vi.fn());
const mockGetRollbackCounter = vi.hoisted(() => vi.fn());
vi.mock('../../../prometheus/rollback.js', () => ({
  getRollbackCounter: (...args: any[]) => mockGetRollbackCounter(...args),
}));

const mockInsertOperation = vi.hoisted(() => vi.fn());
const mockUpdateOperation = vi.hoisted(() => vi.fn());
const mockGetInProgressOperationByContainerName = vi.hoisted(() => vi.fn());
vi.mock('../../../store/update-operation.js', () => ({
  insertOperation: (...args: any[]) => mockInsertOperation(...args),
  updateOperation: (...args: any[]) => mockUpdateOperation(...args),
  getInProgressOperationByContainerName: (...args: any[]) =>
    mockGetInProgressOperationByContainerName(...args),
}));

const mockSyncComposeFileTag = vi.hoisted(() => vi.fn().mockResolvedValue(false));
vi.mock('./compose-file-sync.js', () => ({
  syncComposeFileTag: (...args: any[]) => mockSyncComposeFileTag(...args),
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
                  rename: () => Promise.resolve(),
                });
              }
              return Promise.reject(new Error('Error when getting container'));
            },
            createContainer: (container) => {
              if (container.name === 'container-name') {
                return Promise.resolve({
                  start: () => Promise.resolve(),
                  inspect: () =>
                    Promise.resolve({
                      Id: 'new-container-id',
                      State: { Health: { Status: 'healthy' } },
                    }),
                  stop: () => Promise.resolve(),
                  remove: () => Promise.resolve(),
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
          normalizeImage: (image) => ({
            ...image,
            registry: {
              ...(image.registry || {}),
              name: 'hub',
            },
          }),
          getImageFullName: (image, tagOrDigest) =>
            `${image.registry.url}/${image.name}:${tagOrDigest}`,
        },
      },
    };
  },
}));

// --- Shared factories and helpers ---

/** Build a mock dockerApi for pruneImages tests */
export function createPruneDockerApi(images, removeSpy = vi.fn().mockResolvedValue(undefined)) {
  return {
    listImages: vi.fn().mockResolvedValue(images),
    getImage: vi.fn().mockReturnValue({ name: 'image-to-remove', remove: removeSpy }),
  };
}

/** Standard normalizeImage mock that echoes registry name, image name, and tag */
export function createEchoNormalizeRegistry(registryName = 'ecr') {
  return {
    normalizeImage: (img) => ({
      registry: { name: registryName },
      name: img.name,
      tag: { value: img.tag.value },
    }),
  };
}

/** Default container fixture for pruneImages tests */
export function createPruneContainer(overrides = {}) {
  return {
    image: { registry: { name: 'ecr' }, name: 'repo', tag: { value: '1.0.0' } },
    updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
    ...overrides,
  };
}

/** Build a container payload for trigger tests */
export function createTriggerContainer(overrides = {}) {
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

export function createSecurityScanResult(overrides = {}) {
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

export function createSignatureVerificationResult(overrides = {}) {
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

export function createSbomResult(overrides = {}) {
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

export function createSecurityConfiguration(overrides = {}) {
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
export function stubTriggerFlow(opts = {}) {
  const { running = false, autoRemove = false, inspectOverrides = {} } = opts;

  const waitSpy = vi.fn().mockResolvedValue();
  vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue({
    inspect: () => Promise.resolve(),
    remove: vi.fn(),
    stop: () => Promise.resolve(),
    rename: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
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
  vi.spyOn(docker, 'createContainer').mockResolvedValue({
    start: vi.fn(),
    inspect: vi.fn().mockResolvedValue({
      Id: 'new-container-id',
      State: { Health: { Status: 'healthy' } },
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  });
  vi.spyOn(docker, 'startContainer').mockResolvedValue();
  const removeImageSpy = vi.spyOn(docker, 'removeImage').mockResolvedValue();

  return { waitSpy, removeImageSpy };
}

/** Create a mock log with common methods */
export function createMockLog(...methods) {
  const mockLog = {};
  for (const m of methods) {
    mockLog[m] = vi.fn();
  }
  return mockLog;
}

export function registerCommonDockerBeforeEach() {
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
    mockGetRollbackCounter.mockReturnValue({ inc: mockRollbackCounterInc });
    mockInsertOperation.mockImplementation((operation) => ({
      id: operation.id || 'op-1',
      status: operation.status || 'in-progress',
      phase: operation.phase || 'prepare',
      createdAt: operation.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...operation,
    }));
    mockUpdateOperation.mockImplementation((id, patch = {}) => ({ id, ...patch }));
    mockGetInProgressOperationByContainerName.mockReturnValue(undefined);
  });
}

export function getDockerTestMocks() {
  return {
    mockGetSecurityConfiguration,
    mockScanImageForVulnerabilities,
    mockVerifyImageSignature,
    mockGenerateImageSbom,
    mockRunHook,
    mockStartHealthMonitor,
    mockInsertAudit,
    mockAuditCounterInc,
    mockRollbackCounterInc,
    mockGetRollbackCounter,
    mockInsertOperation,
    mockUpdateOperation,
    mockGetInProgressOperationByContainerName,
    mockSyncComposeFileTag,
  };
}
