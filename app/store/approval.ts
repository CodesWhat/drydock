/**
 * Approval ledger store (spec-ca-2-approval-queue.md, slice 1; moved onto
 * SQLite at roadmap 7-STORE, slice 6).
 *
 * Backed by the `approvals` table: one row per `(containerId, candidateRef)`,
 * with `UNIQUE (container_id, candidate_ref)` enforcing the store's one-row
 * invariant instead of a pre-insert scan. Every field is a scalar column —
 * `agent-keys.ts` (flat) and `ui-preferences.ts` (`schemaVersion`) were the
 * shape precedents before the migration, and the table keeps that shape
 * exactly.
 *
 * The ledger stores the decision; the candidate set stays derived. Nothing
 * live — soft blockers, eligibility, release-notes body, current
 * vulnerability counts — is frozen into a row.
 *
 * The ledger must never be written through `store/container.ts`'s
 * `updateContainer()`, so it does not inherit that collection's full-record
 * write-clobbering bug.
 */
import crypto from 'node:crypto';
import {
  APPROVAL_SCHEMA_VERSION,
  type ApprovalRecord,
  type ApprovalRecordInput,
  type ApprovalSemverDiff,
  isApprovalPending,
} from '../model/approval.js';
import { daysToMs } from '../model/maturity-policy.js';
import type { Database, Row, SqlBinding } from './db/driver.js';

const APPROVAL_RETENTION_DAYS = 30;
export const APPROVAL_PRUNE_INSERT_INTERVAL = 100;
const APPROVAL_PRUNE_TIMER_INTERVAL_MS = 60 * 60 * 1000;

/** Every field a decision may write. Anything outside this set is ignored by a patch. */
const APPROVAL_MUTABLE_FIELDS = [
  'decision',
  'decidedAt',
  'decidedBy',
  'decisionNote',
  'deferredUntil',
  'operationId',
  'outcome',
  'resolvedAt',
  'resolution',
] as const;

/**
 * The fields a human decision writes. Cleared before a decision is applied and before a
 * snapshot is restored, so neither operation can leave a field the row it produced does
 * not name. `outcome`, `resolvedAt` and `resolution` are deliberately absent: they
 * describe what happened to the row rather than what an operator chose, and a row carrying
 * them is not pending, so no decision or reservation can ever be holding them.
 */
const APPROVAL_DECISION_FIELDS = [
  'decidedAt',
  'decidedBy',
  'decisionNote',
  'deferredUntil',
  'operationId',
] as const;

type ApprovalMutableField = (typeof APPROVAL_MUTABLE_FIELDS)[number];

/** Column name for every mutable field, so a patch can be turned into a `SET` clause. */
const APPROVAL_COLUMN_BY_FIELD: Record<ApprovalMutableField, string> = {
  decision: 'decision',
  decidedAt: 'decided_at',
  decidedBy: 'decided_by',
  decisionNote: 'decision_note',
  deferredUntil: 'deferred_until',
  operationId: 'operation_id',
  outcome: 'outcome',
  resolvedAt: 'resolved_at',
  resolution: 'resolution',
};

const APPROVAL_OTHER_MUTABLE_FIELDS = APPROVAL_MUTABLE_FIELDS.filter(
  (field): field is Exclude<ApprovalMutableField, (typeof APPROVAL_DECISION_FIELDS)[number]> =>
    !(APPROVAL_DECISION_FIELDS as readonly string[]).includes(field),
);

export type ApprovalStatusFilter = 'pending' | 'deferred' | 'decided' | 'all';

export interface ListApprovalsQuery {
  status?: ApprovalStatusFilter;
  containerId?: string;
  agent?: string;
  semverDiff?: ApprovalSemverDiff;
  q?: string;
  limit?: number;
  offset?: number;
  now?: number;
}

export interface ApprovalCounts {
  pending: number;
  deferred: number;
  decidedToday: number;
}

export type ApprovalPatch = Partial<Pick<ApprovalRecord, (typeof APPROVAL_MUTABLE_FIELDS)[number]>>;

/**
 * The outcome of a compare-and-set on a row's semantic pending state.
 *
 * `already-decided` carries the row that won, so a caller can answer 409 while still
 * reporting who holds the decision.
 */
export type ApprovalDecisionTransition =
  | { status: 'decided'; record: ApprovalRecord }
  | { status: 'already-decided'; record: ApprovalRecord }
  | { status: 'not-found' };

let db: Database | undefined;
let approvalInsertsSincePrune = 0;
let approvalPruneTimer: ReturnType<typeof setInterval> | undefined;

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

/**
 * Copy the fields present on a row onto a record, one key at a time, so an absent
 * (NULL) column is an absent property rather than an explicit `undefined` one — the
 * same contract `copyDefinedFields` gave the LokiJS-era document.
 */
function rowToRecord(row: Row): ApprovalRecord {
  const record: ApprovalRecord = {
    schemaVersion: Number(row.schema_version),
    id: String(row.id),
    containerId: String(row.container_id),
    containerIdentityKey: String(row.container_identity_key),
    containerName: String(row.container_name),
    watcher: String(row.watcher),
    image: String(row.image),
    fromRef: String(row.from_ref),
    toRef: String(row.to_ref),
    candidateRef: String(row.candidate_ref),
    updateKind: row.update_kind as ApprovalRecord['updateKind'],
    semverDiff: row.semver_diff as ApprovalSemverDiff,
    createdAt: String(row.created_at),
    createdAtMs: Number(row.created_at_ms),
    decision: row.decision as ApprovalRecord['decision'],
  };

  const agent = optionalString(row.agent);
  if (agent !== undefined) record.agent = agent;
  const releaseNotesUrl = optionalString(row.release_notes_url);
  if (releaseNotesUrl !== undefined) record.releaseNotesUrl = releaseNotesUrl;
  const scanCritical = optionalNumber(row.scan_critical);
  if (scanCritical !== undefined) record.scanCritical = scanCritical;
  const scanHigh = optionalNumber(row.scan_high);
  if (scanHigh !== undefined) record.scanHigh = scanHigh;
  const scanMedium = optionalNumber(row.scan_medium);
  if (scanMedium !== undefined) record.scanMedium = scanMedium;
  const scanLow = optionalNumber(row.scan_low);
  if (scanLow !== undefined) record.scanLow = scanLow;
  const scanUnknown = optionalNumber(row.scan_unknown);
  if (scanUnknown !== undefined) record.scanUnknown = scanUnknown;
  const scanAt = optionalString(row.scan_at);
  if (scanAt !== undefined) record.scanAt = scanAt;
  const decidedAt = optionalString(row.decided_at);
  if (decidedAt !== undefined) record.decidedAt = decidedAt;
  const decidedBy = optionalString(row.decided_by);
  if (decidedBy !== undefined) record.decidedBy = decidedBy;
  const decisionNote = optionalString(row.decision_note);
  if (decisionNote !== undefined) record.decisionNote = decisionNote;
  const deferredUntil = optionalString(row.deferred_until);
  if (deferredUntil !== undefined) record.deferredUntil = deferredUntil;
  const operationId = optionalString(row.operation_id);
  if (operationId !== undefined) record.operationId = operationId;
  const outcome = optionalString(row.outcome);
  if (outcome !== undefined) record.outcome = outcome as ApprovalRecord['outcome'];
  const resolvedAt = optionalString(row.resolved_at);
  if (resolvedAt !== undefined) record.resolvedAt = resolvedAt;
  const resolution = optionalString(row.resolution);
  if (resolution !== undefined) record.resolution = resolution as ApprovalRecord['resolution'];

  return record;
}

function stopPeriodicPruneTimer(): void {
  if (approvalPruneTimer !== undefined) {
    clearInterval(approvalPruneTimer);
    approvalPruneTimer = undefined;
  }
}

function startPeriodicPruneTimer(): void {
  stopPeriodicPruneTimer();
  approvalPruneTimer = setInterval(() => {
    pruneOldApprovals(APPROVAL_RETENTION_DAYS);
    approvalInsertsSincePrune = 0;
  }, APPROVAL_PRUNE_TIMER_INTERVAL_MS);

  if (typeof (approvalPruneTimer as { unref?: () => void }).unref === 'function') {
    (approvalPruneTimer as { unref: () => void }).unref();
  }
}

/**
 * Wire the approvals store to the shared SQLite database. Schema creation is
 * the migration runner's job; this only captures the handle and starts the
 * background prune timer.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
  approvalInsertsSincePrune = 0;
  pruneOldApprovals(APPROVAL_RETENTION_DAYS);
  startPeriodicPruneTimer();
}

/**
 * Insert a pending row for a newly sighted candidate. The store enforces one row per
 * `(containerId, candidateRef)` so decided and resolved history cannot be duplicated.
 * @param input
 * @param options
 */
export function insertApproval(
  input: ApprovalRecordInput,
  options: { now?: number } = {},
): ApprovalRecord {
  if (!db) {
    throw new Error('approvals collection not initialized');
  }
  const database = db;

  const existing = database
    .prepare('SELECT * FROM approvals WHERE container_id = ? AND candidate_ref = ?')
    .get(input.containerId, input.candidateRef);
  if (existing) {
    return rowToRecord(existing);
  }

  const createdAtMs = options.now ?? Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  const id = crypto.randomUUID();

  database
    .prepare(
      `INSERT INTO approvals
         (id, schema_version, container_id, container_identity_key, container_name, watcher, agent,
          image, from_ref, to_ref, candidate_ref, update_kind, semver_diff, release_notes_url,
          scan_critical, scan_high, scan_medium, scan_low, scan_unknown, scan_at,
          created_at, created_at_ms, decision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      APPROVAL_SCHEMA_VERSION,
      input.containerId,
      input.containerIdentityKey,
      input.containerName,
      input.watcher,
      input.agent ?? null,
      input.image,
      input.fromRef,
      input.toRef,
      input.candidateRef,
      input.updateKind,
      input.semverDiff,
      input.releaseNotesUrl ?? null,
      input.scanCritical ?? null,
      input.scanHigh ?? null,
      input.scanMedium ?? null,
      input.scanLow ?? null,
      input.scanUnknown ?? null,
      input.scanAt ?? null,
      createdAt,
      createdAtMs,
      'pending',
    );

  approvalInsertsSincePrune += 1;
  if (approvalInsertsSincePrune >= APPROVAL_PRUNE_INSERT_INTERVAL) {
    pruneOldApprovals(APPROVAL_RETENTION_DAYS);
    approvalInsertsSincePrune = 0;
  }

  return getApprovalById(id) as ApprovalRecord;
}

/**
 * Look a row up by its primary key.
 * @param id
 */
export function getApprovalById(id: string): ApprovalRecord | undefined {
  if (!db) {
    return undefined;
  }
  const row = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
  return row ? rowToRecord(row) : undefined;
}

/**
 * Every row for a container, newest first. The reconciler reads this to decide between
 * insert, supersede and withdraw.
 * @param containerId
 */
export function findApprovalsByContainerId(containerId: string): ApprovalRecord[] {
  if (!db) {
    return [];
  }
  return db
    .prepare('SELECT * FROM approvals WHERE container_id = ? ORDER BY created_at_ms DESC')
    .all(containerId)
    .map(rowToRecord);
}

export function findApprovalByContainerAndCandidate(
  containerId: string,
  candidateRef: string,
): ApprovalRecord | undefined {
  if (!db) {
    return undefined;
  }
  const row = db
    .prepare('SELECT * FROM approvals WHERE container_id = ? AND candidate_ref = ?')
    .get(containerId, candidateRef);
  return row ? rowToRecord(row) : undefined;
}

/**
 * Look a row up by the update operation an approval was dispatched as. Used by the
 * reconciler to stamp the operation's outcome back onto the row that started it.
 * @param operationId
 */
export function findApprovalByOperationId(operationId: string): ApprovalRecord | undefined {
  if (!db) {
    return undefined;
  }
  const row = db.prepare('SELECT * FROM approvals WHERE operation_id = ?').get(operationId);
  return row ? rowToRecord(row) : undefined;
}

/** Turn a patch into a `column = ?` list plus its bound values, skipping undefined fields. */
function buildSetClause(
  patch: ApprovalPatch,
  fields: readonly ApprovalMutableField[],
): { assignments: string[]; params: SqlBinding[] } {
  const assignments: string[] = [];
  const params: SqlBinding[] = [];
  for (const field of fields) {
    const value = patch[field];
    if (value !== undefined) {
      assignments.push(`${APPROVAL_COLUMN_BY_FIELD[field]} = ?`);
      params.push(value as SqlBinding);
    }
  }
  return { assignments, params };
}

/**
 * Apply a decision patch. Only the fields in `APPROVAL_MUTABLE_FIELDS` are written, so a
 * caller can never rewrite the candidate identity a row was minted with.
 * @param id
 * @param patch
 */
export function updateApproval(id: string, patch: ApprovalPatch): ApprovalRecord | undefined {
  if (!db) {
    return undefined;
  }
  const database = db;
  const existing = database.prepare('SELECT 1 FROM approvals WHERE id = ?').get(id);
  if (!existing) {
    return undefined;
  }

  const { assignments, params } = buildSetClause(patch, APPROVAL_MUTABLE_FIELDS);
  if (assignments.length > 0) {
    database
      .prepare(`UPDATE approvals SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...params, id);
  }

  return getApprovalById(id);
}

/**
 * Compare-and-set on semantic pending state: `decision === 'pending'`, or
 * `decision === 'deferred'` with an absent, unparseable or expired `deferredUntil`. The
 * row needs no sweep or normalization write before the compare.
 *
 * Runs inside `BEGIN IMMEDIATE` (the driver's default transaction mode): the read, the
 * pending check and the write all happen under one write lock, so a second caller
 * racing the first blocks until the first transaction commits rather than reading the
 * same pending row the first one already claimed.
 *
 * This is what makes a double decision safe. A decision handler that only read the row,
 * awaited an admission and then wrote would let two operators both pass the read, and the
 * second update would fail later on the existing active-operation gate with a message
 * about queued operations rather than about the queue. Reserving here, before anything is
 * awaited, means the loser is told the truth: somebody already decided this.
 * @param id
 * @param patch
 * @param options
 */
export function decideApprovalIfPending(
  id: string,
  patch: ApprovalPatch,
  options: { now?: number } = {},
): ApprovalDecisionTransition {
  if (!db) {
    return { status: 'not-found' };
  }
  const database = db;
  const nowMs = options.now ?? Date.now();

  return database.transaction((): ApprovalDecisionTransition => {
    const row = database.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
    if (!row) {
      return { status: 'not-found' };
    }

    const record = rowToRecord(row);
    if (!isApprovalPending(record, nowMs)) {
      return { status: 'already-decided', record };
    }

    // Every decision field is cleared to NULL unless the patch itself supplies a new
    // value, matching `clearDecisionFields` followed by `copyDefinedFields` against the
    // LokiJS document: an expired deferral's note and expiry must not survive onto the
    // decision that supersedes it.
    const { assignments: clearedAssignments, params: clearedParams } = buildSetClause(
      patch,
      APPROVAL_DECISION_FIELDS,
    );
    for (const field of APPROVAL_DECISION_FIELDS) {
      if (patch[field] === undefined) {
        clearedAssignments.push(`${APPROVAL_COLUMN_BY_FIELD[field]} = ?`);
        clearedParams.push(null);
      }
    }
    const { assignments: otherAssignments, params: otherParams } = buildSetClause(
      patch,
      APPROVAL_OTHER_MUTABLE_FIELDS,
    );

    database
      .prepare(
        `UPDATE approvals SET ${[...clearedAssignments, ...otherAssignments].join(', ')} WHERE id = ?`,
      )
      .run(...clearedParams, ...otherParams, id);

    const updatedRow = database.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
    return { status: 'decided', record: rowToRecord(updatedRow as Row) };
  });
}

/**
 * Undo a reservation whose work did not go through, putting back the exact row it
 * replaced. A patch cannot do this: `updateApproval` copies only the fields a caller names
 * and has no way to spell "unset", which is correct for a decision and useless for a
 * rollback.
 *
 * It restores a snapshot rather than resetting to `pending`, because the row a reservation
 * replaced is not always a pending one. An expired deferral is semantically pending and
 * can be reserved, and blanking it would erase who deferred it, when, why and until when —
 * a decision that did happen, and the only record of it until the row is pruned.
 * @param record
 */
export function restoreApproval(record: ApprovalRecord): ApprovalRecord | undefined {
  if (!db) {
    return undefined;
  }
  const database = db;
  const existing = database.prepare('SELECT 1 FROM approvals WHERE id = ?').get(record.id);
  if (!existing) {
    return undefined;
  }

  database
    .prepare(
      `UPDATE approvals SET
         decision = ?, decided_at = ?, decided_by = ?, decision_note = ?, deferred_until = ?, operation_id = ?
       WHERE id = ?`,
    )
    .run(
      record.decision,
      record.decidedAt ?? null,
      record.decidedBy ?? null,
      record.decisionNote ?? null,
      record.deferredUntil ?? null,
      record.operationId ?? null,
      record.id,
    );

  return getApprovalById(record.id);
}

/**
 * SQL fragment matching rows awaiting an operator: never decided, or deferred past its
 * expiry, and not resolved. `julianday()` returns NULL for a string it cannot parse as a
 * timestamp, which is exactly how `isApprovalDeferred` treats an unparseable
 * `deferredUntil` (`Number.isFinite(Date.parse(...))` is false): both read it as expired,
 * so the row falls back to pending rather than staying deferred forever.
 */
const PENDING_PREDICATE_SQL = `(
  resolved_at IS NULL
  AND (
    decision = 'pending'
    OR (
      decision = 'deferred'
      AND (
        deferred_until IS NULL
        OR julianday(deferred_until) IS NULL
        OR julianday(deferred_until) <= julianday(?)
      )
    )
  )
)`;

/** SQL fragment matching rows under a live (unexpired, parseable) deferral. */
const DEFERRED_PREDICATE_SQL = `(
  resolved_at IS NULL
  AND decision = 'deferred'
  AND deferred_until IS NOT NULL
  AND julianday(deferred_until) IS NOT NULL
  AND julianday(deferred_until) > julianday(?)
)`;

function buildStatusPredicate(
  status: ApprovalStatusFilter,
  nowIso: string,
  params: SqlBinding[],
): string {
  if (status === 'all') {
    return '1 = 1';
  }
  if (status === 'pending') {
    params.push(nowIso);
    return PENDING_PREDICATE_SQL;
  }
  if (status === 'deferred') {
    params.push(nowIso);
    return DEFERRED_PREDICATE_SQL;
  }
  // `decided` is the remainder of the partition: approved, rejected, and any row that
  // was resolved out of the queue without a human decision.
  params.push(nowIso, nowIso);
  return `NOT ${PENDING_PREDICATE_SQL} AND NOT ${DEFERRED_PREDICATE_SQL}`;
}

function buildListApprovalsWhere(
  query: ListApprovalsQuery,
  nowMs: number,
): { clause: string; params: SqlBinding[] } {
  const params: SqlBinding[] = [];
  const nowIso = new Date(nowMs).toISOString();
  const conditions: string[] = [buildStatusPredicate(query.status ?? 'pending', nowIso, params)];

  if (query.containerId !== undefined) {
    conditions.push('container_id = ?');
    params.push(query.containerId);
  }
  if (query.agent !== undefined) {
    conditions.push('agent = ?');
    params.push(query.agent);
  }
  if (query.semverDiff !== undefined) {
    conditions.push('semver_diff = ?');
    params.push(query.semverDiff);
  }
  const needle = query.q?.trim().toLowerCase();
  if (needle !== undefined && needle !== '') {
    conditions.push(
      '(LOWER(container_name) LIKE ? OR LOWER(image) LIKE ? OR LOWER(from_ref) LIKE ? OR LOWER(to_ref) LIKE ?)',
    );
    const pattern = `%${needle}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  return { clause: ` WHERE ${conditions.join(' AND ')}`, params };
}

/**
 * List rows matching a filter, sorted `createdAtMs` descending, with the unpaginated
 * total. `limit` omitted means "every match"; `limit: 0` means "the count only".
 * @param query
 */
export function listApprovals(query: ListApprovalsQuery = {}): {
  records: ApprovalRecord[];
  total: number;
} {
  if (!db) {
    return { records: [], total: 0 };
  }
  const database = db;
  const nowMs = query.now ?? Date.now();
  const { clause, params } = buildListApprovalsWhere(query, nowMs);

  const totalRow = database
    .prepare(`SELECT COUNT(*) AS count FROM approvals${clause}`)
    .get(...params) as Row;
  const total = Number(totalRow.count);

  const offset = query.offset ?? 0;
  const limit = query.limit === undefined ? -1 : query.limit;
  const rows = database
    .prepare(`SELECT * FROM approvals${clause} ORDER BY created_at_ms DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return { records: rows.map(rowToRecord), total };
}

/**
 * Cheap counts for the nav badge and the dashboard tile.
 * @param now
 */
export function countApprovals(now?: number): ApprovalCounts {
  if (!db) {
    return { pending: 0, deferred: 0, decidedToday: 0 };
  }
  const database = db;
  const nowMs = now ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const date = new Date(nowMs);
  const sinceIso = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toISOString();

  const pendingRow = database
    .prepare(`SELECT COUNT(*) AS count FROM approvals WHERE ${PENDING_PREDICATE_SQL}`)
    .get(nowIso) as Row;
  const deferredRow = database
    .prepare(`SELECT COUNT(*) AS count FROM approvals WHERE ${DEFERRED_PREDICATE_SQL}`)
    .get(nowIso) as Row;
  // Mirrors `wasDecidedSince`: not pending, has a decidedAt, and that decidedAt both
  // parses and falls on or after UTC midnight. `julianday()` returning NULL for an
  // unparseable decidedAt excludes it the same way `Number.isFinite(Date.parse(...))`
  // does in the pre-migration JS.
  const decidedTodayRow = database
    .prepare(
      `SELECT COUNT(*) AS count FROM approvals
       WHERE decision != 'pending'
         AND decided_at IS NOT NULL
         AND julianday(decided_at) IS NOT NULL
         AND julianday(decided_at) >= julianday(?)`,
    )
    .get(sinceIso) as Row;

  return {
    pending: Number(pendingRow.count),
    deferred: Number(deferredRow.count),
    decidedToday: Number(decidedTodayRow.count),
  };
}

/**
 * Retention age for a row: when it left the queue, not when it entered. A row created
 * long ago and decided yesterday is a fresh decision, and pruning it on `createdAtMs`
 * (what `audit.ts` uses, because an audit entry is only ever an instant) would drop it.
 */
function getRetentionTimestampMs(record: ApprovalRecord): number {
  const terminalAt = record.resolvedAt ?? record.decidedAt;
  if (terminalAt !== undefined) {
    const terminalAtMs = Date.parse(terminalAt);
    if (Number.isFinite(terminalAtMs)) {
      return terminalAtMs;
    }
  }
  return record.createdAtMs;
}

/**
 * Remove decided and resolved rows older than N days. Pending rows and live deferrals
 * are never pruned — the permanent record of a decision is the audit entry, not the row.
 * @param days
 * @param now
 */
export function pruneOldApprovals(days: number, now?: number): number {
  if (!db) {
    return 0;
  }
  const database = db;
  const nowMs = now ?? Date.now();
  const cutoff = nowMs - daysToMs(days);

  const { records: decidedRecords } = listApprovals({ status: 'decided', now: nowMs });
  const stale = decidedRecords.filter((record) => getRetentionTimestampMs(record) < cutoff);
  if (stale.length === 0) {
    return 0;
  }

  const deleteStatement = database.prepare('DELETE FROM approvals WHERE id = ?');
  for (const record of stale) {
    deleteStatement.run(record.id);
  }
  return stale.length;
}

/** Test helper: drop the database handle and stop the retention timer. */
export function resetApprovalStoreForTests(): void {
  stopPeriodicPruneTimer();
  db = undefined;
  approvalInsertsSincePrune = 0;
}
