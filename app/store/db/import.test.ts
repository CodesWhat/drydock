import fs from 'node:fs';
import path from 'node:path';
import {
  createMigratedMemoryDatabase,
  createTemporaryStoreDirectory,
  removeTemporaryStoreDirectory,
  writeLokiStoreFile,
} from '../../test/sqlite-db.js';
import { type Database, openDatabase, StoreError } from './driver.js';
import {
  type CollectionImporter,
  IMPORT_FAILED_CODE,
  IMPORT_MARKER_KEY,
  importIntoDatabase,
  LEGACY_STORE_BACKUP_SUFFIX,
  readStoreMetadata,
  removeDatabaseFiles,
  runFirstStartImport,
  syncDirectory,
  writeStoreMetadata,
} from './import.js';
import { COLLECTION_IMPORTERS } from './importers/index.js';
import { parseLokiDatabase } from './loki-json.js';

const { logMock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../log/index.js', () => ({
  default: { child: () => logMock },
}));

const EMPTY_SNAPSHOT = () => parseLokiDatabase(JSON.stringify({ collections: [] }), 'test');

function throwingImporter(failure: unknown): CollectionImporter {
  return {
    collection: 'secrets',
    table: 'secrets',
    importInto(): number {
      throw failure;
    },
  };
}

describe('store/db/import', () => {
  let storeDirectory: string;
  let legacyStorePath: string;
  let databasePath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    storeDirectory = createTemporaryStoreDirectory();
    legacyStorePath = path.join(storeDirectory, 'dd.json');
    databasePath = path.join(storeDirectory, 'dd.sqlite');
  });

  afterEach(() => {
    removeTemporaryStoreDirectory(storeDirectory);
  });

  function writeLegacyStore(): void {
    writeLokiStoreFile(legacyStorePath, [
      { name: 'secrets', data: [{ sessionSecret: 'session-secret-value' }] },
      { name: 'Sessions', data: [{ sid: 'abc' }] },
    ]);
  }

  function importOnce(importers: readonly CollectionImporter[] = COLLECTION_IMPORTERS) {
    return runFirstStartImport({ storeDirectory, legacyStorePath, databasePath, importers });
  }

  describe('store metadata', () => {
    let db: Database;

    beforeEach(() => {
      db = createMigratedMemoryDatabase();
    });

    afterEach(() => {
      db.close();
    });

    test('reads back nothing for a key that was never written', () => {
      expect(readStoreMetadata(db, 'nope')).toBeUndefined();
    });

    test('upserts a key', () => {
      writeStoreMetadata(db, 'k', 'first');
      writeStoreMetadata(db, 'k', 'second');
      expect(readStoreMetadata(db, 'k')).toBe('second');
      expect(db.prepare('SELECT COUNT(*) AS n FROM store_metadata').get()).toEqual({ n: 1 });
    });
  });

  describe('importIntoDatabase', () => {
    let db: Database;

    beforeEach(() => {
      db = createMigratedMemoryDatabase();
    });

    afterEach(() => {
      db.close();
    });

    test('runs the registered importers and writes the marker', () => {
      const snapshot = parseLokiDatabase(
        JSON.stringify({ collections: [{ name: 'secrets', data: [{ sessionSecret: 's' }] }] }),
        'dd.json',
      );
      const report = importIntoDatabase({
        db,
        snapshot,
        sessionDocuments: [],
        importers: COLLECTION_IMPORTERS,
        source: 'dd.json',
      });

      expect(report).toEqual({
        imported: true,
        rowsByTable: {
          app_info: 0,
          approvals: 0,
          secrets: 1,
          settings: 0,
          ui_preferences: 0,
          agent_keys: 0,
          name_bindings: 0,
          api_keys: 0,
          audit: 0,
          backups: 0,
          notification_history: 0,
          notification_outbox: 0,
          notification_rules: 0,
          update_lifecycle_cache: 0,
          update_operations: 0,
          update_policy_retention_cache: 0,
          containers: 0,
        },
      });
      expect(JSON.parse(String(readStoreMetadata(db, IMPORT_MARKER_KEY)))).toMatchObject({
        source: 'dd.json',
        rowsByTable: {
          app_info: 0,
          approvals: 0,
          secrets: 1,
          settings: 0,
          ui_preferences: 0,
          agent_keys: 0,
          name_bindings: 0,
          api_keys: 0,
          audit: 0,
          backups: 0,
          notification_history: 0,
          notification_outbox: 0,
          notification_rules: 0,
          update_lifecycle_cache: 0,
          update_operations: 0,
          update_policy_retention_cache: 0,
          containers: 0,
        },
      });
    });

    test('is a no-op with no registered importers', () => {
      expect(
        importIntoDatabase({
          db,
          snapshot: EMPTY_SNAPSHOT(),
          sessionDocuments: [],
          importers: [],
          source: 'dd.json',
        }),
      ).toEqual({ imported: true, rowsByTable: {} });
    });

    test('never imports twice into the same database', () => {
      const options = {
        db,
        snapshot: EMPTY_SNAPSHOT(),
        sessionDocuments: [],
        importers: COLLECTION_IMPORTERS,
        source: 'dd.json',
      };
      importIntoDatabase(options);
      expect(importIntoDatabase(options)).toEqual({ imported: false, rowsByTable: {} });
      expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('skipping import'));
    });

    test('hands the resolved session documents to the importers', () => {
      const seen: unknown[] = [];
      importIntoDatabase({
        db,
        snapshot: EMPTY_SNAPSHOT(),
        sessionDocuments: [{ sid: 'abc' }],
        importers: [
          {
            collection: 'Sessions',
            table: 'sessions',
            importInto(context): number {
              seen.push(...context.sessionDocuments);
              return context.sessionDocuments.length;
            },
          },
        ],
        source: 'dd.json',
      });
      expect(seen).toEqual([{ sid: 'abc' }]);
    });
  });

  describe('runFirstStartImport', () => {
    test('imports the legacy store, then backs it up', () => {
      writeLegacyStore();
      const before = fs.readFileSync(legacyStorePath);

      const result = importOnce();

      expect(result).toEqual({
        status: 'imported',
        databasePath,
        backupPath: `${legacyStorePath}${LEGACY_STORE_BACKUP_SUFFIX}`,
        rowsByTable: {
          app_info: 0,
          approvals: 0,
          secrets: 1,
          settings: 0,
          ui_preferences: 0,
          agent_keys: 0,
          name_bindings: 0,
          api_keys: 0,
          audit: 0,
          backups: 0,
          notification_history: 0,
          notification_outbox: 0,
          notification_rules: 0,
          update_lifecycle_cache: 0,
          update_operations: 0,
          update_policy_retention_cache: 0,
          containers: 0,
        },
      });
      expect(fs.existsSync(legacyStorePath)).toBe(false);
      expect(fs.readFileSync(`${legacyStorePath}${LEGACY_STORE_BACKUP_SUFFIX}`)).toEqual(before);
      expect(fs.existsSync(`${databasePath}.importing`)).toBe(false);

      const db = openDatabase(databasePath);
      expect(db.prepare('SELECT session_secret FROM secrets WHERE id = 1').get()).toEqual({
        session_secret: 'session-secret-value',
      });
      db.close();
    });

    test('fsyncs the store directory after each rename, not before', () => {
      writeLegacyStore();
      const order: string[] = [];
      const originalFsyncSync = fs.fsyncSync;
      const originalRenameSync = fs.renameSync;
      const fsyncSpy = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
        order.push('fsync');
        return originalFsyncSync(fd);
      });
      const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
        order.push(`rename:${path.basename(String(oldPath))}`);
        return originalRenameSync(oldPath, newPath);
      });

      try {
        expect(importOnce().status).toBe('imported');
        expect(order).toEqual([
          `rename:${path.basename(databasePath)}.importing`,
          'fsync',
          'rename:dd.json',
          'fsync',
        ]);
      } finally {
        fsyncSpy.mockRestore();
        renameSpy.mockRestore();
      }
    });

    test('never re-imports once the database exists', () => {
      writeLegacyStore();
      importOnce();
      writeLegacyStore();

      expect(importOnce()).toEqual({ status: 'database-exists', databasePath, rowsByTable: {} });
      expect(fs.existsSync(legacyStorePath)).toBe(true);
    });

    test('does nothing on a fresh install with no legacy store', () => {
      expect(importOnce()).toEqual({ status: 'no-legacy-store', databasePath, rowsByTable: {} });
      expect(fs.existsSync(databasePath)).toBe(false);
    });

    test('never overwrites an existing backup', () => {
      writeLegacyStore();
      const backupPath = `${legacyStorePath}${LEGACY_STORE_BACKUP_SUFFIX}`;
      fs.writeFileSync(backupPath, 'the original 1.7 store', 'utf8');

      const result = importOnce();

      expect(result.backupPath).toBeUndefined();
      expect(fs.readFileSync(backupPath, 'utf8')).toBe('the original 1.7 store');
      expect(fs.existsSync(legacyStorePath)).toBe(true);
      expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });

    test('discards a leftover .importing database from an earlier crash', () => {
      writeLegacyStore();
      fs.writeFileSync(`${databasePath}.importing`, 'half-written garbage', 'utf8');
      fs.writeFileSync(`${databasePath}.importing-wal`, 'stale wal', 'utf8');

      expect(importOnce().status).toBe('imported');
      expect(fs.existsSync(`${databasePath}.importing-wal`)).toBe(false);
    });

    test('leaves nothing behind when an importer throws, and the next start succeeds', () => {
      writeLegacyStore();
      const before = fs.readFileSync(legacyStorePath);

      let thrown: unknown;
      try {
        importOnce([throwingImporter(new Error('importer exploded'))]);
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(StoreError);
      expect((thrown as StoreError).code).toBe(IMPORT_FAILED_CODE);
      expect((thrown as Error).message).toContain('importer exploded');
      expect(fs.existsSync(databasePath)).toBe(false);
      expect(fs.existsSync(`${databasePath}.importing`)).toBe(false);
      expect(fs.readFileSync(legacyStorePath)).toEqual(before);

      expect(importOnce().status).toBe('imported');
    });

    test('reports an importer that throws a non-error', () => {
      writeLegacyStore();
      expect(() => importOnce([throwingImporter('just a string')])).toThrow(/just a string/);
    });

    test('fails the boot rather than starting empty when the legacy store is unreadable', () => {
      fs.writeFileSync(legacyStorePath, 'not json', 'utf8');
      expect(() => importOnce()).toThrow(/not valid JSON/);
      expect(fs.existsSync(databasePath)).toBe(false);
    });
  });

  describe('filesystem helpers', () => {
    test('removes a database and its write-ahead log sidecars', () => {
      for (const suffix of ['', '-wal', '-shm']) {
        fs.writeFileSync(`${databasePath}${suffix}`, 'x', 'utf8');
      }
      removeDatabaseFiles(databasePath);
      for (const suffix of ['', '-wal', '-shm']) {
        expect(fs.existsSync(`${databasePath}${suffix}`)).toBe(false);
      }
    });

    test('flushes a real directory silently', () => {
      syncDirectory(storeDirectory);
      expect(logMock.warn).not.toHaveBeenCalled();
    });

    test('warns instead of failing when the directory cannot be flushed', () => {
      syncDirectory(path.join(storeDirectory, 'does-not-exist'));
      expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('Could not flush'));
    });
  });
});
