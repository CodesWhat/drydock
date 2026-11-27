import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { sanitizeLogParam } from '../log/sanitize.js';
import {
  getOperationById,
  requestOperationCancellation,
  toApiUpdateOperation,
} from '../store/update-operation.js';
import { recordAuditEvent } from './audit-events.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';
import { scoped } from './route-scopes.js';

const router = express.Router();

function cancelOperation(req: Request<{ id: string }>, res: Response) {
  try {
    const { id } = req.params;
    const existing = getOperationById(id);
    if (!existing) {
      sendErrorResponse(res, 404, 'Operation not found');
      return;
    }
    if (existing.status !== 'queued' && existing.status !== 'in-progress') {
      res.status(409).json({ error: 'Operation is not active', status: existing.status });
      return;
    }
    const result = requestOperationCancellation(id);
    if (!result) {
      sendErrorResponse(res, 404, 'Operation not found');
      return;
    }
    recordAuditEvent({
      action: 'operation-cancelled',
      status: 'success',
      containerName: existing.containerName,
      details: `operation=${sanitizeLogParam(id)}; outcome=${result.outcome}`,
    });
    if (result.outcome === 'cancelled') {
      res.status(200).json({ data: toApiUpdateOperation(result.operation) });
      return;
    }
    res.status(202).json({ data: toApiUpdateOperation(result.operation) });
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

export function init() {
  router.use(nocache());
  router.post('/:id/cancel', scoped('containers:update', cancelOperation));
  return router;
}
