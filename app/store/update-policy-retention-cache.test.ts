/**
 * Tests for the update-policy-retention-cache store — the durable backing for
 * container.ts's in-memory updatePolicyRetentionCache Map (#565).
 */
import { createMemoryDatabase, createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import { MIGRATIONS, migrate } from './db/migrations.js';
import * as updatePolicyRetentionCache from './update-policy-retention-cache.js';

const CONTAINER_NAME_MIGRATION_VERSION = 5;

let db: Database;

beforeEach(() => {
  db = createMigratedMemoryDatabase();
  updatePolicyRetentionCache.clearCollectionForTesting();
});

afterEach(() => {
  db.close();
});

describe('createCollections', () => {
  test('wires the store to the given database', () => {
    updatePolicyRetentionCache.createCollections(db);
    expect(() =>
      updatePolicyRetentionCache.upsertRecord({
        cacheKey: '::local::myapp',
        updatePolicyOverrides: { maturityMode: 'mature' },
        expiresAt: 1_000,
      }),
    ).not.toThrow();
    expect(updatePolicyRetentionCache.listRecords()).toHaveLength(1);
  });
});

describe('upsertRecord', () => {
  test('inserts a new record when none exists for the cacheKey', () => {
    updatePolicyRetentionCache.createCollections(db);

    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::myapp',
      updatePolicyOverrides: { maturityMode: 'mature', maturityMinAgeDays: 5 },
      expiresAt: 1_000,
    });

    expect(updatePolicyRetentionCache.listRecords()).toEqual([
      {
        cacheKey: '::local::myapp',
        updatePolicyOverrides: { maturityMode: 'mature', maturityMinAgeDays: 5 },
        expiresAt: 1_000,
      },
    ]);
  });

  test('updates fields in place on a second call for the same cacheKey', () => {
    updatePolicyRetentionCache.createCollections(db);

    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::myapp',
      updatePolicyOverrides: { maturityMode: 'mature' },
      expiresAt: 1_000,
    });
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::myapp',
      updatePolicyOverrides: { maturityMode: 'all' },
      expiresAt: 2_000,
    });

    const records = updatePolicyRetentionCache.listRecords();
    expect(records).toHaveLength(1);
    expect(records[0].updatePolicyOverrides).toEqual({ maturityMode: 'all' });
    expect(records[0].expiresAt).toBe(2_000);
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() =>
      updatePolicyRetentionCache.upsertRecord({
        cacheKey: '::local::myapp',
        updatePolicyOverrides: { maturityMode: 'mature' },
        expiresAt: 1_000,
      }),
    ).not.toThrow();
    expect(updatePolicyRetentionCache.listRecords()).toEqual([]);
  });

  test('stores an explicit undefined updatePolicyOverrides as NULL', () => {
    updatePolicyRetentionCache.createCollections(db);

    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::myapp',
      updatePolicyOverrides: undefined,
      expiresAt: 1_000,
    });

    expect(
      db.prepare('SELECT update_policy_overrides FROM update_policy_retention_cache').get(),
    ).toEqual({ update_policy_overrides: null });
  });
});

describe('deleteRecord', () => {
  test('removes the record for the given cacheKey', () => {
    updatePolicyRetentionCache.createCollections(db);
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::myapp',
      updatePolicyOverrides: { maturityMode: 'mature' },
      expiresAt: 1_000,
    });

    updatePolicyRetentionCache.deleteRecord('::local::myapp');

    expect(updatePolicyRetentionCache.listRecords()).toEqual([]);
  });

  test('is a no-op when no record exists for the cacheKey', () => {
    updatePolicyRetentionCache.createCollections(db);

    expect(() => updatePolicyRetentionCache.deleteRecord('never-stashed')).not.toThrow();
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() => updatePolicyRetentionCache.deleteRecord('::local::myapp')).not.toThrow();
  });
});

describe('listRecords', () => {
  test('returns an empty array when the collection has not been initialized', () => {
    expect(updatePolicyRetentionCache.listRecords()).toEqual([]);
  });

  test('reads a NULL update_policy_overrides column back as undefined', () => {
    updatePolicyRetentionCache.createCollections(db);
    db.prepare(
      'INSERT INTO update_policy_retention_cache (cache_key, update_policy_overrides, expires_at) VALUES (?, ?, ?)',
    ).run('::local::raw-row', null, 1_000);

    const [record] = updatePolicyRetentionCache.listRecords();
    expect(record.updatePolicyOverrides).toBeUndefined();
  });

  test('returns every persisted record', () => {
    updatePolicyRetentionCache.createCollections(db);
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::app-1',
      updatePolicyOverrides: { maturityMode: 'mature' },
      expiresAt: 1_000,
    });
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::app-2',
      updatePolicyOverrides: { maturityMode: 'all' },
      expiresAt: 2_000,
    });

    expect(updatePolicyRetentionCache.listRecords()).toHaveLength(2);
  });

  // Finding 2 (roadmap 7-STORE slice 7 review): container.ts's eviction reads
  // Map insertion order as its LRU, and rehydration inserts into that Map in
  // listRecords() order. A refresh (upsertRecord on an existing cacheKey)
  // does not move the row's rowid, so without an explicit refresh_order
  // column and ORDER BY, a just-refreshed entry could sort ahead of a row it
  // should have outlived. This also proves the ordering is not merely an
  // expiresAt proxy: A's expiresAt stays lower than B's throughout, yet A
  // still lists last once refreshed.
  test('orders by refresh, not by expiresAt or original insertion: insert A, insert B, refresh A, and B lists first', () => {
    updatePolicyRetentionCache.createCollections(db);
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: 'A',
      updatePolicyOverrides: { maturityMode: 'mature' },
      expiresAt: 1_000,
    });
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: 'B',
      updatePolicyOverrides: { maturityMode: 'mature' },
      expiresAt: 5_000,
    });
    // Refresh A: same cacheKey, later call, still a lower expiresAt than B.
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: 'A',
      updatePolicyOverrides: { maturityMode: 'all' },
      expiresAt: 2_000,
    });

    // Reopen: simulate a restart by clearing the module's wiring and
    // re-wiring it to the SAME underlying database, the way
    // rehydrateUpdatePolicyRetentionCacheFromStore() consumes listRecords()
    // after a real process restart.
    updatePolicyRetentionCache.clearCollectionForTesting();
    updatePolicyRetentionCache.createCollections(db);

    const keysInOrder = updatePolicyRetentionCache.listRecords().map((record) => record.cacheKey);
    // B was never refreshed again, so it is the least-recently-refreshed
    // entry and must sort first — the Map-insertion-order eviction in
    // container.ts evicts index 0 first, which must be B, not A.
    expect(keysInOrder).toEqual(['B', 'A']);
  });
});

// #1280: the canonical name of the container a stash came from, which tells compose
// replicas sharing one identity key apart.
describe('containerName', () => {
  test('persists the container name and reads it back', () => {
    updatePolicyRetentionCache.createCollections(db);
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: 'agent1::local::compose:stack/web',
      updatePolicyOverrides: { maturityMode: 'mature' },
      expiresAt: 1_000,
      containerName: 'stack-web-2',
    });

    expect(updatePolicyRetentionCache.listRecords()).toEqual([
      {
        cacheKey: 'agent1::local::compose:stack/web',
        updatePolicyOverrides: { maturityMode: 'mature' },
        expiresAt: 1_000,
        containerName: 'stack-web-2',
      },
    ]);
  });

  test('a refresh replaces the recorded name, and a refresh without one clears it', () => {
    updatePolicyRetentionCache.createCollections(db);
    const base = {
      cacheKey: 'agent1::local::compose:stack/web',
      updatePolicyOverrides: { maturityMode: 'mature' },
      expiresAt: 1_000,
    };
    updatePolicyRetentionCache.upsertRecord({ ...base, containerName: 'stack-web-1' });
    updatePolicyRetentionCache.upsertRecord({ ...base, containerName: 'stack-web-2' });
    expect(updatePolicyRetentionCache.listRecords()[0].containerName).toBe('stack-web-2');

    updatePolicyRetentionCache.upsertRecord(base);
    expect(updatePolicyRetentionCache.listRecords()[0]).not.toHaveProperty('containerName');
  });

  test('a record without a name lists without one', () => {
    updatePolicyRetentionCache.createCollections(db);
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::myapp',
      updatePolicyOverrides: { maturityMode: 'mature' },
      expiresAt: 1_000,
    });

    expect(updatePolicyRetentionCache.listRecords()[0]).not.toHaveProperty('containerName');
  });

  // A database written before the column existed upgrades in place: its rows read back
  // with no name, which container.ts treats as a legacy entry.
  test('a row stored before the column existed reads back without a name after migrating', () => {
    const legacyDb = createMemoryDatabase();
    migrate(
      legacyDb,
      MIGRATIONS.filter((migration) => migration.version < CONTAINER_NAME_MIGRATION_VERSION),
    );
    legacyDb
      .prepare(
        'INSERT INTO update_policy_retention_cache (cache_key, update_policy_overrides, expires_at, refresh_order) VALUES (?, ?, ?, ?)',
      )
      .run('agent1::local::compose:stack/web', '{"maturityMode":"mature"}', 1_000, 1);

    expect(migrate(legacyDb)).toEqual([CONTAINER_NAME_MIGRATION_VERSION]);
    updatePolicyRetentionCache.createCollections(legacyDb);

    expect(updatePolicyRetentionCache.listRecords()).toEqual([
      {
        cacheKey: 'agent1::local::compose:stack/web',
        updatePolicyOverrides: { maturityMode: 'mature' },
        expiresAt: 1_000,
      },
    ]);
    expect(updatePolicyRetentionCache.listRecords()[0]).not.toHaveProperty('containerName');
    legacyDb.close();
  });
});

describe('clearCollectionForTesting', () => {
  test('resets the module back to the uninitialized state', () => {
    updatePolicyRetentionCache.createCollections(db);
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::myapp',
      updatePolicyOverrides: { maturityMode: 'mature' },
      expiresAt: 1_000,
    });
    expect(updatePolicyRetentionCache.listRecords()).toHaveLength(1);

    updatePolicyRetentionCache.clearCollectionForTesting();

    expect(updatePolicyRetentionCache.listRecords()).toEqual([]);
    expect(() =>
      updatePolicyRetentionCache.upsertRecord({
        cacheKey: '::local::myapp',
        updatePolicyOverrides: { maturityMode: 'mature' },
        expiresAt: 1_000,
      }),
    ).not.toThrow();
    expect(updatePolicyRetentionCache.listRecords()).toEqual([]); // still a no-op post-clear
  });
});
