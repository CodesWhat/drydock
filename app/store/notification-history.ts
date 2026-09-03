import crypto from 'node:crypto';
import type Loki from 'lokijs';
import {
  type Container,
  type ContainerUpdateKind,
  getCandidateIdentityFields,
  isTagUpdateKind,
} from '../model/container.js';
import { initCollection } from './util.js';

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

type LokiDatabase = InstanceType<typeof Loki>;
type HistoryCollection = ReturnType<typeof initCollection>;

let historyCollection: HistoryCollection | undefined;

export function createCollections(db: LokiDatabase | undefined): void {
  if (!db) {
    return;
  }
  historyCollection = initCollection(db, 'notifications_history', {
    indices: ['data.key', 'data.triggerId', 'data.containerId'],
  });
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
  if (!historyCollection) {
    return;
  }
  const key = buildKey(triggerId, containerId, eventKind);
  const existingDoc = historyCollection.findOne({ 'data.key': key });
  const entry: NotificationHistoryEntry = {
    key,
    triggerId,
    containerId,
    eventKind,
    resultHash,
    notifiedAt,
  };
  if (existingDoc) {
    existingDoc.data = entry;
    historyCollection.update(existingDoc);
  } else {
    historyCollection.insert({ data: entry });
  }
}

export function getLastNotifiedHash(
  triggerId: string,
  containerId: string,
  eventKind: NotificationEventKind,
): string | undefined {
  if (!historyCollection) {
    return undefined;
  }
  const doc = historyCollection.findOne({
    'data.key': buildKey(triggerId, containerId, eventKind),
  });
  return doc ? (doc.data as NotificationHistoryEntry).resultHash : undefined;
}

export function clearNotificationsForContainer(containerId: string): number {
  if (!historyCollection) {
    return 0;
  }
  const docs = historyCollection.find({ 'data.containerId': containerId });
  docs.forEach((doc) => historyCollection?.remove(doc));
  return docs.length;
}

export function clearNotificationsForTrigger(triggerId: string): number {
  if (!historyCollection) {
    return 0;
  }
  const docs = historyCollection.find({ 'data.triggerId': triggerId });
  docs.forEach((doc) => historyCollection?.remove(doc));
  return docs.length;
}

export function clearNotificationsForContainerAndEvent(
  containerId: string,
  eventKind: NotificationEventKind,
): number {
  if (!historyCollection) {
    return 0;
  }
  const docs = historyCollection
    .find({ 'data.containerId': containerId })
    .filter((doc) => (doc.data as NotificationHistoryEntry).eventKind === eventKind);
  docs.forEach((doc) => historyCollection?.remove(doc));
  return docs.length;
}

export function getAllForTesting(): NotificationHistoryEntry[] {
  if (!historyCollection) {
    return [];
  }
  return historyCollection.find().map((doc) => doc.data as NotificationHistoryEntry);
}

export function resetForTesting(): void {
  if (!historyCollection) {
    return;
  }
  const docs = historyCollection.find();
  docs.forEach((doc) => historyCollection?.remove(doc));
}
