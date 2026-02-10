// @ts-nocheck
/**
 * App store.
 */
import * as migrate from './migrate.js';
const { migrate: migrateData } = migrate;
import { getVersion } from '../configuration/index.js';
import { initCollection } from './util.js';

let app;

function saveAppInfosAndMigrate() {
    const appInfosCurrent = {
        name: 'drydock',
        version: getVersion(),
    };
    const appInfosSaved = app.findOne({});
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

export function createCollections(db) {
    app = initCollection(db, 'app');
    saveAppInfosAndMigrate();
}

export function getAppInfos() {
    return app.findOne({});
}
