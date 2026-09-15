/**
 * Tests for the name-bindings store — the durable backing for portwing-ws.ts's
 * in-memory nameToKeyId identity-binding cache (squat/theft prevention).
 */
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as nameBindings from './name-bindings.js';

vi.mock('../log/index.js', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
}));

let db: Database;

beforeEach(() => {
  db = createMigratedMemoryDatabase();
  nameBindings.clearCollectionForTesting();
});

afterEach(() => {
  db.close();
});

describe('createCollections', () => {
  test('wires the store to the given database', () => {
    nameBindings.createCollections(db);
    expect(() =>
      nameBindings.upsertBinding('edge-node-1', 'aabbccddeeff0011', 1_000),
    ).not.toThrow();
    expect(nameBindings.listBindings()).toHaveLength(1);
  });
});

describe('upsertBinding', () => {
  test('inserts a new binding when none exists for the name', () => {
    nameBindings.createCollections(db);

    nameBindings.upsertBinding('edge-node-1', 'aabbccddeeff0011', 1_000);

    expect(nameBindings.listBindings()).toEqual([
      { agentName: 'edge-node-1', keyId: 'aabbccddeeff0011', lastSeenAt: 1_000 },
    ]);
  });

  test('updates keyId and lastSeenAt in place on a second call for the same name', () => {
    nameBindings.createCollections(db);

    nameBindings.upsertBinding('edge-node-1', 'aabbccddeeff0011', 1_000);
    nameBindings.upsertBinding('edge-node-1', 'aabbccddeeff0011', 2_000);

    const bindings = nameBindings.listBindings();
    expect(bindings).toHaveLength(1);
    expect(bindings[0].lastSeenAt).toBe(2_000);
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
    nameBindings.createCollections(db);
    nameBindings.upsertBinding('edge-node-1', 'aabbccddeeff0011', 1_000);

    nameBindings.deleteBinding('edge-node-1');

    expect(nameBindings.listBindings()).toEqual([]);
  });

  test('is a no-op when no binding exists for the name', () => {
    nameBindings.createCollections(db);

    expect(() => nameBindings.deleteBinding('never-bound')).not.toThrow();
  });

  test('is a no-op when the collection has not been initialized', () => {
    expect(() => nameBindings.deleteBinding('edge-node-1')).not.toThrow();
  });
});

describe('deleteBindingsForKey', () => {
  test('removes every binding owned by keyId and returns their names', () => {
    nameBindings.createCollections(db);
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
    nameBindings.createCollections(db);

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
    nameBindings.createCollections(db);
    nameBindings.upsertBinding('edge-node-1', 'keyA', 1_000);
    nameBindings.upsertBinding('edge-node-2', 'keyB', 2_000);

    expect(nameBindings.listBindings()).toHaveLength(2);
  });
});

describe('clearCollectionForTesting', () => {
  test('resets the module back to the uninitialized state', () => {
    nameBindings.createCollections(db);
    nameBindings.upsertBinding('edge-node-1', 'keyA', 1_000);
    expect(nameBindings.listBindings()).toHaveLength(1);

    nameBindings.clearCollectionForTesting();

    expect(nameBindings.listBindings()).toEqual([]);
    expect(() => nameBindings.upsertBinding('edge-node-1', 'keyA', 1_000)).not.toThrow();
    expect(nameBindings.listBindings()).toEqual([]); // still a no-op post-clear
  });
});
