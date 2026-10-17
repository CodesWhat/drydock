/**
 * Tests for the update-lifecycle-cache store — the durable backing for
 * container.ts's in-memory updateLifecycleCache Map (#556).
 */
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as updateLifecycleCache from './update-lifecycle-cache.js';

let db: Database;

beforeEach(() => {
  db = createMigratedMemoryDatabase();
  updateLifecycleCache.clearCollectionForTesting();
});

afterEach(() => {
  db.close();
});

describe('createCollections', () => {
  test('wires the store to the given database', () => {
    updateLifecycleCache.createCollections(db);
    expect(() =>
      updateLifecycleCache.upsertRecord({
        cacheKey: '::local::myapp',
        updateDetectedAt: '2026-01-01T00:00:00.000Z',
        resultSignature: '{}',
        expiresAt: 1_000,
      }),
    ).not.toThrow();
    expect(updateLifecycleCache.listRecords()).toHaveLength(1);
  });
});

describe('upsertRecord', () => {
  test('inserts a new record when none exists for the cacheKey', () => {
    updateLifecycleCache.createCollections(db);

    updateLifecycleCache.upsertRecord({
      cacheKey: '::local::myapp',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      firstSeenAt: '2025-12-01T00:00:00.000Z',
      maturityGatePendingSince: '2026-01-01T00:00:00.000Z',
      resultSignature: '{"tag":"v2"}',
      expiresAt: 1_000,
    });

    expect(updateLifecycleCache.listRecords()).toEqual([
      {
        cacheKey: '::local::myapp',
        updateDetectedAt: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2025-12-01T00:00:00.000Z',
        maturityGatePendingSince: '2026-01-01T00:00:00.000Z',
        resultSignature: '{"tag":"v2"}',
        expiresAt: 1_000,
      },
    ]);
  });

  test('inserts a record with no firstSeenAt/maturityGatePendingSince as absent fields', () => {
    updateLifecycleCache.createCollections(db);

    updateLifecycleCache.upsertRecord({
      cacheKey: '::local::myapp',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 1_000,
    });

    const [record] = updateLifecycleCache.listRecords();
    expect(record.firstSeenAt).toBeUndefined();
    expect(record.maturityGatePendingSince).toBeUndefined();
  });

  test('updates fields in place on a second call for the same cacheKey', () => {
    updateLifecycleCache.createCollections(db);

    updateLifecycleCache.upsertRecord({
      cacheKey: '::local::myapp',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{"tag":"v2"}',
      expiresAt: 1_000,
    });
    updateLifecycleCache.upsertRecord({
      cacheKey: '::local::myapp',
      updateDetectedAt: '2026-01-02T00:00:00.000Z',
      resultSignature: '{"tag":"v3"}',
      expiresAt: 2_000,
    });

    const records = updateLifecycleCache.listRecords();
    expect(records).toHaveLength(1);
    expect(records[0].updateDetectedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(records[0].resultSignature).toBe('{"tag":"v3"}');
    expect(records[0].expiresAt).toBe(2_000);
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() =>
      updateLifecycleCache.upsertRecord({
        cacheKey: '::local::myapp',
        updateDetectedAt: '2026-01-01T00:00:00.000Z',
        resultSignature: '{}',
        expiresAt: 1_000,
      }),
    ).not.toThrow();
    expect(updateLifecycleCache.listRecords()).toEqual([]);
  });
});

describe('deleteRecord', () => {
  test('removes the record for the given cacheKey', () => {
    updateLifecycleCache.createCollections(db);
    updateLifecycleCache.upsertRecord({
      cacheKey: '::local::myapp',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 1_000,
    });

    updateLifecycleCache.deleteRecord('::local::myapp');

    expect(updateLifecycleCache.listRecords()).toEqual([]);
  });

  test('is a no-op when no record exists for the cacheKey', () => {
    updateLifecycleCache.createCollections(db);

    expect(() => updateLifecycleCache.deleteRecord('never-stashed')).not.toThrow();
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() => updateLifecycleCache.deleteRecord('::local::myapp')).not.toThrow();
  });
});

describe('listRecords', () => {
  test('returns an empty array when the collection has not been initialized', () => {
    expect(updateLifecycleCache.listRecords()).toEqual([]);
  });

  test('returns every persisted record', () => {
    updateLifecycleCache.createCollections(db);
    updateLifecycleCache.upsertRecord({
      cacheKey: '::local::app-1',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 1_000,
    });
    updateLifecycleCache.upsertRecord({
      cacheKey: '::local::app-2',
      updateDetectedAt: '2026-01-02T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 2_000,
    });

    expect(updateLifecycleCache.listRecords()).toHaveLength(2);
  });

  // Finding 2 (roadmap 7-STORE slice 7 review): container.ts's eviction reads
  // Map insertion order as its LRU, and rehydration inserts into that Map in
  // listRecords() order. A refresh (upsertRecord on an existing cacheKey)
  // does not move the row's rowid, so without an explicit refresh_order
  // column and ORDER BY, a just-refreshed entry could sort ahead of a row it
  // should have outlived.
  test('orders by refresh, not by original insertion: insert A, insert B, refresh A, and B lists first', () => {
    updateLifecycleCache.createCollections(db);
    updateLifecycleCache.upsertRecord({
      cacheKey: 'A',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 1_000,
    });
    updateLifecycleCache.upsertRecord({
      cacheKey: 'B',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 1_000,
    });
    // Refresh A: same cacheKey, later call. If order were still driven by the
    // original INSERT (rowid) or by a repeated key not moving position, A
    // would wrongly list ahead of B here.
    updateLifecycleCache.upsertRecord({
      cacheKey: 'A',
      updateDetectedAt: '2026-01-02T00:00:00.000Z',
      resultSignature: '{"tag":"refreshed"}',
      expiresAt: 2_000,
    });

    // Reopen: simulate a restart by clearing the module's wiring and
    // re-wiring it to the SAME underlying database, the way
    // rehydrateUpdateLifecycleCacheFromStore() consumes listRecords() after a
    // real process restart.
    updateLifecycleCache.clearCollectionForTesting();
    updateLifecycleCache.createCollections(db);

    const keysInOrder = updateLifecycleCache.listRecords().map((record) => record.cacheKey);
    // B was never refreshed again, so it is the least-recently-refreshed
    // entry and must sort first — the Map-insertion-order eviction in
    // container.ts evicts index 0 first, which must be B, not A.
    expect(keysInOrder).toEqual(['B', 'A']);
  });
});

describe('clearCollectionForTesting', () => {
  test('resets the module back to the uninitialized state', () => {
    updateLifecycleCache.createCollections(db);
    updateLifecycleCache.upsertRecord({
      cacheKey: '::local::myapp',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 1_000,
    });
    expect(updateLifecycleCache.listRecords()).toHaveLength(1);

    updateLifecycleCache.clearCollectionForTesting();

    expect(updateLifecycleCache.listRecords()).toEqual([]);
    expect(() =>
      updateLifecycleCache.upsertRecord({
        cacheKey: '::local::myapp',
        updateDetectedAt: '2026-01-01T00:00:00.000Z',
        resultSignature: '{}',
        expiresAt: 1_000,
      }),
    ).not.toThrow();
    expect(updateLifecycleCache.listRecords()).toEqual([]); // still a no-op post-clear
  });
});
