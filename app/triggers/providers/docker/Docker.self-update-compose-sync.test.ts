import { releaseFinalizedHelperLifecycle } from '../../../api/internal-self-update.js';
import * as registryStore from '../../../registry';
import { releaseRetainedSelfUpdateLifecycle } from '../../../updates/update-locks.js';
import {
  configurationValid,
  createMockLog,
  createTriggerContainer,
  docker,
  getDockerTestMocks,
  registerCommonDockerBeforeEach,
  stubTriggerFlow,
} from './Docker.test.helpers.js';
import { RetainSelfUpdateLifecycleError } from './SelfUpdateTransitionShared.js';

registerCommonDockerBeforeEach();
const { mockGetRollbackCounter, mockMarkOperationTerminal, mockSaveStore, mockSyncComposeFileTag } =
  getDockerTestMocks();

// --- Self-update ---

describe('isSelfUpdate', () => {
  const originalResolveSelfContainerIdentity =
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity;

  beforeEach(() => {
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi.fn().mockResolvedValue({
      id: 'self-container-id',
      name: 'drydock',
    });
  });

  afterEach(() => {
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity =
      originalResolveSelfContainerIdentity;
  });

  test('should return true for drydock image', async () => {
    const container = { id: 'self-container-id', image: { name: 'drydock' } };
    await docker.selfUpdateOrchestrator.classifySelfUpdate(container, {});
    expect(docker.isSelfUpdate(container)).toBe(true);
  });

  test('should return true for namespaced drydock image', async () => {
    const container = { id: 'self-container-id', image: { name: 'codeswhat/drydock' } };
    await docker.selfUpdateOrchestrator.classifySelfUpdate(container, {});
    expect(docker.isSelfUpdate(container)).toBe(true);
  });

  test('should return false for a peer running a drydock image', async () => {
    const container = {
      id: 'peer-container-id',
      name: 'drydock-peer',
      image: { name: 'codeswhat/drydock' },
    };
    await docker.selfUpdateOrchestrator.classifySelfUpdate(container, {});
    expect(docker.isSelfUpdate(container)).toBe(false);
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
    context.dockerApi.getContainer.mockReturnValue({
      inspect: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('helper absent'), { statusCode: 404 })),
    });

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

      expect(execute).toHaveBeenCalledWith(context, container, logContainer, undefined, undefined);
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
    const executeSelfUpdateSpy = vi.spyOn(docker, 'executeSelfUpdate').mockResolvedValue(false);
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

describe('self-update lifecycle exclusivity', () => {
  const originalResolveSelfContainerIdentity =
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity;

  beforeEach(() => {
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi.fn().mockResolvedValue({
      id: '123456789',
      name: 'container-name',
    });
  });

  afterEach(() => {
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity =
      originalResolveSelfContainerIdentity;
  });

  function installObservedInfrastructureExecution(
    helperCompletion: Promise<{ status: 'succeeded' | 'rolled-back'; lastError?: string }>,
    onRegularStart: () => void,
  ) {
    const targetContainerWithoutDrydockRuntime = {
      inspect: vi.fn().mockResolvedValue({ Id: 'new-proxy-container-id' }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const helperContainer = {
      start: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockRejectedValue(new Error('proxy watcher disconnected during replacement')),
    };
    const stableDockerApi = {
      createContainer: vi.fn().mockResolvedValue(helperContainer),
      getContainer: vi.fn().mockReturnValue(helperContainer),
    };
    const context = {
      dockerApi: {
        createContainer: vi.fn().mockRejectedValue(new Error('proxy watcher disconnected')),
      },
      registry: {
        getImageFullName: vi.fn(() => 'tecnativa/docker-socket-proxy:__TAG__'),
      },
      auth: undefined,
      newImage: 'tecnativa/docker-socket-proxy:latest',
      currentContainer: { rename: vi.fn().mockResolvedValue(undefined) },
      currentContainerSpec: {
        Name: '/socket-proxy',
        Id: 'old-proxy-container-id',
        HostConfig: { Binds: ['/var/run/docker.sock:/var/run/docker.sock'] },
      },
    };
    const logContainer = { info: vi.fn(), warn: vi.fn() };
    const pullImage = vi.spyOn(docker, 'pullImage').mockResolvedValue(undefined);
    const cloneRuntimeConfig = vi
      .spyOn(docker.runtimeConfigManager, 'getCloneRuntimeConfigOptions')
      .mockResolvedValue({});
    const cloneContainer = vi.spyOn(docker, 'cloneContainer').mockReturnValue({});
    const createContainer = vi
      .spyOn(docker, 'createContainer')
      .mockResolvedValue(targetContainerWithoutDrydockRuntime as never);
    const originalResolveHelperImage = docker.selfUpdateOrchestrator.resolveHelperImage;
    const originalWaitForObservedHelperCompletion =
      docker.selfUpdateOrchestrator.waitForObservedHelperCompletion;
    const originalResolveObservedHelperRuntime =
      docker.selfUpdateOrchestrator.resolveObservedHelperRuntime;
    docker.selfUpdateOrchestrator.resolveHelperImage = () => 'ghcr.io/codeswhat/drydock:1.8.0';
    docker.selfUpdateOrchestrator.waitForObservedHelperCompletion = vi.fn(() => helperCompletion);
    docker.selfUpdateOrchestrator.resolveObservedHelperRuntime = vi.fn().mockResolvedValue({
      dockerApi: stableDockerApi,
      networkMode: 'container:drydock-current-id',
    });
    mockMarkOperationTerminal.mockImplementation((id, patch) => ({ id, ...patch }));

    const run = vi.fn(async (container) => {
      if (container.labels?.['dd.update.mode'] === 'infrastructure') {
        const updated = await docker.executeSelfUpdate(
          context,
          container,
          logContainer,
          'infrastructure-observed-op',
        );
        return { updated, operationId: 'infrastructure-observed-op' };
      }
      onRegularStart();
      return undefined;
    });
    docker.updateLifecycleExecutor = { run } as any;

    return {
      cloneContainer,
      cloneRuntimeConfig,
      createContainer,
      dockerApi: stableDockerApi,
      helperContainer,
      pullImage,
      run,
      targetContainerWithoutDrydockRuntime,
      restore: () => {
        docker.selfUpdateOrchestrator.resolveHelperImage = originalResolveHelperImage;
        docker.selfUpdateOrchestrator.waitForObservedHelperCompletion =
          originalWaitForObservedHelperCompletion;
        docker.selfUpdateOrchestrator.resolveObservedHelperRuntime =
          originalResolveObservedHelperRuntime;
        pullImage.mockRestore();
        cloneRuntimeConfig.mockRestore();
        cloneContainer.mockRestore();
        createContainer.mockRestore();
      },
    };
  }

  test('waits for active regular work and releases queued work after a dry-run', async () => {
    const originalUpdateLifecycleExecutor = docker.updateLifecycleExecutor;
    const order: string[] = [];
    let releaseRegular: () => void = () => {};
    const regularGate = new Promise<void>((resolve) => {
      releaseRegular = resolve;
    });
    let markRegularStarted: () => void = () => {};
    const regularStarted = new Promise<void>((resolve) => {
      markRegularStarted = resolve;
    });
    const run = vi.fn(async (container) => {
      if (container.image.name === 'drydock') {
        order.push('self-dry-run');
        return { updated: false, operationId: 'self-dry-run-op' };
      }
      order.push(`regular-${container.name}-start`);
      markRegularStarted();
      await regularGate;
      order.push(`regular-${container.name}-end`);
      return undefined;
    });
    docker.updateLifecycleExecutor = { run } as any;

    try {
      const activeRegular = docker.runContainerUpdateLifecycle(
        createTriggerContainer({ name: 'active' }),
      );
      await regularStarted;
      const selfUpdate = docker.runContainerUpdateLifecycle(
        createTriggerContainer({
          name: 'drydock',
          image: { name: 'drydock' },
        }),
      );
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      const orderBeforeDrain = [...order];

      releaseRegular();
      const [, selfUpdateResult] = await Promise.all([activeRegular, selfUpdate]);
      expect(selfUpdateResult).toBe(false);
      await docker.runContainerUpdateLifecycle(createTriggerContainer({ name: 'after-dry-run' }));

      expect(orderBeforeDrain).toEqual(['regular-active-start']);
      expect(order).toEqual([
        'regular-active-start',
        'regular-active-end',
        'self-dry-run',
        'regular-after-dry-run-start',
        'regular-after-dry-run-end',
      ]);
    } finally {
      releaseRegular();
      docker.updateLifecycleExecutor = originalUpdateLifecycleExecutor;
    }
  });

  test('keeps later regular work blocked after a successful helper handoff', async () => {
    const originalUpdateLifecycleExecutor = docker.updateLifecycleExecutor;
    const run = vi.fn().mockResolvedValue({ updated: true, operationId: 'self-retained-op' });
    docker.updateLifecycleExecutor = { run } as any;
    let queuedRegular: Promise<unknown> | undefined;

    try {
      await docker.runContainerUpdateLifecycle(
        createTriggerContainer({
          name: 'drydock',
          image: { name: 'drydock' },
        }),
      );
      queuedRegular = docker.runContainerUpdateLifecycle(
        createTriggerContainer({ name: 'queued-after-self' }),
      );
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      expect(run).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ name: 'drydock' }), undefined);
      releaseFinalizedHelperLifecycle(
        { helperLifecycleOwner: 'exiting-process' },
        'succeeded',
        'self-retained-op',
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(run).toHaveBeenCalledOnce();

      releaseFinalizedHelperLifecycle(
        { helperLifecycleOwner: 'exiting-process' },
        'rolled-back',
        'self-retained-op',
      );
      await queuedRegular;
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      releaseRetainedSelfUpdateLifecycle('self-retained-op');
      await queuedRegular;
      docker.updateLifecycleExecutor = originalUpdateLifecycleExecutor;
    }
  });

  test('does not retain exclusivity when updating a peer Drydock container', async () => {
    const originalUpdateLifecycleExecutor = docker.updateLifecycleExecutor;
    const run = vi.fn(async (container) =>
      container.name === 'drydock-peer'
        ? { updated: true, operationId: 'peer-drydock-op' }
        : undefined,
    );
    docker.updateLifecycleExecutor = { run } as any;
    let regular: Promise<unknown> | undefined;

    try {
      await docker.runContainerUpdateLifecycle(
        createTriggerContainer({
          id: 'peer-container-id',
          name: 'drydock-peer',
          image: { name: 'codeswhat/drydock' },
        }),
      );
      regular = docker.runContainerUpdateLifecycle(
        createTriggerContainer({ name: 'regular-after-peer' }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      releaseRetainedSelfUpdateLifecycle('peer-drydock-op');
      await regular;
      docker.updateLifecycleExecutor = originalUpdateLifecycleExecutor;
    }
  });

  test('keeps infrastructure exclusive while the surviving process observes helper success', async () => {
    const originalUpdateLifecycleExecutor = docker.updateLifecycleExecutor;
    let completeHelper: (result: { status: 'succeeded' }) => void = () => {};
    const helperCompletion = new Promise<{ status: 'succeeded' }>((resolve) => {
      completeHelper = resolve;
    });
    let regularStarted = false;
    const harness = installObservedInfrastructureExecution(helperCompletion, () => {
      regularStarted = true;
    });
    let infrastructure: Promise<unknown> | undefined;
    let regular: Promise<unknown> | undefined;

    try {
      infrastructure = docker.runContainerUpdateLifecycle(
        createTriggerContainer({
          name: 'socket-proxy',
          labels: { 'dd.update.mode': 'infrastructure' },
        }),
      );
      regular = docker.runContainerUpdateLifecycle(
        createTriggerContainer({ name: 'regular-after-infrastructure' }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(regularStarted).toBe(false);
      expect(harness.targetContainerWithoutDrydockRuntime).not.toHaveProperty('exec');
      expect(harness.helperContainer.wait).not.toHaveBeenCalled();
      expect(harness.helperContainer.start).toHaveBeenCalledOnce();
      expect(harness.dockerApi.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            AutoRemove: true,
            NetworkMode: 'container:drydock-current-id',
          }),
        }),
      );
      releaseFinalizedHelperLifecycle(
        { helperLifecycleOwner: 'surviving-process' },
        'succeeded',
        'infrastructure-observed-op',
      );
      completeHelper({ status: 'succeeded' });
      await infrastructure;
      await regular;
      expect(regularStarted).toBe(true);
      expect(harness.targetContainerWithoutDrydockRuntime).not.toHaveProperty('exec');
    } finally {
      completeHelper({ status: 'succeeded' });
      releaseRetainedSelfUpdateLifecycle('infrastructure-observed-op');
      await infrastructure;
      await regular;
      harness.restore();
      docker.updateLifecycleExecutor = originalUpdateLifecycleExecutor;
    }
  });

  test('releases infrastructure exclusivity after an observed helper rollback', async () => {
    const originalUpdateLifecycleExecutor = docker.updateLifecycleExecutor;
    let completeRollback: (result: { status: 'rolled-back'; lastError: string }) => void = () => {};
    const rollbackCompletion = new Promise<{
      status: 'rolled-back';
      lastError: string;
    }>((resolve) => {
      completeRollback = resolve;
    });
    let regularStarted = false;
    const harness = installObservedInfrastructureExecution(rollbackCompletion, () => {
      regularStarted = true;
    });
    const infrastructure = docker.runContainerUpdateLifecycle(
      createTriggerContainer({
        name: 'socket-proxy',
        labels: { 'dd.update.mode': 'infrastructure' },
      }),
    );
    const regular = docker.runContainerUpdateLifecycle(
      createTriggerContainer({ name: 'regular-after-infrastructure-rollback' }),
    );

    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(regularStarted).toBe(false);
      expect(harness.targetContainerWithoutDrydockRuntime).not.toHaveProperty('exec');

      releaseFinalizedHelperLifecycle(
        { helperLifecycleOwner: 'surviving-process' },
        'rolled-back',
        'infrastructure-observed-op',
      );
      completeRollback({
        status: 'rolled-back',
        lastError: 'Self-update helper completed rollback',
      });
      await expect(infrastructure).rejects.toThrow('Self-update helper completed rollback');
      await regular;
      expect(regularStarted).toBe(true);
      expect(harness.helperContainer.wait).not.toHaveBeenCalled();
    } finally {
      completeRollback({
        status: 'rolled-back',
        lastError: 'Self-update helper completed rollback',
      });
      await infrastructure.catch(() => undefined);
      await regular;
      harness.restore();
      docker.updateLifecycleExecutor = originalUpdateLifecycleExecutor;
    }
  });

  test('hard-stops a helper with no callback before later lifecycle work proceeds', async () => {
    vi.useFakeTimers();
    const originalUpdateLifecycleExecutor = docker.updateLifecycleExecutor;
    const originalConfiguration = docker.configuration;
    const neverCompletes = new Promise<{
      status: 'succeeded' | 'rolled-back';
      lastError?: string;
    }>(() => {});
    let regularStarted = false;
    const harness = installObservedInfrastructureExecution(neverCompletes, () => {
      regularStarted = true;
    });
    docker.configuration = { ...configurationValid, helpercompletiontimeout: 25 };
    docker.selfUpdateOrchestrator.waitForObservedHelperCompletion = vi.fn(
      (_operationId, timeoutMs) =>
        new Promise((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(`Observed self-update helper completion timed out after ${timeoutMs}ms`),
              ),
            timeoutMs,
          );
        }),
    );

    const infrastructure = docker.runContainerUpdateLifecycle(
      createTriggerContainer({
        name: 'socket-proxy',
        labels: { 'dd.update.mode': 'infrastructure' },
      }),
    );
    const infrastructureFailure = expect(infrastructure).rejects.toThrow(
      'Observed self-update helper completion timed out after 5025ms',
    );
    const regular = docker.runContainerUpdateLifecycle(
      createTriggerContainer({ name: 'regular-after-stalled-helper' }),
    );

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(regularStarted).toBe(false);
      expect(harness.helperContainer.wait).not.toHaveBeenCalled();
      expect(harness.dockerApi.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: expect.arrayContaining(['DD_SELF_UPDATE_HELPER_COMPLETION_TIMEOUT_MS=25']),
          HostConfig: expect.objectContaining({ AutoRemove: true }),
        }),
      );

      await vi.advanceTimersByTimeAsync(5_025);
      await infrastructureFailure;
      await regular;

      expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
        'infrastructure-observed-op',
        expect.objectContaining({ status: 'failed', phase: 'failed' }),
      );
      expect(mockSaveStore).toHaveBeenCalled();
      expect(regularStarted).toBe(true);
    } finally {
      await infrastructure.catch(() => undefined);
      await regular;
      harness.restore();
      docker.configuration = originalConfiguration;
      docker.updateLifecycleExecutor = originalUpdateLifecycleExecutor;
      vi.useRealTimers();
    }
  });

  test('keeps later work blocked when terminal helper state cannot be saved', async () => {
    const originalUpdateLifecycleExecutor = docker.updateLifecycleExecutor;
    let regularStarted = false;
    const run = vi.fn(async (container) => {
      if (container.labels?.['dd.update.mode'] === 'infrastructure') {
        throw new RetainSelfUpdateLifecycleError(
          'infrastructure-save-failure-op',
          'terminal state save failed',
        );
      }
      regularStarted = true;
    });
    docker.updateLifecycleExecutor = { run } as never;

    const infrastructure = docker.runContainerUpdateLifecycle(
      createTriggerContainer({
        name: 'socket-proxy',
        labels: { 'dd.update.mode': 'infrastructure' },
      }),
    );
    const infrastructureFailure = expect(infrastructure).rejects.toThrow(
      'terminal state save failed',
    );

    try {
      await infrastructureFailure;
      const regular = docker.runContainerUpdateLifecycle(
        createTriggerContainer({ name: 'regular-after-save-failure' }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(regularStarted).toBe(false);
      releaseRetainedSelfUpdateLifecycle('infrastructure-save-failure-op');
      await regular;
      expect(regularStarted).toBe(true);
    } finally {
      releaseRetainedSelfUpdateLifecycle('infrastructure-save-failure-op');
      await infrastructure.catch(() => undefined);
      docker.updateLifecycleExecutor = originalUpdateLifecycleExecutor;
    }
  });

  test('releases infrastructure exclusivity immediately when helper handoff is skipped', async () => {
    const originalUpdateLifecycleExecutor = docker.updateLifecycleExecutor;
    const run = vi.fn(async (container) =>
      container.labels?.['dd.update.mode'] === 'infrastructure'
        ? { updated: false, operationId: 'infrastructure-skipped-op' }
        : undefined,
    );
    docker.updateLifecycleExecutor = { run } as any;

    try {
      await docker.runContainerUpdateLifecycle(
        createTriggerContainer({
          name: 'socket-proxy',
          labels: { 'dd.update.mode': 'infrastructure' },
        }),
      );
      await docker.runContainerUpdateLifecycle(
        createTriggerContainer({ name: 'regular-after-infrastructure-skip' }),
      );

      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      docker.updateLifecycleExecutor = originalUpdateLifecycleExecutor;
    }
  });
});
