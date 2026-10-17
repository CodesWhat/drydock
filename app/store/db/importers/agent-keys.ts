/**
 * Importer for `agent-keys` (roadmap 7-STORE slice 4).
 *
 * Flat record, one row per Ed25519 public key authorized for the portwing/1.0
 * WebSocket protocol. Carried across field for field; a document missing the
 * two fields a row cannot exist without (`keyId`, `pubkey`) is skipped rather
 * than guessed at.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'agent-keys';
const TARGET_TABLE = 'agent_keys';

export const agentKeysImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insert = db.prepare(
      'INSERT INTO agent_keys (key_id, pubkey, label, created_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
    );
    let rows = 0;
    for (const doc of snapshot.documents(LEGACY_COLLECTION)) {
      if (typeof doc.keyId !== 'string' || typeof doc.pubkey !== 'string') {
        continue;
      }
      const label = typeof doc.label === 'string' ? doc.label : '';
      const createdAt =
        typeof doc.createdAt === 'string' ? doc.createdAt : new Date().toISOString();
      const revokedAt = typeof doc.revokedAt === 'string' ? doc.revokedAt : null;
      insert.run(doc.keyId, doc.pubkey, label, createdAt, revokedAt);
      rows += 1;
    }
    return rows;
  },
};
