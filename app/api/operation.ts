import express from 'express';
import nocache from 'nocache';
import { cancelQueuedOperation, getOperationById } from '../store/update-operation.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';

const router = express.Router();

function cancelOperation(req, res) {
  try {
    const { id } = req.params;
    const existing = getOperationById(id);
    if (!existing) {
      sendErrorResponse(res, 404, 'Operation not found');
      return;
    }
    if (existing.status !== 'queued') {
      res.status(409).json({ error: 'Operation is not queued', status: existing.status });
      return;
    }
    const cancelled = cancelQueuedOperation(id);
    res.status(200).json({ data: cancelled });
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

export function init() {
  router.use(nocache());
  router.post('/:id/cancel', cancelOperation);
  return router;
}
