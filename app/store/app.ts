/**
 * App store.
 *
 * The `app_info` singleton row (roadmap 7-STORE, slice 3) carries the version
 * comparison that drives `app/store/migrate.ts`, so it has to be correct
 * before anything else in the boot sequence reads a version. The collection
 * importer for it lives at `app/store/db/importers/app.ts` and preserves
 * whatever version an imported v1.7 `dd.json` last recorded.
 */
import * as migrate from './migrate.js';

const { migrate: migrateData, repairDataOnStartup } = migrate;

import { getVersion } from '../configuration/index.js';
import type { Database } from './db/driver.js';

interface AppInfos {
  name: string;
  version: string;
}

let db: Database;
let isUpgradeFromPreviousVersion = false;

function readAppInfoRow(): AppInfos | undefined {
  const row = db.prepare('SELECT name, version FROM app_info WHERE id = 1').get();
  return row ? { name: String(row.name), version: String(row.version) } : undefined;
}

function writeAppInfoRow(row: AppInfos): void {
  db.prepare(
    `INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version`,
  ).run(row.name, row.version);
}

function saveAppInfosAndMigrate() {
  const appInfosCurrent = {
    name: 'drydock',
    version: getVersion(),
  };
  const appInfosSaved = readAppInfoRow();
  isUpgradeFromPreviousVersion = appInfosSaved !== undefined;
  const versionFromStore = appInfosSaved?.version;
  const currentVersion = appInfosCurrent.version;
  if (currentVersion !== versionFromStore) {
    migrateData(versionFromStore, currentVersion);
  }
  repairDataOnStartup();
  writeAppInfoRow(appInfosCurrent);
}

export function createCollections(database: Database): void {
  db = database;
}

export function completeStartupInitialization() {
  saveAppInfosAndMigrate();
}

export function getAppInfos(): AppInfos | null {
  const row = readAppInfoRow();
  return row ? { name: row.name, version: row.version } : null;
}

export function isUpgrade(): boolean {
  return isUpgradeFromPreviousVersion;
}
