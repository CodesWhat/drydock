import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { uiPreferencesImporter } from './ui-preferences.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'ui-preferences', data: documents }] }),
    'dd.json',
  );
}

describe('store/db/importers/ui-preferences', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return uiPreferencesImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(uiPreferencesImporter);
    expect(uiPreferencesImporter.collection).toBe('ui-preferences');
    expect(uiPreferencesImporter.table).toBe('ui_preferences');
  });

  test('carries one row per username', () => {
    expect(
      run([
        {
          username: 'alice',
          schemaVersion: 11,
          preferences: { theme: 'dark' },
          updatedAt: '2026-07-11T12:00:00.000Z',
        },
        {
          username: 'bob',
          schemaVersion: 3,
          preferences: { theme: 'light' },
          updatedAt: '2026-07-12T09:00:00.000Z',
        },
      ]),
    ).toBe(2);

    expect(
      db
        .prepare(
          'SELECT username, schema_version, preferences, updated_at FROM ui_preferences ORDER BY username',
        )
        .all(),
    ).toEqual([
      {
        username: 'alice',
        schema_version: 11,
        preferences: JSON.stringify({ theme: 'dark' }),
        updated_at: '2026-07-11T12:00:00.000Z',
      },
      {
        username: 'bob',
        schema_version: 3,
        preferences: JSON.stringify({ theme: 'light' }),
        updated_at: '2026-07-12T09:00:00.000Z',
      },
    ]);
  });

  test('defaults a missing schema version and preferences blob', () => {
    expect(run([{ username: 'carol' }])).toBe(1);
    expect(db.prepare('SELECT schema_version, preferences FROM ui_preferences').get()).toEqual({
      schema_version: 1,
      preferences: '{}',
    });
  });

  test('skips a document with no usable username', () => {
    expect(run([{ preferences: {} }, { username: '' }])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ui_preferences').get()).toEqual({ n: 0 });
  });

  test('writes no row when the store never had a ui-preferences document', () => {
    expect(run([])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ui_preferences').get()).toEqual({ n: 0 });
  });
});
