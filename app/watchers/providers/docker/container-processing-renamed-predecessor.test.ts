import * as storeContainer from '../../../store/container.js';
import { createContainerFixture } from '../../../test/helpers.js';
import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import { mapContainerToContainerReport, watchContainer } from './container-processing.js';

vi.mock('../../../event');
vi.mock('../../../maturity/gate-watch.js', () => ({
  maybeEmitMaturityGateCleared: vi.fn().mockResolvedValue(false),
}));
vi.mock('./release-notes-enrichment.js', () => ({
  enrichContainerWithReleaseNotes: vi.fn().mockResolvedValue(undefined),
}));

const POLICY = { maturityMode: 'mature', maturityMinAgeDays: 5 };

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

function localFixture(overrides: Record<string, unknown> = {}) {
  return { ...createContainerFixture(), watcher: 'local', name: 'myapp', ...overrides } as any;
}

function createDependencies() {
  return {
    ensureLogger: vi.fn(),
    log: { child: vi.fn(() => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
    findNewVersion: vi.fn().mockResolvedValue(undefined),
    mapContainerToContainerReport: vi.fn(),
    isRenamedPredecessorOfReplacement: storeContainer.isRenamedPredecessorOfReplacement,
  } as any;
}

// DR-147: with watchall a slow replacement leaves the renamed old container listed after
// the discovery settle. The scan must not add it back as a second visible row.
describe('watchContainer with a renamed predecessor still listed after a replacement (DR-147)', () => {
  function replaceOldRow(updatePolicy?: unknown) {
    storeContainer.insertContainer(localFixture({ id: 'old-container', updatePolicy }));
    storeContainer.deleteContainer('old-container', {
      replacementExpected: true,
      excludedContainerId: 'old-container',
      supersededByContainerId: 'new-container',
    });
  }

  async function watchLikeTheScan(container: any) {
    const dependencies = createDependencies();
    dependencies.mapContainerToContainerReport = (c, started) =>
      mapContainerToContainerReport(c, dependencies, started);
    return watchContainer(container, dependencies);
  }

  test('old container listed before the replacement: policy ends on the replacement, one row', async () => {
    replaceOldRow(POLICY);

    await watchLikeTheScan(localFixture({ id: 'old-container' }));
    await watchLikeTheScan(localFixture({ id: 'new-container' }));

    expect(storeContainer.getContainer('old-container')).toBeUndefined();
    expect(storeContainer.getContainer('new-container')?.updatePolicy).toEqual(POLICY);
    expect(storeContainer.getContainers().map((c) => c.id)).toEqual(['new-container']);
  });

  test('rollback-renamed old container listed after the replacement is not added back', async () => {
    replaceOldRow(POLICY);
    await watchLikeTheScan(localFixture({ id: 'new-container' }));

    const report = await watchLikeTheScan(
      localFixture({ id: 'old-container', name: 'myapp-old-1760000000000' }),
    );

    expect(report.changed).toBe(false);
    expect(storeContainer.getContainers().map((c) => c.id)).toEqual(['new-container']);
    expect(storeContainer.getContainer('new-container')?.updatePolicy).toEqual(POLICY);
  });

  test('no policy overrides: old container listed before the replacement leaves one row', async () => {
    replaceOldRow();

    await watchLikeTheScan(localFixture({ id: 'old-container' }));
    await watchLikeTheScan(localFixture({ id: 'new-container' }));

    expect(storeContainer.getContainers().map((c) => c.id)).toEqual(['new-container']);
  });

  test('no policy overrides: old container listed after the replacement is not added back', async () => {
    replaceOldRow();
    await watchLikeTheScan(localFixture({ id: 'new-container' }));

    await watchLikeTheScan(localFixture({ id: 'old-container' }));

    expect(storeContainer.getContainers().map((c) => c.id)).toEqual(['new-container']);
  });

  test('a rolled back replacement leaves the old container tracked', async () => {
    replaceOldRow(POLICY);
    await watchLikeTheScan(localFixture({ id: 'new-container' }));
    storeContainer.deleteContainer('new-container');

    await watchLikeTheScan(localFixture({ id: 'old-container' }));
    await watchLikeTheScan(localFixture({ id: 'old-container' }));

    expect(storeContainer.getContainers().map((c) => c.id)).toEqual(['old-container']);
  });

  test('replacement stored while the old container lookup is in flight leaves one row', async () => {
    replaceOldRow();
    const dependencies = createDependencies();
    dependencies.mapContainerToContainerReport = (c, started) =>
      mapContainerToContainerReport(c, dependencies, started);
    dependencies.findNewVersion = vi.fn(async () => {
      await watchLikeTheScan(localFixture({ id: 'new-container' }));
      return undefined;
    });

    const report = await watchContainer(localFixture({ id: 'old-container' }), dependencies);

    expect(report.changed).toBe(false);
    expect(storeContainer.getContainers().map((c) => c.id)).toEqual(['new-container']);
  });

  test('an already stored predecessor is removed on the next poll', async () => {
    replaceOldRow();
    storeContainer.insertContainer(localFixture({ id: 'new-container' }));
    storeContainer.insertContainer(localFixture({ id: 'old-container' }));
    expect(storeContainer.getContainers()).toHaveLength(2);

    await watchLikeTheScan(localFixture({ id: 'old-container' }));

    expect(storeContainer.getContainers().map((c) => c.id)).toEqual(['new-container']);
  });

  test('a renamed container with no replacement stored is still tracked', async () => {
    await watchLikeTheScan(localFixture({ id: 'lonely', name: 'foo-old-1760000000000' }));

    expect(storeContainer.getContainer('lonely')).toBeDefined();
  });
});
