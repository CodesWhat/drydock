import { CronExpressionParser } from 'cron-parser';
import { vi } from 'vitest';
import { MS_PER_DAY } from '../model/maturity-policy.js';

const mockGetSecurityConfiguration = vi.hoisted(() => vi.fn());
const mockGetContainers = vi.hoisted(() => vi.fn());
const mockGetContainersRaw = vi.hoisted(() => vi.fn());
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
  updateContainer: (...args: unknown[]) => mockUpdateContainer(...args),
}));

vi.mock('./scan.js', () => ({
  scanImageWithDedup: (...args: unknown[]) => mockScanImageWithDedup(...args),
  clearDigestScanCache: (...args: unknown[]) => mockClearDigestScanCache(...args),
}));

vi.mock('./runtime.js', () => ({
  getTrivyDatabaseStatus: (...args: unknown[]) => mockGetTrivyDatabaseStatus(...args),
}));

import {
  _isScanInProgress,
  _resetForTesting,
  init,
  isRunning,
  runScheduledScans,
  shutdown,
} from './scheduler.js';

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
    scan: { cron: '0 3 * * *', jitter: 60000, concurrency: 1, batchTimeout: 0 },
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
  _resetForTesting();
  mockGetContainersRaw.mockImplementation((...args: unknown[]) => mockGetContainers(...args));
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
  });

  test('should warn and return when cron expression is invalid', () => {
    mockCronValidate.mockReturnValue(false);

    init();

    expect(mockCronValidate).toHaveBeenCalledWith('0 3 * * *');
    expect(mockCronSchedule).not.toHaveBeenCalled();
    expect(isRunning()).toBe(false);
  });

  test('should no-op when scanner is disabled', () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      enabled: false,
      scanner: '',
      scan: { cron: '0 3 * * *', jitter: 60000 },
    });

    init();

    expect(mockCronSchedule).not.toHaveBeenCalled();
    expect(isRunning()).toBe(false);
  });

  test('should no-op when scanner is not trivy', () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scanner: 'other',
      scan: { cron: '0 3 * * *', jitter: 60000 },
    });

    init();

    expect(mockCronSchedule).not.toHaveBeenCalled();
    expect(isRunning()).toBe(false);
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

    // Wait a tick so the promise rejection is caught
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockLogWarn).toHaveBeenCalledWith('Scheduled scan run failed: scan exploded');
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

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockLogWarn).toHaveBeenCalledWith('Scheduled scan run failed: string error');
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

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockLogWarn).toHaveBeenCalledWith('Scheduled scan run failed: scan exploded');
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
    mockGetContainersRaw.mockReturnValue([container]);
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
  });

  test('should skip when security scanner is disabled', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      enabled: false,
      scanner: '',
    });

    await runScheduledScans();

    expect(mockGetContainers).not.toHaveBeenCalled();
  });

  test('should skip when scanner is not trivy', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scanner: 'other',
    });

    await runScheduledScans();

    expect(mockGetContainers).not.toHaveBeenCalled();
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
    expect(_isScanInProgress()).toBe(false);
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
