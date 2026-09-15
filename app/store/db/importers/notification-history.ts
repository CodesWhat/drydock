/**
 * Importer for `notifications_history` (roadmap 7-STORE slice 5).
 *
 * Enveloped collection: each stored document is
 * `{ data: NotificationHistoryEntry }`. The legacy record's `containerId`
 * field lands in the `container_identity_key` column, per the target schema
 * (`app/store/db/schema.ts`); the store module keeps the field named
 * `containerId` in every exported signature. A document missing any of the
 * fields a row cannot exist without (`key`, `triggerId`, `containerId`,
 * `eventKind`, `resultHash`) is skipped rather than guessed at.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'notifications_history';
const TARGET_TABLE = 'notification_history';

export const notificationHistoryImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insert = db.prepare(
      `INSERT INTO notification_history
         (key, trigger_id, container_identity_key, event_kind, result_hash, notified_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    let rows = 0;
    for (const record of snapshot.records(LEGACY_COLLECTION)) {
      if (
        typeof record.key !== 'string' ||
        typeof record.triggerId !== 'string' ||
        typeof record.containerId !== 'string' ||
        typeof record.eventKind !== 'string' ||
        typeof record.resultHash !== 'string'
      ) {
        continue;
      }
      const notifiedAt =
        typeof record.notifiedAt === 'string' ? record.notifiedAt : new Date().toISOString();
      insert.run(
        record.key,
        record.triggerId,
        record.containerId,
        record.eventKind,
        record.resultHash,
        notifiedAt,
      );
      rows += 1;
    }
    return rows;
  },
};
