import crypto from 'node:crypto';
import {
  type Container,
  type ContainerUpdateKind,
  getCandidateIdentityFields,
  isTagUpdateKind,
} from '../model/container.js';
import type { Database, Row } from './db/driver.js';

export type NotificationEventKind =
  | 'update-available'
  | 'update-available-digest'
  | 'update-applied'
  | 'update-failed'
  | 'security-alert'
  | 'security-alert-digest'
  | 'agent-connect'
  | 'agent-disconnect'
  | 'agent-reconnect'
  | 'maturity-cleared';

export interface NotificationHistoryEntry {
  key: string;
  triggerId: string;
  containerId: string;
  eventKind: NotificationEventKind;
  resultHash: string;
  notifiedAt: string;
}

let db: Database | undefined;

function rowToEntry(row: Row): NotificationHistoryEntry {
  return {
    key: String(row.key),
    triggerId: String(row.trigger_id),
    containerId: String(row.container_identity_key),
    eventKind: row.event_kind as NotificationEventKind,
    resultHash: String(row.result_hash),
    notifiedAt: String(row.notified_at),
  };
}

/**
 * Wire the notification-history store to the shared SQLite database.
 * A no-op when database is undefined, so callers that never initialize the
 * store (e.g. unit tests exercising unrelated code) do not have to guard it.
 * @param database
 */
export function createCollections(database: Database | undefined): void {
  if (!database) {
    return;
  }
  db = database;
}

function buildKey(
  triggerId: string,
  containerId: string,
  eventKind: NotificationEventKind,
): string {
  return `${triggerId}::${containerId}::${eventKind}`;
}

/**
 * Compute a stable hash of the fields that define "a notification about this exact update."
 * Mirrors the candidate identity used by `hasCandidateIdentityChanged()` (#568) — tag and
 * digest, with `created` participating only when no digest is available — plus `updateKind`,
 * so a hash change corresponds exactly to what humans would call "a different update".
 *
 * Excludes `suggestedTag` and (when a digest is present) `created` on purpose: those are
 * display-only metadata that can drift between scans — most notably on a manual recheck that
 * bypasses the registry poll cache — without the candidate itself changing. Hashing them
 * caused `hasAlreadyNotifiedForResult` to see a "new" result and fire a duplicate `once: true`
 * notification for the same update.
 *
 * For a tag-kind update on a container configured for digest watching
 * (`image.digest.watch`), digest and created are excluded outright rather than falling back
 * to "created when digest is absent": the candidate is fully identified by the tag, and the
 * digest lookup that runs alongside it is a separate, independently-failing call. A registry
 * rate limit (`Digest watch failed (429)`) drops the digest for one scan and not the next,
 * which used to flip `created` in and out of the hash and made `once=true` treat the exact
 * same tag update as new again a few hours later, re-firing every trigger (#972).
 *
 * A container NOT configured for digest watching never runs `handleDigestWatch`, the only
 * place that populates `result.digest` and `result.created`, so both stay undefined for it
 * and the digest-absent `created` fallback in `getCandidateIdentityFields` never has a value
 * to contribute. The identity for that container is effectively tag-only. Digest-kind updates
 * always stay keyed on the digest, since that's what identifies them.
 */
export function computeResultHash(
  container: Pick<Container, 'result' | 'updateKind' | 'image'>,
): string {
  const updateKind = (container.updateKind ?? {}) as Partial<ContainerUpdateKind>;
  const fields = getCandidateIdentityFields(container.result);
  const isStableTagUpdate =
    isTagUpdateKind(updateKind as ContainerUpdateKind) && container.image?.digest?.watch === true;
  const payload = {
    tag: fields.tag ?? null,
    digest: isStableTagUpdate ? null : (fields.digest ?? null),
    created: isStableTagUpdate ? null : (fields.created ?? null),
    kind: updateKind.kind ?? null,
    remoteValue: updateKind.remoteValue ?? null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function recordNotification(
  triggerId: string,
  containerId: string,
  eventKind: NotificationEventKind,
  resultHash: string,
  notifiedAt: string = new Date().toISOString(),
): void {
  if (!db) {
    return;
  }
  const key = buildKey(triggerId, containerId, eventKind);
  db.prepare(
    `INSERT INTO notification_history (key, trigger_id, container_identity_key, event_kind, result_hash, notified_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       trigger_id = excluded.trigger_id,
       container_identity_key = excluded.container_identity_key,
       event_kind = excluded.event_kind,
       result_hash = excluded.result_hash,
       notified_at = excluded.notified_at`,
  ).run(key, triggerId, containerId, eventKind, resultHash, notifiedAt);
}

export function getLastNotifiedHash(
  triggerId: string,
  containerId: string,
  eventKind: NotificationEventKind,
): string | undefined {
  if (!db) {
    return undefined;
  }
  const row = db
    .prepare('SELECT result_hash FROM notification_history WHERE key = ?')
    .get(buildKey(triggerId, containerId, eventKind));
  return row ? String(row.result_hash) : undefined;
}

export function clearNotificationsForContainer(containerId: string): number {
  if (!db) {
    return 0;
  }
  const result = db
    .prepare('DELETE FROM notification_history WHERE container_identity_key = ?')
    .run(containerId);
  return result.changes;
}

export function clearNotificationsForTrigger(triggerId: string): number {
  if (!db) {
    return 0;
  }
  const result = db.prepare('DELETE FROM notification_history WHERE trigger_id = ?').run(triggerId);
  return result.changes;
}

export function clearNotificationsForContainerAndEvent(
  containerId: string,
  eventKind: NotificationEventKind,
): number {
  if (!db) {
    return 0;
  }
  const result = db
    .prepare('DELETE FROM notification_history WHERE container_identity_key = ? AND event_kind = ?')
    .run(containerId, eventKind);
  return result.changes;
}

export function getAllForTesting(): NotificationHistoryEntry[] {
  if (!db) {
    return [];
  }
  return db
    .prepare(
      'SELECT key, trigger_id, container_identity_key, event_kind, result_hash, notified_at FROM notification_history',
    )
    .all()
    .map(rowToEntry);
}

export function resetForTesting(): void {
  if (!db) {
    return;
  }
  db.prepare('DELETE FROM notification_history').run();
}
