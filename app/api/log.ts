import express from 'express';
import nocache from 'nocache';
import { getLogBufferEnabled, getLogLevel } from '../configuration/index.js';
import { getEntries } from '../log/buffer.js';

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
    res.status(400).json({ error: 'Invalid level query parameter' });
    return;
  }

  const component = getValidatedLogComponent(req.query.component);
  if (component === null) {
    res.status(400).json({ error: 'Invalid component query parameter' });
    return;
  }

  const tail = req.query.tail ? Number.parseInt(req.query.tail as string, 10) : undefined;
  const since = req.query.since ? Number.parseInt(req.query.since as string, 10) : undefined;
  const entries = getEntries({ level, component, tail, since });
  res.status(200).json(entries);
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', getLog);
  router.get('/entries', getLogEntries);
  return router;
}
