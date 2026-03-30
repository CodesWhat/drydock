import fs from 'node:fs';
import path from 'node:path';
import joi from 'joi';
import Loki from 'lokijs';
import logger from '../log/index.js';
import { resolveConfiguredPath, resolveConfiguredPathWithinBase } from '../runtime/paths.js';

const log = logger.child({ component: 'store' });

import { getStoreConfiguration } from '../configuration/index.js';

import * as app from './app.js';
import * as audit from './audit.js';
import * as backup from './backup.js';
import * as container from './container.js';
import * as notification from './notification.js';
import * as settings from './settings.js';
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

function createCollections() {
  app.createCollections(db);
  audit.createCollections(db);
  backup.createCollections(db);
  container.createCollections(db);
  notification.createCollections(db);
  settings.createCollections(db);
  updateOperation.createCollections(db);
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

  db = new Loki(storePath, {
    autosave: !isMemoryMode,
    autosaveInterval: 60000,
  });

  if (isMemoryMode) {
    log.info('Init store in memory mode');
    createCollections();
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
    fs.mkdirSync(storeDirectory);
  }
  return new Promise<void>((resolve, reject) => {
    db.loadDatabase({}, (err) => loadDb(err, resolve, reject));
  });
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
        resolve();
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
}

export interface StoreDebugSnapshot {
  memoryMode: boolean;
  path?: string;
  collectionCount: number;
  documentCount: number;
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
  }));
  const documentCount = collectionStats.reduce((total, stats) => total + stats.documents, 0);

  return {
    memoryMode: isMemoryMode,
    path: storePathResolved,
    collectionCount: collectionStats.length,
    documentCount,
    lastPersistAt: getStoreLastPersistAt(),
    collections: collectionStats,
  };
}
