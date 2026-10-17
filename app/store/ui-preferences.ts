/**
 * UI preferences store.
 * One row per username — the sync key for cross-device preference sync (#220).
 * `preferences` is stored as an opaque, unvalidated blob: the server never
 * inspects the client's PreferencesSchema shape, it only persists whatever the
 * (already-validated-at-the-API-layer) envelope hands it.
 *
 * Backed by the `ui_preferences` table (roadmap 7-STORE, slice 3).
 */
import type { Database, Row } from './db/driver.js';

export interface UiPreferencesRecord {
  username: string;
  schemaVersion: number;
  preferences: Record<string, unknown>;
  updatedAt: string;
}

let db: Database | undefined;

function rowToRecord(row: Row): UiPreferencesRecord {
  return {
    username: String(row.username),
    schemaVersion: Number(row.schema_version),
    preferences: JSON.parse(String(row.preferences)),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Create ui-preferences collection.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
}

/**
 * Get the synced preferences document for a username.
 * Returns null if the collection is not yet initialized or no document exists.
 * @param username
 */
export function getPreferences(username: string): UiPreferencesRecord | null {
  if (!db) {
    return null;
  }
  const row = db
    .prepare(
      'SELECT username, schema_version, preferences, updated_at FROM ui_preferences WHERE username = ?',
    )
    .get(username);
  return row ? rowToRecord(row) : null;
}

/**
 * Replace the synced preferences document for a username.
 * Upsert, matching the rest of the store layer's replace-on-write idiom.
 * `updatedAt` is always server-set.
 * @param username
 * @param schemaVersion
 * @param preferencesBlob
 */
export function replacePreferences(
  username: string,
  schemaVersion: number,
  preferencesBlob: Record<string, unknown>,
): UiPreferencesRecord {
  if (!db) {
    throw new Error('ui-preferences store not initialized');
  }

  const updatedAt = new Date().toISOString();
  const preferences = structuredClone(preferencesBlob);
  db.prepare(
    `INSERT INTO ui_preferences (username, schema_version, preferences, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       schema_version = excluded.schema_version,
       preferences = excluded.preferences,
       updated_at = excluded.updated_at`,
  ).run(username, schemaVersion, JSON.stringify(preferences), updatedAt);

  return { username, schemaVersion, preferences: structuredClone(preferences), updatedAt };
}
