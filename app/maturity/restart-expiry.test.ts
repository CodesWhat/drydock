import * as event from '../event/index.js';
import * as storeContainer from '../store/container.js';
import type { Database } from '../store/db/driver.js';
import { createContainerFixture } from '../test/helpers.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { runMaturitySweep } from './scheduler.js';

vi.mock('../event');
vi.mock('../log');
vi.mock('../configuration/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getMaturitySweepConfiguration: vi.fn().mockReturnValue({ cron: '' }),
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const POLICY = { maturityMode: 'mature', maturityMinAgeDays: 7 };

let db: Database;

function soakingContainer(id: string, detectedAt: string) {
  const base = createContainerFixture({ id, name: id, watcher: 'local' });
  return {
    ...base,
    image: { ...base.image, tag: { ...base.image.tag, value: '1.0.0' } },
    result: { tag: '2.0.0' },
    updateDetectedAt: detectedAt,
    maturityGatePendingSince: detectedAt,
    updatePolicy: POLICY,
  };
}

function seed(rawContainer: unknown) {
  const row = storeContainer.buildImportedContainerRow(rawContainer);
  if (!row) {
    throw new Error('fixture failed validation');
  }
  storeContainer.insertImportedContainerRow(db, row);
}

// A controller restart drops every in-memory cache but keeps the database.
function restartController() {
  storeContainer._resetContainerStoreStateForTests();
  storeContainer.createCollections(db);
}

beforeEach(() => {
  vi.clearAllMocks();
  storeContainer._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  storeContainer.createCollections(db);
});

afterEach(() => {
  db.close();
});

describe('maturity gate across a controller restart', () => {
  test('a gate that expired while the controller was down is announced once by the first sweep after restart', async () => {
    seed(soakingContainer('expired-offline', new Date(Date.now() - 8 * DAY_MS).toISOString()));

    restartController();
    await runMaturitySweep();

    expect(event.emitMaturityGateCleared).toHaveBeenCalledTimes(1);
    expect(event.emitMaturityGateCleared).toHaveBeenCalledWith(
      expect.objectContaining({
        container: expect.objectContaining({ id: 'expired-offline' }),
        minAgeDays: 7,
      }),
    );
    expect(storeContainer.getContainerRaw('expired-offline')?.maturityGatePendingSince).toBe(
      undefined,
    );

    // The cleared marker is durable, so another restart cannot announce it again.
    restartController();
    await runMaturitySweep();
    expect(event.emitMaturityGateCleared).toHaveBeenCalledTimes(1);
  });

  test('a gate still soaking after restart keeps its marker and stays quiet until it expires', async () => {
    const pendingSince = new Date(Date.now() - 2 * DAY_MS).toISOString();
    seed(soakingContainer('still-soaking', pendingSince));

    restartController();
    await runMaturitySweep();

    expect(event.emitMaturityGateCleared).not.toHaveBeenCalled();
    expect(storeContainer.getContainerRaw('still-soaking')?.maturityGatePendingSince).toBe(
      pendingSince,
    );
  });
});
