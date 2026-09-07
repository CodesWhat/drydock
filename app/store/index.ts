import fs from 'node:fs';
import path from 'node:path';
import joi from 'joi';
import Loki from 'lokijs';
import logger from '../log/index.js';
import { resolveConfiguredPath, resolveConfiguredPathWithinBase } from '../runtime/paths.js';
import { migrateInlineSboms } from '../security/sbom-migration.js';
import { createSbomStorage } from '../security/sbom-storage.js';
import { type Database, MEMORY_DATABASE_LOCATION, openDatabase } from './db/driver.js';
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
import * as nameBindings from './name-bindings.js';
import * as notification from './notification.js';
import * as notificationHistory from './notification-history.js';
import * as notificationOutbox from './notification-outbox.js';
import * as secrets from './secrets.js';
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

// Loki DB
type LokiDatabase = InstanceType<typeof Loki>;
let db: LokiDatabase | undefined;
// The SQLite database opened alongside Loki (roadmap 7-STORE, slice 2).
// `app`, `secrets`, `settings` and `ui-preferences` read and write it
// directly as of slice 3, joined by `agent-keys`, `name-bindings` and
// `api-key` in slice 4, `audit`, `backups`, `notification-history` and the
// notification outbox in slice 5, `approval` and `notification` in slice 6,
// the update-lifecycle and update-policy-retention caches in slice 7, and
// `container` in slice 8; every other collection still lives in Loki.
let sqliteDb: Database | undefined;
let isMemoryMode = false;
let storePathResolved: string | undefined;
let dbPathResolved: string | undefined;
let storeDirectoryResolved: string | undefined;
const STORE_DIRECTORY_MODE = 0o700;
const STORE_FILE_MODE = 0o600;
/** WAL adds these two sidecars alongside the database file itself. */
const SQLITE_SIDECAR_SUFFIXES = ['', '-wal', '-shm'] as const;

// Permission tightening is hardening, not a functional requirement: some
// volume mounts (NFS/CIFS, non-root containers, certain volume drivers)
// reject chmod outright. Failing to tighten permissions there must warn and
// keep starting up, not crash — this is a regression from v1.6.0's
// unconditional chmodSync on the store directory (#874).
//
// EROFS is deliberately NOT in this set. The codes below mean the metadata
// operation was refused while writes to the volume can still succeed; EROFS
// means the filesystem itself is read-only, so Loki's autosave (temp file
// plus rename) fails on every subsequent write. Starting up there would
// leave a process that looks healthy and silently persists nothing, so it
// fails fast at boot with the real cause instead.
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
 * so this runs everywhere Loki's `saveDatabase` already runs, preserving the
 * same durability contract Loki's autosave gave `dd.json`.
 */
function checkpointSqliteDatabase(): void {
  sqliteDb?.pragma('wal_checkpoint', 'TRUNCATE');
}

// DR-121: express-session's connect-loki store used to share this database's
// file and wrote a `Sessions` collection straight into it. Now that the
// session store owns its own file (see getSessionStorePath()), a `Sessions`
// collection surfacing here can only be a leftover from that shared-file era.
// Drop it so the main store stops re-serializing a stale copy on every save.
const LEGACY_SESSIONS_COLLECTION_NAME = 'Sessions';

function dropLegacySessionsCollection(): boolean {
  // Guarded with typeof checks, not just db truthiness: several store unit
  // tests substitute a bare { loadDatabase, saveDatabase } stand-in for the
  // real Loki instance, and a real Loki database always exposes both methods.
  if (
    !db ||
    typeof db.getCollection !== 'function' ||
    typeof db.removeCollection !== 'function' ||
    !db.getCollection(LEGACY_SESSIONS_COLLECTION_NAME)
  ) {
    return false;
  }
  db.removeCollection(LEGACY_SESSIONS_COLLECTION_NAME);
  log.info(
    'Dropped legacy Sessions collection from the main store; sessions now persist in their own file',
  );
  return true;
}

function createCollections(): boolean {
  const droppedLegacySessionsCollection = dropLegacySessionsCollection();
  // app, secrets, settings, ui-preferences (slice 3), and agent-keys,
  // name-bindings, api-keys (roadmap 7-STORE, slice 4) read and write
  // sqliteDb directly rather than a LokiJS collection.
  agentKeys.createCollections(sqliteDb as Database);
  apiKey.createCollections(sqliteDb as Database);
  app.createCollections(sqliteDb as Database);
  // roadmap 7-STORE slice 6.
  approval.createCollections(sqliteDb as Database);
  // audit, backups, notification-history and the notification outbox
  // (roadmap 7-STORE, slice 5) read and write sqliteDb directly.
  audit.createCollections(sqliteDb as Database);
  backup.createCollections(sqliteDb as Database);
  // roadmap 7-STORE slice 8.
  container.createCollections(sqliteDb as Database);
  // #556: the update-lifecycle-cache collection must exist before rehydration
  // repopulates container.ts's in-memory Map from it. roadmap 7-STORE slice 7
  // moved it onto sqliteDb.
  updateLifecycleCacheStore.createCollections(sqliteDb as Database);
  container.rehydrateUpdateLifecycleCacheFromStore();
  // #565: same rationale as #556 above, for the update-policy retention cache —
  // the collection must exist before rehydration repopulates container.ts's
  // in-memory Map from it. roadmap 7-STORE slice 7 moved it onto sqliteDb.
  updatePolicyRetentionCacheStore.createCollections(sqliteDb as Database);
  container.rehydrateUpdatePolicyRetentionCacheFromStore();
  nameBindings.createCollections(sqliteDb as Database);
  // roadmap 7-STORE slice 6.
  notification.createCollections(sqliteDb as Database);
  notificationHistory.createCollections(sqliteDb as Database);
  notificationOutbox.createCollections(sqliteDb as Database);
  secrets.createCollections(sqliteDb as Database);
  uiPreferences.createCollections(sqliteDb as Database);
  settings.createCollections(sqliteDb as Database);
  updateOperation.createCollections(db);
  app.completeStartupInitialization();
  return droppedLegacySessionsCollection;
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
 * Load DB.
 * @param err
 * @param resolve
 * @param reject
 * @returns {Promise<void>}
 */
async function loadDb(
  err: unknown,
  resolve: () => void,
  reject: (reason?: unknown) => void,
): Promise<void> {
  if (err) {
    reject(err);
  } else {
    // Create collections
    const droppedLegacySessionsCollection = createCollections();
    if (droppedLegacySessionsCollection) {
      // loadDatabase() resolving is not itself a write: LokiJS only
      // autosaves on a later dirty write, so a store that never writes
      // again would keep the stale Sessions collection in dd.json forever.
      // Flush once here so the drop is durable across a restart.
      await save();
    }
    await migrateSbomsOffHeap();
    loadAuthorizedKeysIfConfigured();
    resolve();
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
    // Loki saves through temporary files during both explicit and background autosaves.
    // A restrictive process umask keeps every replacement file owner-readable only.
    // SQLite creates its `-wal` and `-shm` sidecars under the same umask.
    process.umask(0o077);
  }

  db = new Loki(storePath, {
    autosave: !isMemoryMode,
    autosaveInterval: 300000,
  });

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
  // into the database before it is ever opened for real. Either way the
  // database is then opened and migrated exactly as before.
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
  return new Promise<void>((resolve, reject) => {
    db.loadDatabase({}, (err) => {
      void loadDb(err, resolve, reject).catch(reject);
    });
  });
}

export function isMemoryStore(): boolean {
  return isMemoryMode || !db || !sqliteDb;
}

/**
 * Explicitly flush DB to disk.
 * No-op in memory mode.
 * @returns {Promise<void>}
 */
export async function save() {
  if (!db || isMemoryMode) {
    return;
  }
  return new Promise<void>((resolve, reject) => {
    db.saveDatabase((err) => {
      if (err) {
        reject(err);
      } else {
        try {
          checkpointSqliteDatabase();
          // A persistent db and its resolved path/directory are initialized together in init().
          const persistentStorePath = storePathResolved as string;
          const persistentStoreDirectory = storeDirectoryResolved as string;
          const persistentDbPath = dbPathResolved as string;
          enforceSqliteFilePermissions(persistentDbPath);
          enforceStorePermissions(persistentStoreDirectory, persistentStorePath);
          resolve();
        } catch (permissionError) {
          reject(permissionError);
        }
      }
    });
  });
}

/**
 * Get configuration.
 * @returns {*}
 */
export function getConfiguration() {
  return configuration;
}

/**
 * Path to the express-session store's own file: a sibling of the main store
 * file, never the main store file itself.
 *
 * DR-121: connect-loki used to open a second LokiJS instance directly on
 * `${configuration.path}/${configuration.file}`. LokiJS's saveDatabase()
 * serializes the whole in-memory database, so whichever of the two instances
 * saved last clobbered the other's writes. Deriving the session file name
 * from configuration.file (rather than hardcoding `sessions.json`) keeps a
 * custom DD_STORE_FILE pointed at a distinct sibling instead of colliding
 * with another instance's store on the same volume.
 * @returns {string}
 */
export function getSessionStorePath(): string {
  const extension = path.extname(configuration.file);
  const baseName = extension ? configuration.file.slice(0, -extension.length) : configuration.file;
  return path.join(configuration.path, `${baseName}-sessions.json`);
}

export interface StoreDebugCollectionStats {
  name: string;
  documents: number;
  serializedBytes: number;
}

export interface StoreDebugSnapshot {
  memoryMode: boolean;
  path?: string;
  /** The SQLite database opened alongside `path` (roadmap 7-STORE, slice 2), holding `app`/`secrets`/`settings`/`ui-preferences` as of slice 3 and `agent-keys`/`name-bindings`/`api-key` as of slice 4. */
  sqlitePath?: string;
  collectionCount: number;
  documentCount: number;
  serializedBytes: number;
  lastPersistAt?: string;
  collections: StoreDebugCollectionStats[];
}

function getCollectionDocumentCount(collection: unknown): number {
  if (!collection || typeof collection !== 'object') {
    return 0;
  }

  if (typeof (collection as { count?: unknown }).count === 'function') {
    return Math.max(0, Number((collection as { count: () => number }).count()) || 0);
  }

  const data = (collection as { data?: unknown }).data;
  return Array.isArray(data) ? data.length : 0;
}

function getSerializedByteSize(value: unknown): number {
  try {
    const serializedValue = JSON.stringify(value);
    return serializedValue === undefined ? 0 : Buffer.byteLength(serializedValue, 'utf8');
  } catch {
    return 0;
  }
}

function getStoreLastPersistAt(): string | undefined {
  if (isMemoryMode || !storePathResolved || !fs.existsSync(storePathResolved)) {
    return undefined;
  }

  try {
    return fs.statSync(storePathResolved).mtime.toISOString();
  } catch {
    return undefined;
  }
}

export function getDebugSnapshot(): StoreDebugSnapshot {
  const collections = Array.isArray((db as { collections?: unknown[] } | undefined)?.collections)
    ? ((db as { collections: unknown[] }).collections as unknown[])
    : [];
  const collectionStats = collections.map((collection) => ({
    name:
      typeof (collection as { name?: unknown }).name === 'string'
        ? ((collection as { name: string }).name as string)
        : 'unknown',
    documents: getCollectionDocumentCount(collection),
    serializedBytes: getSerializedByteSize(collection),
  }));
  const documentCount = collectionStats.reduce((total, stats) => total + stats.documents, 0);
  const serializedBytes = collectionStats.reduce(
    (total, stats) => total + stats.serializedBytes,
    0,
  );

  return {
    memoryMode: isMemoryMode,
    path: storePathResolved,
    sqlitePath: dbPathResolved,
    collectionCount: collectionStats.length,
    documentCount,
    serializedBytes,
    lastPersistAt: getStoreLastPersistAt(),
    collections: collectionStats,
  };
}
