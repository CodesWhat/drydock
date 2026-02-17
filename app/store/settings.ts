/**
 * Settings store.
 */
import joi from 'joi';
import { initCollection } from './util.js';

let settings;

const settingsSchema = joi.object({
  internetlessMode: joi.boolean().default(false),
});

function normalizeSettings(settingsToValidate: Record<string, any> = {}) {
  const settingsValidated = settingsSchema.validate(settingsToValidate, {
    stripUnknown: true,
  });
  if (settingsValidated.error) {
    throw settingsValidated.error;
  }
  return settingsValidated.value;
}

function replaceSettings(settingsToSave: Record<string, any>) {
  const settingsSaved = settings.findOne({});
  if (settingsSaved) {
    settings.remove(settingsSaved);
  }
  settings.insert(settingsToSave);
}

/**
 * Create settings collection.
 * @param db
 */
export function createCollections(db) {
  settings = initCollection(db, 'settings');
  const settingsSaved = settings.findOne({});
  const settingsNormalized = normalizeSettings(settingsSaved || {});
  replaceSettings(settingsNormalized);
}

/**
 * Get current settings.
 * @returns {{internetlessMode: boolean}}
 */
export function getSettings() {
  const settingsSaved = settings.findOne({});
  return normalizeSettings(settingsSaved || {});
}

/**
 * Update current settings.
 * @param settingsToUpdate
 * @returns {{internetlessMode: boolean}}
 */
export function updateSettings(settingsToUpdate = {}) {
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
export function isInternetlessModeEnabled() {
  return getSettings().internetlessMode === true;
}
