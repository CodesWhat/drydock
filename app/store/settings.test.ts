import * as settings from './settings.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));

function createCollection(initialValue = null) {
  let value = initialValue;
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

describe('Settings Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('createCollections should create settings collection when it does not exist', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collection),
    };

    settings.createCollections(db);

    expect(db.addCollection).toHaveBeenCalledWith('settings');
    expect(collection.insert).toHaveBeenCalledWith({
      internetlessMode: false,
    });
  });

  test('createCollections should normalize existing settings', () => {
    const collection = createCollection({
      internetlessMode: true,
      unknown: 'value',
    });
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    settings.createCollections(db);

    expect(db.addCollection).not.toHaveBeenCalled();
    expect(collection.remove).toHaveBeenCalledWith({
      internetlessMode: true,
      unknown: 'value',
    });
    expect(collection.insert).toHaveBeenCalledWith({
      internetlessMode: true,
    });
  });

  test('getSettings should return defaults when empty', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    settings.createCollections(db);

    expect(settings.getSettings()).toEqual({
      internetlessMode: false,
    });
  });

  test('getSettings should fall back to defaults when stored document is missing', () => {
    const collection = {
      findOne: vi.fn(() => null),
      insert: vi.fn(),
      remove: vi.fn(),
    };
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    settings.createCollections(db);
    expect(settings.getSettings()).toEqual({
      internetlessMode: false,
    });
  });

  test('updateSettings should merge existing and update values', () => {
    const collection = createCollection({
      internetlessMode: false,
    });
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    settings.createCollections(db);
    const settingsUpdated = settings.updateSettings({
      internetlessMode: true,
    });

    expect(settingsUpdated).toEqual({
      internetlessMode: true,
    });
    expect(settings.getSettings()).toEqual({
      internetlessMode: true,
    });
  });

  test('updateSettings should support empty payload and keep current values', () => {
    const collection = createCollection({
      internetlessMode: true,
    });
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    settings.createCollections(db);
    const settingsUpdated = settings.updateSettings();
    expect(settingsUpdated).toEqual({
      internetlessMode: true,
    });
  });

  test('isInternetlessModeEnabled should return mode state', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    settings.createCollections(db);
    expect(settings.isInternetlessModeEnabled()).toBe(false);

    settings.updateSettings({ internetlessMode: true });
    expect(settings.isInternetlessModeEnabled()).toBe(true);
  });

  test('updateSettings should throw when value is invalid', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    settings.createCollections(db);
    expect(() =>
      settings.updateSettings({
        internetlessMode: 'yes' as unknown as boolean,
      }),
    ).toThrow();
  });
});
