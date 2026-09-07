/**
 * Importer for `update_policy_retention_cache` (roadmap 7-STORE slice 7).
 *
 * Flat collection: each stored document is an `UpdatePolicyRetentionCacheRecord`
 * with no envelope (`app/store/update-policy-retention-cache.ts` inserts
 * records directly). Unlike the lifecycle cache, this collection already keyed
 * on the durable identity key before the SQLite migration — see the comment at
 * `updatePolicyRetentionCache`'s declaration in `app/store/container.ts` — so
 * no remapping is needed: a stored document's `cacheKey` is carried across
 * as-is. `updatePolicyOverrides` is an opaque JSON blob (spec section 2.1,
 * rule 2) and is never inspected here, only re-serialised.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'update-policy-retention-cache';
const TARGET_TABLE = 'update_policy_retention_cache';

export const updatePolicyRetentionCacheImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insert = db.prepare(
      'INSERT INTO update_policy_retention_cache (cache_key, update_policy_overrides, expires_at) VALUES (?, ?, ?)',
    );

    let rows = 0;
    for (const doc of snapshot.documents(LEGACY_COLLECTION)) {
      if (typeof doc.cacheKey !== 'string' || typeof doc.expiresAt !== 'number') {
        continue;
      }
      insert.run(
        doc.cacheKey,
        doc.updatePolicyOverrides === undefined ? null : JSON.stringify(doc.updatePolicyOverrides),
        doc.expiresAt,
      );
      rows += 1;
    }
    return rows;
  },
};
