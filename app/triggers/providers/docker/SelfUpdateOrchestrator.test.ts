import { describe, expect, test, vi } from 'vitest';

import SelfUpdateOrchestrator from './SelfUpdateOrchestrator.js';

function createContainer(overrides = {}) {
  return {
    id: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    name: 'drydock',
    image: {
      name: 'ghcr.io/acme/drydock',
      tag: { value: '1.0.0' },
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
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const helperContainer = {
    start: vi.fn().mockResolvedValue(undefined),
  };
  const dockerApi = {
    createContainer: vi.fn().mockResolvedValue(helperContainer),
  };

  return {
    dockerApi,
    auth: { username: 'bot', password: 'token' },
    newImage: 'ghcr.io/acme/drydock:2.0.0',
    currentContainer,
    currentContainerSpec: {
      Name: '/drydock',
      Id: 'old-container-id',
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      },
    },
    newContainer,
    helperContainer,
    ...overrides,
  };
}

function createOrchestrator(overrides = {}) {
  return new SelfUpdateOrchestrator({
    getConfiguration: () => ({ dryrun: false }),
    runtimeConfigManager: {
      getCloneRuntimeConfigOptions: vi.fn().mockResolvedValue({ runtime: true }),
    },
    pullImage: vi.fn().mockResolvedValue(undefined),
    cloneContainer: vi.fn(() => ({ cloned: true })),
    createContainer: vi.fn(),
    insertContainerImageBackup: vi.fn(),
    emitSelfUpdateStarting: vi.fn().mockResolvedValue(undefined),
    createOperationId: vi.fn(() => 'generated-operation-id'),
    resolveSelfContainerIdentity: vi.fn().mockResolvedValue({
      id: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      name: 'drydock',
    }),
    ...overrides,
  });
}

describe('SelfUpdateOrchestrator', () => {
  test('constructor provides default no-op helpers', async () => {
    const orchestrator = new SelfUpdateOrchestrator({
      runtimeConfigManager: { getCloneRuntimeConfigOptions: vi.fn() },
      pullImage: vi.fn(),
      cloneContainer: vi.fn(),
      createContainer: vi.fn(),
    });

    expect(orchestrator.getConfiguration()).toEqual({});
    expect(orchestrator.insertContainerImageBackup({}, {})).toBeUndefined();
    await expect(orchestrator.emitSelfUpdateStarting({})).resolves.toBeUndefined();
  });

  test('constructor default dependency stubs throw when required runtime dependencies are omitted', async () => {
    const orchestrator = new SelfUpdateOrchestrator();

    await expect(orchestrator.runtimeConfigManager.getCloneRuntimeConfigOptions()).rejects.toThrow(
      'SelfUpdateOrchestrator requires dependency "runtimeConfigManager.getCloneRuntimeConfigOptions"',
    );
    await expect(
      orchestrator.pullImage({} as never, undefined, 'img', {} as never),
    ).rejects.toThrow('SelfUpdateOrchestrator requires dependency "pullImage"');
    expect(() => orchestrator.cloneContainer({} as never, 'img', {})).toThrow(
      'SelfUpdateOrchestrator requires dependency "cloneContainer"',
    );
    await expect(
      orchestrator.createContainer({} as never, {}, 'name', {} as never),
    ).rejects.toThrow('SelfUpdateOrchestrator requires dependency "createContainer"');
    expect(() => orchestrator.finalizeObservedHelperOperation('op-1', 'succeeded')).toThrow(
      'SelfUpdateOrchestrator requires dependency "finalizeObservedHelperOperation"',
    );
    await expect(orchestrator.resolveObserverNetworkMode()).rejects.toThrow(
      'SelfUpdateOrchestrator requires dependency "resolveObserverNetworkMode"',
    );
    await expect(orchestrator.resolveObservedHelperRuntime({} as never, {})).rejects.toThrow(
      'SelfUpdateOrchestrator requires dependency "resolveObservedHelperRuntime"',
    );
  });

  test('constructor default identity resolver uses Docker runtime evidence', async () => {
    const orchestrator = new SelfUpdateOrchestrator();
    const listContainers = vi.fn().mockRejectedValue(new Error('Docker unavailable'));

    await expect(
      orchestrator.classifySelfUpdate(createContainer(), { listContainers }),
    ).resolves.toBe('indeterminate');
    expect(listContainers).toHaveBeenCalledWith({ all: true });
  });

  test('identifies only the Docker-resolved current process container as a self-update', async () => {
    const orchestrator = createOrchestrator();
    const self = createContainer({ image: { name: 'drydock' } });
    const namespacedSelf = createContainer({ image: { name: 'ghcr.io/acme/drydock' } });
    const peer = createContainer({
      id: 'fedcba6543217890fedcba6543217890fedcba6543217890fedcba6543217890',
      name: 'drydock-peer',
      image: { name: 'ghcr.io/acme/drydock' },
    });
    const nonDrydock = createContainer({ image: { name: 'ghcr.io/acme/web' } });

    await expect(orchestrator.classifySelfUpdate(self, {})).resolves.toBe('current');
    await expect(orchestrator.classifySelfUpdate(namespacedSelf, {})).resolves.toBe('current');
    await expect(orchestrator.classifySelfUpdate(peer, {})).resolves.toBe('peer');
    await expect(orchestrator.classifySelfUpdate(nonDrydock, {})).resolves.toBe('peer');
    expect(orchestrator.isSelfUpdate(self)).toBe(true);
    expect(orchestrator.isSelfUpdate(namespacedSelf)).toBe(true);
    expect(orchestrator.isSelfUpdate(peer)).toBe(false);
    expect(orchestrator.isSelfUpdate(nonDrydock)).toBe(false);
  });

  test('recognizes the authoritative container name when its hostname differs', async () => {
    const orchestrator = createOrchestrator({
      resolveSelfContainerIdentity: vi.fn().mockResolvedValue({
        id: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        name: 'drydock-primary',
      }),
    });
    const container = createContainer({
      id: 'fedcba6543217890fedcba6543217890fedcba6543217890fedcba6543217890',
      name: 'drydock-primary',
    });

    await expect(orchestrator.classifySelfUpdate(container, {})).resolves.toBe('current');
    expect(orchestrator.isSelfUpdate(container)).toBe(true);
  });

  test('fails closed when current container identity is unavailable', async () => {
    const orchestrator = createOrchestrator({
      resolveSelfContainerIdentity: vi.fn().mockResolvedValue(null),
    });
    const container = createContainer();

    await expect(orchestrator.classifySelfUpdate(container, {})).resolves.toBe('indeterminate');
    expect(orchestrator.isSelfUpdate(container)).toBe(false);
    expect(orchestrator.getSelfUpdateClassification(container)).toBe('indeterminate');
  });

  test('fails closed when identity resolution rejects or returns malformed evidence', async () => {
    const rejectedResolver = createOrchestrator({
      resolveSelfContainerIdentity: vi.fn().mockRejectedValue(new Error('Docker unavailable')),
    });
    const malformedResolver = createOrchestrator({
      resolveSelfContainerIdentity: vi.fn().mockResolvedValue({ id: '', name: '' }),
    });
    const candidate = createContainer();
    const unidentifiedCandidate = createContainer({ id: undefined, name: undefined });

    await expect(rejectedResolver.classifySelfUpdate(candidate, {})).resolves.toBe('indeterminate');
    await expect(malformedResolver.classifySelfUpdate(candidate, {})).resolves.toBe(
      'indeterminate',
    );
    await expect(createOrchestrator().classifySelfUpdate(unidentifiedCandidate, {})).resolves.toBe(
      'indeterminate',
    );
  });

  test('execute rejects an indeterminate Drydock identity before transition work', async () => {
    const pullImage = vi.fn();
    const orchestrator = createOrchestrator({
      pullImage,
      resolveSelfContainerIdentity: vi.fn().mockResolvedValue(null),
    });

    await expect(
      orchestrator.execute(createContext(), createContainer(), { info: vi.fn(), warn: vi.fn() }),
    ).rejects.toThrow('Drydock container identity is indeterminate');
    expect(pullImage).not.toHaveBeenCalled();
  });

  test('uses the authoritative container name when the candidate id is unavailable', async () => {
    const orchestrator = createOrchestrator();
    const unnamedContainer = createContainer({ name: undefined });
    const unidentifiedContainer = createContainer({ id: undefined });

    await expect(orchestrator.classifySelfUpdate(unnamedContainer, {})).resolves.toBe('current');
    await expect(orchestrator.classifySelfUpdate(unidentifiedContainer, {})).resolves.toBe(
      'current',
    );
    expect(orchestrator.isSelfUpdate(unnamedContainer)).toBe(true);
    expect(orchestrator.isSelfUpdate(unidentifiedContainer)).toBe(true);
    orchestrator.clearSelfUpdateClassification(unidentifiedContainer);
    expect(orchestrator.getSelfUpdateClassification(unidentifiedContainer)).toBeUndefined();
  });

  test('finds the docker socket bind path', () => {
    const orchestrator = createOrchestrator();

    expect(
      orchestrator.findDockerSocketBind({
        HostConfig: {
          Binds: ['/tmp/socket.sock:/tmp/socket.sock', '/var/run/docker.sock:/var/run/docker.sock'],
        },
      }),
    ).toBe('/var/run/docker.sock');
    expect(orchestrator.findDockerSocketBind({ HostConfig: { Binds: [] } })).toBeUndefined();
    expect(orchestrator.findDockerSocketBind(undefined)).toBeUndefined();
  });

  test('identifies infrastructure update containers by dd.update.mode label', () => {
    const orchestrator = createOrchestrator();

    expect(
      orchestrator.isInfrastructureUpdate(
        createContainer({ labels: { 'dd.update.mode': 'infrastructure' } }),
      ),
    ).toBe(true);
    expect(
      orchestrator.isInfrastructureUpdate(
        createContainer({ labels: { 'dd.update.mode': 'normal' } }),
      ),
    ).toBe(false);
    expect(orchestrator.isInfrastructureUpdate(createContainer({ labels: {} }))).toBe(false);
    expect(orchestrator.isInfrastructureUpdate(createContainer({}))).toBe(false);
    expect(orchestrator.isInfrastructureUpdate(createContainer({ labels: null }))).toBe(false);
  });

  test('passes touchOperation through to executeSelfUpdateTransition', async () => {
    const touchOperation = vi.fn();
    const helperContainer = { start: vi.fn().mockResolvedValue(undefined) };
    const dockerApiCreateContainer = vi.fn().mockResolvedValue(helperContainer);
    const newContainer = {
      inspect: vi.fn().mockResolvedValue({ Id: 'new-id' }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const orchestrator = createOrchestrator({
      touchOperation,
      createContainer: vi.fn().mockResolvedValue(newContainer),
    });
    const log = { info: vi.fn(), warn: vi.fn() };
    const context = {
      dockerApi: { createContainer: dockerApiCreateContainer },
      auth: undefined,
      newImage: 'drydock:latest',
      currentContainer: { rename: vi.fn().mockResolvedValue(undefined) },
      currentContainerSpec: {
        Name: '/drydock',
        Id: 'old-id',
        HostConfig: { Binds: ['/var/run/docker.sock:/var/run/docker.sock'] },
      },
    };

    await orchestrator.execute(context as never, createContainer(), log, 'op-touch-orch');

    expect(touchOperation).toHaveBeenCalledOnce();
    expect(touchOperation).toHaveBeenCalledWith('op-touch-orch');
  });

  test('passes resolveHelperImage through to executeSelfUpdateTransition', async () => {
    const resolveHelperImage = vi.fn(() => 'drydock:latest');
    const helperContainer = { start: vi.fn().mockResolvedValue(undefined) };
    const dockerApiCreateContainer = vi.fn().mockResolvedValue(helperContainer);
    const newContainer = {
      inspect: vi.fn().mockResolvedValue({ Id: 'new-id' }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const orchestrator = createOrchestrator({
      resolveHelperImage,
      createContainer: vi.fn().mockResolvedValue(newContainer),
    });
    const log = { info: vi.fn(), warn: vi.fn() };
    const context = {
      dockerApi: { createContainer: dockerApiCreateContainer },
      auth: undefined,
      newImage: 'proxy:latest',
      currentContainer: { rename: vi.fn().mockResolvedValue(undefined) },
      currentContainerSpec: {
        Name: '/socket-proxy',
        Id: 'abc123',
        HostConfig: { Binds: ['/var/run/docker.sock:/var/run/docker.sock'] },
      },
    };

    await orchestrator.execute(context as never, createContainer(), log);

    expect(resolveHelperImage).toHaveBeenCalled();
    const helperCreateCall = dockerApiCreateContainer.mock.calls[0][0];
    expect(helperCreateCall.Image).toBe('drydock:latest');
  });

  test('observes helper completion for a peer infrastructure target', async () => {
    const context = createContext();
    context.helperContainer.wait = vi.fn().mockResolvedValue({ StatusCode: 0 });
    const finalizeObservedHelperOperation = vi.fn();
    const orchestrator = createOrchestrator({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      finalizeObservedHelperOperation,
      waitForObservedHelperCompletion: vi.fn().mockResolvedValue({ status: 'succeeded' }),
      resolveObservedHelperRuntime: vi.fn().mockResolvedValue({
        dockerApi: context.dockerApi,
        networkMode: 'container:drydock-current-id',
      }),
    });
    const infrastructure = createContainer({
      name: 'socket-proxy',
      image: { name: 'tecnativa/docker-socket-proxy' },
      labels: { 'dd.update.mode': 'infrastructure' },
    });

    await expect(
      orchestrator.execute(context, infrastructure, { info: vi.fn(), warn: vi.fn() }, 'infra-op'),
    ).resolves.toBe(true);

    expect(finalizeObservedHelperOperation).not.toHaveBeenCalled();
  });

  test('maybeNotify emits self-update-starting only for self-update containers', async () => {
    const emitSelfUpdateStarting = vi.fn().mockResolvedValue(undefined);
    const createOperationId = vi.fn(() => 'generated-operation-id');
    const orchestrator = createOrchestrator({
      emitSelfUpdateStarting,
      createOperationId,
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await orchestrator.maybeNotify(createContainer({ image: { name: 'ghcr.io/acme/web' } }), log);
    expect(emitSelfUpdateStarting).not.toHaveBeenCalled();

    const self = createContainer();
    await orchestrator.classifySelfUpdate(self, {});
    await orchestrator.maybeNotify(self, log, 'op-1');
    expect(log.info).toHaveBeenCalledWith('Self-update detected — notifying UI before proceeding');
    expect(emitSelfUpdateStarting).toHaveBeenCalledWith(
      expect.objectContaining({
        opId: 'op-1',
        requiresAck: true,
        ackTimeoutMs: 3000,
      }),
    );

    const generatedIdSelf = createContainer();
    await orchestrator.classifySelfUpdate(generatedIdSelf, {});
    await orchestrator.maybeNotify(generatedIdSelf, log);
    expect(createOperationId).toHaveBeenCalled();
  });

  test('maybeNotify skips emitSelfUpdateStarting and logs when dry-run mode is enabled', async () => {
    const emitSelfUpdateStarting = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      getConfiguration: () => ({ dryrun: true }),
      emitSelfUpdateStarting,
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    const self = createContainer();
    await orchestrator.classifySelfUpdate(self, {});
    await orchestrator.maybeNotify(self, log, 'op-dryrun');

    expect(emitSelfUpdateStarting).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      'Self-update UI notification skipped because dry-run mode is enabled',
    );
  });

  test('maybeNotify emits self-update-starting when dryrun is false', async () => {
    const emitSelfUpdateStarting = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      getConfiguration: () => ({ dryrun: false }),
      emitSelfUpdateStarting,
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    const self = createContainer();
    await orchestrator.classifySelfUpdate(self, {});
    await orchestrator.maybeNotify(self, log, 'op-live');

    expect(emitSelfUpdateStarting).toHaveBeenCalledWith(
      expect.objectContaining({ opId: 'op-live' }),
    );
  });

  test('returns false in dry-run mode', async () => {
    const orchestrator = createOrchestrator({
      getConfiguration: () => ({ dryrun: true }),
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await expect(orchestrator.execute(createContext(), createContainer(), log)).resolves.toBe(
      false,
    );
    expect(log.info).toHaveBeenCalledWith(
      'Do not replace the existing container because dry-run mode is enabled',
    );
  });

  test('reuses an authoritative self-update classification during execution', async () => {
    const resolveSelfContainerIdentity = vi.fn().mockResolvedValue({
      id: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      name: 'drydock',
    });
    const orchestrator = createOrchestrator({
      getConfiguration: () => ({ dryrun: true }),
      resolveSelfContainerIdentity,
    });
    const container = createContainer();

    await orchestrator.classifySelfUpdate(container, {});
    await expect(orchestrator.execute(createContext(), container, { info: vi.fn() })).resolves.toBe(
      false,
    );

    expect(resolveSelfContainerIdentity).toHaveBeenCalledOnce();
  });

  test('throws when docker socket bind is missing', async () => {
    const orchestrator = createOrchestrator();

    await expect(
      orchestrator.execute(
        createContext({
          currentContainerSpec: {
            Name: '/drydock',
            Id: 'old-container-id',
            HostConfig: { Binds: ['/tmp:/tmp'] },
          },
        }),
        createContainer(),
        { info: vi.fn(), warn: vi.fn() },
      ),
    ).rejects.toThrow('Self-update requires the Docker socket to be bind-mounted');
  });

  test('creates helper container and starts it on success', async () => {
    const context = createContext();
    const createContainerFn = vi.fn().mockResolvedValue(context.newContainer);
    const insertContainerImageBackup = vi.fn();
    const pullImage = vi.fn().mockResolvedValue(undefined);
    const getCloneRuntimeConfigOptions = vi.fn().mockResolvedValue({ runtime: true });
    const log = { info: vi.fn(), warn: vi.fn() };
    const orchestrator = createOrchestrator({
      createContainer: createContainerFn,
      insertContainerImageBackup,
      pullImage,
      runtimeConfigManager: {
        getCloneRuntimeConfigOptions,
      },
    });

    await expect(orchestrator.execute(context, createContainer(), log, 'op-123')).resolves.toBe(
      true,
    );

    expect(insertContainerImageBackup).toHaveBeenCalled();
    expect(pullImage).toHaveBeenCalledWith(context.dockerApi, context.auth, context.newImage, log);
    expect(getCloneRuntimeConfigOptions).toHaveBeenCalledWith(
      context.dockerApi,
      context.currentContainerSpec,
      context.newImage,
      log,
    );
    expect(createContainerFn).toHaveBeenCalledWith(
      context.dockerApi,
      { cloned: true },
      'drydock',
      log,
    );
    expect(context.helperContainer.start).toHaveBeenCalled();
    expect(context.dockerApi.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: context.newImage,
        Env: expect.arrayContaining([
          'DD_SELF_UPDATE_OP_ID=op-123',
          'DD_SELF_UPDATE_OLD_CONTAINER_ID=old-container-id',
          'DD_SELF_UPDATE_NEW_CONTAINER_ID=new-container-id',
          'DD_SELF_UPDATE_OLD_CONTAINER_NAME=drydock',
        ]),
        HostConfig: {
          AutoRemove: true,
          Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
        },
      }),
    );
    expect(log.info).toHaveBeenCalledWith(
      'Helper container started — process will terminate when old container stops',
    );
  });

  test('generates operation id when none is provided', async () => {
    const context = createContext();
    const createContainerFn = vi.fn().mockResolvedValue(context.newContainer);
    const orchestrator = new SelfUpdateOrchestrator({
      getConfiguration: () => ({ dryrun: false }),
      runtimeConfigManager: {
        getCloneRuntimeConfigOptions: vi.fn().mockResolvedValue({ runtime: true }),
      },
      pullImage: vi.fn().mockResolvedValue(undefined),
      cloneContainer: vi.fn(() => ({ cloned: true })),
      createContainer: createContainerFn,
      insertContainerImageBackup: vi.fn(),
      emitSelfUpdateStarting: vi.fn().mockResolvedValue(undefined),
      resolveSelfContainerIdentity: vi.fn().mockResolvedValue({
        id: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        name: 'drydock',
      }),
    });

    await orchestrator.execute(context, createContainer(), { info: vi.fn(), warn: vi.fn() });

    const helperContainerSpec = context.dockerApi.createContainer.mock.calls[0][0];
    const operationIdEnvVar = helperContainerSpec.Env.find((value) =>
      value.startsWith('DD_SELF_UPDATE_OP_ID='),
    );

    expect(context.dockerApi.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: expect.arrayContaining([expect.stringMatching(/^DD_SELF_UPDATE_OP_ID=/)]),
      }),
    );
    expect(operationIdEnvVar).toMatch(
      /^DD_SELF_UPDATE_OP_ID=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test('rolls back rename when creation/inspect/helper steps fail', async () => {
    const contextCreateFail = createContext();
    const createFailLog = { info: vi.fn(), warn: vi.fn() };
    const orchestratorCreateFail = createOrchestrator({
      createContainer: vi.fn().mockRejectedValue(new Error('create failed')),
    });
    await expect(
      orchestratorCreateFail.execute(contextCreateFail, createContainer(), createFailLog),
    ).rejects.toThrow('create failed');
    expect(contextCreateFail.currentContainer.rename).toHaveBeenNthCalledWith(2, {
      name: 'drydock',
    });
    expect(createFailLog.warn).toHaveBeenCalledWith(
      'Failed to create new container, rolling back rename: create failed',
    );

    const contextInspectFail = createContext();
    contextInspectFail.newContainer.inspect.mockRejectedValue(new Error('inspect failed'));
    const orchestratorInspectFail = createOrchestrator({
      createContainer: vi.fn().mockResolvedValue(contextInspectFail.newContainer),
    });
    await expect(
      orchestratorInspectFail.execute(contextInspectFail, createContainer(), {
        info: vi.fn(),
        warn: vi.fn(),
      }),
    ).rejects.toThrow('inspect failed');
    expect(contextInspectFail.newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(contextInspectFail.currentContainer.rename).toHaveBeenNthCalledWith(2, {
      name: 'drydock',
    });

    const contextHelperFail = createContext({
      dockerApi: {
        createContainer: vi.fn().mockRejectedValue(new Error('helper failed')),
      },
    });
    const orchestratorHelperFail = createOrchestrator({
      createContainer: vi.fn().mockResolvedValue(contextHelperFail.newContainer),
    });
    await expect(
      orchestratorHelperFail.execute(contextHelperFail, createContainer(), {
        info: vi.fn(),
        warn: vi.fn(),
      }),
    ).rejects.toThrow('helper failed');
    expect(contextHelperFail.newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(contextHelperFail.currentContainer.rename).toHaveBeenNthCalledWith(2, {
      name: 'drydock',
    });
  });
});

describe('SelfUpdateOrchestrator resolveFinalizeSecret default', () => {
  test('resolveFinalizeSecret default returns missing-self-update-finalize-secret for any operationId', () => {
    const orchestrator = new SelfUpdateOrchestrator();
    expect(orchestrator.resolveFinalizeSecret('some-op-id')).toBe(
      'missing-self-update-finalize-secret',
    );
  });
});
