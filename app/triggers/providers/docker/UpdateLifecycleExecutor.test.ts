import { describe, expect, test, vi } from 'vitest';

import UpdateLifecycleExecutor from './UpdateLifecycleExecutor.js';

function createContainer(overrides = {}) {
  return {
    id: 'container-id',
    name: 'web',
    image: {
      name: 'ghcr.io/acme/web',
      tag: { value: '1.0.0' },
    },
    ...overrides,
  };
}

function createContext(overrides = {}) {
  return {
    dockerApi: { api: true },
    registry: { id: 'reg' },
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const rootLogger = {
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
  };
  const deps = {
    getContainerFullName: vi.fn((container) => `docker.local_${container.name}`),
    createTriggerContext: vi.fn().mockResolvedValue(createContext()),
    maybeScanAndGateUpdate: vi.fn().mockResolvedValue(undefined),
    buildHookConfig: vi.fn(() => ({ hookPre: 'pre', hookPost: 'post' })),
    recordHookConfigurationAudit: vi.fn(),
    runPreUpdateHook: vi.fn().mockResolvedValue(undefined),
    isSelfUpdate: vi.fn(() => false),
    maybeNotifySelfUpdate: vi.fn().mockResolvedValue(undefined),
    executeSelfUpdate: vi.fn().mockResolvedValue(true),
    runPreRuntimeUpdateLifecycle: vi.fn().mockResolvedValue(undefined),
    performContainerUpdate: vi.fn().mockResolvedValue(true),
    runPostUpdateHook: vi.fn().mockResolvedValue(undefined),
    cleanupOldImages: vi.fn().mockResolvedValue(undefined),
    getRollbackConfig: vi.fn(() => ({ autoRollback: true })),
    maybeStartAutoRollbackMonitor: vi.fn().mockResolvedValue(undefined),
    emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
    emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
    pruneOldBackups: vi.fn(),
    getBackupCount: vi.fn(() => 3),
    ...overrides,
  };

  const executor = new UpdateLifecycleExecutor({
    logger: {
      getLogger: () => rootLogger,
    },
    context: {
      getContainerFullName: deps.getContainerFullName,
      createTriggerContext: deps.createTriggerContext,
    },
    security: {
      maybeScanAndGateUpdate: deps.maybeScanAndGateUpdate,
    },
    hooks: {
      buildHookConfig: deps.buildHookConfig,
      recordHookConfigurationAudit: deps.recordHookConfigurationAudit,
      runPreUpdateHook: deps.runPreUpdateHook,
      runPostUpdateHook: deps.runPostUpdateHook,
    },
    selfUpdate: {
      isSelfUpdate: deps.isSelfUpdate,
      maybeNotifySelfUpdate: deps.maybeNotifySelfUpdate,
      executeSelfUpdate: deps.executeSelfUpdate,
    },
    runtimeUpdate: {
      runPreRuntimeUpdateLifecycle: deps.runPreRuntimeUpdateLifecycle,
      performContainerUpdate: deps.performContainerUpdate,
    },
    postUpdate: {
      cleanupOldImages: deps.cleanupOldImages,
      getRollbackConfig: deps.getRollbackConfig,
      maybeStartAutoRollbackMonitor: deps.maybeStartAutoRollbackMonitor,
      pruneOldBackups: deps.pruneOldBackups,
      getBackupCount: deps.getBackupCount,
    },
    telemetry: {
      emitContainerUpdateApplied: deps.emitContainerUpdateApplied,
      emitContainerUpdateFailed: deps.emitContainerUpdateFailed,
    },
  });

  return {
    executor,
    rootLogger,
    ...deps,
  };
}

describe('UpdateLifecycleExecutor', () => {
  test('constructor accepts grouped service facades', async () => {
    const emitContainerUpdateApplied = vi.fn().mockResolvedValue(undefined);
    const executor = new UpdateLifecycleExecutor({
      logger: {
        getLogger: () => ({
          child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
        }),
      },
      context: {
        getContainerFullName: vi.fn(() => 'name'),
        createTriggerContext: vi.fn().mockResolvedValue(createContext()),
      },
      security: {
        maybeScanAndGateUpdate: vi.fn().mockResolvedValue(undefined),
      },
      hooks: {
        buildHookConfig: vi.fn(() => ({})),
        recordHookConfigurationAudit: vi.fn(),
        runPreUpdateHook: vi.fn().mockResolvedValue(undefined),
        runPostUpdateHook: vi.fn().mockResolvedValue(undefined),
      },
      selfUpdate: {
        isSelfUpdate: vi.fn(() => false),
        maybeNotifySelfUpdate: vi.fn().mockResolvedValue(undefined),
        executeSelfUpdate: vi.fn().mockResolvedValue(true),
      },
      runtimeUpdate: {
        runPreRuntimeUpdateLifecycle: vi.fn().mockResolvedValue(undefined),
        performContainerUpdate: vi.fn().mockResolvedValue(true),
      },
      postUpdate: {
        cleanupOldImages: vi.fn().mockResolvedValue(undefined),
        getRollbackConfig: vi.fn(() => ({})),
        maybeStartAutoRollbackMonitor: vi.fn().mockResolvedValue(undefined),
      },
      telemetry: {
        emitContainerUpdateApplied,
        emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(executor.run(createContainer())).resolves.toBeUndefined();
    expect(emitContainerUpdateApplied).toHaveBeenCalledWith('name');
  });

  test('constructor provides logger fallback when omitted', () => {
    const executor = new UpdateLifecycleExecutor({
      context: {
        getContainerFullName: vi.fn(() => 'name'),
        createTriggerContext: vi.fn().mockResolvedValue(undefined),
      },
      security: {
        maybeScanAndGateUpdate: vi.fn(),
      },
      hooks: {
        buildHookConfig: vi.fn(() => ({})),
        recordHookConfigurationAudit: vi.fn(),
        runPreUpdateHook: vi.fn(),
        runPostUpdateHook: vi.fn(),
      },
      selfUpdate: {
        isSelfUpdate: vi.fn(() => false),
        maybeNotifySelfUpdate: vi.fn(),
        executeSelfUpdate: vi.fn(),
      },
      runtimeUpdate: {
        runPreRuntimeUpdateLifecycle: vi.fn(),
        performContainerUpdate: vi.fn(),
      },
      postUpdate: {
        cleanupOldImages: vi.fn(),
        getRollbackConfig: vi.fn(() => ({})),
        maybeStartAutoRollbackMonitor: vi.fn(),
      },
      telemetry: {
        emitContainerUpdateApplied: vi.fn(),
        emitContainerUpdateFailed: vi.fn(),
      },
    });

    expect(executor.logger.getLogger()).toBeUndefined();
  });

  test('run should tolerate missing logger child factory', async () => {
    const emitContainerUpdateApplied = vi.fn().mockResolvedValue(undefined);
    const executor = new UpdateLifecycleExecutor({
      context: {
        getContainerFullName: vi.fn(() => 'name'),
        createTriggerContext: vi.fn().mockResolvedValue(createContext()),
      },
      security: {
        maybeScanAndGateUpdate: vi.fn().mockResolvedValue(undefined),
      },
      hooks: {
        buildHookConfig: vi.fn(() => ({})),
        recordHookConfigurationAudit: vi.fn(),
        runPreUpdateHook: vi.fn().mockResolvedValue(undefined),
        runPostUpdateHook: vi.fn().mockResolvedValue(undefined),
      },
      selfUpdate: {
        isSelfUpdate: vi.fn(() => false),
        maybeNotifySelfUpdate: vi.fn().mockResolvedValue(undefined),
        executeSelfUpdate: vi.fn().mockResolvedValue(true),
      },
      runtimeUpdate: {
        runPreRuntimeUpdateLifecycle: vi.fn().mockResolvedValue(undefined),
        performContainerUpdate: vi.fn().mockResolvedValue(true),
      },
      postUpdate: {
        cleanupOldImages: vi.fn().mockResolvedValue(undefined),
        getRollbackConfig: vi.fn(() => ({})),
        maybeStartAutoRollbackMonitor: vi.fn().mockResolvedValue(undefined),
      },
      telemetry: {
        emitContainerUpdateApplied,
        emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(executor.run(createContainer())).resolves.toBeUndefined();
    expect(emitContainerUpdateApplied).toHaveBeenCalledWith('name');
  });

  test('constructor provides prune/getBackup defaults when omitted', async () => {
    const emitContainerUpdateApplied = vi.fn().mockResolvedValue(undefined);
    const executor = new UpdateLifecycleExecutor({
      logger: {
        getLogger: () => ({
          child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
        }),
      },
      context: {
        getContainerFullName: vi.fn(() => 'name'),
        createTriggerContext: vi.fn().mockResolvedValue(createContext()),
      },
      security: {
        maybeScanAndGateUpdate: vi.fn().mockResolvedValue(undefined),
      },
      hooks: {
        buildHookConfig: vi.fn(() => ({})),
        recordHookConfigurationAudit: vi.fn(),
        runPreUpdateHook: vi.fn().mockResolvedValue(undefined),
        runPostUpdateHook: vi.fn().mockResolvedValue(undefined),
      },
      selfUpdate: {
        isSelfUpdate: vi.fn(() => false),
        maybeNotifySelfUpdate: vi.fn().mockResolvedValue(undefined),
        executeSelfUpdate: vi.fn().mockResolvedValue(true),
      },
      runtimeUpdate: {
        runPreRuntimeUpdateLifecycle: vi.fn().mockResolvedValue(undefined),
        performContainerUpdate: vi.fn().mockResolvedValue(true),
      },
      postUpdate: {
        cleanupOldImages: vi.fn().mockResolvedValue(undefined),
        getRollbackConfig: vi.fn(() => ({})),
        maybeStartAutoRollbackMonitor: vi.fn().mockResolvedValue(undefined),
      },
      telemetry: {
        emitContainerUpdateApplied,
        emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(executor.run(createContainer())).resolves.toBeUndefined();
    expect(emitContainerUpdateApplied).toHaveBeenCalledWith('name');
  });

  test('constructor should throw when required dependencies are missing', () => {
    expect(() => new UpdateLifecycleExecutor({} as never)).toThrow(
      'UpdateLifecycleExecutor requires dependency "context.getContainerFullName"',
    );
  });

  test('returns early when trigger context is not created', async () => {
    const harness = createHarness({
      createTriggerContext: vi.fn().mockResolvedValue(undefined),
    });

    await harness.executor.run(createContainer(), { runtime: true });

    expect(harness.createTriggerContext).toHaveBeenCalled();
    expect(harness.performContainerUpdate).not.toHaveBeenCalled();
    expect(harness.emitContainerUpdateApplied).not.toHaveBeenCalled();
  });

  test('runs self-update path and stops when self update returns false', async () => {
    const harness = createHarness({
      isSelfUpdate: vi.fn(() => true),
      executeSelfUpdate: vi.fn().mockResolvedValue(false),
    });

    await harness.executor.run(createContainer(), { runtime: true });

    const selfUpdateOperationId = harness.maybeNotifySelfUpdate.mock.calls[0][2];
    expect(harness.maybeNotifySelfUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    );
    expect(selfUpdateOperationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(harness.executeSelfUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      selfUpdateOperationId,
      { runtime: true },
    );
    expect(harness.runPreRuntimeUpdateLifecycle).not.toHaveBeenCalled();
    expect(harness.emitContainerUpdateApplied).not.toHaveBeenCalled();
  });

  test('runs non-self-update path and emits update-applied on success', async () => {
    const container = createContainer();
    const context = createContext();
    const hookConfig = { hookPre: 'pre', hookPost: 'post' };
    const harness = createHarness({
      createTriggerContext: vi.fn().mockResolvedValue(context),
      buildHookConfig: vi.fn(() => hookConfig),
      performContainerUpdate: vi.fn().mockResolvedValue(true),
      getRollbackConfig: vi.fn(() => ({
        autoRollback: true,
        rollbackWindow: 1,
        rollbackInterval: 2,
      })),
      getBackupCount: vi.fn(() => 5),
    });

    await harness.executor.run(container, { runtime: true });

    expect(harness.maybeScanAndGateUpdate).toHaveBeenCalledWith(
      context,
      container,
      expect.anything(),
    );
    expect(harness.recordHookConfigurationAudit).toHaveBeenCalledWith(container, hookConfig);
    expect(harness.runPreUpdateHook).toHaveBeenCalledWith(container, hookConfig, expect.anything());
    expect(harness.runPreRuntimeUpdateLifecycle).toHaveBeenCalledWith(
      context,
      container,
      expect.anything(),
      { runtime: true },
    );
    expect(harness.performContainerUpdate).toHaveBeenCalledWith(
      context,
      container,
      expect.anything(),
      { runtime: true },
    );
    expect(harness.runPostUpdateHook).toHaveBeenCalledWith(
      container,
      hookConfig,
      expect.anything(),
    );
    expect(harness.cleanupOldImages).toHaveBeenCalledWith(
      context.dockerApi,
      context.registry,
      container,
      expect.anything(),
    );
    expect(harness.maybeStartAutoRollbackMonitor).toHaveBeenCalledWith(
      context.dockerApi,
      container,
      { autoRollback: true, rollbackWindow: 1, rollbackInterval: 2 },
      expect.anything(),
    );
    expect(harness.emitContainerUpdateApplied).toHaveBeenCalledWith('docker.local_web');
    expect(harness.pruneOldBackups).toHaveBeenCalledWith('web', 5);
  });

  test('returns early when container update reports no changes', async () => {
    const harness = createHarness({
      performContainerUpdate: vi.fn().mockResolvedValue(false),
    });

    await harness.executor.run(createContainer(), { runtime: true });

    expect(harness.runPostUpdateHook).not.toHaveBeenCalled();
    expect(harness.emitContainerUpdateApplied).not.toHaveBeenCalled();
  });

  test('emits update-failed and rethrows when lifecycle processing throws', async () => {
    const failure = new Error('scan failed hard');
    const harness = createHarness({
      maybeScanAndGateUpdate: vi.fn().mockRejectedValue(failure),
    });

    await expect(harness.executor.run(createContainer(), { runtime: true })).rejects.toThrow(
      'scan failed hard',
    );

    expect(harness.emitContainerUpdateFailed).toHaveBeenCalledWith({
      containerName: 'docker.local_web',
      error: 'scan failed hard',
    });
    expect(harness.pruneOldBackups).toHaveBeenCalledWith('web', 3);
  });

  test('rethrows original lifecycle error when failure-path backup pruning throws', async () => {
    const failure = new Error('scan failed hard');
    const harness = createHarness({
      maybeScanAndGateUpdate: vi.fn().mockRejectedValue(failure),
      pruneOldBackups: vi.fn(() => {
        throw new Error('prune blew up');
      }),
    });

    await expect(harness.executor.run(createContainer(), { runtime: true })).rejects.toThrow(
      'scan failed hard',
    );
    expect(harness.emitContainerUpdateFailed).toHaveBeenCalledWith({
      containerName: 'docker.local_web',
      error: 'scan failed hard',
    });
    expect(harness.pruneOldBackups).toHaveBeenCalledWith('web', 3);
  });

  test('stringifies non-Error failures when emitting update-failed events', async () => {
    const harness = createHarness({
      maybeScanAndGateUpdate: vi.fn().mockRejectedValue(503),
    });

    await expect(harness.executor.run(createContainer(), { runtime: true })).rejects.toBe(503);
    expect(harness.emitContainerUpdateFailed).toHaveBeenCalledWith({
      containerName: 'docker.local_web',
      error: '503',
    });
  });
});
