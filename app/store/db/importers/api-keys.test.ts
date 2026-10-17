import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { apiKeysImporter } from './api-keys.js';
import { COLLECTION_IMPORTERS } from './index.js';

vi.mock('../../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'api-keys', data: documents }] }),
    'dd.json',
  );
}

describe('store/db/importers/api-keys', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return apiKeysImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(apiKeysImporter);
    expect(apiKeysImporter.collection).toBe('api-keys');
    expect(apiKeysImporter.table).toBe('api_keys');
  });

  test('carries a root key across field for field, with scopes in the join table', () => {
    expect(
      run([
        {
          schemaVersion: 1,
          keyId: 'aabbccddeeff',
          name: 'ci',
          secretHash: 'aGFzaA==',
          scopes: ['read', 'write'],
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'user:scott',
          parentKeyId: null,
          expiresAt: null,
          lastUsedAt: null,
          revokedAt: null,
        },
      ]),
    ).toBe(1);

    expect(
      db
        .prepare(
          'SELECT key_id, schema_version, name, secret_hash, created_at, created_by, parent_key_id, expires_at, rate_limit_max, last_used_at, revoked_at, revoked_by FROM api_keys',
        )
        .all(),
    ).toEqual([
      {
        key_id: 'aabbccddeeff',
        schema_version: 1,
        name: 'ci',
        secret_hash: 'aGFzaA==',
        created_at: '2026-01-01T00:00:00.000Z',
        created_by: 'user:scott',
        parent_key_id: null,
        expires_at: null,
        rate_limit_max: null,
        last_used_at: null,
        revoked_at: null,
        revoked_by: null,
      },
    ]);
    expect(
      db
        .prepare('SELECT scope FROM api_key_scope WHERE key_id = ? ORDER BY rowid')
        .all('aabbccddeeff'),
    ).toEqual([{ scope: 'read' }, { scope: 'write' }]);
  });

  test('carries a minted-child key, an expiry, a rate limit, and a revocation', () => {
    expect(
      run([
        {
          schemaVersion: 1,
          keyId: 'child000001',
          name: 'automation',
          secretHash: 'aGFzaA==',
          scopes: ['read'],
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'api-key:parent0001',
          parentKeyId: 'parent0001',
          expiresAt: '2026-06-01T00:00:00.000Z',
          rateLimitMax: 250,
          lastUsedAt: '2026-02-01T00:00:00.000Z',
          revokedAt: '2026-03-01T00:00:00.000Z',
          revokedBy: 'user:scott',
        },
      ]),
    ).toBe(1);

    const row = db
      .prepare(
        'SELECT parent_key_id, expires_at, rate_limit_max, last_used_at, revoked_at, revoked_by FROM api_keys',
      )
      .get();
    expect(row).toEqual({
      parent_key_id: 'parent0001',
      expires_at: '2026-06-01T00:00:00.000Z',
      rate_limit_max: 250,
      last_used_at: '2026-02-01T00:00:00.000Z',
      revoked_at: '2026-03-01T00:00:00.000Z',
      revoked_by: 'user:scott',
    });
  });

  test('defaults schemaVersion, name and createdBy for a bare-minimum document', () => {
    expect(run([{ keyId: 'bareminimum1', secretHash: 'aGFzaA==' }])).toBe(1);
    const row = db.prepare('SELECT schema_version, name, created_by FROM api_keys').get();
    expect(row?.schema_version).toBe(1);
    expect(row?.name).toBe('bareminimum1');
    expect(row?.created_by).toBe('user:unknown');
  });

  test('writes no scope rows when scopes is missing or not an array', () => {
    expect(run([{ keyId: 'noscopes0001', secretHash: 'aGFzaA==', scopes: 'read' }])).toBe(1);
    expect(
      db.prepare('SELECT scope FROM api_key_scope WHERE key_id = ?').all('noscopes0001'),
    ).toEqual([]);
  });

  test('skips a document missing keyId or secretHash', () => {
    expect(run([{ secretHash: 'aGFzaA==' }])).toBe(0);
    expect(run([{ keyId: 'aabbccddeeff' }])).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM api_keys').get()).toEqual({ n: 0 });
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });
});
