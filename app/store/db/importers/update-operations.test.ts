import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { updateOperationsImporter } from './update-operations.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({
      collections: [{ name: 'updateOperations', data: documents.map((data) => ({ data })) }],
    }),
    'dd.json',
  );
}

describe('store/db/importers/update-operations', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return updateOperationsImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(updateOperationsImporter);
    expect(updateOperationsImporter.collection).toBe('updateOperations');
    expect(updateOperationsImporter.table).toBe('update_operations');
  });

  test('imports a full-shape legacy operation and derives identity from its container snapshot', () => {
    expect(
      run([
        {
          id: 'op-one',
          containerId: 'container-web',
          containerName: 'web',
          newContainerId: 'container-web-2',
          oldContainerId: 'container-web-old',
          oldName: 'web_old',
          tempName: 'web_temp',
          status: 'succeeded',
          phase: 'completed',
          kind: 'image',
          batchId: 'batch-one',
          queuePosition: 1,
          queueTotal: 2,
          triggerName: 'docker.default',
          agent: 'agent-a',
          watcher: 'watcher-a',
          fromVersion: '1.0.0',
          toVersion: '1.1.0',
          targetImage: 'library/web:1.1.0',
          cancelRequested: false,
          oldContainerWasRunning: true,
          oldContainerStopped: true,
          helperLifecycleOwner: 'surviving-process',
          finalizeSecretHash: 'hash-one',
          createdAt: '2026-01-09T00:00:00.000Z',
          updatedAt: '2026-01-09T00:05:00.000Z',
          completedAt: '2026-01-09T00:05:00.000Z',
          container: {
            watcher: 'watcher-a',
            agent: 'agent-a',
            name: 'web',
            identityKey: 'agent-a::watcher-a::web',
            labels: {},
          },
        },
      ]),
    ).toBe(1);

    expect(
      db
        .prepare(
          'SELECT id, container_identity_key, container_name, status, phase, from_version, to_version FROM update_operations WHERE id = ?',
        )
        .get('op-one'),
    ).toEqual({
      id: 'op-one',
      container_identity_key: 'agent-a::watcher-a::web',
      container_name: 'web',
      status: 'succeeded',
      phase: 'completed',
      from_version: '1.0.0',
      to_version: '1.1.0',
    });
  });

  test('derives identity from agent/watcher/containerName when no container snapshot is present', () => {
    expect(
      run([
        {
          id: 'op-two',
          containerName: 'legacy',
          agent: 'agent-b',
          watcher: 'watcher-b',
          status: 'queued',
          phase: 'queued',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toBe(1);

    const row = db
      .prepare('SELECT container_identity_key FROM update_operations WHERE id = ?')
      .get('op-two');
    expect(row?.container_identity_key).toBe('agent-b::watcher-b::legacy');
  });

  test('imports a minimal legacy operation with no derivable identity as NULL', () => {
    expect(
      run([
        {
          id: 'op-three',
          containerName: 'orphan',
          status: 'failed',
          phase: 'failed',
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    ).toBe(1);

    const row = db
      .prepare('SELECT container_identity_key FROM update_operations WHERE id = ?')
      .get('op-three');
    expect(row?.container_identity_key).toBeNull();
  });

  test('skips a document missing id, containerName, status, phase, createdAt or updatedAt', () => {
    const base = {
      id: 'x',
      containerName: 'web',
      status: 'queued',
      phase: 'queued',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    for (const key of Object.keys(base)) {
      const { [key]: _omitted, ...rest } = base;
      expect(run([rest])).toBe(0);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM update_operations').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });

  test('re-importing the same snapshot upserts instead of throwing a UNIQUE constraint error', () => {
    const document = {
      id: 'op-repeat',
      containerName: 'web',
      status: 'succeeded',
      phase: 'completed',
      agent: 'agent-a',
      watcher: 'watcher-a',
      createdAt: '2026-01-09T00:00:00.000Z',
      updatedAt: '2026-01-09T00:05:00.000Z',
    };

    expect(run([document])).toBe(1);
    expect(run([document])).toBe(1);

    expect(db.prepare('SELECT COUNT(*) AS n FROM update_operations').get()).toEqual({ n: 1 });
    const row = db
      .prepare('SELECT id, container_identity_key FROM update_operations WHERE id = ?')
      .get('op-repeat');
    expect(row).toEqual({ id: 'op-repeat', container_identity_key: 'agent-a::watcher-a::web' });
  });
});
