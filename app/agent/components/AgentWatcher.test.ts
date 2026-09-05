import { beforeEach, describe, expect, test } from 'vitest';
import * as manager from '../manager.js';
import AgentWatcher from './AgentWatcher.js';

const controllerMocks = vi.hoisted(() => {
  const dockerApi = { transport: 'loopback-dockerode' };
  const dockerDelegate = {
    dockerApi: undefined as unknown,
    initWatcher: vi.fn(),
    recreateDockerClient: vi.fn(),
    register: vi.fn(async function (this: { initWatcher: () => Promise<void> }) {
      await this.initWatcher();
      return this;
    }),
    watch: vi.fn().mockResolvedValue([{ container: { id: 'c1' }, changed: true }]),
    watchContainer: vi.fn().mockResolvedValue({ container: { id: 'c1' }, changed: true }),
    deregister: vi.fn().mockResolvedValue(undefined),
  };
  return {
    dockerApi,
    dockerDelegate,
    // biome-ignore lint/complexity/useArrowFunction: constructor mock must remain constructable.
    Docker: vi.fn(function () {
      return dockerDelegate;
    }),
    // biome-ignore lint/complexity/useArrowFunction: constructor mock must remain constructable.
    Dockerode: vi.fn(function () {
      return dockerApi;
    }),
    bridge: {
      start: vi.fn().mockResolvedValue({
        baseUrl: 'http://127.0.0.1:43210',
        host: '127.0.0.1',
        port: 43210,
        authorization: 'Bearer local-secret',
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    },
    Bridge: vi.fn(),
  };
});

// biome-ignore lint/complexity/useArrowFunction: constructor mock must remain constructable.
controllerMocks.Bridge.mockImplementation(function () {
  return controllerMocks.bridge;
});

vi.mock('../../watchers/providers/docker/Docker.js', () => ({
  default: controllerMocks.Docker,
}));

vi.mock('dockerode', () => ({
  default: controllerMocks.Dockerode,
}));

vi.mock('../PortwingDockerBridge.js', () => ({
  PortwingDockerBridge: controllerMocks.Bridge,
}));

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../manager.js', () => ({
  getAgent: vi.fn(),
}));

describe('AgentWatcher', () => {
  let watcher;

  beforeEach(() => {
    vi.clearAllMocks();
    controllerMocks.dockerDelegate.dockerApi = undefined;
    controllerMocks.dockerDelegate.register.mockImplementation(async function (this: {
      initWatcher: () => Promise<void>;
    }) {
      await this.initWatcher();
      return this;
    });
    controllerMocks.dockerDelegate.watch.mockResolvedValue([
      { container: { id: 'c1' }, changed: true },
    ]);
    controllerMocks.dockerDelegate.watchContainer.mockResolvedValue({
      container: { id: 'c1' },
      changed: true,
    });
    controllerMocks.bridge.start.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:43210',
      host: '127.0.0.1',
      port: 43210,
      authorization: 'Bearer local-secret',
    });
    watcher = new AgentWatcher();
    watcher.type = 'docker';
    watcher.name = 'local';
  });

  describe('watch', () => {
    test('should throw when no agent is assigned', async () => {
      watcher.agent = undefined;
      await expect(watcher.watch()).rejects.toThrow('AgentWatcher must have an agent assigned');
    });

    test('should throw when agent is not found', async () => {
      watcher.agent = 'remote-agent';
      manager.getAgent.mockReturnValue(undefined);
      await expect(watcher.watch()).rejects.toThrow('Agent remote-agent not found');
    });

    test('should delegate to client.watch', async () => {
      watcher.agent = 'remote-agent';
      const mockClient = { watch: vi.fn().mockResolvedValue([{ container: {} }]) };
      manager.getAgent.mockReturnValue(mockClient);
      const result = await watcher.watch();
      expect(mockClient.watch).toHaveBeenCalledWith('docker', 'local');
      expect(result).toEqual([{ container: {} }]);
    });
  });

  describe('watchContainer', () => {
    test('should throw when no agent is assigned', async () => {
      watcher.agent = undefined;
      await expect(watcher.watchContainer({ id: 'c1' })).rejects.toThrow(
        'AgentWatcher must have an agent assigned',
      );
    });

    test('should throw when agent is not found', async () => {
      watcher.agent = 'remote-agent';
      manager.getAgent.mockReturnValue(undefined);
      await expect(watcher.watchContainer({ id: 'c1' })).rejects.toThrow(
        'Agent remote-agent not found',
      );
    });

    test('should delegate to client.watchContainer', async () => {
      watcher.agent = 'remote-agent';
      const mockClient = {
        watchContainer: vi.fn().mockResolvedValue({ container: { id: 'c1' } }),
      };
      manager.getAgent.mockReturnValue(mockClient);
      const container = { id: 'c1' };
      const result = await watcher.watchContainer(container);
      expect(mockClient.watchContainer).toHaveBeenCalledWith('docker', 'local', container);
      expect(result).toEqual({ container: { id: 'c1' } });
    });
  });

  describe('isMaintenanceWindowOpen', () => {
    test('delegates to the controller watcher when controller Docker transport is active', async () => {
      manager.getAgent.mockReturnValue({ requestDockerApi: vi.fn(), watch: vi.fn() });
      controllerMocks.dockerDelegate.isMaintenanceWindowOpen = vi.fn().mockReturnValue(false);

      await watcher.register(
        'watcher',
        'docker',
        'docker',
        { transport: 'docker-api', execution: 'controller', events: 'portwing' },
        'remote-agent',
      );

      expect(watcher.isMaintenanceWindowOpen()).toBe(false);
      expect(controllerMocks.dockerDelegate.isMaintenanceWindowOpen).toHaveBeenCalledOnce();

      await watcher.deregister();
    });

    test('returns the freshest agent-reported window state from the watcher snapshot cache', () => {
      watcher.agent = 'remote-agent';
      manager.getAgent.mockReturnValue({
        getWatcherSnapshot: vi.fn().mockReturnValue({
          type: 'docker',
          name: 'local',
          configuration: { maintenancewindowopen: false },
        }),
      });

      expect(watcher.isMaintenanceWindowOpen()).toBe(false);
    });

    test('falls back to the handshake-time configuration when no snapshot has arrived yet', () => {
      watcher.agent = 'remote-agent';
      watcher.configuration = { maintenancewindowopen: false };
      manager.getAgent.mockReturnValue({
        getWatcherSnapshot: vi.fn().mockReturnValue(undefined),
      });

      expect(watcher.isMaintenanceWindowOpen()).toBe(false);
    });

    test('fails open when the agent reports no maintenancewindowopen field at all (older agent)', () => {
      watcher.agent = 'remote-agent';
      watcher.configuration = { maintenancewindow: '0 2 * * *' };
      manager.getAgent.mockReturnValue({
        getWatcherSnapshot: vi.fn().mockReturnValue(undefined),
      });

      expect(watcher.isMaintenanceWindowOpen()).toBe(true);
    });

    test('fails open when the agent is not found', () => {
      watcher.agent = 'remote-agent';
      manager.getAgent.mockReturnValue(undefined);

      expect(watcher.isMaintenanceWindowOpen()).toBe(true);
    });

    test('fails open when the watcher has no agent assigned', () => {
      watcher.agent = undefined;

      expect(watcher.isMaintenanceWindowOpen()).toBe(true);
    });
  });

  describe('getConfigurationSchema', () => {
    test('should return a schema that allows unknown keys', () => {
      const schema = watcher.getConfigurationSchema();
      const result = schema.validate({ foo: 'bar', baz: 123 });
      expect(result.error).toBeUndefined();
    });
  });

  test.each([
    [
      'non-Docker provider',
      'podman',
      { transport: 'docker-api', execution: 'controller', events: 'portwing' },
    ],
    [
      'legacy Docker transport',
      'docker',
      { transport: 'agent', execution: 'controller', events: 'portwing' },
    ],
    [
      'agent-side Docker execution',
      'docker',
      { transport: 'docker-api', execution: 'agent', events: 'portwing' },
    ],
    [
      'legacy Docker events',
      'docker',
      { transport: 'docker-api', execution: 'controller', events: 'docker' },
    ],
  ])('keeps %s in remote delegation mode', async (_label, type, configuration) => {
    watcher.type = type;
    manager.getAgent.mockReturnValue({ watch: vi.fn(), watchContainer: vi.fn() });

    await watcher.register('watcher', type, 'local', configuration, 'remote-agent');

    expect(controllerMocks.Bridge).not.toHaveBeenCalled();
    await watcher.deregister();
  });

  test('stops the bridge when controller watcher registration fails', async () => {
    manager.getAgent.mockReturnValue({ requestDockerApi: vi.fn() });
    controllerMocks.dockerDelegate.register.mockRejectedValueOnce(
      new Error('controller watcher registration failed'),
    );

    await expect(
      watcher.register(
        'watcher',
        'docker',
        'docker',
        { transport: 'docker-api', execution: 'controller', events: 'portwing' },
        'remote-agent',
      ),
    ).rejects.toThrow('controller watcher registration failed');

    expect(controllerMocks.bridge.stop).toHaveBeenCalledOnce();
  });

  test('controller Docker transport uses the native watcher over an authenticated bridge and cleans it up', async () => {
    const client = { requestDockerApi: vi.fn(), watch: vi.fn(), watchContainer: vi.fn() };
    manager.getAgent.mockReturnValue(client);

    await watcher.register(
      'watcher',
      'docker',
      'docker',
      { transport: 'docker-api', execution: 'controller', events: 'portwing' },
      'remote-agent',
    );

    expect(controllerMocks.Bridge).toHaveBeenCalledWith(client);
    expect(controllerMocks.Dockerode).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 43210,
        protocol: 'http',
        headers: { Authorization: 'Bearer local-secret' },
      }),
    );
    expect(controllerMocks.dockerDelegate.register).toHaveBeenCalledWith(
      'watcher',
      'docker',
      'docker',
      expect.objectContaining({ watchevents: false }),
      'remote-agent',
    );
    expect(watcher.dockerApi).toBe(controllerMocks.dockerApi);

    expect(await watcher.watch()).toEqual([{ container: { id: 'c1' }, changed: true }]);
    await expect(watcher.watchContainer({ id: 'c1' }, { emitBatchEvent: true })).resolves.toEqual({
      container: { id: 'c1' },
      changed: true,
    });
    expect(controllerMocks.dockerDelegate.watchContainer).toHaveBeenCalledWith(
      { id: 'c1' },
      { emitBatchEvent: true },
    );
    expect(client.watch).not.toHaveBeenCalled();

    await watcher.deregister();
    expect(controllerMocks.dockerDelegate.deregister).toHaveBeenCalledOnce();
    expect(controllerMocks.bridge.stop).toHaveBeenCalledOnce();
  });
});
