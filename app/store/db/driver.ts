/**
 * SQLite driver for the v1.8 store (roadmap 7-STORE, slice 1).
 *
 * Nothing in the running app imports this yet. It exists so the later slices
 * have one seam to move `app/store/util.ts`'s `initCollection` onto, and so the
 * driver choice stays reversible.
 *
 * WHAT THIS INTERFACE COVERS, AND WHY
 *
 * The shipped driver is `node:sqlite`, built into the pinned Node 24 base
 * image, so the migration adds no native module and no compile toolchain. The
 * decision is reversible only if `better-sqlite3` can be dropped in behind the
 * same `Database`/`Statement` types, and the two APIs differ in five places
 * that would otherwise leak into every caller:
 *
 * 1. `transaction(fn)`. `better-sqlite3` has one; `node:sqlite` has nothing.
 *    It is implemented here over BEGIN/COMMIT/ROLLBACK with named SAVEPOINTs
 *    for nesting, so no calling code ever writes BEGIN itself.
 * 2. `pragma(name, value)`. `better-sqlite3` answers `[{journal_mode:'wal'}]`,
 *    `node:sqlite` answers `{journal_mode:'wal'}`, and several pragmas answer
 *    nothing at all. Normalised here to one scalar or `undefined`.
 * 3. Error shape. `better-sqlite3` throws `SqliteError` with
 *    `code: 'SQLITE_CONSTRAINT_UNIQUE'`; `node:sqlite` throws a plain `Error`
 *    with `code: 'ERR_SQLITE_ERROR'` and a numeric `errcode`. Both are
 *    normalised to `StoreError` / `StoreConstraintError` carrying the symbolic
 *    extended result code, so no caller branches on a raw driver code.
 * 4. Names that collide with opposite meanings: `db.open` is a boolean in
 *    `better-sqlite3` and a method in `node:sqlite`, `inTransaction` versus
 *    `isTransaction`, `stmt.source` versus `stmt.sourceSQL`. Only `isOpen`,
 *    `isTransaction` and `sql` are exposed.
 * 5. `backup()` is a database method in `better-sqlite3` and a module function
 *    in `node:sqlite`.
 *
 * Deliberately NOT exposed, because using them would pin the choice to one
 * driver: `raw()`, `pluck()`, `expand()`, `bind()`, virtual tables, and
 * sessions/changesets. Rows are always plain objects.
 *
 * One integer policy, set once here and never per statement: every SQLite
 * INTEGER is read as a JavaScript number. Nothing in the schema exceeds 2^53
 * (the largest values stored are epoch milliseconds).
 */
import { createRequire } from 'node:module';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import logger from '../../log/index.js';

const log = logger.child({ component: 'store.db' });

export type SqlValue = null | number | string | Uint8Array;
export type SqlBinding = SqlValue | Record<string, SqlValue>;
export type Row = Record<string, SqlValue>;

export interface StatementRunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Statement {
  /** The statement's own SQL text. `sourceSQL` on node:sqlite, `source` on better-sqlite3. */
  readonly sql: string;
  run(...parameters: SqlBinding[]): StatementRunResult;
  get(...parameters: SqlBinding[]): Row | undefined;
  all(...parameters: SqlBinding[]): Row[];
  iterate(...parameters: SqlBinding[]): IterableIterator<Row>;
}

export type TransactionMode = 'deferred' | 'immediate' | 'exclusive';

export interface Database {
  /** False once close() has run. Never named `open`: that is a method elsewhere. */
  readonly isOpen: boolean;
  readonly isTransaction: boolean;
  exec(sql: string): void;
  /** Prepared statements are cached per connection, keyed by SQL text. */
  prepare(sql: string): Statement;
  pragma(name: string, value?: string | number): SqlValue | undefined;
  transaction<T>(run: () => T, mode?: TransactionMode): T;
  backup(destinationPath: string): Promise<number>;
  /** Idempotent: closing an already closed database is a no-op. */
  close(): void;
}

export interface OpenDatabaseOptions {
  readOnly?: boolean;
  busyTimeoutMs?: number;
}

export const MEMORY_DATABASE_LOCATION = ':memory:';
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * Extended result codes this store can actually produce, mapped to the symbolic
 * names `better-sqlite3` reports directly. Anything unmapped keeps its number.
 */
const SQLITE_RESULT_CODES: Record<number, string> = {
  1: 'SQLITE_ERROR',
  5: 'SQLITE_BUSY',
  6: 'SQLITE_LOCKED',
  8: 'SQLITE_READONLY',
  10: 'SQLITE_IOERR',
  11: 'SQLITE_CORRUPT',
  14: 'SQLITE_CANTOPEN',
  19: 'SQLITE_CONSTRAINT',
  21: 'SQLITE_MISUSE',
  275: 'SQLITE_CONSTRAINT_CHECK',
  531: 'SQLITE_CONSTRAINT_COMMITHOOK',
  787: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  1043: 'SQLITE_CONSTRAINT_FUNCTION',
  1299: 'SQLITE_CONSTRAINT_NOTNULL',
  1555: 'SQLITE_CONSTRAINT_PRIMARYKEY',
  1811: 'SQLITE_CONSTRAINT_TRIGGER',
  2067: 'SQLITE_CONSTRAINT_UNIQUE',
  2323: 'SQLITE_CONSTRAINT_VTAB',
  2579: 'SQLITE_CONSTRAINT_ROWID',
  2835: 'SQLITE_CONSTRAINT_PINNED',
  3091: 'SQLITE_CONSTRAINT_DATATYPE',
};

const CONSTRAINT_CODE_PREFIX = 'SQLITE_CONSTRAINT';
const UNKNOWN_STORE_ERROR_CODE = 'STORE_ERROR';

/** Every error thrown out of this module. `code` is stable across drivers. */
export class StoreError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoreError';
    this.code = code;
  }
}

/**
 * A SQLITE_CONSTRAINT_* failure. A unique violation is
 * `error.code === 'SQLITE_CONSTRAINT_UNIQUE'`, or
 * `'SQLITE_CONSTRAINT_PRIMARYKEY'` when the collision is on the primary key.
 */
export class StoreConstraintError extends StoreError {
  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, code, options);
    this.name = 'StoreConstraintError';
  }
}

interface RawSqliteError {
  code?: unknown;
  errcode?: unknown;
  message?: unknown;
}

function resolveSymbolicCode(raw: RawSqliteError): string {
  // better-sqlite3 already reports the symbolic name.
  if (typeof raw.code === 'string' && raw.code.startsWith('SQLITE_')) {
    return raw.code;
  }
  // node:sqlite reports ERR_SQLITE_ERROR plus a numeric extended result code.
  if (typeof raw.errcode === 'number') {
    return SQLITE_RESULT_CODES[raw.errcode] ?? `SQLITE_UNKNOWN_${raw.errcode}`;
  }
  return UNKNOWN_STORE_ERROR_CODE;
}

/** Normalise any driver error into a StoreError with a driver-independent code. */
export function normalizeSqliteError(error: unknown): StoreError {
  if (error instanceof StoreError) {
    return error;
  }
  const raw = (error ?? {}) as RawSqliteError;
  const code = resolveSymbolicCode(raw);
  const message = typeof raw.message === 'string' ? raw.message : String(error);
  if (code.startsWith(CONSTRAINT_CODE_PREFIX)) {
    return new StoreConstraintError(message, code, { cause: error });
  }
  return new StoreError(message, code, { cause: error });
}

function guard<T>(run: () => T): T {
  try {
    return run();
  } catch (error: unknown) {
    throw normalizeSqliteError(error);
  }
}

type SqliteModule = {
  DatabaseSync: typeof DatabaseSync;
  backup: (source: DatabaseSync, destination: string) => Promise<number>;
};

const requireFromModule = createRequire(import.meta.url);

/**
 * Resolve `node:sqlite`. Node 24 has it built in with no flag and no
 * experimental warning (verified on 24.20.0), so a failure here means the
 * runtime is older than the pinned base image and the message has to say so.
 */
export function loadSqliteModule(load: (id: string) => unknown = requireFromModule): SqliteModule {
  try {
    return load('node:sqlite') as SqliteModule;
  } catch (error: unknown) {
    throw new StoreError(
      'node:sqlite is unavailable in this runtime. Drydock requires Node 24 or newer, where it is built in and needs no command-line flag.',
      UNKNOWN_STORE_ERROR_CODE,
      { cause: error },
    );
  }
}

const sqlite = loadSqliteModule();

// A pragma name is never user input, but it cannot be bound as a parameter
// either, so the identifier and the literal are both shape-checked before they
// reach the SQL text.
const PRAGMA_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;
const PRAGMA_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/;

function buildPragmaSql(name: string, value?: string | number): string {
  if (!PRAGMA_NAME_PATTERN.test(name)) {
    throw new StoreError(`Invalid pragma name: ${name}`, UNKNOWN_STORE_ERROR_CODE);
  }
  if (value === undefined) {
    return `PRAGMA ${name}`;
  }
  const literal = String(value);
  if (!PRAGMA_VALUE_PATTERN.test(literal)) {
    throw new StoreError(`Invalid pragma value for ${name}: ${literal}`, UNKNOWN_STORE_ERROR_CODE);
  }
  return `PRAGMA ${name} = ${literal}`;
}

/**
 * `node:sqlite` evaluates a prepared statement's rows lazily: `iterate()`
 * itself never touches the database, only each `next()` call does. Wrapping
 * just the call that produces the iterator, as the other methods do, leaves
 * every subsequent step error unguarded, so a constraint or I/O failure mid
 * scan would surface as the raw `ERR_SQLITE_ERROR` instead of a `StoreError`.
 * This wraps `next()` (and `return()`, so an early `break` out of a `for..of`
 * still closes the underlying statement cleanly) through the same guard.
 */
function wrapIterator(rawIterator: IterableIterator<Row>): IterableIterator<Row> {
  const wrapped: IterableIterator<Row> = {
    next(): IteratorResult<Row> {
      return guard(() => rawIterator.next());
    },
    [Symbol.iterator](): IterableIterator<Row> {
      return wrapped;
    },
  };
  if (typeof rawIterator.return === 'function') {
    const rawReturn = rawIterator.return.bind(rawIterator);
    wrapped.return = (value?: Row): IteratorResult<Row> => guard(() => rawReturn(value));
  }
  return wrapped;
}

function wrapStatement(statement: StatementSync): Statement {
  return {
    get sql(): string {
      return statement.sourceSQL;
    },
    run(...parameters: SqlBinding[]): StatementRunResult {
      const result = guard(() => statement.run(...(parameters as never[])));
      return {
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid),
      };
    },
    get(...parameters: SqlBinding[]): Row | undefined {
      return guard(() => statement.get(...(parameters as never[]))) as Row | undefined;
    },
    all(...parameters: SqlBinding[]): Row[] {
      return guard(() => statement.all(...(parameters as never[]))) as Row[];
    },
    iterate(...parameters: SqlBinding[]): IterableIterator<Row> {
      const rawIterator = guard(
        () => statement.iterate(...(parameters as never[])) as unknown as IterableIterator<Row>,
      );
      return wrapIterator(rawIterator);
    },
  };
}

/**
 * Ask for WAL and report what was actually granted.
 *
 * `/store` is routinely an NFS or CIFS mount, and WAL needs shared memory plus
 * POSIX advisory locks that some of those mounts do not provide. A refusal
 * falls back to TRUNCATE with a warning naming the path rather than failing the
 * boot: TRUNCATE is slower and correct, and a hard failure would strand every
 * user whose setup works today.
 */
export function applyJournalMode(db: Pick<Database, 'pragma'>, location: string): string {
  const granted = String(db.pragma('journal_mode', 'WAL'));
  if (granted === 'wal') {
    return granted;
  }
  const fallback = String(db.pragma('journal_mode', 'TRUNCATE'));
  log.warn(
    `Write-ahead logging was refused for the store database at ${location} (journal_mode reported "${granted}"); continuing on "${fallback}"`,
  );
  return fallback;
}

/**
 * Apply the store's fixed pragma order: journal mode durability, foreign
 * keys, lock wait.
 *
 * `journalMode` is the value `applyJournalMode` actually granted, or
 * `undefined` when it was never probed at all (a read-only connection or a
 * memory database, neither of which writes a journal). `synchronous =
 * NORMAL` is only safe when the WAL file itself supplies the durability
 * guarantee `FULL` exists for: under a rollback journal (the fallback
 * `applyJournalMode` takes when WAL is refused, e.g. on NFS/CIFS mounts) a
 * crash between deleting and recreating the journal can corrupt the database
 * under NORMAL, so a writable file-backed database that isn't in WAL mode
 * gets FULL instead. Everything else keeps NORMAL, unchanged.
 */
export function applyOpenPragmas(db: Database, busyTimeoutMs: number, journalMode?: string): void {
  db.pragma('synchronous', journalMode !== undefined && journalMode !== 'wal' ? 'FULL' : 'NORMAL');
  db.pragma('foreign_keys', 'ON');
  db.pragma('busy_timeout', busyTimeoutMs);
}

/**
 * Open a database and bring it to the pragma state the store expects.
 *
 * `location` is either an absolute file path or `:memory:`. Memory databases
 * cannot journal, so the WAL probe is skipped for them rather than warning on
 * every agent-mode start; a read-only connection cannot change journal mode at
 * all, so it is skipped there too.
 */
export function openDatabase(location: string, options: OpenDatabaseOptions = {}): Database {
  const readOnly = options.readOnly === true;
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const raw = guard(
    () =>
      new sqlite.DatabaseSync(location, {
        open: true,
        readOnly,
        timeout: busyTimeoutMs,
        allowExtension: false,
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: false,
      }),
  );

  const statementCache = new Map<string, Statement>();
  let savepointDepth = 0;

  const database: Database = {
    get isOpen(): boolean {
      return raw.isOpen;
    },
    get isTransaction(): boolean {
      return raw.isTransaction;
    },
    exec(sql: string): void {
      guard(() => raw.exec(sql));
    },
    prepare(sql: string): Statement {
      const cached = statementCache.get(sql);
      if (cached) {
        return cached;
      }
      const statement = wrapStatement(guard(() => raw.prepare(sql)));
      statementCache.set(sql, statement);
      return statement;
    },
    pragma(name: string, value?: string | number): SqlValue | undefined {
      const row = guard(() => raw.prepare(buildPragmaSql(name, value)).get());
      const [first] = Object.values(row ?? {});
      return first as SqlValue | undefined;
    },
    transaction<T>(run: () => T, mode: TransactionMode = 'immediate'): T {
      const nested = savepointDepth > 0;
      const savepoint = `dd_savepoint_${savepointDepth}`;
      database.exec(nested ? `SAVEPOINT ${savepoint}` : `BEGIN ${mode.toUpperCase()}`);
      savepointDepth += 1;
      try {
        const result = run();
        database.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (error: unknown) {
        // A nested rollback also releases the savepoint, so re-entering the
        // same depth cannot stack two savepoints under one name.
        database.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
        // Driver errors are already normalised by guard(); an application error
        // thrown inside the callback propagates unchanged so the caller still
        // recognises its own type.
        throw error;
      } finally {
        savepointDepth -= 1;
      }
    },
    async backup(destinationPath: string): Promise<number> {
      try {
        return await sqlite.backup(raw, destinationPath);
      } catch (error: unknown) {
        throw normalizeSqliteError(error);
      }
    },
    close(): void {
      if (!raw.isOpen) {
        return;
      }
      statementCache.clear();
      guard(() => raw.close());
    },
  };

  let journalMode: string | undefined;
  if (!readOnly && location !== MEMORY_DATABASE_LOCATION) {
    journalMode = applyJournalMode(database, location);
  }
  applyOpenPragmas(database, busyTimeoutMs, journalMode);
  return database;
}
