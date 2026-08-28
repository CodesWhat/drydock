import express from 'express';
import nocache from 'nocache';
import { getLogBufferEnabled, getLogLevel } from '../configuration/index.js';
import { getComponents, getEntries } from '../log/buffer.js';
import { toDisplayLogEntry } from '../log/display-timestamp.js';
import { sendErrorResponse } from './error-response.js';

const router = express.Router();
const ALLOWED_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const SAFE_LOG_COMPONENT_PATTERN = /^[a-zA-Z0-9._-]+$/;

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
  if (!value) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
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
