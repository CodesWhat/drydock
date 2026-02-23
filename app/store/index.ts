// @ts-nocheck

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
let db;
let isMemoryStore = false;

function createCollections() {
  app.createCollections(db);
  audit.createCollections(db);
  backup.createCollections(db);
  container.createCollections(db);
  notification.createCollections(db);
  settings.createCollections(db);
}

/**
 * Load DB.
 * @param err
 * @param resolve
 * @param reject
 * @returns {Promise<void>}
 */
async function loadDb(err, resolve, reject) {
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
export async function init(options = {}) {
  const isMemory = options.memory || false;
  isMemoryStore = isMemory;
  const storeDirectory = resolveConfiguredPath(configuration.path, {
    label: 'DD_STORE_PATH',
  });
  const storePath = resolveConfiguredPathWithinBase(storeDirectory, configuration.file, {
    label: 'DD_STORE_FILE',
  });
  if (storePath === storeDirectory) {
    throw new Error('DD_STORE_FILE must reference a file path, not a directory');
  }

  db = new Loki(storePath, {
    autosave: !isMemory,
  });

  if (isMemory) {
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
  return new Promise((resolve, reject) => {
    db.loadDatabase({}, (err) => loadDb(err, resolve, reject));
  });
}

/**
 * Persist current DB state to disk.
 * In memory mode this is a no-op.
 */
export async function save() {
  if (isMemoryStore || !db) {
    return;
  }
  return new Promise((resolve, reject) => {
    db.saveDatabase((err) => {
      if (err) {
        reject(err);
      } else {
        resolve(undefined);
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
