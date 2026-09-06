/**
 * Worked example of a collection importer: `secrets`.
 *
 * The simplest collection in the store. It is flat (no `{ data: ... }`
 * envelope), it is a singleton by construction — `setStoredSessionSecret`
 * removes the existing document before inserting a new one — and it holds one
 * optional string.
 *
 * The read is deliberately more forgiving than `getStoredSessionSecret`, which
 * takes `findOne({})` and gives up if that first document has no
 * `sessionSecret`. The two only differ on a store the mutual-clobber hazard in
 * spec section 1.4 left with more than one document, and losing the session
 * secret there would log every user out for no reason, so the first usable
 * value wins instead.
 */
import type { CollectionImporter, ImportContext } from '../import.js';
import type { LokiDocument } from '../loki-json.js';

const LEGACY_COLLECTION = 'secrets';
const TARGET_TABLE = 'secrets';

function findSessionSecret(documents: readonly LokiDocument[]): string | undefined {
  for (const document of documents) {
    const value = document.sessionSecret;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export const secretsImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const sessionSecret = findSessionSecret(snapshot.documents(LEGACY_COLLECTION));
    if (sessionSecret === undefined) {
      return 0;
    }
    db.prepare('INSERT INTO secrets (id, session_secret) VALUES (1, ?)').run(sessionSecret);
    return 1;
  },
};
