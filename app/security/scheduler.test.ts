import { vi } from 'vitest';

const mockGetSecurityConfiguration = vi.hoisted(() => vi.fn());
const mockGetContainers = vi.hoisted(() => vi.fn());
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
    scan: { cron: '0 3 * * *', jitter: 60000 },
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
    // Make getSecurityConfiguration throw only on runScheduledScans call (second call)
    let callCount = 0;
    mockGetSecurityConfiguration.mockImplementation(() => {
      callCount += 1;
      if (callCount > 1) {
        throw new Error('config exploded');
      }
      return createEnabledConfiguration();
    });

    init();
    // Should not throw
    cronCallback!();

    // Wait a tick so the promise rejection is caught
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  test('should catch non-Error thrown by runScheduledScans in the cron callback', async () => {
    mockCronValidate.mockReturnValue(true);
    let cronCallback: () => void;
    mockCronSchedule.mockImplementation((_expr: string, cb: () => void) => {
      cronCallback = cb;
      return { stop: vi.fn() };
    });
    let callCount = 0;
    mockGetSecurityConfiguration.mockImplementation(() => {
      callCount += 1;
      if (callCount > 1) {
        throw 'string error';
      }
      return createEnabledConfiguration();
    });

    init();
    cronCallback!();

    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  test('should include message from object-like errors thrown by runScheduledScans in the cron callback', async () => {
    mockCronValidate.mockReturnValue(true);
    let cronCallback: () => void;
    mockCronSchedule.mockImplementation((_expr: string, cb: () => void) => {
      cronCallback = cb;
      return { stop: vi.fn() };
    });
    let callCount = 0;
    mockGetSecurityConfiguration.mockImplementation(() => {
      callCount += 1;
      if (callCount > 1) {
        throw { message: 'config exploded' };
      }
      return createEnabledConfiguration();
    });

    init();
    cronCallback!();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockLogWarn).toHaveBeenCalledWith('Scheduled scan run failed: config exploded');
  });
});

describe('runScheduledScans', () => {
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

    // 0 3 * * * → 24 * 60 * 60 * 1000 = 86400000
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
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

  test('should fallback to 24h interval for cron with specific day pattern', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3 15 * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // dayField is '15', not '*', and hourField doesn't include '/' or ',' → fallback 24h
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should fallback to 24h interval for cron with comma-separated hours', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 3,9 * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // hourField includes ',' → does not match any special case → fallback 24h
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
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

  test('should handle every-N-minutes pattern with non-wildcard hourField', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '*/15 3 * * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // minuteField starts with '*/' but hourField is '3' (not '*'), so the first branch doesn't match
    // hourField doesn't start with '*/' → second branch doesn't match
    // dayField is '*', hourField doesn't include '/' or ',' → daily 24h
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
    );
  });

  test('should handle every-N-hours pattern with non-wildcard dayField', async () => {
    mockGetSecurityConfiguration.mockReturnValue({
      ...createEnabledConfiguration(),
      scan: { cron: '0 */4 1 * *', jitter: 60000 },
    });
    const container = createContainer();
    mockGetContainers.mockReturnValue([container]);
    const scanResult = createScanResult();
    mockScanImageWithDedup.mockResolvedValue({ scanResult, fromCache: false });

    await runScheduledScans();

    // hourField starts with '*/' and dayField is '1' (not '*') → second branch doesn't match
    // dayField is '1' (not '*') → third branch doesn't match
    // Fallback 24h
    expect(mockScanImageWithDedup).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'sha256:abc123' }),
      86400000,
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
