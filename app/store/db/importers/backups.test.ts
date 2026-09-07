import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { backupsImporter } from './backups.js';
import { COLLECTION_IMPORTERS } from './index.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({
      collections: [{ name: 'backups', data: documents.map((data) => ({ data })) }],
    }),
    'dd.json',
  );
}

describe('store/db/importers/backups', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return backupsImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(backupsImporter);
    expect(backupsImporter.collection).toBe('backups');
    expect(backupsImporter.table).toBe('backups');
  });

  test('carries a backup with an identity key across field for field', () => {
    expect(
      run([
        {
          id: 'backup-one',
          containerId: 'container-web',
          containerName: 'web',
          containerIdentityKey: 'watcher-web',
          imageName: 'library/web',
          imageTag: 'one',
          imageDigest: 'digest-one',
          timestamp: '2026-01-09T00:00:00.000Z',
          triggerName: 'docker.default',
        },
      ]),
    ).toBe(1);
    expect(db.prepare('SELECT * FROM backups').get()).toEqual({
      id: 'backup-one',
      container_identity_key: 'watcher-web',
      container_name: 'web',
      container_id: 'container-web',
      image_name: 'library/web',
      image_tag: 'one',
      image_digest: 'digest-one',
      timestamp: '2026-01-09T00:00:00.000Z',
      trigger_name: 'docker.default',
    });
  });

  test('imports a legacy backup with no recorded identity as NULL', () => {
    expect(
      run([
        {
          id: 'backup-legacy',
          containerId: 'container-legacy',
          containerName: 'legacy',
          imageName: 'library/legacy',
          imageTag: 'one',
          timestamp: '2026-01-01T00:00:00.000Z',
          triggerName: 'docker.default',
        },
      ]),
    ).toBe(1);
    const row = db
      .prepare('SELECT container_identity_key FROM backups WHERE id = ?')
      .get('backup-legacy');
    expect(row?.container_identity_key).toBeNull();
  });

  test('imports a backup with no recorded containerId as NULL', () => {
    expect(
      run([
        {
          id: 'backup-no-container-id',
          containerName: 'web',
          imageName: 'library/web',
          imageTag: 'one',
          timestamp: '2026-01-02T00:00:00.000Z',
          triggerName: 'docker.default',
        },
      ]),
    ).toBe(1);
    const row = db
      .prepare('SELECT container_id FROM backups WHERE id = ?')
      .get('backup-no-container-id');
    expect(row?.container_id).toBeNull();
  });

  test('skips a document missing id, containerName, imageName, imageTag, triggerName or timestamp', () => {
    expect(
      run([
        { containerName: 'web', imageName: 'a', imageTag: 'b', triggerName: 'c', timestamp: 't' },
      ]),
    ).toBe(0);
    expect(
      run([{ id: 'x', imageName: 'a', imageTag: 'b', triggerName: 'c', timestamp: 't' }]),
    ).toBe(0);
    expect(
      run([{ id: 'x', containerName: 'web', imageTag: 'b', triggerName: 'c', timestamp: 't' }]),
    ).toBe(0);
    expect(
      run([{ id: 'x', containerName: 'web', imageName: 'a', triggerName: 'c', timestamp: 't' }]),
    ).toBe(0);
    expect(
      run([{ id: 'x', containerName: 'web', imageName: 'a', imageTag: 'b', timestamp: 't' }]),
    ).toBe(0);
    expect(
      run([{ id: 'x', containerName: 'web', imageName: 'a', imageTag: 'b', triggerName: 'c' }]),
    ).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM backups').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });
});
