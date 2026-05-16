import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import {
  executeSelfUpdateTransition,
  findDockerSocketBind,
  resolveHelperDockerConnection,
} from './SelfUpdateTransitionShared.js';
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
    resolveFinalizeUrl: vi.fn(() => 'http://127.0.0.1:3000/api/v1/internal/self-update/finalize'),
    resolveFinalizeSecret: vi.fn(() => 'self-update-finalize-secret'),
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
          'DD_SELF_UPDATE_FINALIZE_URL=http://127.0.0.1:3000/api/v1/internal/self-update/finalize',
          'DD_SELF_UPDATE_FINALIZE_SECRET=self-update-finalize-secret',
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

  test('rolls back when new container inspect fails', async () => {
    const context = createContext();
    context.newContainer.inspect.mockRejectedValue(new Error('inspect failed'));
    const dependencies = createDependencies({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await expect(
      executeSelfUpdateTransition(dependencies, context, createContainer(), log),
    ).rejects.toThrow('inspect failed');

    expect(context.newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'drydock' });
    expect(log.warn).toHaveBeenCalledWith(
      'Failed to inspect new container, rolling back: inspect failed',
    );
  });

  test('rolls back when new container inspect fails and remove also fails', async () => {
    const context = createContext();
    context.newContainer.inspect.mockRejectedValue(new Error('inspect failed'));
    context.newContainer.remove.mockRejectedValue(new Error('remove also failed'));
    const dependencies = createDependencies({
      createContainer: vi.fn().mockResolvedValue(context.newContainer),
    });
    const log = { info: vi.fn(), warn: vi.fn() };

    await expect(
      executeSelfUpdateTransition(dependencies, context, createContainer(), log),
    ).rejects.toThrow('inspect failed');

    expect(context.currentContainer.rename).toHaveBeenNthCalledWith(2, { name: 'drydock' });
  });
});

describe('resolveHelperDockerConnection', () => {
  function makeDeps(socketPath?: string) {
    return {
      findDockerSocketBind: vi.fn().mockReturnValue(socketPath),
    };
  }

  test('returns tcp mode when modem.host is a non-empty string and no socket bind is present', () => {
    const deps = makeDeps();
    const result = resolveHelperDockerConnection(
      deps,
      { createContainer: vi.fn(), modem: { host: 'docker-host', port: 2376, protocol: 'https' } },
      undefined,
    );
    expect(result).toEqual({ mode: 'tcp', host: 'docker-host', port: 2376, protocol: 'https' });
    // findDockerSocketBind is called first (socket-first precedence); it returns undefined
    // here, so the code falls through to TCP.
    expect(deps.findDockerSocketBind).toHaveBeenCalledWith(undefined);
  });

  test('infrastructure-update guard: socket bind takes precedence over modem.host', () => {
    // When the target container has the Docker socket bind-mounted AND the watcher also
    // has a TCP modem.host (e.g. Drydock talks to sockguard over TCP), the helper must
    // use the direct socket path — not the TCP connection that runs through the proxy
    // being replaced. This is the infrastructure update mode invariant.
    const deps = makeDeps('/var/run/docker.sock');
    const spec = createCurrentContainerSpec();
    const result = resolveHelperDockerConnection(
      deps,
      { createContainer: vi.fn(), modem: { host: 'sockguard-host', port: 2375, protocol: 'http' } },
      spec,
    );
    expect(result).toEqual({ mode: 'socket', socketPath: '/var/run/docker.sock' });
    expect(deps.findDockerSocketBind).toHaveBeenCalledWith(spec);
  });

  test('defaults port to 2375 and protocol to http when not provided', () => {
    const deps = makeDeps();
    const result = resolveHelperDockerConnection(
      deps,
      { createContainer: vi.fn(), modem: { host: 'docker-host' } },
      undefined,
    );
    expect(result).toEqual({ mode: 'tcp', host: 'docker-host', port: 2375, protocol: 'http' });
  });

  test('defaults port to 2375 when port is 0', () => {
    const deps = makeDeps();
    const result = resolveHelperDockerConnection(
      deps,
      { createContainer: vi.fn(), modem: { host: 'docker-host', port: 0 } },
      undefined,
    );
    expect(result).toEqual({ mode: 'tcp', host: 'docker-host', port: 2375, protocol: 'http' });
  });

  test('returns socket mode when modem.host is absent and socket bind is found', () => {
    const deps = makeDeps('/var/run/docker.sock');
    const spec = createCurrentContainerSpec();
    const result = resolveHelperDockerConnection(deps, { createContainer: vi.fn() }, spec);
    expect(result).toEqual({ mode: 'socket', socketPath: '/var/run/docker.sock' });
    expect(deps.findDockerSocketBind).toHaveBeenCalledWith(spec);
  });

  test('returns socket mode when modem.host is an empty string', () => {
    const deps = makeDeps('/var/run/docker.sock');
    const result = resolveHelperDockerConnection(
      deps,
      { createContainer: vi.fn(), modem: { host: '' } },
      createCurrentContainerSpec(),
    );
    expect(result).toEqual({ mode: 'socket', socketPath: '/var/run/docker.sock' });
  });

  test('throws when no modem.host and no socket bind found', () => {
    const deps = makeDeps(undefined);
    expect(() =>
      resolveHelperDockerConnection(deps, { createContainer: vi.fn() }, undefined),
    ).toThrow(
      'Self-update requires the Docker socket to be bind-mounted (e.g. /var/run/docker.sock:/var/run/docker.sock), or the watcher must be configured with a TCP Docker host',
    );
  });
});

describe('executeSelfUpdateTransition TCP mode', () => {
  function createTcpContext(networkMode?: string) {
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
      modem: { host: 'docker-proxy', port: 2375, protocol: 'http' },
    };
    const spec: Record<string, unknown> = {
      Name: '/drydock',
      Id: 'old-container-id',
    };
    if (networkMode !== undefined) {
      spec.HostConfig = { NetworkMode: networkMode };
    }
    return {
      dockerApi,
      auth: { username: 'bot', password: 'token' },
      newImage: 'ghcr.io/acme/drydock:2.0.0',
      currentContainer,
      currentContainerSpec: spec,
      newContainer,
      helperContainer,
    };
  }

  function createTcpDependencies() {
    return {
      getConfiguration: () => ({ dryrun: false }),
      findDockerSocketBind: vi.fn().mockReturnValue(undefined),
      insertContainerImageBackup: vi.fn(),
      pullImage: vi.fn().mockResolvedValue(undefined),
      getCloneRuntimeConfigOptions: vi.fn().mockResolvedValue({ runtime: true }),
      cloneContainer: vi.fn(() => ({ cloned: true })),
      createContainer: vi.fn(),
      createOperationId: vi.fn(() => 'tcp-op-id'),
      resolveFinalizeUrl: vi.fn(() => 'http://127.0.0.1:3000/api/v1/internal/self-update/finalize'),
      resolveFinalizeSecret: vi.fn(() => 'tcp-secret'),
    };
  }

  test('tcp mode: helper HostConfig has no Binds and includes TCP env vars', async () => {
    const context = createTcpContext('host');
    const deps = createTcpDependencies();
    deps.createContainer = vi.fn().mockResolvedValue(context.newContainer);
    const log = { info: vi.fn(), warn: vi.fn() };

    await executeSelfUpdateTransition(deps, context as never, { name: 'drydock', image: {} }, log);

    expect(context.dockerApi.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: expect.arrayContaining([
          'DD_SELF_UPDATE_DOCKER_HOST=docker-proxy',
          'DD_SELF_UPDATE_DOCKER_PORT=2375',
          'DD_SELF_UPDATE_DOCKER_PROTOCOL=http',
        ]),
        HostConfig: {
          AutoRemove: true,
          NetworkMode: 'host',
        },
      }),
    );
    const call = context.dockerApi.createContainer.mock.calls[0][0];
    expect(call.HostConfig.Binds).toBeUndefined();
  });

  test('tcp mode: helper HostConfig has no NetworkMode when spec has none', async () => {
    const context = createTcpContext(undefined);
    const deps = createTcpDependencies();
    deps.createContainer = vi.fn().mockResolvedValue(context.newContainer);
    const log = { info: vi.fn(), warn: vi.fn() };

    await executeSelfUpdateTransition(deps, context as never, { name: 'drydock', image: {} }, log);

    const call = context.dockerApi.createContainer.mock.calls[0][0];
    expect(call.HostConfig).toEqual({ AutoRemove: true });
    expect(call.HostConfig.NetworkMode).toBeUndefined();
    expect(call.HostConfig.Binds).toBeUndefined();
  });

  test('tcp mode: helper HostConfig has no NetworkMode when NetworkMode is empty string', async () => {
    const context = createTcpContext('');
    const deps = createTcpDependencies();
    deps.createContainer = vi.fn().mockResolvedValue(context.newContainer);
    const log = { info: vi.fn(), warn: vi.fn() };

    await executeSelfUpdateTransition(deps, context as never, { name: 'drydock', image: {} }, log);

    const call = context.dockerApi.createContainer.mock.calls[0][0];
    expect(call.HostConfig).toEqual({ AutoRemove: true });
    expect(call.HostConfig.NetworkMode).toBeUndefined();
  });
});
