/**
 * Audit trail store. One row per event in the `audit` table (roadmap
 * 7-STORE, slice 5).
 *
 * `timestamp_ms` is NOT NULL in the schema and is always computed at insert
 * time, so the old dual chain/fallback read paths and the startup
 * `migrateMissingTimestampIndex` backfill collapse to plain SQL: filtering,
 * sorting and pagination are all one indexed query. A document imported from
 * a pre-1.8 `dd.json` that was missing `timestampMs` gets it filled in once,
 * by the audit importer (`store/db/importers/audit.ts`), not here.
 *
 * The hourly prune timer stays: entries older than the retention window are
 * swept on every collection init, every 100 inserts, and once an hour in the
 * background regardless of insert volume.
 */
import crypto from 'node:crypto';
import logger from '../log/index.js';
import type { AuditEntry } from '../model/audit.js';
import { daysToMs } from '../model/maturity-policy.js';
import { toPositiveInteger } from '../util/parse.js';
import { getAuditActor, getAuditActorRole } from './audit-actor.js';
import type { Database, Row, SqlBinding } from './db/driver.js';

const log = logger.child({ component: 'store.audit' });

const DEFAULT_AUDIT_RETENTION_DAYS = 30;
const MAX_AUDIT_RETENTION_DAYS = 3650;
/** Query value that selects rows with no human or key behind them. */
const SYSTEM_ACTOR = 'system';
const AUDIT_PRUNE_INSERT_INTERVAL = 100;
const AUDIT_PRUNE_TIMER_INTERVAL_MS = 60 * 60 * 1000;

let db: Database | undefined;
let auditInsertsSincePrune = 0;
let auditPruneTimer: ReturnType<typeof setInterval> | undefined;

type GetAuditEntriesQuery = {
  action?: string;
  actions?: string[];
  container?: string;
  actor?: string;
  from?: string;
  to?: string;
  skip?: number;
  limit?: number;
};

/**
 * Days to keep audit rows, from DD_AUDIT_RETENTION_DAYS. Anything that is not a
 * whole number from 1 to 3650 falls back to the 30-day default, so a typo can't
 * silently disable pruning or wipe the log. `invalid` lets startup say so once.
 */
function readRetention(): { days: number; invalid: boolean } {
  const rawValue = process.env.DD_AUDIT_RETENTION_DAYS;
  if (rawValue === undefined || rawValue.trim() === '') {
    return { days: DEFAULT_AUDIT_RETENTION_DAYS, invalid: false };
  }
  const days = toPositiveInteger(rawValue, Number.NaN);
  if (Number.isNaN(days) || days > MAX_AUDIT_RETENTION_DAYS) {
    return { days: DEFAULT_AUDIT_RETENTION_DAYS, invalid: true };
  }
  return { days, invalid: false };
}

function getAuditRetentionDays(): number {
  return readRetention().days;
}

function toTimestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
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

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function rowToEntry(row: Row): AuditEntry {
  return {
    id: String(row.id),
    timestamp: String(row.timestamp),
    action: row.action as AuditEntry['action'],
    containerName: String(row.container_name),
    containerIdentityKey: optionalString(row.container_identity_key),
    containerImage: optionalString(row.container_image),
    fromVersion: optionalString(row.from_version),
    toVersion: optionalString(row.to_version),
    updateKind: optionalString(row.update_kind) as AuditEntry['updateKind'],
    semverDiff: optionalString(row.semver_diff) as AuditEntry['semverDiff'],
    triggerName: optionalString(row.trigger_name),
    status: row.status as AuditEntry['status'],
    details: optionalString(row.details),
    actor: optionalString(row.actor),
    actorRole: optionalString(row.actor_role),
  };
}

function buildWhereClause(
  query: GetAuditEntriesQuery,
  fromDate?: number,
  toDate?: number,
): { clause: string; params: SqlBinding[] } {
  const conditions: string[] = [];
  const params: SqlBinding[] = [];

  if (query.action) {
    conditions.push('action = ?');
    params.push(query.action);
  } else if (query.actions && query.actions.length > 0) {
    // Deduped, preserving first-seen order: a repeated action would
    // otherwise inflate the placeholder count without bound, and each
    // distinct length becomes its own cached prepared statement. The
    // caller (app/api/audit.ts) already validates every value against the
    // fixed AuditEntry action union, so deduping here bounds both the
    // placeholders and the statement variants by the size of that set.
    const actions = [...new Set(query.actions)];
    conditions.push(`action IN (${actions.map(() => '?').join(', ')})`);
    params.push(...actions);
  }
  if (query.container) {
    conditions.push('container_name = ?');
    params.push(query.container);
  }
  if (query.actor === SYSTEM_ACTOR) {
    conditions.push('(actor IS NULL OR actor = ?)');
    params.push(SYSTEM_ACTOR);
  } else if (query.actor) {
    conditions.push('actor = ?');
    params.push(query.actor);
  }
  if (fromDate !== undefined) {
    conditions.push('timestamp_ms >= ?');
    params.push(fromDate);
  }
  if (toDate !== undefined) {
    conditions.push('timestamp_ms <= ?');
    params.push(toDate);
  }

  return {
    clause: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
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
    pruneOldEntries(getAuditRetentionDays());
    auditInsertsSincePrune = 0;
  }, AUDIT_PRUNE_TIMER_INTERVAL_MS);

  if (typeof (auditPruneTimer as { unref?: () => void }).unref === 'function') {
    (auditPruneTimer as { unref: () => void }).unref();
  }
}

/**
 * Wire the audit store to the shared SQLite database. Schema creation is the
 * migration runner's job; this only captures the handle and starts the
 * background prune timer.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
  auditInsertsSincePrune = 0;
  if (readRetention().invalid) {
    log.warn(
      `Invalid DD_AUDIT_RETENTION_DAYS value; expected a whole number of days from 1 to ${MAX_AUDIT_RETENTION_DAYS}, using ${DEFAULT_AUDIT_RETENTION_DAYS}`,
    );
  }
  pruneOldEntries(getAuditRetentionDays());
  startPeriodicPruneTimer();
}

/**
 * Insert a new audit entry.
 * @param entry
 */
export function insertAudit(entry: AuditEntry): AuditEntry {
  const timestamp = entry.timestamp || new Date().toISOString();
  const actor = entry.actor ?? getAuditActor();
  // The bound role belongs to the bound actor. An entry that names its own actor
  // (a login, before any principal exists) never inherits someone else's role.
  const actorRole =
    entry.actorRole ?? (entry.actor === undefined ? getAuditActorRole() : undefined);
  const entryToSave: AuditEntry = {
    ...entry,
    id: entry.id || crypto.randomUUID(),
    timestamp,
    ...(actor !== undefined ? { actor } : {}),
    ...(actorRole !== undefined ? { actorRole } : {}),
  };

  if (db) {
    db.prepare(
      `INSERT INTO audit
         (id, timestamp, timestamp_ms, action, container_name, container_identity_key, container_image, from_version, to_version, update_kind, semver_diff, trigger_name, status, details, actor, actor_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entryToSave.id,
      entryToSave.timestamp,
      toTimestampMs(timestamp),
      entryToSave.action,
      entryToSave.containerName,
      entryToSave.containerIdentityKey ?? null,
      entryToSave.containerImage ?? null,
      entryToSave.fromVersion ?? null,
      entryToSave.toVersion ?? null,
      entryToSave.updateKind ?? null,
      entryToSave.semverDiff ?? null,
      entryToSave.triggerName ?? null,
      entryToSave.status,
      entryToSave.details ?? null,
      entryToSave.actor ?? null,
      entryToSave.actorRole ?? null,
    );
    auditInsertsSincePrune += 1;
    if (auditInsertsSincePrune >= AUDIT_PRUNE_INSERT_INTERVAL) {
      pruneOldEntries(getAuditRetentionDays());
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
  if (!db) {
    return { entries: [], total: 0 };
  }

  const fromDate = parseQueryTimestamp(query.from);
  const toDate = parseQueryTimestamp(query.to);
  if (hasInvalidDateRange(fromDate, toDate)) {
    return { entries: [], total: 0 };
  }

  const { clause, params } = buildWhereClause(query, fromDate, toDate);
  // COUNT(*) always returns exactly one row with a numeric count, even when
  // nothing matches, so there is no undefined-row or nullish-count case to
  // fall back from.
  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM audit${clause}`).get(...params) as Row;
  const total = Number(totalRow.count);

  const skip = query.skip || 0;
  const limit = query.limit || 50;
  const rows = db
    .prepare(`SELECT * FROM audit${clause} ORDER BY timestamp_ms DESC, rowid ASC LIMIT ? OFFSET ?`)
    .all(...params, limit, skip);

  return { entries: rows.map(rowToEntry), total };
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
  if (!db) {
    return 0;
  }
  const cutoff = Date.now() - daysToMs(days);
  const result = db.prepare('DELETE FROM audit WHERE timestamp_ms < ?').run(cutoff);
  return result.changes;
}
