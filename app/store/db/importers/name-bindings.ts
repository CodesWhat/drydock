/**
 * Importer for `name-bindings` (roadmap 7-STORE slice 4).
 *
 * Flat record, one row per persisted agent-name -> pubKeyId binding (the
 * durable backing for portwing-ws.ts's squat/theft-prevention cache). Carried
 * across field for field; a document missing either half of the binding is
 * skipped rather than guessed at.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'name-bindings';
const TARGET_TABLE = 'name_bindings';

export const nameBindingsImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insert = db.prepare(
      'INSERT INTO name_bindings (agent_name, key_id, last_seen_at) VALUES (?, ?, ?)',
    );
    let rows = 0;
    for (const doc of snapshot.documents(LEGACY_COLLECTION)) {
      if (typeof doc.agentName !== 'string' || typeof doc.keyId !== 'string') {
        continue;
      }
      const lastSeenAt = typeof doc.lastSeenAt === 'number' ? doc.lastSeenAt : 0;
      insert.run(doc.agentName, doc.keyId, lastSeenAt);
      rows += 1;
    }
    return rows;
  },
};
