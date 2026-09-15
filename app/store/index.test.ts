import fs from 'node:fs';
import * as store from './index.js';

// vi.hoisted ensures these are available when vi.mock factories execute (hoisted above imports)
const {
  STORE_CONFIG,
  fsMock,
  resetFsMock,
  createConfigMock,
  createCollectionsMock,
  createNotificationMock,
  createContainerMock,
  createAgentKeysMock,
  createLogMock,
  createSqliteDbMock,
  createDriverMock,
  createDebugSnapshotSqliteDbMock,
  createMigrationsMock,
  createImportMock,
  registerCommonMocks,
} = vi.hoisted(() => {
  const STORE_CONFIG = { path: '/test/store', file: 'test.json' };

  // A fake `Database` (app/store/db/driver.ts), so `store/index.ts` opening
  // and migrating the SQLite side never touches a real file: the mocked
  // paths under `/test/store` do not exist on disk.
  function createSqliteDbMock(overrides: Record<string, unknown> = {}) {
    return {
      isOpen: true,
      isTransaction: false,
      exec: vi.fn(),
      prepare: vi.fn(() => ({
        all: vi.fn(() => []),
        get: vi.fn(() => undefined),
        run: vi.fn(),
        iterate: vi.fn(() => []),
      })),
      pragma: vi.fn(),
      transaction: vi.fn((run: () => unknown) => run()),
      backup: vi.fn(async () => 0),
      close: vi.fn(),
      ...overrides,
    };
  }

  // A `prepare()` that actually answers the two queries getDebugSnapshot()
  // issues — `SELECT name FROM sqlite_schema ...` and
  // `SELECT COUNT(*) AS count FROM "<table>"` — from a plain table-name to
  // row-count map, plus a `pragma()` answering `page_count`/`page_size`. Real
  // enough to exercise getDebugSnapshot()'s own filtering and arithmetic
  // without standing up a real database.
  function createDebugSnapshotSqliteDbMock({
    tables = {} as Record<string, number>,
    pageCount = 0,
    pageSize = 0,
  } = {}) {
    return createSqliteDbMock({
      prepare: vi.fn((sql: string) => {
        if (sql.includes('FROM sqlite_schema')) {
          return {
            all: vi.fn(() =>
              Object.keys(tables)
                .sort()
                .map((name) => ({ name })),
            ),
          };
        }
        const match = sql.match(/FROM "([^"]+)"/);
        const tableName = match?.[1];
        return {
          get: vi.fn(() => ({ count: tableName ? (tables[tableName] ?? 0) : 0 })),
        };
      }),
      pragma: vi.fn((name: string) => {
        if (name === 'page_count') return pageCount;
        if (name === 'page_size') return pageSize;
        return undefined;
      }),
    });
  }

  function createDriverMock(openDatabaseImpl = vi.fn(() => createSqliteDbMock())) {
    return {
      MEMORY_DATABASE_LOCATION: ':memory:',
      openDatabase: openDatabaseImpl,
    };
  }

  function createMigrationsMock() {
    return { migrate: vi.fn(() => []) };
  }

  // `runFirstStartImport` (app/store/db/import.ts) is a seam like the driver
  // and the migration runner above: real behaviour is covered against real
  // files in db/import.test.ts and store/index.first-start-import.test.ts, so
  // here it is a controllable no-op that defaults to "nothing to import",
  // which keeps every existing fs mock in this file free to stay ignorant of
  // the import framework's own filesystem calls.
  function createImportMock(
    runFirstStartImportImpl = vi.fn(() => ({
      status: 'no-legacy-store' as const,
      databasePath: '',
      rowsByTable: {},
    })),
  ) {
    return { runFirstStartImport: runFirstStartImportImpl };
  }

  // A single, stable object backs every 'node:fs' mock for the whole file.
  // vi.resetModules() clears vitest's module *instance* cache, so the next
  // `import('./index.js')` re-resolves 'node:fs' and re-invokes whatever
  // factory is registered for it — but registration (vi.mock/vi.doMock)
  // itself survives resetModules. Previously each test swapped in a *new*
  // mock object via `vi.doMock('node:fs', () => createFsMock(overrides))`,
  // which meant correctness depended on that fresh factory winning the race
  // against a freshly re-imported store/index.js resolving 'node:fs' — a
  // real, previously-diagnosed flake (a stale/incomplete prior fs mock
  // occasionally got captured instead, so store/index.ts's
  // `fs.existsSync(legacyPath)` read a bare `vi.fn()` returning undefined,
  // renameSync was never reached, and the "migrate from wud.json" assertion
  // saw renameSync called 0 times; see PR #417 / #436 history). Reusing one
  // object and only ever reconfiguring its methods removes the swap: no
  // matter when 'node:fs' gets re-resolved relative to test setup, it always
  // resolves to this exact object.
  const fsMock: Record<string, ReturnType<typeof vi.fn>> = {};

  function resetFsMock(overrides: Record<string, unknown> = {}) {
    for (const key of Object.keys(fsMock)) {
      delete fsMock[key];
    }
    Object.assign(
      fsMock,
      { existsSync: vi.fn(), mkdirSync: vi.fn(), chmodSync: vi.fn() },
      overrides,
    );
  }
  resetFsMock();

  function createConfigMock(config = STORE_CONFIG) {
    return { getStoreConfiguration: vi.fn(() => config) };
  }

  function createCollectionsMock() {
    return { createCollections: vi.fn(), completeStartupInitialization: vi.fn() };
  }

  function createContainerMock(overrides = {}) {
    return {
      ...createCollectionsMock(),
      getContainersRaw: vi.fn(() => []),
      updateContainer: vi.fn(),
      rehydrateUpdateLifecycleCacheFromStore: vi.fn(),
      rehydrateUpdatePolicyRetentionCacheFromStore: vi.fn(),
      ...overrides,
    };
  }

  // `./db/importers/index.js` is never mocked (store/index.ts imports the real
  // COLLECTION_IMPORTERS array to pass to runFirstStartImport), and its
  // notification-rules importer needs the real DEFAULT_NOTIFICATION_RULES and
  // NOTIFICATION_BELL_THRESHOLDS from this module — so this mock keeps every
  // real export and only replaces createCollections/completeStartupInitialization.
  async function createNotificationMock() {
    const actual = await vi.importActual<typeof import('./notification.js')>('./notification.js');
    return { ...actual, ...createCollectionsMock() };
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
      fs?: Record<string, unknown>;
      config?: Record<string, unknown>;
      container?: Record<string, unknown>;
      migrateInlineSboms?: (options: Record<string, any>) => Promise<Record<string, number>>;
      portwingAuthorizedKeysPath?: string | undefined;
      sqliteOpenDatabase?: Parameters<typeof createDriverMock>[0];
      runFirstStartImport?: Parameters<typeof createImportMock>[0];
    } = {},
  ) {
    resetFsMock(overrides.fs);
    vi.doMock('./db/driver.js', () => createDriverMock(overrides.sqliteOpenDatabase));
    vi.doMock('./db/migrations.js', createMigrationsMock);
    vi.doMock('./db/import.js', () => createImportMock(overrides.runFirstStartImport));
    vi.doMock('../configuration', () => ({
      ...createConfigMock(overrides.config ?? STORE_CONFIG),
      getPortwingAuthorizedKeysPath: vi.fn(() => overrides.portwingAuthorizedKeysPath),
    }));
    vi.doMock('../security/sbom-migration.js', async () => {
      const actual = await vi.importActual<typeof import('../security/sbom-migration.js')>(
        '../security/sbom-migration.js',
      );
      return overrides.migrateInlineSboms
        ? { ...actual, migrateInlineSboms: vi.fn(overrides.migrateInlineSboms) }
        : actual;
    });
    vi.doMock('./agent-keys', createAgentKeysMock);
    vi.doMock('./api-key', createCollectionsMock);
    vi.doMock('./app', createCollectionsMock);
    vi.doMock('./approval', createCollectionsMock);
    vi.doMock('./audit', createCollectionsMock);
    vi.doMock('./backup', createCollectionsMock);
    vi.doMock('./container', () => createContainerMock(overrides.container));
    vi.doMock('./mqtt-hass', createCollectionsMock);
    vi.doMock('./name-bindings', createCollectionsMock);
    vi.doMock('./notification', createNotificationMock);
    vi.doMock('./notification-history', createCollectionsMock);
    vi.doMock('./notification-outbox', createCollectionsMock);
    vi.doMock('./secrets', createCollectionsMock);
    vi.doMock('./session', createCollectionsMock);
    vi.doMock('./settings', createCollectionsMock);
    vi.doMock('./ui-preferences', createCollectionsMock);
    vi.doMock('./update-lifecycle-cache', createCollectionsMock);
    vi.doMock('./update-operation', createCollectionsMock);
    vi.doMock('./update-policy-retention-cache', createCollectionsMock);
    vi.doMock('../log', createLogMock);
  }

  return {
    STORE_CONFIG,
    fsMock,
    resetFsMock,
    createConfigMock,
    createCollectionsMock,
    createNotificationMock,
    createContainerMock,
    createAgentKeysMock,
    createLogMock,
    createSqliteDbMock,
    createDriverMock,
    createDebugSnapshotSqliteDbMock,
    createMigrationsMock,
    createImportMock,
    registerCommonMocks,
  };
});

// --- Top-level mocks (hoisted, used for the non-resetModules tests) ---

vi.mock('node:fs', () => ({ default: fsMock }));
vi.mock('./db/driver.js', () => createDriverMock());
vi.mock('./db/migrations.js', createMigrationsMock);
vi.mock('./db/import.js', () => createImportMock());
vi.mock('../configuration', () => ({
  ...createConfigMock(),
  getPortwingAuthorizedKeysPath: vi.fn(() => undefined),
}));
vi.mock('./app', createCollectionsMock);
vi.mock('./approval', createCollectionsMock);
vi.mock('./audit', createCollectionsMock);
vi.mock('./backup', createCollectionsMock);
vi.mock('./container', createContainerMock);
vi.mock('./mqtt-hass', createCollectionsMock);
vi.mock('./name-bindings', createCollectionsMock);
vi.mock('./notification', createNotificationMock);
vi.mock('./notification-history', createCollectionsMock);
vi.mock('./agent-keys', createAgentKeysMock);
vi.mock('./api-key', createCollectionsMock);
vi.mock('./notification-outbox', createCollectionsMock);
vi.mock('./secrets', createCollectionsMock);
vi.mock('./session', createCollectionsMock);
vi.mock('./settings', createCollectionsMock);
vi.mock('./ui-preferences', createCollectionsMock);
vi.mock('./update-lifecycle-cache', createCollectionsMock);
vi.mock('./update-operation', createCollectionsMock);
vi.mock('./update-policy-retention-cache', createCollectionsMock);
vi.mock('../log', createLogMock);

/** The child logger store/index.ts created for itself, selected by component rather than
 * by call order, since other store modules loaded through it create their own children. */
function storeScopedLog(logger: { child: ReturnType<typeof vi.fn> }) {
  const index = logger.child.mock.calls.findIndex(
    (call: unknown[]) => (call[0] as { component?: string } | undefined)?.component === 'store',
  );
  return logger.child.mock.results[index].value;
}

describe('Store Module', () => {
  const originalUmask = process.umask();

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.umask(originalUmask);
  });

  test('should initialize store successfully', async () => {
    fs.existsSync.mockReturnValue(true);

    await store.init();

    expect(process.umask()).toBe(0o077);
    expect(fs.chmodSync).toHaveBeenCalledWith('/test/store', 0o700);
    expect(fs.chmodSync).toHaveBeenCalledWith('/test/store/test.json', 0o600);

    const apiKey = await import('./api-key.js');
    const app = await import('./app.js');
    const container = await import('./container.js');
    const mqttHass = await import('./mqtt-hass.js');
    const notification = await import('./notification.js');
    const sessionStore = await import('./session.js');
    const settings = await import('./settings.js');
    const uiPreferences = await import('./ui-preferences.js');
    const updateLifecycleCache = await import('./update-lifecycle-cache.js');
    const updateOperation = await import('./update-operation.js');
    const updatePolicyRetentionCache = await import('./update-policy-retention-cache.js');

    expect(apiKey.createCollections).toHaveBeenCalled();
    expect(app.createCollections).toHaveBeenCalled();
    expect(container.createCollections).toHaveBeenCalled();
    expect(mqttHass.createCollections).toHaveBeenCalled();
    expect(notification.createCollections).toHaveBeenCalled();
    expect(sessionStore.createCollections).toHaveBeenCalled();
    expect(settings.createCollections).toHaveBeenCalled();
    expect(uiPreferences.createCollections).toHaveBeenCalled();
    expect(updateLifecycleCache.createCollections).toHaveBeenCalled();
    expect(updateOperation.createCollections).toHaveBeenCalled();
    expect(app.completeStartupInitialization).toHaveBeenCalled();
    expect(container.createCollections.mock.invocationCallOrder[0]).toBeLessThan(
      app.completeStartupInitialization.mock.invocationCallOrder[0],
    );

    // #556: the update-lifecycle-cache collection must exist, and container's in-memory
    // Map must be rehydrated from it, before startup is considered complete — and the
    // collection has to come into being before rehydration reads from it.
    expect(container.createCollections.mock.invocationCallOrder[0]).toBeLessThan(
      updateLifecycleCache.createCollections.mock.invocationCallOrder[0],
    );
    expect(updateLifecycleCache.createCollections.mock.invocationCallOrder[0]).toBeLessThan(
      container.rehydrateUpdateLifecycleCacheFromStore.mock.invocationCallOrder[0],
    );
    expect(
      container.rehydrateUpdateLifecycleCacheFromStore.mock.invocationCallOrder[0],
    ).toBeLessThan(app.completeStartupInitialization.mock.invocationCallOrder[0]);

    // #565: same rationale as #556 above, for the update-policy retention cache — the
    // collection must exist, and container's in-memory Map must be rehydrated from it,
    // before startup is considered complete.
    expect(updatePolicyRetentionCache.createCollections).toHaveBeenCalled();
    expect(container.createCollections.mock.invocationCallOrder[0]).toBeLessThan(
      updatePolicyRetentionCache.createCollections.mock.invocationCallOrder[0],
    );
    expect(updatePolicyRetentionCache.createCollections.mock.invocationCallOrder[0]).toBeLessThan(
      container.rehydrateUpdatePolicyRetentionCacheFromStore.mock.invocationCallOrder[0],
    );
    expect(
      container.rehydrateUpdatePolicyRetentionCacheFromStore.mock.invocationCallOrder[0],
    ).toBeLessThan(app.completeStartupInitialization.mock.invocationCallOrder[0]);
  });

  test('should run the first-start import before opening the SQLite database', async () => {
    vi.resetModules();
    const runFirstStartImportMock = vi.fn(() => ({
      status: 'no-legacy-store' as const,
      databasePath: '/test/store/dd.sqlite',
      rowsByTable: {},
    }));
    const openDatabaseMock = vi.fn(() => createSqliteDbMock());

    registerCommonMocks({
      fs: { existsSync: vi.fn(() => false), mkdirSync: vi.fn(), renameSync: vi.fn() },
      runFirstStartImport: runFirstStartImportMock,
      sqliteOpenDatabase: openDatabaseMock,
    });

    const storeWithImport = await import('./index.js');
    await storeWithImport.init();

    expect(runFirstStartImportMock).toHaveBeenCalledWith({
      storeDirectory: '/test/store',
      legacyStorePath: '/test/store/test.json',
      databasePath: '/test/store/dd.sqlite',
      importers: expect.any(Array),
    });
    expect(runFirstStartImportMock.mock.invocationCallOrder[0]).toBeLessThan(
      openDatabaseMock.mock.invocationCallOrder[0],
    );
  });

  test('should not run the first-start import in memory mode', async () => {
    vi.resetModules();
    const runFirstStartImportMock = vi.fn(() => ({
      status: 'no-legacy-store' as const,
      databasePath: '',
      rowsByTable: {},
    }));

    registerCommonMocks({
      fs: { renameSync: vi.fn() },
      runFirstStartImport: runFirstStartImportMock,
    });

    const storeMemory = await import('./index.js');
    await storeMemory.init({ memory: true });

    expect(runFirstStartImportMock).not.toHaveBeenCalled();
  });

  test('should create directory if it does not exist', async () => {
    fs.existsSync.mockReturnValue(false);

    await store.init();

    expect(fs.mkdirSync).toHaveBeenCalledWith('/test/store', { mode: 0o700 });
  });

  test('should return configuration', async () => {
    const config = store.getConfiguration();

    expect(config).toEqual({ ...STORE_CONFIG, dbFile: 'dd.sqlite' });
  });

  test('should reject initialization when post-load SBOM migration rejects', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
      container: {
        getContainersRaw: vi.fn(() => {
          throw new Error('SBOM migration failed');
        }),
      },
    });

    const storeWithMigrationError = await import('./index.js');

    await expect(storeWithMigrationError.init()).rejects.toThrow('SBOM migration failed');
  });

  test('should initialize store in memory mode', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: { renameSync: vi.fn() },
    });

    const storeMemory = await import('./index.js');
    await storeMemory.init({ memory: true });

    expect(storeMemory.isMemoryStore()).toBe(true);

    const apiKey = await import('./api-key.js');
    const app = await import('./app.js');
    const container = await import('./container.js');
    const mqttHass = await import('./mqtt-hass.js');
    const notification = await import('./notification.js');
    const settings = await import('./settings.js');
    const uiPreferences = await import('./ui-preferences.js');
    const updateOperation = await import('./update-operation.js');
    expect(apiKey.createCollections).toHaveBeenCalled();
    expect(app.createCollections).toHaveBeenCalled();
    expect(container.createCollections).toHaveBeenCalled();
    expect(mqttHass.createCollections).toHaveBeenCalled();
    expect(notification.createCollections).toHaveBeenCalled();
    expect(settings.createCollections).toHaveBeenCalled();
    expect(uiPreferences.createCollections).toHaveBeenCalled();
    expect(updateOperation.createCollections).toHaveBeenCalled();
    expect(app.completeStartupInitialization).toHaveBeenCalled();
  });

  test('should report an uninitialized store as memory-only and a loaded store as persistent', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
    });

    const storeMode = await import('./index.js');
    expect(storeMode.isMemoryStore()).toBe(true);

    await storeMode.init();

    expect(storeMode.isMemoryStore()).toBe(false);
  });

  test('should persist migrated SBOM metadata and log partial migration failures', async () => {
    vi.resetModules();
    const migratedContainer = { id: 'container-1', security: { sbom: { documentRefs: {} } } };
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
      migrateInlineSboms: vi.fn(async ({ persist }) => {
        persist(migratedContainer);
        return { migratedRecords: 1, migratedDocuments: 2, failures: 1 };
      }),
    });

    const storeWithMigration = await import('./index.js');
    await storeWithMigration.init();

    const container = await import('./container.js');
    const driver = await import('./db/driver.js');
    const sqliteInstance = driver.openDatabase.mock.results[0].value;
    const logger = (await import('../log/index.js')).default;
    const scopedLog = storeScopedLog(logger);
    expect(container.updateContainer).toHaveBeenCalledWith(migratedContainer);
    expect(sqliteInstance.pragma).toHaveBeenCalledWith('wal_checkpoint', 'TRUNCATE');
    expect(scopedLog.info).toHaveBeenCalledWith(
      'Migrated 2 inline SBOM document(s) across 1 record(s)',
    );
    expect(scopedLog.warn).toHaveBeenCalledWith(
      'Failed to migrate 1 SBOM record(s); inline data was preserved for retry',
    );
  });

  test('should enforce directory permissions on the configured store root when DD_STORE_FILE is a subpath', async () => {
    vi.resetModules();
    registerCommonMocks({
      config: { path: '/test/store', file: 'nested/sub/test.json' },
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
    });

    const storeWithNestedFile = await import('./index.js');
    await storeWithNestedFile.init();

    const mockedFs = (await import('node:fs')).default;
    mockedFs.chmodSync.mockClear();

    await storeWithNestedFile.save();

    // Perms must land on the configured store root ('/test/store'), not the
    // subdirectory implied by DD_STORE_FILE's nested path.
    expect(mockedFs.chmodSync).toHaveBeenCalledWith('/test/store', 0o700);
    expect(mockedFs.chmodSync).not.toHaveBeenCalledWith('/test/store/nested/sub', 0o700);
    expect(mockedFs.chmodSync).toHaveBeenCalledWith('/test/store/nested/sub/test.json', 0o600);
  });

  test('should reject when database permissions cannot be repaired after save', async () => {
    vi.resetModules();
    const chmodSync = vi.fn((target: string) => {
      if (target === '/test/store' && chmodSync.mock.calls.length > 2) {
        throw new Error('Permission repair failed');
      }
    });
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        chmodSync,
      },
    });

    const storeWithPermissionError = await import('./index.js');
    await storeWithPermissionError.init();

    await expect(storeWithPermissionError.save()).rejects.toThrow('Permission repair failed');
  });

  test('should swallow ENOENT when the store file does not exist yet during permission enforcement', async () => {
    vi.resetModules();
    const enoentError = Object.assign(new Error('no such file or directory'), {
      code: 'ENOENT',
    });
    const chmodSync = vi.fn((target: string) => {
      if (target === '/test/store/test.json') {
        throw enoentError;
      }
    });
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        chmodSync,
      },
    });

    const storeWithMissingFile = await import('./index.js');
    await expect(storeWithMissingFile.init()).resolves.toBeUndefined();
    expect(chmodSync).toHaveBeenCalledWith('/test/store', 0o700);
    expect(chmodSync).toHaveBeenCalledWith('/test/store/test.json', 0o600);
  });

  test('should rethrow unexpected (non-recoverable) errors from store file permission enforcement', async () => {
    vi.resetModules();
    const unexpectedError = Object.assign(new Error('bad file descriptor'), {
      code: 'EBADF',
    });
    const chmodSync = vi.fn((target: string) => {
      if (target === '/test/store/test.json') {
        throw unexpectedError;
      }
    });
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        chmodSync,
      },
    });

    const storeWithBadFilePermissions = await import('./index.js');
    await expect(storeWithBadFilePermissions.init()).rejects.toThrow('bad file descriptor');
  });

  test('should rethrow unexpected (non-recoverable) errors from store directory permission enforcement', async () => {
    vi.resetModules();
    const unexpectedError = Object.assign(new Error('bad file descriptor'), {
      code: 'EBADF',
    });
    const chmodSync = vi.fn((target: string) => {
      if (target === '/test/store') {
        throw unexpectedError;
      }
    });
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        chmodSync,
      },
    });

    const storeWithBadDirError = await import('./index.js');
    await expect(storeWithBadDirError.init()).rejects.toThrow('bad file descriptor');
  });

  test.each(['EPERM', 'EACCES', 'ENOTSUP'])(
    'should warn and continue when directory permission enforcement fails with %s',
    async (code) => {
      vi.resetModules();
      const permissionError = Object.assign(new Error(`chmod failed: ${code}`), { code });
      const chmodSync = vi.fn((target: string) => {
        if (target === '/test/store') {
          throw permissionError;
        }
      });
      registerCommonMocks({
        fs: {
          existsSync: vi.fn(() => true),
          mkdirSync: vi.fn(),
          renameSync: vi.fn(),
          chmodSync,
        },
      });

      const storeWithBadDirPermissions = await import('./index.js');
      await expect(storeWithBadDirPermissions.init()).resolves.toBeUndefined();

      const logger = (await import('../log/index.js')).default;
      const scopedLog = storeScopedLog(logger);
      expect(scopedLog.warn).toHaveBeenCalledOnce();
      expect(scopedLog.warn).toHaveBeenCalledWith(expect.stringContaining(code));
      expect(chmodSync).toHaveBeenCalledWith('/test/store/test.json', 0o600);
    },
  );

  test.each(['EPERM', 'EACCES', 'ENOTSUP'])(
    'should warn and continue when store file permission enforcement fails with %s',
    async (code) => {
      vi.resetModules();
      const permissionError = Object.assign(new Error(`chmod failed: ${code}`), { code });
      const chmodSync = vi.fn((target: string) => {
        if (target === '/test/store/test.json') {
          throw permissionError;
        }
      });
      registerCommonMocks({
        fs: {
          existsSync: vi.fn(() => true),
          mkdirSync: vi.fn(),
          renameSync: vi.fn(),
          chmodSync,
        },
      });

      const storeWithBadFilePermissions = await import('./index.js');
      await expect(storeWithBadFilePermissions.init()).resolves.toBeUndefined();

      const logger = (await import('../log/index.js')).default;
      const scopedLog = storeScopedLog(logger);
      expect(scopedLog.warn).toHaveBeenCalledOnce();
      expect(scopedLog.warn).toHaveBeenCalledWith(expect.stringContaining(code));
    },
  );

  test.each([
    ['directory', '/test/store'],
    ['store file', '/test/store/test.json'],
  ])('should reject when %s permission enforcement fails with EROFS', async (_label, target) => {
    vi.resetModules();
    const readOnlyError = Object.assign(new Error('chmod failed: EROFS'), { code: 'EROFS' });
    const chmodSync = vi.fn((chmodTarget: string) => {
      if (chmodTarget === target) {
        throw readOnlyError;
      }
    });
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        chmodSync,
      },
    });

    const storeOnReadOnlyVolume = await import('./index.js');
    await expect(storeOnReadOnlyVolume.init()).rejects.toThrow('chmod failed: EROFS');
  });

  test('should open the SQLite database at the default DD_STORE_DB_FILE and apply permissions to it and its WAL sidecars', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
    });

    const storeWithDefaultDbFile = await import('./index.js');
    await storeWithDefaultDbFile.init();

    const driver = await import('./db/driver.js');
    expect(driver.openDatabase).toHaveBeenCalledWith('/test/store/dd.sqlite');
    const migrations = await import('./db/migrations.js');
    expect(migrations.migrate).toHaveBeenCalledWith(driver.openDatabase.mock.results[0].value);

    const mockedFs = (await import('node:fs')).default;
    expect(mockedFs.chmodSync).toHaveBeenCalledWith('/test/store/dd.sqlite', 0o600);
    expect(mockedFs.chmodSync).toHaveBeenCalledWith('/test/store/dd.sqlite-wal', 0o600);
    expect(mockedFs.chmodSync).toHaveBeenCalledWith('/test/store/dd.sqlite-shm', 0o600);
  });

  test('should open the SQLite database at an overridden DD_STORE_DB_FILE', async () => {
    vi.resetModules();
    registerCommonMocks({
      config: { path: '/test/store', file: 'test.json', dbFile: 'custom.sqlite' },
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
    });

    const storeWithCustomDbFile = await import('./index.js');
    await storeWithCustomDbFile.init();

    const driver = await import('./db/driver.js');
    expect(driver.openDatabase).toHaveBeenCalledWith('/test/store/custom.sqlite');
    const mockedFs = (await import('node:fs')).default;
    expect(mockedFs.chmodSync).toHaveBeenCalledWith('/test/store/custom.sqlite', 0o600);
    expect(mockedFs.chmodSync).toHaveBeenCalledWith('/test/store/custom.sqlite-wal', 0o600);
    expect(mockedFs.chmodSync).toHaveBeenCalledWith('/test/store/custom.sqlite-shm', 0o600);
  });

  test('should open the SQLite database at :memory: in memory mode and skip file permission enforcement', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: { renameSync: vi.fn() },
    });

    const storeSqliteMemory = await import('./index.js');
    await storeSqliteMemory.init({ memory: true });

    const driver = await import('./db/driver.js');
    expect(driver.openDatabase).toHaveBeenCalledWith(':memory:');
    const migrations = await import('./db/migrations.js');
    expect(migrations.migrate).toHaveBeenCalledWith(driver.openDatabase.mock.results[0].value);

    const mockedFs = (await import('node:fs')).default;
    expect(mockedFs.chmodSync).not.toHaveBeenCalled();
  });

  test('should tolerate a missing SQLite WAL sidecar when applying permissions', async () => {
    vi.resetModules();
    const enoentError = Object.assign(new Error('no such file or directory'), {
      code: 'ENOENT',
    });
    const chmodSync = vi.fn((target: string) => {
      if (target === '/test/store/dd.sqlite-wal') {
        throw enoentError;
      }
    });
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        chmodSync,
      },
    });

    const storeWithMissingWal = await import('./index.js');
    await expect(storeWithMissingWal.init()).resolves.toBeUndefined();
    expect(chmodSync).toHaveBeenCalledWith('/test/store/dd.sqlite', 0o600);
    expect(chmodSync).toHaveBeenCalledWith('/test/store/dd.sqlite-shm', 0o600);
  });

  test.each(['EPERM', 'EACCES', 'ENOTSUP'])(
    'should warn and continue when SQLite database file permission enforcement fails with %s',
    async (code) => {
      vi.resetModules();
      const permissionError = Object.assign(new Error(`chmod failed: ${code}`), { code });
      const chmodSync = vi.fn((target: string) => {
        if (target === '/test/store/dd.sqlite') {
          throw permissionError;
        }
      });
      registerCommonMocks({
        fs: {
          existsSync: vi.fn(() => true),
          mkdirSync: vi.fn(),
          renameSync: vi.fn(),
          chmodSync,
        },
      });

      const storeWithBadSqlitePermissions = await import('./index.js');
      await expect(storeWithBadSqlitePermissions.init()).resolves.toBeUndefined();

      const logger = (await import('../log/index.js')).default;
      const scopedLog = storeScopedLog(logger);
      expect(scopedLog.warn).toHaveBeenCalledWith(expect.stringContaining(code));
    },
  );

  test('should reject when SQLite database file permission enforcement fails with an unrecoverable code', async () => {
    vi.resetModules();
    const unexpectedError = Object.assign(new Error('bad file descriptor'), {
      code: 'EBADF',
    });
    const chmodSync = vi.fn((target: string) => {
      if (target === '/test/store/dd.sqlite') {
        throw unexpectedError;
      }
    });
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        chmodSync,
      },
    });

    const storeWithBadSqliteFile = await import('./index.js');
    await expect(storeWithBadSqliteFile.init()).rejects.toThrow('bad file descriptor');
  });

  test('should checkpoint and reapply permissions to the SQLite database on save', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
    });

    const storeWithCheckpoint = await import('./index.js');
    await storeWithCheckpoint.init();

    const driver = await import('./db/driver.js');
    const sqliteInstance = driver.openDatabase.mock.results[0].value;
    const mockedFs = (await import('node:fs')).default;
    mockedFs.chmodSync.mockClear();

    await storeWithCheckpoint.save();

    expect(sqliteInstance.pragma).toHaveBeenCalledWith('wal_checkpoint', 'TRUNCATE');
    expect(mockedFs.chmodSync).toHaveBeenCalledWith('/test/store/dd.sqlite', 0o600);
  });

  test('should not checkpoint the SQLite database when save runs in memory mode', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: { renameSync: vi.fn() },
    });

    const storeMemoryCheckpoint = await import('./index.js');
    await storeMemoryCheckpoint.init({ memory: true });

    const driver = await import('./db/driver.js');
    const sqliteInstance = driver.openDatabase.mock.results[0].value;

    await storeMemoryCheckpoint.save();

    expect(sqliteInstance.pragma).not.toHaveBeenCalled();
  });

  test('should reject when the checkpoint pragma throws', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
      sqliteOpenDatabase: vi.fn(() =>
        createSqliteDbMock({
          pragma: vi.fn(() => {
            throw new Error('checkpoint failed');
          }),
        }),
      ),
    });

    const storeWithCheckpointError = await import('./index.js');
    await storeWithCheckpointError.init();

    await expect(storeWithCheckpointError.save()).rejects.toThrow('checkpoint failed');
  });

  test('should report an uninitialized store as memory-only when the SQLite open fails', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
      sqliteOpenDatabase: vi.fn(() => {
        throw new Error('SQLite open failed');
      }),
    });

    const storeWithFailedSqliteOpen = await import('./index.js');
    await expect(storeWithFailedSqliteOpen.init()).rejects.toThrow('SQLite open failed');
    expect(storeWithFailedSqliteOpen.isMemoryStore()).toBe(true);
  });

  test('should throw when store configuration is invalid', async () => {
    vi.resetModules();

    vi.doMock('../configuration', () => createConfigMock({ path: 123 }));
    vi.doMock('../log', createLogMock);

    await expect(import('./index.js')).rejects.toThrow();
  });

  test('should fall back to schema defaults when store configuration is null', async () => {
    vi.resetModules();
    resetFsMock({ renameSync: vi.fn() });
    vi.doMock('../configuration', () => ({ getStoreConfiguration: vi.fn(() => null) }));
    vi.doMock('./app', createCollectionsMock);
    vi.doMock('./audit', createCollectionsMock);
    vi.doMock('./backup', createCollectionsMock);
    vi.doMock('./container', createContainerMock);
    vi.doMock('./notification', createNotificationMock);
    vi.doMock('./notification-history', createCollectionsMock);
    vi.doMock('./settings', createCollectionsMock);
    vi.doMock('./update-operation', createCollectionsMock);
    vi.doMock('../log', createLogMock);

    const storeDefault = await import('./index.js');
    expect(storeDefault.getConfiguration()).toEqual({
      path: '/store',
      file: 'dd.json',
      dbFile: 'dd.sqlite',
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

  test('should report per-table row counts and the whole-database size from sqlite_schema', async () => {
    vi.resetModules();

    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        statSync: vi.fn(() => ({ mtime: new Date('2026-03-18T12:34:56.000Z') })),
      },
      sqliteOpenDatabase: vi.fn(() =>
        createDebugSnapshotSqliteDbMock({
          tables: { app_info: 1, containers: 3, schema_migrations: 7, store_metadata: 2 },
          pageCount: 25,
          pageSize: 4096,
        }),
      ),
    });

    const storeWithSnapshot = await import('./index.js');
    await storeWithSnapshot.init();

    expect(storeWithSnapshot.getDebugSnapshot()).toEqual({
      memoryMode: false,
      path: '/test/store/test.json',
      sqlitePath: '/test/store/dd.sqlite',
      collectionCount: 2,
      documentCount: 4,
      serializedBytes: 25 * 4096,
      lastPersistAt: '2026-03-18T12:34:56.000Z',
      collections: [
        { name: 'app_info', documents: 1 },
        { name: 'containers', documents: 3 },
      ],
    });
  });

  test('should fall back to zero bytes when the database answers no page_count/page_size pragma', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
      },
      // The bare mock's prepare()/pragma() answer every call with an empty
      // result regardless of the SQL text or pragma name, exercising the
      // `?? 0` fallback getDatabaseFileSize() takes when a driver answers no
      // page_count/page_size at all.
      sqliteOpenDatabase: vi.fn(() => createSqliteDbMock()),
    });

    const storeWithNoPragmaAnswer = await import('./index.js');
    await storeWithNoPragmaAnswer.init();

    expect(storeWithNoPragmaAnswer.getDebugSnapshot()).toMatchObject({
      collectionCount: 0,
      documentCount: 0,
      serializedBytes: 0,
      collections: [],
    });
  });

  test('should return zero collections and no persisted-at when the store was never initialized', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        statSync: vi.fn(() => ({ mtime: new Date('2026-03-18T12:34:56.000Z') })),
      },
    });

    const storeWithoutInit = await import('./index.js');

    expect(storeWithoutInit.getDebugSnapshot()).toEqual({
      memoryMode: false,
      path: undefined,
      sqlitePath: undefined,
      collectionCount: 0,
      documentCount: 0,
      serializedBytes: 0,
      lastPersistAt: undefined,
      collections: [],
    });
  });

  test('should return undefined lastPersistAt when store runs in memory mode', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        statSync: vi.fn(() => ({ mtime: new Date('2026-03-18T12:34:56.000Z') })),
      },
      sqliteOpenDatabase: vi.fn(() => createDebugSnapshotSqliteDbMock()),
    });

    const storeInMemory = await import('./index.js');
    await storeInMemory.init({ memory: true });

    expect(storeInMemory.getDebugSnapshot()).toEqual({
      memoryMode: true,
      path: '/test/store/test.json',
      sqlitePath: '/test/store/dd.sqlite',
      collectionCount: 0,
      documentCount: 0,
      serializedBytes: 0,
      lastPersistAt: undefined,
      collections: [],
    });
  });

  test('should return undefined lastPersistAt when statSync throws', async () => {
    vi.resetModules();
    registerCommonMocks({
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
        statSync: vi.fn(() => {
          throw new Error('stat failed');
        }),
      },
      sqliteOpenDatabase: vi.fn(() =>
        createDebugSnapshotSqliteDbMock({ tables: { only: 1 }, pageCount: 4, pageSize: 4096 }),
      ),
    });

    const storeWithStatError = await import('./index.js');
    await storeWithStatError.init();

    expect(storeWithStatError.getDebugSnapshot()).toEqual({
      memoryMode: false,
      path: '/test/store/test.json',
      sqlitePath: '/test/store/dd.sqlite',
      collectionCount: 1,
      documentCount: 1,
      serializedBytes: 4 * 4096,
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
    resetFsMock({ existsSync: vi.fn(() => true), mkdirSync: vi.fn(), renameSync: vi.fn() });
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
    vi.doMock('./container', createContainerMock);
    vi.doMock('./name-bindings', createCollectionsMock);
    vi.doMock('./notification', createNotificationMock);
    vi.doMock('./notification-history', createCollectionsMock);
    vi.doMock('./notification-outbox', createCollectionsMock);
    vi.doMock('./secrets', createCollectionsMock);
    vi.doMock('./settings', createCollectionsMock);
    vi.doMock('./update-lifecycle-cache', createCollectionsMock);
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
