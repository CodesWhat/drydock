import { createMigratedMemoryDatabase } from '../../../test/sqlite-db.js';
import type { Database } from '../driver.js';
import { parseLokiDatabase } from '../loki-json.js';
import { COLLECTION_IMPORTERS } from './index.js';
import { updatePolicyRetentionCacheImporter } from './update-policy-retention-cache.js';

function snapshotOf(documents: Record<string, unknown>[]) {
  return parseLokiDatabase(
    JSON.stringify({ collections: [{ name: 'update-policy-retention-cache', data: documents }] }),
    'dd.json',
  );
}

function cacheDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cacheKey: '::local::myapp',
    updatePolicyOverrides: { maturityMode: 'mature', maturityMinAgeDays: 5 },
    expiresAt: 1_000,
    ...overrides,
  };
}

describe('store/db/importers/update-policy-retention-cache', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  function run(documents: Record<string, unknown>[]): number {
    return updatePolicyRetentionCacheImporter.importInto({
      db,
      snapshot: snapshotOf(documents),
      sessionDocuments: [],
    });
  }

  test('is registered', () => {
    expect(COLLECTION_IMPORTERS).toContain(updatePolicyRetentionCacheImporter);
    expect(updatePolicyRetentionCacheImporter.collection).toBe('update-policy-retention-cache');
    expect(updatePolicyRetentionCacheImporter.table).toBe('update_policy_retention_cache');
  });

  test('carries a record across as-is, since it is already keyed on identity', () => {
    expect(run([cacheDocument()])).toBe(1);

    expect(
      db
        .prepare(
          'SELECT cache_key, update_policy_overrides, expires_at FROM update_policy_retention_cache',
        )
        .get(),
    ).toEqual({
      cache_key: '::local::myapp',
      update_policy_overrides: '{"maturityMode":"mature","maturityMinAgeDays":5}',
      expires_at: 1_000,
    });
  });

  test('stores a missing updatePolicyOverrides as NULL', () => {
    const document = cacheDocument();
    delete document.updatePolicyOverrides;

    expect(run([document])).toBe(1);
    expect(
      db.prepare('SELECT update_policy_overrides FROM update_policy_retention_cache').get(),
    ).toEqual({ update_policy_overrides: null });
  });

  test.each(['cacheKey', 'expiresAt'])('skips a document missing %s', (field) => {
    const document = cacheDocument();
    delete document[field];

    expect(run([document])).toBe(0);
  });

  test('writes no rows when the store never had this collection', () => {
    expect(run([])).toBe(0);
  });

  // Review finding 1 (roadmap 7-STORE slice 7): a plain INSERT throws on the
  // second of two legacy documents sharing a cacheKey — a corrupted or
  // hand-edited dd.json is exactly the case a first-start import must survive
  // rather than failing the whole transaction. The upsert makes the later
  // document win.
  test('upserts on a duplicate legacy cacheKey instead of throwing, and the later document wins', () => {
    expect(
      run([
        cacheDocument({
          updatePolicyOverrides: { maturityMode: 'mature' },
          expiresAt: 1_000,
        }),
        cacheDocument({
          updatePolicyOverrides: { maturityMode: 'all' },
          expiresAt: 2_000,
        }),
      ]),
    ).toBe(2);

    expect(db.prepare('SELECT COUNT(*) AS n FROM update_policy_retention_cache').get()).toEqual({
      n: 1,
    });
    expect(
      db
        .prepare('SELECT update_policy_overrides, expires_at FROM update_policy_retention_cache')
        .get(),
    ).toEqual({
      update_policy_overrides: '{"maturityMode":"all"}',
      expires_at: 2_000,
    });
  });
});
