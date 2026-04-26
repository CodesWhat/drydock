import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import * as updateOperationStore from '../store/update-operation.js';
import { sendErrorResponse } from './error-response.js';

const router = express.Router();

function getUpdateOperationById(req: Request, res: Response) {
  const rawId = req.params.id;
  if (typeof rawId !== 'string' || rawId.trim() === '') {
    sendErrorResponse(res, 400, 'Operation id is required');
    return;
  }

  const operation = updateOperationStore.getOperationById(rawId.trim());
  if (!operation) {
    sendErrorResponse(res, 404, 'Update operation not found');
    return;
  }

  res.status(200).json(operation);
}

export function init() {
  router.use(nocache());
  router.get('/:id', getUpdateOperationById);
  return router;
}
