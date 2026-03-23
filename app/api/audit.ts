import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import * as storeAudit from '../store/audit.js';
import { sendErrorResponse } from './error-response.js';
import { buildPaginationLinks } from './pagination-links.js';

const router = express.Router();
const SAFE_AUDIT_FILTER_PATTERN = /^[a-zA-Z0-9._-]+$/;

type AuditEntriesQuery = {
  skip: number;
  limit: number;
  action?: string;
  actions?: string[];
  container?: string;
  from?: string;
  to?: string;
};

function getValidatedAuditFilter(value: unknown): string | undefined | null {
  if (value == null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    return null;
  }
  if (!SAFE_AUDIT_FILTER_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function getValidatedDateQueryParam(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') {
    return undefined;
  }
  return value;
}

function getQueryStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

/**
 * Get audit log entries.
 * @param req
 * @param res
 */
function getAuditEntries(req: Request, res: Response) {
  const parsedOffset = Number.parseInt(getQueryStringValue(req.query.offset) || '', 10);
  const parsedLimit = Number.parseInt(getQueryStringValue(req.query.limit) || '', 10);
  const offset = Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0);
  const limit = Math.min(200, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 50));
  const skip = offset;

  const action = getValidatedAuditFilter(req.query.action);
  if (action === null) {
    sendErrorResponse(res, 400, 'Invalid action query parameter');
    return;
  }

  const actionsParam = getQueryStringValue(req.query.actions);
  let validatedActions: string[] | undefined;
  if (actionsParam) {
    const actionsList = actionsParam.split(',').filter((a) => a.length > 0);
    for (const a of actionsList) {
      if (!SAFE_AUDIT_FILTER_PATTERN.test(a)) {
        sendErrorResponse(res, 400, 'Invalid actions query parameter');
        return;
      }
    }
    validatedActions = actionsList.length > 0 ? actionsList : undefined;
  }

  const container = getValidatedAuditFilter(req.query.container);
  if (container === null) {
    sendErrorResponse(res, 400, 'Invalid container query parameter');
    return;
  }

  const query: AuditEntriesQuery = { skip, limit };
  if (action) {
    query.action = action;
  }
  if (validatedActions) {
    query.actions = validatedActions;
  }
  if (container) {
    query.container = container;
  }

  const from = getValidatedDateQueryParam(req.query.from);
  const to = getValidatedDateQueryParam(req.query.to);
  if (from) {
    query.from = from;
  }
  if (to) {
    query.to = to;
  }

  const result = storeAudit.getAuditEntries(query);
  const data = result.entries;
  const hasMore = offset + data.length < result.total;
  const links = buildPaginationLinks({
    basePath: '/api/audit',
    query: req.query,
    limit,
    offset,
    total: result.total,
    returnedCount: data.length,
  });
  res.status(200).json({
    data,
    total: result.total,
    limit,
    offset,
    hasMore,
    ...(links ? { _links: links } : {}),
  });
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', getAuditEntries);
  return router;
}
