/**
 * Importer for `audit` (roadmap 7-STORE slice 5).
 *
 * Enveloped collection: each stored document is `{ data: AuditEntry,
 * timestampMs?: number }`. `timestamp_ms` is NOT NULL in the target schema, so
 * a document missing `timestampMs` — what the pre-migration
 * `migrateMissingTimestampIndex` startup scan used to backfill on every boot
 * (`app/store/audit.ts`) — gets it filled in here instead, once, the same way:
 * `Date.parse(data.timestamp)`, or 0 when the stored timestamp itself does not
 * parse. A document missing any of the four fields a row cannot exist without
 * (`id`, `action`, `containerName`, `status`) is skipped rather than guessed
 * at.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'audit';
const TARGET_TABLE = 'audit';

function parseTimestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export const auditImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insert = db.prepare(
      `INSERT INTO audit
         (id, timestamp, timestamp_ms, action, container_name, container_identity_key, container_image, from_version, to_version, update_kind, semver_diff, trigger_name, status, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let rows = 0;
    for (const document of snapshot.documents(LEGACY_COLLECTION)) {
      const data = document.data;
      if (typeof data !== 'object' || data === null) {
        continue;
      }
      const entry = data as Record<string, unknown>;
      if (
        typeof entry.id !== 'string' ||
        typeof entry.action !== 'string' ||
        typeof entry.containerName !== 'string' ||
        typeof entry.status !== 'string'
      ) {
        continue;
      }

      const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : '';
      const timestampMs =
        typeof document.timestampMs === 'number'
          ? document.timestampMs
          : parseTimestampMs(timestamp);

      insert.run(
        entry.id,
        timestamp,
        timestampMs,
        entry.action,
        entry.containerName,
        typeof entry.containerIdentityKey === 'string' ? entry.containerIdentityKey : null,
        typeof entry.containerImage === 'string' ? entry.containerImage : null,
        typeof entry.fromVersion === 'string' ? entry.fromVersion : null,
        typeof entry.toVersion === 'string' ? entry.toVersion : null,
        typeof entry.updateKind === 'string' ? entry.updateKind : null,
        typeof entry.semverDiff === 'string' ? entry.semverDiff : null,
        typeof entry.triggerName === 'string' ? entry.triggerName : null,
        entry.status,
        typeof entry.details === 'string' ? entry.details : null,
      );
      rows += 1;
    }
    return rows;
  },
};
