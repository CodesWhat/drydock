// @ts-nocheck
import fs from 'node:fs';
import * as store from './index.js';

// vi.hoisted ensures these are available when vi.mock factories execute (hoisted above imports)
const {
  STORE_CONFIG,
  createLokiMock,
  createFsMock,
  createConfigMock,
  createCollectionsMock,
  createLogMock,
  registerCommonMocks,
} = vi.hoisted(() => {
  const STORE_CONFIG = { path: '/test/store', file: 'test.json' };

  function createLokiMock(loadDbCallback = (options, callback) => callback(null)) {
    return {
      // biome-ignore lint/complexity/useArrowFunction: mock constructor requires function expression
      default: vi.fn().mockImplementation(function () {
        return { loadDatabase: vi.fn(loadDbCallback) };
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
    return { createCollections: vi.fn() };
  }

  function createLogMock() {
    return { default: { child: vi.fn(() => ({ info: vi.fn() })) } };
  }

  /** Register the standard set of doMock calls needed after vi.resetModules. */
  function registerCommonMocks(
    overrides: {
      loki?: Parameters<typeof createLokiMock>[0];
      fs?: Record<string, unknown>;
      config?: Record<string, unknown>;
    } = {},
  ) {
    vi.doMock('lokijs', () => createLokiMock(overrides.loki));
    vi.doMock('node:fs', () => createFsMock(overrides.fs));
    vi.doMock('../configuration', () => createConfigMock(overrides.config ?? STORE_CONFIG));
    vi.doMock('./app', createCollectionsMock);
    vi.doMock('./audit', createCollectionsMock);
    vi.doMock('./backup', createCollectionsMock);
    vi.doMock('./container', createCollectionsMock);
    vi.doMock('../log', createLogMock);
  }

  return {
    STORE_CONFIG,
    createLokiMock,
    createFsMock,
    createConfigMock,
    createCollectionsMock,
    createLogMock,
    registerCommonMocks,
  };
});

// --- Top-level mocks (hoisted, used for the non-resetModules tests) ---

vi.mock('lokijs', () => createLokiMock());
vi.mock('node:fs', () => createFsMock());
vi.mock('../configuration', () => createConfigMock());
vi.mock('./app', createCollectionsMock);
vi.mock('./audit', createCollectionsMock);
vi.mock('./backup', createCollectionsMock);
vi.mock('./container', createCollectionsMock);
vi.mock('../log', createLogMock);

describe('Store Module', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  test('should initialize store successfully', async () => {
    fs.existsSync.mockReturnValue(true);

    await store.init();

    const app = await import('./app.js');
    const container = await import('./container.js');

    expect(app.createCollections).toHaveBeenCalled();
    expect(container.createCollections).toHaveBeenCalled();
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
    expect(app.createCollections).toHaveBeenCalled();
    expect(container.createCollections).toHaveBeenCalled();
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

    registerCommonMocks();
    // Override the fs mock with the custom one for migration logic
    vi.doMock('node:fs', () => ({ default: mockFs }));

    const storeMigrate = await import('./index.js');
    await storeMigrate.init();

    expect(mockFs.renameSync).toHaveBeenCalledWith('/test/store/wud.json', '/test/store/test.json');
  });
});
