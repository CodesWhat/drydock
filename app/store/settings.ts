/**
 * Settings store.
 */
import joi from 'joi';
import { initCollection } from './util.js';

export const UPDATE_MODES = ['notify', 'manual', 'auto'] as const;
export type UpdateMode = (typeof UPDATE_MODES)[number];

interface Settings {
  internetlessMode: boolean;
  updateMode: UpdateMode;
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
  updateMode: joi
    .string()
    .valid(...UPDATE_MODES)
    .default('manual'),
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
    internetlessMode: settingsToClone.internetlessMode,
    updateMode: settingsToClone.updateMode,
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
  // Existing installations predate the global update-mode setting and may
  // already rely on automatic action triggers. Preserve that behavior during
  // migration, while brand-new installations use the safer manual default.
  const settingsToNormalize =
    settingsSaved && settingsSaved.updateMode === undefined
      ? { ...settingsSaved, updateMode: 'auto' }
      : settingsSaved || {};
  const settingsNormalized = normalizeSettings(settingsToNormalize);
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
  return cloneSettings(settingsUpdated);
}

/**
 * Check whether internetless mode is enabled.
 */
export function isInternetlessModeEnabled(): boolean {
  return getSettings().internetlessMode === true;
}

/**
 * Get the controller-wide update dispatch mode.
 */
export function getUpdateMode(): UpdateMode {
  return getSettings().updateMode;
}
