import fs from 'node:fs';
import path from 'node:path';
import joi from 'joi';
import logger from '../log/index.js';
import { resolveConfiguredPath, resolveConfiguredPathWithinBase } from '../runtime/paths.js';
import { migrateInlineSboms } from '../security/sbom-migration.js';
import { createSbomStorage } from '../security/sbom-storage.js';
import { type Database, MEMORY_DATABASE_LOCATION, openDatabase, type Row } from './db/driver.js';
import { runFirstStartImport } from './db/import.js';
import { COLLECTION_IMPORTERS } from './db/importers/index.js';
import { migrate } from './db/migrations.js';

const log = logger.child({ component: 'store' });

import { getPortwingAuthorizedKeysPath, getStoreConfiguration } from '../configuration/index.js';

import * as agentKeys from './agent-keys.js';
import * as apiKey from './api-key.js';
import * as app from './app.js';
import * as approval from './approval.js';
import * as audit from './audit.js';
import * as backup from './backup.js';
import * as container from './container.js';
import * as mqttHass from './mqtt-hass.js';
import * as nameBindings from './name-bindings.js';
import * as notification from './notification.js';
import * as notificationHistory from './notification-history.js';
import * as notificationOutbox from './notification-outbox.js';
import * as secrets from './secrets.js';
import * as sessionStore from './session.js';
import * as settings from './settings.js';
import * as uiPreferences from './ui-preferences.js';
import * as updateLifecycleCacheStore from './update-lifecycle-cache.js';
import * as updateOperation from './update-operation.js';
import * as updatePolicyRetentionCacheStore from './update-policy-retention-cache.js';

// Store Configuration Schema
const configurationSchema = joi.object().keys({
  path: joi.string().default('/store'),
  file: joi.string().default('dd.json'),
  dbFile: joi.string().default('dd.sqlite'),
});

// Validate Configuration
const configurationToValidate = configurationSchema.validate(getStoreConfiguration() || {});
if (configurationToValidate.error) {
  throw configurationToValidate.error;
}
const configuration = configurationToValidate.value;

// The single SQLite database every collection reads and writes (roadmap
// 7-STORE, slice 11 removed the LokiJS instance that used to sit alongside
// it). `configuration.file` (`dd.json`) is read once, on first start, by the
// importer below, then renamed to `dd.json.pre-1.8.bak` and never touched
// again.
let sqliteDb: Database | undefined;
let isMemoryMode = false;
let storePathResolved: string | undefined;
let dbPathResolved: string | undefined;
let storeDirectoryResolved: string | undefined;
const STORE_DIRECTORY_MODE = 0o700;
const STORE_FILE_MODE = 0o600;
/** WAL adds these two sidecars alongside the database file itself. */
const SQLITE_SIDECAR_SUFFIXES = ['', '-wal', '-shm'] as const;
/** Internal bookkeeping tables, not a collection any caller of getDebugSnapshot() cares about. */
const DEBUG_SNAPSHOT_EXCLUDED_TABLES = new Set(['schema_migrations', 'store_metadata']);

// Permission tightening is hardening, not a functional requirement: some
// volume mounts (NFS/CIFS, non-root containers, certain volume drivers)
// reject chmod outright. Failing to tighten permissions there must warn and
// keep starting up, not crash — this is a regression from v1.6.0's
// unconditional chmodSync on the store directory (#874).
//
// EROFS is deliberately NOT in this set. The codes below mean the metadata
// operation was refused while writes to the volume can still succeed; EROFS
// means the filesystem itself is read-only, so SQLite's WAL sidecar creation
// fails on every subsequent write. Starting up there would leave a process
// that looks healthy and silently persists nothing, so it fails fast at boot
// with the real cause instead.
const RECOVERABLE_CHMOD_ERROR_CODES = new Set(['EPERM', 'EACCES', 'ENOTSUP']);

function enforceStorePermissions(storeDirectory: string, storePath: string): void {
  try {
    fs.chmodSync(storeDirectory, STORE_DIRECTORY_MODE);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !RECOVERABLE_CHMOD_ERROR_CODES.has(code)) {
      throw error;
    }
    log.warn(
      `Could not tighten permissions on store directory (${storeDirectory}): ${code}; continuing without enforced permissions`,
    );
  }
  try {
    fs.chmodSync(storePath, STORE_FILE_MODE);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // dd.json no longer exists once the first-start import has renamed it
      // to dd.json.pre-1.8.bak (or never existed on a fresh install); that is
      // the normal case from here on, not a failure.
      return;
    }
    if (!code || !RECOVERABLE_CHMOD_ERROR_CODES.has(code)) {
      throw error;
    }
    log.warn(
      `Could not tighten permissions on store file (${storePath}): ${code}; continuing without enforced permissions`,
    );
  }
}

/**
 * Apply the same 0600 contract `enforceStorePermissions` applies to `dd.json`
 * to `dd.sqlite` and its `-wal`/`-shm` sidecars. The sidecars come and go
 * with the journal mode — a rollback-journal fallback never creates them,
 * and a WAL checkpoint truncates but does not delete `-wal` — so a missing
 * one is tolerated exactly like a not-yet-written `dd.json`.
 */
function enforceSqliteFilePermissions(databasePath: string): void {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const target = `${databasePath}${suffix}`;
    try {
      fs.chmodSync(target, STORE_FILE_MODE);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        continue;
      }
      if (!code || !RECOVERABLE_CHMOD_ERROR_CODES.has(code)) {
        throw error;
      }
      log.warn(
        `Could not tighten permissions on store database file (${target}): ${code}; continuing without enforced permissions`,
      );
    }
  }
}

/**
 * Flush the SQLite WAL into `dd.sqlite` itself. Under `synchronous = NORMAL`
 * a committed transaction lives in the WAL without being guaranteed fsynced,
 * so this runs everywhere `save()` runs, which is every call site that used
 * to await LokiJS's `saveDatabase` before v1.8.
 */
function checkpointSqliteDatabase(): void {
  sqliteDb?.pragma('wal_checkpoint', 'TRUNCATE');
}

function createCollections(): void {
  agentKeys.createCollections(sqliteDb as Database);
  apiKey.createCollections(sqliteDb as Database);
  app.createCollections(sqliteDb as Database);
  approval.createCollections(sqliteDb as Database);
  audit.createCollections(sqliteDb as Database);
  backup.createCollections(sqliteDb as Database);
  container.createCollections(sqliteDb as Database);
  // #556: the update-lifecycle-cache collection must exist before rehydration
  // repopulates container.ts's in-memory Map from it.
  updateLifecycleCacheStore.createCollections(sqliteDb as Database);
  container.rehydrateUpdateLifecycleCacheFromStore();
  // #565: same rationale as #556 above, for the update-policy retention cache —
  // the collection must exist before rehydration repopulates container.ts's
  // in-memory Map from it.
  updatePolicyRetentionCacheStore.createCollections(sqliteDb as Database);
  container.rehydrateUpdatePolicyRetentionCacheFromStore();
  nameBindings.createCollections(sqliteDb as Database);
  notification.createCollections(sqliteDb as Database);
  notificationHistory.createCollections(sqliteDb as Database);
  notificationOutbox.createCollections(sqliteDb as Database);
  secrets.createCollections(sqliteDb as Database);
  sessionStore.createCollections(sqliteDb as Database);
  uiPreferences.createCollections(sqliteDb as Database);
  settings.createCollections(sqliteDb as Database);
  updateOperation.createCollections(sqliteDb as Database);
  // roadmap 7-STORE slice 10 — MQTT identity cut one-shot marker.
  mqttHass.createCollections(sqliteDb as Database);
  app.completeStartupInitialization();
}

async function migrateSbomsOffHeap(): Promise<void> {
  const storeDirectory = resolveConfiguredPath(configuration.path, {
    label: 'DD_STORE_PATH',
  });
  const report = await migrateInlineSboms({
    containers: container.getContainersRaw(),
    storage: createSbomStorage({ rootDir: storeDirectory }),
    persist: (updatedContainer) => {
      container.updateContainer(updatedContainer);
    },
  });
  if (report.migratedRecords > 0) {
    await save();
    log.info(
      `Migrated ${report.migratedDocuments} inline SBOM document(s) across ${report.migratedRecords} record(s)`,
    );
  }
  if (report.failures > 0) {
    log.warn(
      `Failed to migrate ${report.failures} SBOM record(s); inline data was preserved for retry`,
    );
  }
}

/**
 * Load authorized keys from DD_PORTWING_AUTHORIZED_KEYS if set.
 * Errors are logged and swallowed so a bad keys file does not abort startup.
 */
function loadAuthorizedKeysIfConfigured() {
  const keysPath = getPortwingAuthorizedKeysPath();
  if (!keysPath) {
    return;
  }
  try {
    agentKeys.loadAuthorizedKeysFile(keysPath);
  } catch (error: unknown) {
    log.warn(
      { path: keysPath, error: String(error) },
      'Failed to load DD_PORTWING_AUTHORIZED_KEYS — edge connections will require manual key registration',
    );
  }
}

/**
 * Init DB.
 * @param options
 * @returns {Promise<unknown>}
 */
export async function init(options: { memory?: boolean } = {}) {
  isMemoryMode = options.memory || false;
  const storeDirectory = resolveConfiguredPath(configuration.path, {
    label: 'DD_STORE_PATH',
  });
  const storePath = resolveConfiguredPathWithinBase(storeDirectory, configuration.file, {
    label: 'DD_STORE_FILE',
  });
  const dbPath = resolveConfiguredPathWithinBase(storeDirectory, configuration.dbFile, {
    label: 'DD_STORE_DB_FILE',
  });
  storePathResolved = storePath;
  dbPathResolved = dbPath;
  storeDirectoryResolved = storeDirectory;
  if (storePath === storeDirectory) {
    throw new Error('DD_STORE_FILE must reference a file path, not a directory');
  }

  if (!isMemoryMode) {
    // SQLite creates its `-wal` and `-shm` sidecars under the process umask.
    // A restrictive umask keeps every one of them owner-readable only.
    process.umask(0o077);
  }

  if (isMemoryMode) {
    log.info('Init store in memory mode');
    sqliteDb = openDatabase(MEMORY_DATABASE_LOCATION);
    migrate(sqliteDb);
    createCollections();
    loadAuthorizedKeysIfConfigured();
    return;
  }

  // Migrate from wud.json if dd.json doesn't exist yet
  const legacyPath = path.resolve(storeDirectory, 'wud.json');
  if (!fs.existsSync(storePath) && fs.existsSync(legacyPath)) {
    log.info(`Migrating store from ${legacyPath} to ${storePath}`);
    fs.renameSync(legacyPath, storePath);
  }

  log.info(`Load store from (${storePath})`);
  if (!fs.existsSync(storeDirectory)) {
    log.info(`Create folder ${storeDirectory}`);
    fs.mkdirSync(storeDirectory, { mode: STORE_DIRECTORY_MODE });
  }

  // First-start import (roadmap 7-STORE, slice 3): a database that already
  // exists is opened as-is and never re-imported, a fresh install with no
  // legacy dd.json creates an empty one, and an existing dd.json is imported
  // into the database before it is ever opened for real. dd.json is not read
  // or written again after this call returns.
  runFirstStartImport({
    storeDirectory,
    legacyStorePath: storePath,
    databasePath: dbPath,
    importers: COLLECTION_IMPORTERS,
  });
  sqliteDb = openDatabase(dbPath);
  migrate(sqliteDb);
  enforceStorePermissions(storeDirectory, storePath);
  enforceSqliteFilePermissions(dbPath);
  createCollections();
  await migrateSbomsOffHeap();
  loadAuthorizedKeysIfConfigured();
}

export function isMemoryStore(): boolean {
  return isMemoryMode || !sqliteDb;
}

/**
 * Explicitly flush the SQLite WAL to disk.
 * No-op in memory mode.
 * @returns {Promise<void>}
 */
export async function save() {
  if (!sqliteDb || isMemoryMode) {
    return;
  }
  checkpointSqliteDatabase();
  // A persistent db and its resolved path/directory are initialized together in init().
  const persistentStorePath = storePathResolved as string;
  const persistentStoreDirectory = storeDirectoryResolved as string;
  const persistentDbPath = dbPathResolved as string;
  enforceSqliteFilePermissions(persistentDbPath);
  enforceStorePermissions(persistentStoreDirectory, persistentStorePath);
}

/**
 * Get configuration.
 * @returns {*}
 */
export function getConfiguration() {
  return configuration;
}

export interface StoreDebugCollectionStats {
  name: string;
  documents: number;
}

export interface StoreDebugSnapshot {
  memoryMode: boolean;
  path?: string;
  /** The SQLite database every collection reads and writes (roadmap 7-STORE, slice 11 removed the LokiJS instance it used to sit alongside). */
  sqlitePath?: string;
  collectionCount: number;
  documentCount: number;
  serializedBytes: number;
  lastPersistAt?: string;
  collections: StoreDebugCollectionStats[];
}

function listDebugSnapshotTableNames(database: Database): string[] {
  const rows = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return rows
    .map((row) => String(row.name))
    .filter((name) => !DEBUG_SNAPSHOT_EXCLUDED_TABLES.has(name));
}

function getTableRowCount(database: Database, tableName: string): number {
  // tableName always comes from sqlite_schema itself (listDebugSnapshotTableNames),
  // never from caller input, so interpolating it into the query is safe.
  const row = database.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get() as Row;
  return Number(row.count);
}

function getDatabaseFileSize(database: Database): number {
  const pageCount = Number(database.pragma('page_count') ?? 0);
  const pageSize = Number(database.pragma('page_size') ?? 0);
  return pageCount * pageSize;
}

function getStoreLastPersistAt(): string | undefined {
  if (isMemoryMode || !dbPathResolved || !fs.existsSync(dbPathResolved)) {
    return undefined;
  }

  try {
    return fs.statSync(dbPathResolved).mtime.toISOString();
  } catch {
    return undefined;
  }
}

export function getDebugSnapshot(): StoreDebugSnapshot {
  if (!sqliteDb) {
    return {
      memoryMode: isMemoryMode,
      path: storePathResolved,
      sqlitePath: dbPathResolved,
      collectionCount: 0,
      documentCount: 0,
      serializedBytes: 0,
      lastPersistAt: getStoreLastPersistAt(),
      collections: [],
    };
  }

  const collections = listDebugSnapshotTableNames(sqliteDb).map((name) => ({
    name,
    documents: getTableRowCount(sqliteDb as Database, name),
  }));
  const documentCount = collections.reduce((total, stats) => total + stats.documents, 0);

  return {
    memoryMode: isMemoryMode,
    path: storePathResolved,
    sqlitePath: dbPathResolved,
    collectionCount: collections.length,
    documentCount,
    serializedBytes: getDatabaseFileSize(sqliteDb),
    lastPersistAt: getStoreLastPersistAt(),
    collections,
  };
}
