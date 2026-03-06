/**
 * Settings store.
 */
import joi from 'joi';
import { initCollection } from './util.js';

interface Settings {
  internetlessMode: boolean;
}

type SettingsCollectionDocument = Settings;

interface SettingsCollection {
  findOne(query: Record<string, unknown>): SettingsCollectionDocument | null;
  insert(document: SettingsCollectionDocument): void;
  remove(document: SettingsCollectionDocument): void;
}

interface SettingsStoreDb {
  getCollection(name: string): SettingsCollection | null;
  addCollection(name: string): SettingsCollection;
}

let settingsCollection: SettingsCollection | undefined;
let settingsCache: Settings | null = null;

const settingsSchema = joi.object({
  internetlessMode: joi.boolean().default(false),
});

function normalizeSettings(settingsToValidate: unknown = {}): Settings {
  const settingsValidated = settingsSchema.validate(settingsToValidate, {
    stripUnknown: true,
  });
  if (settingsValidated.error) {
    throw settingsValidated.error;
  }
  return settingsValidated.value as Settings;
}

function cloneSettings(settingsToClone: Settings): Settings {
  return {
    ...settingsToClone,
  };
}

function invalidateSettingsCache() {
  settingsCache = null;
}

function replaceSettings(settingsToSave: Settings): void {
  if (!settingsCollection) {
    return;
  }
  const settingsSaved = settingsCollection.findOne({});
  if (settingsSaved) {
    settingsCollection.remove(settingsSaved);
  }
  settingsCollection.insert(settingsToSave);
  invalidateSettingsCache();
}

/**
 * Create settings collection.
 * @param db
 */
export function createCollections(db: SettingsStoreDb): void {
  settingsCollection = initCollection(db, 'settings') as SettingsCollection;
  const settingsSaved = settingsCollection.findOne({});
  const settingsNormalized = normalizeSettings(settingsSaved || {});
  replaceSettings(settingsNormalized);
  settingsCache = settingsNormalized;
}

/**
 * Get current settings.
 * @returns {{internetlessMode: boolean}}
 */
export function getSettings(): Settings {
  if (settingsCache) {
    return cloneSettings(settingsCache);
  }
  const settingsSaved = settingsCollection?.findOne({});
  const settingsNormalized = normalizeSettings(settingsSaved || {});
  settingsCache = settingsNormalized;
  return cloneSettings(settingsNormalized);
}

/**
 * Update current settings.
 * @param settingsToUpdate
 * @returns {{internetlessMode: boolean}}
 */
export function updateSettings(settingsToUpdate: Partial<Settings> = {}): Settings {
  const settingsCurrent = getSettings();
  const settingsUpdated = normalizeSettings({
    ...settingsCurrent,
    ...settingsToUpdate,
  });
  replaceSettings(settingsUpdated);
  return settingsUpdated;
}

/**
 * Check whether internetless mode is enabled.
 */
export function isInternetlessModeEnabled(): boolean {
  return getSettings().internetlessMode === true;
}
