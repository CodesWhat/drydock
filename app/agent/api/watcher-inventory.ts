import type { Request, Response } from 'express';
import { sendErrorResponse } from '../../api/error-response.js';
import * as registry from '../../registry/index.js';
import {
  InventoryRefreshOperationError,
  type InventoryRefreshProvider,
  runInventoryRefresh,
  sanitizeInventoryErrors,
} from '../../watchers/inventory-refresh.js';

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function refreshWatcherInventory(req: Request, res: Response): Promise<void> {
  const body = req.body;
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof body.operationId !== 'string' ||
    !OPERATION_ID.test(body.operationId)
  ) {
    sendErrorResponse(res, 400, 'Inventory refresh requires a valid operationId');
    return;
  }
  const id = `${req.params.type}.${req.params.name}`;
  const watcher = registry.getState().watcher[id] as InventoryRefreshProvider | undefined;
  if (!watcher) {
    sendErrorResponse(res, 404, 'Component not found');
    return;
  }
  const cancellation = new AbortController();
  const abort = () => {
    if (!res.writableEnded) cancellation.abort();
  };
  req.once('aborted', abort);
  res.once('close', abort);
  try {
    const result = await runInventoryRefresh(watcher, {
      operationId: body.operationId,
      signal: cancellation.signal,
      isCurrent: () => registry.getState().watcher[id] === watcher,
    });
    if (!res.destroyed && !res.writableEnded) {
      res.status(200).json({ ...result, errors: sanitizeInventoryErrors(result.errors) });
    }
  } catch (error) {
    if (!res.destroyed && !res.writableEnded) {
      sendErrorResponse(
        res,
        error instanceof InventoryRefreshOperationError ? error.status : 500,
        error instanceof InventoryRefreshOperationError
          ? error.message
          : 'Inventory refresh failed',
      );
    }
  } finally {
    cancellation.abort();
    req.off('aborted', abort);
    res.off('close', abort);
  }
}
