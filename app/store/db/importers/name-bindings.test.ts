import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { nameBindingsImporter } from './name-bindings.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'name-bindings', data: documents }] }),
    'dd.json',
  );
}

describe('store/db/importers/name-bindings', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return nameBindingsImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(nameBindingsImporter);
    expect(nameBindingsImporter.collection).toBe('name-bindings');
    expect(nameBindingsImporter.table).toBe('name_bindings');
  });

  test('carries a binding across field for field', () => {
    expect(
      run([{ agentName: 'edge-node-1', keyId: 'aabbccddeeff0011', lastSeenAt: 1_700_000_000_000 }]),
    ).toBe(1);
    expect(db.prepare('SELECT agent_name, key_id, last_seen_at FROM name_bindings').all()).toEqual([
      { agent_name: 'edge-node-1', key_id: 'aabbccddeeff0011', last_seen_at: 1_700_000_000_000 },
    ]);
  });

  test('defaults a missing lastSeenAt to zero rather than skipping the row', () => {
    expect(run([{ agentName: 'edge-node-1', keyId: 'aabbccddeeff0011' }])).toBe(1);
    expect(db.prepare('SELECT last_seen_at FROM name_bindings').get()).toEqual({
      last_seen_at: 0,
    });
  });

  test('skips a document missing agentName or keyId', () => {
    expect(run([{ keyId: 'aabbccddeeff0011' }])).toBe(0);
    expect(run([{ agentName: 'edge-node-1' }])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM name_bindings').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });
});
