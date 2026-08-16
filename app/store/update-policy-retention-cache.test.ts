/**
 * Tests for the update-policy-retention-cache store — the durable backing for
 * container.ts's in-memory updatePolicyRetentionCache Map (#565).
 */
import * as updatePolicyRetentionCache from './update-policy-retention-cache.js';

function createMockCollection(
  initialDocs: updatePolicyRetentionCache.UpdatePolicyRetentionCacheRecord[] = [],
) {
  const docs = [...initialDocs];
  return {
    docs,
    findOne: vi.fn(
      (
        query: Record<string, unknown>,
      ): updatePolicyRetentionCache.UpdatePolicyRetentionCacheRecord | null => {
        const match = docs.find((doc) => {
          return Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v);
        });
        return match ?? null;
      },
    ),
    find: vi.fn(
      (
        query?: Record<string, unknown>,
      ): updatePolicyRetentionCache.UpdatePolicyRetentionCacheRecord[] => {
        if (!query || Object.keys(query).length === 0) {
          return [...docs];
        }
        return docs.filter((doc) =>
          Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
        );
      },
    ),
    insert: vi.fn((doc: updatePolicyRetentionCache.UpdatePolicyRetentionCacheRecord) => {
      docs.push(doc);
    }),
    update: vi.fn(),
    remove: vi.fn((doc: updatePolicyRetentionCache.UpdatePolicyRetentionCacheRecord) => {
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
  updatePolicyRetentionCache.clearCollectionForTesting();
});

describe('createCollections', () => {
  test('uses existing collection when present', () => {
    const collection = createMockCollection();
    const db = createMockDb(collection);
    updatePolicyRetentionCache.createCollections(db);
    expect(db.addCollection).not.toHaveBeenCalled();
  });

  test('creates collection when not present', () => {
    const collection = createMockCollection();
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collection),
    };
    updatePolicyRetentionCache.createCollections(db);
    expect(db.addCollection).toHaveBeenCalled();
  });
});

describe('upsertRecord', () => {
  test('inserts a new record when none exists for the cacheKey', () => {
    const collection = createMockCollection();
    updatePolicyRetentionCache.createCollections(createMockDb(collection));

    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::myapp',
      updatePolicyOverrides: { maturityMode: 'mature', maturityMinAgeDays: 5 },
      expiresAt: 1_000,
    });

    expect(collection.insert).toHaveBeenCalledWith({
      cacheKey: '::local::myapp',
      updatePolicyOverrides: { maturityMode: 'mature', maturityMinAgeDays: 5 },
      expiresAt: 1_000,
    });
    expect(updatePolicyRetentionCache.listRecords()).toHaveLength(1);
  });

  test('updates fields in place on a second call for the same cacheKey', () => {
    const collection = createMockCollection();
    updatePolicyRetentionCache.createCollections(createMockDb(collection));

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

    expect(collection.insert).toHaveBeenCalledTimes(1);
    expect(collection.update).toHaveBeenCalledTimes(1);
    const [record] = updatePolicyRetentionCache.listRecords();
    expect(record.updatePolicyOverrides).toEqual({ maturityMode: 'all' });
    expect(record.expiresAt).toBe(2_000);
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() =>
      updatePolicyRetentionCache.upsertRecord({
        cacheKey: '::local::myapp',
        updatePolicyOverrides: {},
        expiresAt: 1_000,
      }),
    ).not.toThrow();
    expect(updatePolicyRetentionCache.listRecords()).toEqual([]);
  });
});

describe('deleteRecord', () => {
  test('removes the record for the given cacheKey', () => {
    const collection = createMockCollection();
    updatePolicyRetentionCache.createCollections(createMockDb(collection));
    updatePolicyRetentionCache.upsertRecord({
      cacheKey: '::local::myapp',
      updatePolicyOverrides: { maturityMode: 'mature' },
      expiresAt: 1_000,
    });

    updatePolicyRetentionCache.deleteRecord('::local::myapp');

    expect(collection.remove).toHaveBeenCalledTimes(1);
    expect(updatePolicyRetentionCache.listRecords()).toEqual([]);
  });

  test('is a no-op when no record exists for the cacheKey', () => {
    const collection = createMockCollection();
    updatePolicyRetentionCache.createCollections(createMockDb(collection));

    expect(() => updatePolicyRetentionCache.deleteRecord('never-stashed')).not.toThrow();
    expect(collection.remove).not.toHaveBeenCalled();
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() => updatePolicyRetentionCache.deleteRecord('::local::myapp')).not.toThrow();
  });
});

describe('listRecords', () => {
  test('returns an empty array when the collection has not been initialized', () => {
    expect(updatePolicyRetentionCache.listRecords()).toEqual([]);
  });

  test('returns every persisted record', () => {
    const collection = createMockCollection();
    updatePolicyRetentionCache.createCollections(createMockDb(collection));
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
    const collection = createMockCollection();
    updatePolicyRetentionCache.createCollections(createMockDb(collection));
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
