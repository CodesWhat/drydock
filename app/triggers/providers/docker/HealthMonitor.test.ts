import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startHealthMonitor } from './HealthMonitor.js';

var mockInsertAudit = vi.hoisted(() => vi.fn());
vi.mock('../../../store/audit.js', () => ({
  insertAudit: mockInsertAudit,
}));

var mockGetBackups = vi.hoisted(() => vi.fn());
vi.mock('../../../store/backup.js', () => ({
  getBackups: mockGetBackups,
}));

var mockAuditCounterInc = vi.hoisted(() => vi.fn());
var mockGetAuditCounter = vi.hoisted(() => vi.fn());
vi.mock('../../../prometheus/audit.js', () => ({
  getAuditCounter: mockGetAuditCounter,
}));

function createMockLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createMockDockerApi(inspectResult) {
  return {
    getContainer: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue(inspectResult),
    }),
  };
}

function createMockTriggerInstance() {
  return {
    getCurrentContainer: vi.fn().mockResolvedValue({
      inspect: vi.fn(),
      stop: vi.fn(),
      remove: vi.fn(),
      start: vi.fn(),
    }),
    inspectContainer: vi.fn().mockResolvedValue({
      Name: '/test-container',
      Id: 'abc123',
      State: { Running: true },
      Config: {},
      HostConfig: {},
      NetworkSettings: { Networks: {} },
    }),
    stopAndRemoveContainer: vi.fn().mockResolvedValue(undefined),
    recreateContainer: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mockGetAuditCounter.mockReturnValue({ inc: mockAuditCounterInc });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HealthMonitor', () => {
  test('should stop monitoring with warning when container has no HEALTHCHECK', async () => {
    var log = createMockLog();
    var dockerApi = createMockDockerApi({
      State: { Running: true },
    });

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '1.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance: createMockTriggerInstance(),
      log,
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('has no HEALTHCHECK defined'));

    abortController.abort();
  });

  test('should stop monitoring after window expires when container stays healthy', async () => {
    var log = createMockLog();
    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'healthy' } },
    });

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '1.0.0',
      window: 30000,
      interval: 10000,
      triggerInstance: createMockTriggerInstance(),
      log,
    });

    // Advance through all intervals
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(10000);

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('window expired'));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('unhealthy'));

    abortController.abort();
  });

  test('should trigger rollback when container becomes unhealthy', async () => {
    var log = createMockLog();
    var triggerInstance = createMockTriggerInstance();

    // First poll: healthy, second poll: unhealthy
    var pollCount = 0;
    var dockerApi = {
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockImplementation(async () => {
          pollCount++;
          if (pollCount === 1) {
            return { State: { Running: true, Health: { Status: 'healthy' } } };
          }
          return { State: { Running: true, Health: { Status: 'unhealthy' } } };
        }),
      }),
    };

    mockGetBackups.mockReturnValue([
      {
        id: 'backup-1',
        containerId: 'container-123',
        containerName: 'test-container',
        imageName: 'registry/test-image',
        imageTag: '1.0.0',
        timestamp: new Date().toISOString(),
        triggerName: 'docker.update',
      },
    ]);

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '2.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance,
      log,
    });

    // First poll: healthy
    await vi.advanceTimersByTimeAsync(10000);
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('unhealthy'));

    // Second poll: unhealthy
    await vi.advanceTimersByTimeAsync(10000);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('became unhealthy'));

    expect(triggerInstance.stopAndRemoveContainer).toHaveBeenCalled();
    expect(triggerInstance.recreateContainer).toHaveBeenCalledWith(
      dockerApi,
      expect.anything(),
      'registry/test-image:1.0.0',
      expect.objectContaining({ id: 'container-123', name: 'test-container' }),
      log,
    );

    abortController.abort();
  });

  test('should create audit entry on successful auto-rollback', async () => {
    var log = createMockLog();
    var triggerInstance = createMockTriggerInstance();
    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'unhealthy' } },
    });

    mockGetBackups.mockReturnValue([
      {
        id: 'backup-1',
        containerId: 'container-123',
        containerName: 'test-container',
        imageName: 'registry/test-image',
        imageTag: '1.0.0',
        timestamp: new Date().toISOString(),
        triggerName: 'docker.update',
      },
    ]);

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '2.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance,
      log,
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auto-rollback',
        containerName: 'test-container',
        status: 'success',
        details: 'Automatic rollback triggered by health check failure',
      }),
    );
    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'auto-rollback' });

    abortController.abort();
  });

  test('should use correct backup image for rollback', async () => {
    var log = createMockLog();
    var triggerInstance = createMockTriggerInstance();
    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'unhealthy' } },
    });

    mockGetBackups.mockReturnValue([
      {
        id: 'backup-latest',
        containerId: 'container-123',
        containerName: 'test-container',
        imageName: 'myregistry/myapp',
        imageTag: 'v3.2.1',
        timestamp: new Date().toISOString(),
        triggerName: 'docker.update',
      },
      {
        id: 'backup-older',
        containerId: 'container-123',
        containerName: 'test-container',
        imageName: 'myregistry/myapp',
        imageTag: 'v3.1.0',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        triggerName: 'docker.update',
      },
    ]);

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: 'v3.3.0',
      window: 300000,
      interval: 5000,
      triggerInstance,
      log,
    });

    await vi.advanceTimersByTimeAsync(5000);

    // Should use the most recent backup (first in array)
    expect(triggerInstance.recreateContainer).toHaveBeenCalledWith(
      dockerApi,
      expect.anything(),
      'myregistry/myapp:v3.2.1',
      expect.anything(),
      log,
    );

    abortController.abort();
  });

  test('should respect custom window and interval', async () => {
    var log = createMockLog();
    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'healthy' } },
    });

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '1.0.0',
      window: 20000,
      interval: 5000,
      triggerInstance: createMockTriggerInstance(),
      log,
    });

    // At 5s: first poll
    await vi.advanceTimersByTimeAsync(5000);
    expect(dockerApi.getContainer).toHaveBeenCalledTimes(1);

    // At 10s: second poll
    await vi.advanceTimersByTimeAsync(5000);
    expect(dockerApi.getContainer).toHaveBeenCalledTimes(2);

    // At 15s: third poll
    await vi.advanceTimersByTimeAsync(5000);
    expect(dockerApi.getContainer).toHaveBeenCalledTimes(3);

    // At 20s: window expires
    await vi.advanceTimersByTimeAsync(5000);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('window expired'));

    abortController.abort();
  });

  test('should stop monitoring when aborted via AbortController', async () => {
    var log = createMockLog();
    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'healthy' } },
    });

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '1.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance: createMockTriggerInstance(),
      log,
    });

    await vi.advanceTimersByTimeAsync(10000);
    expect(dockerApi.getContainer).toHaveBeenCalledTimes(1);

    // Abort monitoring
    abortController.abort();

    // Further time advances should not trigger additional polls
    await vi.advanceTimersByTimeAsync(10000);
    expect(dockerApi.getContainer).toHaveBeenCalledTimes(1);
  });

  test('should no-op poll and window callbacks after abort', async () => {
    var log = createMockLog();
    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'healthy' } },
    });
    var triggerInstance = createMockTriggerInstance();

    var intervalCallback;
    var windowCallback;
    var intervalHandle = Symbol('interval');
    var timeoutHandle = Symbol('timeout');

    var setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((fn) => {
      intervalCallback = fn;
      return intervalHandle as ReturnType<typeof setInterval>;
    });
    var setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => {
      windowCallback = fn;
      return timeoutHandle as ReturnType<typeof setTimeout>;
    });
    var clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
    var clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {});

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '1.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance,
      log,
    });

    abortController.abort();
    await intervalCallback();
    windowCallback();

    expect(dockerApi.getContainer).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining('window expired'));
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);

    setIntervalSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  test('should warn when no backups found for auto-rollback', async () => {
    var log = createMockLog();
    var triggerInstance = createMockTriggerInstance();
    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'unhealthy' } },
    });

    mockGetBackups.mockReturnValue([]);

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '2.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance,
      log,
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('No backups found'));
    expect(triggerInstance.stopAndRemoveContainer).not.toHaveBeenCalled();

    abortController.abort();
  });

  test('should warn when current container is missing during auto-rollback', async () => {
    var log = createMockLog();
    var triggerInstance = createMockTriggerInstance();
    triggerInstance.getCurrentContainer.mockResolvedValue(undefined);
    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'unhealthy' } },
    });

    mockGetBackups.mockReturnValue([
      {
        id: 'backup-1',
        containerId: 'container-123',
        containerName: 'test-container',
        imageName: 'registry/test-image',
        imageTag: '1.0.0',
        timestamp: new Date().toISOString(),
        triggerName: 'docker.update',
      },
    ]);

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '2.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance,
      log,
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
    expect(triggerInstance.inspectContainer).not.toHaveBeenCalled();
    expect(triggerInstance.stopAndRemoveContainer).not.toHaveBeenCalled();
    expect(triggerInstance.recreateContainer).not.toHaveBeenCalled();
    expect(mockInsertAudit).not.toHaveBeenCalled();

    abortController.abort();
  });

  test('should handle inspect error gracefully during health check', async () => {
    var log = createMockLog();
    var dockerApi = {
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockRejectedValue(new Error('connection refused')),
      }),
    };

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '1.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance: createMockTriggerInstance(),
      log,
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Error inspecting container'));

    abortController.abort();
  });

  test('should create error audit entry when rollback fails', async () => {
    var log = createMockLog();
    var triggerInstance = createMockTriggerInstance();
    triggerInstance.stopAndRemoveContainer.mockRejectedValue(new Error('stop failed'));

    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'unhealthy' } },
    });

    mockGetBackups.mockReturnValue([
      {
        id: 'backup-1',
        containerId: 'container-123',
        containerName: 'test-container',
        imageName: 'registry/test-image',
        imageTag: '1.0.0',
        timestamp: new Date().toISOString(),
        triggerName: 'docker.update',
      },
    ]);

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '2.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance,
      log,
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auto-rollback',
        status: 'error',
        details: expect.stringContaining('stop failed'),
      }),
    );
    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'auto-rollback' });

    abortController.abort();
  });

  test('should succeed when audit counter is unavailable during rollback success', async () => {
    var log = createMockLog();
    var triggerInstance = createMockTriggerInstance();
    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'unhealthy' } },
    });

    mockGetAuditCounter.mockReturnValue(undefined);
    mockGetBackups.mockReturnValue([
      {
        id: 'backup-1',
        containerId: 'container-123',
        containerName: 'test-container',
        imageName: 'registry/test-image',
        imageTag: '1.0.0',
        timestamp: new Date().toISOString(),
        triggerName: 'docker.update',
      },
    ]);

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '2.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance,
      log,
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auto-rollback',
        status: 'success',
      }),
    );
    expect(mockAuditCounterInc).not.toHaveBeenCalled();

    abortController.abort();
  });

  test('should record rollback error when audit counter is unavailable', async () => {
    var log = createMockLog();
    var triggerInstance = createMockTriggerInstance();
    triggerInstance.stopAndRemoveContainer.mockRejectedValue(new Error('stop failed'));
    var dockerApi = createMockDockerApi({
      State: { Running: true, Health: { Status: 'unhealthy' } },
    });

    mockGetAuditCounter.mockReturnValue(undefined);
    mockGetBackups.mockReturnValue([
      {
        id: 'backup-1',
        containerId: 'container-123',
        containerName: 'test-container',
        imageName: 'registry/test-image',
        imageTag: '1.0.0',
        timestamp: new Date().toISOString(),
        triggerName: 'docker.update',
      },
    ]);

    var abortController = startHealthMonitor({
      dockerApi,
      containerId: 'container-123',
      containerName: 'test-container',
      backupImageTag: '2.0.0',
      window: 300000,
      interval: 10000,
      triggerInstance,
      log,
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auto-rollback',
        status: 'error',
      }),
    );
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Auto-rollback failed'));
    expect(mockAuditCounterInc).not.toHaveBeenCalled();

    abortController.abort();
  });
});
