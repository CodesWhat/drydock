import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { agentKeysImporter } from './agent-keys.js';
import { COLLECTION_IMPORTERS } from './index.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'agent-keys', data: documents }] }),
    'dd.json',
  );
}

describe('store/db/importers/agent-keys', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return agentKeysImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(agentKeysImporter);
    expect(agentKeysImporter.collection).toBe('agent-keys');
    expect(agentKeysImporter.table).toBe('agent_keys');
  });

  test('carries an active key across field for field', () => {
    expect(
      run([
        {
          keyId: 'aabbccddeeff0011',
          pubkey: 'cHVia2V5',
          label: 'edge-node-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          revokedAt: null,
        },
      ]),
    ).toBe(1);
    expect(
      db.prepare('SELECT key_id, pubkey, label, created_at, revoked_at FROM agent_keys').all(),
    ).toEqual([
      {
        key_id: 'aabbccddeeff0011',
        pubkey: 'cHVia2V5',
        label: 'edge-node-1',
        created_at: '2026-01-01T00:00:00.000Z',
        revoked_at: null,
      },
    ]);
  });

  test('carries a revoked key across with its revokedAt', () => {
    expect(
      run([
        {
          keyId: 'aabbccddeeff0011',
          pubkey: 'cHVia2V5',
          label: 'retired',
          createdAt: '2026-01-01T00:00:00.000Z',
          revokedAt: '2026-02-01T00:00:00.000Z',
        },
      ]),
    ).toBe(1);
    expect(db.prepare('SELECT revoked_at FROM agent_keys').get()).toEqual({
      revoked_at: '2026-02-01T00:00:00.000Z',
    });
  });

  test('defaults a missing label and createdAt rather than skipping the row', () => {
    expect(run([{ keyId: 'aabbccddeeff0011', pubkey: 'cHVia2V5' }])).toBe(1);
    const row = db.prepare('SELECT label, created_at FROM agent_keys').get();
    expect(row?.label).toBe('');
    expect(typeof row?.created_at).toBe('string');
  });

  test('skips a document missing keyId or pubkey', () => {
    expect(run([{ pubkey: 'cHVia2V5' }])).toBe(0);
    expect(run([{ keyId: 'aabbccddeeff0011' }])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_keys').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });
});
