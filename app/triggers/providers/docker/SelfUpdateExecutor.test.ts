import { describe, expect, test, vi } from 'vitest';

import SelfUpdateExecutor from './SelfUpdateExecutor.js';

function createContainer(overrides = {}) {
  return {
    name: 'drydock',
    image: {
      tag: { value: '1.0.0' },
    },
    ...overrides,
  };
}

function createCurrentContainerSpec(overrides = {}) {
  return {
    Name: '/drydock',
    Id: 'old-container-id',
    HostConfig: {
      Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
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
    currentContainerSpec: createCurrentContainerSpec(),
    newContainer,
    helperContainer,
    ...overrides,
  };
}

function createExecutor(overrides = {}) {
  return new SelfUpdateExecutor({
    getConfiguration: () => ({ dryrun: false }),
    findDockerSocketBind: vi.fn(() => '/var/run/docker.sock'),
    insertContainerImageBackup: vi.fn(),
    pullImage: vi.fn().mockResolvedValue(undefined),
    getCloneRuntimeConfigOptions: vi.fn().mockResolvedValue({ runtime: true }),
    cloneContainer: vi.fn(() => ({ cloned: true })),
    createContainer: vi.fn(),
    ...overrides,
  });
}

describe('SelfUpdateExecutor', () => {
  test('constructor provides default configuration fallback', () => {
    const executor = new SelfUpdateExecutor({});
    expect(executor.getConfiguration()).toEqual({});
  });

  test('returns false in dry-run mode', async () => {
    const executor = createExecutor({ getConfiguration: () => ({ dryrun: true }) });
    const context = createContext();
    const log = { info: vi.fn(), warn: vi.fn() };

    await expect(executor.execute(context, createContainer(), log)).resolves.toBe(false);
    expect(log.info).toHaveBeenCalledWith(
      'Do not replace the existing container because dry-run mode is enabled',
    );
  });

  test('throws when docker socket bind is missing', async () => {
    const executor = createExecutor({
      findDockerSocketBind: vi.fn(() => undefined),
    });

    await expect(
      executor.execute(createContext(), createContainer(), { info: vi.fn(), warn: vi.fn() }),
    ).rejects.toThrow('Self-update requires the Docker socket to be bind-mounted');
  });

  test('rolls back rename when creating new container fails', async () => {
    const context = createContext();
    const createContainerFn = vi.fn().mockRejectedValue(new Error('create failed'));
    const executor = createExecutor({
      createContainer: createContainerFn,
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await expect(executor.execute(context, createContainer(), log)).rejects.toThrow(
      'create failed',
    );

    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(1, {
      name: expect.stringMatching(/^drydock-old-/),
    });
    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'drydock' });
    expect(log.warn).toHaveBeenCalledWith(
      'Failed to create new container, rolling back rename: create failed',
    );
  });

  test('rolls back when inspecting the new container fails', async () => {
    const context = createContext();
    context.newContainer.inspect.mockRejectedValue(new Error('inspect failed'));
    const createContainerFn = vi.fn().mockResolvedValue(context.newContainer);
    const executor = createExecutor({
      createContainer: createContainerFn,
    });

    await expect(
      executor.execute(context, createContainer(), { info: vi.fn(), warn: vi.fn() }),
    ).rejects.toThrow('inspect failed');

    expect(context.newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'drydock' });
  });

  test('rolls back when helper container spawn fails', async () => {
    const context = createContext({
      dockerApi: {
        createContainer: vi.fn().mockRejectedValue(new Error('helper failed')),
      },
    });
    const createContainerFn = vi.fn().mockResolvedValue(context.newContainer);
    const executor = createExecutor({
      createContainer: createContainerFn,
    });

    await expect(
      executor.execute(context, createContainer(), { info: vi.fn(), warn: vi.fn() }),
    ).rejects.toThrow('helper failed');

    expect(context.newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'drydock' });
  });

  test('creates helper container and starts it on success', async () => {
    const context = createContext();
    const createContainerFn = vi.fn().mockResolvedValue(context.newContainer);
    const pullImage = vi.fn().mockResolvedValue(undefined);
    const insertContainerImageBackup = vi.fn();
    const getCloneRuntimeConfigOptions = vi.fn().mockResolvedValue({ runtime: true });
    const executor = createExecutor({
      createContainer: createContainerFn,
      pullImage,
      insertContainerImageBackup,
      getCloneRuntimeConfigOptions,
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await expect(executor.execute(context, createContainer(), log, 'op-123')).resolves.toBe(true);

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
    expect(context.helperContainer.start).toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      'Helper container started — process will terminate when old container stops',
    );
  });

  test('generates operation id when none is provided', async () => {
    const context = createContext();
    const createContainerFn = vi.fn().mockResolvedValue(context.newContainer);
    const executor = createExecutor({
      createContainer: createContainerFn,
    });

    await executor.execute(context, createContainer(), { info: vi.fn(), warn: vi.fn() });

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
});
