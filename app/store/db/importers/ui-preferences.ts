/**
 * Importer for `ui-preferences` (roadmap 7-STORE slice 3).
 *
 * The only one of the four leaf singletons that is not actually a singleton:
 * one row per username (#220). Every legacy document with a usable username
 * is carried across; `preferences` is opaque per `app/store/ui-preferences.ts`
 * and is stored as-is, JSON-encoded.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'ui-preferences';
const TARGET_TABLE = 'ui_preferences';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const uiPreferencesImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insert = db.prepare(
      'INSERT INTO ui_preferences (username, schema_version, preferences, updated_at) VALUES (?, ?, ?, ?)',
    );
    let rows = 0;
    for (const doc of snapshot.documents(LEGACY_COLLECTION)) {
      if (typeof doc.username !== 'string' || doc.username.length === 0) {
        continue;
      }
      const schemaVersion = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1;
      const preferences = isPlainObject(doc.preferences) ? doc.preferences : {};
      const updatedAt =
        typeof doc.updatedAt === 'string' ? doc.updatedAt : new Date().toISOString();
      insert.run(doc.username, schemaVersion, JSON.stringify(preferences), updatedAt);
      rows += 1;
    }
    return rows;
  },
};
