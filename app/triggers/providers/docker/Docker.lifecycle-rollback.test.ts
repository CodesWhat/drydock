import log from '../../../log/index.js';
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
const {
  mockAuditCounterInc,
  mockGetInProgressOperationByContainerName,
  mockInsertAudit,
  mockRollbackCounterInc,
  mockRunHook,
  mockStartHealthMonitor,
  mockUpdateOperation,
} = getDockerTestMocks();
// --- Lifecycle hooks ---
describe('lifecycle hooks', () => {
  beforeEach(() => {
    docker.configuration = { ...configurationValid, dryrun: false, prune: false };
    docker.log = log;
    stubTriggerFlow({ running: true });
    mockRunHook.mockReset();
    mockAuditCounterInc.mockReset();
  });

  test('trigger should run pre-hook before pull and post-hook after recreate', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.hook.pre': 'echo before', 'dd.hook.post': 'echo after' },
      }),
    );

    expect(mockRunHook).toHaveBeenCalledTimes(2);
    expect(mockRunHook).toHaveBeenCalledWith(
      'echo before',
      expect.objectContaining({ label: 'pre-update' }),
    );
    expect(mockRunHook).toHaveBeenCalledWith(
      'echo after',
      expect.objectContaining({ label: 'post-update' }),
    );
  });

  test('trigger should emit hook-configured audit when hook labels are present', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.hook.pre': 'echo before' },
      }),
    );

    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-configured' });
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hook-configured',
        status: 'info',
        details: expect.stringContaining('pre=true'),
      }),
    );
  });

  test('trigger should not call hooks when no hook labels are set', async () => {
    await docker.trigger(createTriggerContainer());

    expect(mockRunHook).not.toHaveBeenCalled();
  });

  test('trigger should abort when pre-hook fails and hookPreAbort is true (default)', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'err', timedOut: false });

    await expect(
      docker.trigger(
        createTriggerContainer({
          labels: { 'dd.hook.pre': 'exit 1' },
        }),
      ),
    ).rejects.toThrowError('Pre-update hook exited with code 1');

    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-pre-failed' });
  });

  test('trigger should continue when pre-hook fails and hookPreAbort is false', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'err', timedOut: false });

    await expect(
      docker.trigger(
        createTriggerContainer({
          labels: { 'dd.hook.pre': 'exit 1', 'dd.hook.pre.abort': 'false' },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-pre-failed' });
  });

  test('trigger should abort when pre-hook times out and hookPreAbort is true', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', timedOut: true });

    await expect(
      docker.trigger(
        createTriggerContainer({
          labels: { 'dd.hook.pre': 'sleep 100', 'dd.hook.timeout': '500' },
        }),
      ),
    ).rejects.toThrowError('Pre-update hook timed out after 500ms');
  });

  test('trigger should use wud.* labels as fallback', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'wud.hook.pre': 'echo legacy-pre', 'wud.hook.post': 'echo legacy-post' },
      }),
    );

    expect(mockRunHook).toHaveBeenCalledWith(
      'echo legacy-pre',
      expect.objectContaining({ label: 'pre-update' }),
    );
    expect(mockRunHook).toHaveBeenCalledWith(
      'echo legacy-post',
      expect.objectContaining({ label: 'post-update' }),
    );
  });

  test('trigger should not abort on post-hook failure', async () => {
    mockRunHook
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'post-err', timedOut: false });

    await expect(
      docker.trigger(
        createTriggerContainer({
          labels: { 'dd.hook.pre': 'echo before', 'dd.hook.post': 'exit 1' },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-pre-success' });
    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-post-failed' });
  });

  test('trigger should emit hook-post-success audit on successful post-hook', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: 'done', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.hook.post': 'echo done' },
      }),
    );

    expect(mockAuditCounterInc).toHaveBeenCalledWith({ action: 'hook-post-success' });
  });

  test('trigger should pass hook environment variables', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.hook.pre': 'echo $DD_CONTAINER_NAME' },
      }),
    );

    expect(mockRunHook).toHaveBeenCalledWith(
      'echo $DD_CONTAINER_NAME',
      expect.objectContaining({
        env: expect.objectContaining({
          DD_CONTAINER_NAME: 'container-name',
          DD_IMAGE_NAME: 'test/test',
        }),
      }),
    );
  });

  test('trigger should use custom timeout from label', async () => {
    mockRunHook.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.hook.pre': 'echo hi', 'dd.hook.timeout': '30000' },
      }),
    );

    expect(mockRunHook).toHaveBeenCalledWith(
      'echo hi',
      expect.objectContaining({ timeout: 30000 }),
    );
  });
});

// --- Auto-rollback / health monitor integration ---

describe('auto-rollback health monitor integration', () => {
  beforeEach(() => {
    docker.configuration = { ...configurationValid, dryrun: false, prune: false };
    docker.log = log;
    mockRunHook.mockReset();
    mockStartHealthMonitor.mockReset();
    mockStartHealthMonitor.mockReturnValue({ abort: vi.fn() });
  });

  test('trigger should start health monitor when dd.rollback.auto=true and HEALTHCHECK exists', async () => {
    stubTriggerFlow({
      running: true,
      inspectOverrides: { State: { Running: true, Health: { Status: 'healthy' } } },
    });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.rollback.auto': 'true' },
      }),
    );

    expect(mockStartHealthMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        containerId: '123',
        containerName: 'container-name',
        backupImageTag: '4.5.6',
        window: 300000,
        interval: 10000,
      }),
    );
  });

  test('trigger should NOT start health monitor when dd.rollback.auto is not set', async () => {
    stubTriggerFlow({ running: true });

    await docker.trigger(createTriggerContainer());

    expect(mockStartHealthMonitor).not.toHaveBeenCalled();
  });

  test('trigger should NOT start health monitor when dd.rollback.auto=false', async () => {
    stubTriggerFlow({ running: true });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.rollback.auto': 'false' },
      }),
    );

    expect(mockStartHealthMonitor).not.toHaveBeenCalled();
  });

  test('trigger should warn when auto-rollback enabled but no HEALTHCHECK', async () => {
    const warnSpy = vi.fn();
    const infoSpy = vi.fn();
    const debugSpy = vi.fn();
    docker.log = { child: () => ({ warn: warnSpy, info: infoSpy, debug: debugSpy }) };

    stubTriggerFlow({ running: true, inspectOverrides: { State: { Running: true } } });

    await docker.trigger(
      createTriggerContainer({
        labels: { 'dd.rollback.auto': 'true' },
      }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Auto-rollback enabled but container has no HEALTHCHECK defined'),
    );
    expect(mockStartHealthMonitor).not.toHaveBeenCalled();
  });

  test('trigger should use custom window and interval from labels', async () => {
    stubTriggerFlow({
      running: true,
      inspectOverrides: { State: { Running: true, Health: { Status: 'healthy' } } },
    });

    await docker.trigger(
      createTriggerContainer({
        labels: {
          'dd.rollback.auto': 'true',
          'dd.rollback.window': '60000',
          'dd.rollback.interval': '5000',
        },
      }),
    );

    expect(mockStartHealthMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        window: 60000,
        interval: 5000,
      }),
    );
  });

  test('trigger should use wud.* labels as fallback for auto-rollback', async () => {
    stubTriggerFlow({
      running: true,
      inspectOverrides: { State: { Running: true, Health: { Status: 'healthy' } } },
    });

    await docker.trigger(
      createTriggerContainer({
        labels: {
          'wud.rollback.auto': 'true',
          'wud.rollback.window': '120000',
          'wud.rollback.interval': '3000',
        },
      }),
    );

    expect(mockStartHealthMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        window: 120000,
        interval: 3000,
      }),
    );
  });
});

describe('getRollbackConfig timer validation', () => {
  beforeEach(() => {
    docker.log = {
      child: vi.fn().mockReturnValue({ warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    };
  });

  test('should return defaults when labels produce NaN', () => {
    const result = docker.getRollbackConfig({
      labels: {
        'dd.rollback.auto': 'true',
        'dd.rollback.window': 'abc',
        'dd.rollback.interval': 'xyz',
      },
    });
    expect(result.rollbackWindow).toBe(300000);
    expect(result.rollbackInterval).toBe(10000);
  });

  test('should return defaults when labels are negative', () => {
    const result = docker.getRollbackConfig({
      labels: {
        'dd.rollback.auto': 'true',
        'dd.rollback.window': '-5000',
        'dd.rollback.interval': '-1000',
      },
    });
    expect(result.rollbackWindow).toBe(300000);
    expect(result.rollbackInterval).toBe(10000);
  });

  test('should return defaults when labels are zero', () => {
    const result = docker.getRollbackConfig({
      labels: {
        'dd.rollback.auto': 'true',
        'dd.rollback.window': '0',
        'dd.rollback.interval': '0',
      },
    });
    expect(result.rollbackWindow).toBe(300000);
    expect(result.rollbackInterval).toBe(10000);
  });

  test('should use valid label values when provided', () => {
    const result = docker.getRollbackConfig({
      labels: {
        'dd.rollback.auto': 'true',
        'dd.rollback.window': '60000',
        'dd.rollback.interval': '5000',
      },
    });
    expect(result.rollbackWindow).toBe(60000);
    expect(result.rollbackInterval).toBe(5000);
  });

  test('should log warnings when falling back to defaults', () => {
    docker.getRollbackConfig({
      labels: {
        'dd.rollback.auto': 'true',
        'dd.rollback.window': 'bad',
        'dd.rollback.interval': '-1',
      },
    });
    const childLog = docker.log.child({});
    expect(childLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid rollback window label value'),
    );
    expect(childLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid rollback interval label value'),
    );
  });
});

describe('additional docker trigger coverage', () => {
  beforeEach(() => {
    docker.configuration = { ...configurationValid, dryrun: false, prune: false };
    docker.log = {
      child: vi.fn().mockReturnValue(createMockLog('info', 'warn', 'debug')),
    };
  });

  test('preview should return details when current container exists', async () => {
    const container = createTriggerContainer();
    vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue({ id: container.id });
    vi.spyOn(docker, 'inspectContainer').mockResolvedValue({
      State: { Running: true },
      NetworkSettings: { Networks: { bridge: {}, appnet: {} } },
    });

    const preview = await docker.preview(container);

    expect(preview).toMatchObject({
      containerName: 'container-name',
      newImage: 'my-registry/test/test:4.5.6',
      isRunning: true,
      networks: ['bridge', 'appnet'],
    });
  });

  test('preview should return an explicit error when container is not found', async () => {
    vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue(undefined);
    const preview = await docker.preview(createTriggerContainer());
    expect(preview).toEqual({ error: 'Container not found in Docker' });
  });

  test('preview should fallback to empty network list when NetworkSettings are missing', async () => {
    const container = createTriggerContainer();
    vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue({ id: container.id });
    vi.spyOn(docker, 'inspectContainer').mockResolvedValue({
      State: { Running: true },
    });

    const preview = await docker.preview(container);
    expect(preview.networks).toEqual([]);
  });

  test('maybeNotifySelfUpdate should notify immediately for drydock image', async () => {
    const logContainer = createMockLog('info');

    await docker.maybeNotifySelfUpdate(
      {
        image: {
          name: 'drydock',
        },
      },
      logContainer,
    );

    expect(logContainer.info).toHaveBeenCalledWith(
      'Self-update detected — notifying UI before proceeding',
    );
  });

  test('maybeNotifySelfUpdate should no-op for non-drydock images', async () => {
    const logContainer = createMockLog('info');

    await expect(
      docker.maybeNotifySelfUpdate(
        {
          image: {
            name: 'nginx',
          },
        },
        logContainer,
      ),
    ).resolves.toBeUndefined();

    expect(logContainer.info).not.toHaveBeenCalled();
  });

  test('cleanupOldImages should remove digest image when prune is enabled and digest repo exists', async () => {
    docker.configuration.prune = true;
    const removeImageSpy = vi.spyOn(docker, 'removeImage').mockResolvedValue(undefined);
    const registryProvider = {
      getImageFullName: vi.fn(() => 'my-registry/test/test:sha256:old'),
    };

    await docker.cleanupOldImages(
      {},
      registryProvider,
      {
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/test',
          tag: { value: '1.0.0' },
          digest: { repo: 'sha256:old' },
        },
        updateKind: {
          kind: 'digest',
        },
      },
      createMockLog('debug'),
    );

    expect(removeImageSpy).toHaveBeenCalledWith(
      {},
      'my-registry/test/test:sha256:old',
      expect.any(Object),
    );
  });

  test('cleanupOldImages should skip tag pruning when tag is retained for rollback', async () => {
    const backupStore = await import('../../../store/backup.js');
    docker.configuration.prune = true;
    vi.mocked(backupStore.getBackupsByName).mockReturnValue([
      {
        imageTag: '1.0.0',
      },
    ] as any);
    const removeImageSpy = vi.spyOn(docker, 'removeImage').mockResolvedValue(undefined);
    const registryProvider = {
      getImageFullName: vi.fn(() => 'my-registry/test/test:1.0.0'),
    };
    const logContainer = createMockLog('info');

    await docker.cleanupOldImages(
      {},
      registryProvider,
      {
        name: 'container-name',
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/test',
          tag: { value: '1.0.0' },
          digest: {},
        },
        updateKind: {
          kind: 'tag',
        },
      },
      logContainer,
    );

    expect(backupStore.getBackupsByName).toHaveBeenCalledWith('container-name');
    expect(registryProvider.getImageFullName).not.toHaveBeenCalled();
    expect(removeImageSpy).not.toHaveBeenCalled();
    expect(logContainer.info).toHaveBeenCalledWith(
      expect.stringContaining('Skipping prune of 1.0.0'),
    );
  });

  test('cleanupOldImages should warn when digest image removal fails', async () => {
    docker.configuration.prune = true;
    vi.spyOn(docker, 'removeImage').mockRejectedValue(new Error('remove failed'));
    const registryProvider = {
      getImageFullName: vi.fn(() => 'my-registry/test/test:sha256:old'),
    };
    const logContainer = createMockLog('warn');

    await docker.cleanupOldImages(
      {},
      registryProvider,
      {
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/test',
          tag: { value: '1.0.0' },
          digest: { repo: 'sha256:old' },
        },
        updateKind: {
          kind: 'digest',
        },
      },
      logContainer,
    );

    expect(logContainer.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unable to remove previous digest image'),
    );
  });

  test('cleanupOldImages should skip digest pruning when digest repo is missing', async () => {
    docker.configuration.prune = true;
    const removeImageSpy = vi.spyOn(docker, 'removeImage').mockResolvedValue(undefined);

    await docker.cleanupOldImages(
      {},
      {
        getImageFullName: vi.fn(() => 'unused'),
      },
      {
        image: {
          registry: { name: 'hub', url: 'my-registry' },
          name: 'test/test',
          tag: { value: '1.0.0' },
          digest: {},
        },
        updateKind: {
          kind: 'digest',
        },
      },
      createMockLog('debug'),
    );

    expect(removeImageSpy).not.toHaveBeenCalled();
  });

  test('buildHookConfig should default update env values to empty strings when missing', () => {
    const hookConfig = docker.buildHookConfig({
      id: 'container-id',
      name: 'container-name',
      image: {
        name: 'repo/name',
        tag: {
          value: '1.0.0',
        },
      },
      updateKind: {
        kind: 'unknown',
      },
      labels: {},
    });

    expect(hookConfig.hookEnv.DD_UPDATE_FROM).toBe('');
    expect(hookConfig.hookEnv.DD_UPDATE_TO).toBe('');
  });

  test('maybeStartAutoRollbackMonitor should return early when recreated container is missing', async () => {
    const getCurrentContainerSpy = vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue(null);
    const inspectContainerSpy = vi.spyOn(docker, 'inspectContainer');

    await docker.maybeStartAutoRollbackMonitor(
      {},
      {
        id: 'container-id',
        name: 'container-name',
        image: {
          tag: { value: '1.0.0' },
          digest: { repo: 'sha256:old' },
        },
      },
      {
        autoRollback: true,
        rollbackWindow: 10_000,
        rollbackInterval: 1_000,
      },
      createMockLog('info', 'warn'),
    );

    expect(getCurrentContainerSpy).toHaveBeenCalledWith({}, { id: 'container-name' });
    expect(inspectContainerSpy).not.toHaveBeenCalled();
  });
});

// --- Non-self update rollback ---

describe('executeContainerUpdate', () => {
  function createContainerUpdateContext(overrides = {}) {
    const mockNewContainer = {
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        Id: 'new-container-id',
        State: { Health: { Status: 'healthy' } },
      }),
    };
    const currentContainer = {
      rename: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };
    const currentContainerSpec = {
      Id: 'old-container-id',
      Name: '/container-name',
      Config: { Image: 'my-registry/test/test:1.0.0' },
      State: { Running: true },
      HostConfig: { AutoRemove: false },
      NetworkSettings: { Networks: {} },
    };

    vi.spyOn(docker, 'pullImage').mockResolvedValue(undefined);
    vi.spyOn(docker, 'cloneContainer').mockReturnValue({ name: 'container-name' });
    vi.spyOn(docker, 'createContainer').mockResolvedValue(mockNewContainer);
    vi.spyOn(docker, 'stopContainer').mockResolvedValue(undefined);
    vi.spyOn(docker, 'startContainer').mockResolvedValue(undefined);
    vi.spyOn(docker, 'removeContainer').mockResolvedValue(undefined);
    vi.spyOn(docker, 'waitContainerRemoved').mockResolvedValue(undefined);

    return {
      dockerApi: {},
      auth: undefined,
      newImage: 'my-registry/test/test:4.5.6',
      currentContainer,
      currentContainerSpec,
      _mockNewContainer: mockNewContainer,
      ...overrides,
    };
  }

  test('should replace running container using rename/create/start/remove sequence', async () => {
    const context = createContainerUpdateContext();
    const logContainer = createMockLog('info', 'warn', 'debug');

    const result = await docker.executeContainerUpdate(
      context,
      createTriggerContainer(),
      logContainer,
    );

    expect(result).toBe(true);
    expect(context.currentContainer.rename).toHaveBeenCalledTimes(1);
    const tempName = context.currentContainer.rename.mock.calls[0][0].name;
    expect(tempName).toMatch(/^container-name-old-/);
    expect(docker.createContainer).toHaveBeenCalled();
    expect(docker.stopContainer).toHaveBeenCalledWith(
      context.currentContainer,
      tempName,
      'old-container-id',
      logContainer,
    );
    expect(docker.startContainer).toHaveBeenCalledWith(
      context._mockNewContainer,
      'container-name',
      logContainer,
    );
    expect(docker.removeContainer).toHaveBeenCalledWith(
      context.currentContainer,
      tempName,
      'old-container-id',
      logContainer,
    );
  });

  test('should preserve explicit runtime pins matching source defaults during update', async () => {
    const currentContainer = {
      rename: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };
    const currentContainerSpec = {
      Id: 'old-container-id',
      Name: '/container-name',
      Config: {
        Image: 'nginx:1.20-alpine',
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
        Labels: {},
      },
      State: { Running: false },
      HostConfig: { AutoRemove: false },
      NetworkSettings: { Networks: {} },
    };
    const dockerApi = {
      getImage: vi.fn((imageRef) => ({
        inspect: vi.fn().mockResolvedValue(
          imageRef === 'nginx:1.20-alpine'
            ? {
                Config: {
                  Entrypoint: ['/docker-entrypoint.sh'],
                  Cmd: ['nginx', '-g', 'daemon off;'],
                },
              }
            : {
                Config: {
                  Entrypoint: null,
                  Cmd: ['nginx'],
                },
              },
        ),
      })),
    };
    const newContainer = {
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        Id: 'new-container-id',
        State: { Health: { Status: 'healthy' } },
      }),
    };
    const createContainerSpy = vi.spyOn(docker, 'createContainer').mockResolvedValue(newContainer);
    vi.spyOn(docker, 'pullImage').mockResolvedValue(undefined);
    vi.spyOn(docker, 'removeContainer').mockResolvedValue(undefined);
    vi.spyOn(docker, 'stopContainer').mockResolvedValue(undefined);
    vi.spyOn(docker, 'startContainer').mockResolvedValue(undefined);
    vi.spyOn(docker, 'waitContainerRemoved').mockResolvedValue(undefined);

    const result = await docker.executeContainerUpdate(
      {
        dockerApi,
        auth: undefined,
        newImage: 'nginx:1.10-alpine',
        currentContainer,
        currentContainerSpec,
      },
      createTriggerContainer(),
      createMockLog('info', 'warn', 'debug'),
    );

    expect(result).toBe(true);
    const createPayload = createContainerSpy.mock.calls[0][1];
    expect(createPayload.Entrypoint).toEqual(['/docker-entrypoint.sh']);
    expect(createPayload.Cmd).toEqual(['nginx', '-g', 'daemon off;']);
    expect(createPayload.Labels['dd.runtime.entrypoint.origin']).toBe('explicit');
    expect(createPayload.Labels['dd.runtime.cmd.origin']).toBe('explicit');
  });

  test('should drop stale inherited runtime defaults when origin labels mark inherited', async () => {
    const currentContainer = {
      rename: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };
    const currentContainerSpec = {
      Id: 'old-container-id',
      Name: '/container-name',
      Config: {
        Image: 'nginx:1.20-alpine',
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
        Labels: {
          'dd.runtime.entrypoint.origin': 'inherited',
          'dd.runtime.cmd.origin': 'inherited',
        },
      },
      State: { Running: false },
      HostConfig: { AutoRemove: false },
      NetworkSettings: { Networks: {} },
    };
    const dockerApi = {
      getImage: vi.fn((imageRef) => ({
        inspect: vi.fn().mockResolvedValue(
          imageRef === 'nginx:1.20-alpine'
            ? {
                Config: {
                  Entrypoint: ['/docker-entrypoint.sh'],
                  Cmd: ['nginx', '-g', 'daemon off;'],
                },
              }
            : {
                Config: {
                  Entrypoint: null,
                  Cmd: ['nginx'],
                },
              },
        ),
      })),
    };
    const newContainer = {
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        Id: 'new-container-id',
        State: { Health: { Status: 'healthy' } },
      }),
    };
    const createContainerSpy = vi.spyOn(docker, 'createContainer').mockResolvedValue(newContainer);
    vi.spyOn(docker, 'pullImage').mockResolvedValue(undefined);
    vi.spyOn(docker, 'removeContainer').mockResolvedValue(undefined);
    vi.spyOn(docker, 'stopContainer').mockResolvedValue(undefined);
    vi.spyOn(docker, 'startContainer').mockResolvedValue(undefined);
    vi.spyOn(docker, 'waitContainerRemoved').mockResolvedValue(undefined);

    const result = await docker.executeContainerUpdate(
      {
        dockerApi,
        auth: undefined,
        newImage: 'nginx:1.10-alpine',
        currentContainer,
        currentContainerSpec,
      },
      createTriggerContainer(),
      createMockLog('info', 'warn', 'debug'),
    );

    expect(result).toBe(true);
    const createPayload = createContainerSpy.mock.calls[0][1];
    expect(createPayload.Entrypoint).toBeUndefined();
    expect(createPayload.Cmd).toBeUndefined();
    expect(createPayload.Labels['dd.runtime.entrypoint.origin']).toBe('inherited');
    expect(createPayload.Labels['dd.runtime.cmd.origin']).toBe('inherited');
  });

  test('should rollback rename when creating new container fails', async () => {
    const context = createContainerUpdateContext();
    const logContainer = createMockLog('info', 'warn', 'debug');
    vi.mocked(docker.createContainer).mockRejectedValueOnce(new Error('create failed'));

    await expect(
      docker.executeContainerUpdate(context, createTriggerContainer(), logContainer),
    ).rejects.toThrow('create failed');

    expect(context.currentContainer.rename).toHaveBeenCalledTimes(2);
    expect(context.currentContainer.rename).toHaveBeenLastCalledWith({ name: 'container-name' });
    expect(docker.stopContainer).not.toHaveBeenCalled();
    expect(docker.startContainer).not.toHaveBeenCalledWith(
      context.currentContainer,
      'container-name',
      logContainer,
    );
  });

  test('should return actionable rollback error for incompatible runtime command', async () => {
    const context = createContainerUpdateContext({
      newImage: 'nginx:1.10-alpine',
      currentContainerSpec: {
        Id: 'old-container-id',
        Name: '/container-name',
        Config: {
          Image: 'nginx:1.20-alpine',
          Entrypoint: ['/docker-entrypoint.sh'],
          Cmd: ['nginx', '-g', 'daemon off;'],
        },
        State: { Running: true },
        HostConfig: { AutoRemove: false },
        NetworkSettings: { Networks: {} },
      },
    });
    const logContainer = createMockLog('info', 'warn', 'debug');
    vi.mocked(docker.createContainer).mockRejectedValueOnce(
      new Error(
        '(HTTP code 400) unexpected - failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "/docker-entrypoint.sh": stat /docker-entrypoint.sh: no such file or directory',
      ),
    );

    await expect(
      docker.executeContainerUpdate(context, createTriggerContainer(), logContainer),
    ).rejects.toThrow('runtime command is incompatible with target image nginx:1.10-alpine');

    expect(context.currentContainer.rename).toHaveBeenCalledTimes(2);
    expect(context.currentContainer.rename).toHaveBeenLastCalledWith({ name: 'container-name' });
  });

  test('should rollback to old container when starting new container fails', async () => {
    const context = createContainerUpdateContext();
    const logContainer = createMockLog('info', 'warn', 'debug');
    vi.mocked(docker.startContainer)
      .mockRejectedValueOnce(new Error('new start failed'))
      .mockResolvedValueOnce(undefined);

    await expect(
      docker.executeContainerUpdate(context, createTriggerContainer(), logContainer),
    ).rejects.toThrow('new start failed');

    const tempName = context.currentContainer.rename.mock.calls[0][0].name;
    expect(docker.stopContainer).toHaveBeenCalledWith(
      context.currentContainer,
      tempName,
      'old-container-id',
      logContainer,
    );
    expect(context._mockNewContainer.stop).toHaveBeenCalled();
    expect(context._mockNewContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(context.currentContainer.rename).toHaveBeenLastCalledWith({ name: 'container-name' });
    expect(docker.startContainer).toHaveBeenNthCalledWith(
      2,
      context.currentContainer,
      'container-name',
      logContainer,
    );
  });

  test('should wait for old container auto-removal when AutoRemove is enabled', async () => {
    const context = createContainerUpdateContext({
      currentContainerSpec: {
        Id: 'old-container-id',
        Name: '/container-name',
        Config: { Image: 'my-registry/test/test:1.0.0' },
        State: { Running: true },
        HostConfig: { AutoRemove: true },
        NetworkSettings: { Networks: {} },
      },
    });
    const logContainer = createMockLog('info', 'warn', 'debug');

    await docker.executeContainerUpdate(context, createTriggerContainer(), logContainer);

    const tempName = context.currentContainer.rename.mock.calls[0][0].name;
    expect(docker.waitContainerRemoved).toHaveBeenCalledWith(
      context.currentContainer,
      tempName,
      'old-container-id',
      logContainer,
    );
    expect(docker.removeContainer).not.toHaveBeenCalled();
  });

  test('should treat old AutoRemove cleanup 404 as success', async () => {
    const context = createContainerUpdateContext({
      currentContainerSpec: {
        Id: 'old-container-id',
        Name: '/container-name',
        Config: { Image: 'my-registry/test/test:1.0.0' },
        State: { Running: true },
        HostConfig: { AutoRemove: true },
        NetworkSettings: { Networks: {} },
      },
    });
    const logContainer = createMockLog('info', 'warn', 'debug');
    const alreadyRemovedError = Object.assign(new Error('No such container: old-container-id'), {
      statusCode: 404,
    });
    vi.mocked(docker.waitContainerRemoved).mockRejectedValueOnce(alreadyRemovedError);

    const result = await docker.executeContainerUpdate(
      context,
      createTriggerContainer(),
      logContainer,
    );

    expect(result).toBe(true);
    expect(context.currentContainer.rename).toHaveBeenCalledTimes(1);
    expect(mockRollbackCounterInc).not.toHaveBeenCalled();
    expect(mockUpdateOperation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'succeeded',
        phase: 'succeeded',
      }),
    );
  });

  test('should not rollback-delete healthy new container when AutoRemove cleanup reports no such container', async () => {
    const context = createContainerUpdateContext({
      currentContainerSpec: {
        Id: 'old-container-id',
        Name: '/container-name',
        Config: { Image: 'my-registry/test/test:1.0.0' },
        State: { Running: true },
        HostConfig: { AutoRemove: true },
        NetworkSettings: { Networks: {} },
      },
    });
    const logContainer = createMockLog('info', 'warn', 'debug');
    vi.mocked(docker.waitContainerRemoved).mockRejectedValueOnce(
      new Error('No such container: old-container-id'),
    );

    await expect(
      docker.executeContainerUpdate(context, createTriggerContainer(), logContainer),
    ).resolves.toBe(true);

    expect(context._mockNewContainer.stop).not.toHaveBeenCalled();
    expect(context._mockNewContainer.remove).not.toHaveBeenCalled();
    expect(context.currentContainer.rename).toHaveBeenCalledTimes(1);
  });

  test('should remove old container when AutoRemove is enabled but source was already stopped', async () => {
    const context = createContainerUpdateContext({
      currentContainerSpec: {
        Id: 'old-container-id',
        Name: '/container-name',
        Config: { Image: 'my-registry/test/test:1.0.0' },
        State: { Running: false },
        HostConfig: { AutoRemove: true },
        NetworkSettings: { Networks: {} },
      },
    });
    const logContainer = createMockLog('info', 'warn', 'debug');

    await docker.executeContainerUpdate(context, createTriggerContainer(), logContainer);

    const tempName = context.currentContainer.rename.mock.calls[0][0].name;
    expect(docker.removeContainer).toHaveBeenCalledWith(
      context.currentContainer,
      tempName,
      'old-container-id',
      logContainer,
    );
    expect(docker.waitContainerRemoved).not.toHaveBeenCalled();
  });

  test('should skip health gate when HEALTHCHECK is configured but auto-rollback is disabled', async () => {
    const context = createContainerUpdateContext({
      currentContainerSpec: {
        Id: 'old-container-id',
        Name: '/container-name',
        Config: { Image: 'my-registry/test/test:1.0.0', Healthcheck: { Test: ['CMD', 'true'] } },
        State: { Running: true },
        HostConfig: { AutoRemove: false },
        NetworkSettings: { Networks: {} },
      },
    });
    const logContainer = createMockLog('info', 'warn', 'debug');
    const waitForHealthySpy = vi.spyOn(docker, 'waitForContainerHealthy').mockResolvedValue();

    await docker.executeContainerUpdate(context, createTriggerContainer(), logContainer);

    expect(waitForHealthySpy).not.toHaveBeenCalled();
  });

  test('should health-gate new container before removing old one when auto-rollback is enabled', async () => {
    const context = createContainerUpdateContext({
      currentContainerSpec: {
        Id: 'old-container-id',
        Name: '/container-name',
        Config: { Image: 'my-registry/test/test:1.0.0', Healthcheck: { Test: ['CMD', 'true'] } },
        State: { Running: true },
        HostConfig: { AutoRemove: false },
        NetworkSettings: { Networks: {} },
      },
    });
    const logContainer = createMockLog('info', 'warn', 'debug');
    const waitForHealthySpy = vi.spyOn(docker, 'waitForContainerHealthy').mockResolvedValue();

    await docker.executeContainerUpdate(
      context,
      createTriggerContainer({
        labels: { 'dd.rollback.auto': 'true' },
      }),
      logContainer,
    );

    expect(waitForHealthySpy).toHaveBeenCalledWith(
      context._mockNewContainer,
      'container-name',
      logContainer,
      300_000,
    );
    expect(mockUpdateOperation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phase: 'health-gate-passed' }),
    );
  });

  test('should rollback when health gate fails and auto-rollback is enabled', async () => {
    const context = createContainerUpdateContext({
      currentContainerSpec: {
        Id: 'old-container-id',
        Name: '/container-name',
        Config: { Image: 'my-registry/test/test:1.0.0', Healthcheck: { Test: ['CMD', 'true'] } },
        State: { Running: true },
        HostConfig: { AutoRemove: false },
        NetworkSettings: { Networks: {} },
      },
    });
    const logContainer = createMockLog('info', 'warn', 'debug');
    vi.spyOn(docker, 'waitForContainerHealthy').mockRejectedValue(
      new Error('Health gate failed: unhealthy'),
    );
    vi.mocked(docker.startContainer)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(
      docker.executeContainerUpdate(
        context,
        createTriggerContainer({
          labels: { 'dd.rollback.auto': 'true' },
        }),
        logContainer,
      ),
    ).rejects.toThrow('Health gate failed: unhealthy');

    expect(context._mockNewContainer.stop).toHaveBeenCalled();
    expect(context._mockNewContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(context.currentContainer.rename).toHaveBeenLastCalledWith({ name: 'container-name' });
    expect(mockRollbackCounterInc).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'success',
        reason: 'health_gate_failed',
      }),
    );
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rollback',
        status: 'success',
      }),
    );
  });

  test('should reconcile pending in-progress operation before update', async () => {
    const staleTempContainer = {
      inspect: vi.fn().mockResolvedValue({ Id: 'temp-id', State: { Running: false } }),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const activeContainer = {
      inspect: vi.fn().mockResolvedValue({ Id: 'active-id', State: { Running: true } }),
    };
    const dockerApi = {
      getContainer: vi.fn((id) => {
        if (id === 'container-name') return activeContainer;
        if (id === 'container-name-old-stale') return staleTempContainer;
        return { inspect: vi.fn().mockRejectedValue(new Error('not found')) };
      }),
    };
    const context = createContainerUpdateContext({ dockerApi });
    const logContainer = createMockLog('info', 'warn', 'debug');
    mockGetInProgressOperationByContainerName.mockReturnValue({
      id: 'op-recover-1',
      containerName: 'container-name',
      oldName: 'container-name',
      tempName: 'container-name-old-stale',
      oldContainerWasRunning: true,
      oldContainerStopped: true,
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      status: 'in-progress',
    });

    await docker.executeContainerUpdate(context, createTriggerContainer(), logContainer);

    expect(staleTempContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(mockUpdateOperation).toHaveBeenCalledWith(
      'op-recover-1',
      expect.objectContaining({
        status: 'succeeded',
        phase: 'recovered-cleanup-temp',
      }),
    );
    expect(mockRollbackCounterInc).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'startup_reconcile_cleanup_temp',
      }),
    );
  });

  test('should return false in dry-run mode', async () => {
    docker.configuration = { ...configurationValid, dryrun: true };
    const context = createContainerUpdateContext();
    const logContainer = createMockLog('info', 'warn', 'debug');

    const result = await docker.executeContainerUpdate(
      context,
      createTriggerContainer(),
      logContainer,
    );

    expect(result).toBe(false);
    expect(context.currentContainer.rename).not.toHaveBeenCalled();
  });
});
