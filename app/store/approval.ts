/**
 * Approval ledger store (spec-ca-2-approval-queue.md, slice 1).
 *
 * Flat records with no `{ data: … }` envelope — unlike `audit.ts` and
 * `update-operation.ts`, which wrap — because this collection maps 1:1 onto a SQLite
 * table at the v1.8 store migration. `agent-keys.ts` (flat) and `ui-preferences.ts`
 * (`schemaVersion`) are the shape precedents.
 *
 * The ledger stores the decision; the candidate set stays derived. Nothing live — soft
 * blockers, eligibility, release-notes body, current vulnerability counts — is frozen
 * into a row.
 *
 * The ledger must never be written through `store/container.ts`'s `updateContainer()`,
 * so it does not inherit that collection's full-record write-clobbering bug.
 */
import crypto from 'node:crypto';
import {
  APPROVAL_SCHEMA_VERSION,
  type ApprovalRecord,
  type ApprovalRecordInput,
  type ApprovalSemverDiff,
  isApprovalDeferred,
  isApprovalPending,
} from '../model/approval.js';
import { daysToMs } from '../model/maturity-policy.js';
import { initCollection } from './util.js';

const APPROVAL_COLLECTION_INDICES = ['containerId', 'candidateRef', 'decision', 'createdAtMs'];
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

/** Fields written only when the container actually carries them. */
const APPROVAL_OPTIONAL_INPUT_FIELDS = [
  'agent',
  'releaseNotesUrl',
  'scanCritical',
  'scanHigh',
  'scanMedium',
  'scanLow',
  'scanUnknown',
  'scanAt',
] as const;

type ApprovalDocument = ApprovalRecord & { $loki?: number; meta?: unknown };

interface ApprovalCollection {
  find(query?: Record<string, unknown>): ApprovalDocument[];
  findOne(query: Record<string, unknown>): ApprovalDocument | null;
  insert(document: ApprovalRecord): void;
  update(document: ApprovalDocument): void;
  remove(document: ApprovalDocument): void;
}

interface ApprovalStoreDb {
  getCollection(name: string): ApprovalCollection | null;
  addCollection(name: string, options?: Record<string, unknown>): ApprovalCollection;
}

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

let approvalCollection: ApprovalCollection | undefined;
let approvalInsertsSincePrune = 0;
let approvalPruneTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Copy the fields a source actually carries onto a target, leaving the rest untouched.
 * Keeps the flat-record shape written in one place instead of eighteen conditional
 * spreads, without an index-signature cast the migration rules forbid on the record type.
 */
function copyDefinedFields<T extends object, K extends keyof T>(
  target: T,
  source: Pick<Partial<T>, K>,
  fields: readonly K[],
): void {
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined) {
      target[field] = value;
    }
  }
}

function toApprovalRecord(document: ApprovalDocument): ApprovalRecord {
  const record: ApprovalRecord = {
    schemaVersion: document.schemaVersion,
    id: document.id,
    containerId: document.containerId,
    containerIdentityKey: document.containerIdentityKey,
    containerName: document.containerName,
    watcher: document.watcher,
    image: document.image,
    fromRef: document.fromRef,
    toRef: document.toRef,
    candidateRef: document.candidateRef,
    updateKind: document.updateKind,
    semverDiff: document.semverDiff,
    createdAt: document.createdAt,
    createdAtMs: document.createdAtMs,
    decision: document.decision,
  };

  copyDefinedFields(record, document, [
    ...APPROVAL_OPTIONAL_INPUT_FIELDS,
    ...APPROVAL_MUTABLE_FIELDS,
  ]);

  return record;
}

function sortByCreatedAtDescending(records: ApprovalRecord[]): ApprovalRecord[] {
  return [...records].sort((left, right) => right.createdAtMs - left.createdAtMs);
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
 * Create the approvals collection.
 * @param db
 */
export function createCollections(db: ApprovalStoreDb): void {
  approvalCollection = initCollection(db, 'approvals', {
    indices: APPROVAL_COLLECTION_INDICES,
  }) as ApprovalCollection;
  approvalInsertsSincePrune = 0;
  pruneOldApprovals(APPROVAL_RETENTION_DAYS);
  startPeriodicPruneTimer();
}

/**
 * Insert a pending row for a newly sighted candidate. Callers are responsible for the
 * dedupe check — one row per `(containerId, candidateRef)` — because the reconciler
 * already has the container's rows in hand when it decides to insert.
 * @param input
 * @param options
 */
export function insertApproval(
  input: ApprovalRecordInput,
  options: { now?: number } = {},
): ApprovalRecord {
  if (!approvalCollection) {
    throw new Error('approvals collection not initialized');
  }

  const createdAtMs = options.now ?? Date.now();
  const record: ApprovalRecord = {
    schemaVersion: APPROVAL_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    containerId: input.containerId,
    containerIdentityKey: input.containerIdentityKey,
    containerName: input.containerName,
    watcher: input.watcher,
    image: input.image,
    fromRef: input.fromRef,
    toRef: input.toRef,
    candidateRef: input.candidateRef,
    updateKind: input.updateKind,
    semverDiff: input.semverDiff,
    createdAt: new Date(createdAtMs).toISOString(),
    createdAtMs,
    decision: 'pending',
  };

  copyDefinedFields(record, input, APPROVAL_OPTIONAL_INPUT_FIELDS);

  approvalCollection.insert(record);
  approvalInsertsSincePrune += 1;
  if (approvalInsertsSincePrune >= APPROVAL_PRUNE_INSERT_INTERVAL) {
    pruneOldApprovals(APPROVAL_RETENTION_DAYS);
    approvalInsertsSincePrune = 0;
  }

  return toApprovalRecord(record);
}

/**
 * Look a row up by its primary key.
 * @param id
 */
export function getApprovalById(id: string): ApprovalRecord | undefined {
  const document = approvalCollection?.findOne({ id });
  return document ? toApprovalRecord(document) : undefined;
}

/**
 * Every row for a container, newest first. The reconciler reads this to decide between
 * insert, supersede and withdraw.
 * @param containerId
 */
export function findApprovalsByContainerId(containerId: string): ApprovalRecord[] {
  if (!approvalCollection) {
    return [];
  }
  return sortByCreatedAtDescending(approvalCollection.find({ containerId }).map(toApprovalRecord));
}

/**
 * Look a row up by the update operation an approval was dispatched as. Used by the
 * reconciler to stamp the operation's outcome back onto the row that started it.
 * @param operationId
 */
export function findApprovalByOperationId(operationId: string): ApprovalRecord | undefined {
  const document = approvalCollection?.findOne({ operationId });
  return document ? toApprovalRecord(document) : undefined;
}

/**
 * Apply a decision patch. Only the fields in `APPROVAL_MUTABLE_FIELDS` are written, so a
 * caller can never rewrite the candidate identity a row was minted with.
 * @param id
 * @param patch
 */
export function updateApproval(id: string, patch: ApprovalPatch): ApprovalRecord | undefined {
  const document = approvalCollection?.findOne({ id });
  if (!document || !approvalCollection) {
    return undefined;
  }

  copyDefinedFields(document, patch, APPROVAL_MUTABLE_FIELDS);

  approvalCollection.update(document);
  return toApprovalRecord(document);
}

function matchesStatus(
  record: ApprovalRecord,
  status: ApprovalStatusFilter,
  nowMs: number,
): boolean {
  if (status === 'all') {
    return true;
  }
  if (status === 'pending') {
    return isApprovalPending(record, nowMs);
  }
  if (status === 'deferred') {
    return isApprovalDeferred(record, nowMs);
  }
  // `decided` is the remainder of the partition: approved, rejected, and any row that
  // was resolved out of the queue without a human decision.
  return !isApprovalPending(record, nowMs) && !isApprovalDeferred(record, nowMs);
}

function matchesFreeText(record: ApprovalRecord, needle: string): boolean {
  return [record.containerName, record.image, record.fromRef, record.toRef].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

function matchesQuery(record: ApprovalRecord, query: ListApprovalsQuery, nowMs: number): boolean {
  if (!matchesStatus(record, query.status ?? 'pending', nowMs)) {
    return false;
  }
  if (query.containerId !== undefined && record.containerId !== query.containerId) {
    return false;
  }
  if (query.agent !== undefined && record.agent !== query.agent) {
    return false;
  }
  if (query.semverDiff !== undefined && record.semverDiff !== query.semverDiff) {
    return false;
  }
  const needle = query.q?.trim().toLowerCase();
  if (needle !== undefined && needle !== '' && !matchesFreeText(record, needle)) {
    return false;
  }
  return true;
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
  if (!approvalCollection) {
    return { records: [], total: 0 };
  }

  const nowMs = query.now ?? Date.now();
  const matched = sortByCreatedAtDescending(
    approvalCollection
      .find()
      .map(toApprovalRecord)
      .filter((record) => matchesQuery(record, query, nowMs)),
  );

  const offset = query.offset ?? 0;
  const records =
    query.limit === undefined ? matched.slice(offset) : matched.slice(offset, offset + query.limit);

  return { records, total: matched.length };
}

function startOfUtcDay(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function wasDecidedSince(record: ApprovalRecord, sinceMs: number): boolean {
  if (record.decision === 'pending' || record.decidedAt === undefined) {
    return false;
  }
  const decidedAtMs = Date.parse(record.decidedAt);
  return Number.isFinite(decidedAtMs) && decidedAtMs >= sinceMs;
}

/**
 * Cheap counts for the nav badge and the dashboard tile.
 * @param now
 */
export function countApprovals(now?: number): ApprovalCounts {
  const nowMs = now ?? Date.now();
  const counts: ApprovalCounts = { pending: 0, deferred: 0, decidedToday: 0 };
  if (!approvalCollection) {
    return counts;
  }

  const sinceMs = startOfUtcDay(nowMs);
  for (const document of approvalCollection.find()) {
    const record = toApprovalRecord(document);
    if (isApprovalPending(record, nowMs)) {
      counts.pending += 1;
    }
    if (isApprovalDeferred(record, nowMs)) {
      counts.deferred += 1;
    }
    if (wasDecidedSince(record, sinceMs)) {
      counts.decidedToday += 1;
    }
  }

  return counts;
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
  if (!approvalCollection) {
    return 0;
  }

  const collection = approvalCollection;
  const nowMs = now ?? Date.now();
  const cutoff = nowMs - daysToMs(days);
  const stale = collection.find().filter((document) => {
    const record = toApprovalRecord(document);
    if (isApprovalPending(record, nowMs) || isApprovalDeferred(record, nowMs)) {
      return false;
    }
    return getRetentionTimestampMs(record) < cutoff;
  });

  stale.forEach((document) => collection.remove(document));
  return stale.length;
}

/** Test helper: drop the collection handle and stop the retention timer. */
export function resetApprovalStoreForTests(): void {
  stopPeriodicPruneTimer();
  approvalCollection = undefined;
  approvalInsertsSincePrune = 0;
}
