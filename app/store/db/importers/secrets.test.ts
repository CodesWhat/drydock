import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { secretsImporter } from './secrets.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'secrets', data: documents }] }),
    'dd.json',
  );
}

describe('store/db/importers/secrets', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return secretsImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(secretsImporter);
    expect(secretsImporter.collection).toBe('secrets');
    expect(secretsImporter.table).toBe('secrets');
  });

  test('moves the stored session secret into the singleton row', () => {
    expect(run([{ sessionSecret: 'abc' }])).toBe(1);
    expect(db.prepare('SELECT id, session_secret FROM secrets').all()).toEqual([
      { id: 1, session_secret: 'abc' },
    ]);
  });

  test('takes the first usable value when a clobbered store left several documents', () => {
    expect(run([{}, { sessionSecret: '' }, { sessionSecret: 7 }, { sessionSecret: 'abc' }])).toBe(
      1,
    );
    expect(db.prepare('SELECT session_secret FROM secrets').get()).toEqual({
      session_secret: 'abc',
    });
  });

  test('writes no row when the store never had a session secret', () => {
    expect(run([])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM secrets').get()).toEqual({ n: 0 });
  });
});
