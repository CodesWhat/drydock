import crypto from 'node:crypto';
import type { AuditEntry } from '../model/audit.js';
import { initCollection } from './util.js';

let auditCollection;
const AUDIT_COLLECTION_INDICES = ['data.action', 'data.timestamp'];

/**
 * Create audit collections.
 * @param db
 */
export function createCollections(db) {
  auditCollection = initCollection(db, 'audit', { indices: AUDIT_COLLECTION_INDICES });
}

/**
 * Insert a new audit entry.
 * @param entry
 */
export function insertAudit(entry: AuditEntry): AuditEntry {
  const entryToSave: AuditEntry = {
    ...entry,
    id: entry.id || crypto.randomUUID(),
    timestamp: entry.timestamp || new Date().toISOString(),
  };
  if (auditCollection) {
    auditCollection.insert({ data: entryToSave });
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

  const collectionQuery: Record<string, string> = {};
  if (query.action) {
    collectionQuery['data.action'] = query.action;
  }
  if (query.container) {
    collectionQuery['data.containerName'] = query.container;
  }

  let results = auditCollection.find(collectionQuery);

  if (query.from) {
    const fromDate = new Date(query.from).getTime();
    results = results.filter((entry) => new Date(entry.data.timestamp).getTime() >= fromDate);
  }
  if (query.to) {
    const toDate = new Date(query.to).getTime();
    results = results.filter((entry) => new Date(entry.data.timestamp).getTime() <= toDate);
  }

  // Sort newest first
  results.sort(
    (a, b) => new Date(b.data.timestamp).getTime() - new Date(a.data.timestamp).getTime(),
  );

  const total = results.length;
  const skip = query.skip || 0;
  const limit = query.limit || 50;
  const entries = results.slice(skip, skip + limit).map((entry) => entry.data as AuditEntry);

  return { entries, total };
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
  if (!auditCollection) {
    return 0;
  }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const toRemove = auditCollection.find().filter((item) => item.data.timestamp < cutoff);
  const count = toRemove.length;
  toRemove.forEach((item) => auditCollection.remove(item));
  return count;
}
