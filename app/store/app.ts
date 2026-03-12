/**
 * App store.
 */
import * as migrate from './migrate.js';

const { migrate: migrateData } = migrate;

import { getVersion } from '../configuration/index.js';
import { initCollection } from './util.js';

interface AppInfos {
  name: string;
  version: string;
}

interface AppCollection {
  findOne(query: Record<string, unknown>): AppInfos | null;
  insert(document: AppInfos): void;
  remove(document: AppInfos): void;
}

interface AppStoreDb {
  getCollection(name: string): AppCollection | null;
  addCollection(name: string): AppCollection;
}

let app: AppCollection;
let isUpgradeFromPreviousVersion = false;

function saveAppInfosAndMigrate() {
  const appInfosCurrent = {
    name: 'drydock',
    version: getVersion(),
  };
  const appInfosSaved = app.findOne({});
  isUpgradeFromPreviousVersion = appInfosSaved !== null;
  const versionFromStore = appInfosSaved ? appInfosSaved.version : undefined;
  const currentVersion = appInfosCurrent.version;
  if (currentVersion !== versionFromStore) {
    migrateData(versionFromStore, currentVersion);
  }
  if (appInfosSaved) {
    app.remove(appInfosSaved);
  }
  app.insert(appInfosCurrent);
}

export function createCollections(db: AppStoreDb) {
  app = initCollection(db, 'app') as AppCollection;
  saveAppInfosAndMigrate();
}

export function getAppInfos(): AppInfos | null {
  const doc = app.findOne({});
  if (!doc) return null;
  return { name: doc.name, version: doc.version };
}

export function isUpgrade(): boolean {
  return isUpgradeFromPreviousVersion;
}
