import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import type { AuditEntry } from '../model/audit.js';
import * as storeAudit from '../store/audit.js';
import { sendErrorResponse } from './error-response.js';
import { buildPaginationLinks } from './pagination-links.js';
import { scoped } from './route-scopes.js';

const router = express.Router();
// Stryker disable next-line Regex: validation behavior is covered by route tests, but module-scope regex mutants survive under the vitest runner.
const SAFE_AUDIT_FILTER_PATTERN = /^[a-zA-Z0-9._-]+$/;
// Requires the entire string to be an optional minus sign followed by one or more digits, so a
// numeric-prefix string like '25logs' or '10ms' is rejected rather than silently truncated
// by Number.parseInt. Mirrors SAFE_LOG_INTEGER_PATTERN in app/api/log.ts, but offset/limit
// keep audit's existing fallback-to-default contract instead of 400ing: an unparseable value
// is treated the same as an absent one (falls back to the default) rather than erroring, so
// this only closes the truncation/precision-loss hole without changing the response shape.
// A leading `+` is deliberately not accepted: it's form-encoding for a space in a query
// string, so `?limit=+5` arrives as `" 5"` and only the `%2B5` spelling would ever reach the
// validator as `"+5"`; accepting `[+-]?` would make acceptance depend on how the client
// encoded the sign, and restoring both spellings would need a trim, which is the exact thing
// this pattern exists to stop (`?limit=%205`).
const SAFE_AUDIT_INTEGER_PATTERN = /^-?\d+$/;

type AuditEntriesQuery = {
  skip: number;
  limit: number;
  action?: string;
  actions?: string[];
  container?: string;
  actor?: string;
  from?: string;
  to?: string;
};

const MAX_AUDIT_ACTOR_LENGTH = 200;
// Usernames can carry spaces, dots, @ and unicode, so the actor filter can't use the
// strict identifier pattern the action and container filters do. It is only ever bound
// as a SQL parameter; this just rejects control characters and absurd lengths.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const AUDIT_ACTOR_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const AUDIT_EXPORT_MAX_ROWS = 100_000;
const AUDIT_EXPORT_FORMATS = ['csv', 'json'] as const;
const AUDIT_EXPORT_CSV_COLUMNS = [
  'id',
  'timestamp',
  'actor',
  'actorRole',
  'action',
  'containerName',
  'containerIdentityKey',
  'containerImage',
  'fromVersion',
  'toVersion',
  'updateKind',
  'semverDiff',
  'triggerName',
  'status',
  'details',
] as const satisfies readonly (keyof AuditEntry)[];
// A cell that opens with one of these is read as a formula by spreadsheet apps.
const CSV_FORMULA_TRIGGER_PATTERN = /^[=+\-@\t\r]/;
const CSV_QUOTE_REQUIRED_PATTERN = /[",\r\n]/;

function getValidatedActorFilter(value: unknown): string | undefined | null {
  if (value == null || value === '') {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    value.length > MAX_AUDIT_ACTOR_LENGTH ||
    AUDIT_ACTOR_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }
  return value;
}

function escapeCsvCell(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  let text = String(value);
  if (CSV_FORMULA_TRIGGER_PATTERN.test(text)) {
    text = `'${text}`;
  }
  return CSV_QUOTE_REQUIRED_PATTERN.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function auditEntriesToCsv(entries: AuditEntry[]): string {
  const rows = [AUDIT_EXPORT_CSV_COLUMNS.join(',')];
  for (const entry of entries) {
    rows.push(AUDIT_EXPORT_CSV_COLUMNS.map((column) => escapeCsvCell(entry[column])).join(','));
  }
  return `${rows.join('\r\n')}\r\n`;
}

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

function parseOptionalIntegerQueryParam(value: unknown): number {
  const stringValue = getQueryStringValue(value);
  if (stringValue === undefined || !SAFE_AUDIT_INTEGER_PATTERN.test(stringValue)) {
    return Number.NaN;
  }
  const parsed = Number(stringValue);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

/**
 * Validate the filter query parameters shared by the list and export routes.
 * Answers 400 itself and returns undefined when one is invalid.
 */
function parseAuditFilters(
  req: Request,
  res: Response,
): Omit<AuditEntriesQuery, 'skip' | 'limit'> | undefined {
  const action = getValidatedAuditFilter(req.query.action);
  if (action === null) {
    sendErrorResponse(res, 400, 'Invalid action query parameter');
    return undefined;
  }

  const actionsParam = getQueryStringValue(req.query.actions);
  let validatedActions: string[] | undefined;
  if (actionsParam) {
    const actionsList = actionsParam.split(',').filter((a) => a.length > 0);
    for (const a of actionsList) {
      if (!SAFE_AUDIT_FILTER_PATTERN.test(a)) {
        sendErrorResponse(res, 400, 'Invalid actions query parameter');
        return undefined;
      }
    }
    validatedActions = actionsList.length > 0 ? actionsList : undefined;
  }

  const container = getValidatedAuditFilter(req.query.container);
  if (container === null) {
    sendErrorResponse(res, 400, 'Invalid container query parameter');
    return undefined;
  }

  const actor = getValidatedActorFilter(req.query.actor);
  if (actor === null) {
    sendErrorResponse(res, 400, 'Invalid actor query parameter');
    return undefined;
  }

  const query: Omit<AuditEntriesQuery, 'skip' | 'limit'> = {};
  if (action !== undefined) {
    query.action = action;
  }
  if (validatedActions !== undefined) {
    query.actions = validatedActions;
  }
  if (container !== undefined) {
    query.container = container;
  }
  if (actor !== undefined) {
    query.actor = actor;
  }

  const from = getValidatedDateQueryParam(req.query.from);
  const to = getValidatedDateQueryParam(req.query.to);
  if (from !== undefined) {
    query.from = from;
  }
  if (to !== undefined) {
    query.to = to;
  }
  return query;
}

/**
 * Get audit log entries.
 * @param req
 * @param res
 */
function getAuditEntries(req: Request, res: Response) {
  const parsedOffset = parseOptionalIntegerQueryParam(req.query.offset);
  const parsedLimit = parseOptionalIntegerQueryParam(req.query.limit);
  const offset = Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0);
  const limit = Math.min(200, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 50));
  const skip = offset;

  const filters = parseAuditFilters(req, res);
  if (filters === undefined) {
    return;
  }
  const query: AuditEntriesQuery = { skip, limit, ...filters };

  const result = storeAudit.getAuditEntries(query);
  const data = result.entries;
  const hasMore = offset + data.length < result.total;
  const links = buildPaginationLinks({
    basePath: '/api/v1/audit',
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
 * Export every audit entry matching the list filters (not paginated, capped at
 * AUDIT_EXPORT_MAX_ROWS) as CSV or JSON. Same `read` scope as the list route.
 * @param req
 * @param res
 */
function exportAuditEntries(req: Request, res: Response) {
  const format = getQueryStringValue(req.query.format) ?? 'csv';
  if (!(AUDIT_EXPORT_FORMATS as readonly string[]).includes(format)) {
    sendErrorResponse(res, 400, 'Invalid format query parameter');
    return;
  }
  const filters = parseAuditFilters(req, res);
  if (filters === undefined) {
    return;
  }

  const result = storeAudit.getAuditEntries({ ...filters, skip: 0, limit: AUDIT_EXPORT_MAX_ROWS });
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="drydock-audit-${stamp}.${format}"`);
  res.setHeader('X-Total-Count', String(result.total));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (format === 'json') {
    res.status(200).type('application/json').send(JSON.stringify(result.entries));
    return;
  }
  res.status(200).type('text/csv; charset=utf-8').send(auditEntriesToCsv(result.entries));
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', scoped('read', getAuditEntries));
  router.get('/export', scoped('read', exportAuditEntries));
  return router;
}
