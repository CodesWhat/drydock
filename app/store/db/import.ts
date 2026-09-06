/**
 * First-start import from the LokiJS store into SQLite (roadmap 7-STORE,
 * slice 1, spec section 3).
 *
 * Nothing calls this yet. Slice 2 wires it into `app/store/index.ts`, after the
 * existing `wud.json` to `dd.json` rename, which must still run first.
 *
 * The sequence, and why each step is where it is:
 *
 *   1. A database file that already exists is opened as-is and never
 *      re-imported. That, plus the atomic rename in step 5, is the whole
 *      idempotency story.
 *   2. No legacy file and no database means a fresh install: the caller creates
 *      an empty database and there is nothing to import.
 *   3. Otherwise the import runs into `<database>.importing`, never into the
 *      real filename, so a partial import is never visible. Any leftover from a
 *      previous crash is deleted rather than resumed: resuming would need
 *      per-collection progress tracking to be correct, and a one-shot operation
 *      does not justify paying for that.
 *   4. Every importer runs inside one BEGIN IMMEDIATE, with the marker row
 *      written in the same transaction, so the database is either fully
 *      imported and marked or not there at all.
 *   5. The temporary file is renamed into place and the directory is flushed,
 *      then `dd.json` is renamed to `dd.json.pre-1.8.bak` and the directory is
 *      flushed again. The flush runs after each rename, not before: what has
 *      to survive a crash is the directory entry the rename just changed, and
 *      an fsync before the rename does not make that entry durable.
 *
 * Failure fails the boot. The caller must not start on an empty store: a
 * process that looks healthy and silently persists nothing is worse than one
 * that does not start, and a half-imported store that started clean would begin
 * overwriting the only copy of the user's data. The same reasoning already
 * governs EROFS at `app/store/index.ts`.
 *
 * `dd.json.pre-1.8.bak` is the entire rollback story and nothing ever deletes
 * it, including later versions. An existing backup is never overwritten: the
 * legacy file is left exactly where it is and the situation is logged.
 */
import fs from 'node:fs';
import logger from '../../log/index.js';
import { type Database, openDatabase, StoreError } from './driver.js';
import {
  type LokiDatabaseSnapshot,
  type LokiDocument,
  readLokiDatabase,
  resolveLegacySessionDocuments,
} from './loki-json.js';
import { migrate } from './migrations.js';

const log = logger.child({ component: 'store.db' });

/** Suffix of the untouched pre-migration copy of the LokiJS store. */
export const LEGACY_STORE_BACKUP_SUFFIX = '.pre-1.8.bak';
/** Marker row in `store_metadata`; its presence means the import already ran. */
export const IMPORT_MARKER_KEY = 'legacy-json-import';
export const IMPORT_FAILED_CODE = 'STORE_IMPORT_FAILED';

const IMPORTING_SUFFIX = '.importing';
const SQLITE_SIDECAR_SUFFIXES = ['', '-wal', '-shm'];

export interface ImportContext {
  readonly db: Database;
  readonly snapshot: LokiDatabaseSnapshot;
  /** Resolved from the sessions file when present, from `dd.json` otherwise. */
  readonly sessionDocuments: readonly LokiDocument[];
}

/**
 * One collection's move from LokiJS to SQLite. Later slices add one of these
 * per collection to the registry in `./importers/index.ts`; the framework is
 * responsible for ordering, transactions and bookkeeping, an importer only
 * reads documents and writes rows.
 */
export interface CollectionImporter {
  /** The LokiJS collection name, as it appears in `dd.json`. */
  readonly collection: string;
  /** The SQLite table it writes, used for the per-table row report. */
  readonly table: string;
  /** Returns the number of rows written. */
  importInto(context: ImportContext): number;
}

export interface ImportReport {
  imported: boolean;
  rowsByTable: Record<string, number>;
}

type FirstStartImportStatus = 'imported' | 'database-exists' | 'no-legacy-store';

export interface FirstStartImportResult {
  status: FirstStartImportStatus;
  databasePath: string;
  /** Set only when this call created the backup. */
  backupPath?: string;
  rowsByTable: Record<string, number>;
}

export interface FirstStartImportOptions {
  /** Resolved `DD_STORE_PATH`. */
  storeDirectory: string;
  /** Resolved `DD_STORE_PATH`/`DD_STORE_FILE`, the LokiJS store. */
  legacyStorePath: string;
  /** Resolved `DD_STORE_PATH`/`DD_STORE_DB_FILE`, the SQLite database. */
  databasePath: string;
  importers: readonly CollectionImporter[];
}

export function readStoreMetadata(db: Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM store_metadata WHERE key = ?').get(key);
  return row === undefined ? undefined : String(row.value);
}

export function writeStoreMetadata(db: Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO store_metadata (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
}

/** Delete a SQLite database and its write-ahead log sidecars. */
export function removeDatabaseFiles(databasePath: string): void {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

/**
 * Flush a directory entry so a rename into it survives a crash. A filesystem
 * that refuses to open a directory for reading warns rather than failing the
 * import: the rename itself is still atomic, only the durability guarantee is
 * weaker.
 */
export function syncDirectory(directoryPath: string): void {
  let handle: number | undefined;
  try {
    handle = fs.openSync(directoryPath, 'r');
    fs.fsyncSync(handle);
  } catch (error: unknown) {
    log.warn(`Could not flush the store directory ${directoryPath}: ${String(error)}`);
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
}

export interface ImportIntoDatabaseOptions {
  db: Database;
  snapshot: LokiDatabaseSnapshot;
  sessionDocuments: readonly LokiDocument[];
  importers: readonly CollectionImporter[];
  /** Where the documents came from; recorded in the marker row. */
  source: string;
}

/**
 * Run every registered importer into an already migrated database, in one
 * transaction, and record the marker row. A database that already carries the
 * marker is left untouched.
 */
export function importIntoDatabase(options: ImportIntoDatabaseOptions): ImportReport {
  const { db, snapshot, sessionDocuments, importers, source } = options;
  const marker = readStoreMetadata(db, IMPORT_MARKER_KEY);
  if (marker !== undefined) {
    log.info(`Store database already imported from a legacy store (${marker}); skipping import`);
    return { imported: false, rowsByTable: {} };
  }

  return db.transaction(() => {
    const context: ImportContext = { db, snapshot, sessionDocuments };
    const rowsByTable: Record<string, number> = {};
    for (const importer of importers) {
      rowsByTable[importer.table] = importer.importInto(context);
    }
    writeStoreMetadata(
      db,
      IMPORT_MARKER_KEY,
      JSON.stringify({ source, importedAt: new Date().toISOString(), rowsByTable }),
    );
    return { imported: true, rowsByTable };
  });
}

function importIntoTemporaryDatabase(
  importingPath: string,
  options: FirstStartImportOptions,
): ImportReport {
  const { storeDirectory, legacyStorePath, importers } = options;
  let db: Database | undefined;
  try {
    const snapshot = readLokiDatabase(legacyStorePath);
    const sessionDocuments = resolveLegacySessionDocuments(storeDirectory, snapshot);
    db = openDatabase(importingPath);
    migrate(db);
    const report = importIntoDatabase({
      db,
      snapshot,
      sessionDocuments,
      importers,
      source: legacyStorePath,
    });
    db.close();
    return report;
  } catch (error: unknown) {
    db?.close();
    removeDatabaseFiles(importingPath);
    const reason = error instanceof Error ? error.message : String(error);
    throw new StoreError(
      `Failed to import the legacy store at ${legacyStorePath} into ${options.databasePath}: ${reason}`,
      IMPORT_FAILED_CODE,
      { cause: error },
    );
  }
}

function backupLegacyStore(legacyStorePath: string): string | undefined {
  const backupPath = `${legacyStorePath}${LEGACY_STORE_BACKUP_SUFFIX}`;
  if (fs.existsSync(backupPath)) {
    log.warn(
      `A pre-1.8 backup already exists at ${backupPath}; leaving ${legacyStorePath} in place rather than overwriting it`,
    );
    return undefined;
  }
  fs.renameSync(legacyStorePath, backupPath);
  return backupPath;
}

/** Import `dd.json` into `dd.sqlite` if, and only if, this is the first start on SQLite. */
export function runFirstStartImport(options: FirstStartImportOptions): FirstStartImportResult {
  const { storeDirectory, legacyStorePath, databasePath } = options;
  if (fs.existsSync(databasePath)) {
    return { status: 'database-exists', databasePath, rowsByTable: {} };
  }
  if (!fs.existsSync(legacyStorePath)) {
    return { status: 'no-legacy-store', databasePath, rowsByTable: {} };
  }

  log.info(`Importing the legacy store at ${legacyStorePath} into ${databasePath}`);
  const importingPath = `${databasePath}${IMPORTING_SUFFIX}`;
  removeDatabaseFiles(importingPath);
  const report = importIntoTemporaryDatabase(importingPath, options);
  fs.renameSync(importingPath, databasePath);
  syncDirectory(storeDirectory);
  const backupPath = backupLegacyStore(legacyStorePath);
  syncDirectory(storeDirectory);
  return { status: 'imported', databasePath, backupPath, rowsByTable: report.rowsByTable };
}
