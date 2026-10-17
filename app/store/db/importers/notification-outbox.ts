/**
 * Importer for `notificationOutbox` (roadmap 7-STORE slice 5).
 *
 * Enveloped collection: each stored document is
 * `{ data: NotificationOutboxEntry }`. `payload` is an opaque blob per spec
 * section 2.1 and is carried across as-is, re-serialised as JSON text. A
 * document missing any of the fields a row cannot exist without (`id`,
 * `eventName`, `triggerId`, `status`, `nextAttemptAt`, `createdAt`) is skipped
 * rather than guessed at.
 */
import type { CollectionImporter, ImportContext } from '../import.js';

const LEGACY_COLLECTION = 'notificationOutbox';
const TARGET_TABLE = 'notification_outbox';

export const notificationOutboxImporter: CollectionImporter = {
  collection: LEGACY_COLLECTION,
  table: TARGET_TABLE,
  importInto({ db, snapshot }: ImportContext): number {
    const insert = db.prepare(
      `INSERT INTO notification_outbox
         (id, event_name, trigger_id, container_id, attempts, max_attempts, next_attempt_at, status, last_error, created_at, delivered_at, failed_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let rows = 0;
    for (const record of snapshot.records(LEGACY_COLLECTION)) {
      if (
        typeof record.id !== 'string' ||
        typeof record.eventName !== 'string' ||
        typeof record.triggerId !== 'string' ||
        typeof record.status !== 'string' ||
        typeof record.nextAttemptAt !== 'string' ||
        typeof record.createdAt !== 'string'
      ) {
        continue;
      }
      const payload =
        typeof record.payload === 'object' && record.payload !== null ? record.payload : {};
      insert.run(
        record.id,
        record.eventName,
        record.triggerId,
        typeof record.containerId === 'string' ? record.containerId : null,
        typeof record.attempts === 'number' ? record.attempts : 0,
        typeof record.maxAttempts === 'number' ? record.maxAttempts : 5,
        record.nextAttemptAt,
        record.status,
        typeof record.lastError === 'string' ? record.lastError : null,
        record.createdAt,
        typeof record.deliveredAt === 'string' ? record.deliveredAt : null,
        typeof record.failedAt === 'string' ? record.failedAt : null,
        JSON.stringify(payload),
      );
      rows += 1;
    }
    return rows;
  },
};
