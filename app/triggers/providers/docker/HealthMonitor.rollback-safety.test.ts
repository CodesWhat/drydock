import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { computeUpdateEligibility } from '../../../model/update-eligibility.js';
import { withContainerUpdateLocks } from '../../../updates/update-locks.js';
import { isDrydockInitiatedStateChange } from '../../../watchers/providers/docker/container-state-alerts.js';
import Docker from './Docker.js';
import { startHealthMonitor } from './HealthMonitor.js';
import { cancelRollbackMonitor, registerRollbackMonitor } from './rollback-monitor-registry.js';

const {
  mockInsertAudit,
  mockGetBackups,
  mockGetContainer,
  mockUpdateContainer,
  mockGetContainers,
  operations,
} = vi.hoisted(() => ({
  mockInsertAudit: vi.fn(),
  mockGetBackups: vi.fn(),
  mockGetContainer: vi.fn(),
  mockUpdateContainer: vi.fn(),
  mockGetContainers: vi.fn(),
  operations: [] as Array<Record<string, unknown>>,
}));

// An in-memory operation store: enough of the real one for the state-alert
// suppression to read what the rollback wrote.
vi.mock('../../../store/update-operation.js', () => ({
  insertOperation: vi.fn((operation: Record<string, unknown>) => {
    const saved = { ...operation, id: `op-${operations.length + 1}` };
    operations.push(saved);
    return saved;
  }),
  markOperationTerminal: vi.fn((id: string, patch: Record<string, unknown>) => {
    const operation = operations.find((candidate) => candidate.id === id);
    Object.assign(operation ?? {}, patch, { completedAt: new Date().toISOString() });
    return operation;
  }),
  getOperationsByContainerId: vi.fn((containerId: string) =>
    operations.filter((operation) => operation.containerId === containerId),
  ),
}));

vi.mock('../../../registry/index.js', () => ({ getState: vi.fn(() => ({ registry: {} })) }));
vi.mock('../../../store/audit.js', () => ({ insertAudit: mockInsertAudit }));
vi.mock('../../../store/backup.js', () => ({
  getBackupsForContainer: mockGetBackups,
  pruneOldBackups: vi.fn(),
}));
vi.mock('../../../prometheus/audit.js', () => ({ getAuditCounter: () => ({ inc: vi.fn() }) }));
vi.mock('../../../store/container.js', () => ({
  getContainer: mockGetContainer,
  getContainers: mockGetContainers,
  updateContainer: mockUpdateContainer,
}));

function createLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

const BACKUP = {
  id: 'backup-1',
  containerId: 'old-id',
  containerName: 'web',
  imageName: 'library/nginx',
  imageTag: '1.0.0',
  imageDigest: 'sha256:kept',
  timestamp: new Date().toISOString(),
  triggerName: 'docker.update',
};

/**
 * A docker api double that tracks one container named `web` the way the
 * daemon does: a dead replacement the monitor found, and the container
 * `createContainer` makes, which only runs once `start()` was called on it.
 */
function createDockerApi(
  options: { startWorks?: boolean; replacementRunning?: boolean; unhealthy?: boolean } = {},
) {
  const { startWorks = true, replacementRunning = false, unhealthy = false } = options;
  const state = {
    current: { id: 'replacement-1', running: replacementRunning, removed: false },
    created: undefined as undefined | { id: string; running: boolean },
  };
  const start = vi.fn(async () => {
    if (startWorks && state.created) {
      state.created.running = true;
    }
  });
  const handle = (entry: { id: string; running: boolean }) => ({
    id: entry.id,
    inspect: async () => ({
      Name: '/web',
      Id: entry.id,
      State: {
        Running: entry.running,
        ExitCode: 1,
        ...(unhealthy && entry === state.current ? { Health: { Status: 'unhealthy' } } : {}),
      },
      Config: { Image: 'library/nginx:2.0.0', Labels: {} },
      HostConfig: {},
      NetworkSettings: { Networks: {} },
      Mounts: [],
    }),
    stop: vi.fn(async () => {
      entry.running = false;
    }),
    remove: vi.fn(async () => {
      state.current.removed = true;
    }),
    start,
  });
  const dockerApi = {
    getContainer: vi.fn((idOrName: string) => {
      if (idOrName === 'web' || idOrName === 'replacement-1') {
        return state.created && state.current.removed
          ? handle(state.created)
          : handle(state.current);
      }
      return handle(state.created ?? state.current);
    }),
    createContainer: vi.fn(async () => {
      state.created = { id: 'restored-1', running: false };
      return handle(state.created);
    }),
    getImage: vi.fn(() => ({ inspect: async () => ({ Id: 'sha256:abc' }) })),
  };
  return { dockerApi, state, start };
}

function createRealDocker(log: ReturnType<typeof createLog>) {
  const docker = new Docker();
  docker.log = log as never;
  docker.configuration = { autoremovetimeout: 1000 } as never;
  vi.spyOn(docker.runtimeConfigManager, 'getCloneRuntimeConfigOptions').mockResolvedValue({});
  vi.spyOn(docker, 'getRollbackIdentityBindingPolicy').mockReturnValue('disabled');
  return docker;
}

function createMonitored(overrides = {}) {
  return {
    id: 'old-id',
    name: 'web',
    watcher: 'local',
    labels: {},
    image: { registry: { name: 'hub' }, name: 'library/nginx', tag: { value: '1.0.0' } },
    updateKind: { kind: 'tag', remoteValue: '2.0.0' },
    result: { tag: '2.0.0', digest: 'sha256:bad' },
    ...overrides,
  };
}

function arm(
  dockerApi: unknown,
  triggerInstance: unknown,
  log: ReturnType<typeof createLog>,
  extra: Record<string, unknown> = {},
) {
  return startHealthMonitor({
    dockerApi,
    container: createMonitored(),
    containerId: 'replacement-1',
    containerName: 'web',
    backupImageTag: '2.0.0',
    backupScope: { containerName: 'web' },
    window: 300_000,
    interval: 10_000,
    mode: 'liveness',
    triggerInstance,
    log,
    ...extra,
  });
}

beforeEach(() => {
  operations.length = 0;
  vi.useFakeTimers();
  mockGetBackups.mockReturnValue([BACKUP]);
  mockGetContainer.mockReturnValue({ id: 'old-id', name: 'web', watcher: 'local' });
  mockGetContainers.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('rollback restores the pre-update running state', () => {
  test('a liveness rollback starts the restored container although the replacement was dead', async () => {
    const log = createLog();
    const { dockerApi, state, start } = createDockerApi({ replacementRunning: false });
    const controller = arm(dockerApi, createRealDocker(log), log);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(dockerApi.createContainer).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(state.created?.running).toBe(true);
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auto-rollback', status: 'success' }),
    );
    controller.abort();
  });

  test('a container that was stopped before the update is restored stopped', async () => {
    const log = createLog();
    const { dockerApi, start } = createDockerApi({ replacementRunning: false });
    const controller = arm(dockerApi, createRealDocker(log), log, { wasRunning: false });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(dockerApi.createContainer).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auto-rollback', status: 'success' }),
    );
    controller.abort();
  });

  test('records success only after the restored container is seen running', async () => {
    const log = createLog();
    const { dockerApi, state } = createDockerApi({ startWorks: false });
    const controller = arm(dockerApi, createRealDocker(log), log);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(state.created?.running).toBe(false);
    expect(mockInsertAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success' }),
    );
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auto-rollback',
        status: 'error',
        details: expect.stringContaining('is not running after the rollback'),
      }),
    );
    expect(mockUpdateContainer).not.toHaveBeenCalled();
    controller.abort();
  });

  test('records an error when the restored container cannot be found again', async () => {
    const log = createLog();
    const { dockerApi } = createDockerApi();
    const docker = createRealDocker(log);
    const realGetCurrent = docker.getCurrentContainer.bind(docker);
    let calls = 0;
    vi.spyOn(docker, 'getCurrentContainer').mockImplementation(async (api, ref) => {
      calls += 1;
      return calls === 1 ? realGetCurrent(api, ref) : undefined;
    });
    const controller = arm(dockerApi, docker, log);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockInsertAudit).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    controller.abort();
  });
});

describe('rollbacks record updateRollback so the eligibility gate blocks the candidate', () => {
  test.each([
    ['liveness', 'liveness-failure'],
    ['health', 'health-check-failure'],
  ] as const)('a %s rollback records %s for the rolled-back candidate', async (mode, reason) => {
    const log = createLog();
    const { dockerApi } = createDockerApi({
      unhealthy: mode === 'health',
      replacementRunning: mode === 'health',
    });
    const docker = createRealDocker(log);
    const controller = arm(dockerApi, docker, log, { mode });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockUpdateContainer).toHaveBeenCalledTimes(1);
    const written = mockUpdateContainer.mock.calls[0][0];
    expect(written.updateRollback).toEqual({
      recordedAt: expect.any(String),
      targetDigest: 'sha256:bad',
      reason,
      lastError: '',
    });

    // The gate then blocks the same candidate on the next evaluation.
    const eligibility = computeUpdateEligibility(
      {
        ...written,
        updateAvailable: true,
        updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
        image: { registry: { name: 'hub' }, name: 'library/nginx', tag: { value: '1.0.0' } },
        result: { tag: '2.0.0', digest: 'sha256:bad' },
      } as never,
      { triggers: undefined, getActiveOperation: () => undefined, now: Date.now() },
    );
    expect(eligibility.blockers.map((b) => b.reason)).toContain('last-update-rolled-back');
    controller.abort();
  });
});

describe('rollbacks serialise with updates and can be cancelled', () => {
  test('a rollback waits for an update holding the container lock', async () => {
    const log = createLog();
    const { dockerApi } = createDockerApi();
    const controller = arm(dockerApi, createRealDocker(log), log);
    let releaseUpdate: () => void = () => {};
    const updateHolds = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    const update = withContainerUpdateLocks(['container:local:web'], () => updateHolds);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(dockerApi.createContainer).not.toHaveBeenCalled();

    releaseUpdate();
    await update;
    await vi.advanceTimersByTimeAsync(0);

    expect(dockerApi.createContainer).toHaveBeenCalledTimes(1);
    controller.abort();
  });

  test('a monitor cancelled while its rollback was queued stands down', async () => {
    const log = createLog();
    const { dockerApi } = createDockerApi();
    const controller = arm(dockerApi, createRealDocker(log), log);
    registerRollbackMonitor({ name: 'web', watcher: 'local' }, controller);
    let releaseUpdate: () => void = () => {};
    const updateHolds = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    const update = withContainerUpdateLocks(['container:local:web'], () => updateHolds);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(cancelRollbackMonitor({ name: 'web', watcher: 'local' })).toBe(true);
    releaseUpdate();
    await update;
    await vi.advanceTimersByTimeAsync(0);

    expect(dockerApi.createContainer).not.toHaveBeenCalled();
    expect(mockInsertAudit).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('monitoring was cancelled'));
  });

  test('uses the trigger lock keys when it provides them', async () => {
    const log = createLog();
    const { dockerApi } = createDockerApi();
    const docker = createRealDocker(log);
    const keys = vi.spyOn(docker, 'getUpdateLockKeys').mockReturnValue(['compose:local:stack']);
    const controller = arm(dockerApi, docker, log);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(keys).toHaveBeenCalled();
    controller.abort();
  });
});

describe('rollbacks are recorded as operations so state alerts stay quiet', () => {
  test('the container being stopped is covered while the rollback stops it, and the record closes as rolled-back', async () => {
    const log = createLog();
    const { dockerApi } = createDockerApi();
    const docker = createRealDocker(log);
    const coveredDuringStop: boolean[] = [];
    const realStop = docker.stopAndRemoveContainer.bind(docker);
    vi.spyOn(docker, 'stopAndRemoveContainer').mockImplementation(async (...args) => {
      coveredDuringStop.push(isDrydockInitiatedStateChange({ id: 'replacement-1' } as never));
      return realStop(...args);
    });
    // Nothing covers the container before the rollback begins.
    expect(isDrydockInitiatedStateChange({ id: 'replacement-1' } as never)).toBe(false);
    const controller = arm(dockerApi, docker, log);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(coveredDuringStop).toEqual([true]);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: 'rollback',
      containerId: 'replacement-1',
      containerName: 'web',
      fromVersion: '2.0.0',
      toVersion: '1.0.0',
      status: 'rolled-back',
      phase: 'rolled-back',
    });
    // Still covered in the grace window after the operation closed.
    expect(isDrydockInitiatedStateChange({ id: 'replacement-1' } as never)).toBe(true);
    controller.abort();
  });

  test('a rollback that fails closes its operation as failed', async () => {
    const log = createLog();
    const { dockerApi } = createDockerApi({ startWorks: false });
    const controller = arm(dockerApi, createRealDocker(log), log);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(operations[0]).toMatchObject({
      kind: 'rollback',
      status: 'failed',
      phase: 'rollback-failed',
      lastError: expect.stringContaining('is not running after the rollback'),
    });
    controller.abort();
  });
});
