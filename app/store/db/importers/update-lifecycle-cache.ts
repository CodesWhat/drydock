/**
 * Importer for `update_lifecycle_cache` (roadmap 7-STORE slice 7).
 *
 * Flat collection: each stored document is an `UpdateLifecycleCacheRecord` with
 * no envelope (`app/store/update-lifecycle-cache.ts` inserts records directly).
 * The legacy `cacheKey` was `${watcher}::${name}` (`app/store/container.ts`,
 * pre slice 7); this slice re-keys the table on the same durable identity key
 * `deriveContainerIdentityKey()` computes, so a legacy row is carried forward
 * only when exactly one local (non-agent) container in the imported data still
 * resolves to that old watcher/name pair — anything else (no match, an
 * ambiguous match, or a container whose identity fails to derive) is dropped.
 * That is safe because the whole cache is a best-effort TTL'd stash: every
 * record carries its own `expiresAt`, so losing one just means the next
 * recreate restarts that container's maturity clock instead of silently
 * corrupting anything.
 */
import { type Container, deriveContainerIdentityKey } from '../../../model/container.js';
import type { CollectionImporter, ImportContext } from '../import.js';
import type { LokiDocument } from '../loki-json.js';

const LEGACY_COLLECTION = 'update-lifecycle-cache';
const TARGET_TABLE = 'update_lifecycle_cache';
const CONTAINERS_COLLECTION = 'containers';

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isLocalContainerRecord(record: LokiDocument): boolean {
  return !(typeof record.agent === 'string' && record.agent !== '');
}

function legacyCacheKeyFor(record: LokiDocument): string | undefined {
  if (typeof record.watcher !== 'string' || typeof record.name !== 'string') {
    return undefined;
  }
  return `${record.watcher}::${record.name}`;
}

/**
 * Map every local container's legacy `watcher::name` key to its document.
 * A key claimed by more than one container is set to `null` — ambiguous, so
 * neither container's identity should be guessed at — rather than silently
 * picking whichever one was seen first.
 */
function buildLegacyKeyIndex(containers: LokiDocument[]): Map<string, LokiDocument | null> {
  const index = new Map<string, LokiDocument | null>();
  for (const record of containers) {
    if (!isLocalContainerRecord(record)) {
      continue;
    }
    const legacyKey = legacyCacheKeyFor(record);
    if (legacyKey === undefined) {
      continue;
    }
    index.set(legacyKey, index.has(legacyKey) ? null : record);
  }
  return index;
}

export const updateLifecycleCacheImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const legacyKeyIndex = buildLegacyKeyIndex(snapshot.records(CONTAINERS_COLLECTION));
    const insert = db.prepare(
      `INSERT INTO update_lifecycle_cache
         (cache_key, update_detected_at, first_seen_at, maturity_gate_pending_since, result_signature, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    let rows = 0;
    const seenNewKeys = new Set<string>();
    for (const doc of snapshot.documents(LEGACY_COLLECTION)) {
      if (
        typeof doc.cacheKey !== 'string' ||
        typeof doc.updateDetectedAt !== 'string' ||
        typeof doc.resultSignature !== 'string' ||
        typeof doc.expiresAt !== 'number'
      ) {
        continue;
      }

      const container = legacyKeyIndex.get(doc.cacheKey);
      if (!container) {
        continue;
      }
      const newKey = deriveContainerIdentityKey(container as unknown as Container);
      if (newKey === undefined || seenNewKeys.has(newKey)) {
        continue;
      }
      seenNewKeys.add(newKey);

      insert.run(
        newKey,
        doc.updateDetectedAt,
        optionalString(doc.firstSeenAt),
        optionalString(doc.maturityGatePendingSince),
        doc.resultSignature,
        doc.expiresAt,
      );
      rows += 1;
    }
    return rows;
  },
};
