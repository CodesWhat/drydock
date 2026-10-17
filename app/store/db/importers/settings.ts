/**
 * Importer for `settings` (roadmap 7-STORE slice 3).
 *
 * Copies the raw legacy document across, field for field, and nothing more.
 * `update_mode` is nullable precisely so this importer can be this simple: a
 * legacy document that never had an `updateMode` field writes a NULL, and
 * `app/store/settings.ts`'s own boot-time normalise-and-rewrite — which runs
 * unconditionally right after this import, in the same `init()` — is what
 * turns that NULL into `'auto'` for an existing installation, the same
 * migration it always ran against a LokiJS document missing the field. This
 * importer does not replicate that decision: it would only be replicating a
 * behavior the real module already has to keep for every future boot anyway.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'settings';
const TARGET_TABLE = 'settings';

export const settingsImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const [doc] = snapshot.documents(LEGACY_COLLECTION);
    if (!doc) {
      return 0;
    }
    const internetlessMode = doc.internetlessMode === true ? 1 : 0;
    const updateMode = typeof doc.updateMode === 'string' ? doc.updateMode : null;
    db.prepare('INSERT INTO settings (id, internetless_mode, update_mode) VALUES (1, ?, ?)').run(
      internetlessMode,
      updateMode,
    );
    return 1;
  },
};
