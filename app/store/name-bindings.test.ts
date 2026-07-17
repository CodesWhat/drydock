/**
 * Tests for the name-bindings store — the durable backing for portwing-ws.ts's
 * in-memory nameToKeyId identity-binding cache (squat/theft prevention).
 */
import * as nameBindings from './name-bindings.js';

const { mockLogInfo } = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({ info: mockLogInfo, warn: vi.fn(), debug: vi.fn() })),
  },
}));

function createMockCollection(initialDocs: nameBindings.NameBindingRecord[] = []) {
  const docs = [...initialDocs];
  return {
    docs,
    findOne: vi.fn((query: Record<string, unknown>): nameBindings.NameBindingRecord | null => {
      const match = docs.find((doc) => {
        return Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v);
      });
      return match ?? null;
    }),
    find: vi.fn((query?: Record<string, unknown>): nameBindings.NameBindingRecord[] => {
      if (!query || Object.keys(query).length === 0) {
        return [...docs];
      }
      return docs.filter((doc) =>
        Object.entries(query).every(([k, v]) => (doc as Record<string, unknown>)[k] === v),
      );
    }),
    insert: vi.fn((doc: nameBindings.NameBindingRecord) => {
      docs.push(doc);
    }),
    update: vi.fn(),
    remove: vi.fn((doc: nameBindings.NameBindingRecord) => {
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
  nameBindings.clearCollectionForTesting();
});

describe('createCollections', () => {
  test('uses existing collection when present', () => {
    const collection = createMockCollection();
    const db = createMockDb(collection);
    nameBindings.createCollections(db);
    expect(db.addCollection).not.toHaveBeenCalled();
  });

  test('creates collection when not present', () => {
    const collection = createMockCollection();
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collection),
    };
    nameBindings.createCollections(db);
    expect(db.addCollection).toHaveBeenCalled();
  });
});

describe('upsertBinding', () => {
  test('inserts a new binding when none exists for the name', () => {
    const collection = createMockCollection();
    nameBindings.createCollections(createMockDb(collection));

    nameBindings.upsertBinding('edge-node-1', 'aabbccddeeff0011', 1_000);

    expect(collection.insert).toHaveBeenCalledWith({
      agentName: 'edge-node-1',
      keyId: 'aabbccddeeff0011',
      lastSeenAt: 1_000,
    });
    expect(nameBindings.listBindings()).toHaveLength(1);
  });

  test('updates keyId and lastSeenAt in place on a second call for the same name', () => {
    const collection = createMockCollection();
    nameBindings.createCollections(createMockDb(collection));

    nameBindings.upsertBinding('edge-node-1', 'aabbccddeeff0011', 1_000);
    nameBindings.upsertBinding('edge-node-1', 'aabbccddeeff0011', 2_000);

    expect(collection.insert).toHaveBeenCalledTimes(1);
    expect(collection.update).toHaveBeenCalledTimes(1);
    const [binding] = nameBindings.listBindings();
    expect(binding.lastSeenAt).toBe(2_000);
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() =>
      nameBindings.upsertBinding('edge-node-1', 'aabbccddeeff0011', 1_000),
    ).not.toThrow();
    expect(nameBindings.listBindings()).toEqual([]);
  });
});

describe('deleteBinding', () => {
  test('removes the binding for the given name', () => {
    const collection = createMockCollection();
    nameBindings.createCollections(createMockDb(collection));
    nameBindings.upsertBinding('edge-node-1', 'aabbccddeeff0011', 1_000);

    nameBindings.deleteBinding('edge-node-1');

    expect(collection.remove).toHaveBeenCalledTimes(1);
    expect(nameBindings.listBindings()).toEqual([]);
  });

  test('is a no-op when no binding exists for the name', () => {
    const collection = createMockCollection();
    nameBindings.createCollections(createMockDb(collection));

    expect(() => nameBindings.deleteBinding('never-bound')).not.toThrow();
    expect(collection.remove).not.toHaveBeenCalled();
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() => nameBindings.deleteBinding('edge-node-1')).not.toThrow();
  });
});

describe('deleteBindingsForKey', () => {
  test('removes every binding owned by keyId and returns their names', () => {
    const collection = createMockCollection();
    nameBindings.createCollections(createMockDb(collection));
    nameBindings.upsertBinding('edge-node-1', 'keyA', 1_000);
    nameBindings.upsertBinding('edge-node-2', 'keyA', 1_000);
    nameBindings.upsertBinding('edge-node-3', 'keyB', 1_000);

    const released = nameBindings.deleteBindingsForKey('keyA');

    expect(released.sort()).toEqual(['edge-node-1', 'edge-node-2']);
    expect(nameBindings.listBindings()).toEqual([
      { agentName: 'edge-node-3', keyId: 'keyB', lastSeenAt: 1_000 },
    ]);
  });

  test('returns an empty array and does nothing when keyId owns no bindings', () => {
    const collection = createMockCollection();
    nameBindings.createCollections(createMockDb(collection));

    expect(nameBindings.deleteBindingsForKey('unknown-key')).toEqual([]);
  });

  test('returns an empty array when the collection has not been initialized', () => {
    expect(nameBindings.deleteBindingsForKey('keyA')).toEqual([]);
  });
});

describe('listBindings', () => {
  test('returns an empty array when the collection has not been initialized', () => {
    expect(nameBindings.listBindings()).toEqual([]);
  });

  test('returns every persisted binding', () => {
    const collection = createMockCollection();
    nameBindings.createCollections(createMockDb(collection));
    nameBindings.upsertBinding('edge-node-1', 'keyA', 1_000);
    nameBindings.upsertBinding('edge-node-2', 'keyB', 2_000);

    expect(nameBindings.listBindings()).toHaveLength(2);
  });
});

describe('clearCollectionForTesting', () => {
  test('resets the module back to the uninitialized state', () => {
    const collection = createMockCollection();
    nameBindings.createCollections(createMockDb(collection));
    nameBindings.upsertBinding('edge-node-1', 'keyA', 1_000);
    expect(nameBindings.listBindings()).toHaveLength(1);

    nameBindings.clearCollectionForTesting();

    expect(nameBindings.listBindings()).toEqual([]);
    expect(() => nameBindings.upsertBinding('edge-node-1', 'keyA', 1_000)).not.toThrow();
    expect(nameBindings.listBindings()).toEqual([]); // still a no-op post-clear
  });
});
