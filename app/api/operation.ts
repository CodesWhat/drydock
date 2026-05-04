import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { getOperationById, requestOperationCancellation } from '../store/update-operation.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';

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
    if (result.outcome === 'cancelled') {
      res.status(200).json({ data: result.operation });
      return;
    }
    res.status(202).json({ data: result.operation });
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

export function init() {
  router.use(nocache());
  router.post('/:id/cancel', cancelOperation);
  return router;
}
