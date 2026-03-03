import express from 'express';
import nocache from 'nocache';
import { getLogLevel } from '../configuration/index.js';
import { getEntries } from '../log/buffer.js';

const router = express.Router();

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
  const level = req.query.level as string | undefined;
  const component = req.query.component as string | undefined;
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
