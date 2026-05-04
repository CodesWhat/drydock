import joi from 'joi';
import log from '../../../log/index.js';
import {
  configurationValid,
  createMockLog,
  docker,
  getDockerTestMocks,
  registerCommonDockerBeforeEach,
} from './Docker.test.helpers.js';

const { mockGetState } = getDockerTestMocks();
const { mockGetTrivyDatabaseStatus, mockGetSchedulerScanIntervalMs } = getDockerTestMocks();

registerCommonDockerBeforeEach();

// --- Configuration validation ---

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = docker.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {
    url: 'git://xxx.com',
  };
  expect(() => {
    docker.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

// --- getWatcher ---

test('getWatcher should return watcher responsible for a container', async () => {
  expect(
    docker
      .getWatcher({
        watcher: 'test',
      })
      .getId(),
  ).toEqual('docker.test');
});

test('getWatcher should throw when the watcher reference does not exist', async () => {
  expect(() =>
    docker.getWatcher({
      id: 'missing-id',
      watcher: 'missing',
    }),
  ).toThrowError('No watcher found for container');
});

test('getWatcher should resolve agent-prefixed watcher ids', async () => {
  mockGetState.mockReturnValue({
    watcher: {
      'edge-agent.docker.test': {
        getId: () => 'edge-agent.docker.test',
        dockerApi: {},
      },
    },
  });

  expect(
    docker.getWatcher({
      agent: 'edge-agent',
      watcher: 'test',
    }),
  ).toMatchObject({
    getId: expect.any(Function),
  });
  expect(docker.getWatcher({ agent: 'edge-agent', watcher: 'test' }).getId()).toBe(
    'edge-agent.docker.test',
  );
  expect(mockGetState).toHaveBeenCalled();
});

test('getWatcher should include container name when id is missing', async () => {
  mockGetState.mockReturnValue({ watcher: {} });

  expect(() =>
    docker.getWatcher({
      name: 'named-only',
      watcher: 'missing',
    }),
  ).toThrowError('No watcher found for container named-only (docker.missing)');
});

test('getWatcher should fall back to unknown when id and name are absent', async () => {
  mockGetState.mockReturnValue({ watcher: {} });

  expect(() => docker.getWatcher({ watcher: 'missing' })).toThrowError(
    'No watcher found for container unknown (docker.missing)',
  );
});

// --- getCurrentContainer ---

test('getCurrentContainer should return container from dockerApi', async () => {
  await expect(
    docker.getCurrentContainer(docker.getWatcher({ watcher: 'test' }).dockerApi, {
      id: '123456789',
    }),
  ).resolves.not.toBeUndefined();
});

test('getCurrentContainer should throw error when error occurs', async () => {
  await expect(
    docker.getCurrentContainer(docker.getWatcher({ watcher: 'test' }).dockerApi, { id: 'unknown' }),
  ).rejects.toThrowError('Error when getting container');
});

// --- inspectContainer ---

test('inspectContainer should return container details from dockerApi', async () => {
  await expect(
    docker.inspectContainer({ inspect: () => Promise.resolve({}) }, log),
  ).resolves.toEqual({});
});

test('inspectContainer should throw error when error occurs', async () => {
  await expect(
    docker.inspectContainer({ inspect: () => Promise.reject(new Error('No container')) }, log),
  ).rejects.toThrowError('No container');
});

// --- Container operations: stop, remove, wait, start (parametric) ---

describe.each([
  {
    method: 'stopContainer',
    action: 'stop',
    args: (stub) => [stub, 'name', 'id', log],
  },
  {
    method: 'removeContainer',
    action: 'remove',
    args: (stub) => [stub, 'name', 'id', log],
  },
  {
    method: 'waitContainerRemoved',
    action: 'wait',
    args: (stub) => [stub, 'name', 'id', log],
  },
  {
    method: 'startContainer',
    action: 'start',
    args: (stub) => [stub, 'name', log],
  },
])('$method', ({ method, action, args }) => {
  test('should resolve when successful', async () => {
    const stub = { [action]: () => Promise.resolve() };
    await expect(docker[method](...args(stub))).resolves.toBeUndefined();
  });

  test('should throw error when error occurs', async () => {
    const stub = { [action]: () => Promise.reject(new Error('No container')) };
    await expect(docker[method](...args(stub))).rejects.toThrowError('No container');
  });
});

// --- createContainer ---

test('createContainer should stop container from dockerApi', async () => {
  await expect(
    docker.createContainer(
      docker.getWatcher({ watcher: 'test' }).dockerApi,
      { name: 'container-name' },
      'name',
      log,
    ),
  ).resolves.not.toBeUndefined();
});

test('createContainer should throw error when error occurs', async () => {
  await expect(
    docker.createContainer(
      docker.getWatcher({ watcher: 'test' }).dockerApi,
      { name: 'ko' },
      'name',
      log,
    ),
  ).rejects.toThrowError('Error when creating container');
});

test('createContainer should stringify non-object errors in warning logs', async () => {
  const dockerApi = {
    createContainer: vi.fn().mockRejectedValue(Symbol('create failed')),
    getNetwork: vi.fn(),
  };
  const logContainer = createMockLog('info', 'warn');

  await expect(
    docker.createContainer(dockerApi as any, { name: 'ko' }, 'name', logContainer as any),
  ).rejects.toBeTypeOf('symbol');

  expect(logContainer.warn).toHaveBeenCalledWith(
    'Error when creating container name (Symbol(create failed))',
  );
});

test('createContainer should connect additional networks after create', async () => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const getNetwork = vi.fn().mockReturnValue({ connect });
  const createContainer = vi.fn().mockResolvedValue({
    start: () => Promise.resolve(),
  });
  const logContainer = createMockLog('info', 'warn');

  const containerToCreate = {
    name: 'container-name',
    HostConfig: {
      NetworkMode: 'cloud_default',
    },
    NetworkingConfig: {
      EndpointsConfig: {
        cloud_default: { Aliases: ['container-name'] },
        postgres_default: { Aliases: ['container-name'] },
        valkey_default: { Aliases: ['container-name'] },
      },
    },
  };

  await docker.createContainer(
    { createContainer, getNetwork },
    containerToCreate,
    'container-name',
    logContainer,
  );

  expect(createContainer).toHaveBeenCalledWith({
    name: 'container-name',
    HostConfig: {
      NetworkMode: 'cloud_default',
    },
    NetworkingConfig: {
      EndpointsConfig: {
        cloud_default: { Aliases: ['container-name'] },
      },
    },
  });
  expect(getNetwork).toHaveBeenCalledTimes(2);
  expect(getNetwork).toHaveBeenCalledWith('postgres_default');
  expect(getNetwork).toHaveBeenCalledWith('valkey_default');
  expect(connect).toHaveBeenCalledTimes(2);
  expect(connect).toHaveBeenCalledWith({
    Container: 'container-name',
    EndpointConfig: { Aliases: ['container-name'] },
  });
});

test('getSecurityGate should provide trivy database and scan interval callbacks', async () => {
  mockGetTrivyDatabaseStatus.mockResolvedValueOnce({
    updatedAt: '2026-04-01T00:00:00.000Z',
  });
  mockGetSchedulerScanIntervalMs.mockReturnValueOnce(123_456);
  (docker as any).securityGate = undefined;

  const gate = docker.getSecurityGate();

  await expect(gate.scanCache.getTrivyDbUpdatedAt?.()).resolves.toBe('2026-04-01T00:00:00.000Z');
  expect(gate.scanCache.getScanIntervalMs?.()).toBe(123_456);
});

test('getSecurityGate should tolerate missing trivy database status and prune image failures', async () => {
  mockGetTrivyDatabaseStatus.mockResolvedValueOnce(undefined);
  const remove = vi.fn().mockRejectedValue(new Error('remove failed'));
  const dockerApi = {
    getImage: vi.fn(() => ({ remove })),
  };
  (docker as any).securityGate = undefined;

  const gate = docker.getSecurityGate();

  await expect(gate.scanCache.getTrivyDbUpdatedAt?.()).resolves.toBeUndefined();
  await expect(gate.scanCache.pruneImage?.('ghcr.io/acme/web:2.0.0', dockerApi)).resolves.toBe(
    undefined,
  );
  expect(dockerApi.getImage).toHaveBeenCalledWith('ghcr.io/acme/web:2.0.0');
  expect(remove).toHaveBeenCalled();
});

test('maybeScanAndGateUpdate should delegate to the security gate', async () => {
  (docker as any).securityGate = undefined;
  const gate = docker.getSecurityGate();
  const maybeScanAndGateUpdate = vi
    .spyOn(gate, 'maybeScanAndGateUpdate')
    .mockResolvedValue(undefined);
  const context = { newImage: 'ghcr.io/acme/web:2.0.0' };
  const container = { id: 'container-id', watcher: 'docker.local', name: 'web' };
  const logContainer = createMockLog('info', 'warn');

  await docker.maybeScanAndGateUpdate(context, container, logContainer);

  expect(maybeScanAndGateUpdate).toHaveBeenCalledWith(context, container, logContainer);
});

// --- pullImage ---

test('pull should pull image from dockerApi', async () => {
  await expect(
    docker.pullImage(
      docker.getWatcher({ watcher: 'test' }).dockerApi,
      undefined,
      'test/test:1.2.3',
      log,
    ),
  ).resolves.toBeUndefined();
});

test('pull should throw error when error occurs', async () => {
  await expect(
    docker.pullImage(
      docker.getWatcher({ watcher: 'test' }).dockerApi,
      undefined,
      'test/test:unknown',
      log,
    ),
  ).rejects.toThrowError('Error when pulling image');
});

test('pull should emit progress logs from followProgress events', async () => {
  const dockerApi = {
    pull: vi.fn().mockResolvedValue({}),
    modem: {
      followProgress: vi.fn((pullStream, done, onProgress) => {
        onProgress({
          id: 'layer-1',
          status: 'Downloading',
          progressDetail: { current: 50, total: 100 },
        });
        done(null, [{ id: 'layer-1', status: 'Download complete' }]);
      }),
    },
  };
  const logContainer = createMockLog('info', 'warn', 'debug');

  await docker.pullImage(dockerApi, undefined, 'test/test:1.2.3', logContainer);

  expect(logContainer.debug).toHaveBeenCalledWith(
    expect.stringContaining('Pull progress for test/test:1.2.3'),
  );
  expect(logContainer.info).toHaveBeenCalledWith('Image test/test:1.2.3 pulled with success');
});

test('pull should throw error when followProgress reports an error', async () => {
  const dockerApi = {
    pull: vi.fn().mockResolvedValue({}),
    modem: {
      followProgress: vi.fn((pullStream, done) => {
        done(new Error('Pull progress failed'));
      }),
    },
  };
  const logContainer = createMockLog('info', 'warn', 'debug');

  await expect(
    docker.pullImage(dockerApi, undefined, 'test/test:1.2.3', logContainer),
  ).rejects.toThrowError('Pull progress failed');
});

// --- removeImage ---

test('removeImage should pull image from dockerApi', async () => {
  await expect(
    docker.removeImage(docker.getWatcher({ watcher: 'test' }).dockerApi, 'test/test:1.2.3', log),
  ).resolves.toBeUndefined();
});

test('removeImage should throw error when error occurs', async () => {
  await expect(
    docker.removeImage(docker.getWatcher({ watcher: 'test' }).dockerApi, 'test/test:unknown', log),
  ).rejects.toThrowError('Error when removing image');
});

// --- cloneContainer ---

test('clone should clone an existing container spec', async () => {
  const clone = docker.cloneContainer(
    {
      Name: '/test',
      Id: '123456789',
      HostConfig: { a: 'a', b: 'b' },
      Config: { configA: 'a', configB: 'b' },
      NetworkSettings: {
        Networks: {
          test: { Aliases: ['9708fc7b44f2', 'test'] },
        },
      },
    },
    'test/test:2.0.0',
  );
  expect(clone).toEqual({
    HostConfig: { a: 'a', b: 'b' },
    Image: 'test/test:2.0.0',
    configA: 'a',
    configB: 'b',
    name: 'test',
    NetworkingConfig: {
      EndpointsConfig: {
        test: { Aliases: ['9708fc7b44f2', 'test'] },
      },
    },
  });
});

test('clone should remove dynamic network endpoint fields and stale aliases', async () => {
  const clone = docker.cloneContainer(
    {
      Name: '/test',
      Id: '123456789abcdef',
      HostConfig: { NetworkMode: 'cloud_default' },
      Config: { configA: 'a' },
      NetworkSettings: {
        Networks: {
          cloud_default: {
            Aliases: ['123456789abc', 'nextcloud'],
            NetworkID: 'network-id',
            EndpointID: 'endpoint-id',
            Gateway: '172.18.0.1',
            IPAddress: '172.18.0.2',
            DriverOpts: { test: 'value' },
          },
        },
      },
    },
    'test/test:2.0.0',
  );

  expect(clone.NetworkingConfig.EndpointsConfig).toEqual({
    cloud_default: {
      Aliases: ['nextcloud'],
      DriverOpts: { test: 'value' },
    },
  });
});

test('cloneContainer should remove Hostname and ExposedPorts when NetworkMode starts with container:', () => {
  const clone = docker.cloneContainer(
    {
      Name: '/sidecar',
      Id: 'abc123',
      HostConfig: { NetworkMode: 'container:mainapp' },
      Config: {
        Hostname: 'sidecar-host',
        ExposedPorts: { '80/tcp': {} },
        configA: 'a',
      },
      NetworkSettings: { Networks: {} },
    },
    'test/test:2.0.0',
  );
  expect(clone.Hostname).toBeUndefined();
  expect(clone.ExposedPorts).toBeUndefined();
  expect(clone.HostConfig.NetworkMode).toBe('container:mainapp');
});

test('cloneContainer should handle missing NetworkSettings by using empty endpoint config', () => {
  const clone = docker.cloneContainer(
    {
      Name: '/no-network',
      Id: 'abc123',
      HostConfig: {},
      Config: { configA: 'a' },
    },
    'test/test:2.0.0',
  );

  expect(clone.NetworkingConfig).toEqual({ EndpointsConfig: {} });
});

test('cloneContainer should drop stale Entrypoint and Cmd inherited from source image defaults', () => {
  const logContainer = createMockLog('info');
  const clone = docker.cloneContainer(
    {
      Name: '/hub_nginx_120',
      Id: 'abc123',
      HostConfig: {},
      Config: {
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
      },
      NetworkSettings: { Networks: {} },
    },
    'nginx:1.10-alpine',
    {
      sourceImageConfig: {
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
      },
      targetImageConfig: {
        Entrypoint: null,
        Cmd: ['nginx'],
      },
      runtimeFieldOrigins: {
        Entrypoint: 'inherited',
        Cmd: 'inherited',
      },
      logContainer,
    },
  );

  expect(clone.Entrypoint).toBeUndefined();
  expect(clone.Cmd).toBeUndefined();
  expect(clone.Labels['dd.runtime.entrypoint.origin']).toBe('inherited');
  expect(clone.Labels['dd.runtime.cmd.origin']).toBe('inherited');
  expect(logContainer.info).toHaveBeenCalledWith(
    expect.stringContaining('Dropping stale Entrypoint'),
  );
  expect(logContainer.info).toHaveBeenCalledWith(expect.stringContaining('Dropping stale Cmd'));
});

test('cloneContainer should drop Cmd/Entrypoint when runtime origin is unknown but values match source image', () => {
  const logContainer = createMockLog('debug', 'info');
  const clone = docker.cloneContainer(
    {
      Name: '/hub_nginx_pinned',
      Id: 'abc123',
      HostConfig: {},
      Config: {
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
      },
      NetworkSettings: { Networks: {} },
    },
    'nginx:1.10-alpine',
    {
      sourceImageConfig: {
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
      },
      targetImageConfig: {
        Entrypoint: null,
        Cmd: ['nginx'],
      },
      runtimeFieldOrigins: {
        Entrypoint: 'unknown',
        Cmd: 'unknown',
      },
      logContainer,
    },
  );

  // UNKNOWN + matches source + source known → treat as inherited and drop
  expect(clone.Entrypoint).toBeUndefined();
  expect(clone.Cmd).toBeUndefined();
  expect(clone.Labels['dd.runtime.entrypoint.origin']).toBe('inherited');
  expect(clone.Labels['dd.runtime.cmd.origin']).toBe('inherited');
  expect(logContainer.debug).toHaveBeenCalledWith(
    expect.stringContaining('Treating Entrypoint as inherited'),
  );
});

test('cloneContainer should drop both Entrypoint (inherited) and Cmd (unknown+matching-source) when source is known', () => {
  const logContainer = createMockLog('info', 'debug');
  const clone = docker.cloneContainer(
    {
      Name: '/hub_nginx_cmd_pin',
      Id: 'abc123',
      HostConfig: {},
      Config: {
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
      },
      NetworkSettings: { Networks: {} },
    },
    'nginx:1.10-alpine',
    {
      sourceImageConfig: {
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
      },
      targetImageConfig: {
        Entrypoint: null,
        Cmd: ['nginx'],
      },
      runtimeFieldOrigins: {
        Entrypoint: 'inherited',
        Cmd: 'unknown',
      },
      logContainer,
    },
  );

  expect(clone.Entrypoint).toBeUndefined();
  expect(clone.Cmd).toBeUndefined();
  expect(clone.Labels['dd.runtime.entrypoint.origin']).toBe('inherited');
  expect(clone.Labels['dd.runtime.cmd.origin']).toBe('inherited');
  expect(logContainer.info).toHaveBeenCalledWith(
    expect.stringContaining('Dropping stale Entrypoint'),
  );
  expect(logContainer.info).toHaveBeenCalledWith(expect.stringContaining('Dropping stale Cmd'));
});

test('cloneContainer should drop both Entrypoint (unknown+matching-source) and Cmd (inherited) when source is known', () => {
  const logContainer = createMockLog('info', 'debug');
  const clone = docker.cloneContainer(
    {
      Name: '/hub_nginx_entrypoint_pin',
      Id: 'abc123',
      HostConfig: {},
      Config: {
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
      },
      NetworkSettings: { Networks: {} },
    },
    'nginx:1.10-alpine',
    {
      sourceImageConfig: {
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
      },
      targetImageConfig: {
        Entrypoint: null,
        Cmd: ['nginx'],
      },
      runtimeFieldOrigins: {
        Entrypoint: 'unknown',
        Cmd: 'inherited',
      },
      logContainer,
    },
  );

  expect(clone.Entrypoint).toBeUndefined();
  expect(clone.Cmd).toBeUndefined();
  expect(clone.Labels['dd.runtime.entrypoint.origin']).toBe('inherited');
  expect(clone.Labels['dd.runtime.cmd.origin']).toBe('inherited');
  expect(logContainer.info).toHaveBeenCalledWith(
    expect.stringContaining('Dropping stale Entrypoint'),
  );
  expect(logContainer.info).toHaveBeenCalledWith(expect.stringContaining('Dropping stale Cmd'));
});

test('cloneContainer should preserve explicit Entrypoint/Cmd overrides', () => {
  const clone = docker.cloneContainer(
    {
      Name: '/hub_nginx_custom',
      Id: 'abc123',
      HostConfig: {},
      Config: {
        Entrypoint: ['/custom-entrypoint.sh'],
        Cmd: ['echo', 'healthy'],
      },
      NetworkSettings: { Networks: {} },
    },
    'nginx:1.10-alpine',
    {
      sourceImageConfig: {
        Entrypoint: ['/docker-entrypoint.sh'],
        Cmd: ['nginx', '-g', 'daemon off;'],
      },
      targetImageConfig: {
        Entrypoint: null,
        Cmd: ['nginx'],
      },
    },
  );

  expect(clone.Entrypoint).toEqual(['/custom-entrypoint.sh']);
  expect(clone.Cmd).toEqual(['echo', 'healthy']);
});
