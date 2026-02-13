import crypto from 'node:crypto';
import type { AuditEntry } from '../model/audit.js';
import { initCollection } from './util.js';

var auditCollection;

/**
 * Create audit collections.
 * @param db
 */
export function createCollections(db) {
  auditCollection = initCollection(db, 'audit');
}

/**
 * Insert a new audit entry.
 * @param entry
 */
export function insertAudit(entry: AuditEntry): AuditEntry {
  var entryToSave: AuditEntry = {
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

  var results = auditCollection.find().map((item) => item.data as AuditEntry);

  if (query.action) {
    results = results.filter((e) => e.action === query.action);
  }
  if (query.container) {
    results = results.filter((e) => e.containerName === query.container);
  }
  if (query.from) {
    const fromDate = new Date(query.from).getTime();
    results = results.filter((e) => new Date(e.timestamp).getTime() >= fromDate);
  }
  if (query.to) {
    const toDate = new Date(query.to).getTime();
    results = results.filter((e) => new Date(e.timestamp).getTime() <= toDate);
  }

  // Sort newest first
  results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  var total = results.length;
  var skip = query.skip || 0;
  var limit = query.limit || 50;
  var entries = results.slice(skip, skip + limit);

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
  var cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  var toRemove = auditCollection.find().filter((item) => item.data.timestamp < cutoff);
  var count = toRemove.length;
  toRemove.forEach((item) => auditCollection.remove(item));
  return count;
}
