import crypto from 'node:crypto';
import type { AuditEntry } from '../model/audit.js';
import { initCollection } from './util.js';

let auditCollection;
const AUDIT_COLLECTION_INDICES = ['data.action', 'data.timestamp', 'timestampMs'];
const AUDIT_RETENTION_DAYS = 30;
const AUDIT_PRUNE_INSERT_INTERVAL = 100;
let auditInsertsSincePrune = 0;

type AuditCollectionEntry = {
  data: AuditEntry;
  timestampMs?: number;
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

/**
 * Create audit collections.
 * @param db
 */
export function createCollections(db) {
  auditCollection = initCollection(db, 'audit', { indices: AUDIT_COLLECTION_INDICES });
  auditInsertsSincePrune = 0;
  migrateMissingTimestampIndex();
  pruneOldEntries(AUDIT_RETENTION_DAYS);
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
export function getAuditEntries(
  query: {
    action?: string;
    container?: string;
    from?: string;
    to?: string;
    skip?: number;
    limit?: number;
  } = {},
): { entries: AuditEntry[]; total: number } {
  if (!auditCollection) {
    return { entries: [], total: 0 };
  }

  const fromDate = parseQueryTimestamp(query.from);
  const toDate = parseQueryTimestamp(query.to);
  if (Number.isNaN(fromDate) || Number.isNaN(toDate)) {
    return { entries: [], total: 0 };
  }

  const collectionQuery: Record<string, string> = {};
  if (query.action) {
    collectionQuery['data.action'] = query.action;
  }
  if (query.container) {
    collectionQuery['data.containerName'] = query.container;
  }

  if (typeof auditCollection.chain === 'function') {
    let chainedResults = auditCollection.chain().find(collectionQuery);

    if (fromDate !== undefined || toDate !== undefined) {
      const timestampRangeQuery: Record<string, number> = {};
      if (fromDate !== undefined) {
        timestampRangeQuery.$gte = fromDate;
      }
      if (toDate !== undefined) {
        timestampRangeQuery.$lte = toDate;
      }
      chainedResults = chainedResults.find({ timestampMs: timestampRangeQuery });
    }

    if (
      typeof chainedResults.simplesort === 'function' &&
      typeof chainedResults.data === 'function'
    ) {
      const results = chainedResults
        .simplesort('timestampMs', true)
        .data() as AuditCollectionEntry[];
      return paginateAuditEntries(results, query.skip || 0, query.limit || 50);
    }
  }

  let results = auditCollection.find(collectionQuery) as AuditCollectionEntry[];
  if (fromDate !== undefined) {
    results = results.filter((entry) => ensureTimestampMs(entry) >= fromDate);
  }
  if (toDate !== undefined) {
    results = results.filter((entry) => ensureTimestampMs(entry) <= toDate);
  }

  // Sort newest first.
  results.sort((a, b) => ensureTimestampMs(b) - ensureTimestampMs(a));

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

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries = auditCollection.find();
  if (!Array.isArray(entries)) {
    return 0;
  }

  const toRemove = entries.filter((item: AuditCollectionEntry) => ensureTimestampMs(item) < cutoff);
  const count = toRemove.length;
  toRemove.forEach((item) => auditCollection.remove(item));

  return count;
}
