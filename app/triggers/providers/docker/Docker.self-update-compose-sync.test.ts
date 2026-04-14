import * as registryStore from '../../../registry';
import {
  configurationValid,
  createMockLog,
  createTriggerContainer,
  docker,
  getDockerTestMocks,
  registerCommonDockerBeforeEach,
  stubTriggerFlow,
} from './Docker.test.helpers.js';

registerCommonDockerBeforeEach();
const { mockGetRollbackCounter, mockSyncComposeFileTag } = getDockerTestMocks();

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
      registry: { getImageFullName: vi.fn((_img, tag) => `codeswhat/drydock:${tag}`) },
      auth: undefined,
      newImage: 'ghcr.io/codeswhat/drydock:2.0.0',
      currentContainer,
      currentContainerSpec,
      _mockHelperContainer: mockHelperContainer,
      _mockNewContainer: mockNewContainer,
      ...overrides,
    };
  }

  test('should rename old container, create new, and spawn controller helper', async () => {
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
      (call) => call[0]?.Cmd?.[0] === 'node',
    );
    expect(helperCall).toBeDefined();
    expect(helperCall[0].Cmd).toEqual([
      'node',
      'dist/triggers/providers/docker/self-update-controller-entrypoint.js',
    ]);
    expect(helperCall[0].Env).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^DD_SELF_UPDATE_OP_ID=/),
        'DD_SELF_UPDATE_OLD_CONTAINER_ID=old-container-id',
        'DD_SELF_UPDATE_NEW_CONTAINER_ID=new-container-id',
        'DD_SELF_UPDATE_OLD_CONTAINER_NAME=drydock',
      ]),
    );
    expect(helperCall[0].Labels).toMatchObject({
      'dd.self-update.helper': 'true',
    });
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

describe('extracted lifecycle delegation', () => {
  test('executeSelfUpdate should delegate to selfUpdateOrchestrator', async () => {
    const originalSelfUpdateOrchestrator = docker.selfUpdateOrchestrator;
    const execute = vi.fn().mockResolvedValue('delegated-self-update');
    docker.selfUpdateOrchestrator = { execute };
    const context = { any: 'context' };
    const container = createTriggerContainer();
    const logContainer = createMockLog('info', 'warn', 'debug');

    try {
      const result = await docker.executeSelfUpdate(context, container, logContainer, 'op-123');

      expect(execute).toHaveBeenCalledWith(context, container, logContainer, 'op-123');
      expect(result).toBe('delegated-self-update');
    } finally {
      docker.selfUpdateOrchestrator = originalSelfUpdateOrchestrator;
    }
  });

  test('maybeNotifySelfUpdate should delegate to selfUpdateOrchestrator', async () => {
    const originalSelfUpdateOrchestrator = docker.selfUpdateOrchestrator;
    const maybeNotify = vi.fn().mockResolvedValue(undefined);
    docker.selfUpdateOrchestrator = { maybeNotify };
    const container = createTriggerContainer();
    const logContainer = createMockLog('info', 'warn', 'debug');

    try {
      await docker.maybeNotifySelfUpdate(container, logContainer, 'op-123');
      expect(maybeNotify).toHaveBeenCalledWith(container, logContainer, 'op-123');
    } finally {
      docker.selfUpdateOrchestrator = originalSelfUpdateOrchestrator;
    }
  });

  test('executeContainerUpdate should delegate to containerUpdateExecutor', async () => {
    const originalContainerUpdateExecutor = docker.containerUpdateExecutor;
    const execute = vi.fn().mockResolvedValue('delegated-container-update');
    docker.containerUpdateExecutor = { execute };
    const context = { any: 'context' };
    const container = createTriggerContainer();
    const logContainer = createMockLog('info', 'warn', 'debug');

    try {
      const result = await docker.executeContainerUpdate(context, container, logContainer);

      expect(execute).toHaveBeenCalledWith(context, container, logContainer);
      expect(result).toBe('delegated-container-update');
    } finally {
      docker.containerUpdateExecutor = originalContainerUpdateExecutor;
    }
  });

  test('runContainerUpdateLifecycle should delegate to updateLifecycleExecutor', async () => {
    const originalUpdateLifecycleExecutor = docker.updateLifecycleExecutor;
    const run = vi.fn().mockResolvedValue(undefined);
    docker.updateLifecycleExecutor = { run };
    const container = createTriggerContainer();
    const runtimeContext = { composeFile: '/tmp/docker-compose.yml' };

    try {
      await docker.runContainerUpdateLifecycle(container, runtimeContext);

      expect(run).toHaveBeenCalledWith(container, runtimeContext);
    } finally {
      docker.updateLifecycleExecutor = originalUpdateLifecycleExecutor;
    }
  });

  test('getRollbackConfig should delegate to rollbackMonitor', () => {
    const originalRollbackMonitor = docker.rollbackMonitor;
    const getConfig = vi.fn().mockReturnValue({
      autoRollback: true,
      rollbackWindow: 45_000,
      rollbackInterval: 2_000,
    });
    docker.rollbackMonitor = { getConfig };
    const container = createTriggerContainer();

    try {
      const result = docker.getRollbackConfig(container);

      expect(getConfig).toHaveBeenCalledWith(container);
      expect(result).toEqual({
        autoRollback: true,
        rollbackWindow: 45_000,
        rollbackInterval: 2_000,
      });
    } finally {
      docker.rollbackMonitor = originalRollbackMonitor;
    }
  });

  test('maybeStartAutoRollbackMonitor should delegate to rollbackMonitor', async () => {
    const originalRollbackMonitor = docker.rollbackMonitor;
    const start = vi.fn().mockResolvedValue(undefined);
    docker.rollbackMonitor = { start };
    const dockerApi = { any: 'docker' };
    const container = createTriggerContainer();
    const rollbackConfig = {
      autoRollback: true,
      rollbackWindow: 60_000,
      rollbackInterval: 5_000,
    };
    const logContainer = createMockLog('info', 'warn', 'debug');

    try {
      await docker.maybeStartAutoRollbackMonitor(
        dockerApi,
        container,
        rollbackConfig,
        logContainer,
      );

      expect(start).toHaveBeenCalledWith(dockerApi, container, rollbackConfig, logContainer);
    } finally {
      docker.rollbackMonitor = originalRollbackMonitor;
    }
  });
});

describe('additional direct wrapper coverage', () => {
  test('isContainerNotFoundError should handle empty, status, and message-based inputs', () => {
    expect(docker.isContainerNotFoundError(undefined)).toBe(false);
    expect(docker.isContainerNotFoundError('no such container as primitive')).toBe(false);
    expect(docker.isContainerNotFoundError({ statusCode: 404 })).toBe(true);
    expect(docker.isContainerNotFoundError({ status: 404 })).toBe(true);
    expect(docker.isContainerNotFoundError({ message: 'No such container: abc' })).toBe(true);
    expect(docker.isContainerNotFoundError({ reason: 'No such container: def' })).toBe(true);
    expect(docker.isContainerNotFoundError({ json: { message: 'No such container: ghi' } })).toBe(
      true,
    );
    expect(docker.isContainerNotFoundError({ json: { message: 404 } })).toBe(false);
    expect(docker.isContainerNotFoundError({ message: 'something else' })).toBe(false);
  });

  test('registry resolver wrapper methods should delegate to registryResolver', () => {
    const originalResolver = docker.registryResolver as any;
    const getStateSpy = vi.spyOn(registryStore, 'getState').mockReturnValue({} as any);
    docker.registryResolver = {
      normalizeRegistryHost: vi.fn().mockReturnValue('normalized-host'),
      buildRegistryLookupCandidates: vi.fn().mockReturnValue(['a', 'b']),
      isRegistryManagerCompatible: vi.fn().mockReturnValue(true),
      createAnonymousRegistryManager: vi.fn().mockReturnValue({ name: 'anon' }),
      resolveRegistryManager: vi.fn().mockReturnValue({ name: 'resolved' }),
    } as any;

    try {
      expect(docker.normalizeRegistryHost('docker.io')).toBe('normalized-host');
      expect(docker.buildRegistryLookupCandidates({ name: 'nginx' } as any)).toEqual(['a', 'b']);
      expect(docker.isRegistryManagerCompatible({} as any, { withDigest: true })).toBe(true);
      expect(docker.createAnonymousRegistryManager({} as any, {} as any)).toEqual({ name: 'anon' });
      expect(
        docker.resolveRegistryManager({ image: { registry: { name: 'hub' } } } as any, {} as any),
      ).toEqual({ name: 'resolved' });
    } finally {
      getStateSpy.mockRestore();
      docker.registryResolver = originalResolver;
    }
  });

  test('recordRollbackTelemetry should normalize reasons and map info outcome', () => {
    const rollbackCounterInc = vi.fn();
    mockGetRollbackCounter.mockReturnValue({ inc: rollbackCounterInc });
    const recordRollbackAuditSpy = vi
      .spyOn(docker, 'recordRollbackAudit')
      .mockImplementation(() => {
        return undefined as any;
      });
    const container = { name: 'web', image: { name: 'nginx' } } as any;

    docker.recordRollbackTelemetry({
      container,
      outcome: 'info',
      reason: '',
      details: 'missing reason',
    });
    docker.recordRollbackTelemetry({
      container,
      outcome: 'info',
      reason: '!!!',
      details: 'sanitized reason',
    });
    docker.recordRollbackTelemetry({
      container,
      outcome: 'success',
      reason: 'manual',
      details: 'success reason',
    });
    docker.recordRollbackTelemetry({
      container,
      outcome: 'error',
      reason: 'manual',
      details: 'error reason',
    });

    expect(rollbackCounterInc).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        outcome: 'info',
        reason: 'unspecified',
      }),
    );
    expect(rollbackCounterInc).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        outcome: 'info',
        reason: 'unspecified',
      }),
    );
    expect(recordRollbackAuditSpy).toHaveBeenNthCalledWith(
      1,
      container,
      'info',
      'missing reason',
      undefined,
      undefined,
    );
    expect(recordRollbackAuditSpy).toHaveBeenNthCalledWith(
      2,
      container,
      'info',
      'sanitized reason',
      undefined,
      undefined,
    );
    expect(recordRollbackAuditSpy).toHaveBeenNthCalledWith(
      3,
      container,
      'success',
      'success reason',
      undefined,
      undefined,
    );
    expect(recordRollbackAuditSpy).toHaveBeenNthCalledWith(
      4,
      container,
      'error',
      'error reason',
      undefined,
      undefined,
    );
    recordRollbackAuditSpy.mockRestore();
  });

  test('stopAndRemoveContainer should stop then remove when running and auto-remove is disabled', async () => {
    const stopSpy = vi.spyOn(docker, 'stopContainer').mockResolvedValue();
    const removeSpy = vi.spyOn(docker, 'removeContainer').mockResolvedValue();
    const waitSpy = vi.spyOn(docker, 'waitContainerRemoved').mockResolvedValue();

    await docker.stopAndRemoveContainer(
      {} as any,
      { State: { Running: true }, HostConfig: { AutoRemove: false } } as any,
      { name: 'c1', id: 'id-1' } as any,
      createMockLog('info', 'warn', 'debug'),
    );

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(waitSpy).not.toHaveBeenCalled();
  });

  test('stopAndRemoveContainer should wait for auto-removal when AutoRemove is enabled', async () => {
    const stopSpy = vi.spyOn(docker, 'stopContainer').mockResolvedValue();
    const removeSpy = vi.spyOn(docker, 'removeContainer').mockResolvedValue();
    const waitSpy = vi.spyOn(docker, 'waitContainerRemoved').mockResolvedValue();

    await docker.stopAndRemoveContainer(
      {} as any,
      { State: { Running: false }, HostConfig: { AutoRemove: true } } as any,
      { name: 'c1', id: 'id-1' } as any,
      createMockLog('info', 'warn', 'debug'),
    );

    expect(stopSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(waitSpy).toHaveBeenCalledTimes(1);
  });

  test('recreateContainer should create and start new container when previous one was running', async () => {
    const cloneSpy = vi.spyOn(docker, 'cloneContainer').mockReturnValue({} as any);
    const createSpy = vi.spyOn(docker, 'createContainer').mockResolvedValue({} as any);
    const startSpy = vi.spyOn(docker, 'startContainer').mockResolvedValue();

    await docker.recreateContainer(
      {} as any,
      { State: { Running: true } } as any,
      'repo/image:new',
      { name: 'c1' } as any,
      createMockLog('info', 'warn', 'debug'),
    );

    expect(cloneSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  test('recreateContainer should skip start when previous container was stopped', async () => {
    vi.spyOn(docker, 'cloneContainer').mockReturnValue({} as any);
    vi.spyOn(docker, 'createContainer').mockResolvedValue({} as any);
    const startSpy = vi.spyOn(docker, 'startContainer').mockResolvedValue();

    await docker.recreateContainer(
      {} as any,
      { State: { Running: false } } as any,
      'repo/image:new',
      { name: 'c1' } as any,
      createMockLog('info', 'warn', 'debug'),
    );

    expect(startSpy).not.toHaveBeenCalled();
  });

  test('waitForContainerHealthy should wait when health state is initially unavailable', async () => {
    vi.useFakeTimers();
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(0).mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    const containerToCheck = {
      inspect: vi
        .fn()
        .mockResolvedValueOnce({ State: {} })
        .mockResolvedValueOnce({ State: { Health: { Status: 'healthy' } } }),
    };
    const logContainer = createMockLog('info', 'warn', 'debug');

    const waitPromise = docker.waitForContainerHealthy(
      containerToCheck as any,
      'web',
      logContainer,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await waitPromise;

    expect(logContainer.debug).toHaveBeenCalledWith(
      'Container web health state not yet available — waiting for health gate',
    );
    expect(logContainer.info).toHaveBeenCalledWith('Container web passed health gate');
    dateNowSpy.mockRestore();
    vi.useRealTimers();
  });

  test('waitForContainerHealthy should fail when health status is unhealthy', async () => {
    const containerToCheck = {
      inspect: vi.fn().mockResolvedValue({ State: { Health: { Status: 'unhealthy' } } }),
    };

    await expect(
      docker.waitForContainerHealthy(
        containerToCheck as any,
        'web',
        createMockLog('info', 'warn', 'debug'),
      ),
    ).rejects.toThrow('Health gate failed: container web reported unhealthy');
  });

  test('waitForContainerHealthy should time out when status never becomes healthy', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(0).mockReturnValueOnce(301_000);
    const containerToCheck = {
      inspect: vi.fn(),
    };

    await expect(
      docker.waitForContainerHealthy(
        containerToCheck as any,
        'web',
        createMockLog('info', 'warn', 'debug'),
      ),
    ).rejects.toThrow('Health gate timed out');

    dateNowSpy.mockRestore();
  });

  test('waitForContainerHealthy should poll when health status is neither healthy nor unhealthy', async () => {
    vi.useFakeTimers();
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(301_000);
    const containerToCheck = {
      inspect: vi.fn().mockResolvedValue({ State: { Health: { Status: 'starting' } } }),
    };

    try {
      const waitPromise = docker.waitForContainerHealthy(
        containerToCheck as any,
        'web',
        createMockLog('info', 'warn', 'debug'),
      );
      waitPromise.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(waitPromise).rejects.toThrow('Health gate timed out');
    } finally {
      dateNowSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  test('hook wrapper methods should delegate to hookExecutor', async () => {
    const originalHookExecutor = docker.hookExecutor as any;
    const runPreUpdateHook = vi.fn().mockResolvedValue(undefined);
    const runPostUpdateHook = vi.fn().mockResolvedValue(undefined);
    const isHookFailure = vi.fn().mockReturnValue(true);
    const getHookFailureDetails = vi.fn().mockReturnValue('failed details');
    docker.hookExecutor = {
      runPreUpdateHook,
      runPostUpdateHook,
      isHookFailure,
      getHookFailureDetails,
    } as any;

    try {
      expect(docker.isHookFailure({ code: 1 })).toBe(true);
      expect(docker.getHookFailureDetails('pre', { code: 1 }, 1000)).toBe('failed details');
      await docker.runPreUpdateHook({} as any, {} as any, {} as any);
      await docker.runPostUpdateHook({} as any, {} as any, {} as any);
      expect(runPreUpdateHook).toHaveBeenCalledTimes(1);
      expect(runPostUpdateHook).toHaveBeenCalledTimes(1);
    } finally {
      docker.hookExecutor = originalHookExecutor;
    }
  });

  test('reconcileInProgressContainerUpdateOperation should delegate to containerUpdateExecutor', async () => {
    const originalExecutor = docker.containerUpdateExecutor as any;
    const reconcile = vi.fn().mockResolvedValue('reconciled');
    docker.containerUpdateExecutor = {
      reconcileInProgressContainerUpdateOperation: reconcile,
    } as any;

    try {
      const result = await docker.reconcileInProgressContainerUpdateOperation(
        {} as any,
        {} as any,
        {} as any,
      );

      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(result).toBe('reconciled');
    } finally {
      docker.containerUpdateExecutor = originalExecutor;
    }
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

// --- compose file sync ---

describe('performContainerUpdate compose file sync', () => {
  beforeEach(() => {
    mockSyncComposeFileTag.mockClear();
  });

  test('should call syncComposeFileTag after successful tag update', async () => {
    const executeUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate').mockResolvedValue(true);

    const context = {
      currentContainerSpec: {
        Config: {
          Labels: {
            'com.docker.compose.project.config_files': '/app/docker-compose.yml',
            'com.docker.compose.service': 'web',
          },
        },
      },
      newImage: 'myapp:v2',
    };

    const container = {
      updateKind: { kind: 'tag', localValue: 'v1', remoteValue: 'v2' },
    };

    const logContainer = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

    await docker.performContainerUpdate(context, container, logContainer);

    expect(mockSyncComposeFileTag).toHaveBeenCalledWith({
      labels: context.currentContainerSpec.Config.Labels,
      newImage: 'myapp:v2',
      logContainer,
    });

    executeUpdateSpy.mockRestore();
  });

  test('should pass dockerApi to compose sync when available', async () => {
    const executeUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate').mockResolvedValue(true);

    const dockerApi = { getContainer: vi.fn() };
    const context = {
      currentContainerSpec: {
        Config: {
          Labels: {
            'com.docker.compose.project.config_files': '/app/docker-compose.yml',
            'com.docker.compose.service': 'web',
          },
        },
      },
      dockerApi,
      newImage: 'myapp:v2',
    };

    const container = {
      updateKind: { kind: 'tag', localValue: 'v1', remoteValue: 'v2' },
    };

    const logContainer = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

    await docker.performContainerUpdate(context, container, logContainer);

    expect(mockSyncComposeFileTag).toHaveBeenCalledWith({
      labels: context.currentContainerSpec.Config.Labels,
      newImage: 'myapp:v2',
      logContainer,
      dockerApi,
    });

    executeUpdateSpy.mockRestore();
  });

  test('should not call syncComposeFileTag for digest updates', async () => {
    const executeUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate').mockResolvedValue(true);

    const context = {
      currentContainerSpec: {
        Config: {
          Labels: {
            'com.docker.compose.project.config_files': '/app/docker-compose.yml',
            'com.docker.compose.service': 'web',
          },
        },
      },
      newImage: 'myapp:latest',
    };

    const container = {
      updateKind: { kind: 'digest' },
    };

    const logContainer = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

    await docker.performContainerUpdate(context, container, logContainer);

    expect(mockSyncComposeFileTag).not.toHaveBeenCalled();

    executeUpdateSpy.mockRestore();
  });

  test('should not call syncComposeFileTag when update fails', async () => {
    const executeUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate').mockResolvedValue(false);

    const context = {
      currentContainerSpec: {
        Config: {
          Labels: {
            'com.docker.compose.project.config_files': '/app/docker-compose.yml',
            'com.docker.compose.service': 'web',
          },
        },
      },
      newImage: 'myapp:v2',
    };

    const container = {
      updateKind: { kind: 'tag', localValue: 'v1', remoteValue: 'v2' },
    };

    const logContainer = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const result = await docker.performContainerUpdate(context, container, logContainer);

    expect(result).toBe(false);
    expect(mockSyncComposeFileTag).not.toHaveBeenCalled();

    executeUpdateSpy.mockRestore();
  });

  test('should not call syncComposeFileTag when updateKind is missing', async () => {
    const executeUpdateSpy = vi.spyOn(docker, 'executeContainerUpdate').mockResolvedValue(true);

    const context = {
      currentContainerSpec: {
        Config: {
          Labels: {
            'com.docker.compose.project.config_files': '/app/docker-compose.yml',
            'com.docker.compose.service': 'web',
          },
        },
      },
      newImage: 'myapp:v2',
    };

    const container = {};

    const logContainer = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const result = await docker.performContainerUpdate(context, container, logContainer);

    expect(result).toBe(true);
    expect(mockSyncComposeFileTag).not.toHaveBeenCalled();

    executeUpdateSpy.mockRestore();
  });
});
