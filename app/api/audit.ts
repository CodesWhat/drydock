import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import * as storeAudit from '../store/audit.js';

const router = express.Router();
const SAFE_AUDIT_FILTER_PATTERN = /^[a-zA-Z0-9._-]+$/;

type AuditEntriesQuery = {
  skip: number;
  limit: number;
  action?: string;
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
  const parsedPage = Number.parseInt(getQueryStringValue(req.query.page) || '', 10);
  const parsedLimit = Number.parseInt(getQueryStringValue(req.query.limit) || '', 10);
  const page = Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1);
  const limit = Math.min(200, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 50));
  const skip = (page - 1) * limit;

  const action = getValidatedAuditFilter(req.query.action);
  if (action === null) {
    return res.status(400).json({ error: 'Invalid action query parameter' });
  }

  const container = getValidatedAuditFilter(req.query.container);
  if (container === null) {
    return res.status(400).json({ error: 'Invalid container query parameter' });
  }

  const query: AuditEntriesQuery = { skip, limit };
  if (action) {
    query.action = action;
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
  res.status(200).json({
    entries: result.entries,
    total: result.total,
    page,
    limit,
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
