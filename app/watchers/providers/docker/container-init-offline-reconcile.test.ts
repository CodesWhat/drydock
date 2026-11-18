import * as storeContainer from '../../../store/container.js';
import { createContainerFixture } from '../../../test/helpers.js';
import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import { pruneOldContainers } from './container-init.js';

vi.mock('../../../event');
vi.mock('../../../log');

let db: ReturnType<typeof createMigratedMemoryDatabase>;

beforeEach(() => {
  vi.resetAllMocks();
  storeContainer._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  storeContainer.createCollections(db);
});

afterEach(() => {
  db.close();
});

function stored(id: string, name: string) {
  return storeContainer.insertContainer(
    createContainerFixture({ id, name, watcher: 'local', status: 'running' }),
  );
}

// Startup reconciliation: the store holds what the controller last saw, and
// Docker holds what happened while it was offline.
describe('startup reconciliation against containers changed while the controller was offline', () => {
  test('keeps a container stopped offline with its new status, drops one removed offline, and tracks one created offline', async () => {
    const stoppedOffline = stored('stopped-offline', 'db');
    const removedOffline = stored('removed-offline', 'cache');
    const untouched = stored('still-running', 'web');
    const createdOffline = createContainerFixture({
      id: 'created-offline',
      name: 'worker',
      watcher: 'local',
    });
    const inspectById: Record<string, () => Promise<unknown>> = {
      'stopped-offline': async () => ({ State: { Status: 'exited' } }),
      'removed-offline': async () => {
        throw new Error('no such container');
      },
    };
    const dockerApi = {
      getContainer: vi.fn((id: string) => ({ inspect: inspectById[id] })),
    };

    // The scan lists only what is running: the untouched container and the new one.
    await pruneOldContainers(
      [untouched, createdOffline],
      storeContainer.getContainers({ watcher: 'local' }),
      dockerApi as never,
    );
    storeContainer.insertContainer(createdOffline);

    expect(storeContainer.getContainer(stoppedOffline.id)?.status).toBe('exited');
    expect(storeContainer.getContainer(removedOffline.id)).toBeUndefined();
    expect(storeContainer.getContainer('still-running')?.status).toBe('running');
    expect(
      storeContainer
        .getContainers({ watcher: 'local' })
        .map((c) => c.id)
        .sort(),
    ).toEqual(['created-offline', 'still-running', 'stopped-offline']);
  });

  test('keeps the update policy of a container stopped offline so it is not lost on restart', async () => {
    const policy = { maturityMode: 'mature', maturityMinAgeDays: 5 };
    storeContainer.insertContainer(
      createContainerFixture({
        id: 'stopped-offline',
        name: 'db',
        watcher: 'local',
        updatePolicy: policy,
      }),
    );
    const dockerApi = {
      getContainer: vi.fn(() => ({
        inspect: vi.fn().mockResolvedValue({ State: { Status: 'exited' } }),
      })),
    };

    await pruneOldContainers(
      [],
      storeContainer.getContainers({ watcher: 'local' }),
      dockerApi as never,
    );

    const reconciled = storeContainer.getContainer('stopped-offline');
    expect(reconciled?.status).toBe('exited');
    expect(reconciled?.updatePolicy).toEqual(policy);
  });
});
