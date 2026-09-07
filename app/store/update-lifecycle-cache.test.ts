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
