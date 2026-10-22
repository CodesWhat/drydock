/**
 * Pending-approval API (spec-ca-2-approval-queue.md, slices 3 and 4).
 *
 * The ledger stores the decision; the candidate set stays derived. So the list returns
 * stored rows verbatim and the detail route computes eligibility and hold reasons live
 * from the container, which means a soft blocker that lifted a second ago is already gone
 * from the response and no stale copy of it was ever written to a row.
 *
 * Approve, reject and defer are wrappers over three primitives that already exist, and
 * add no update semantics of their own:
 *
 * - approve dispatches through the same admission path `POST /containers/:id/update`
 *   uses, so it inherits every rejection that endpoint has — including the notify-mode
 *   409, which is why the queue can show a row it cannot approve without the API ever
 *   pretending otherwise;
 * - reject writes the container's existing `skipTags`/`skipDigests` policy, the same
 *   operation as the container panel's Skip button;
 * - defer writes the container's existing snooze, and mirrors the expiry onto the row so
 *   the queue and the `snoozed` soft blocker cannot disagree.
 *
 * What the routes will not delegate is validation. Each body is checked against the shape
 * the OpenAPI document publishes — an object, no properties the route does not read, a
 * note that is a string, an expiry that is a real instant inside the same bounds the day
 * count has — because a primitive refusing what it happens to refuse is not the same as
 * the documented contract, and the gap between the two is where a request that looks
 * accepted quietly does something else.
 *
 * Every decision reserves the row before it does any of that. The reservation is a
 * compare-and-set on semantic pending state, taken before anything is awaited, so two
 * operators approving at once produce one operation and one 409 rather than two accepted
 * requests whose second update fails later on the active-operation gate. A reservation
 * whose work is then refused is rolled back, leaving the row exactly as it was.
 *
 * A decision is bound to the candidate its row names. The container it points at is a
 * live record the watcher rewrites on every cycle, so between the sighting that minted
 * the row and the click that decides it the candidate can have moved; deciding anyway
 * would act on a version the row and the audit entry do not name. A moved candidate is
 * refused, and the reconciler supersedes the row on the same report that replaced it.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import nocache from 'nocache';
import { announceApprovalEvent } from '../approvals/events.js';
import {
  type ApprovalRecord,
  type ApprovalSemverDiff,
  getApprovalCandidateRef,
} from '../model/approval.js';
import type { AuditEntry } from '../model/audit.js';
import type { Container } from '../model/container.js';
import { daysToMs } from '../model/maturity-policy.js';
import { computeUpdateEligibility, getSoftBlockers } from '../model/update-eligibility.js';
import {
  type ApprovalPatch,
  type ApprovalStatusFilter,
  countApprovals,
  decideApprovalIfPending,
  getApprovalById,
  listApprovals,
  restoreApproval,
  updateApproval,
} from '../store/approval.js';
import { getContainer } from '../store/container.js';
import { recordAuditEvent } from './audit-events.js';
import { getPathParamValue, normalizeLimitOffsetPagination } from './container/request-helpers.js';
import { applyContainerUpdatePolicyAction } from './container/update-policy-writer.js';
import {
  areContainerActionsEnabled,
  CONTAINER_ACTIONS_DISABLED_MESSAGE,
  CONTAINER_NOT_FOUND_MESSAGE,
  dispatchManualContainerUpdate,
  sendContainerUpdateDispatchOutcome,
} from './container-update-dispatch.js';
import { requireDestructiveActionConfirmation } from './destructive-confirmation.js';
import { sendErrorResponse } from './error-response.js';
import { buildPaginationLinks } from './pagination-links.js';
import { scoped } from './route-scopes.js';
import { buildEligibilityContext } from './sse-container-enrichment.js';

const router = express.Router();

const APPROVAL_BASE_PATH = '/api/v1/approvals';
const APPROVAL_LIST_MAX_LIMIT = 200;
const APPROVAL_SEARCH_MAX_LENGTH = 200;
const APPROVAL_STATUS_FILTERS = new Set<string>(['pending', 'deferred', 'decided', 'all']);
const APPROVAL_NOTE_MAX_LENGTH = 500;
const APPROVAL_NOT_FOUND_MESSAGE = 'Approval not found';
const APPROVAL_ALREADY_DECIDED_MESSAGE = 'Approval already decided';
const APPROVAL_SUPERSEDED_MESSAGE = 'Approval candidate superseded';
const INVALID_NOTE_MESSAGE = `Invalid note; expected a string of at most ${APPROVAL_NOTE_MAX_LENGTH} characters`;
const INVALID_BODY_MESSAGE = 'Invalid request body; expected a JSON object';
const APPROVAL_DEFER_DEFAULT_DAYS = 7;
const APPROVAL_DEFER_MAX_DAYS = 365;
const INVALID_UNTIL_MESSAGE = `Invalid until; expected an RFC 3339 date-time in the future, at most ${APPROVAL_DEFER_MAX_DAYS} days from now`;
const INVALID_DAYS_MESSAGE = `Invalid days; expected an integer between 1 and ${APPROVAL_DEFER_MAX_DAYS}`;
const APPROVAL_BULK_MAX_IDS = 200;
const APPROVAL_BULK_ACTIONS = new Set<string>(['approve', 'reject', 'defer']);
const INVALID_BULK_IDS_MESSAGE = `Invalid ids; expected a non-empty array of at most ${APPROVAL_BULK_MAX_IDS} approval ids`;
const INVALID_BULK_ACTION_MESSAGE = 'Invalid action; expected approve, reject, or defer';
const BULK_DEFER_ONLY_MESSAGE =
  'Invalid request body; until and days are only valid with action defer';
const BULK_PROCESSED_MESSAGE = 'Approval decisions processed';
const BULK_APPROVE_CONFIRMATION = 'approvals-bulk-approve';
const DECISION_BODY_FIELDS = ['note'] as const;
const BULK_BODY_FIELDS = ['ids', 'action', 'until', 'days', 'note'] as const;
const DEFER_BODY_FIELDS = ['until', 'days', 'note'] as const;
// A full RFC 3339 instant: date, time to the second, explicit offset. `new Date()` accepts
// far more than that — a bare `2026-09-09` is midnight in whatever zone the process runs
// in, which is not an instant an operator chose.
// Stryker disable next-line Regex: validation behavior is covered by route tests, but module-scope regex mutants survive under the vitest runner.
const RFC_3339_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const APPROVAL_SEMVER_DIFFS = new Set<string>(['major', 'minor', 'patch', 'prerelease', 'unknown']);
// Container ids, agent names and watcher names only. Deliberately not applied to `q`,
// which is a free-text needle matched with a lowercase substring test rather than a
// regex, so it carries no injection or backtracking surface of its own.
// Stryker disable next-line Regex: validation behavior is covered by route tests, but module-scope regex mutants survive under the vitest runner.
const SAFE_APPROVAL_FILTER_PATTERN = /^[a-zA-Z0-9._:-]+$/;

function getQueryStringValue(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string' || candidate === '') {
    return undefined;
  }
  return candidate;
}

/** `null` means "present and invalid", which every caller turns into a 400. */
function getValidatedFilter(value: unknown): string | undefined | null {
  const raw = getQueryStringValue(value);
  if (raw === undefined) {
    return undefined;
  }
  return SAFE_APPROVAL_FILTER_PATTERN.test(raw) ? raw : null;
}

function getValidatedEnum(value: unknown, allowed: Set<string>): string | undefined | null {
  const raw = getQueryStringValue(value);
  if (raw === undefined) {
    return undefined;
  }
  return allowed.has(raw) ? raw : null;
}

/**
 * List approval rows, newest first. Defaults to `status=pending`, because the queue is a
 * work surface and an operator opening it wants the work, not the archive.
 * @param req
 * @param res
 */
function getApprovals(req: Request, res: Response): void {
  const status = getValidatedEnum(req.query.status, APPROVAL_STATUS_FILTERS);
  if (status === null) {
    sendErrorResponse(res, 400, 'Invalid status query parameter');
    return;
  }

  const containerId = getValidatedFilter(req.query.containerId);
  if (containerId === null) {
    sendErrorResponse(res, 400, 'Invalid containerId query parameter');
    return;
  }

  const agent = getValidatedFilter(req.query.agent);
  if (agent === null) {
    sendErrorResponse(res, 400, 'Invalid agent query parameter');
    return;
  }

  const semverDiff = getValidatedEnum(req.query.semverDiff, APPROVAL_SEMVER_DIFFS);
  if (semverDiff === null) {
    sendErrorResponse(res, 400, 'Invalid semverDiff query parameter');
    return;
  }

  const q = getQueryStringValue(req.query.q);
  if (q !== undefined && q.length > APPROVAL_SEARCH_MAX_LENGTH) {
    sendErrorResponse(res, 400, 'Invalid q query parameter');
    return;
  }

  const pagination = normalizeLimitOffsetPagination(req.query, {
    maxLimit: APPROVAL_LIST_MAX_LIMIT,
  });
  const { records, total } = listApprovals({
    status: (status ?? 'pending') as ApprovalStatusFilter,
    ...(containerId !== undefined ? { containerId } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(semverDiff !== undefined ? { semverDiff: semverDiff as ApprovalSemverDiff } : {}),
    ...(q !== undefined ? { q } : {}),
    // House convention for these list endpoints: `limit=0` (and an absent limit) means
    // "everything from the offset". The store spells that as an absent limit, because
    // `limit: 0` there is the count-only query the summary route wants.
    ...(pagination.limit > 0 ? { limit: pagination.limit } : {}),
    offset: pagination.offset,
  });

  const links = buildPaginationLinks({
    basePath: APPROVAL_BASE_PATH,
    query: req.query,
    limit: pagination.limit,
    offset: pagination.offset,
    total,
    returnedCount: records.length,
  });

  res.status(200).json({
    data: records,
    total,
    limit: pagination.limit,
    offset: pagination.offset,
    hasMore: pagination.limit > 0 && pagination.offset + records.length < total,
    ...(links ? { _links: links } : {}),
  });
}

/**
 * Counts for the nav badge and the dashboard tile. Separate from the list so the badge
 * never pays for a page of rows it does not render.
 * @param _req
 * @param res
 */
function getApprovalSummary(_req: Request, res: Response): void {
  res.status(200).json(countApprovals());
}

/**
 * One row plus everything live about it. `eligibility` is recomputed per request through
 * the same context the container list uses, and `holdReasons` is its soft blockers: the
 * snooze, threshold, maturity or skip that is holding this candidate back without hiding
 * it. A hard blocker is not filtered out of `eligibility`, so a row that became
 * un-approvable after it was queued (a rolled-back last attempt, say) still carries the
 * exact message the manual update path would return.
 * @param req
 * @param res
 */
function getApproval(req: Request<{ id: string }>, res: Response): void {
  const approval = getApprovalById(getPathParamValue(req.params.id));
  if (approval === undefined) {
    sendErrorResponse(res, 404, 'Approval not found');
    return;
  }

  const container = getContainer(approval.containerId);
  if (container === undefined) {
    // The row outlived its container, which is the `container-removed` resolution. There
    // is nothing live to report, and an empty hold list is the honest answer.
    res.status(200).json({ approval, holdReasons: [] });
    return;
  }

  const eligibility = computeUpdateEligibility(container, buildEligibilityContext(container));
  res.status(200).json({ approval, eligibility, holdReasons: getSoftBlockers(eligibility) });
}

/** Whoever the authentication middleware resolved, if anyone. */
interface AuthenticatedRequest {
  user?: { username?: string };
}

/** A single-row decision request. */
type DecisionRequest = Request<{ id: string }> & AuthenticatedRequest;

/** Why a decision did not take effect, in the status and message the single route answers with. */
interface DecisionFailure {
  kind: 'rejected';
  statusCode: number;
  message: string;
}

type DecisionOutcome = { kind: 'decided'; record: ApprovalRecord } | DecisionFailure;

type ApproveOutcome =
  | { kind: 'accepted'; operationId: string; record: ApprovalRecord }
  | DecisionFailure;

function failure(statusCode: number, message: string): DecisionFailure {
  return { kind: 'rejected', statusCode, message };
}

/** A row reserved for one decision, with the container that decision acts on. */
interface ReservedApproval {
  /** The row exactly as it was before the reservation, for a rollback to put back. */
  previous: ApprovalRecord;
  record: ApprovalRecord;
  container: Container;
}

/**
 * The operator this decision is recorded against. `req.user` is undefined for a real
 * anonymous session — passport-anonymous passes with no arguments rather than
 * synthesizing a user — so the fallback is the same literal the rest of the API uses.
 * @param req
 */
function getDecidedBy(req: AuthenticatedRequest): string {
  return req.user?.username?.trim() || 'anonymous';
}

/** A decision body that passed validation: the raw object, plus the note if it carries one. */
interface DecisionRequestBody {
  body: Record<string, unknown>;
  note?: string;
}

/**
 * Read a decision body, or answer why it is not one.
 *
 * The handler validates what the OpenAPI schema documents rather than trusting the
 * primitives underneath to refuse what they happen to refuse. A property nobody reads is
 * the case that matters: `POST /defer {"snoozeUntil": …}` looks like it worked, answers
 * 200, and defers the row by the default seven days instead of the fortnight the caller
 * asked for. Naming the allowed properties back is what turns that into a fixable error.
 * @param res
 * @param raw
 * @param fields
 */
function readDecisionRequest(
  res: Response,
  raw: unknown,
  fields: readonly string[],
): DecisionRequestBody | undefined {
  // An absent body is the documented default for all three routes. A literal `null`
  // payload never gets this far — express's JSON parser is strict and refuses it — so the
  // only way to see one is an internal caller, and reading it as absent is the safe answer.
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    sendErrorResponse(res, 400, INVALID_BODY_MESSAGE);
    return undefined;
  }

  const body = (raw ?? {}) as Record<string, unknown>;
  if (Object.keys(body).some((key) => !fields.includes(key))) {
    sendErrorResponse(
      res,
      400,
      `Invalid request body; the allowed properties are ${fields.join(', ')}`,
    );
    return undefined;
  }

  const note = body.note;
  if (note === undefined) {
    return { body };
  }
  if (typeof note !== 'string' || note.length > APPROVAL_NOTE_MAX_LENGTH) {
    sendErrorResponse(res, 400, INVALID_NOTE_MESSAGE);
    return undefined;
  }

  const trimmed = note.trim();
  return trimmed === '' ? { body } : { body, note: trimmed };
}

/**
 * Resolve the instant a deferral runs to, from `until` or a day count.
 *
 * One value, resolved once, written to both the row's `deferredUntil` and the container's
 * `updatePolicy.snoozeUntil`, so the queue and the `snoozed` soft blocker cannot disagree
 * about when the hold ends. It is normalized to UTC here rather than stored as written,
 * because the policy writer normalizes what it stores and the two have to compare equal as
 * strings. The bounds are the ones the day count already had: a deferral to the past is a
 * deferral that expires before it is written, and one past the ceiling is a rejection
 * wearing a deferral's clothes.
 * @param body
 * @param nowMs
 */
function resolveDeferralExpiry(
  body: Record<string, unknown>,
  nowMs: number,
): { deferredUntil: string } | { error: string } {
  const maxMs = nowMs + daysToMs(APPROVAL_DEFER_MAX_DAYS);
  const until = body.until;
  if (until !== undefined) {
    if (typeof until !== 'string' || !RFC_3339_PATTERN.test(until)) {
      return { error: INVALID_UNTIL_MESSAGE };
    }
    const untilMs = Date.parse(until);
    if (!Number.isFinite(untilMs) || untilMs <= nowMs || untilMs > maxMs) {
      return { error: INVALID_UNTIL_MESSAGE };
    }
    return { deferredUntil: new Date(untilMs).toISOString() };
  }

  const days = body.days === undefined ? APPROVAL_DEFER_DEFAULT_DAYS : body.days;
  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > APPROVAL_DEFER_MAX_DAYS
  ) {
    return { error: INVALID_DAYS_MESSAGE };
  }
  return { deferredUntil: new Date(nowMs + daysToMs(days)).toISOString() };
}

/**
 * Take the row for one decision, or answer why it could not be taken.
 *
 * Everything that can refuse the decision is checked before the row is written, and
 * nothing between the first read and the reservation yields, so a refusal leaves no trace
 * at all and the compare-and-set is still the last thing that happens before the caller
 * awaits anything. That is what makes a double approve safe: the second request finds the
 * row no longer pending and is told so, instead of both requests passing a read and the
 * second update failing later on the active-operation gate with a message about queued
 * operations.
 *
 * The candidate check is the decision's binding to a version. A row names one candidate,
 * and the watcher can store a newer one at any point after the row was minted; deciding
 * against the container without comparing would dispatch, skip or snooze a version that
 * neither the row nor its audit entry names. The row is not resolved here — the
 * reconciler owns resolution and supersedes it on the report that carried the new
 * candidate, which is also the report that mints its replacement.
 * @param id
 * @param decidedBy
 * @param patch
 * @param note
 */
function reserveApproval(
  id: string,
  decidedBy: string,
  patch: ApprovalPatch,
  note: string | undefined,
): ReservedApproval | DecisionFailure {
  const previous = getApprovalById(id);
  if (previous === undefined) {
    return failure(404, APPROVAL_NOT_FOUND_MESSAGE);
  }

  const container = getContainer(previous.containerId);
  if (container === undefined) {
    // A row whose container is gone has already been resolved `container-removed` by the
    // reconciler in the normal case; this answers the race where it has not.
    return failure(404, CONTAINER_NOT_FOUND_MESSAGE);
  }

  if (getApprovalCandidateRef(container) !== previous.candidateRef) {
    return failure(409, APPROVAL_SUPERSEDED_MESSAGE);
  }

  const transition = decideApprovalIfPending(id, {
    ...patch,
    decidedAt: new Date().toISOString(),
    decidedBy,
    ...(note !== undefined ? { decisionNote: note } : {}),
  });

  if (transition.status === 'not-found') {
    return failure(404, APPROVAL_NOT_FOUND_MESSAGE);
  }
  if (transition.status === 'already-decided') {
    return failure(409, APPROVAL_ALREADY_DECIDED_MESSAGE);
  }

  return { previous, record: transition.record, container };
}

function isFailure(value: ReservedApproval | DecisionFailure): value is DecisionFailure {
  return 'statusCode' in value;
}

/**
 * Put a reserved row back exactly as it was and report the reason its work was refused. A
 * decision that did not take effect leaves no trace: the operator can fix the blocker and
 * decide again, and the row's `createdAt` still says how long it has been waiting. The
 * snapshot is restored rather than the row being reset, because a reserved row may be an
 * expired deferral that a reset would blank.
 * @param previous
 * @param statusCode
 * @param message
 */
function abandonReservation(
  previous: ApprovalRecord,
  statusCode: number,
  message: string,
): DecisionFailure {
  restoreApproval(previous);
  return failure(statusCode, message);
}

/**
 * Write the container policy a decision delegates to. Returns a failure when the policy
 * layer refused, with its own message and status: the same ones the container panel would
 * show for the same action.
 * @param reserved
 * @param action
 * @param body
 */
function writeDecisionPolicy(
  reserved: ReservedApproval,
  action: string,
  body: Record<string, unknown>,
): DecisionFailure | undefined {
  const result = applyContainerUpdatePolicyAction(reserved.container, action, body);
  if ('error' in result) {
    return abandonReservation(reserved.previous, 400, result.error);
  }
  return undefined;
}

/**
 * Record the permanent trace of a decision and tell any open client about it.
 *
 * The audit entry, not the row, is the permanent record: rows are pruned 30 days after
 * they leave the queue, and this is what survives. Only a decision that took effect is
 * recorded — a reservation that was rolled back decided nothing.
 * @param action
 * @param container
 * @param record
 */
function completeDecision(
  action: AuditEntry['action'],
  container: Container,
  record: ApprovalRecord,
): void {
  recordAuditEvent({
    action,
    status: 'success',
    container,
    fromVersion: record.fromRef,
    toVersion: record.toRef,
    details: JSON.stringify({
      approvalId: record.id,
      containerId: record.containerId,
      decision: record.decision,
      decidedBy: record.decidedBy,
      ...(record.decisionNote !== undefined ? { note: record.decisionNote } : {}),
      ...(record.deferredUntil !== undefined ? { deferredUntil: record.deferredUntil } : {}),
      ...(record.operationId !== undefined ? { operationId: record.operationId } : {}),
    }),
  });
  announceApprovalEvent('decided', record);
}

/**
 * Approve one queued update: dispatch it exactly as the container panel's Update button
 * does, and report exactly what that endpoint answers.
 *
 * Every rejection here is the admission path's own, re-evaluated now rather than when the
 * row was sighted — the row is a pointer at a candidate, never a capability, so there is
 * no window between sighting and approval in which the queue could admit something the
 * Update button would refuse. Under `updateMode: notify` that means the existing 409, and
 * nothing is dispatched.
 * @param id
 * @param decidedBy
 * @param note
 */
async function approveOne(
  id: string,
  decidedBy: string,
  note: string | undefined,
): Promise<ApproveOutcome> {
  const reserved = reserveApproval(id, decidedBy, { decision: 'approved' }, note);
  if (isFailure(reserved)) {
    return reserved;
  }

  const outcome = await dispatchManualContainerUpdate(reserved.container);
  if (outcome.kind === 'rejected') {
    restoreApproval(reserved.previous);
    return failure(outcome.statusCode, outcome.message);
  }

  updateApproval(reserved.record.id, { operationId: outcome.operationId });
  const record = { ...reserved.record, operationId: outcome.operationId };
  completeDecision('update-approved', reserved.container, record);
  return { kind: 'accepted', operationId: outcome.operationId, record };
}

/**
 * Reject one queued update by writing the container's existing skip policy. This is the
 * same operation as the container panel's Skip button, one source of truth, undoable from
 * the update-policy panel — and visible there, which is a thing the confirmation copy has
 * to say out loud.
 * @param id
 * @param decidedBy
 * @param note
 */
function rejectOne(id: string, decidedBy: string, note: string | undefined): DecisionOutcome {
  const reserved = reserveApproval(id, decidedBy, { decision: 'rejected' }, note);
  if (isFailure(reserved)) {
    return reserved;
  }
  const policyFailure = writeDecisionPolicy(reserved, 'skip-current', {});
  if (policyFailure !== undefined) {
    return policyFailure;
  }

  completeDecision('update-rejected', reserved.container, reserved.record);
  return { kind: 'decided', record: reserved.record };
}

/**
 * Defer one queued update by snoozing the container until the same instant the row is
 * deferred to. The expiry is resolved by the caller before the row is reserved, so the row
 * and the container are written one value rather than two that agree today.
 * @param id
 * @param decidedBy
 * @param note
 * @param deferredUntil
 */
function deferOne(
  id: string,
  decidedBy: string,
  note: string | undefined,
  deferredUntil: string,
): DecisionOutcome {
  const reserved = reserveApproval(id, decidedBy, { decision: 'deferred', deferredUntil }, note);
  if (isFailure(reserved)) {
    return reserved;
  }
  const policyFailure = writeDecisionPolicy(reserved, 'snooze', { snoozeUntil: deferredUntil });
  if (policyFailure !== undefined) {
    return policyFailure;
  }

  completeDecision('update-deferred', reserved.container, reserved.record);
  return { kind: 'decided', record: reserved.record };
}

function sendDecisionOutcome(res: Response, outcome: DecisionOutcome): void {
  if (outcome.kind === 'rejected') {
    sendErrorResponse(res, outcome.statusCode, outcome.message);
    return;
  }
  res.status(200).json({ approval: outcome.record });
}

/**
 * Approve a queued update.
 * @param req
 * @param res
 */
async function approveApproval(req: DecisionRequest, res: Response): Promise<void> {
  if (!areContainerActionsEnabled()) {
    sendErrorResponse(res, 403, CONTAINER_ACTIONS_DISABLED_MESSAGE);
    return;
  }

  const request = readDecisionRequest(res, req.body, DECISION_BODY_FIELDS);
  if (request === undefined) {
    return;
  }

  const outcome = await approveOne(
    getPathParamValue(req.params.id),
    getDecidedBy(req),
    request.note,
  );
  sendContainerUpdateDispatchOutcome(res, outcome);
}

/**
 * Reject a queued update.
 * @param req
 * @param res
 */
function rejectApproval(req: DecisionRequest, res: Response): void {
  const request = readDecisionRequest(res, req.body, DECISION_BODY_FIELDS);
  if (request === undefined) {
    return;
  }

  sendDecisionOutcome(
    res,
    rejectOne(getPathParamValue(req.params.id), getDecidedBy(req), request.note),
  );
}

/**
 * Defer a queued update.
 *
 * There is no sweep and no timer: a row is deferred while `deferredUntil` is in the future
 * and pending again the moment it is not, which is also why an expiry in the past is
 * refused rather than stored.
 * @param req
 * @param res
 */
function deferApproval(req: DecisionRequest, res: Response): void {
  const request = readDecisionRequest(res, req.body, DEFER_BODY_FIELDS);
  if (request === undefined) {
    return;
  }

  const expiry = resolveDeferralExpiry(request.body, Date.now());
  if ('error' in expiry) {
    sendErrorResponse(res, 400, expiry.error);
    return;
  }

  sendDecisionOutcome(
    res,
    deferOne(
      getPathParamValue(req.params.id),
      getDecidedBy(req),
      request.note,
      expiry.deferredUntil,
    ),
  );
}

/** The `ids` of a bulk body, deduplicated in order, or undefined when it is not valid. */
function parseBulkIds(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > APPROVAL_BULK_MAX_IDS ||
    value.some((id) => typeof id !== 'string' || id.trim() === '')
  ) {
    return undefined;
  }
  return [...new Set(value as string[])];
}

/**
 * Decide several queued updates in one call, mirroring `POST /containers/update`: a 200
 * with `accepted` and `rejected` lists, one entry per id, so a failure on one row never
 * hides the others.
 *
 * Each id goes through the single-row decision exactly as the per-row route runs it:
 * the same reservation, the same candidate binding, the same admission path, one audit
 * entry and one SSE event per decision that took effect, so a bulk decision cannot do
 * anything a sequence of single ones could not. Ids are processed one at a time on
 * purpose: approvals dispatch real updates and the admission gates are written for one
 * caller at a time. A deferral's expiry is resolved once, so every row in the call is
 * held to the same instant.
 * @param req
 * @param res
 */
async function bulkDecideApprovals(
  req: Request & AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const request = readDecisionRequest(res, req.body, BULK_BODY_FIELDS);
  if (request === undefined) {
    return;
  }

  const ids = parseBulkIds(request.body.ids);
  if (ids === undefined) {
    sendErrorResponse(res, 400, INVALID_BULK_IDS_MESSAGE);
    return;
  }

  const action = request.body.action;
  if (typeof action !== 'string' || !APPROVAL_BULK_ACTIONS.has(action)) {
    sendErrorResponse(res, 400, INVALID_BULK_ACTION_MESSAGE);
    return;
  }
  if (action !== 'defer' && (request.body.until !== undefined || request.body.days !== undefined)) {
    sendErrorResponse(res, 400, BULK_DEFER_ONLY_MESSAGE);
    return;
  }
  if (action === 'approve' && !areContainerActionsEnabled()) {
    sendErrorResponse(res, 403, CONTAINER_ACTIONS_DISABLED_MESSAGE);
    return;
  }

  let deferredUntil = '';
  if (action === 'defer') {
    const expiry = resolveDeferralExpiry(request.body, Date.now());
    if ('error' in expiry) {
      sendErrorResponse(res, 400, expiry.error);
      return;
    }
    deferredUntil = expiry.deferredUntil;
  }

  const decidedBy = getDecidedBy(req);
  const accepted: Array<Record<string, unknown>> = [];
  const rejected: Array<{ id: string; statusCode: number; message: string }> = [];

  for (const id of ids) {
    let outcome: DecisionOutcome | ApproveOutcome;
    if (action === 'approve') {
      outcome = await approveOne(id, decidedBy, request.note);
    } else if (action === 'reject') {
      outcome = rejectOne(id, decidedBy, request.note);
    } else {
      outcome = deferOne(id, decidedBy, request.note, deferredUntil);
    }

    if (outcome.kind === 'rejected') {
      rejected.push({ id, statusCode: outcome.statusCode, message: outcome.message });
      continue;
    }
    accepted.push({
      id,
      containerId: outcome.record.containerId,
      containerName: outcome.record.containerName,
      decision: outcome.record.decision,
      ...(outcome.record.operationId !== undefined
        ? { operationId: outcome.record.operationId }
        : {}),
      ...(outcome.record.deferredUntil !== undefined
        ? { deferredUntil: outcome.record.deferredUntil }
        : {}),
    });
  }

  res.status(200).json({ message: BULK_PROCESSED_MESSAGE, accepted, rejected });
}

const confirmBulkApprove = requireDestructiveActionConfirmation(BULK_APPROVE_CONFIRMATION);

/**
 * Only the approve action dispatches updates, so only it is destructive: it can start an
 * arbitrary number of container recreations in one call. Reject and defer write policy that
 * the update-policy panel undoes, and need no header.
 */
function requireBulkApproveConfirmation(req: Request, res: Response, next: NextFunction): void {
  if (req.body?.action === 'approve') {
    confirmBulkApprove(req, res, next);
    return;
  }
  next();
}

/**
 * Init Router.
 */
export function init() {
  router.use(nocache());
  router.get('/', scoped('read', getApprovals));
  // Ahead of /:id, which would otherwise capture it as an approval id.
  router.get('/summary', scoped('read', getApprovalSummary));
  router.get('/:id', scoped('read', getApproval));
  // Deciding a queued update is `containers:update`, not `admin`: a key with
  // that scope can already run the update outright via
  // POST /containers/:id/update, so approving one it was offered cannot
  // reasonably require more. Reject and defer are decisions on the same queue
  // and travel with it — none of the three is reachable with `read` alone.
  // Ahead of the `/:id/...` routes for readability only; the segment counts differ.
  // Same scope as the single decisions, so a key that can approve one row can approve many.
  router.post(
    '/bulk',
    requireBulkApproveConfirmation,
    scoped('containers:update', bulkDecideApprovals),
  );
  router.post('/:id/approve', scoped('containers:update', approveApproval));
  router.post('/:id/reject', scoped('containers:update', rejectApproval));
  router.post('/:id/defer', scoped('containers:update', deferApproval));
  return router;
}
