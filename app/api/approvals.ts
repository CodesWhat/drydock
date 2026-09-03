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
 * Every decision reserves the row before it does any of that. The reservation is a
 * compare-and-set on semantic pending state, taken before anything is awaited, so two
 * operators approving at once produce one operation and one 409 rather than two accepted
 * requests whose second update fails later on the active-operation gate. A reservation
 * whose work is then refused is rolled back, leaving the row exactly as it was.
 */
import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { announceApprovalEvent } from '../approvals/events.js';
import type { ApprovalRecord, ApprovalSemverDiff } from '../model/approval.js';
import type { AuditEntry } from '../model/audit.js';
import type { Container } from '../model/container.js';
import { computeUpdateEligibility, getSoftBlockers } from '../model/update-eligibility.js';
import {
  type ApprovalPatch,
  type ApprovalStatusFilter,
  countApprovals,
  decideApprovalIfPending,
  getApprovalById,
  listApprovals,
  resetApprovalToPending,
  updateApproval,
} from '../store/approval.js';
import { getContainer } from '../store/container.js';
import { recordAuditEvent } from './audit-events.js';
import { getPathParamValue, normalizeLimitOffsetPagination } from './container/request-helpers.js';
import { resolveSnoozeUntilFromPayload } from './container/update-policy.js';
import { applyContainerUpdatePolicyAction } from './container/update-policy-writer.js';
import {
  areContainerActionsEnabled,
  CONTAINER_ACTIONS_DISABLED_MESSAGE,
  CONTAINER_NOT_FOUND_MESSAGE,
  dispatchManualContainerUpdate,
  sendContainerUpdateDispatchOutcome,
} from './container-update-dispatch.js';
import { sendErrorResponse } from './error-response.js';
import { buildPaginationLinks } from './pagination-links.js';
import { buildEligibilityContext } from './sse-container-enrichment.js';

const router = express.Router();

const APPROVAL_BASE_PATH = '/api/v1/approvals';
const APPROVAL_LIST_MAX_LIMIT = 200;
const APPROVAL_SEARCH_MAX_LENGTH = 200;
const APPROVAL_STATUS_FILTERS = new Set<string>(['pending', 'deferred', 'decided', 'all']);
const APPROVAL_NOTE_MAX_LENGTH = 500;
const APPROVAL_NOT_FOUND_MESSAGE = 'Approval not found';
const APPROVAL_ALREADY_DECIDED_MESSAGE = 'Approval already decided';
const INVALID_NOTE_MESSAGE = `Invalid note; expected a string of at most ${APPROVAL_NOTE_MAX_LENGTH} characters`;
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

/** A request carrying whoever the authentication middleware resolved, if anyone. */
type DecisionRequest = Request<{ id: string }> & { user?: { username?: string } };

/** A row reserved for one decision, with the container that decision acts on. */
interface ReservedApproval {
  record: ApprovalRecord;
  container: Container;
}

function getDecisionBody(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

/**
 * The operator this decision is recorded against. `req.user` is undefined for a real
 * anonymous session — passport-anonymous passes with no arguments rather than
 * synthesizing a user — so the fallback is the same literal the rest of the API uses.
 * @param req
 */
function getDecidedBy(req: DecisionRequest): string {
  return req.user?.username?.trim() || 'anonymous';
}

/** `null` means present and invalid, which the caller turns into a 400. */
function getValidatedNote(body: Record<string, unknown>): string | undefined | null {
  const note = body.note;
  if (note === undefined || note === null) {
    return undefined;
  }
  if (typeof note !== 'string' || note.length > APPROVAL_NOTE_MAX_LENGTH) {
    return null;
  }
  const trimmed = note.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Take the row for one decision, or answer why it could not be taken.
 *
 * The reservation is written before the caller does anything that yields, which is what
 * makes a double approve safe: the second request finds the row no longer pending and is
 * told so, instead of both requests passing a read and the second update failing later on
 * the active-operation gate with a message about queued operations.
 *
 * The container is resolved after the reservation rather than before, so there is one
 * ordering for every decision and one rollback path. A row whose container is gone has
 * already been resolved `container-removed` by the reconciler in the normal case; this
 * answers the race where it has not.
 * @param req
 * @param res
 * @param patch
 */
function reserveApproval(
  req: DecisionRequest,
  res: Response,
  patch: ApprovalPatch,
): ReservedApproval | undefined {
  const note = getValidatedNote(getDecisionBody(req.body));
  if (note === null) {
    sendErrorResponse(res, 400, INVALID_NOTE_MESSAGE);
    return undefined;
  }

  const transition = decideApprovalIfPending(getPathParamValue(req.params.id), {
    ...patch,
    decidedAt: new Date().toISOString(),
    decidedBy: getDecidedBy(req),
    ...(note !== undefined ? { decisionNote: note } : {}),
  });

  if (transition.status === 'not-found') {
    sendErrorResponse(res, 404, APPROVAL_NOT_FOUND_MESSAGE);
    return undefined;
  }
  if (transition.status === 'already-decided') {
    sendErrorResponse(res, 409, APPROVAL_ALREADY_DECIDED_MESSAGE);
    return undefined;
  }

  const container = getContainer(transition.record.containerId);
  if (container === undefined) {
    abandonReservation(res, transition.record, 404, CONTAINER_NOT_FOUND_MESSAGE);
    return undefined;
  }

  return { record: transition.record, container };
}

/**
 * Put a reserved row back in the queue and answer with the reason its work was refused.
 * A decision that did not take effect leaves no trace: the operator can fix the blocker
 * and decide again, and the row's `createdAt` still says how long it has been waiting.
 * @param res
 * @param record
 * @param statusCode
 * @param message
 */
function abandonReservation(
  res: Response,
  record: ApprovalRecord,
  statusCode: number,
  message: string,
): void {
  resetApprovalToPending(record.id);
  sendErrorResponse(res, statusCode, message);
}

/**
 * Write the container policy a decision delegates to. Returns false when it answered with
 * the policy layer's own error, which is the same message and status the container panel
 * would show for the same action.
 * @param res
 * @param reserved
 * @param action
 * @param body
 */
function writeDecisionPolicy(
  res: Response,
  reserved: ReservedApproval,
  action: string,
  body: Record<string, unknown>,
): boolean {
  const result = applyContainerUpdatePolicyAction(reserved.container, action, body);
  if ('error' in result) {
    abandonReservation(res, reserved.record, 400, result.error);
    return false;
  }
  return true;
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
 * Approve a queued update: dispatch it exactly as the container panel's Update button
 * does, and answer exactly what that endpoint answers.
 *
 * Every rejection here is the admission path's own, re-evaluated now rather than when the
 * row was sighted — the row is a pointer at a candidate, never a capability, so there is
 * no window between sighting and approval in which the queue could admit something the
 * Update button would refuse. Under `updateMode: notify` that means the existing 409, and
 * nothing is dispatched.
 * @param req
 * @param res
 */
async function approveApproval(req: DecisionRequest, res: Response): Promise<void> {
  if (!areContainerActionsEnabled()) {
    sendErrorResponse(res, 403, CONTAINER_ACTIONS_DISABLED_MESSAGE);
    return;
  }

  const reserved = reserveApproval(req, res, { decision: 'approved' });
  if (reserved === undefined) {
    return;
  }

  const outcome = await dispatchManualContainerUpdate(reserved.container);
  if (outcome.kind === 'rejected') {
    resetApprovalToPending(reserved.record.id);
  } else {
    updateApproval(reserved.record.id, { operationId: outcome.operationId });
    completeDecision('update-approved', reserved.container, {
      ...reserved.record,
      operationId: outcome.operationId,
    });
  }

  sendContainerUpdateDispatchOutcome(res, outcome);
}

/**
 * Reject a queued update by writing the container's existing skip policy. This is the
 * same operation as the container panel's Skip button, one source of truth, undoable from
 * the update-policy panel — and visible there, which is a thing the confirmation copy has
 * to say out loud.
 * @param req
 * @param res
 */
function rejectApproval(req: DecisionRequest, res: Response): void {
  const reserved = reserveApproval(req, res, { decision: 'rejected' });
  if (reserved === undefined) {
    return;
  }
  if (!writeDecisionPolicy(res, reserved, 'skip-current', {})) {
    return;
  }

  completeDecision('update-rejected', reserved.container, reserved.record);
  res.status(200).json({ approval: reserved.record });
}

/**
 * Defer a queued update by snoozing the container until the same instant the row is
 * deferred to.
 *
 * The expiry is resolved before the row is reserved so both carry one value, and it is
 * resolved by the snooze primitive's own parser, so a payload the container panel would
 * refuse is refused here with the same message. There is no sweep and no timer: a row is
 * deferred while `deferredUntil` is in the future and pending again the moment it is not.
 * @param req
 * @param res
 */
function deferApproval(req: DecisionRequest, res: Response): void {
  const body = getDecisionBody(req.body);
  const snooze = resolveSnoozeUntilFromPayload({ snoozeUntil: body.until, days: body.days });
  if ('error' in snooze) {
    sendErrorResponse(res, 400, snooze.error);
    return;
  }

  const reserved = reserveApproval(req, res, {
    decision: 'deferred',
    deferredUntil: snooze.snoozeUntil,
  });
  if (reserved === undefined) {
    return;
  }
  if (!writeDecisionPolicy(res, reserved, 'snooze', { snoozeUntil: snooze.snoozeUntil })) {
    return;
  }

  completeDecision('update-deferred', reserved.container, reserved.record);
  res.status(200).json({ approval: reserved.record });
}

/**
 * Init Router.
 */
export function init() {
  router.use(nocache());
  router.get('/', getApprovals);
  // Ahead of /:id, which would otherwise capture it as an approval id.
  router.get('/summary', getApprovalSummary);
  router.get('/:id', getApproval);
  router.post('/:id/approve', approveApproval);
  router.post('/:id/reject', rejectApproval);
  router.post('/:id/defer', deferApproval);
  return router;
}
