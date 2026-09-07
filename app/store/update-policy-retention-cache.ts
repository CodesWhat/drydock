/**
 * Persisted update-policy retention cache: survives drydock's own container recreation.
 *
 * Backs the in-memory `updatePolicyRetentionCache` Map in app/store/container.ts — the
 * cache that lets a recreated container inherit its predecessor's updatePolicyOverrides
 * (maturity mode, min-days, skip list, snooze) instead of losing them. Backed by the
 * `update_policy_retention_cache` table (roadmap 7-STORE, slice 7), one row per cache
 * entry. `updatePolicyOverrides` is an opaque JSON blob (spec section 2.1, rule 2) and
 * is never inspected by this module.
 *
 * Without this, the cache lived only in a bare process-memory Map — wiped on every
 * restart, including the SIGTERM-driven restart that IS drydock's own self-update
 * (recreate action -> SIGTERM -> shutdown() -> store.save() -> process.exit ->
 * new process). Every self-update therefore lost the stash before the replacement
 * container could consume it, silently dropping controller-set update policy (#565).
 * Persisting the cache means a restarted process still has the stash before the
 * replacement container is discovered.
 */
import type { Database, Row } from './db/driver.js';

export interface UpdatePolicyRetentionCacheRecord {
  cacheKey: string; // deriveContainerIdentityKey() — same key the in-memory Map uses
  updatePolicyOverrides: unknown;
  expiresAt: number; // epoch ms — same TTL semantics as the in-memory Map
}

let db: Database | undefined;

function rowToRecord(row: Row): UpdatePolicyRetentionCacheRecord {
  return {
    cacheKey: String(row.cache_key),
    updatePolicyOverrides:
      row.update_policy_overrides === null
        ? undefined
        : JSON.parse(String(row.update_policy_overrides)),
    expiresAt: Number(row.expires_at),
  };
}

/**
 * Wire the update-policy-retention-cache store to the shared SQLite database.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
}

/**
 * Insert or update the persisted record for record.cacheKey.
 * A no-op (rather than a throw) when the store has not been initialized
 * yet — callers (container.ts) run this on every replacement-expected
 * deleteContainer and must not fail the stash just because the durable store
 * isn't wired up (e.g. in unit tests that only exercise the in-memory cache).
 */
export function upsertRecord(record: UpdatePolicyRetentionCacheRecord): void {
  if (!db) {
    return;
  }
  const overridesJson =
    record.updatePolicyOverrides === undefined
      ? null
      : JSON.stringify(record.updatePolicyOverrides);
  db.prepare(
    `INSERT INTO update_policy_retention_cache (cache_key, update_policy_overrides, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       update_policy_overrides = excluded.update_policy_overrides,
       expires_at = excluded.expires_at`,
  ).run(record.cacheKey, overridesJson, record.expiresAt);
}

/**
 * Delete the persisted record for cacheKey, if any.
 */
export function deleteRecord(cacheKey: string): void {
  if (!db) {
    return;
  }
  db.prepare('DELETE FROM update_policy_retention_cache WHERE cache_key = ?').run(cacheKey);
}

/**
 * List every persisted record. Used once at startup to rehydrate the in-memory
 * updatePolicyRetentionCache Map — see
 * rehydrateUpdatePolicyRetentionCacheFromStore() in container.ts.
 */
export function listRecords(): UpdatePolicyRetentionCacheRecord[] {
  if (!db) {
    return [];
  }
  return db
    .prepare(
      'SELECT cache_key, update_policy_overrides, expires_at FROM update_policy_retention_cache',
    )
    .all()
    .map(rowToRecord);
}

/** Exposed for tests to reset module state between cases. */
export function clearCollectionForTesting(): void {
  db = undefined;
}
