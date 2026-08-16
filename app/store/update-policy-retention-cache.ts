/**
 * Persisted update-policy retention cache: survives drydock's own container recreation.
 *
 * Backs the in-memory `updatePolicyRetentionCache` Map in app/store/container.ts — the
 * cache that lets a recreated container inherit its predecessor's updatePolicyOverrides
 * (maturity mode, min-days, skip list, snooze) instead of losing them. Mirrors
 * update-lifecycle-cache.ts: one LokiJS collection, loaded/autosaved by the shared
 * store, one document per cache entry.
 *
 * Without this, the cache lived only in a bare process-memory Map — wiped on every
 * restart, including the SIGTERM-driven restart that IS drydock's own self-update
 * (recreate action -> SIGTERM -> shutdown() -> store.save() -> process.exit ->
 * new process). Every self-update therefore lost the stash before the replacement
 * container could consume it, silently dropping controller-set update policy (#565).
 * Persisting the cache means a restarted process still has the stash before the
 * replacement container is discovered.
 */
import { initCollection } from './util.js';

export interface UpdatePolicyRetentionCacheRecord {
  cacheKey: string; // deriveContainerIdentityKey() — same key the in-memory Map uses
  updatePolicyOverrides: unknown;
  expiresAt: number; // epoch ms — same TTL semantics as the in-memory Map
}

interface UpdatePolicyRetentionCacheCollection {
  findOne(query: Record<string, unknown>): UpdatePolicyRetentionCacheRecord | null;
  find(query?: Record<string, unknown>): UpdatePolicyRetentionCacheRecord[];
  insert(document: UpdatePolicyRetentionCacheRecord): void;
  update(document: UpdatePolicyRetentionCacheRecord): void;
  remove(document: UpdatePolicyRetentionCacheRecord): void;
}

interface UpdatePolicyRetentionCacheStoreDb {
  getCollection(name: string): UpdatePolicyRetentionCacheCollection | null;
  addCollection(
    name: string,
    options?: Record<string, unknown>,
  ): UpdatePolicyRetentionCacheCollection;
}

let updatePolicyRetentionCacheCollection: UpdatePolicyRetentionCacheCollection | undefined;

/**
 * Create the update-policy-retention-cache collection.
 * @param db
 */
export function createCollections(db: UpdatePolicyRetentionCacheStoreDb): void {
  updatePolicyRetentionCacheCollection = initCollection(db, 'update-policy-retention-cache', {
    indices: ['cacheKey'],
  }) as UpdatePolicyRetentionCacheCollection;
}

/**
 * Insert or update the persisted record for record.cacheKey.
 * A no-op (rather than a throw) when the collection has not been initialized
 * yet — callers (container.ts) run this on every replacement-expected
 * deleteContainer and must not fail the stash just because the durable store
 * isn't wired up (e.g. in unit tests that only exercise the in-memory cache).
 */
export function upsertRecord(record: UpdatePolicyRetentionCacheRecord): void {
  if (!updatePolicyRetentionCacheCollection) {
    return;
  }
  const existing = updatePolicyRetentionCacheCollection.findOne({ cacheKey: record.cacheKey });
  if (existing) {
    existing.updatePolicyOverrides = record.updatePolicyOverrides;
    existing.expiresAt = record.expiresAt;
    updatePolicyRetentionCacheCollection.update(existing);
    return;
  }
  updatePolicyRetentionCacheCollection.insert(record);
}

/**
 * Delete the persisted record for cacheKey, if any.
 */
export function deleteRecord(cacheKey: string): void {
  if (!updatePolicyRetentionCacheCollection) {
    return;
  }
  const existing = updatePolicyRetentionCacheCollection.findOne({ cacheKey });
  if (existing) {
    updatePolicyRetentionCacheCollection.remove(existing);
  }
}

/**
 * List every persisted record. Used once at startup to rehydrate the in-memory
 * updatePolicyRetentionCache Map — see
 * rehydrateUpdatePolicyRetentionCacheFromStore() in container.ts.
 */
export function listRecords(): UpdatePolicyRetentionCacheRecord[] {
  if (!updatePolicyRetentionCacheCollection) {
    return [];
  }
  return updatePolicyRetentionCacheCollection.find();
}

/** Exposed for tests to reset module state between cases. */
export function clearCollectionForTesting(): void {
  updatePolicyRetentionCacheCollection = undefined;
}
