import { describe, expect, test, vi } from 'vitest';

import SelfUpdateOrchestrator from './SelfUpdateOrchestrator.js';

function createContainer(overrides = {}) {
  return {
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
  });

  test('identifies self-update containers and docker socket bind path', () => {
    const orchestrator = createOrchestrator();

    expect(orchestrator.isSelfUpdate(createContainer({ image: { name: 'drydock' } }))).toBe(true);
    expect(
      orchestrator.isSelfUpdate(createContainer({ image: { name: 'ghcr.io/acme/drydock' } })),
    ).toBe(true);
    expect(
      orchestrator.isSelfUpdate(createContainer({ image: { name: 'ghcr.io/acme/web' } })),
    ).toBe(false);

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

    await orchestrator.maybeNotify(createContainer(), log, 'op-1');
    expect(log.info).toHaveBeenCalledWith('Self-update detected — notifying UI before proceeding');
    expect(emitSelfUpdateStarting).toHaveBeenCalledWith(
      expect.objectContaining({
        opId: 'op-1',
        requiresAck: true,
        ackTimeoutMs: 3000,
      }),
    );

    await orchestrator.maybeNotify(createContainer(), log);
    expect(createOperationId).toHaveBeenCalled();
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
