/**
 * Tests for the update-policy-retention-cache store — the durable backing for
 * container.ts's in-memory updatePolicyRetentionCache Map (#565).
 */
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as updatePolicyRetentionCache from './update-policy-retention-cache.js';

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
