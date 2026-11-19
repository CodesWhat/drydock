import type Dockerode from 'dockerode';
import * as event from '../../../event/index.js';
import * as registry from '../../../registry/index.js';
import * as store from '../../../store/container.js';
import type { Database } from '../../../store/db/driver.js';
import { createContainerFixture } from '../../../test/helpers.js';
import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import Docker from './Docker.js';

vi.mock('../../../log');

// #1595 follow-up: after a GUI/API update recreates a container under a new id, the fast
// resync must leave exactly one row for it (the replacement), never both ids.
let db: Database;
let docker: Docker;
let live: Array<{ Id: string; Names: string[] }>;

function summary(id: string, name: string) {
  return {
    Id: id,
    ImageID: 'image-new',
    Image: 'nginx:1.0.0',
    Names: [`/${name}`],
    State: 'running',
    Labels: {},
  };
}

function inspection(id: string, name: string) {
  return {
    Id: id,
    Name: `/${name}`,
    Config: { Image: 'nginx:1.0.0', Labels: {}, Env: [] },
    State: { Status: 'running' },
  };
}

beforeEach(() => {
  store._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  store.createCollections(db);
  docker = new Docker();
  docker.name = 'local';
  docker.type = 'docker';
  live = [];
  docker.dockerApi = {
    listContainers: vi.fn(async (options: { filters?: { name?: string[]; id?: string[] } }) =>
      live
        .filter(
          (c) =>
            (!options.filters?.id || options.filters.id.includes(c.Id)) &&
            (!options.filters?.name ||
              options.filters.name.some((n) => c.Names.some((x) => x.includes(n)))),
        )
        .map((c) => summary(c.Id, c.Names[0].slice(1))),
    ),
    getContainer: (id: string) => ({
      inspect: async () => inspection(id, live.find((c) => c.Id === id)?.Names[0].slice(1) ?? ''),
    }),
    getImage: () => ({
      inspect: async () => ({
        Id: 'image-new',
        RepoTags: ['nginx:1.0.0'],
        RepoDigests: ['nginx@sha256:abc'],
        Architecture: 'amd64',
        Os: 'linux',
      }),
    }),
  } as unknown as Dockerode;
  vi.spyOn(docker, 'ensureRemoteAuthHeaders').mockResolvedValue(undefined);
  vi.spyOn(docker, 'findNewVersion').mockResolvedValue({ tag: '1.0.0' } as never);
  vi.spyOn(registry, 'getState').mockReturnValue({ registry: {}, watcher: {} } as ReturnType<
    typeof registry.getState
  >);
  vi.spyOn(event, 'emitContainerReport').mockResolvedValue(undefined);
});

afterEach(() => {
  event.clearAllListenersForTests();
  db.close();
  vi.restoreAllMocks();
});

describe.each([false, true])('fast resync after a GUI update (watchevents=%s)', (watchevents) => {
  test('replaces the old container row: old id gone, replacement present, one row (#1595)', async () => {
    docker.configuration = { watchbydefault: true, watchevents } as typeof docker.configuration;
    store.insertContainer(
      createContainerFixture({ id: 'old-id', name: 'dashy', watcher: 'local' }),
    );
    // The compose action recreated the container: same name, new id, old one is gone.
    live = [{ Id: 'new-id', Names: ['/dashy'] }];

    await (docker as any).maybeFastResyncAfterUpdate('dashy');

    expect(store.getContainer('old-id')).toBeUndefined();
    expect(store.getContainer('new-id')).toBeDefined();
    expect(store.getContainers({ watcher: 'local' }).map((c) => c.id)).toEqual(['new-id']);
  });
});
