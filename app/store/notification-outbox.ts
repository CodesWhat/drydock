import crypto from 'node:crypto';
import type {
  NotificationOutboxEntry,
  NotificationOutboxEntryStatus,
} from '../model/notification-outbox.js';
import { scrubAuthorizationHeaderValues } from '../util/auth-redaction.js';
import type { Database, Row } from './db/driver.js';

const DEFAULT_MAX_ATTEMPTS = 5;

let db: Database | undefined;

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function rowToEntry(row: Row): NotificationOutboxEntry {
  return {
    id: String(row.id),
    eventName: String(row.event_name),
    payload: JSON.parse(String(row.payload)) as Record<string, unknown>,
    triggerId: String(row.trigger_id),
    containerId: optionalString(row.container_id),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: String(row.next_attempt_at),
    status: row.status as NotificationOutboxEntryStatus,
    lastError: optionalString(row.last_error),
    createdAt: String(row.created_at),
    deliveredAt: optionalString(row.delivered_at),
    failedAt: optionalString(row.failed_at),
  };
}

/**
 * Wire the notification outbox store to the shared SQLite database. Schema
 * creation is the migration runner's job; this only captures the handle.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
}

export interface EnqueueOutboxEntryInput {
  eventName: string;
  payload: Record<string, unknown>;
  triggerId: string;
  containerId?: string;
  maxAttempts?: number;
  nextAttemptAt?: string;
}

export function enqueueOutboxEntry(input: EnqueueOutboxEntryInput): NotificationOutboxEntry {
  const now = new Date().toISOString();
  const entry: NotificationOutboxEntry = {
    id: crypto.randomUUID(),
    eventName: input.eventName,
    payload: input.payload,
    triggerId: input.triggerId,
    containerId: input.containerId,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    nextAttemptAt: input.nextAttemptAt ?? now,
    status: 'pending',
    createdAt: now,
  };
  if (db) {
    db.prepare(
      `INSERT INTO notification_outbox
         (id, event_name, trigger_id, container_id, attempts, max_attempts, next_attempt_at, status, last_error, created_at, delivered_at, failed_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.id,
      entry.eventName,
      entry.triggerId,
      entry.containerId ?? null,
      entry.attempts,
      entry.maxAttempts,
      entry.nextAttemptAt,
      entry.status,
      null,
      entry.createdAt,
      null,
      null,
      JSON.stringify(entry.payload),
    );
  }
  return entry;
}

export function getOutboxEntry(id: string): NotificationOutboxEntry | undefined {
  if (!db) {
    return undefined;
  }
  const row = db.prepare('SELECT * FROM notification_outbox WHERE id = ?').get(id);
  return row ? rowToEntry(row) : undefined;
}

export function findReadyForDelivery(
  nowIso: string = new Date().toISOString(),
): NotificationOutboxEntry[] {
  if (!db) {
    return [];
  }
  return db
    .prepare(
      `SELECT * FROM notification_outbox
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC`,
    )
    .all(nowIso)
    .map(rowToEntry);
}

export function findOutboxEntriesByStatus(
  status: NotificationOutboxEntryStatus,
): NotificationOutboxEntry[] {
  if (!db) {
    return [];
  }
  return db
    .prepare('SELECT * FROM notification_outbox WHERE status = ? ORDER BY created_at ASC')
    .all(status)
    .map(rowToEntry);
}

export function findAllOutboxEntries(): NotificationOutboxEntry[] {
  if (!db) {
    return [];
  }
  return db
    .prepare('SELECT * FROM notification_outbox ORDER BY created_at ASC')
    .all()
    .map(rowToEntry);
}

export interface MarkAttemptedInput {
  error: string;
  nextAttemptAt: string;
}

export function markOutboxEntryAttempted(
  id: string,
  input: MarkAttemptedInput,
): NotificationOutboxEntry | undefined {
  if (!db) {
    return undefined;
  }
  const existing = getOutboxEntry(id);
  if (!existing) {
    return undefined;
  }
  const attempts = existing.attempts + 1;
  const lastError = scrubAuthorizationHeaderValues(input.error);
  const becomesDeadLetter = attempts >= existing.maxAttempts;
  const status: NotificationOutboxEntryStatus = becomesDeadLetter ? 'dead-letter' : existing.status;
  const failedAt = becomesDeadLetter ? new Date().toISOString() : (existing.failedAt ?? null);

  db.prepare(
    `UPDATE notification_outbox
     SET attempts = ?, last_error = ?, next_attempt_at = ?, status = ?, failed_at = ?
     WHERE id = ?`,
  ).run(attempts, lastError, input.nextAttemptAt, status, failedAt, id);

  return getOutboxEntry(id);
}

export function markOutboxEntryDelivered(id: string): NotificationOutboxEntry | undefined {
  if (!db) {
    return undefined;
  }
  const existing = getOutboxEntry(id);
  if (!existing) {
    return undefined;
  }
  db.prepare(
    `UPDATE notification_outbox
     SET attempts = ?, status = 'delivered', delivered_at = ?, last_error = NULL
     WHERE id = ?`,
  ).run(existing.attempts + 1, new Date().toISOString(), id);

  return getOutboxEntry(id);
}

export function requeueDeadLetterEntry(
  id: string,
  nextAttemptAt: string = new Date().toISOString(),
): NotificationOutboxEntry | undefined {
  if (!db) {
    return undefined;
  }
  const existing = getOutboxEntry(id);
  if (!existing || existing.status !== 'dead-letter') {
    return undefined;
  }
  db.prepare(
    `UPDATE notification_outbox
     SET status = 'pending', attempts = 0, next_attempt_at = ?, failed_at = NULL, last_error = NULL
     WHERE id = ?`,
  ).run(nextAttemptAt, id);

  return getOutboxEntry(id);
}

export function removeOutboxEntry(id: string): boolean {
  if (!db) {
    return false;
  }
  const result = db.prepare('DELETE FROM notification_outbox WHERE id = ?').run(id);
  return result.changes > 0;
}

export function purgeTerminalOutboxEntriesOlderThan(cutoffIso: string): number {
  if (!db) {
    return 0;
  }
  const result = db
    .prepare(
      `DELETE FROM notification_outbox
       WHERE (status = 'delivered' AND delivered_at < ?)
          OR (status = 'dead-letter' AND failed_at < ?)`,
    )
    .run(cutoffIso, cutoffIso);
  return result.changes;
}

export function _resetOutboxStoreForTests(): void {
  db = undefined;
}
