import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { appImporter } from './app.js';
import { COLLECTION_IMPORTERS } from './index.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'app', data: documents }] }),
    'dd.json',
  );
}

describe('store/db/importers/app', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return appImporter.importInto({ db, snapshot: snapshotOf(documents), sessionDocuments: [] });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(appImporter);
    expect(appImporter.collection).toBe('app');
    expect(appImporter.table).toBe('app_info');
  });

  test('carries the recorded name and version into the singleton row', () => {
    expect(run([{ name: 'drydock', version: '1.7.2' }])).toBe(1);
    expect(db.prepare('SELECT id, name, version FROM app_info').all()).toEqual([
      { id: 1, name: 'drydock', version: '1.7.2' },
    ]);
  });

  test('writes no row when the store never had an app document', () => {
    expect(run([])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM app_info').get()).toEqual({ n: 0 });
  });

  test('writes no row when the document is missing a name or version', () => {
    expect(run([{ name: 'drydock' }])).toBe(0);
    expect(run([{ version: '1.7.2' }])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM app_info').get()).toEqual({ n: 0 });
  });
});
