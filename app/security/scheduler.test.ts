import { CronExpressionParser } from 'cron-parser';
import { vi } from 'vitest';
import { MS_PER_DAY } from '../model/maturity-policy.js';

const mockGetSecurityConfiguration = vi.hoisted(() => vi.fn());
const mockGetContainers = vi.hoisted(() => vi.fn());
const mockGetContainersRaw = vi.hoisted(() => vi.fn());
const mockGetContainerRaw = vi.hoisted(() => vi.fn());
const mockUpdateContainer = vi.hoisted(() => vi.fn());
const mockScanImageWithDedup = vi.hoisted(() => vi.fn());
const mockClearDigestScanCache = vi.hoisted(() => vi.fn());
const mockGetTrivyDatabaseStatus = vi.hoisted(() => vi.fn());
const mockBroadcastScanStarted = vi.hoisted(() => vi.fn());
const mockBroadcastScanCompleted = vi.hoisted(() => vi.fn());
const mockResolveContainerImageFullName = vi.hoisted(() => vi.fn());
const mockResolveContainerRegistryAuth = vi.hoisted(() => vi.fn());
const mockGetState = vi.hoisted(() => vi.fn());
const mockCronSchedule = vi.hoisted(() => vi.fn());
const mockCronValidate = vi.hoisted(() => vi.fn());
const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());
const mockLogDebug = vi.hoisted(() => vi.fn());
const mockEmitSecurityAlert = vi.hoisted(() => vi.fn(async () => {}));
const mockEmitSecurityScanCycleComplete = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../configuration/index.js', () => ({
  getSecurityConfiguration: mockGetSecurityConfiguration,
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({
      info: mockLogInfo,
      warn: mockLogWarn,
      error: mockLogError,
      debug: mockLogDebug,
    }),
  },
}));

vi.mock('../log/sanitize.js', () => ({
  sanitizeLogParam: (v: unknown) => v,
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: (...args: unknown[]) => mockCronSchedule(...args),
    validate: (...args: unknown[]) => mockCronValidate(...args),
  },
}));

vi.mock('../registry/index.js', () => ({
  getState: (...args: unknown[]) => mockGetState(...args),
}));

vi.mock('../api/container/shared.js', () => ({
  resolveContainerImageFullName: (...args: unknown[]) => mockResolveContainerImageFullName(...args),
  resolveContainerRegistryAuth: (...args: unknown[]) => mockResolveContainerRegistryAuth(...args),
}));

vi.mock('../api/sse.js', () => ({
  broadcastScanStarted: (...args: unknown[]) => mockBroadcastScanStarted(...args),
  broadcastScanCompleted: (...args: unknown[]) => mockBroadcastScanCompleted(...args),
}));

vi.mock('../store/container.js', () => ({
  getContainers: (...args: unknown[]) => mockGetContainers(...args),
  getContainersRaw: (...args: unknown[]) => mockGetContainersRaw(...args),
  getContainerRaw: (...args: unknown[]) => mockGetContainerRaw(...args),
  cloneContainer: (container: unknown) => structuredClone(container),
  updateContainer: (...args: unknown[]) => mockUpdateContainer(...args),
}));

vi.mock('./scan.js', () => ({
  scanImageWithDedup: (...args: unknown[]) => mockScanImageWithDedup(...args),
  clearDigestScanCache: (...args: unknown[]) => mockClearDigestScanCache(...args),
}));

vi.mock('./runtime.js', () => ({
  getTrivyDatabaseStatus: (...args: unknown[]) => mockGetTrivyDatabaseStatus(...args),
}));

vi.mock('../event/index.js', () => ({
  emitSecurityAlert: (...args: unknown[]) => mockEmitSecurityAlert(...args),
  emitSecurityScanCycleComplete: (...args: unknown[]) => mockEmitSecurityScanCycleComplete(...args),
}));

import {
  _isScanInProgress,
  _resetForTesting,
  init,
  isRunning,
  runScheduledScans,
  shutdown,
} from './scheduler.js';

// A lightweight in-memory store keyed by container id, used to back the
// default mockGetContainerRaw implementation without calling any other mock
// (which would disturb call-count assertions on mockGetContainers /
// mockGetContainersRaw in tests that check the scheduler uses the raw list API).
const testContainerById = new Map<string, unknown>();

function setMockContainersRaw(containers: Array<{ id: string }>) {
  testContainerById.clear();
  for (const c of containers) {
    testContainerById.set(c.id, c);
  }
  mockGetContainersRaw.mockReturnValue(containers);
}

function createEnabledConfiguration() {
  return {
    enabled: true,
    scanner: 'trivy',
    blockSeverities: ['CRITICAL', 'HIGH'],
    trivy: { server: '', command: 'trivy', timeout: 120000 },
    signature: {
      verify: false,
      cosign: { command: 'cosign', timeout: 60000, key: '', identity: '', issuer: '' },
    },
    sbom: { enabled: false, formats: ['spdx-json'] },
    scan: {
      cron: '0 3 * * *',
      jitter: 60000,
      concurrency: 1,
      batchTimeout: 0,
      notifications: true,
    },
  };
}

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'nginx',
    watcher: 'local',
    image: {
      id: 'sha256:abc',
      registry: { name: 'hub', url: 'docker.io' },
      name: 'library/nginx',
      tag: { value: '1.25', semver: true },
      digest: { watch: true, value: 'sha256:abc123' },
      architecture: 'amd64',
      os: 'linux',
    },
    security: {},
    updateAvailable: false,
    updateKind: { kind: 'unknown' },
    ...overrides,
  };
}

function createScanResult(overrides: Record<string, unknown> = {}) {
  return {
    scanner: 'trivy',
    image: 'docker.io/library/nginx:1.25',
    scannedAt: '2026-03-04T03:00:00.000Z',
    status: 'passed',
    blockSeverities: ['CRITICAL', 'HIGH'],
    blockingCount: 0,
    summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    vulnerabilities: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  testContainerById.clear();
  _resetForTesting();
  mockGetContainersRaw.mockImplementation((...args: unknown[]) => {
    const result = mockGetContainers(...args) as Array<{ id: string }> | undefined;
    // Keep testContainerById in sync so mockGetContainerRaw can do id lookups
    // without calling any other mock (which would disturb call-count assertions
    // in tests that verify the scheduler uses only the raw list APIs).
    if (result) {
      testContainerById.clear();
      for (const c of result) {
        testContainerById.set(c.id, c);
      }
    }
    return result;
  });
  mockGetContainerRaw.mockImplementation((id: string) => testContainerById.get(id));
  mockGetState.mockReturnValue({ registry: {} });
  mockResolveContainerImageFullName.mockReturnValue('docker.io/library/nginx:1.25');
  mockResolveContainerRegistryAuth.mockResolvedValue(undefined);
  mockGetSecurityConfiguration.mockReturnValue(createEnabledConfiguration());
  mockGetTrivyDatabaseStatus.mockResolvedValue({ updatedAt: '2026-03-04T02:55:00.000Z' });
});

describe('init', () => {
  test('should create a cron schedule when cron is configured', () => {
    mockCronValidate.mockReturnValue(true);
    const mockTask = { stop: vi.fn() };
    mockCronSchedule.mockReturnValue(mockTask);

    init();

    expect(mockCronValidate).toHaveBeenCalledWith('0 3 * * *');
    expect(mockCronSchedule).toHaveBeenCalledWith('0 3 * * *', expect.any(Function), {
      maxRandomDelay: 60000,
    });
    expect(isRunning()).toBe(true);
  });

  test('should no-op when cron is not configured', () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '', jitter: 60000 },
    });

    init();

    expect(mockCronSchedule).not.toHaveBeenCalled();
    expect(isRunning()).toBe(false);
    expect(mockLogInfo).toHaveBeenCalledWith(
      'Scheduled security scanning not configured (DD_SECURITY_SCAN_CRON not set)',
    );
  });

  test('should warn and return when cron expression is invalid', () => {
    mockCronValidate.mockReturnValue(false);

    init();

    expect(mockCronValidate).toHaveBeenCalledWith('0 3 * * *');
    expect(mockCronSchedule).not.toHaveBeenCalled();
    expect(isRunning()).toBe(false);
    expect(mockLogWarn).toHaveBeenCalledWith(
      'Invalid cron expression for DD_SECURITY_SCAN_CRON: "0 3 * * *"',
    );
  });

  test('should no-op when scanner is disabled', () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      enabled: false,
      scanner: 'trivy',
      scan: { cron: '0 3 * * *', jitter: 60000 },
    });

    init();

    expect(mockCronSchedule).not.toHaveBeenCalled();
    expect(isRunning()).toBe(false);
    expect(mockLogInfo).toHaveBeenCalledWith(
      'Security scanner not enabled, scheduled scanning disabled',
    );
  });

  test('should schedule scans when Grype is configured', () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scanner: 'grype',
      scan: { cron: '0 3 * * *', jitter: 60000 },
    });
    mockCronValidate.mockReturnValue(true);
    mockCronSchedule.mockReturnValue({ stop: vi.fn() });

    init();

    expect(mockCronSchedule).toHaveBeenCalled();
    expect(isRunning()).toBe(true);
  });

  test('should invoke runScheduledScans when cron fires', async () => {
    mockCronValidate.mockReturnValue(true);
    let cronCallback: () => void;
    mockCronSchedule.mockImplementation((_expr: string, cb: () => void) => {
      cronCallback = cb;
      return { stop: vi.fn() };
    });
    mockGetContainers.mockReturnValue([]);

    init();

    // Fire the cron callback
    cronCallback!();

    // Wait for the async runScheduledScans to complete
    await vi.waitFor(() => {
      expect(mockGetContainers).toHaveBeenCalled();
    });
  });

  test('should catch errors thrown by runScheduledScans in the cron callback', async () => {
    mockCronValidate.mockReturnValue(true);
    let cronCallback: () => void;
    mockCronSchedule.mockImplementation((_expr: string, cb: () => void) => {
      cronCallback = cb;
      return { stop: vi.fn() };
    });
    mockGetContainersRaw.mockImplementation(() => {
      throw new Error('scan exploded');
    });

    init();
    // Should not throw
    cronCallback!();

    await vi.waitFor(() => {
      expect(mockLogWarn).toHaveBeenCalledWith('Scheduled scan run failed: scan exploded');
    });
  });

  test('should catch non-Error thrown by runScheduledScans in the cron callback', async () => {
    mockCronValidate.mockReturnValue(true);
    let cronCallback: () => void;
    mockCronSchedule.mockImplementation((_expr: string, cb: () => void) => {
      cronCallback = cb;
      return { stop: vi.fn() };
    });
    mockGetContainersRaw.mockImplementation(() => {
      throw 'string error';
    });

    init();
    cronCallback!();

    await vi.waitFor(() => {
      expect(mockLogWarn).toHaveBeenCalledWith('Scheduled scan run failed: string error');
    });
  });

  test('should include message from object-like errors thrown by runScheduledScans in the cron callback', async () => {
    mockCronValidate.mockReturnValue(true);
    let cronCallback: () => void;
    mockCronSchedule.mockImplementation((_expr: string, cb: () => void) => {
      cronCallback = cb;
      return { stop: vi.fn() };
    });
    mockGetContainersRaw.mockImplementation(() => {
      throw { message: 'scan exploded' };
    });

    init();
    cronCallback!();

    await vi.waitFor(() => {
      expect(mockLogWarn).toHaveBeenCalledWith('Scheduled scan run failed: scan exploded');
    });
  });
});

describe('runScheduledScans', () => {
  test('should compute cron interval once across scan runs', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3 15 * *', jitter: 60000, concurrency: 1, batchTimeout: 0 },
    });
    const parseExpressionSpy = vi.spyOn(CronExpressionParser, 'parse');
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({ scanResult: createScanResult(), fromCache: false });

    try {
      await runScheduledScans();
      await runScheduledScans();
      expect(parseExpressionSpy).toHaveBeenCalledTimes(1);
    } finally {
      parseExpressionSpy.mockRestore();
    }
  });

  test('should cache security configuration across scan runs', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({ scanResult: createScanResult(), fromCache: false });

    await runScheduledScans();
    await runScheduledScans();

    expect(mockGetSecurityConfiguration).toHaveBeenCalledTimes(1);
  });

  test('should read containers from raw store API for scheduled scans', async () => {
    const container = createContainer();
    setMockContainersRaw([container]);
    mockScanImageWithDedup.mockResolvedValue({ scanResult: createScanResult(), fromCache: false });

    await runScheduledScans();

    expect(mockGetContainersRaw).toHaveBeenCalledTimes(1);
    expect(mockGetContainers).not.toHaveBeenCalled();
  });

  test('should process digest scans with configured concurrency', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3 * * *', jitter: 60000, concurrency: 2, batchTimeout: 0 },
    });
    const container1 = createContainer({ id: 'c1' });
    const container2 = createContainer({
      id: 'c2',
      name: 'redis',
      image: {
        ...createContainer().image,
        name: 'library/redis',
        digest: { watch: true, value: 'sha256:def456' },
      },
    });
    const container3 = createContainer({
      id: 'c3',
      name: 'postgres',
      image: {
        ...createContainer().image,
        name: 'library/postgres',
        digest: { watch: true, value: 'sha256:ghi789' },
      },
    });
    mockGetContainers.mockReturnValue([container1, container2, container3]);

    const resolvers: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    mockScanImageWithDedup.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          resolvers.push(() => {
            inFlight -= 1;
            resolve({ scanResult: createScanResult(), fromCache: false });
          });
        }),
    );

    const scanPromise = runScheduledScans();

    await vi.waitFor(() => {
      expect(mockScanImageWithDedup).toHaveBeenCalledTimes(2);
    });
    expect(maxInFlight).toBe(2);

    resolvers[0]?.();
    resolvers[1]?.();

    await vi.waitFor(() => {
      expect(mockScanImageWithDedup).toHaveBeenCalledTimes(3);
    });

    resolvers[2]?.();
    await scanPromise;
    expect(mockUpdateContainer).toHaveBeenCalledTimes(3);
  });

  test('should cap worker count to the number of digests', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3 * * *', jitter: 60000, concurrency: 5, batchTimeout: 0 },
    });
    const container1 = createContainer({ id: 'c1' });
    const container2 = createContainer({
      id: 'c2',
      name: 'redis',
      image: {
        ...createContainer().image,
        name: 'library/redis',
        digest: { watch: true, value: 'sha256:def456' },
      },
    });
    mockGetContainers.mockReturnValue([container1, container2]);

    const resolvers: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    mockScanImageWithDedup.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          resolvers.push(() => {
            inFlight -= 1;
            resolve({ scanResult: createScanResult(), fromCache: false });
          });
        }),
    );

    const scanPromise = runScheduledScans();

    await vi.waitFor(() => {
      expect(mockScanImageWithDedup).toHaveBeenCalledTimes(2);
    });
    expect(maxInFlight).toBe(2);

    resolvers[0]?.();
    resolvers[1]?.();

    await scanPromise;
    expect(mockScanImageWithDedup).toHaveBeenCalledTimes(2);
  });

  test('should clamp scan concurrency to at least one worker', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3 * * *', jitter: 60000, concurrency: 0, batchTimeout: 0 },
    });
    const container1 = createContainer({ id: 'c1' });
    const container2 = createContainer({
      id: 'c2',
      name: 'redis',
      image: {
        ...createContainer().image,
        name: 'library/redis',
        digest: { watch: true, value: 'sha256:def456' },
      },
    });
    mockGetContainers.mockReturnValue([container1, container2]);

    const resolvers: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    mockScanImageWithDedup.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          resolvers.push(() => {
            inFlight -= 1;
            resolve({ scanResult: createScanResult(), fromCache: false });
          });
        }),
    );

    const scanPromise = runScheduledScans();

    await vi.waitFor(() => {
      expect(mockScanImageWithDedup).toHaveBeenCalledTimes(1);
    });
    expect(maxInFlight).toBe(1);

    resolvers[0]?.();

    await vi.waitFor(() => {
      expect(mockScanImageWithDedup).toHaveBeenCalledTimes(2);
    });

    resolvers[1]?.();
    await scanPromise;
  });

  test('should stop queueing new digest scans once batch timeout elapses', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3 * * *', jitter: 60000, concurrency: 1, batchTimeout: 30 },
    });
    const container1 = createContainer({ id: 'c1' });
    const container2 = createContainer({
      id: 'c2',
      name: 'redis',
      image: {
        ...createContainer().image,
        name: 'library/redis',
        digest: { watch: true, value: 'sha256:def456' },
      },
    });
    mockGetContainers.mockReturnValue([container1, container2]);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockScanImageWithDedup.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ scanResult: createScanResult(), fromCache: false });
          }, 100);
        }),
    );

    await runScheduledScans();

    expect(mockScanImageWithDedup).toHaveBeenCalledTimes(1);
    expect(mockBroadcastScanStarted).toHaveBeenCalledWith('c1');
    expect(mockBroadcastScanStarted).not.toHaveBeenCalledWith('c2');
    expect(mockBroadcastScanCompleted).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenCalledWith('Scheduled scan batch timed out after 30ms');
    expect(mockLogInfo).toHaveBeenCalledWith(
      'Scanning 2 unique digests across 2 containers (concurrency: 1, batch timeout: 30ms)',
    );
    expect(mockLogInfo).toHaveBeenCalledWith(
      'Scheduled scan complete: 2 digests, 0 cached, 0 scanned fresh, 0 errors, 1 aborted, 1 skipped, 0 alerts emitted',
    );
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    clearTimeoutSpy.mockRestore();
  });

  test('should group containers by digest and scan unique digests', async () => {
    const container1 = createContainer({ id: 'c1' });
    const container2 = createContainer({
      id: 'c2',
      name: 'nginx-replica',
      image: {
        ...createContainer().image,
        digest: { watch: true, value: 'sha256:abc123' },
      },
    });
    const container3 = createContainer({
      id: 'c3',
      name: 'redis',
      image: {
        ...createContainer().image,
        name: 'library/redis',
        digest: { watch: true, value: 'sha256:def456' },
      },
    });
    mockGetContainers.mockReturnValue([container1, container2, container3]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // Two unique digests → two scan calls
    expect(mockScanImageWithDedup).toHaveBeenCalledTimes(2);
    // All three containers should get broadcasts
    expect(mockBroadcastScanStarted).toHaveBeenCalledTimes(3);
    expect(mockBroadcastScanCompleted).toHaveBeenCalledTimes(3);
    // All three containers should be updated
    expect(mockUpdateContainer).toHaveBeenCalledTimes(3);
  });

  test('should query trivy db status once and pass it to each digest scan', async () => {
    const container1 = createContainer({ id: 'c1' });
    const container2 = createContainer({
      id: 'c2',
      name: 'redis',
      image: {
        ...createContainer().image,
        name: 'library/redis',
        digest: { watch: true, value: 'sha256:def456' },
      },
    });
    mockGetContainers.mockReturnValue([container1, container2]);
    mockScanImageWithDedup.mockResolvedValue({ scanResult: createScanResult(), fromCache: false });

    await runScheduledScans();

    expect(mockGetTrivyDatabaseStatus).toHaveBeenCalledTimes(1);
    expect(mockScanImageWithDedup).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        digest: 'sha256:abc123',
        trivyDbUpdatedAt: '2026-03-04T02:55:00.000Z',
      }),
      86400000,
    );
    expect(mockScanImageWithDedup).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        digest: 'sha256:def456',
        trivyDbUpdatedAt: '2026-03-04T02:55:00.000Z',
      }),
      86400000,
    );
  });

  test('should return cached result when scanImageWithDedup returns fromCache', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: true });

    await runScheduledScans();

    expect(mockScanImageWithDedup).toHaveBeenCalledTimes(1);
    expect(mockUpdateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'c1',
        security: expect.objectContaining({ scan: scanResult }),
      }),
    );
    expect(mockBroadcastScanCompleted).toHaveBeenCalledWith('c1', 'passed');
    expect(mockLogInfo).toHaveBeenCalledWith(
      `Digest ${'sha256:abc123'.slice(0, 12)} unchanged, using cached scan`,
    );
  });

  test('should preserve previously-stored scan result when scheduled scan returns an error and previous scan is recent (issue #357)', async () => {
    const previousScan = createScanResult({
      status: 'passed',
      scannedAt: new Date().toISOString(), // recent — within preservation window
      summary: { unknown: 0, low: 2, medium: 3, high: 0, critical: 0 },
    });
    const container = createContainer({
      id: 'c1',
      security: { scan: previousScan },
    });
    mockGetContainers.mockReturnValue([container]);
    const errorScan = createScanResult({
      status: 'error',
      summary: undefined,
      error: 'dial unix /var/run/docker.sock: ENOENT',
    });
    mockScanImageWithDedup.mockResolvedValue({ scanResult: errorScan, fromCache: false });

    await runScheduledScans();

    // The UI still hears the live error so the operator sees the failure...
    expect(mockBroadcastScanCompleted).toHaveBeenCalledWith('c1', 'error');
    // ...but persisted state keeps the last-good scan record so prior
    // passed/blocked history isn't silently wiped by a transient Trivy hiccup.
    expect(mockUpdateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'c1',
        security: expect.objectContaining({ scan: previousScan }),
      }),
    );
  });

  test('should overwrite previously-stored scan when it is older than MAX_PRESERVED_SCAN_AGE_MS even on error result (issue #357)', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const previousScan = createScanResult({
      status: 'passed',
      scannedAt: eightDaysAgo,
      summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    });
    const container = createContainer({
      id: 'c1',
      security: { scan: previousScan },
    });
    mockGetContainers.mockReturnValue([container]);
    const errorScan = createScanResult({
      status: 'error',
      summary: undefined,
      error: 'trivy timeout after weeks of outage',
    });
    mockScanImageWithDedup.mockResolvedValue({ scanResult: errorScan, fromCache: false });

    await runScheduledScans();

    // Error is 8 days old → outside 7-day preservation window → overwrite
    expect(mockUpdateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'c1',
        security: expect.objectContaining({ scan: errorScan }),
      }),
    );
  });

  test('should still persist error result when no previous scan exists', async () => {
    const container = createContainer({ id: 'c1', security: {} });
    mockGetContainers.mockReturnValue([container]);
    const errorScan = createScanResult({
      status: 'error',
      summary: undefined,
      error: 'trivy timeout',
    });
    mockScanImageWithDedup.mockResolvedValue({ scanResult: errorScan, fromCache: false });

    await runScheduledScans();

    expect(mockUpdateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'c1',
        security: expect.objectContaining({ scan: errorScan }),
      }),
    );
  });

  test('should log the final summary counts for cached and scanned digests', async () => {
    const container1 = createContainer({ id: 'c1' });
    const container2 = createContainer({
      id: 'c2',
      name: 'redis',
      image: {
        ...createContainer().image,
        name: 'library/redis',
        digest: { watch: true, value: 'sha256:def456' },
      },
    });
    mockGetContainers.mockReturnValue([container1, container2]);
    const scanResult = createScanResult();
    mockScanImageWithDedup
      .mockResolvedValueOnce({ scanResult, fromCache: true })
      .mockResolvedValueOnce({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockLogInfo).toHaveBeenCalledWith(
      'Scheduled scan complete: 2 digests, 1 cached, 1 scanned fresh, 0 errors, 0 aborted, 0 skipped, 0 alerts emitted',
    );
  });

  test('should continue scanning other digests when one fails', async () => {
    const container1 = createContainer({ id: 'c1' });
    const container2 = createContainer({
      id: 'c2',
      name: 'redis',
      image: {
        ...createContainer().image,
        name: 'library/redis',
        digest: { watch: true, value: 'sha256:def456' },
      },
    });
    mockGetContainers.mockReturnValue([container1, container2]);

    const scanResult = createScanResult();
    mockScanImageWithDedup
      .mockRejectedValueOnce(new Error('trivy timeout'))
      .mockResolvedValueOnce({ scanResult, fromCache: false });

    await runScheduledScans();

    // Both digests attempted
    expect(mockScanImageWithDedup).toHaveBeenCalledTimes(2);
    // First container gets error broadcast, second gets success
    expect(mockBroadcastScanCompleted).toHaveBeenCalledWith('c1', 'error');
    expect(mockBroadcastScanCompleted).toHaveBeenCalledWith('c2', 'passed');
    // Only second container gets store update
    expect(mockUpdateContainer).toHaveBeenCalledTimes(1);
    expect(mockUpdateContainer).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }));
    expect(mockLogInfo).toHaveBeenCalledWith(
      'Scheduled scan complete: 2 digests, 0 cached, 1 scanned fresh, 1 errors, 0 aborted, 0 skipped, 0 alerts emitted',
    );
  });

  test('should handle non-Error thrown during scan', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockRejectedValue('string error');

    await runScheduledScans();

    expect(mockBroadcastScanCompleted).toHaveBeenCalledWith('c1', 'error');
  });

  test('should log object-like scan errors using their message property', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockRejectedValue({ message: 'trivy timeout' });

    await runScheduledScans();

    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('trivy timeout'));
  });

  test('should broadcast scan-started and scan-completed for each container', async () => {
    const container1 = createContainer({ id: 'c1' });
    const container2 = createContainer({
      id: 'c2',
      name: 'nginx-replica',
      image: {
        ...createContainer().image,
        digest: { watch: true, value: 'sha256:abc123' },
      },
    });
    mockGetContainers.mockReturnValue([container1, container2]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockBroadcastScanStarted).toHaveBeenCalledWith('c1');
    expect(mockBroadcastScanStarted).toHaveBeenCalledWith('c2');
    expect(mockBroadcastScanCompleted).toHaveBeenCalledWith('c1', 'passed');
    expect(mockBroadcastScanCompleted).toHaveBeenCalledWith('c2', 'passed');
  });

  test('should skip when no containers have digest values', async () => {
    const container = createContainer({
      image: {
        ...createContainer().image,
        digest: { watch: true, value: undefined },
      },
    });
    mockGetContainers.mockReturnValue([container]);

    await runScheduledScans();

    expect(mockScanImageWithDedup).not.toHaveBeenCalled();
    expect(mockBroadcastScanStarted).not.toHaveBeenCalled();
    expect(mockLogInfo).toHaveBeenCalledWith(
      'No containers with digest values found, skipping scheduled scan',
    );
  });

  test('should skip when digest values are empty strings', async () => {
    const container = createContainer({
      image: {
        ...createContainer().image,
        digest: { watch: true, value: '' },
      },
    });
    const containerWithNullDigest = createContainer({
      id: 'c2',
      image: {
        ...createContainer().image,
        digest: { watch: true, value: null as unknown as string },
      },
    });
    mockGetContainers.mockReturnValue([container, containerWithNullDigest]);

    await runScheduledScans();

    expect(mockScanImageWithDedup).not.toHaveBeenCalled();
    expect(mockBroadcastScanStarted).not.toHaveBeenCalled();
    expect(mockLogInfo).toHaveBeenCalledWith(
      'No containers with digest values found, skipping scheduled scan',
    );
  });

  test('should skip when containers list is empty', async () => {
    mockGetContainers.mockReturnValue([]);

    await runScheduledScans();

    expect(mockScanImageWithDedup).not.toHaveBeenCalled();
  });

  test('should skip when scan is already in progress', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();

    // Make the first call hang so the second call finds scanInProgress = true
    let resolveFirst: () => void;
    const firstCallPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    mockScanImageWithDedup.mockImplementation(
      () =>
        new Promise((resolve) => {
          firstCallPromise.then(() => resolve({ scanResult, fromCache: false }));
        }),
    );

    const firstScan = runScheduledScans();
    // The first call sets scanInProgress, now trigger a second
    const secondScan = runScheduledScans();

    // Resolve the first scan
    resolveFirst!();
    await firstScan;
    await secondScan;

    // Only one scan call was made (second was skipped)
    expect(mockScanImageWithDedup).toHaveBeenCalledTimes(1);
    expect(mockLogInfo).toHaveBeenCalledWith('Scheduled scan already in progress, skipping');
  });

  test('should skip when security scanner is disabled', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      enabled: false,
      scanner: 'trivy',
    });

    await runScheduledScans();

    expect(mockGetContainers).not.toHaveBeenCalled();
    expect(mockLogInfo).toHaveBeenCalledWith(
      'Security scanner not enabled, skipping scheduled scan',
    );
  });

  test('should run an empty scheduled Grype batch', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scanner: 'grype',
    });
    setMockContainersRaw([]);

    await runScheduledScans();

    expect(mockGetContainersRaw).toHaveBeenCalled();
    expect(mockEmitSecurityScanCycleComplete).toHaveBeenCalled();
  });

  test('should filter out containers with non-string digest values', async () => {
    const validContainer = createContainer({ id: 'c1' });
    const invalidContainer = createContainer({
      id: 'c2',
      image: {
        ...createContainer().image,
        digest: { watch: true, value: 12345 },
      },
    });
    mockGetContainers.mockReturnValue([validContainer, invalidContainer]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockScanImageWithDedup).toHaveBeenCalledTimes(1);
  });

  test('should filter out containers that are missing image data', async () => {
    const validContainer = createContainer({ id: 'c1' });
    const containerWithoutImage = {
      ...createContainer({ id: 'c2' }),
      image: undefined,
    } as unknown as ReturnType<typeof createContainer>;
    mockGetContainers.mockReturnValue([validContainer, containerWithoutImage]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockScanImageWithDedup).toHaveBeenCalledTimes(1);
    expect(mockBroadcastScanStarted).toHaveBeenCalledWith('c1');
    expect(mockBroadcastScanStarted).not.toHaveBeenCalledWith('c2');
  });

  test('should pass correct scanIntervalMs based on cron expression for every-N-minutes', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '*/30 * * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // */30 * * * * → 30 * 60 * 1000 = 1800000
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      1800000,
    );
  });

  test('should pass correct scanIntervalMs based on cron expression for every-N-hours', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 */6 * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // 0 */6 * * * → 6 * 60 * 60 * 1000 = 21600000
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      21600000,
    );
  });

  test('should pass correct scanIntervalMs for daily cron (specific hour)', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // 0 3 * * * → 24h interval
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      MS_PER_DAY,
    );
  });

  test('should fallback to 24h interval for cron with fewer than 5 parts', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '* * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should use monthly-scale interval for cron with specific day pattern', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3 15 * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    const [, intervalMs] = mockScanImageWithDedup.mock.calls[0];

    // 0 3 15 * * runs monthly, so interval should be longer than a day.
    expect(intervalMs).toBeGreaterThan(86400000);
  });

  test('should use shortest interval for cron with comma-separated hours', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3,9 * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // 0 3,9 * * * runs at 03:00 and 09:00 each day, so the shortest interval is 6h.
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      21600000,
    );
  });

  test('should use wrap-around shortest interval for cron with two-digit comma-separated hours', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '15 2,10,22 * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // 2 -> 10 -> 22 -> wrap to 2 gives a 4h gap.
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      14400000,
    );
  });

  test('should trim whitespace before parsing comma-separated hour lists', async () => {
    const parseExpressionSpy = vi.spyOn(CronExpressionParser, 'parse');
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: ' 15 2,10,22 * * * ', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    try {
      await runScheduledScans();
    } finally {
      parseExpressionSpy.mockRestore();
    }

    expect(parseExpressionSpy).not.toHaveBeenCalled();
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      14400000,
    );
  });

  test('should use the cron parser when extra suffix text prevents a simple hour list match', async () => {
    const parseExpressionSpy = vi.spyOn(CronExpressionParser, 'parse');
    parseExpressionSpy.mockReturnValue({
      next: vi.fn(() => ({
        toDate: () => new Date('2026-03-01T00:00:00.000Z'),
      })),
    } as any);
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '15 2,10,22 * * * extra', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    try {
      await runScheduledScans();
    } finally {
      parseExpressionSpy.mockRestore();
    }

    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should fallback to 24h for comma-separated hour cron when only one valid hour remains', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3,99 * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({ scanResult: createScanResult(), fromCache: false });

    await runScheduledScans();

    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should fallback to 24h for comma-separated hour cron with duplicate hours', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3,3 * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({ scanResult: createScanResult(), fromCache: false });

    await runScheduledScans();

    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should fallback to 24h when cron parser yields non-positive intervals', async () => {
    const parseExpressionSpy = vi.spyOn(CronExpressionParser, 'parse');
    parseExpressionSpy.mockReturnValue({
      next: vi.fn(() => ({
        toDate: () => new Date('2026-03-01T00:00:00.000Z'),
      })),
    } as any);
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3 15 * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({ scanResult: createScanResult(), fromCache: false });

    try {
      await runScheduledScans();
    } finally {
      parseExpressionSpy.mockRestore();
    }

    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should mark digest as error without scan-completed broadcast when auth resolution fails before start', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockResolveContainerRegistryAuth.mockRejectedValueOnce(new Error('auth resolution failed'));

    await runScheduledScans();

    expect(mockBroadcastScanStarted).not.toHaveBeenCalled();
    expect(mockBroadcastScanCompleted).not.toHaveBeenCalled();
    expect(mockScanImageWithDedup).not.toHaveBeenCalled();
  });

  test('should abort an in-flight batch when shutdown is invoked during auth resolution', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockResolveContainerRegistryAuth.mockImplementation(async () => {
      shutdown();
      return undefined;
    });

    await runScheduledScans();

    expect(mockScanImageWithDedup).not.toHaveBeenCalled();
    expect(mockBroadcastScanCompleted).not.toHaveBeenCalled();
    expect(mockLogWarn).not.toHaveBeenCalled();
    expect(_isScanInProgress()).toBe(false);
  });

  test('should log the cron interval parse failure and fall back to 24h', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3 15 * *', jitter: 60000 },
    });
    const parseExpressionSpy = vi.spyOn(CronExpressionParser, 'parse');
    parseExpressionSpy.mockImplementation(() => {
      throw new Error('cron parser exploded');
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    try {
      await runScheduledScans();
    } finally {
      parseExpressionSpy.mockRestore();
    }

    expect(mockLogDebug).toHaveBeenCalledWith(
      'Could not derive cron interval from "0 3 15 * *": cron parser exploded',
    );
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should log the exact batch preparation message when batch timeout is disabled', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockLogInfo).toHaveBeenCalledWith(
      'Scanning 1 unique digests across 1 containers (concurrency: 1, batch timeout: disabled)',
    );
  });

  test('should fallback to 24h for invalid */0 minute pattern', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '*/0 * * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // */0 → minutes = 0, not > 0 → falls through to hourField check → hourField is '*', starts with '*/' no → falls through
    // dayField is '*', hourField doesn't include '/' or ',' → daily 24h
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should fallback to 24h for invalid */0 hour pattern', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 */0 * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // */0 → hours = 0, not > 0 → falls through to daily check
    // dayField is '*', hourField includes '/' → does not match daily → fallback 24h
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should fallback to 24h for */NaN minute pattern', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '*/abc * * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // parseInt('abc') = NaN, not finite → falls through
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should fallback to 24h for */NaN hour pattern', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 */abc * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should re-read cached security configuration after shutdown', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();
    shutdown();
    await runScheduledScans();

    expect(mockGetSecurityConfiguration).toHaveBeenCalledTimes(2);
  });

  test('should pass image and auth to scanImageWithDedup', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockResolveContainerImageFullName.mockReturnValue('docker.io/library/nginx:1.25');
    mockResolveContainerRegistryAuth.mockResolvedValue({ username: 'user', password: 'pass' });
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'docker.io/library/nginx:1.25',
        auth: { username: 'user', password: 'pass' },
        digest: 'sha256:abc123',
        trivyDbUpdatedAt: '2026-03-04T02:55:00.000Z',
      }),
      86400000,
    );
  });

  test('should preserve existing security state when updating container', async () => {
    const container = createContainer({
      security: { signature: { status: 'verified' } },
    });
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockUpdateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        security: {
          signature: { status: 'verified' },
          scan: scanResult,
        },
      }),
    );
  });

  test('should handle container with undefined security field', async () => {
    const container = createContainer({ security: undefined });
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockUpdateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        security: { scan: scanResult },
      }),
    );
  });

  test('should use empty object fallback when registry state has no registry key', async () => {
    mockGetState.mockReturnValue({});
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockResolveContainerImageFullName).toHaveBeenCalledWith(container, {}, undefined);
    expect(mockResolveContainerRegistryAuth).toHaveBeenCalledWith(
      container,
      {},
      expect.any(Object),
    );
  });

  test('should reset scanInProgress even when an error occurs in the try block', async () => {
    mockGetContainers.mockImplementation(() => {
      throw new Error('store exploded');
    });

    await expect(runScheduledScans()).rejects.toThrow('store exploded');

    expect(_isScanInProgress()).toBe(false);
  });

  test('should derive every-N-minutes interval with non-wildcard hourField', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '*/15 3 * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // */15 3 * * * runs every 15 minutes during hour 3.
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      900000,
    );
  });

  test('should derive every-N-hours interval with non-wildcard dayField', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 */4 1 * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // 0 */4 1 * * runs every 4 hours on day 1 of each month.
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      14400000,
    );
  });

  test('should emit a security alert for each container with critical or high findings', async () => {
    const container1 = createContainer({ id: 'c1', name: 'nginx' });
    const container2 = createContainer({
      id: 'c2',
      name: 'redis',
      image: {
        ...createContainer().image,
        name: 'library/redis',
        digest: { watch: true, value: 'sha256:def456' },
      },
    });
    mockGetContainers.mockReturnValue([container1, container2]);
    mockScanImageWithDedup
      .mockResolvedValueOnce({
        scanResult: createScanResult({
          status: 'blocked',
          summary: { unknown: 0, low: 1, medium: 2, high: 3, critical: 1 },
        }),
        fromCache: false,
      })
      .mockResolvedValueOnce({
        scanResult: createScanResult({
          summary: { unknown: 0, low: 0, medium: 0, high: 2, critical: 0 },
        }),
        fromCache: false,
      });

    await runScheduledScans();

    expect(mockEmitSecurityAlert).toHaveBeenCalledTimes(2);
    expect(mockEmitSecurityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName: 'local_nginx',
        details: 'critical=1, high=3, medium=2, low=1, unknown=0',
        status: 'blocked',
        cycleId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      }),
    );
    expect(mockEmitSecurityAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName: 'local_redis',
        details: 'critical=0, high=2, medium=0, low=0, unknown=0',
        cycleId: expect.any(String),
      }),
    );
  });

  test('should share the same cycleId across every alert and the cycle-complete signal in one run', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({
      scanResult: createScanResult({
        summary: { unknown: 0, low: 0, medium: 0, high: 1, critical: 0 },
      }),
      fromCache: false,
    });

    await runScheduledScans();

    const alertCycleIds = mockEmitSecurityAlert.mock.calls.map(
      ([payload]) => (payload as { cycleId: string }).cycleId,
    );
    const completeCycleId = mockEmitSecurityScanCycleComplete.mock.calls[0]?.[0]?.cycleId;
    expect(alertCycleIds.every((id) => id === completeCycleId)).toBe(true);
    expect(completeCycleId).toEqual(expect.any(String));
  });

  test('should produce distinct cycleIds across two successive runs', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({
      scanResult: createScanResult({
        summary: { unknown: 0, low: 0, medium: 0, high: 1, critical: 0 },
      }),
      fromCache: false,
    });

    await runScheduledScans();
    await runScheduledScans();

    const cycleIds = mockEmitSecurityScanCycleComplete.mock.calls.map(
      ([payload]) => payload.cycleId,
    );
    expect(cycleIds).toHaveLength(2);
    expect(cycleIds[0]).not.toBe(cycleIds[1]);
  });

  test('should NOT emit a security alert when only low/medium findings are present and high/critical are absent', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({
      scanResult: createScanResult({
        summary: { unknown: 0, low: 3, medium: 5 },
      }),
      fromCache: false,
    });

    await runScheduledScans();

    expect(mockEmitSecurityAlert).not.toHaveBeenCalled();
    expect(mockEmitSecurityScanCycleComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'scheduled',
        scannedCount: 1,
        alertCount: 0,
      }),
    );
  });

  test('should NOT emit a security alert when summary is missing', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({
      scanResult: { ...createScanResult(), summary: undefined },
      fromCache: false,
    });

    await runScheduledScans();

    expect(mockEmitSecurityAlert).not.toHaveBeenCalled();
  });

  test('should emit security scan cycle complete after every scheduled run', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({
      scanResult: createScanResult({
        summary: { unknown: 0, low: 0, medium: 0, high: 1, critical: 0 },
      }),
      fromCache: false,
    });

    await runScheduledScans();

    expect(mockEmitSecurityScanCycleComplete).toHaveBeenCalledTimes(1);
    expect(mockEmitSecurityScanCycleComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'scheduled',
        scannedCount: 1,
        alertCount: 1,
      }),
    );
  });

  test('should emit cycle complete with zero counts when no containers qualify for scanning', async () => {
    mockGetContainers.mockReturnValue([]);

    await runScheduledScans();

    expect(mockEmitSecurityScanCycleComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'scheduled',
        scannedCount: 0,
        alertCount: 0,
      }),
    );
  });

  test('should emit cycle complete even when the scan batch throws partway through', async () => {
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockRejectedValue(new Error('scan exploded'));

    await runScheduledScans();

    expect(mockEmitSecurityScanCycleComplete).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'scheduled' }),
    );
  });

  test('should NOT emit alerts when scan.notifications is disabled, but still emit cycle complete', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: {
        ...createEnabledConfiguration().scan,
        notifications: false,
      },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    mockScanImageWithDedup.mockResolvedValue({
      scanResult: createScanResult({
        summary: { unknown: 0, low: 0, medium: 0, high: 5, critical: 2 },
      }),
      fromCache: false,
    });

    await runScheduledScans();

    expect(mockEmitSecurityAlert).not.toHaveBeenCalled();
    expect(mockEmitSecurityScanCycleComplete).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'scheduled', alertCount: 0 }),
    );
  });

  test('should dispatch security alerts for all containers in a group concurrently', async () => {
    // Three containers share the same digest (one scan → three alerts)
    const container1 = createContainer({ id: 'c1', name: 'nginx' });
    const container2 = createContainer({
      id: 'c2',
      name: 'nginx-replica',
      image: { ...createContainer().image, digest: { watch: true, value: 'sha256:abc123' } },
    });
    const container3 = createContainer({
      id: 'c3',
      name: 'nginx-sidecar',
      image: { ...createContainer().image, digest: { watch: true, value: 'sha256:abc123' } },
    });
    mockGetContainers.mockReturnValue([container1, container2, container3]);

    // Track concurrency: record max in-flight count
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];
    mockEmitSecurityAlert.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          resolvers.push(() => {
            inFlight -= 1;
            resolve();
          });
        }),
    );

    mockScanImageWithDedup.mockResolvedValue({
      scanResult: createScanResult({
        summary: { unknown: 0, low: 0, medium: 0, high: 3, critical: 1 },
      }),
      fromCache: false,
    });

    const scanPromise = runScheduledScans();

    // Wait until all three alerts are in-flight simultaneously
    await vi.waitFor(() => {
      expect(mockEmitSecurityAlert).toHaveBeenCalledTimes(3);
    });

    // All three should be in-flight at the same time (concurrent, not serial)
    expect(maxInFlight).toBe(3);

    resolvers.forEach((r) => r());
    await scanPromise;

    expect(mockEmitSecurityScanCycleComplete).toHaveBeenCalledWith(
      expect.objectContaining({ alertCount: 3 }),
    );
  });

  test('should count only fulfilled alerts when one alert rejects', async () => {
    const container1 = createContainer({ id: 'c1', name: 'nginx' });
    const container2 = createContainer({
      id: 'c2',
      name: 'nginx-replica',
      image: { ...createContainer().image, digest: { watch: true, value: 'sha256:abc123' } },
    });
    mockGetContainers.mockReturnValue([container1, container2]);

    mockEmitSecurityAlert
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('notification channel down'));

    mockScanImageWithDedup.mockResolvedValue({
      scanResult: createScanResult({
        summary: { unknown: 0, low: 0, medium: 0, high: 2, critical: 0 },
      }),
      fromCache: false,
    });

    // Should not throw even though one alert rejects
    await runScheduledScans();

    expect(mockEmitSecurityAlert).toHaveBeenCalledTimes(2);
    expect(mockEmitSecurityScanCycleComplete).toHaveBeenCalledWith(
      expect.objectContaining({ alertCount: 1 }),
    );
  });

  test('should skip write-back and not create a zombie record when the container is gone by write-back time', async () => {
    // The container is in the snapshot at batch-prep time but has been removed
    // (or recreated under a new id) before write-back completes. The fixed
    // write-back must call getContainerRaw and skip updateContainer entirely
    // when it returns undefined — otherwise a ghost record is created in the
    // store for a container id that no longer exists.
    const snapshotContainer = createContainer({ id: 'c1' });
    mockGetContainers.mockReturnValue([snapshotContainer]);
    // Container is gone by the time write-back runs
    mockGetContainerRaw.mockReturnValue(undefined);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // broadcastScanCompleted still fires (we still tell the UI the scan finished)
    expect(mockBroadcastScanCompleted).toHaveBeenCalledWith('c1', 'passed');
    // But no zombie write must be issued for the gone container
    expect(mockUpdateContainer).not.toHaveBeenCalled();
  });

  test('should merge security field onto the CURRENT store record, not the stale snapshot, to avoid re-raising cleared update-state', async () => {
    // The snapshot captured at batch-prep time has updateAvailable:true and a
    // stale result tag. By write-back time the container was updated (same id,
    // same name) and the current store record has updateAvailable:false with a
    // newer tag. The fixed write-back must spread the CURRENT record and only
    // overlay security, so the update-state stays cleared.
    const staleSnapshotContainer = createContainer({
      id: 'c1',
      updateAvailable: true,
      result: { tag: '1.24', digest: 'sha256:old' },
      image: {
        id: 'sha256:abc',
        registry: { name: 'hub', url: 'docker.io' },
        name: 'library/nginx',
        tag: { value: '1.24', semver: true },
        digest: { watch: true, value: 'sha256:abc123' },
        architecture: 'amd64',
        os: 'linux',
      },
    });
    const currentStoreRecord = createContainer({
      id: 'c1',
      updateAvailable: false,
      result: undefined,
      image: {
        id: 'sha256:abc',
        registry: { name: 'hub', url: 'docker.io' },
        name: 'library/nginx',
        tag: { value: '1.25', semver: true },
        digest: { watch: true, value: 'sha256:abc123' },
        architecture: 'amd64',
        os: 'linux',
      },
    });
    mockGetContainers.mockReturnValue([staleSnapshotContainer]);
    // Current store record reflects the already-updated container
    mockGetContainerRaw.mockReturnValue(currentStoreRecord);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    expect(mockUpdateContainer).toHaveBeenCalledTimes(1);
    const written = mockUpdateContainer.mock.calls[0][0];
    // Must NOT re-raise the stale update-available flag
    expect(written.updateAvailable).toBe(false);
    // Must NOT revert the tag to the stale snapshot value
    expect(written.image.tag.value).toBe('1.25');
    // Must still carry the new scan result
    expect(written.security).toEqual(expect.objectContaining({ scan: scanResult }));
  });
});

describe('shutdown', () => {
  test('should stop cron task, clear cache, and reset state', () => {
    mockCronValidate.mockReturnValue(true);
    const mockTask = { stop: vi.fn() };
    mockCronSchedule.mockReturnValue(mockTask);

    init();
    expect(isRunning()).toBe(true);

    shutdown();

    expect(mockTask.stop).toHaveBeenCalled();
    expect(mockClearDigestScanCache).toHaveBeenCalled();
    expect(isRunning()).toBe(false);
  });

  test('should be safe to call when no cron task is active', () => {
    shutdown();

    expect(mockClearDigestScanCache).toHaveBeenCalled();
    expect(isRunning()).toBe(false);
  });
});

describe('_resetForTesting', () => {
  test('should fully reset scheduler state', () => {
    mockCronValidate.mockReturnValue(true);
    const mockTask = { stop: vi.fn() };
    mockCronSchedule.mockReturnValue(mockTask);

    init();
    expect(isRunning()).toBe(true);

    _resetForTesting();

    expect(isRunning()).toBe(false);
    expect(mockTask.stop).toHaveBeenCalled();
    expect(mockClearDigestScanCache).toHaveBeenCalled();
  });
});
