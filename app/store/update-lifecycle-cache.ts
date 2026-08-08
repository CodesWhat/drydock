/**
 * Persisted update-lifecycle cache: survives drydock's own container recreation.
 *
 * Backs the in-memory `updateLifecycleCache` Map in app/store/container.ts — the
 * cache that lets a recreated container inherit its predecessor's
 * updateDetectedAt/firstSeenAt/maturityGatePendingSince instead of restarting its
 * maturity clock. Mirrors name-bindings.ts: one LokiJS collection, loaded/autosaved
 * by the shared store, one document per cache entry.
 *
 * Without this, the cache lived only in a bare process-memory Map — wiped on every
 * restart, including the SIGTERM-driven restart that IS drydock's own self-update
 * (recreate action -> SIGTERM -> shutdown() -> store.save() -> process.exit ->
 * new process). Every self-update therefore lost the stash before the replacement
 * container could consume it, silently re-stamping updateDetectedAt as "now" and
 * restarting any maturity soak (#556). Persisting the cache means a restarted
 * process still has the stash before the replacement container is discovered.
 */
import { initCollection } from './util.js';

export interface UpdateLifecycleCacheRecord {
  cacheKey: string; // `${watcher}::${name}` — same key the in-memory Map uses
  updateDetectedAt: string;
  firstSeenAt?: string;
  maturityGatePendingSince?: string;
  resultSignature: string;
  expiresAt: number; // epoch ms — same TTL semantics as the in-memory Map
}

interface UpdateLifecycleCacheCollection {
  findOne(query: Record<string, unknown>): UpdateLifecycleCacheRecord | null;
  find(query?: Record<string, unknown>): UpdateLifecycleCacheRecord[];
  insert(document: UpdateLifecycleCacheRecord): void;
  update(document: UpdateLifecycleCacheRecord): void;
  remove(document: UpdateLifecycleCacheRecord): void;
}

interface UpdateLifecycleCacheStoreDb {
  getCollection(name: string): UpdateLifecycleCacheCollection | null;
  addCollection(name: string, options?: Record<string, unknown>): UpdateLifecycleCacheCollection;
}

let updateLifecycleCacheCollection: UpdateLifecycleCacheCollection | undefined;

/**
 * Create the update-lifecycle-cache collection.
 * @param db
 */
export function createCollections(db: UpdateLifecycleCacheStoreDb): void {
  updateLifecycleCacheCollection = initCollection(db, 'update-lifecycle-cache', {
    indices: ['cacheKey'],
  }) as UpdateLifecycleCacheCollection;
}

/**
 * Insert or update the persisted record for record.cacheKey.
 * A no-op (rather than a throw) when the collection has not been initialized
 * yet — callers (container.ts) run this on every replacement-expected
 * deleteContainer and must not fail the stash just because the durable store
 * isn't wired up (e.g. in unit tests that only exercise the in-memory cache).
 */
export function upsertRecord(record: UpdateLifecycleCacheRecord): void {
  if (!updateLifecycleCacheCollection) {
    return;
  }
  const existing = updateLifecycleCacheCollection.findOne({ cacheKey: record.cacheKey });
  if (existing) {
    existing.updateDetectedAt = record.updateDetectedAt;
    existing.firstSeenAt = record.firstSeenAt;
    existing.maturityGatePendingSince = record.maturityGatePendingSince;
    existing.resultSignature = record.resultSignature;
    existing.expiresAt = record.expiresAt;
    updateLifecycleCacheCollection.update(existing);
    return;
  }
  updateLifecycleCacheCollection.insert(record);
}

/**
 * Delete the persisted record for cacheKey, if any.
 */
export function deleteRecord(cacheKey: string): void {
  if (!updateLifecycleCacheCollection) {
    return;
  }
  const existing = updateLifecycleCacheCollection.findOne({ cacheKey });
  if (existing) {
    updateLifecycleCacheCollection.remove(existing);
  }
}

/**
 * List every persisted record. Used once at startup to rehydrate the in-memory
 * updateLifecycleCache Map — see rehydrateUpdateLifecycleCacheFromStore() in
 * container.ts.
 */
export function listRecords(): UpdateLifecycleCacheRecord[] {
  if (!updateLifecycleCacheCollection) {
    return [];
  }
  return updateLifecycleCacheCollection.find();
}

/** Exposed for tests to reset module state between cases. */
export function clearCollectionForTesting(): void {
  updateLifecycleCacheCollection = undefined;
}
