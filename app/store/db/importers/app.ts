/**
 * Importer for `app` (roadmap 7-STORE slice 3).
 *
 * `app/store/app.ts`'s own boot-time logic compares the row this importer
 * writes against the running version and drives `app/store/migrate.ts`, so
 * the imported row has to be the exact version the legacy store last
 * recorded: `app.ts` decides whether this is an upgrade from that value, this
 * importer only has to carry it across.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'app';
const TARGET_TABLE = 'app_info';

export const appImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const [doc] = snapshot.documents(LEGACY_COLLECTION);
    if (!doc || typeof doc.name !== 'string' || typeof doc.version !== 'string') {
      return 0;
    }
    db.prepare('INSERT INTO app_info (id, name, version) VALUES (1, ?, ?)').run(
      doc.name,
      doc.version,
    );
    return 1;
  },
};
