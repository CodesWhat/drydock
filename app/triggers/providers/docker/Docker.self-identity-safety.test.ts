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

function createDirectWatcher(dockerApi: unknown, socket = '/var/run/docker.sock') {
  return {
    type: 'docker',
    dockerApi,
    configuration: { socket },
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

  test('identifies the current container through a direct watcher named prod', async () => {
    const localDockerApi = createInspectingDockerApi({});
    const state = mockGetState();
    const prodWatcher = createDirectWatcher(localDockerApi);
    mockGetState.mockReturnValue({
      ...state,
      watcher: { 'docker.prod': prodWatcher },
    });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(prodWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'peer-container-id', name: 'drydock-peer' });

    await expect(docker.classifySelfUpdate(createDrydockCandidate())).resolves.toBe('current');
    expect(docker.selfUpdateOrchestrator.resolveSelfContainerIdentity).toHaveBeenCalledWith(
      localDockerApi,
    );
  });

  test('identifies the exact drydock image through a direct watcher', async () => {
    const localDockerApi = createInspectingDockerApi({});
    const state = mockGetState();
    const prodWatcher = createDirectWatcher(localDockerApi);
    mockGetState.mockReturnValue({ ...state, watcher: { 'docker.prod': prodWatcher } });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(prodWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'peer-container-id', name: 'drydock-peer' });

    await expect(
      docker.classifySelfUpdate(
        createTriggerContainer({
          id: 'peer-container-id',
          name: 'drydock-peer',
          watcher: 'prod',
          image: { name: 'drydock' },
        }),
      ),
    ).resolves.toBe('current');
  });

  test('ignores a remote docker.local alias when prod proves the current container', async () => {
    const localDockerApi = createInspectingDockerApi({});
    const remoteDockerApi = createInspectingDockerApi({});
    const state = mockGetState();
    const prodWatcher = createDirectWatcher(localDockerApi);
    mockGetState.mockReturnValue({
      ...state,
      watcher: {
        'docker.local': {
          type: 'docker',
          dockerApi: remoteDockerApi,
          configuration: { host: 'remote-daemon', port: 2375, protocol: 'http' },
        },
        'docker.prod': prodWatcher,
      },
    });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(prodWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'peer-container-id', name: 'drydock-peer' });

    await expect(docker.classifySelfUpdate(createDrydockCandidate())).resolves.toBe('current');
    expect(docker.selfUpdateOrchestrator.resolveSelfContainerIdentity).toHaveBeenCalledWith(
      localDockerApi,
    );
    expect(docker.selfUpdateOrchestrator.resolveSelfContainerIdentity).not.toHaveBeenCalledWith(
      remoteDockerApi,
    );
  });

  test('deduplicates same-daemon direct watcher aliases', async () => {
    const localDockerApi = createInspectingDockerApi({});
    const state = mockGetState();
    const prodWatcher = createDirectWatcher(localDockerApi);
    const aliasWatcher = createDirectWatcher(localDockerApi);
    mockGetState.mockReturnValue({
      ...state,
      watcher: {
        'docker.local': aliasWatcher,
        'docker.prod': prodWatcher,
      },
    });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(prodWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'peer-container-id', name: 'drydock-peer' });

    await expect(docker.classifySelfUpdate(createDrydockCandidate())).resolves.toBe('current');
    expect(docker.selfUpdateOrchestrator.resolveSelfContainerIdentity).toHaveBeenCalledOnce();
  });

  test('fails closed when distinct direct local daemon sources are configured', async () => {
    const firstDockerApi = createInspectingDockerApi({});
    const secondDockerApi = createInspectingDockerApi({});
    const state = mockGetState();
    const firstWatcher = createDirectWatcher(firstDockerApi, '/var/run/docker.sock');
    const secondWatcher = createDirectWatcher(secondDockerApi, '/run/alternate/docker.sock');
    mockGetState.mockReturnValue({
      ...state,
      watcher: {
        'docker.first': firstWatcher,
        'docker.second': secondWatcher,
      },
    });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(firstWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'peer-container-id', name: 'drydock-peer' });

    await expect(docker.classifySelfUpdate(createDrydockCandidate())).resolves.toBe(
      'indeterminate',
    );
    expect(docker.selfUpdateOrchestrator.resolveSelfContainerIdentity).not.toHaveBeenCalled();
  });

  test('returns indeterminate when the unique direct local identity probe rejects', async () => {
    const localDockerApi = createInspectingDockerApi({});
    const state = mockGetState();
    const prodWatcher = createDirectWatcher(localDockerApi);
    mockGetState.mockReturnValue({
      ...state,
      watcher: { 'docker.prod': prodWatcher },
    });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(prodWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockRejectedValue(new Error('local socket disappeared'));

    await expect(docker.classifySelfUpdate(createDrydockCandidate())).resolves.toBe(
      'indeterminate',
    );
  });

  test('returns indeterminate when the Drydock candidate watcher disappears', async () => {
    const state = mockGetState();
    mockGetState.mockReturnValue({ ...state, watcher: {} });
    vi.spyOn(docker, 'getWatcher').mockImplementation(() => {
      throw new Error('watcher disappeared');
    });
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi.fn().mockResolvedValue(null);

    await expect(docker.classifySelfUpdate(createDrydockCandidate())).resolves.toBe(
      'indeterminate',
    );
  });

  test('does not bind a direct candidate to a different local socket source', async () => {
    const state = mockGetState();
    const localDockerApi = createInspectingDockerApi({});
    const candidateWatcher = createDirectWatcher(
      createInspectingDockerApi({}),
      '/run/candidate/docker.sock',
    );
    mockGetState.mockReturnValue({
      ...state,
      watcher: { 'docker.prod': createDirectWatcher(localDockerApi) },
    });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(candidateWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'peer-container-id', name: 'drydock-peer' });

    await expect(docker.classifySelfUpdate(createDrydockCandidate())).resolves.toBe('peer');
  });

  test('excludes malformed and agent-owned entries from direct local identity evidence', async () => {
    const localDockerApi = createInspectingDockerApi({});
    const state = mockGetState();
    const prodWatcher = createDirectWatcher(localDockerApi);
    mockGetState.mockReturnValue({
      ...state,
      watcher: {
        'docker.invalid': null,
        'docker.edge': { ...createDirectWatcher(createInspectingDockerApi({})), agent: 'edge' },
        'docker.empty': {
          ...createDirectWatcher(localDockerApi),
          agent: '',
          configuration: { socket: '/var/run/docker.sock', host: '' },
        },
        'edge.docker.remote': createDirectWatcher(createInspectingDockerApi({})),
        'docker.prod': prodWatcher,
      },
    });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(prodWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'peer-container-id', name: 'drydock-peer' });

    await expect(docker.classifySelfUpdate(createDrydockCandidate())).resolves.toBe('current');
  });

  test('classifies an agent-owned Drydock candidate as a peer', async () => {
    const agentWatcher = {
      agent: 'edge',
      configuration: { socket: '/var/run/docker.sock' },
      dockerApi: createInspectingDockerApi({}),
    };
    vi.spyOn(docker, 'getWatcher').mockReturnValue(agentWatcher as never);

    await expect(
      docker.classifySelfUpdate(
        createTriggerContainer({
          agent: 'edge',
          watcher: 'local',
          image: { name: 'codeswhat/drydock' },
        }),
      ),
    ).resolves.toBe('peer');
  });

  test('rejects a remote infrastructure helper before using a local container namespace', async () => {
    const targetId = 'remote-target-id';
    const targetName = '/remote-proxy';
    const stableDockerApi = {
      ...createInspectingDockerApi({}),
      createContainer: vi.fn(),
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ Id: targetId, Name: targetName }),
      }),
    };
    const remoteWatcher = {
      type: 'docker',
      dockerApi: { modem: { host: 'remote-daemon', port: 2375, protocol: 'http' } },
      configuration: { host: 'remote-daemon', port: 2375, protocol: 'http' },
    };
    const state = mockGetState();
    mockGetState.mockReturnValue({
      ...state,
      watcher: {
        'docker.prod': createDirectWatcher(stableDockerApi),
        'docker.remote': remoteWatcher,
      },
    });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(remoteWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'local-drydock-id', name: 'drydock' });

    await expect(
      docker.resolveObservedHelperRuntime(
        {
          currentContainerSpec: {
            Id: targetId,
            Name: targetName,
            HostConfig: { Binds: [] },
          },
        },
        { watcher: 'remote' },
      ),
    ).rejects.toThrow('unsupported for remote Docker watchers');
    expect(stableDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('rejects Portwing-owned infrastructure helpers before daemon inspection', async () => {
    const stableDockerApi = {
      ...createInspectingDockerApi({}),
      createContainer: vi.fn(),
      getContainer: vi.fn(),
    };
    const state = mockGetState();
    mockGetState.mockReturnValue({
      ...state,
      watcher: { 'docker.prod': createDirectWatcher(stableDockerApi) },
    });

    await expect(
      docker.resolveObservedHelperRuntime(
        {
          currentContainerSpec: {
            Id: 'agent-target-id',
            Name: '/agent-target',
            HostConfig: { Binds: ['/var/run/docker.sock:/var/run/docker.sock'] },
          },
        },
        { agent: 'edge', watcher: 'local' },
      ),
    ).rejects.toThrow('unsupported for agent-owned watchers');
    expect(stableDockerApi.getContainer).not.toHaveBeenCalled();
  });

  test('rejects infrastructure helper resolution when its watcher disappears', async () => {
    vi.spyOn(docker, 'getWatcher').mockImplementation(() => {
      throw new Error('watcher removed');
    });

    await expect(
      docker.resolveObservedHelperRuntime(
        { currentContainerSpec: { Id: 'target-id', Name: '/target', HostConfig: {} } },
        { watcher: 'missing' },
      ),
    ).rejects.toThrow('Infrastructure helper watcher is unavailable: watcher removed');
  });

  test('rejects an agent-owned watcher even when the container omits its agent', async () => {
    vi.spyOn(docker, 'getWatcher').mockReturnValue({
      agent: 'edge',
      configuration: { socket: '/var/run/docker.sock' },
    } as never);

    await expect(
      docker.resolveObservedHelperRuntime(
        { currentContainerSpec: { Id: 'target-id', Name: '/target', HostConfig: {} } },
        { watcher: 'local' },
      ),
    ).rejects.toThrow('unsupported for agent-owned watchers');
  });

  test('rejects helper resolution without a unique direct local daemon', async () => {
    const remoteWatcher = {
      configuration: { host: 'proxy', port: 2375 },
      dockerApi: { modem: { host: 'proxy' } },
    };
    const state = mockGetState();
    mockGetState.mockReturnValue({ ...state, watcher: { 'docker.proxy': remoteWatcher } });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(remoteWatcher as never);

    await expect(
      docker.resolveObservedHelperRuntime(
        {
          currentContainerSpec: {
            Id: 'target-id',
            Name: '/target',
            HostConfig: { Binds: ['/var/run/docker.sock:/var/run/docker.sock'] },
          },
        },
        { watcher: 'proxy' },
      ),
    ).rejects.toThrow('requires one direct local Docker watcher');
  });

  test('rejects a direct local daemon without stable helper control methods', async () => {
    const incompleteDockerApi = createInspectingDockerApi({});
    const prodWatcher = createDirectWatcher(incompleteDockerApi);
    const state = mockGetState();
    mockGetState.mockReturnValue({ ...state, watcher: { 'docker.prod': prodWatcher } });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(prodWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'local-drydock-id', name: 'drydock' });

    await expect(
      docker.resolveObservedHelperRuntime(
        { currentContainerSpec: { Id: 'target-id', Name: '/target', HostConfig: {} } },
        { watcher: 'prod' },
      ),
    ).rejects.toThrow('requires stable local Docker control');
  });

  test.each([
    [
      'an uninspectable target handle',
      () => ({}),
      'stable Docker target handle is not inspectable',
    ],
    [
      'a failed target inspection',
      () => ({ inspect: vi.fn().mockRejectedValue(new Error('inspect failed')) }),
      'inspect failed',
    ],
  ])('rejects %s on the stable local daemon', async (_description, createTarget, errorMessage) => {
    const stableDockerApi = {
      ...createInspectingDockerApi({}),
      createContainer: vi.fn(),
      getContainer: vi.fn().mockReturnValue(createTarget()),
    };
    const prodWatcher = createDirectWatcher(stableDockerApi);
    const state = mockGetState();
    mockGetState.mockReturnValue({ ...state, watcher: { 'docker.prod': prodWatcher } });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(prodWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'local-drydock-id', name: 'drydock' });

    await expect(
      docker.resolveObservedHelperRuntime(
        { currentContainerSpec: { Id: 'target-id', Name: '/target', HostConfig: {} } },
        { watcher: 'prod' },
      ),
    ).rejects.toThrow(errorMessage);
  });

  test.each([
    [{ Id: 'other-id', Name: '/target' }, 'target id mismatch'],
    [{ Id: 'target-id', Name: 42 }, 'malformed target name'],
  ])('rejects mismatched local infrastructure identity: %s', async (targetInspect) => {
    const stableDockerApi = {
      ...createInspectingDockerApi({}),
      createContainer: vi.fn(),
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue(targetInspect),
      }),
    };
    const prodWatcher = createDirectWatcher(stableDockerApi);
    const state = mockGetState();
    mockGetState.mockReturnValue({ ...state, watcher: { 'docker.prod': prodWatcher } });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(prodWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'local-drydock-id', name: 'drydock' });

    await expect(
      docker.resolveObservedHelperRuntime(
        { currentContainerSpec: { Id: 'target-id', Name: '/target', HostConfig: {} } },
        { watcher: 'prod' },
      ),
    ).rejects.toThrow('identity does not match');
  });

  test('returns stable helper control only after proving the target on the local daemon', async () => {
    const targetInspect = { Id: 'target-id', Name: '/target' };
    const stableDockerApi = {
      ...createInspectingDockerApi({}),
      createContainer: vi.fn(),
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue(targetInspect),
      }),
    };
    const prodWatcher = createDirectWatcher(stableDockerApi);
    const state = mockGetState();
    mockGetState.mockReturnValue({ ...state, watcher: { 'docker.prod': prodWatcher } });
    vi.spyOn(docker, 'getWatcher').mockReturnValue(prodWatcher as never);
    docker.selfUpdateOrchestrator.resolveSelfContainerIdentity = vi
      .fn()
      .mockResolvedValue({ id: 'local-drydock-id', name: 'drydock' });

    await expect(
      docker.resolveObservedHelperRuntime(
        { currentContainerSpec: { ...targetInspect, HostConfig: {} } },
        { watcher: 'prod' },
      ),
    ).resolves.toEqual({
      dockerApi: stableDockerApi,
      networkMode: 'container:local-drydock-id',
    });
  });

  test('wires the orchestrator stable-runtime callback to the Docker trigger', async () => {
    const runtime = {
      dockerApi: { createContainer: vi.fn() },
      networkMode: 'container:local-drydock-id',
    };
    const resolver = vi.spyOn(docker, 'resolveObservedHelperRuntime').mockResolvedValue(runtime);
    const context = { currentContainerSpec: { Id: 'target-id', Name: '/target' } };
    const container = { watcher: 'prod' };

    await expect(
      docker.selfUpdateOrchestrator.resolveObservedHelperRuntime(context as never, container),
    ).resolves.toBe(runtime);
    expect(resolver).toHaveBeenCalledWith(context, container);
  });
});
