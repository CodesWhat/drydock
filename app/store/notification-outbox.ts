import crypto from 'node:crypto';
import type {
  NotificationOutboxEntry,
  NotificationOutboxEntryStatus,
} from '../model/notification-outbox.js';
import { scrubAuthorizationHeaderValues } from '../util/auth-redaction.js';
import { initCollection } from './util.js';

const DEFAULT_MAX_ATTEMPTS = 5;

interface OutboxCollectionDocument {
  $loki?: number;
  data: NotificationOutboxEntry;
}

type OutboxCollectionQuery = {
  'data.status'?: NotificationOutboxEntryStatus | { $ne: NotificationOutboxEntryStatus };
  'data.nextAttemptAt'?: string | { $lte: string };
};

interface OutboxCollection {
  insert(document: OutboxCollectionDocument): void;
  find(query?: OutboxCollectionQuery): OutboxCollectionDocument[];
  findOne(query: { 'data.id': string }): OutboxCollectionDocument | null;
  remove(document: OutboxCollectionDocument): void;
}

interface OutboxStoreDb {
  getCollection(name: string): OutboxCollection | null;
  addCollection(name: string, options?: { indices?: string[] }): OutboxCollection;
}

let outboxCollection: OutboxCollection | undefined;

export function createCollections(db: OutboxStoreDb): void {
  outboxCollection = initCollection(
    db as unknown as Parameters<typeof initCollection>[0],
    'notificationOutbox',
    {
      indices: ['data.id', 'data.status', 'data.triggerId', 'data.nextAttemptAt'],
    },
  ) as unknown as OutboxCollection;
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
  if (outboxCollection) {
    outboxCollection.insert({ data: entry });
  }
  return entry;
}

export function getOutboxEntry(id: string): NotificationOutboxEntry | undefined {
  if (!outboxCollection) {
    return undefined;
  }
  const doc = outboxCollection.findOne({ 'data.id': id });
  return doc ? doc.data : undefined;
}

export function findReadyForDelivery(
  nowIso: string = new Date().toISOString(),
): NotificationOutboxEntry[] {
  if (!outboxCollection) {
    return [];
  }
  return outboxCollection
    .find({ 'data.status': 'pending', 'data.nextAttemptAt': { $lte: nowIso } })
    .map((doc) => doc.data)
    .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt));
}

export function findOutboxEntriesByStatus(
  status: NotificationOutboxEntryStatus,
): NotificationOutboxEntry[] {
  if (!outboxCollection) {
    return [];
  }
  return outboxCollection
    .find({ 'data.status': status })
    .map((doc) => doc.data)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface MarkAttemptedInput {
  error: string;
  nextAttemptAt: string;
}

export function markOutboxEntryAttempted(
  id: string,
  input: MarkAttemptedInput,
): NotificationOutboxEntry | undefined {
  if (!outboxCollection) {
    return undefined;
  }
  const doc = outboxCollection.findOne({ 'data.id': id });
  if (!doc) {
    return undefined;
  }
  const next: NotificationOutboxEntry = {
    ...doc.data,
    attempts: doc.data.attempts + 1,
    lastError: scrubAuthorizationHeaderValues(input.error),
    nextAttemptAt: input.nextAttemptAt,
  };
  if (next.attempts >= next.maxAttempts) {
    next.status = 'dead-letter';
    next.failedAt = new Date().toISOString();
  }
  outboxCollection.remove(doc);
  outboxCollection.insert({ data: next });
  return next;
}

export function markOutboxEntryDelivered(id: string): NotificationOutboxEntry | undefined {
  if (!outboxCollection) {
    return undefined;
  }
  const doc = outboxCollection.findOne({ 'data.id': id });
  if (!doc) {
    return undefined;
  }
  const next: NotificationOutboxEntry = {
    ...doc.data,
    attempts: doc.data.attempts + 1,
    status: 'delivered',
    deliveredAt: new Date().toISOString(),
    lastError: undefined,
  };
  outboxCollection.remove(doc);
  outboxCollection.insert({ data: next });
  return next;
}

export function requeueDeadLetterEntry(
  id: string,
  nextAttemptAt: string = new Date().toISOString(),
): NotificationOutboxEntry | undefined {
  if (!outboxCollection) {
    return undefined;
  }
  const doc = outboxCollection.findOne({ 'data.id': id });
  if (!doc || doc.data.status !== 'dead-letter') {
    return undefined;
  }
  const next: NotificationOutboxEntry = {
    ...doc.data,
    status: 'pending',
    attempts: 0,
    nextAttemptAt,
    failedAt: undefined,
    lastError: undefined,
  };
  outboxCollection.remove(doc);
  outboxCollection.insert({ data: next });
  return next;
}

export function removeOutboxEntry(id: string): boolean {
  if (!outboxCollection) {
    return false;
  }
  const doc = outboxCollection.findOne({ 'data.id': id });
  if (!doc) {
    return false;
  }
  outboxCollection.remove(doc);
  return true;
}

export function purgeTerminalOutboxEntriesOlderThan(cutoffIso: string): number {
  if (!outboxCollection) {
    return 0;
  }
  const terminalEntries = outboxCollection.find({ 'data.status': { $ne: 'pending' } });
  const toRemove = terminalEntries.filter((doc) => {
    const entry = doc.data;
    const timestamp = entry.deliveredAt ?? entry.failedAt;
    return Boolean(timestamp) && timestamp! < cutoffIso;
  });
  for (const doc of toRemove) {
    outboxCollection.remove(doc);
  }
  return toRemove.length;
}

export function _resetOutboxStoreForTests(): void {
  outboxCollection = undefined;
}
