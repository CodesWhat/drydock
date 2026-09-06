import fs from 'node:fs';
import path from 'node:path';
import {
  createTemporaryStoreDirectory,
  removeTemporaryStoreDirectory,
} from '../../test/sqlite-db.js';
import {
  applyJournalMode,
  type Database,
  DEFAULT_BUSY_TIMEOUT_MS,
  loadSqliteModule,
  MEMORY_DATABASE_LOCATION,
  normalizeSqliteError,
  openDatabase,
  StoreConstraintError,
  StoreError,
} from './driver.js';

const { logMock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../log/index.js', () => ({
  default: { child: () => logMock },
}));

const CREATE_TABLE = 'CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER NOT NULL) STRICT';

describe('store/db/driver', () => {
  let storeDirectory: string;
  let databasePath: string;
  const openDatabases: Database[] = [];

  function open(location: string, options?: Parameters<typeof openDatabase>[1]): Database {
    const db = openDatabase(location, options);
    openDatabases.push(db);
    return db;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    storeDirectory = createTemporaryStoreDirectory();
    databasePath = path.join(storeDirectory, 'dd.sqlite');
  });

  afterEach(() => {
    while (openDatabases.length > 0) {
      openDatabases.pop()?.close();
    }
    removeTemporaryStoreDirectory(storeDirectory);
  });

  describe('loadSqliteModule', () => {
    test('resolves the built-in module with the default loader', () => {
      expect(typeof loadSqliteModule().DatabaseSync).toBe('function');
    });

    test('reports a runtime without node:sqlite as a StoreError', () => {
      const failure = new Error('No such built-in module: node:sqlite');
      expect(() =>
        loadSqliteModule(() => {
          throw failure;
        }),
      ).toThrow(/requires Node 24 or newer/);
    });
  });

  describe('normalizeSqliteError', () => {
    test('passes an already normalised error straight through', () => {
      const original = new StoreError('boom', 'SQLITE_BUSY');
      expect(normalizeSqliteError(original)).toBe(original);
    });

    test('keeps the symbolic code a better-sqlite3 style error already carries', () => {
      const normalized = normalizeSqliteError({
        code: 'SQLITE_CONSTRAINT_UNIQUE',
        message: 'UNIQUE constraint failed: t.id',
      });
      expect(normalized).toBeInstanceOf(StoreConstraintError);
      expect(normalized.code).toBe('SQLITE_CONSTRAINT_UNIQUE');
    });

    test('maps a node:sqlite numeric extended result code', () => {
      const normalized = normalizeSqliteError({
        code: 'ERR_SQLITE_ERROR',
        errcode: 787,
        message: 'FOREIGN KEY constraint failed',
      });
      expect(normalized).toBeInstanceOf(StoreConstraintError);
      expect(normalized.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
    });

    test('keeps an unmapped extended result code visible', () => {
      expect(normalizeSqliteError({ errcode: 9999, message: 'x' }).code).toBe(
        'SQLITE_UNKNOWN_9999',
      );
    });

    test('falls back to a generic code and a stringified message', () => {
      const normalized = normalizeSqliteError(null);
      expect(normalized).toBeInstanceOf(StoreError);
      expect(normalized).not.toBeInstanceOf(StoreConstraintError);
      expect(normalized.code).toBe('STORE_ERROR');
      expect(normalized.message).toBe('null');
    });

    test('stringifies a non-string message', () => {
      expect(normalizeSqliteError({ errcode: 1, message: 42 }).message).toBe('[object Object]');
    });
  });

  describe('open and close', () => {
    test('creates a file database in WAL with the store pragmas applied', () => {
      const db = open(databasePath);
      expect(db.isOpen).toBe(true);
      expect(db.pragma('journal_mode')).toBe('wal');
      expect(db.pragma('synchronous')).toBe(1);
      expect(db.pragma('foreign_keys')).toBe(1);
      expect(db.pragma('busy_timeout')).toBe(DEFAULT_BUSY_TIMEOUT_MS);
      expect(fs.existsSync(databasePath)).toBe(true);
      expect(logMock.warn).not.toHaveBeenCalled();
    });

    test('honours an explicit busy timeout', () => {
      expect(open(databasePath, { busyTimeoutMs: 1234 }).pragma('busy_timeout')).toBe(1234);
    });

    test('skips the journal probe for a memory database, so agent mode never warns', () => {
      const db = open(MEMORY_DATABASE_LOCATION);
      expect(db.pragma('journal_mode')).toBe('memory');
      expect(logMock.warn).not.toHaveBeenCalled();
    });

    test('opens read-only and refuses writes with a normalised code', () => {
      // The writer stays open so the -shm file exists: SQLite cannot create
      // one from a read-only connection.
      open(databasePath).exec(CREATE_TABLE);

      const readOnly = open(databasePath, { readOnly: true });
      expect(() => readOnly.exec("INSERT INTO t (id, v) VALUES ('a', 1)")).toThrow(
        expect.objectContaining({ code: 'SQLITE_READONLY' }),
      );
    });

    test('closing twice is a no-op', () => {
      const db = open(databasePath);
      db.close();
      expect(db.isOpen).toBe(false);
      expect(() => db.close()).not.toThrow();
    });
  });

  describe('applyJournalMode', () => {
    test('reports wal when the filesystem grants it', () => {
      expect(applyJournalMode(open(databasePath), databasePath)).toBe('wal');
    });

    test('falls back and warns when wal is refused', () => {
      const db = open(MEMORY_DATABASE_LOCATION);
      expect(applyJournalMode(db, '/mnt/nas/dd.sqlite')).toBe('memory');
      expect(logMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('Write-ahead logging was refused'),
      );
      expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('/mnt/nas/dd.sqlite'));
    });
  });

  describe('pragma', () => {
    test('returns undefined for a pragma that answers no rows', () => {
      expect(open(databasePath).pragma('foreign_keys', 'ON')).toBeUndefined();
    });

    test('rejects a pragma name that is not a bare identifier', () => {
      const db = open(databasePath);
      expect(() => db.pragma('journal_mode; DROP TABLE t')).toThrow(StoreError);
    });

    test('rejects a pragma value that is not a bare literal', () => {
      const db = open(databasePath);
      expect(() => db.pragma('journal_mode', "WAL'; DROP TABLE t --")).toThrow(
        /Invalid pragma value/,
      );
    });
  });

  describe('statements', () => {
    test('caches prepared statements by SQL text and exposes their source', () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      const first = db.prepare('SELECT id, v FROM t ORDER BY id');
      expect(db.prepare('SELECT id, v FROM t ORDER BY id')).toBe(first);
      expect(first.sql).toBe('SELECT id, v FROM t ORDER BY id');
    });

    test('runs, reads and iterates plain row objects', () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      const insert = db.prepare('INSERT INTO t (id, v) VALUES (?, ?)');
      expect(insert.run('a', 1)).toEqual({ changes: 1, lastInsertRowid: 1 });
      insert.run('b', 2);

      const select = db.prepare('SELECT id, v FROM t ORDER BY id');
      expect(select.get()).toEqual({ id: 'a', v: 1 });
      expect(select.all()).toEqual([
        { id: 'a', v: 1 },
        { id: 'b', v: 2 },
      ]);
      expect([...select.iterate()]).toHaveLength(2);
      expect(db.prepare('SELECT id FROM t WHERE id = ?').get('missing')).toBeUndefined();
    });

    test('binds named parameters', () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      db.prepare('INSERT INTO t (id, v) VALUES ($id, $v)').run({ $id: 'a', $v: 7 });
      expect(db.prepare('SELECT v FROM t WHERE id = $id').get({ $id: 'a' })).toEqual({ v: 7 });
    });

    test('normalises a unique violation', () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      const insert = db.prepare('INSERT INTO t (id, v) VALUES (?, ?)');
      insert.run('a', 1);
      let thrown: unknown;
      try {
        insert.run('a', 2);
      } catch (error: unknown) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(StoreConstraintError);
      expect((thrown as StoreError).code).toBe('SQLITE_CONSTRAINT_PRIMARYKEY');
      expect((thrown as Error).message).toContain('UNIQUE constraint failed');
    });

    test('normalises a STRICT type violation', () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      expect(() => db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run('a', 'x')).toThrow(
        expect.objectContaining({ code: 'SQLITE_CONSTRAINT_DATATYPE' }),
      );
    });

    test('normalises errors from exec and prepare', () => {
      const db = open(databasePath);
      expect(() => db.exec('SELECT * FROM nope')).toThrow(
        expect.objectContaining({ code: 'SQLITE_ERROR' }),
      );
      expect(() => db.prepare('NOT SQL')).toThrow(StoreError);
    });
  });

  describe('transaction', () => {
    test('commits and reports being in a transaction while it runs', () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      const seen = db.transaction(() => {
        db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run('a', 1);
        return db.isTransaction;
      });
      expect(seen).toBe(true);
      expect(db.isTransaction).toBe(false);
      expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 1 });
    });

    test('rolls back every write when the callback throws, and keeps the error', () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      const failure = new Error('importer exploded');
      expect(() =>
        db.transaction(() => {
          db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run('a', 1);
          throw failure;
        }),
      ).toThrow(failure);
      expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 0 });
      expect(db.isTransaction).toBe(false);
    });

    test('accepts an explicit mode', () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      db.transaction(
        () => db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run('a', 1),
        'deferred',
      );
      expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 1 });
    });

    test('nests through savepoints, so an inner failure does not lose the outer work', () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      db.transaction(() => {
        db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run('outer', 1);
        expect(() =>
          db.transaction(() => {
            db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run('inner', 2);
            throw new Error('inner failed');
          }),
        ).toThrow('inner failed');
        db.transaction(() => db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run('after', 3));
      });
      expect(db.prepare('SELECT id FROM t ORDER BY id').all()).toEqual([
        { id: 'after' },
        { id: 'outer' },
      ]);
    });
  });

  describe('backup', () => {
    test('copies the database to another file', async () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run('a', 1);
      const backupPath = path.join(storeDirectory, 'copy.sqlite');

      expect(await db.backup(backupPath)).toBeGreaterThan(0);

      const copy = open(backupPath);
      expect(copy.prepare('SELECT v FROM t WHERE id = ?').get('a')).toEqual({ v: 1 });
    });

    test('normalises a backup failure', async () => {
      const db = open(databasePath);
      db.exec(CREATE_TABLE);
      await expect(db.backup(path.join(storeDirectory, 'missing', 'copy.sqlite'))).rejects.toThrow(
        expect.objectContaining({ code: 'SQLITE_CANTOPEN' }),
      );
    });
  });
});
