import crypto from 'node:crypto';
import type Loki from 'lokijs';
import type { Container } from '../model/container.js';
import { initCollection } from './util.js';

export type NotificationEventKind =
  | 'update-available'
  | 'update-applied'
  | 'update-failed'
  | 'security-alert'
  | 'agent-connect'
  | 'agent-disconnect'
  | 'agent-reconnect';

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
 * Mirrors the fields used by `hasResultChanged()` so a hash change corresponds exactly to
 * what humans would call "a different update".
 */
export function computeResultHash(container: Pick<Container, 'result' | 'updateKind'>): string {
  const result = container.result ?? {};
  const updateKind = container.updateKind ?? {};
  const payload = {
    tag: (result as { tag?: unknown }).tag ?? null,
    suggestedTag: (result as { suggestedTag?: unknown }).suggestedTag ?? null,
    digest: (result as { digest?: unknown }).digest ?? null,
    created: (result as { created?: unknown }).created ?? null,
    kind: (updateKind as { kind?: unknown }).kind ?? null,
    remoteValue: (updateKind as { remoteValue?: unknown }).remoteValue ?? null,
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
