import {
  createTriggerContainer,
  docker,
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
    stubTriggerFlow({ running: true });
    vi.spyOn(docker, 'getWatcher').mockReturnValue({ dockerApi } as never);

    await expect(docker.trigger(createDrydockCandidate())).rejects.toThrow(
      'Drydock container identity is indeterminate',
    );

    expect(docker.stopContainer).not.toHaveBeenCalled();
    expect(docker.createContainer).not.toHaveBeenCalled();
  });

  test('allows the normal stop/recreate path for a proven peer Drydock container', async () => {
    const dockerApi = createInspectingDockerApi({
      'current-container-id': {
        Id: 'current-container-id',
        Name: '/drydock-current',
        Config: { Hostname: 'current-host' },
      },
      'peer-container-id': {
        Id: 'peer-container-id',
        Name: '/drydock-peer',
        Config: { Hostname: 'peer-host' },
      },
    });
    stubTriggerFlow({ running: true });
    vi.spyOn(docker, 'getWatcher').mockReturnValue({ dockerApi } as never);

    await expect(docker.trigger(createDrydockCandidate())).resolves.toBeUndefined();

    expect(docker.stopContainer).toHaveBeenCalledOnce();
    expect(docker.createContainer).toHaveBeenCalledOnce();
  });
});
