/**
 * Tests for the update-lifecycle-cache store — the durable backing for
 * container.ts's in-memory updateLifecycleCache Map (#556).
 */
import * as updateLifecycleCache from './update-lifecycle-cache.js';

function createMockCollection(initialDocs: updateLifecycleCache.UpdateLifecycleCacheRecord[] = []) {
  const docs = [...initialDocs];
  return {
    docs,
    findOne: vi.fn(
      (query: Record<string, unknown>): updateLifecycleCache.UpdateLifecycleCacheRecord | null => {
        const match = docs.find((doc) => {
          return Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v);
        });
        return match ?? null;
      },
    ),
    find: vi.fn(
      (query?: Record<string, unknown>): updateLifecycleCache.UpdateLifecycleCacheRecord[] => {
        if (!query || Object.keys(query).length === 0) {
          return [...docs];
        }
        return docs.filter((doc) =>
          Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
        );
      },
    ),
    insert: vi.fn((doc: updateLifecycleCache.UpdateLifecycleCacheRecord) => {
      docs.push(doc);
    }),
    update: vi.fn(),
    remove: vi.fn((doc: updateLifecycleCache.UpdateLifecycleCacheRecord) => {
      const index = docs.indexOf(doc);
      if (index !== -1) {
        docs.splice(index, 1);
      }
    }),
  };
}

function createMockDb(collection = createMockCollection()) {
  return {
    getCollection: vi.fn(() => collection),
    addCollection: vi.fn(() => collection),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateLifecycleCache.clearCollectionForTesting();
});

describe('createCollections', () => {
  test('uses existing collection when present', () => {
    const collection = createMockCollection();
    const db = createMockDb(collection);
    updateLifecycleCache.createCollections(db);
    expect(db.addCollection).not.toHaveBeenCalled();
  });

  test('creates collection when not present', () => {
    const collection = createMockCollection();
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collection),
    };
    updateLifecycleCache.createCollections(db);
    expect(db.addCollection).toHaveBeenCalled();
  });
});

describe('upsertRecord', () => {
  test('inserts a new record when none exists for the cacheKey', () => {
    const collection = createMockCollection();
    updateLifecycleCache.createCollections(createMockDb(collection));

    updateLifecycleCache.upsertRecord({
      cacheKey: 'local::myapp',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      firstSeenAt: '2025-12-01T00:00:00.000Z',
      maturityGatePendingSince: '2026-01-01T00:00:00.000Z',
      resultSignature: '{"tag":"v2"}',
      expiresAt: 1_000,
    });

    expect(collection.insert).toHaveBeenCalledWith({
      cacheKey: 'local::myapp',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      firstSeenAt: '2025-12-01T00:00:00.000Z',
      maturityGatePendingSince: '2026-01-01T00:00:00.000Z',
      resultSignature: '{"tag":"v2"}',
      expiresAt: 1_000,
    });
    expect(updateLifecycleCache.listRecords()).toHaveLength(1);
  });

  test('updates fields in place on a second call for the same cacheKey', () => {
    const collection = createMockCollection();
    updateLifecycleCache.createCollections(createMockDb(collection));

    updateLifecycleCache.upsertRecord({
      cacheKey: 'local::myapp',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{"tag":"v2"}',
      expiresAt: 1_000,
    });
    updateLifecycleCache.upsertRecord({
      cacheKey: 'local::myapp',
      updateDetectedAt: '2026-01-02T00:00:00.000Z',
      resultSignature: '{"tag":"v3"}',
      expiresAt: 2_000,
    });

    expect(collection.insert).toHaveBeenCalledTimes(1);
    expect(collection.update).toHaveBeenCalledTimes(1);
    const [record] = updateLifecycleCache.listRecords();
    expect(record.updateDetectedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(record.resultSignature).toBe('{"tag":"v3"}');
    expect(record.expiresAt).toBe(2_000);
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() =>
      updateLifecycleCache.upsertRecord({
        cacheKey: 'local::myapp',
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
    const collection = createMockCollection();
    updateLifecycleCache.createCollections(createMockDb(collection));
    updateLifecycleCache.upsertRecord({
      cacheKey: 'local::myapp',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 1_000,
    });

    updateLifecycleCache.deleteRecord('local::myapp');

    expect(collection.remove).toHaveBeenCalledTimes(1);
    expect(updateLifecycleCache.listRecords()).toEqual([]);
  });

  test('is a no-op when no record exists for the cacheKey', () => {
    const collection = createMockCollection();
    updateLifecycleCache.createCollections(createMockDb(collection));

    expect(() => updateLifecycleCache.deleteRecord('never-stashed')).not.toThrow();
    expect(collection.remove).not.toHaveBeenCalled();
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() => updateLifecycleCache.deleteRecord('local::myapp')).not.toThrow();
  });
});

describe('listRecords', () => {
  test('returns an empty array when the collection has not been initialized', () => {
    expect(updateLifecycleCache.listRecords()).toEqual([]);
  });

  test('returns every persisted record', () => {
    const collection = createMockCollection();
    updateLifecycleCache.createCollections(createMockDb(collection));
    updateLifecycleCache.upsertRecord({
      cacheKey: 'local::app-1',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 1_000,
    });
    updateLifecycleCache.upsertRecord({
      cacheKey: 'local::app-2',
      updateDetectedAt: '2026-01-02T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 2_000,
    });

    expect(updateLifecycleCache.listRecords()).toHaveLength(2);
  });
});

describe('clearCollectionForTesting', () => {
  test('resets the module back to the uninitialized state', () => {
    const collection = createMockCollection();
    updateLifecycleCache.createCollections(createMockDb(collection));
    updateLifecycleCache.upsertRecord({
      cacheKey: 'local::myapp',
      updateDetectedAt: '2026-01-01T00:00:00.000Z',
      resultSignature: '{}',
      expiresAt: 1_000,
    });
    expect(updateLifecycleCache.listRecords()).toHaveLength(1);

    updateLifecycleCache.clearCollectionForTesting();

    expect(updateLifecycleCache.listRecords()).toEqual([]);
    expect(() =>
      updateLifecycleCache.upsertRecord({
        cacheKey: 'local::myapp',
        updateDetectedAt: '2026-01-01T00:00:00.000Z',
        resultSignature: '{}',
        expiresAt: 1_000,
      }),
    ).not.toThrow();
    expect(updateLifecycleCache.listRecords()).toEqual([]); // still a no-op post-clear
  });
});
