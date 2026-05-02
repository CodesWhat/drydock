import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetInProgressOperationByContainerName,
  mockGetOperationById,
  mockInsertOperation,
  mockReopenTerminalOperation,
  mockUpdateOperation,
  mockMarkOperationTerminal,
  mockGetActiveOperationByContainerName,
  mockGetActiveOperationByContainerId,
  mockIsOperationCancelRequested,
  MockOperationCancelledError,
  mockStartHealthGateHeartbeat,
  mockCancelHeartbeat,
} = vi.hoisted(() => {
  class MockOperationCancelledError extends Error {
    readonly operationId: string;

    constructor(operationId: string) {
      super('Cancelled by operator');
      this.name = 'OperationCancelledError';
      this.operationId = operationId;
    }
  }
  const mockCancelHeartbeat = vi.fn();
  const mockStartHealthGateHeartbeat = vi.fn(() => mockCancelHeartbeat);
  return {
    mockGetInProgressOperationByContainerName: vi.fn(),
    mockGetOperationById: vi.fn(),
    mockInsertOperation: vi.fn(),
    mockReopenTerminalOperation: vi.fn(),
    mockUpdateOperation: vi.fn(),
    mockMarkOperationTerminal: vi.fn(),
    mockGetActiveOperationByContainerName: vi.fn(),
    mockGetActiveOperationByContainerId: vi.fn(),
    mockIsOperationCancelRequested: vi.fn(() => false),
    MockOperationCancelledError,
    mockStartHealthGateHeartbeat,
    mockCancelHeartbeat,
  };
});

vi.mock('../../../store/update-operation.js', () => ({
  getInProgressOperationByContainerName: mockGetInProgressOperationByContainerName,
  getOperationById: mockGetOperationById,
  insertOperation: mockInsertOperation,
  reopenTerminalOperation: mockReopenTerminalOperation,
  updateOperation: mockUpdateOperation,
  markOperationTerminal: mockMarkOperationTerminal,
  getActiveOperationByContainerName: mockGetActiveOperationByContainerName,
  getActiveOperationByContainerId: mockGetActiveOperationByContainerId,
  isOperationCancelRequested: mockIsOperationCancelRequested,
  OperationCancelledError: MockOperationCancelledError,
}));

vi.mock('../../../updates/health-gate-heartbeat.js', () => ({
  startHealthGateHeartbeat: mockStartHealthGateHeartbeat,
  HEALTH_GATE_HEARTBEAT_MS: 10_000,
}));

import ContainerUpdateExecutor from './ContainerUpdateExecutor.js';

function createContainer(overrides = {}) {
  return {
    id: 'container-id',
    name: 'web',
    image: {
      name: 'ghcr.io/acme/web',
      tag: { value: '1.0.0' },
    },
    updateKind: {
      localValue: '1.0.0',
      remoteValue: '1.0.1',
    },
    ...overrides,
  };
}

function createCurrentContainerSpec(overrides = {}) {
  return {
    Name: '/web',
    Id: 'old-container-id',
    State: {
      Running: false,
    },
    HostConfig: {
      AutoRemove: false,
    },
    Config: {
      Image: 'ghcr.io/acme/web:1.0.0',
    },
    ...overrides,
  };
}

function createContext(overrides = {}) {
  const currentContainer = {
    rename: vi.fn().mockResolvedValue(undefined),
  };
  const newContainer = {
    inspect: vi.fn().mockResolvedValue({ Id: 'new-container-id' }),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const dockerApi = {
    getContainer: vi.fn(),
  };

  return {
    dockerApi,
    auth: { username: 'bot', password: 'token' },
    newImage: 'ghcr.io/acme/web:1.0.1',
    currentContainer,
    currentContainerSpec: createCurrentContainerSpec(),
    newContainer,
    ...overrides,
  };
}

function createLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function createExecutor(overrides = {}) {
  return new ContainerUpdateExecutor({
    getConfiguration: () => ({ dryrun: false }),
    getTriggerId: vi.fn(() => 'docker.update'),
    getRollbackConfig: vi.fn(() => ({ autoRollback: false })),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    waitContainerRemoved: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    createContainer: vi.fn(),
    startContainer: vi.fn().mockResolvedValue(undefined),
    pullImage: vi.fn().mockResolvedValue(undefined),
    cloneContainer: vi.fn(() => ({ cloned: true })),
    getCloneRuntimeConfigOptions: vi.fn().mockResolvedValue({ runtime: true }),
    isContainerNotFoundError: vi.fn(() => false),
    recordRollbackTelemetry: vi.fn(),
    buildRuntimeConfigCompatibilityError: vi.fn(() => undefined),
    hasHealthcheckConfigured: vi.fn(() => false),
    waitForContainerHealthy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

describe('ContainerUpdateExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertOperation.mockReturnValue({ id: 'op-1' });
    mockReopenTerminalOperation.mockReturnValue({ id: 'op-1' });
    mockGetInProgressOperationByContainerName.mockReturnValue(undefined);
    mockGetOperationById.mockReturnValue(undefined);
    mockIsOperationCancelRequested.mockReturnValue(false);
    mockStartHealthGateHeartbeat.mockReturnValue(mockCancelHeartbeat);
  });

  test('constructor provides default configuration fallback', () => {
    const executor = new ContainerUpdateExecutor({
      getTriggerId: vi.fn(() => 'docker.update'),
      getRollbackConfig: vi.fn(() => ({ autoRollback: false })),
      stopContainer: vi.fn(),
      waitContainerRemoved: vi.fn(),
      removeContainer: vi.fn(),
      createContainer: vi.fn(),
      startContainer: vi.fn(),
      pullImage: vi.fn(),
      cloneContainer: vi.fn(),
      getCloneRuntimeConfigOptions: vi.fn(),
      isContainerNotFoundError: vi.fn(() => false),
      recordRollbackTelemetry: vi.fn(),
      buildRuntimeConfigCompatibilityError: vi.fn(() => undefined),
      hasHealthcheckConfigured: vi.fn(() => false),
      waitForContainerHealthy: vi.fn(),
    });
    expect(executor.getConfiguration()).toEqual({});
  });

  test('constructor should throw when required dependencies are missing', () => {
    expect(() => new ContainerUpdateExecutor({} as never)).toThrow(
      'ContainerUpdateExecutor requires dependency "getTriggerId"',
    );
  });

  test('inspectContainerByIdentifier returns inspection result or undefined when missing/failing', async () => {
    const inspect = vi.fn().mockResolvedValue({ State: { Running: true } });
    const dockerApi = {
      getContainer: vi.fn(() => ({ inspect })),
    };
    const executor = createExecutor();
    const log = createLog();

    await expect(
      executor.inspectContainerByIdentifier(dockerApi, undefined, log),
    ).resolves.toBeUndefined();
    await expect(
      executor.inspectContainerByIdentifier(dockerApi, 'container-id', log),
    ).resolves.toEqual({
      container: { inspect },
      inspection: { State: { Running: true } },
    });

    dockerApi.getContainer = vi.fn(() => ({
      inspect: vi.fn().mockRejectedValue(new Error('boom')),
    }));
    await expect(
      executor.inspectContainerByIdentifier(dockerApi, 'container-id', log),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      'Unable to inspect container container-id during recovery (boom)',
    );
  });

  test('inspectContainerByIdentifier suppresses warning when error is a container-not-found error', async () => {
    const dockerApi = {
      getContainer: vi.fn(() => ({
        inspect: vi.fn().mockRejectedValue(new Error('no such container')),
      })),
    };
    const executor = createExecutor({
      isContainerNotFoundError: vi.fn(() => true),
    });
    const log = createLog();

    await expect(
      executor.inspectContainerByIdentifier(dockerApi, 'gone-container', log),
    ).resolves.toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('stopAndRemoveContainerBestEffort handles missing, stop failure, and remove failure cases', async () => {
    const log = createLog();
    const executor = createExecutor();

    vi.spyOn(executor, 'inspectContainerByIdentifier').mockResolvedValueOnce(undefined);
    await expect(executor.stopAndRemoveContainerBestEffort({}, 'temp', log)).resolves.toBe(false);

    const runningContainer = {
      stop: vi.fn().mockRejectedValue(new Error('stop failed')),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(executor, 'inspectContainerByIdentifier').mockResolvedValueOnce({
      container: runningContainer,
      inspection: { State: { Running: true } },
    });
    await expect(executor.stopAndRemoveContainerBestEffort({}, 'temp', log)).resolves.toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      'Failed to stop stale container temp during recovery (stop failed)',
    );

    const stoppedContainer = {
      stop: vi.fn(),
      remove: vi.fn().mockRejectedValue(new Error('remove failed')),
    };
    vi.spyOn(executor, 'inspectContainerByIdentifier').mockResolvedValueOnce({
      container: stoppedContainer,
      inspection: { State: { Running: false } },
    });
    await expect(executor.stopAndRemoveContainerBestEffort({}, 'temp', log)).resolves.toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      'Failed to remove stale container temp during recovery (remove failed)',
    );
  });

  test('reconcileInProgressContainerUpdateOperation no-ops when no pending operation exists', async () => {
    mockGetInProgressOperationByContainerName.mockReturnValue(undefined);
    const executor = createExecutor();

    await expect(
      executor.reconcileInProgressContainerUpdateOperation({}, createContainer(), createLog()),
    ).resolves.toBeUndefined();

    expect(mockUpdateOperation).not.toHaveBeenCalled();
  });

  test('reconcile marks success when both active and temp containers exist', async () => {
    const pending = {
      id: 'op-1',
      oldName: 'web',
      tempName: 'web-old-1',
      fromVersion: '1.0.0',
      toVersion: '1.0.1',
    };
    mockGetInProgressOperationByContainerName.mockReturnValue(pending);

    const executor = createExecutor();
    vi.spyOn(executor, 'inspectContainerByIdentifier')
      .mockResolvedValueOnce({ container: {}, inspection: {} })
      .mockResolvedValueOnce({ container: {}, inspection: {} });
    vi.spyOn(executor, 'stopAndRemoveContainerBestEffort').mockResolvedValueOnce(false);

    await executor.reconcileInProgressContainerUpdateOperation({}, createContainer(), createLog());

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'succeeded',
        phase: 'recovered-cleanup-temp',
      }),
    );
  });

  test('reconcile records successful cleanup details when stale temp container is removed', async () => {
    const pending = {
      id: 'op-1',
      oldName: 'web',
      tempName: 'web-old-1',
      fromVersion: '1.0.0',
      toVersion: '1.0.1',
    };
    mockGetInProgressOperationByContainerName.mockReturnValue(pending);

    const executor = createExecutor();
    vi.spyOn(executor, 'inspectContainerByIdentifier')
      .mockResolvedValueOnce({ container: {}, inspection: {} })
      .mockResolvedValueOnce({ container: {}, inspection: {} });
    vi.spyOn(executor, 'stopAndRemoveContainerBestEffort').mockResolvedValueOnce(true);

    await executor.reconcileInProgressContainerUpdateOperation({}, createContainer(), createLog());

    expect(executor.recordRollbackTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'startup_reconcile_cleanup_temp',
        details: 'Recovered stale renamed container web-old-1',
      }),
    );
  });

  test('reconcile restores old name when only temp container exists and restart is needed', async () => {
    const pending = {
      id: 'op-1',
      oldName: 'web',
      tempName: 'web-old-1',
      oldContainerWasRunning: true,
      oldContainerStopped: true,
      fromVersion: '1.0.0',
      toVersion: '1.0.1',
    };
    mockGetInProgressOperationByContainerName.mockReturnValue(pending);

    const tempContainer = {
      rename: vi.fn().mockResolvedValue(undefined),
    };
    const restored = {
      start: vi.fn().mockResolvedValue(undefined),
    };
    const dockerApi = {
      getContainer: vi.fn(() => restored),
    };

    const executor = createExecutor();
    vi.spyOn(executor, 'inspectContainerByIdentifier')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ container: tempContainer, inspection: {} });

    await executor.reconcileInProgressContainerUpdateOperation(
      dockerApi,
      createContainer(),
      createLog(),
    );

    expect(tempContainer.rename).toHaveBeenCalledWith({ name: 'web' });
    expect(restored.start).toHaveBeenCalled();
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'rolled-back',
        phase: 'recovered-rollback',
      }),
    );
  });

  test('reconcile restores old name without restart when old container was not stopped', async () => {
    const pending = {
      id: 'op-1',
      oldName: 'web',
      tempName: 'web-old-1',
      oldContainerWasRunning: true,
      oldContainerStopped: false,
      fromVersion: '1.0.0',
      toVersion: '1.0.1',
    };
    mockGetInProgressOperationByContainerName.mockReturnValue(pending);

    const tempContainer = {
      rename: vi.fn().mockResolvedValue(undefined),
    };
    const dockerApi = {
      getContainer: vi.fn(),
    };

    const executor = createExecutor();
    vi.spyOn(executor, 'inspectContainerByIdentifier')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ container: tempContainer, inspection: {} });

    await executor.reconcileInProgressContainerUpdateOperation(
      dockerApi,
      createContainer(),
      createLog(),
    );

    expect(tempContainer.rename).toHaveBeenCalledWith({ name: 'web' });
    expect(dockerApi.getContainer).not.toHaveBeenCalled();
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'rolled-back',
        phase: 'recovered-rollback',
      }),
    );
  });

  test('reconcile records failures when restoring from temp-only state fails', async () => {
    const pending = {
      id: 'op-1',
      oldName: 'web',
      tempName: 'web-old-1',
      oldContainerWasRunning: false,
      oldContainerStopped: false,
      fromVersion: '1.0.0',
      toVersion: '1.0.1',
    };
    mockGetInProgressOperationByContainerName.mockReturnValue(pending);

    const tempContainer = {
      rename: vi.fn().mockRejectedValue(new Error('rename failed')),
    };

    const executor = createExecutor();
    vi.spyOn(executor, 'inspectContainerByIdentifier')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ container: tempContainer, inspection: {} });

    await executor.reconcileInProgressContainerUpdateOperation({}, createContainer(), createLog());

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'failed',
        phase: 'recovery-failed',
        lastError: 'rename failed',
      }),
    );
  });

  test('reconcile records string errors when restoring from temp-only state fails with non-Error', async () => {
    const pending = {
      id: 'op-1',
      oldName: 'web',
      tempName: 'web-old-1',
      oldContainerWasRunning: false,
      oldContainerStopped: false,
      fromVersion: '1.0.0',
      toVersion: '1.0.1',
    };
    mockGetInProgressOperationByContainerName.mockReturnValue(pending);

    const tempContainer = {
      rename: vi.fn().mockRejectedValue('rename failed as string'),
    };

    const executor = createExecutor();
    vi.spyOn(executor, 'inspectContainerByIdentifier')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ container: tempContainer, inspection: {} });

    await executor.reconcileInProgressContainerUpdateOperation({}, createContainer(), createLog());

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'failed',
        phase: 'recovery-failed',
        lastError: 'rename failed as string',
      }),
    );
  });

  test('reconcile handles active-only and missing-container recovery states', async () => {
    const pending = {
      id: 'op-1',
      oldName: 'web',
      tempName: 'web-old-1',
      fromVersion: '1.0.0',
      toVersion: '1.0.1',
    };
    mockGetInProgressOperationByContainerName.mockReturnValue(pending);

    const executor = createExecutor();
    const inspectSpy = vi.spyOn(executor, 'inspectContainerByIdentifier');

    inspectSpy
      .mockResolvedValueOnce({ container: {}, inspection: {} })
      .mockResolvedValueOnce(undefined);
    await executor.reconcileInProgressContainerUpdateOperation({}, createContainer(), createLog());
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'succeeded',
        phase: 'recovered-active',
      }),
    );

    inspectSpy.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    await executor.reconcileInProgressContainerUpdateOperation({}, createContainer(), createLog());
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'failed',
        phase: 'recovery-missing-containers',
      }),
    );
  });

  test('execute returns false for dry-run mode after image pull', async () => {
    const pullImage = vi.fn().mockResolvedValue(undefined);
    const executor = createExecutor({
      getConfiguration: () => ({ dryrun: true }),
      pullImage,
    });

    await expect(executor.execute(createContext(), createContainer(), createLog())).resolves.toBe(
      false,
    );
    expect(pullImage).toHaveBeenCalled();
  });

  test('execute records pull failures before rethrowing the error', async () => {
    const pullImage = vi.fn().mockRejectedValue(new Error('pull failed'));
    const executor = createExecutor({ pullImage });

    await expect(executor.execute(createContext(), createContainer(), createLog())).rejects.toThrow(
      'pull failed',
    );

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'failed',
        phase: 'pull-failed',
        lastError: 'pull failed',
      }),
    );
  });

  test('execute updates a pre-created queued operation when runtime context provides an operation id', async () => {
    mockGetOperationById.mockReturnValue({
      id: 'queued-op',
      status: 'queued',
    });
    mockUpdateOperation.mockReturnValue({ id: 'queued-op' });
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: false },
        HostConfig: { AutoRemove: false },
      }),
    });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(
      executor.execute(context, createContainer(), createLog(), { operationId: ' queued-op ' }),
    ).resolves.toBe(true);

    expect(mockGetOperationById).toHaveBeenCalledWith('queued-op');
    expect(mockUpdateOperation).toHaveBeenCalledWith(
      'queued-op',
      expect.objectContaining({
        containerId: 'container-id',
        status: 'in-progress',
        phase: 'pulling',
      }),
    );
    expect(mockInsertOperation).not.toHaveBeenCalled();
  });

  test('execute performs successful update without runtime start when old container is stopped', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: false },
        HostConfig: { AutoRemove: false },
      }),
    });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(executor.execute(context, createContainer(), createLog())).resolves.toBe(true);

    expect(context.currentContainer.rename).toHaveBeenCalledWith({
      name: expect.stringMatching(/^web-old-/),
    });
    expect(executor.removeContainer).toHaveBeenCalled();
    expect(executor.stopContainer).not.toHaveBeenCalled();
    expect(executor.startContainer).not.toHaveBeenCalledWith(
      context.newContainer,
      'web',
      expect.anything(),
    );
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'succeeded',
        phase: 'succeeded',
      }),
    );
  });

  test('execute health-gates when healthcheck exists even if auto-rollback is disabled', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
        HostConfig: { AutoRemove: false },
      }),
    });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      getRollbackConfig: vi.fn(() => ({ autoRollback: false })),
      hasHealthcheckConfigured: vi.fn(() => true),
    });
    const log = createLog();

    await expect(executor.execute(context, createContainer(), log)).resolves.toBe(true);

    expect(executor.startContainer).toHaveBeenCalledWith(context.newContainer, 'web', log);
    expect(executor.waitForContainerHealthy).toHaveBeenCalledWith(
      context.newContainer,
      'web',
      log,
      120_000,
    );
    expect(mockUpdateOperation).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        phase: 'health-gate-passed',
      }),
    );
  });

  test('execute runs stop/start/health and auto-remove cleanup when old container was running', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
        HostConfig: { AutoRemove: true },
      }),
    });
    context.newContainer.inspect.mockRejectedValue(new Error('inspect unavailable'));
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      getRollbackConfig: vi.fn(() => ({ autoRollback: true })),
      hasHealthcheckConfigured: vi.fn(() => true),
      isContainerNotFoundError: vi.fn((error) => error?.message === 'gone'),
      waitContainerRemoved: vi.fn().mockRejectedValue(new Error('gone')),
    });
    const log = createLog();

    await expect(executor.execute(context, createContainer(), log)).resolves.toBe(true);

    expect(executor.stopContainer).toHaveBeenCalled();
    expect(executor.startContainer).toHaveBeenCalledWith(context.newContainer, 'web', log);
    expect(executor.waitForContainerHealthy).toHaveBeenCalledWith(
      context.newContainer,
      'web',
      log,
      120_000,
    );
    expect(executor.waitContainerRemoved).toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('was already removed during cleanup'),
    );
    expect(log.warn).toHaveBeenCalledWith(
      'Unable to inspect candidate container web after creation (inspect unavailable)',
    );
    expect(mockUpdateOperation).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        phase: 'health-gate-passed',
      }),
    );
  });

  test('execute passes rollback window to health gate when auto-rollback is enabled', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
        HostConfig: { AutoRemove: false },
      }),
    });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      getRollbackConfig: vi.fn(() => ({ autoRollback: true, rollbackWindow: 300_000 })),
      hasHealthcheckConfigured: vi.fn(() => true),
    });
    const log = createLog();

    await expect(executor.execute(context, createContainer(), log)).resolves.toBe(true);

    expect(executor.waitForContainerHealthy).toHaveBeenCalledWith(
      context.newContainer,
      'web',
      log,
      300_000,
    );
  });

  test('execute ignores non-string requested operation ids in runtime context', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: false },
        HostConfig: { AutoRemove: false },
      }),
    });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(
      executor.execute(context, createContainer(), createLog(), {
        operationId: 123,
      }),
    ).resolves.toBe(true);

    expect(mockInsertOperation.mock.calls.at(-1)?.[0]?.id).toBeUndefined();
  });

  test('execute ignores blank requested operation ids in runtime context', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: false },
        HostConfig: { AutoRemove: false },
      }),
    });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(
      executor.execute(context, createContainer(), createLog(), {
        operationId: '   ',
      }),
    ).resolves.toBe(true);

    expect(mockInsertOperation.mock.calls.at(-1)?.[0]?.id).toBeUndefined();
  });

  test('execute trims and reuses valid requested operation ids in runtime context', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: false },
        HostConfig: { AutoRemove: false },
      }),
    });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(
      executor.execute(context, createContainer(), createLog(), {
        operationId: ' custom-op ',
      }),
    ).resolves.toBe(true);

    expect(mockInsertOperation.mock.calls.at(-1)?.[0]?.id).toBe('custom-op');
  });

  test('execute reuses a per-container requested operation id from runtime context operationIds', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: false },
        HostConfig: { AutoRemove: false },
      }),
    });
    mockGetOperationById.mockReturnValue({
      id: 'op-from-map',
      status: 'queued',
    });
    mockUpdateOperation.mockReturnValue({ id: 'op-from-map' });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(
      executor.execute(context, createContainer(), createLog(), {
        operationIds: {
          'container-id': ' op-from-map ',
        },
      }),
    ).resolves.toBe(true);

    expect(mockGetOperationById).toHaveBeenCalledWith('op-from-map');
    expect(mockUpdateOperation).toHaveBeenCalledWith(
      'op-from-map',
      expect.objectContaining({
        containerId: 'container-id',
        status: 'in-progress',
        phase: 'pulling',
      }),
    );
    expect(mockInsertOperation).not.toHaveBeenCalled();
  });

  test('execute reuses a queued pre-created operation instead of inserting a new one', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: false },
        HostConfig: { AutoRemove: false },
      }),
    });
    mockGetOperationById.mockReturnValue({
      id: 'queued-op-1',
      status: 'queued',
    });
    mockUpdateOperation.mockReturnValue({ id: 'queued-op-1' });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(
      executor.execute(context, createContainer(), createLog(), {
        operationId: 'queued-op-1',
      }),
    ).resolves.toBe(true);

    expect(mockUpdateOperation.mock.calls[0]?.[0]).toBe('queued-op-1');
    expect(mockUpdateOperation.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        containerId: 'container-id',
        containerName: 'web',
        triggerName: 'docker.update',
        oldContainerId: 'old-container-id',
        oldName: 'web',
        tempName: expect.stringMatching(/^web-old-/),
        status: 'in-progress',
        phase: 'pulling',
      }),
    );
    expect(mockInsertOperation).not.toHaveBeenCalled();
  });

  test('execute revives an expired pre-created operation instead of inserting a duplicate row', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: false },
        HostConfig: { AutoRemove: false },
      }),
    });
    const existingOperation = {
      id: 'queued-op-expired',
      containerId: 'container-id',
      containerName: 'web',
      status: 'failed',
      phase: 'queued',
      lastError: 'Marked failed after exceeding active update TTL',
    };
    mockGetOperationById.mockImplementation(() => existingOperation);
    mockReopenTerminalOperation.mockImplementation((_id, patch) => {
      Object.assign(existingOperation, patch);
      return { ...existingOperation };
    });
    mockMarkOperationTerminal.mockImplementationOnce((_id, patch) => {
      Object.assign(existingOperation, patch);
      return { ...existingOperation };
    });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(
      executor.execute(context, createContainer(), createLog(), {
        operationId: 'queued-op-expired',
      }),
    ).resolves.toBe(true);

    expect(mockInsertOperation).not.toHaveBeenCalled();
    expect(mockReopenTerminalOperation.mock.calls[0]?.[0]).toBe('queued-op-expired');
    expect(mockReopenTerminalOperation.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        status: 'in-progress',
        phase: 'pulling',
      }),
    );
    expect(mockUpdateOperation).toHaveBeenCalledWith(
      'queued-op-expired',
      expect.objectContaining({
        phase: 'prepare',
      }),
    );
    expect(existingOperation.id).toBe('queued-op-expired');
    expect(existingOperation.status).toBe('succeeded');
    expect(mockGetOperationById('queued-op-expired')).toEqual(
      expect.objectContaining({
        id: 'queued-op-expired',
        status: 'succeeded',
        phase: 'succeeded',
      }),
    );
  });

  test('execute rolls back and rethrows original error when rollback succeeds', async () => {
    const context = createContext();
    const createContainerError = new Error('create failed');
    const executor = createExecutor({
      createContainer: vi.fn().mockRejectedValue(createContainerError),
      buildRuntimeConfigCompatibilityError: vi.fn(() => undefined),
    });

    await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow(
      'create failed',
    );

    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'web' });
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'rolled-back',
        rollbackReason: 'create_new_failed',
      }),
    );
    expect(executor.recordRollbackTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        container: expect.anything(),
        outcome: 'success',
        reason: 'create_new_failed',
        details: expect.stringContaining('Rollback completed after create_new_failed'),
        fromVersion: '1.0.1',
        toVersion: '1.0.0',
      }),
    );
  });

  test('execute uses the shared fallback for object errors when message field is undefined', async () => {
    const context = createContext();
    const createContainerError = { message: undefined, detail: 'create failed' };
    const executor = createExecutor({
      createContainer: vi.fn().mockRejectedValue(createContainerError),
      buildRuntimeConfigCompatibilityError: vi.fn(() => undefined),
    });

    await expect(executor.execute(context, createContainer(), createLog())).rejects.toBe(
      createContainerError,
    );

    expect(mockUpdateOperation).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        lastError: 'unknown error',
      }),
    );
  });

  test('execute logs best-effort rollback cleanup failures for failed candidate container', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
        HostConfig: { AutoRemove: true },
      }),
    });
    context.newContainer.stop.mockRejectedValue(new Error('new stop failed'));
    context.newContainer.remove.mockRejectedValue('remove failed as string');
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      stopContainer: vi.fn().mockResolvedValue(undefined),
      startContainer: vi.fn().mockResolvedValue(undefined),
      hasHealthcheckConfigured: vi.fn(() => false),
      waitContainerRemoved: vi.fn().mockRejectedValue(new Error('cleanup exploded')),
      isContainerNotFoundError: vi.fn(() => false),
      buildRuntimeConfigCompatibilityError: vi.fn(() => undefined),
    });
    const log = createLog();

    await expect(executor.execute(context, createContainer(), log)).rejects.toThrow(
      'cleanup exploded',
    );

    expect(log.warn).toHaveBeenCalledWith(
      'Unable to stop failed candidate container web during rollback (new stop failed)',
    );
    expect(log.warn).toHaveBeenCalledWith(
      'Unable to remove failed candidate container web during rollback (remove failed as string)',
    );
  });

  test('execute rolls back on cleanup errors and falls back to image tag versions when updateKind values are missing', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
        HostConfig: { AutoRemove: true },
      }),
    });
    const container = createContainer({
      updateKind: {
        localValue: undefined,
        remoteValue: undefined,
      },
    });
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
      waitContainerRemoved: vi.fn().mockRejectedValue(new Error('cleanup exploded')),
      isContainerNotFoundError: vi.fn(() => false),
    });

    await expect(executor.execute(context, container, createLog())).rejects.toThrow(
      'cleanup exploded',
    );

    expect(mockInsertOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        fromVersion: '1.0.0',
        toVersion: '1.0.0',
      }),
    );
    expect(executor.recordRollbackTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        outcome: 'success',
        reason: 'cleanup_old_failed',
        details: expect.stringContaining('Rollback completed after cleanup_old_failed'),
        fromVersion: '1.0.0',
        toVersion: '1.0.0',
      }),
    );
  });

  test('execute throws compatibility error when rollback is partially failed', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
      }),
    });

    const startContainer = vi
      .fn()
      .mockRejectedValueOnce(new Error('new start failed'))
      .mockRejectedValueOnce(new Error('old restart failed'));

    context.currentContainer.rename
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rename rollback failed'));

    const compatibilityError = new Error('runtime compatibility error');
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      stopContainer: vi.fn().mockResolvedValue(undefined),
      startContainer,
      buildRuntimeConfigCompatibilityError: vi.fn(() => compatibilityError),
    });

    await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow(
      'runtime compatibility error',
    );

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'failed',
        phase: 'rollback-failed',
        rollbackReason: 'start_new_failed',
      }),
    );
    expect(executor.recordRollbackTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        container: expect.anything(),
        outcome: 'error',
        reason: 'start_new_failed_rollback_failed',
        details: expect.stringContaining('Rollback failed after start_new_failed'),
        fromVersion: '1.0.1',
        toVersion: '1.0.0',
      }),
    );
  });

  test('execute defers reconciliation when rollback fails due to connection error', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
      }),
    });

    const connectionError = new Error('connect ECONNREFUSED 127.0.0.1:2375');

    const startContainer = vi
      .fn()
      .mockRejectedValueOnce(connectionError)
      .mockRejectedValueOnce(connectionError);

    context.currentContainer.rename
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(connectionError);

    const scheduleDeferredReconciliation = vi.fn();
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      stopContainer: vi.fn().mockResolvedValue(undefined),
      startContainer,
      scheduleDeferredReconciliation,
    });

    await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow(
      'ECONNREFUSED',
    );

    expect(mockUpdateOperation).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'in-progress',
        phase: 'rollback-deferred',
      }),
    );
    expect(scheduleDeferredReconciliation).toHaveBeenCalledWith('web', 'op-1', 10_000);
    expect(executor.recordRollbackTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'start_new_failed_rollback_deferred',
        details: expect.stringContaining('Rollback deferred'),
      }),
    );
  });

  test('execute does not defer reconciliation for non-connection errors', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
      }),
    });

    const startContainer = vi
      .fn()
      .mockRejectedValueOnce(new Error('container not found'))
      .mockRejectedValueOnce(new Error('restart also failed'));

    context.currentContainer.rename
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rename failed'));

    const scheduleDeferredReconciliation = vi.fn();
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      stopContainer: vi.fn().mockResolvedValue(undefined),
      startContainer,
      scheduleDeferredReconciliation,
    });

    await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow(
      'container not found',
    );

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'failed',
        phase: 'rollback-failed',
      }),
    );
    expect(scheduleDeferredReconciliation).not.toHaveBeenCalled();
  });

  test('execute does not defer reconciliation when callback is not provided', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
      }),
    });

    const connectionError = new Error('connect ECONNREFUSED 127.0.0.1:2375');

    const startContainer = vi
      .fn()
      .mockRejectedValueOnce(connectionError)
      .mockRejectedValueOnce(connectionError);

    context.currentContainer.rename
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(connectionError);

    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      stopContainer: vi.fn().mockResolvedValue(undefined),
      startContainer,
    });

    await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow(
      'ECONNREFUSED',
    );

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'failed',
        phase: 'rollback-failed',
      }),
    );
  });

  test('execute aborts cleanly when cancellation is detected after pull but before rename', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: false },
        HostConfig: { AutoRemove: false },
      }),
    });
    mockIsOperationCancelRequested.mockReturnValue(true);
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });
    const log = createLog();

    await expect(executor.execute(context, createContainer(), log)).resolves.toBe(false);

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'failed',
        phase: 'failed',
        lastError: 'Cancelled by operator',
      }),
    );
    expect(context.currentContainer.rename).not.toHaveBeenCalled();
    expect(executor.createContainer).not.toHaveBeenCalled();
    expect(executor.stopContainer).not.toHaveBeenCalled();
  });

  test('execute rolls back with rollbackReason cancelled when cancel detected after rename (before createContainer)', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
        HostConfig: { AutoRemove: false },
      }),
    });
    // First call (before rename checkpoint) returns false, second call (inside createAndStartReplacementContainer) returns true
    mockIsOperationCancelRequested
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow(
      'Cancelled by operator',
    );

    // Rename forward happened (preparing for update)
    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: expect.stringMatching(/^web-old-/) }),
    );
    // Rename back happened (rollback)
    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'web' });

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'rolled-back',
        rollbackReason: 'cancelled',
      }),
    );
  });

  test('execute rolls back with rollbackReason cancelled when cancel detected before runReplacementContainerTransition', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
        HostConfig: { AutoRemove: false },
      }),
    });
    // First call (pre-rename): false; second call (createAndStartReplacementContainer entry): false; third call (runReplacementContainerTransition entry): true
    mockIsOperationCancelRequested
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow(
      'Cancelled by operator',
    );

    expect(executor.createContainer).toHaveBeenCalled();
    // Rename back happened (rollback)
    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'web' });

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'rolled-back',
        rollbackReason: 'cancelled',
      }),
    );
  });

  test('execute rolls back when cancellation arrives after create checkpoint but before transition checkpoint', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
        HostConfig: { AutoRemove: false },
      }),
    });
    let cancelRequested = false;
    mockIsOperationCancelRequested.mockImplementation(() => cancelRequested);

    const executor = createExecutor({
      createContainer: vi.fn().mockImplementation(async () => {
        cancelRequested = true;
        return context.newContainer;
      }),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow(
      'Cancelled by operator',
    );

    expect(mockIsOperationCancelRequested).toHaveBeenCalledTimes(3);
    expect(executor.createContainer).toHaveBeenCalled();
    expect(executor.stopContainer).not.toHaveBeenCalled();
    expect(executor.startContainer).not.toHaveBeenCalled();
    expect(context.newContainer.stop).toHaveBeenCalledTimes(1);
    expect(context.newContainer.remove).toHaveBeenCalledTimes(1);
    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'web' });
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'rolled-back',
        rollbackReason: 'cancelled',
      }),
    );
  });

  test('execute treats repeated cancellation signals during rollback idempotently', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({
        State: { Running: true },
        HostConfig: { AutoRemove: false },
      }),
    });
    // False before rename and at the create checkpoint; repeated true values model
    // duplicate cancel requests arriving before/at the transition checkpoint.
    mockIsOperationCancelRequested
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      hasHealthcheckConfigured: vi.fn(() => false),
    });

    await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow(
      'Cancelled by operator',
    );

    const terminalCalls = mockMarkOperationTerminal.mock.calls.filter(
      ([operationId]) => operationId === 'op-1',
    );
    expect(terminalCalls).toHaveLength(1);
    expect(terminalCalls[0][1]).toEqual(
      expect.objectContaining({
        status: 'rolled-back',
        phase: 'rolled-back',
        rollbackReason: 'cancelled',
      }),
    );
    expect(context.newContainer.stop).toHaveBeenCalledTimes(1);
    expect(context.newContainer.remove).toHaveBeenCalledTimes(1);
    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'web' });
    expect(executor.stopContainer).not.toHaveBeenCalled();
    expect(executor.startContainer).not.toHaveBeenCalled();
  });

  test('execute calls postPullHook after pull and before rename', async () => {
    const callOrder: string[] = [];
    const context = createContext();
    context.currentContainer.rename = vi.fn().mockImplementation(async () => {
      callOrder.push('rename');
    });
    const executor = createExecutor({
      pullImage: vi.fn().mockImplementation(async () => {
        callOrder.push('pull');
      }),
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
    });
    const postPullHook = vi.fn().mockImplementation(async () => {
      callOrder.push('postPullHook');
    });

    await executor.execute(context, createContainer(), createLog(), undefined, postPullHook);

    expect(callOrder.indexOf('pull')).toBeLessThan(callOrder.indexOf('postPullHook'));
    expect(callOrder.indexOf('postPullHook')).toBeLessThan(callOrder.indexOf('rename'));
  });

  test('execute terminates operation as failed when postPullHook throws', async () => {
    const context = createContext();
    const executor = createExecutor({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
    });
    const hookError = new Error('scan blocked: CVE-2025-0001');
    const postPullHook = vi.fn().mockRejectedValue(hookError);

    await expect(
      executor.execute(context, createContainer(), createLog(), undefined, postPullHook),
    ).rejects.toThrow('scan blocked: CVE-2025-0001');

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'failed',
        phase: 'failed',
        lastError: 'scan blocked: CVE-2025-0001',
      }),
    );
  });

  describe('persistRollbackState integration', () => {
    test('calls persistRollbackState with succeeded when update completes successfully', async () => {
      const persistRollbackState = vi.fn();
      const context = createContext();
      const executor = createExecutor({
        createContainer: vi.fn().mockResolvedValue(context.newContainer),
        persistRollbackState,
      });

      await executor.execute(context, createContainer(), createLog());

      expect(persistRollbackState).toHaveBeenCalledWith('container-id', 'succeeded');
    });

    test('calls persistRollbackState with rolled-back when rollback succeeds', async () => {
      const persistRollbackState = vi.fn();
      const context = createContext();
      context.currentContainer.rename = vi
        .fn()
        .mockResolvedValueOnce(undefined) // first rename (to temp) succeeds
        .mockResolvedValueOnce(undefined); // rollback rename succeeds
      const executor = createExecutor({
        createContainer: vi.fn().mockRejectedValue(new Error('start failed')),
        persistRollbackState,
      });

      await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow(
        'start failed',
      );

      expect(persistRollbackState).toHaveBeenCalledWith(
        'container-id',
        'rolled-back',
        expect.objectContaining({
          reason: expect.any(String),
          lastError: 'start failed',
        }),
      );
    });

    test('does NOT call persistRollbackState with rolled-back when rollback fails (status: failed)', async () => {
      const persistRollbackState = vi.fn();
      const context = createContext();
      context.currentContainer.rename = vi
        .fn()
        .mockResolvedValueOnce(undefined) // first rename (to temp) succeeds
        .mockRejectedValueOnce(new Error('rename back failed')); // rollback rename fails
      const executor = createExecutor({
        createContainer: vi.fn().mockRejectedValue(new Error('start failed')),
        persistRollbackState,
      });

      await expect(executor.execute(context, createContainer(), createLog())).rejects.toThrow();

      // persistRollbackState should NOT have been called with 'rolled-back' — the rollback itself failed
      expect(persistRollbackState).not.toHaveBeenCalledWith(
        expect.anything(),
        'rolled-back',
        expect.anything(),
      );
    });

    test('persistRollbackState is optional — execute works without it', async () => {
      const context = createContext();
      // No persistRollbackState provided
      const executor = createExecutor({
        createContainer: vi.fn().mockResolvedValue(context.newContainer),
      });

      await expect(executor.execute(context, createContainer(), createLog())).resolves.toBe(true);
    });

    test('health-gate heartbeat starts when health-gating and is cancelled after success', async () => {
      const context = createContext({
        currentContainerSpec: createCurrentContainerSpec({
          State: { Running: true },
          HostConfig: { AutoRemove: false },
        }),
      });
      const executor = createExecutor({
        createContainer: vi.fn().mockResolvedValue(context.newContainer),
        getRollbackConfig: vi.fn(() => ({ autoRollback: false })),
        hasHealthcheckConfigured: vi.fn(() => true),
      });
      const log = createLog();

      await expect(executor.execute(context, createContainer(), log)).resolves.toBe(true);

      expect(mockStartHealthGateHeartbeat).toHaveBeenCalledWith('op-1', expect.any(Function));
      expect(mockCancelHeartbeat).toHaveBeenCalled();
      // health-gate-passed must still fire after the heartbeat is cancelled
      expect(mockUpdateOperation).toHaveBeenCalledWith(
        'op-1',
        expect.objectContaining({ phase: 'health-gate-passed' }),
      );
    });

    test('health-gate heartbeat is cancelled when health-gate fails (rollback path)', async () => {
      const context = createContext({
        currentContainerSpec: createCurrentContainerSpec({
          State: { Running: true },
          HostConfig: { AutoRemove: false },
        }),
      });
      const executor = createExecutor({
        createContainer: vi.fn().mockResolvedValue(context.newContainer),
        getRollbackConfig: vi.fn(() => ({ autoRollback: false })),
        hasHealthcheckConfigured: vi.fn(() => true),
        waitForContainerHealthy: vi
          .fn()
          .mockRejectedValue(new Error('Health gate failed: unhealthy')),
      });
      const log = createLog();

      await expect(executor.execute(context, createContainer(), log)).rejects.toThrow(
        'Health gate failed: unhealthy',
      );

      expect(mockStartHealthGateHeartbeat).toHaveBeenCalledWith('op-1', expect.any(Function));
      // Cancel must be called even when the wait rejects
      expect(mockCancelHeartbeat).toHaveBeenCalled();
      // health-gate-passed must NOT fire
      expect(mockUpdateOperation).not.toHaveBeenCalledWith(
        'op-1',
        expect.objectContaining({ phase: 'health-gate-passed' }),
      );
    });

    test('heartbeat emitter calls updateOperation with phase: health-gate', async () => {
      const context = createContext({
        currentContainerSpec: createCurrentContainerSpec({
          State: { Running: true },
          HostConfig: { AutoRemove: false },
        }),
      });

      // Capture the emitter function passed to startHealthGateHeartbeat
      let capturedEmitter: ((operationId: string) => void) | undefined;
      mockStartHealthGateHeartbeat.mockImplementation(
        (operationId: string, emitter: (operationId: string) => void) => {
          capturedEmitter = emitter;
          return mockCancelHeartbeat;
        },
      );

      const executor = createExecutor({
        createContainer: vi.fn().mockResolvedValue(context.newContainer),
        getRollbackConfig: vi.fn(() => ({ autoRollback: false })),
        hasHealthcheckConfigured: vi.fn(() => true),
      });

      await expect(executor.execute(context, createContainer(), createLog())).resolves.toBe(true);

      expect(capturedEmitter).toBeDefined();
      // Simulate a heartbeat tick
      capturedEmitter!('op-1');
      expect(mockUpdateOperation).toHaveBeenCalledWith('op-1', { phase: 'health-gate' });
    });

    test('heartbeat does not start when health-gate is skipped (no healthcheck)', async () => {
      const context = createContext({
        currentContainerSpec: createCurrentContainerSpec({
          State: { Running: true },
          HostConfig: { AutoRemove: false },
        }),
      });
      const executor = createExecutor({
        createContainer: vi.fn().mockResolvedValue(context.newContainer),
        getRollbackConfig: vi.fn(() => ({ autoRollback: false })),
        hasHealthcheckConfigured: vi.fn(() => false),
      });

      await expect(executor.execute(context, createContainer(), createLog())).resolves.toBe(true);

      expect(mockStartHealthGateHeartbeat).not.toHaveBeenCalled();
    });

    test('reconcileWithTempContainerOnly calls persistRollbackState with rolled-back on successful recovery', async () => {
      const persistRollbackState = vi.fn();
      const container = createContainer();
      const pendingOperation = {
        id: 'pending-op-1',
        status: 'in-progress',
        phase: 'renamed',
        containerName: 'web',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        oldName: 'web',
        tempName: 'web-old-12345',
        oldContainerWasRunning: false,
        oldContainerStopped: false,
        rollbackReason: 'start_new_failed',
        lastError: 'container exited with code 1',
      };

      mockGetInProgressOperationByContainerName.mockReturnValue(pendingOperation);
      mockMarkOperationTerminal.mockReturnValue({ ...pendingOperation, status: 'rolled-back' });

      // temp container found (rename succeeds) — no active container at original name
      const tempContainer = {
        inspect: vi.fn().mockResolvedValue({ State: { Running: false } }),
        rename: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      };

      const dockerApi = {
        getContainer: vi.fn().mockImplementation((name: string) => {
          if (name === 'web-old-12345') {
            return tempContainer;
          }
          // original name 'web' — not found (throws)
          return {
            inspect: vi.fn().mockRejectedValue(new Error('not found')),
            rename: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            remove: vi.fn(),
          };
        }),
      };

      // isContainerNotFoundError returns true for the 'not found' error (original name lookup)
      const executor = createExecutor({
        persistRollbackState,
        isContainerNotFoundError: vi.fn(() => true),
      });

      await executor.reconcileInProgressContainerUpdateOperation(dockerApi, container, createLog());

      expect(persistRollbackState).toHaveBeenCalledWith(
        'container-id',
        'rolled-back',
        expect.objectContaining({
          reason: 'start_new_failed',
          lastError: 'container exited with code 1',
        }),
      );
    });
  });
});
