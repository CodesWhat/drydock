import express from 'express';
import nocache from 'nocache';
import { getLogBufferEnabled, getLogLevel } from '../configuration/index.js';
import { getComponents, getEntries } from '../log/buffer.js';
import { toDisplayLogEntry } from '../log/display-timestamp.js';
import { sendErrorResponse } from './error-response.js';

const router = express.Router();
const ALLOWED_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const SAFE_LOG_COMPONENT_PATTERN = /^[a-zA-Z0-9._-]+$/;
// Requires the entire string to be an optional minus sign followed by one or more digits, so a
// numeric-prefix string like '25logs' or '1000ms' is rejected rather than silently truncated
// by Number.parseInt. Negative values are intentionally still accepted here — see
// getValidatedLogInteger below. A leading `+` is deliberately not accepted: it's
// form-encoding for a space in a query string, so `?tail=+5` arrives as `" 5"` and only the
// `%2B5` spelling would ever reach the validator as `"+5"`; accepting `[+-]?` would make
// acceptance depend on how the client encoded the sign, and restoring both spellings would
// need a trim, which is the exact thing this pattern exists to stop (`?tail=%205`).
const SAFE_LOG_INTEGER_PATTERN = /^-?\d+$/;

function getValidatedLogLevel(level: unknown): string | undefined | null {
  if (level == null) {
    return undefined;
  }
  if (typeof level !== 'string') {
    return null;
  }
  const normalizedLevel = level.toLowerCase();
  if (!ALLOWED_LOG_LEVELS.has(normalizedLevel)) {
    return null;
  }
  return normalizedLevel;
}

function getValidatedLogComponent(component: unknown): string | undefined | null {
  if (component == null) {
    return undefined;
  }
  if (typeof component !== 'string') {
    return null;
  }
  if (!SAFE_LOG_COMPONENT_PATTERN.test(component)) {
    return null;
  }
  return component;
}

function getValidatedLogInteger(value: unknown): number | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }
  // The whole string must be a complete integer literal — no leading/trailing whitespace,
  // no decimal point, no exponent, no hex/octal prefix, no partial-numeric-prefix garbage
  // (e.g. '25logs', '1000ms'). Number.parseInt would silently truncate those to a valid
  // number instead of rejecting them, which is exactly the hole this closes.
  // Negative values (e.g. '-5') are deliberately still accepted: app/log/buffer.ts's
  // applyTail() treats a negative tail as "return no entries" rather than erroring or
  // reading out of bounds, so there's no unsafe behavior downstream to guard against, and
  // rejecting sign is a separate behavior change from the reported bug.
  if (typeof value !== 'string' || !SAFE_LOG_INTEGER_PATTERN.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Get log infos.
 * @param req
 * @param res
 */
function getLog(req, res) {
  res.status(200).json({
    level: getLogLevel(),
  });
}

/**
 * Get log entries from ring buffer.
 * @param req
 * @param res
 */
function getLogEntries(req, res) {
  if (!getLogBufferEnabled()) {
    res.status(200).json([]);
    return;
  }

  const level = getValidatedLogLevel(req.query.level);
  if (level === null) {
    sendErrorResponse(res, 400, 'Invalid level query parameter');
    return;
  }

  const component = getValidatedLogComponent(req.query.component);
  if (component === null) {
    sendErrorResponse(res, 400, 'Invalid component query parameter');
    return;
  }

  const tail = getValidatedLogInteger(req.query.tail);
  if (tail === null) {
    sendErrorResponse(res, 400, 'Invalid tail query parameter');
    return;
  }

  const since = getValidatedLogInteger(req.query.since);
  if (since === null) {
    sendErrorResponse(res, 400, 'Invalid since query parameter');
    return;
  }

  const entries = getEntries({ level, component, tail, since }).map((entry) =>
    toDisplayLogEntry(entry),
  );
  res.status(200).json(entries);
}

/**
 * Get unique component names from the log ring buffer.
 */
function getLogComponents(_req, res) {
  if (!getLogBufferEnabled()) {
    res.status(200).json([]);
    return;
  }
  res.status(200).json(getComponents());
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', getLog);
  router.get('/entries', getLogEntries);
  router.get('/components', getLogComponents);
  return router;
}
