import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import { executeSelfUpdateTransition, findDockerSocketBind } from './SelfUpdateTransitionShared.js';
import {
  SELF_UPDATE_HEALTH_TIMEOUT_MS,
  SELF_UPDATE_POLL_INTERVAL_MS,
  SELF_UPDATE_START_TIMEOUT_MS,
} from './self-update-timeouts.js';

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

function createDependencies(overrides = {}) {
  return {
    getConfiguration: () => ({ dryrun: false }),
    findDockerSocketBind,
    insertContainerImageBackup: vi.fn(),
    pullImage: vi.fn().mockResolvedValue(undefined),
    getCloneRuntimeConfigOptions: vi.fn().mockResolvedValue({ runtime: true }),
    cloneContainer: vi.fn(() => ({ cloned: true })),
    createContainer: vi.fn(),
    createOperationId: vi.fn(() => 'generated-operation-id'),
    ...overrides,
  };
}

describe('SelfUpdateTransitionShared', () => {
  test('SelfUpdateTransitionShared should avoid Record<string, any> contracts', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, './SelfUpdateTransitionShared.ts'),
      'utf8',
    );

    expect(source).not.toContain('Record<string, any>');
  });

  test('findDockerSocketBind returns the host socket path', () => {
    expect(
      findDockerSocketBind({
        HostConfig: {
          Binds: ['/tmp/socket.sock:/tmp/socket.sock', '/var/run/docker.sock:/var/run/docker.sock'],
        },
      }),
    ).toBe('/var/run/docker.sock');
    expect(findDockerSocketBind({ HostConfig: { Binds: [] } })).toBeUndefined();
    expect(findDockerSocketBind(undefined)).toBeUndefined();
  });

  test('rolls back rename when helper container creation fails', async () => {
    const context = createContext({
      dockerApi: {
        createContainer: vi.fn().mockRejectedValue(new Error('helper failed')),
      },
    });
    const dependencies = createDependencies({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await expect(
      executeSelfUpdateTransition(dependencies, context, createContainer(), log),
    ).rejects.toThrow('helper failed');

    expect(context.newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'drydock' });
    expect(log.warn).toHaveBeenCalledWith(
      'Failed to spawn helper container, rolling back: helper failed',
    );
  });

  test('getErrorMessage coerces non-Error thrown values to string', async () => {
    const context = createContext();
    const dependencies = createDependencies({
      createContainer: vi.fn().mockRejectedValue('connection refused'),
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await expect(
      executeSelfUpdateTransition(dependencies, context, createContainer(), log),
    ).rejects.toBe('connection refused');

    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'drydock' });
    expect(log.warn).toHaveBeenCalledWith(
      'Failed to create new container, rolling back rename: connection refused',
    );
  });

  test('uses dependency operation id factory when operation id is omitted', async () => {
    const context = createContext();
    const dependencies = createDependencies({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      createOperationId: vi.fn(() => 'generated-op-id'),
    });

    await expect(
      executeSelfUpdateTransition(dependencies, context, createContainer(), {
        info: vi.fn(),
        warn: vi.fn(),
      }),
    ).resolves.toBe(true);

    expect(context.dockerApi.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: expect.arrayContaining([
          'DD_SELF_UPDATE_OP_ID=generated-op-id',
          `DD_SELF_UPDATE_START_TIMEOUT_MS=${SELF_UPDATE_START_TIMEOUT_MS}`,
          `DD_SELF_UPDATE_HEALTH_TIMEOUT_MS=${SELF_UPDATE_HEALTH_TIMEOUT_MS}`,
          `DD_SELF_UPDATE_POLL_INTERVAL_MS=${SELF_UPDATE_POLL_INTERVAL_MS}`,
        ]),
      }),
    );
  });

  test('uses resolveHelperImage for helper container when provided', async () => {
    const context = createContext();
    const dependencies = createDependencies({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      resolveHelperImage: () => 'custom-drydock:3.0.0',
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await executeSelfUpdateTransition(dependencies, context, createContainer(), log);

    expect(context.dockerApi.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'custom-drydock:3.0.0',
      }),
    );
  });

  test('falls back to newImage when resolveHelperImage returns undefined', async () => {
    const context = createContext();
    const dependencies = createDependencies({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
      resolveHelperImage: () => undefined,
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await executeSelfUpdateTransition(dependencies, context, createContainer(), log);

    expect(context.dockerApi.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'ghcr.io/acme/drydock:2.0.0',
      }),
    );
  });

  test('falls back to newImage when resolveHelperImage is not provided', async () => {
    const context = createContext();
    const dependencies = createDependencies({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await executeSelfUpdateTransition(dependencies, context, createContainer(), log);

    expect(context.dockerApi.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'ghcr.io/acme/drydock:2.0.0',
      }),
    );
  });

  test('uses container name for temp rename prefix instead of hardcoded drydock', async () => {
    const context = createContext({
      currentContainerSpec: createCurrentContainerSpec({ Name: '/socket-proxy' }),
    });
    const dependencies = createDependencies({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await executeSelfUpdateTransition(dependencies, context, createContainer(), log);

    expect(context.currentContainer.rename).toHaveBeenCalledWith({
      name: expect.stringMatching(/^socket-proxy-old-\d+$/),
    });
  });
});
