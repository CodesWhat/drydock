import type { Request, Response } from 'express';
import { getAgent } from '../agent/manager.js';
import type { InventoryRefreshResult } from '../model/inventory-refresh.js';
import * as registry from '../registry/index.js';
import {
  InventoryRefreshOperationError,
  type InventoryRefreshProvider,
  runInventoryRefresh,
} from '../watchers/inventory-refresh.js';
import { redactContainersRuntimeEnv } from './container/shared.js';
import { sendErrorResponse } from './error-response.js';

const SAFE_INVENTORY_MESSAGES: Record<InventoryRefreshResult['errors'][number]['phase'], string> = {
  store: 'Unable to read inventory state',
  enumerate: 'Unable to enumerate Docker containers',
  inspect: 'Unable to inspect this container',
  labels: 'Unable to read container labels',
  image: 'Unable to inspect the local image',
  ownership: 'Container identity or ownership changed',
  stale: 'Inventory request is no longer current',
  persist: 'Unable to save the observed inventory',
};

export function sanitizeInventoryResult(result: InventoryRefreshResult): InventoryRefreshResult {
  return {
    ...result,
    containers: redactContainersRuntimeEnv(result.containers),
    errors: result.errors.map(({ phase, id }) => ({
      phase,
      ...(id === undefined ? {} : { id }),
      message: SAFE_INVENTORY_MESSAGES[phase],
    })),
  };
}

export async function refreshWatcherInventory(
  req: Request<{ type: string; name: string; agent?: string }>,
  res: Response,
): Promise<void> {
  if (
    req.body !== undefined &&
    (!req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length > 0)
  ) {
    sendErrorResponse(res, 400, 'Inventory refresh accepts an empty request body');
    return;
  }
  const { type, name, agent } = req.params;
  const id = agent ? `${agent}.${type}.${name}` : `${type}.${name}`;
  const watcher = registry.getState().watcher[id] as InventoryRefreshProvider | undefined;
  if (!watcher) {
    sendErrorResponse(res, 404, 'Component not found');
    return;
  }
  const client = agent ? getAgent(agent) : undefined;
  if (agent && !client?.isConnected) {
    sendErrorResponse(res, 503, 'Agent is disconnected');
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
      signal: cancellation.signal,
      isCurrent: () =>
        registry.getState().watcher[id] === watcher &&
        (!agent || (getAgent(agent) === client && client?.isConnected === true)),
    });
    if (!res.destroyed && !res.writableEnded) res.status(200).json(sanitizeInventoryResult(result));
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
