import crypto from 'node:crypto';
import type { AuditEntry } from '../model/audit.js';
import { daysToMs } from '../model/maturity-policy.js';
import { initCollection } from './util.js';

let auditCollection;
const AUDIT_COLLECTION_INDICES = ['data.action', 'data.timestamp', 'timestampMs'];
const AUDIT_RETENTION_DAYS = 30;
const AUDIT_PRUNE_INSERT_INTERVAL = 100;
const AUDIT_PRUNE_TIMER_INTERVAL_MS = 60 * 60 * 1000;
let auditInsertsSincePrune = 0;
let auditPruneTimer: ReturnType<typeof setInterval> | undefined;

type AuditCollectionEntry = {
  data: AuditEntry;
  timestampMs?: number;
};

type GetAuditEntriesQuery = {
  action?: string;
  actions?: string[];
  container?: string;
  from?: string;
  to?: string;
  skip?: number;
  limit?: number;
};

function toTimestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function ensureTimestampMs(entry: AuditCollectionEntry): number {
  if (typeof entry.timestampMs === 'number') {
    return entry.timestampMs;
  }

  const timestampMs = toTimestampMs(entry.data.timestamp);
  entry.timestampMs = timestampMs;
  if (typeof auditCollection?.update === 'function') {
    auditCollection.update(entry);
  }

  return timestampMs;
}

function parseQueryTimestamp(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  return Date.parse(value);
}

function hasInvalidDateRange(fromDate?: number, toDate?: number): boolean {
  return Number.isNaN(fromDate) || Number.isNaN(toDate);
}

function buildCollectionQuery(query: GetAuditEntriesQuery): Record<string, unknown> {
  const collectionQuery: Record<string, unknown> = {};
  if (query.action) {
    collectionQuery['data.action'] = query.action;
  } else if (query.actions && query.actions.length > 0) {
    collectionQuery['data.action'] = { $in: query.actions };
  }
  if (query.container) {
    collectionQuery['data.containerName'] = query.container;
  }
  return collectionQuery;
}

function buildTimestampRangeQuery(
  fromDate?: number,
  toDate?: number,
): { $gte?: number; $lte?: number } | undefined {
  if (fromDate === undefined && toDate === undefined) {
    return undefined;
  }

  const timestampRangeQuery: { $gte?: number; $lte?: number } = {};
  if (fromDate !== undefined) {
    timestampRangeQuery.$gte = fromDate;
  }
  if (toDate !== undefined) {
    timestampRangeQuery.$lte = toDate;
  }

  return timestampRangeQuery;
}

function getChainedAuditEntries(
  collectionQuery: Record<string, unknown>,
  fromDate?: number,
  toDate?: number,
): AuditCollectionEntry[] | undefined {
  if (typeof auditCollection?.chain !== 'function') {
    return undefined;
  }

  let chainedResults = auditCollection.chain().find(collectionQuery);
  const timestampRangeQuery = buildTimestampRangeQuery(fromDate, toDate);
  if (timestampRangeQuery) {
    chainedResults = chainedResults.find({ timestampMs: timestampRangeQuery });
  }

  if (
    typeof chainedResults.simplesort !== 'function' ||
    typeof chainedResults.data !== 'function'
  ) {
    return undefined;
  }

  return chainedResults.simplesort('timestampMs', true).data() as AuditCollectionEntry[];
}

function applyDateFilters(
  entries: AuditCollectionEntry[],
  fromDate?: number,
  toDate?: number,
): AuditCollectionEntry[] {
  return entries.filter((entry) => {
    const timestampMs = ensureTimestampMs(entry);
    if (fromDate !== undefined && timestampMs < fromDate) {
      return false;
    }
    if (toDate !== undefined && timestampMs > toDate) {
      return false;
    }
    return true;
  });
}

function getFallbackAuditEntries(
  collectionQuery: Record<string, unknown>,
  fromDate?: number,
  toDate?: number,
): AuditCollectionEntry[] {
  const entries = auditCollection.find(collectionQuery) as AuditCollectionEntry[];
  const filteredEntries = applyDateFilters(entries, fromDate, toDate);

  filteredEntries.sort((a, b) => ensureTimestampMs(b) - ensureTimestampMs(a));
  return filteredEntries;
}

function paginateAuditEntries(
  entries: AuditCollectionEntry[],
  skip = 0,
  limit = 50,
): { entries: AuditEntry[]; total: number } {
  const total = entries.length;
  const paginatedEntries = entries
    .slice(skip, skip + limit)
    .map((entry) => entry.data as AuditEntry);

  return { entries: paginatedEntries, total };
}

function migrateMissingTimestampIndex() {
  if (!auditCollection || typeof auditCollection.find !== 'function') {
    return;
  }

  const entries = auditCollection.find();
  if (!Array.isArray(entries)) {
    return;
  }

  entries.forEach((entry) => {
    ensureTimestampMs(entry as AuditCollectionEntry);
  });
}

function stopPeriodicPruneTimer() {
  if (auditPruneTimer !== undefined) {
    clearInterval(auditPruneTimer);
    auditPruneTimer = undefined;
  }
}

function startPeriodicPruneTimer() {
  stopPeriodicPruneTimer();
  auditPruneTimer = setInterval(() => {
    pruneOldEntries(AUDIT_RETENTION_DAYS);
    auditInsertsSincePrune = 0;
  }, AUDIT_PRUNE_TIMER_INTERVAL_MS);

  if (typeof (auditPruneTimer as { unref?: () => void }).unref === 'function') {
    (auditPruneTimer as { unref: () => void }).unref();
  }
}

/**
 * Create audit collections.
 * @param db
 */
export function createCollections(db) {
  auditCollection = initCollection(db, 'audit', { indices: AUDIT_COLLECTION_INDICES });
  auditInsertsSincePrune = 0;
  migrateMissingTimestampIndex();
  pruneOldEntries(AUDIT_RETENTION_DAYS);
  startPeriodicPruneTimer();
}

/**
 * Insert a new audit entry.
 * @param entry
 */
export function insertAudit(entry: AuditEntry): AuditEntry {
  const timestamp = entry.timestamp || new Date().toISOString();
  const entryToSave: AuditEntry = {
    ...entry,
    id: entry.id || crypto.randomUUID(),
    timestamp,
  };

  if (auditCollection) {
    auditCollection.insert({ data: entryToSave, timestampMs: toTimestampMs(timestamp) });
    auditInsertsSincePrune += 1;
    if (auditInsertsSincePrune >= AUDIT_PRUNE_INSERT_INTERVAL) {
      pruneOldEntries(AUDIT_RETENTION_DAYS);
      auditInsertsSincePrune = 0;
    }
  }

  return entryToSave;
}

/**
 * Get audit entries with optional filtering and pagination.
 * @param query
 */
export function getAuditEntries(query: GetAuditEntriesQuery = {}): {
  entries: AuditEntry[];
  total: number;
} {
  if (!auditCollection) {
    return { entries: [], total: 0 };
  }

  const fromDate = parseQueryTimestamp(query.from);
  const toDate = parseQueryTimestamp(query.to);
  if (hasInvalidDateRange(fromDate, toDate)) {
    return { entries: [], total: 0 };
  }

  const collectionQuery = buildCollectionQuery(query);
  const results =
    getChainedAuditEntries(collectionQuery, fromDate, toDate) ??
    getFallbackAuditEntries(collectionQuery, fromDate, toDate);
  return paginateAuditEntries(results, query.skip || 0, query.limit || 50);
}

/**
 * Get the N most recent audit entries.
 * @param limit
 */
export function getRecentEntries(limit: number): AuditEntry[] {
  return getAuditEntries({ limit }).entries;
}

/**
 * Remove audit entries older than N days.
 * @param days
 */
export function pruneOldEntries(days: number): number {
  if (!auditCollection || typeof auditCollection.find !== 'function') {
    return 0;
  }

  const cutoff = Date.now() - daysToMs(days);
  if (typeof auditCollection.chain === 'function') {
    const chained = auditCollection.chain().find({
      timestampMs: { $lt: cutoff },
    });

    if (typeof chained?.data === 'function' && typeof chained?.remove === 'function') {
      const toRemove = chained.data() as AuditCollectionEntry[];
      const count = Array.isArray(toRemove) ? toRemove.length : 0;
      if (count > 0) {
        chained.remove();
      }
      return count;
    }
  }

  const entries = auditCollection.find();
  if (!Array.isArray(entries)) {
    return 0;
  }

  const toRemove = entries.filter((item: AuditCollectionEntry) => ensureTimestampMs(item) < cutoff);
  const count = toRemove.length;
  toRemove.forEach((item) => auditCollection.remove(item));

  return count;
}
