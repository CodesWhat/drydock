/**
 * UI preferences store.
 * One document per username — the sync key for cross-device preference sync (#220).
 * `preferences` is stored as an opaque, unvalidated blob: the server never
 * inspects the client's PreferencesSchema shape, it only persists whatever the
 * (already-validated-at-the-API-layer) envelope hands it.
 */
import { initCollection } from './util.js';

export interface UiPreferencesRecord {
  username: string;
  schemaVersion: number;
  preferences: Record<string, unknown>;
  updatedAt: string;
}

interface UiPreferencesCollection {
  findOne(query: Record<string, unknown>): UiPreferencesRecord | null;
  insert(document: UiPreferencesRecord): void;
  remove(document: UiPreferencesRecord): void;
}

interface UiPreferencesStoreDb {
  getCollection(name: string): UiPreferencesCollection | null;
  addCollection(name: string, options?: Record<string, unknown>): UiPreferencesCollection;
}

let uiPreferencesCollection: UiPreferencesCollection | undefined;

function cloneRecord(record: UiPreferencesRecord): UiPreferencesRecord {
  return {
    username: record.username,
    schemaVersion: record.schemaVersion,
    preferences: record.preferences,
    updatedAt: record.updatedAt,
  };
}

/**
 * Create ui-preferences collection.
 * @param db
 */
export function createCollections(db: UiPreferencesStoreDb): void {
  uiPreferencesCollection = initCollection(db, 'ui-preferences', {
    indices: ['username'],
  }) as UiPreferencesCollection;
}

/**
 * Get the synced preferences document for a username.
 * Returns null if the collection is not yet initialized or no document exists.
 * @param username
 */
export function getPreferences(username: string): UiPreferencesRecord | null {
  if (!uiPreferencesCollection) {
    return null;
  }
  const found = uiPreferencesCollection.findOne({ username });
  return found ? cloneRecord(found) : null;
}

/**
 * Replace the synced preferences document for a username.
 * Upsert via remove-then-insert (never Loki's `.update()`), matching the rest
 * of the store layer's upsert idiom. `updatedAt` is always server-set.
 * @param username
 * @param schemaVersion
 * @param preferencesBlob
 */
export function replacePreferences(
  username: string,
  schemaVersion: number,
  preferencesBlob: Record<string, unknown>,
): UiPreferencesRecord {
  if (!uiPreferencesCollection) {
    throw new Error('ui-preferences collection not initialized');
  }

  const existing = uiPreferencesCollection.findOne({ username });
  if (existing) {
    uiPreferencesCollection.remove(existing);
  }

  const record: UiPreferencesRecord = {
    username,
    schemaVersion,
    preferences: preferencesBlob,
    updatedAt: new Date().toISOString(),
  };
  uiPreferencesCollection.insert(record);
  return cloneRecord(record);
}
