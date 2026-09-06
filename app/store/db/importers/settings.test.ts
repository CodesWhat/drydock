import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { settingsImporter } from './settings.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'settings', data: documents }] }),
    'dd.json',
  );
}

describe('store/db/importers/settings', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return settingsImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(settingsImporter);
    expect(settingsImporter.collection).toBe('settings');
    expect(settingsImporter.table).toBe('settings');
  });

  test('carries an explicitly stored update mode across unchanged', () => {
    expect(run([{ internetlessMode: true, updateMode: 'notify' }])).toBe(1);
    expect(db.prepare('SELECT internetless_mode, update_mode FROM settings').get()).toEqual({
      internetless_mode: 1,
      update_mode: 'notify',
    });
  });

  test('writes NULL update_mode for a document that predates the setting', () => {
    expect(run([{ internetlessMode: true }])).toBe(1);
    expect(db.prepare('SELECT internetless_mode, update_mode FROM settings').get()).toEqual({
      internetless_mode: 1,
      update_mode: null,
    });
  });

  test('ignores unrecognized legacy fields', () => {
    expect(run([{ internetlessMode: false, updateMode: 'auto', legacyJunk: 'value' }])).toBe(1);
    expect(db.prepare('SELECT internetless_mode, update_mode FROM settings').get()).toEqual({
      internetless_mode: 0,
      update_mode: 'auto',
    });
  });

  test('writes no row when the store never had a settings document', () => {
    expect(run([])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
  });
});
