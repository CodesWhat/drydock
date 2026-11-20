/**
 * Ad-hoc notification silences.
 *
 * A silence mutes one notification rule (or every rule when `ruleId` is absent) until
 * `expiresAt`. They are short-lived operator actions, so they live as one JSON document in
 * `store_metadata` rather than in a table of their own, and are read through an in-memory
 * list that drops expired entries as it goes.
 */
import crypto from 'node:crypto';
import type { Database } from './db/driver.js';
import { readStoreMetadata, writeStoreMetadata } from './db/import.js';

const SILENCES_METADATA_KEY = 'notification-silences';
export const MAX_NOTIFICATION_SILENCES = 100;

export interface NotificationSilence {
  id: string;
  /** Absent for a global silence. */
  ruleId?: string;
  reason?: string;
  createdAt: string;
  expiresAt: string;
  createdBy?: string;
}

export interface NewNotificationSilence {
  ruleId?: string;
  reason?: string;
  createdBy?: string;
  expiresAt: Date;
}

let db: Database | undefined;
let silences: NotificationSilence[] = [];

function isStoredSilence(candidate: unknown): candidate is NotificationSilence {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(record.expiresAt)) &&
    (record.ruleId === undefined || typeof record.ruleId === 'string')
  );
}

function persist(): void {
  if (db) {
    writeStoreMetadata(db, SILENCES_METADATA_KEY, JSON.stringify(silences));
  }
}

/** Wire the store to the shared database and load whatever silences survived a restart. */
export function createCollections(database: Database): void {
  db = database;
  silences = [];
  const stored = readStoreMetadata(database, SILENCES_METADATA_KEY);
  if (stored === undefined) {
    return;
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    silences = Array.isArray(parsed) ? parsed.filter(isStoredSilence) : [];
  } catch {
    silences = [];
  }
}

function pruneExpired(now: number): void {
  const remaining = silences.filter((silence) => Date.parse(silence.expiresAt) > now);
  if (remaining.length !== silences.length) {
    silences = remaining;
    persist();
  }
}

/** Active silences, soonest-expiring first. */
export function getActiveSilences(now: number = Date.now()): NotificationSilence[] {
  pruneExpired(now);
  return silences
    .map((silence) => ({ ...silence }))
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
}

/**
 * The silence that mutes `ruleId`, if any. A rule-scoped silence always matches its own
 * rule. A global silence matches every rule unless `respectGlobal` is false (an exempt rule).
 */
export function findMatchingSilence(
  ruleId: string,
  options: { respectGlobal: boolean },
  now: number = Date.now(),
): NotificationSilence | undefined {
  pruneExpired(now);
  return (
    silences.find((silence) => silence.ruleId === ruleId) ??
    (options.respectGlobal ? silences.find((silence) => silence.ruleId === undefined) : undefined)
  );
}

/** Add a silence. Throws when the cap is reached so the list cannot grow without bound. */
export function addSilence(
  input: NewNotificationSilence,
  now: number = Date.now(),
): NotificationSilence {
  pruneExpired(now);
  if (silences.length >= MAX_NOTIFICATION_SILENCES) {
    throw new Error(`At most ${MAX_NOTIFICATION_SILENCES} notification silences can be active`);
  }
  const silence: NotificationSilence = {
    id: crypto.randomUUID(),
    ...(input.ruleId !== undefined ? { ruleId: input.ruleId } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    createdAt: new Date(now).toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    ...(input.createdBy !== undefined ? { createdBy: input.createdBy } : {}),
  };
  silences.push(silence);
  persist();
  return { ...silence };
}

/** Remove a silence by id. Returns it, or `undefined` when no such active silence exists. */
export function removeSilence(
  id: string,
  now: number = Date.now(),
): NotificationSilence | undefined {
  pruneExpired(now);
  const index = silences.findIndex((silence) => silence.id === id);
  if (index === -1) {
    return undefined;
  }
  const [removed] = silences.splice(index, 1);
  persist();
  return removed;
}

export function resetSilencesForTests(): void {
  db = undefined;
  silences = [];
}
