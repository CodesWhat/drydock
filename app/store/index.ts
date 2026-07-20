import fs from 'node:fs';
import path from 'node:path';
import joi from 'joi';
import Loki from 'lokijs';
import logger from '../log/index.js';
import { resolveConfiguredPath, resolveConfiguredPathWithinBase } from '../runtime/paths.js';
import { migrateInlineSboms } from '../security/sbom-migration.js';
import { createSbomStorage } from '../security/sbom-storage.js';

const log = logger.child({ component: 'store' });

import { getPortwingAuthorizedKeysPath, getStoreConfiguration } from '../configuration/index.js';

import * as agentKeys from './agent-keys.js';
import * as app from './app.js';
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
import * as updateOperation from './update-operation.js';

// Store Configuration Schema
const configurationSchema = joi.object().keys({
  path: joi.string().default('/store'),
  file: joi.string().default('dd.json'),
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
let isMemoryMode = false;
let storePathResolved: string | undefined;
const STORE_DIRECTORY_MODE = 0o700;
const STORE_FILE_MODE = 0o600;

function enforceStorePermissions(storeDirectory: string, storePath: string): void {
  fs.chmodSync(storeDirectory, STORE_DIRECTORY_MODE);
  if (fs.existsSync(storePath)) {
    fs.chmodSync(storePath, STORE_FILE_MODE);
  }
}

function createCollections() {
  agentKeys.createCollections(db);
  app.createCollections(db);
  audit.createCollections(db);
  backup.createCollections(db);
  container.createCollections(db);
  nameBindings.createCollections(db);
  notification.createCollections(db);
  notificationHistory.createCollections(db);
  notificationOutbox.createCollections(db);
  secrets.createCollections(db);
  uiPreferences.createCollections(db);
  settings.createCollections(db);
  updateOperation.createCollections(db);
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
    createCollections();
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
  storePathResolved = storePath;
  if (storePath === storeDirectory) {
    throw new Error('DD_STORE_FILE must reference a file path, not a directory');
  }

  if (!isMemoryMode) {
    // Loki saves through temporary files during both explicit and background autosaves.
    // A restrictive process umask keeps every replacement file owner-readable only.
    process.umask(0o077);
  }

  db = new Loki(storePath, {
    autosave: !isMemoryMode,
    autosaveInterval: 300000,
  });

  if (isMemoryMode) {
    log.info('Init store in memory mode');
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
  enforceStorePermissions(storeDirectory, storePath);
  return new Promise<void>((resolve, reject) => {
    db.loadDatabase({}, (err) => {
      void loadDb(err, resolve, reject).catch(reject);
    });
  });
}

export function isMemoryStore(): boolean {
  return isMemoryMode || !db;
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
          // A persistent db and its resolved path are initialized together in init().
          const persistentStorePath = storePathResolved as string;
          const storeDirectory = path.dirname(persistentStorePath);
          enforceStorePermissions(storeDirectory, persistentStorePath);
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

export interface StoreDebugCollectionStats {
  name: string;
  documents: number;
  serializedBytes: number;
}

export interface StoreDebugSnapshot {
  memoryMode: boolean;
  path?: string;
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
    collectionCount: collectionStats.length,
    documentCount,
    serializedBytes,
    lastPersistAt: getStoreLastPersistAt(),
    collections: collectionStats,
  };
}
