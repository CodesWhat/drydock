import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { getFreshSelfUpdateOperationById } from '../store/update-operation.js';
import { sendErrorResponse } from './error-response.js';

const router = express.Router();

function getSelfUpdateOperationStatus(req: Request, res: Response): void {
  const rawId = req.params.operationId;
  if (typeof rawId !== 'string' || rawId.trim() === '') {
    sendErrorResponse(res, 400, 'operationId is required');
    return;
  }

  const op = getFreshSelfUpdateOperationById(rawId.trim());
  if (!op) {
    sendErrorResponse(res, 404, 'Self-update operation not found');
    return;
  }

  res.status(200).json({
    operationId: op.id,
    status: op.status,
    phase: op.phase,
    ...(op.completedAt ? { completedAt: op.completedAt } : {}),
  });
}

export function init() {
  router.use(nocache());
  router.get('/:operationId/status', getSelfUpdateOperationStatus);
  return router;
}
