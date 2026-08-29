/**
 * Pending-approval read API (spec-ca-2-approval-queue.md, slice 3).
 *
 * Read-only by design: this slice exposes the ledger the reconciler maintains and nothing
 * else. Decisions (approve / reject / defer) are the next slice's, and they delegate to
 * the existing update, skip and snooze primitives rather than inventing an admission path
 * here.
 *
 * The ledger stores the decision; the candidate set stays derived. So the list returns
 * stored rows verbatim and the detail route computes eligibility and hold reasons live
 * from the container, which means a soft blocker that lifted a second ago is already gone
 * from the response and no stale copy of it was ever written to a row.
 */
import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import type { ApprovalSemverDiff } from '../model/approval.js';
import { computeUpdateEligibility, getSoftBlockers } from '../model/update-eligibility.js';
import {
  type ApprovalStatusFilter,
  countApprovals,
  getApprovalById,
  listApprovals,
} from '../store/approval.js';
import { getContainer } from '../store/container.js';
import { getPathParamValue, normalizeLimitOffsetPagination } from './container/request-helpers.js';
import { sendErrorResponse } from './error-response.js';
import { buildPaginationLinks } from './pagination-links.js';
import { buildEligibilityContext } from './sse-container-enrichment.js';

const router = express.Router();

const APPROVAL_BASE_PATH = '/api/v1/approvals';
const APPROVAL_LIST_MAX_LIMIT = 200;
const APPROVAL_SEARCH_MAX_LENGTH = 200;
const APPROVAL_STATUS_FILTERS = new Set<string>(['pending', 'deferred', 'decided', 'all']);
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

/**
 * Init Router.
 */
export function init() {
  router.use(nocache());
  router.get('/', getApprovals);
  // Ahead of /:id, which would otherwise capture it as an approval id.
  router.get('/summary', getApprovalSummary);
  router.get('/:id', getApproval);
  return router;
}
