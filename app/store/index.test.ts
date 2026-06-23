import fs from 'node:fs';
import * as store from './index.js';

// vi.hoisted ensures these are available when vi.mock factories execute (hoisted above imports)
const {
  STORE_CONFIG,
  createLokiMock,
  createFsMock,
  createConfigMock,
  createCollectionsMock,
  createAgentKeysMock,
  createLogMock,
  registerCommonMocks,
} = vi.hoisted(() => {
  const STORE_CONFIG = { path: '/test/store', file: 'test.json' };

  function createLokiMock(
    loadDbCallback = (options, callback) => callback(null),
    saveDbCallback = (callback) => callback(null),
    createDbInstance = () => ({
      loadDatabase: vi.fn(loadDbCallback),
      saveDatabase: vi.fn(saveDbCallback),
    }),
  ) {
    return {
      // biome-ignore lint/complexity/useArrowFunction: mock constructor requires function expression
      default: vi.fn().mockImplementation(function () {
        return createDbInstance();
      }),
    };
  }

  function createFsMock(overrides = {}) {
    return {
      default: { existsSync: vi.fn(), mkdirSync: vi.fn(), ...overrides },
    };
  }

  function createConfigMock(config = STORE_CONFIG) {
    return { getStoreConfiguration: vi.fn(() => config) };
  }

  function createCollectionsMock() {
    return { createCollections: vi.fn(), completeStartupInitialization: vi.fn() };
  }

  function createAgentKeysMock() {
    return {
      createCollections: vi.fn(),
      completeStartupInitialization: vi.fn(),
      loadAuthorizedKeysFile: vi.fn(),
    };
  }

  function createLogMock() {
    return { default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn() })) } };
  }

  /** Register the standard set of doMock calls needed after vi.resetModules. */
  function registerCommonMocks(
    overrides: {
      loki?: Parameters<typeof createLokiMock>[0];
      lokiSave?: Parameters<typeof createLokiMock>[1];
      lokiInstance?: Parameters<typeof createLokiMock>[2];
      fs?: Record<string, unknown>;
      config?: Record<string, unknown>;
      portwingAuthorizedKeysPath?: string | undefined;
    } = {},
  ) {
    vi.doMock('lokijs', () =>
      createLokiMock(overrides.loki, overrides.lokiSave, overrides.lokiInstance),
    );
    vi.doMock('node:fs', () => createFsMock(overrides.fs));
    vi.doMock('../configuration', () => ({
      ...createConfigMock(overrides.config ?? STORE_CONFIG),
      getPortwingAuthorizedKeysPath: vi.fn(() => overrides.portwingAuthorizedKeysPath),
    }));
    vi.doMock('./agent-keys', createAgentKeysMock);
    vi.doMock('./app', createCollectionsMock);
    vi.doMock('./audit', createCollectionsMock);
    vi.doMock('./backup', createCollectionsMock);
    vi.doMock('./container', createCollectionsMock);
    vi.doMock('./notification', createCollectionsMock);
    vi.doMock('./notification-history', createCollectionsMock);
    vi.doMock('./notification-outbox', createCollectionsMock);
    vi.doMock('./secrets', createCollectionsMock);
    vi.doMock('./settings', createCollectionsMock);
    vi.doMock('./update-operation', createCollectionsMock);
    vi.doMock('../log', createLogMock);
  }

  return {
    STORE_CONFIG,
    createLokiMock,
    createFsMock,
    createConfigMock,
    createCollectionsMock,
    createAgentKeysMock,
    createLogMock,
    registerCommonMocks,
  };
});

// --- Top-level mocks (hoisted, used for the non-resetModules tests) ---

vi.mock('lokijs', () => createLokiMock());
vi.mock('node:fs', () => createFsMock());
vi.mock('../configuration', () => ({
  ...createConfigMock(),
  getPortwingAuthorizedKeysPath: vi.fn(() => undefined),
}));
vi.mock('./app', createCollectionsMock);
vi.mock('./audit', createCollectionsMock);
vi.mock('./backup', createCollectionsMock);
vi.mock('./container', createCollectionsMock);
vi.mock('./notification', createCollectionsMock);
vi.mock('./notification-history', createCollectionsMock);
vi.mock('./agent-keys', createAgentKeysMock);
vi.mock('./notification-outbox', createCollectionsMock);
vi.mock('./secrets', createCollectionsMock);
vi.mock('./settings', createCollectionsMock);
vi.mock('./update-operation', createCollectionsMock);
vi.mock('../log', createLogMock);

describe('Store Module', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  test('should initialize store successfully', async () => {
    fs.existsSync.mockReturnValue(true);

    await store.init();

    const Loki = (await import('lokijs')).default;
    expect(Loki).toHaveBeenCalledWith('/test/store/test.json', {
      autosave: true,
      autosaveInterval: 300000,
    });

    const app = await import('./app.js');
    const container = await import('./container.js');
    const notification = await import('./notification.js');
    const settings = await import('./settings.js');
    const updateOperation = await import('./update-operation.js');

    expect(app.createCollections).toHaveBeenCalled();
    expect(container.createCollections).toHaveBeenCalled();
    expect(notification.createCollections).toHaveBeenCalled();
    expect(settings.createCollections).toHaveBeenCalled();
    expect(updateOperation.createCollections).toHaveBeenCalled();
    expect(app.completeStartupInitialization).toHaveBeenCalled();
    expect(container.createCollections.mock.invocationCallOrder[0]).toBeLessThan(
      app.completeStartupInitialization.mock.invocationCallOrder[0],
    );
  });

  test('should create directory if it does not exist', async () => {
    fs.existsSync.mockReturnValue(false);

    await store.init();

    expect(fs.mkdirSync).toHaveBeenCalledWith('/test/store');
  });

  test('should return configuration', async () => {
    const config = store.getConfiguration();

    expect(config).toEqual(STORE_CONFIG);
  });

  test('should handle database load error', async () => {
    vi.resetModules();

    vi.doMock('lokijs', () =>
      createLokiMock((options, callback) => {
        callback(new Error('Database load failed'));
      }),
    );

    const storeWithError = await import('./index.js');
    await expect(storeWithError.init()).rejects.toThrow('Database load failed');
  });

  test('should initialize store in memory mode', async () => {
    vi.resetModules();
    registerCommonMocks({
      loki: vi.fn(),
      fs: { renameSync: vi.fn() },
    });

    const storeMemory = await import('./index.js');
    await storeMemory.init({ memory: true });

    const app = await import('./app.js');
    const container = await import('./container.js');
    const notification = await import('./notification.js');
    const settings = await import('./settings.js');
    const updateOperation = await import('./update-operation.js');
    expect(app.createCollections).toHaveBeenCalled();
    expect(container.createCollections).toHaveBeenCalled();
    expect(notification.createCollections).toHaveBeenCalled();
    expect(settings.createCollections).toHaveBeenCalled();
    expect(updateOperation.createCollections).toHaveBeenCalled();
    expect(app.completeStartupInitialization).toHaveBeenCalled();
  });

  test('should save database when persistence is enabled', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
    });

    const storePersistent = await import('./index.js');
    await storePersistent.init();
    await storePersistent.save();

    const Loki = (await import('lokijs')).default;
    const dbInstance = Loki.mock.results[0].value;
    expect(dbInstance.saveDatabase).toHaveBeenCalledTimes(1);
  });

  test('should no-op save when store runs in memory mode', async () => {
    vi.resetModules();
    registerCommonMocks({
      lokiSave: vi.fn((callback) => callback(null)),
      fs: { renameSync: vi.fn() },
    });

    const storeMemory = await import('./index.js');
    await storeMemory.init({ memory: true });
    await storeMemory.save();

    const Loki = (await import('lokijs')).default;
    const dbInstance = Loki.mock.results[0].value;
    expect(dbInstance.saveDatabase).not.toHaveBeenCalled();
  });

  test('should throw when database save fails', async () => {
    vi.resetModules();
    registerCommonMocks({
      lokiSave: vi.fn((callback) => callback(new Error('Database save failed'))),
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
    });

    const storeWithSaveError = await import('./index.js');
    await storeWithSaveError.init();

    await expect(storeWithSaveError.save()).rejects.toThrow('Database save failed');
  });

  test('should throw when store configuration is invalid', async () => {
    vi.resetModules();

    vi.doMock('../configuration', () => createConfigMock({ path: 123 }));
    vi.doMock('../log', createLogMock);

    await expect(import('./index.js')).rejects.toThrow();
  });

  test('should fall back to schema defaults when store configuration is null', async () => {
    vi.resetModules();
    vi.doMock('lokijs', () => createLokiMock());
    vi.doMock('node:fs', () => createFsMock({ renameSync: vi.fn() }));
    vi.doMock('../configuration', () => ({ getStoreConfiguration: vi.fn(() => null) }));
    vi.doMock('./app', createCollectionsMock);
    vi.doMock('./audit', createCollectionsMock);
    vi.doMock('./backup', createCollectionsMock);
    vi.doMock('./container', createCollectionsMock);
    vi.doMock('./notification', createCollectionsMock);
    vi.doMock('./notification-history', createCollectionsMock);
    vi.doMock('./settings', createCollectionsMock);
    vi.doMock('./update-operation', createCollectionsMock);
    vi.doMock('../log', createLogMock);

    const storeDefault = await import('./index.js');
    expect(storeDefault.getConfiguration()).toEqual({
      path: '/store',
      file: 'dd.json',
    });
  });

  test('should throw when DD_STORE_FILE resolves to the configured directory', async () => {
    vi.resetModules();
    registerCommonMocks({
      config: { path: '/test/store', file: '.' },
      fs: { renameSync: vi.fn() },
    });

    const storeFileIsDir = await import('./index.js');
    await expect(storeFileIsDir.init()).rejects.toThrow(
      'DD_STORE_FILE must reference a file path, not a directory',
    );
  });

  test('should migrate from wud.json when dd.json does not exist', async () => {
    vi.resetModules();

    const mockFs = {
      existsSync: vi.fn((path) => {
        if (path === '/test/store/test.json') return false;
        if (path === '/test/store/wud.json') return true;
        if (path === '/test/store') return true;
        return false;
      }),
      mkdirSync: vi.fn(),
      renameSync: vi.fn(),
    };

    registerCommonMocks({ fs: mockFs });

    const storeMigrate = await import('./index.js');
    await storeMigrate.init();

    expect(mockFs.renameSync).toHaveBeenCalledWith('/test/store/wud.json', '/test/store/test.json');
  });

  test('should collect debug snapshot values from collection fallbacks', async () => {
    vi.resetModules();

    const storeDb = {
      collections: [
        123,
        { count: vi.fn(() => -4) },
        { name: undefined, count: vi.fn(() => Number.NaN) },
        { name: 'bad-data', data: { value: 1 } },
        { name: 'data', data: [1, 2, 3] },
        { name: 'named', count: vi.fn(() => 5) },
      ],
      loadDatabase: vi.fn((options, callback) => callback(null)),
      saveDatabase: vi.fn((callback) => callback(null)),
    };

    registerCommonMocks({
      lokiInstance: () => storeDb,
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        statSync: vi.fn(() => ({ mtime: new Date('2026-03-18T12:34:56.000Z') })),
        renameSync: vi.fn(),
      },
    });

    const storeWithSnapshot = await import('./index.js');
    await storeWithSnapshot.init();

    expect(storeWithSnapshot.getDebugSnapshot()).toEqual({
      memoryMode: false,
      path: '/test/store/test.json',
      collectionCount: 6,
      documentCount: 8,
      lastPersistAt: '2026-03-18T12:34:56.000Z',
      collections: [
        { name: 'unknown', documents: 0 },
        { name: 'unknown', documents: 0 },
        { name: 'unknown', documents: 0 },
        { name: 'bad-data', documents: 0 },
        { name: 'data', documents: 3 },
        { name: 'named', documents: 5 },
      ],
    });
  });

  test('should return undefined lastPersistAt when store runs in memory mode', async () => {
    vi.resetModules();

    registerCommonMocks({
      lokiInstance: () => ({
        collections: [],
        loadDatabase: vi.fn((options, callback) => callback(null)),
        saveDatabase: vi.fn((callback) => callback(null)),
      }),
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        statSync: vi.fn(() => ({ mtime: new Date('2026-03-18T12:34:56.000Z') })),
        renameSync: vi.fn(),
      },
    });

    const storeInMemory = await import('./index.js');
    await storeInMemory.init({ memory: true });

    expect(storeInMemory.getDebugSnapshot()).toEqual({
      memoryMode: true,
      path: '/test/store/test.json',
      collectionCount: 0,
      documentCount: 0,
      lastPersistAt: undefined,
      collections: [],
    });
  });

  test('should return undefined lastPersistAt when store path has not been initialized', async () => {
    vi.resetModules();

    registerCommonMocks({
      lokiInstance: () => ({
        collections: [],
        loadDatabase: vi.fn((options, callback) => callback(null)),
        saveDatabase: vi.fn((callback) => callback(null)),
      }),
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        statSync: vi.fn(() => ({ mtime: new Date('2026-03-18T12:34:56.000Z') })),
        renameSync: vi.fn(),
      },
    });

    const storeWithoutInit = await import('./index.js');

    expect(storeWithoutInit.getDebugSnapshot()).toEqual({
      memoryMode: false,
      path: undefined,
      collectionCount: 0,
      documentCount: 0,
      lastPersistAt: undefined,
      collections: [],
    });
  });

  test('should return undefined lastPersistAt when statSync throws', async () => {
    vi.resetModules();

    registerCommonMocks({
      lokiInstance: () => ({
        collections: [{ name: 'only', count: vi.fn(() => 1) }],
        loadDatabase: vi.fn((options, callback) => callback(null)),
        saveDatabase: vi.fn((callback) => callback(null)),
      }),
      fs: {
        existsSync: vi.fn(
          (targetPath) => targetPath === '/test/store/test.json' || targetPath === '/test/store',
        ),
        mkdirSync: vi.fn(),
        statSync: vi.fn(() => {
          throw new Error('stat failed');
        }),
        renameSync: vi.fn(),
      },
    });

    const storeWithStatError = await import('./index.js');
    await storeWithStatError.init();

    expect(storeWithStatError.getDebugSnapshot()).toEqual({
      memoryMode: false,
      path: '/test/store/test.json',
      collectionCount: 1,
      documentCount: 1,
      lastPersistAt: undefined,
      collections: [{ name: 'only', documents: 1 }],
    });
  });

  test('should call loadAuthorizedKeysFile when DD_PORTWING_AUTHORIZED_KEYS is set', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: { existsSync: vi.fn(() => true), mkdirSync: vi.fn(), renameSync: vi.fn() },
      portwingAuthorizedKeysPath: '/etc/drydock/authorized_keys',
    });

    const storeWithKeys = await import('./index.js');
    await storeWithKeys.init();

    const agentKeysMod = await import('./agent-keys.js');
    expect(agentKeysMod.loadAuthorizedKeysFile).toHaveBeenCalledWith(
      '/etc/drydock/authorized_keys',
    );
  });

  test('should skip loadAuthorizedKeysFile when DD_PORTWING_AUTHORIZED_KEYS is unset', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: { existsSync: vi.fn(() => true), mkdirSync: vi.fn(), renameSync: vi.fn() },
      portwingAuthorizedKeysPath: undefined,
    });

    const storeNoKeys = await import('./index.js');
    await storeNoKeys.init();

    const agentKeysMod = await import('./agent-keys.js');
    expect(agentKeysMod.loadAuthorizedKeysFile).not.toHaveBeenCalled();
  });

  test('should warn and continue startup when loadAuthorizedKeysFile throws', async () => {
    vi.resetModules();

    const mockWarn = vi.fn();
    vi.doMock('lokijs', () => createLokiMock());
    vi.doMock('node:fs', () =>
      createFsMock({ existsSync: vi.fn(() => true), mkdirSync: vi.fn(), renameSync: vi.fn() }),
    );
    vi.doMock('../configuration', () => ({
      ...createConfigMock(STORE_CONFIG),
      getPortwingAuthorizedKeysPath: vi.fn(() => '/bad/authorized_keys'),
    }));
    vi.doMock('./agent-keys', () => ({
      createCollections: vi.fn(),
      completeStartupInitialization: vi.fn(),
      loadAuthorizedKeysFile: vi.fn(() => {
        throw new Error('permission denied');
      }),
    }));
    vi.doMock('./app', createCollectionsMock);
    vi.doMock('./audit', createCollectionsMock);
    vi.doMock('./backup', createCollectionsMock);
    vi.doMock('./container', createCollectionsMock);
    vi.doMock('./notification', createCollectionsMock);
    vi.doMock('./notification-history', createCollectionsMock);
    vi.doMock('./notification-outbox', createCollectionsMock);
    vi.doMock('./secrets', createCollectionsMock);
    vi.doMock('./settings', createCollectionsMock);
    vi.doMock('./update-operation', createCollectionsMock);
    vi.doMock('../log', () => ({
      default: { child: vi.fn(() => ({ info: vi.fn(), warn: mockWarn })) },
    }));

    const storeWithBadKeys = await import('./index.js');
    await expect(storeWithBadKeys.init()).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/bad/authorized_keys' }),
      expect.stringContaining('DD_PORTWING_AUTHORIZED_KEYS'),
    );
  });

  test('should call loadAuthorizedKeysFile when DD_PORTWING_AUTHORIZED_KEYS is set in memory mode', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: { renameSync: vi.fn() },
      portwingAuthorizedKeysPath: '/etc/drydock/authorized_keys',
    });

    const storeMemoryWithKeys = await import('./index.js');
    await storeMemoryWithKeys.init({ memory: true });

    const agentKeysMod = await import('./agent-keys.js');
    expect(agentKeysMod.loadAuthorizedKeysFile).toHaveBeenCalledWith(
      '/etc/drydock/authorized_keys',
    );
  });
});
