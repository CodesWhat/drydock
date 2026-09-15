/**
 * Importer for `api-keys` (roadmap 7-STORE slice 4).
 *
 * The one legacy collection that is not carried across flat: `scopes:
 * string[]` (`app/store/api-key.ts:65` in the pre-migration module) becomes
 * rows in the `api_key_scope(key_id, scope)` join table, inserted in the
 * array's original order so a projected record's `scopes` — read back
 * ordered by insertion `rowid` — comes out the same as it went in. A document
 * missing either half of the credential (`keyId`, `secretHash`) is skipped
 * rather than guessed at.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'api-keys';
const TARGET_TABLE = 'api_keys';

export const apiKeysImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insertKey = db.prepare(
      `INSERT INTO api_keys
         (key_id, schema_version, name, secret_hash, created_at, created_by, parent_key_id, expires_at, rate_limit_max, last_used_at, revoked_at, revoked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertScope = db.prepare('INSERT INTO api_key_scope (key_id, scope) VALUES (?, ?)');
    let rows = 0;
    for (const doc of snapshot.documents(LEGACY_COLLECTION)) {
      if (typeof doc.keyId !== 'string' || typeof doc.secretHash !== 'string') {
        continue;
      }
      const schemaVersion = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1;
      const name = typeof doc.name === 'string' ? doc.name : doc.keyId;
      const createdAt =
        typeof doc.createdAt === 'string' ? doc.createdAt : new Date().toISOString();
      const createdBy = typeof doc.createdBy === 'string' ? doc.createdBy : 'user:unknown';
      const parentKeyId = typeof doc.parentKeyId === 'string' ? doc.parentKeyId : null;
      const expiresAt = typeof doc.expiresAt === 'string' ? doc.expiresAt : null;
      const rateLimitMax = typeof doc.rateLimitMax === 'number' ? doc.rateLimitMax : null;
      const lastUsedAt = typeof doc.lastUsedAt === 'string' ? doc.lastUsedAt : null;
      const revokedAt = typeof doc.revokedAt === 'string' ? doc.revokedAt : null;
      const revokedBy = typeof doc.revokedBy === 'string' ? doc.revokedBy : null;

      insertKey.run(
        doc.keyId,
        schemaVersion,
        name,
        doc.secretHash,
        createdAt,
        createdBy,
        parentKeyId,
        expiresAt,
        rateLimitMax,
        lastUsedAt,
        revokedAt,
        revokedBy,
      );

      const scopes = Array.isArray(doc.scopes)
        ? doc.scopes.filter((scope): scope is string => typeof scope === 'string')
        : [];
      for (const scope of scopes) {
        insertScope.run(doc.keyId, scope);
      }
      rows += 1;
    }
    return rows;
  },
};
