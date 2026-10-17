/**
 * Persisted update-lifecycle cache: survives drydock's own container recreation.
 *
 * Backs the in-memory `updateLifecycleCache` Map in app/store/container.ts — the
 * cache that lets a recreated container inherit its predecessor's
 * updateDetectedAt/firstSeenAt/maturityGatePendingSince instead of restarting its
 * maturity clock. Backed by the `update_lifecycle_cache` table (roadmap 7-STORE,
 * slice 7), one row per cache entry.
 *
 * Without this, the cache lived only in a bare process-memory Map — wiped on every
 * restart, including the SIGTERM-driven restart that IS drydock's own self-update
 * (recreate action -> SIGTERM -> shutdown() -> store.save() -> process.exit ->
 * new process). Every self-update therefore lost the stash before the replacement
 * container could consume it, silently re-stamping updateDetectedAt as "now" and
 * restarting any maturity soak (#556). Persisting the cache means a restarted
 * process still has the stash before the replacement container is discovered.
 *
 * The cache key was `${watcher}::${name}` before this slice; it is now the same
 * durable identity key (`deriveContainerIdentityKey()`, `app/model/container.ts`)
 * the update-policy retention cache already used, so a container recreated under
 * a new name (a compose service redeployed with a new container name, for
 * instance) inherits its predecessor's maturity clock the same way it already
 * inherited the retained update policy. `app/store/container.ts` derives the key;
 * this module only stores whatever key it is given.
 */
import type { Database, Row } from './db/driver.js';

export interface UpdateLifecycleCacheRecord {
  cacheKey: string; // deriveContainerIdentityKey() — same key the in-memory Map uses
  updateDetectedAt: string;
  firstSeenAt?: string;
  maturityGatePendingSince?: string;
  resultSignature: string;
  expiresAt: number; // epoch ms — same TTL semantics as the in-memory Map
}

let db: Database | undefined;
/**
 * Monotonic per-database counter, bumped on every insert/refresh. Backs the
 * `refresh_order` column: a SELECT with no ORDER BY does not reproduce Map
 * insertion order across a restart, and an upsert never moves a row's
 * rowid, so listRecords() orders by this column instead (finding 2,
 * roadmap 7-STORE slice 7 review). Seeded from the table's current max on
 * createCollections() so it keeps counting up rather than restarting at 0
 * and colliding with rows already on disk.
 */
let refreshOrderCounter = 0;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function rowToRecord(row: Row): UpdateLifecycleCacheRecord {
  return {
    cacheKey: String(row.cache_key),
    updateDetectedAt: String(row.update_detected_at),
    firstSeenAt: optionalString(row.first_seen_at),
    maturityGatePendingSince: optionalString(row.maturity_gate_pending_since),
    resultSignature: String(row.result_signature),
    expiresAt: Number(row.expires_at),
  };
}

/**
 * Wire the update-lifecycle-cache store to the shared SQLite database.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
  // COALESCE guarantees exactly one row with a non-null maxOrder, even on an
  // empty table, so the aggregate query never actually returns undefined.
  const row = db
    .prepare('SELECT COALESCE(MAX(refresh_order), 0) AS maxOrder FROM update_lifecycle_cache')
    .get()!;
  refreshOrderCounter = Number(row.maxOrder);
}

/**
 * Insert or update the persisted record for record.cacheKey.
 * A no-op (rather than a throw) when the store has not been initialized
 * yet — callers (container.ts) run this on every replacement-expected
 * deleteContainer and must not fail the stash just because the durable store
 * isn't wired up (e.g. in unit tests that only exercise the in-memory cache).
 */
export function upsertRecord(record: UpdateLifecycleCacheRecord): void {
  if (!db) {
    return;
  }
  refreshOrderCounter += 1;
  db.prepare(
    `INSERT INTO update_lifecycle_cache
       (cache_key, update_detected_at, first_seen_at, maturity_gate_pending_since, result_signature, expires_at, refresh_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       update_detected_at = excluded.update_detected_at,
       first_seen_at = excluded.first_seen_at,
       maturity_gate_pending_since = excluded.maturity_gate_pending_since,
       result_signature = excluded.result_signature,
       expires_at = excluded.expires_at,
       refresh_order = excluded.refresh_order`,
  ).run(
    record.cacheKey,
    record.updateDetectedAt,
    record.firstSeenAt ?? null,
    record.maturityGatePendingSince ?? null,
    record.resultSignature,
    record.expiresAt,
    refreshOrderCounter,
  );
}

/**
 * Delete the persisted record for cacheKey, if any.
 */
export function deleteRecord(cacheKey: string): void {
  if (!db) {
    return;
  }
  db.prepare('DELETE FROM update_lifecycle_cache WHERE cache_key = ?').run(cacheKey);
}

/**
 * List every persisted record, oldest-refreshed first. Used once at startup to
 * rehydrate the in-memory updateLifecycleCache Map — see
 * rehydrateUpdateLifecycleCacheFromStore() in container.ts — which relies on
 * this order matching the Map insertion order its size-cap eviction reads as
 * an LRU (finding 2, roadmap 7-STORE slice 7 review).
 */
export function listRecords(): UpdateLifecycleCacheRecord[] {
  if (!db) {
    return [];
  }
  return db
    .prepare(
      'SELECT cache_key, update_detected_at, first_seen_at, maturity_gate_pending_since, result_signature, expires_at FROM update_lifecycle_cache ORDER BY refresh_order ASC',
    )
    .all()
    .map(rowToRecord);
}

/** Exposed for tests to reset module state between cases. */
export function clearCollectionForTesting(): void {
  db = undefined;
}
