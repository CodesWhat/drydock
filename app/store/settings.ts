/**
 * Settings store.
 *
 * Backed by the `settings` singleton table (roadmap 7-STORE, slice 3). The
 * "existing installations get updateMode: auto" migration this module used to
 * run against every LokiJS document now runs once, at import time, against a
 * NOT NULL column: a legacy document with no `updateMode` field lands with a
 * NULL `update_mode` (see `app/store/db/schema.ts`), and this module's own
 * boot-time normalise-and-rewrite treats that exactly like the missing field
 * it is. A row can only ever be NULL there once, right after import — this
 * function rewrites the column on every boot, so it is never NULL again.
 */
import joi from 'joi';
import type { Database } from './db/driver.js';

export const UPDATE_MODES = ['notify', 'manual', 'auto'] as const;
export type UpdateMode = (typeof UPDATE_MODES)[number];

interface Settings {
  internetlessMode: boolean;
  updateMode: UpdateMode;
}

interface SettingsRow {
  internetlessMode: boolean;
  updateMode: string | undefined;
}

let db: Database | undefined;
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

function readSettingsRow(): SettingsRow | undefined {
  if (!db) {
    return undefined;
  }
  const row = db.prepare('SELECT internetless_mode, update_mode FROM settings WHERE id = 1').get();
  if (!row) {
    return undefined;
  }
  return {
    internetlessMode: Number(row.internetless_mode) === 1,
    updateMode: row.update_mode === null ? undefined : String(row.update_mode),
  };
}

function replaceSettings(settingsToSave: Settings): void {
  if (!db) {
    return;
  }
  db.prepare(
    `INSERT INTO settings (id, internetless_mode, update_mode) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET internetless_mode = excluded.internetless_mode, update_mode = excluded.update_mode`,
  ).run(settingsToSave.internetlessMode ? 1 : 0, settingsToSave.updateMode);
  invalidateSettingsCache();
}

/**
 * Create settings collection.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
  const settingsSaved = readSettingsRow();
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
  const settingsSaved = readSettingsRow();
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
