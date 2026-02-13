import express from 'express';
import nocache from 'nocache';
import * as storeAudit from '../store/audit.js';

var router = express.Router();

/**
 * Get audit log entries.
 * @param req
 * @param res
 */
function getAuditEntries(req, res) {
  var parsedPage = Number.parseInt(req.query.page, 10);
  var parsedLimit = Number.parseInt(req.query.limit, 10);
  var page = Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1);
  var limit = Math.min(200, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 50));
  var skip = (page - 1) * limit;

  var query: Record<string, any> = { skip, limit };
  if (req.query.action) {
    query.action = req.query.action;
  }
  if (req.query.container) {
    query.container = req.query.container;
  }
  if (req.query.from) {
    query.from = req.query.from;
  }
  if (req.query.to) {
    query.to = req.query.to;
  }

  var result = storeAudit.getAuditEntries(query);
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
