import {
  createTriggerContainer,
  docker,
  getDockerTestMocks,
  registerCommonDockerBeforeEach,
  stubTriggerFlow,
} from './Docker.test.helpers.js';
import { resolveSelfContainerIdentity } from './SelfContainerIdentity.js';

registerCommonDockerBeforeEach();

function createDrydockCandidate() {
  return createTriggerContainer({
    id: 'peer-container-id',
    name: 'drydock-peer',
    image: {
      name: 'codeswhat/drydock',
      registry: { name: 'hub', url: 'my-registry' },
      tag: { value: '1.0.0' },
    },
  });
}

function createInspectingDockerApi(inspections: Record<string, unknown>) {
  return {
    listContainers: vi
      .fn()
      .mockResolvedValue(Object.keys(inspections).map((id) => ({ Id: id, Names: [`/${id}`] }))),
    getContainer: vi.fn((id) => ({
      inspect: vi.fn().mockResolvedValue(inspections[id]),
    })),
  };
}

describe('Drydock self identity safety boundary', () => {
  const { mockGetState } = getDockerTestMocks();
  const originalResolver = docker.selfUpdateOrchestrator.resolveSelfContainerIdentity;

  beforeEach(() => {
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = (dockerApi) =>
      resolveSelfContainerIdentity(dockerApi as never, 'current-host');
  });

  afterEach(() => {
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = originalResolver;
    vi.restoreAllMocks();
  });

  test.each([
    [
      'container listing fails',
      () => ({
        listContainers: vi.fn().mockRejectedValue(new Error('list unavailable')),
        getContainer: vi.fn(),
      }),
    ],
    [
      'container inspection fails',
      () => {
        const selfInspect = {
          Id: 'self-container-id',
          Name: '/drydock-current',
          Config: { Hostname: 'current-host' },
        };
        return {
          listContainers: vi
            .fn()
            .mockResolvedValue([{ Id: 'self-container-id' }, { Id: 'broken-container-id' }]),
          getContainer: vi.fn((id) => ({
            inspect:
              id === 'self-container-id'
                ? vi.fn().mockResolvedValue(selfInspect)
                : vi.fn().mockRejectedValue(new Error('inspect unavailable')),
          })),
        };
      },
    ],
    [
      'container identity evidence is malformed',
      () =>
        createInspectingDockerApi({
          'self-container-id': {
            Id: 'self-container-id',
            Name: '/drydock-current',
            Config: { Hostname: 'current-host' },
          },
          'malformed-container-id': { Id: 'malformed-container-id' },
        }),
    ],
    [
      'container identity evidence is ambiguous',
      () =>
        createInspectingDockerApi({
          'self-container-a': {
            Id: 'self-container-a',
            Name: '/drydock-a',
            Config: { Hostname: 'current-host' },
          },
          'self-container-b': {
            Id: 'self-container-b',
            Name: '/drydock-b',
            Config: { Hostname: 'current-host' },
          },
        }),
    ],
  ])('aborts before normal stop/recreate when %s', async (_description, createDockerApi) => {
    const dockerApi = createDockerApi();
    const state = mockGetState();
    const localWatcher = {
      dockerApi,
      configuration: { socket: '/var/run/docker.sock' },
    };
    mockGetState.mockReturnValue({
      ...state,
      watcher: { ...state.watcher, 'docker.local': localWatcher },
    });
    stubTriggerFlow({ running: true });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(localWatcher as never);

    await expect(docker.trigger(createDrydockCandidate())).rejects.toThrow(
      'Drydock container identity is indeterminate',
    );

    expect(docker.stopContainer).not.toHaveBeenCalled();
    expect(docker.createContainer).not.toHaveBeenCalled();
  });

  test('allows the normal stop/recreate path for a proven peer Drydock container', async () => {
    const localDockerApi = createInspectingDockerApi({
      'current-container-id': {
        Id: 'current-container-id',
        Name: '/drydock-current',
        Config: { Hostname: 'current-host' },
      },
    });
    const remoteDockerApi = createInspectingDockerApi({
      'peer-container-id': {
        Id: 'peer-container-id',
        Name: '/drydock-peer',
        Config: { Hostname: 'peer-host' },
      },
    });
    const state = mockGetState();
    const remoteWatcher = {
      dockerApi: remoteDockerApi,
      configuration: { host: 'remote-daemon', port: 2375, protocol: 'http' },
    };
    mockGetState.mockReturnValue({
      ...state,
      watcher: {
        ...state.watcher,
        'docker.local': {
          dockerApi: localDockerApi,
          configuration: { socket: '/var/run/docker.sock' },
        },
        'docker.test': remoteWatcher,
      },
    });
    stubTriggerFlow({ running: true });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(remoteWatcher as never);

    await expect(docker.trigger(createDrydockCandidate())).resolves.toBeUndefined();

    expect(docker.stopContainer).toHaveBeenCalledOnce();
    expect(docker.createContainer).toHaveBeenCalledOnce();
  });

  test('proves a same-hostname container on a remote daemon is a peer', async () => {
    const localDockerApi = createInspectingDockerApi({
      'local-self-id': {
        Id: 'local-self-id',
        Name: '/drydock-local',
        Config: { Hostname: 'current-host' },
      },
    });
    const remoteDockerApi = createInspectingDockerApi({
      'peer-container-id': {
        Id: 'peer-container-id',
        Name: '/drydock-peer',
        Config: { Hostname: 'current-host' },
      },
    });
    const state = mockGetState();
    const remoteWatcher = {
      dockerApi: remoteDockerApi,
      configuration: { host: 'remote-daemon', port: 2375, protocol: 'http' },
    };
    mockGetState.mockReturnValue({
      ...state,
      watcher: {
        ...state.watcher,
        'docker.local': {
          dockerApi: localDockerApi,
          configuration: { socket: '/var/run/docker.sock' },
        },
      },
    });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(remoteWatcher as never);
    stubTriggerFlow({ running: true });

    await expect(docker.trigger(createDrydockCandidate())).resolves.toBeUndefined();

    expect(localDockerApi.listContainers).not.toHaveBeenCalled();
    expect(remoteDockerApi.listContainers).not.toHaveBeenCalled();
    expect(docker.stopContainer).toHaveBeenCalledOnce();
  });

  test('treats a remote-only same-hostname Drydock container as a peer', async () => {
    const remoteDockerApi = createInspectingDockerApi({
      'peer-container-id': {
        Id: 'peer-container-id',
        Name: '/drydock-peer',
        Config: { Hostname: 'current-host' },
      },
    });
    const state = mockGetState();
    const remoteWatcher = {
      dockerApi: remoteDockerApi,
      configuration: { host: 'remote-daemon', port: 2375, protocol: 'http' },
    };
    mockGetState.mockReturnValue({ ...state, watcher: { 'docker.test': remoteWatcher } });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(remoteWatcher as never);
    stubTriggerFlow({ running: true });

    await expect(docker.trigger(createDrydockCandidate())).resolves.toBeUndefined();

    expect(remoteDockerApi.listContainers).not.toHaveBeenCalled();
    expect(docker.stopContainer).toHaveBeenCalledOnce();
  });

  test('resolves observer network mode only from authoritative local runtime evidence', async () => {
    const localDockerApi = createInspectingDockerApi({});
    const state = mockGetState();
    mockGetState.mockReturnValue({
      ...state,
      watcher: {
        ...state.watcher,
        'docker.local': {
          dockerApi: localDockerApi,
          configuration: { socket: '/var/run/docker.sock' },
        },
      },
    });
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValueOnce({ id: 'local-self-id', name: 'drydock-local' });

    await expect(docker.selfUpdateOrchestrator.resolveObserverNetworkMode()).resolves.toBe(
      'container:local-self-id',
    );
    expect(docker.selfUpdateOrchestrator.resolveSelfContainerIdentity).toHaveBeenCalledWith(
      localDockerApi,
    );
  });

  test('rejects observer network mode without unambiguous local runtime evidence', async () => {
    const state = mockGetState();
    mockGetState.mockReturnValue({ ...state, watcher: {} });
    await expect(docker.resolveObserverNetworkMode()).rejects.toThrow(
      'authoritative local Docker watcher',
    );

    mockGetState.mockReturnValue({
      ...state,
      watcher: { 'docker.local': { dockerApi: createInspectingDockerApi({}) } },
    });
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi.fn().mockResolvedValue(null);
    await expect(docker.resolveObserverNetworkMode()).rejects.toThrow(
      'could not resolve the local Drydock container',
    );
  });
});
