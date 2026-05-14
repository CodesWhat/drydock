import * as secrets from './secrets.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));

function createCollection(initialValue: Record<string, unknown> | null = null) {
  let value: Record<string, unknown> | null = initialValue;
  return {
    findOne: vi.fn(() => value),
    insert: vi.fn((nextValue) => {
      value = nextValue;
    }),
    remove: vi.fn((valueToRemove) => {
      if (valueToRemove === value) {
        value = null;
      }
    }),
  };
}

describe('Secrets Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  test('getStoredSessionSecret returns null when createCollections has never been called', async () => {
    const freshSecrets = await import('./secrets.js');
    expect(freshSecrets.getStoredSessionSecret()).toBeNull();
  });

  test('createCollections creates the secrets collection when it does not exist', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collection),
    };

    secrets.createCollections(db);

    expect(db.addCollection).toHaveBeenCalledWith('secrets');
  });

  test('createCollections uses existing collection when already present', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    secrets.createCollections(db);

    expect(db.addCollection).not.toHaveBeenCalled();
  });

  test('getStoredSessionSecret returns null when collection has no document', () => {
    const collection = createCollection(null);
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    secrets.createCollections(db);

    expect(secrets.getStoredSessionSecret()).toBeNull();
  });

  test('getStoredSessionSecret returns null when document has no sessionSecret', () => {
    const collection = createCollection({});
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    secrets.createCollections(db);

    expect(secrets.getStoredSessionSecret()).toBeNull();
  });

  test('getStoredSessionSecret returns the stored value when one exists', () => {
    const collection = createCollection({ sessionSecret: 'persisted-secret' });
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    secrets.createCollections(db);

    expect(secrets.getStoredSessionSecret()).toBe('persisted-secret');
  });

  test('setStoredSessionSecret inserts a document when none exists', () => {
    const collection = createCollection(null);
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    secrets.createCollections(db);
    secrets.setStoredSessionSecret('new-secret');

    expect(collection.insert).toHaveBeenCalledWith({ sessionSecret: 'new-secret' });
    expect(collection.remove).not.toHaveBeenCalled();
    expect(secrets.getStoredSessionSecret()).toBe('new-secret');
  });

  test('setStoredSessionSecret replaces an existing document', () => {
    const collection = createCollection({ sessionSecret: 'old-secret' });
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    secrets.createCollections(db);
    secrets.setStoredSessionSecret('new-secret');

    expect(collection.remove).toHaveBeenCalledWith({ sessionSecret: 'old-secret' });
    expect(collection.insert).toHaveBeenCalledWith({ sessionSecret: 'new-secret' });
    expect(secrets.getStoredSessionSecret()).toBe('new-secret');
  });

  test('setStoredSessionSecret is idempotent — multiple calls keep last value', () => {
    const collection = createCollection(null);
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    secrets.createCollections(db);
    secrets.setStoredSessionSecret('first-secret');
    secrets.setStoredSessionSecret('second-secret');

    expect(secrets.getStoredSessionSecret()).toBe('second-secret');
  });

  test('createCollections is idempotent — re-running does not duplicate collection', () => {
    const collection = createCollection(null);
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    secrets.createCollections(db);
    secrets.createCollections(db);

    // addCollection should never be called since getCollection returns non-null
    expect(db.addCollection).not.toHaveBeenCalled();
  });

  test('setStoredSessionSecret is a no-op when createCollections has not been called', async () => {
    vi.resetModules();
    const freshSecrets = await import('./secrets.js');

    // Should not throw
    expect(() => freshSecrets.setStoredSessionSecret('secret')).not.toThrow();
  });

  test('setStoredSessionSecret throws when value fails joi validation', () => {
    const collection = createCollection(null);
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(() => collection),
    };

    secrets.createCollections(db);

    // Empty string fails min(1) constraint
    expect(() => secrets.setStoredSessionSecret('')).toThrow();
  });
});
