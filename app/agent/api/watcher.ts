import type { Request, Response } from 'express';
import { mapComponentsToList } from '../../api/component.js';
import { sendErrorResponse } from '../../api/error-response.js';
import logger from '../../log/index.js';
import { sanitizeLogParam } from '../../log/sanitize.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';

const log = logger.child({ component: 'agent-api-watcher' });

interface ErrorWithMessage {
  message: string;
}

function hasStringMessage(value: unknown): value is ErrorWithMessage {
  if (typeof value !== 'object' || value === null || !('message' in value)) {
    return false;
  }
  const candidate = value as { message?: unknown };
  return typeof candidate.message === 'string';
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (hasStringMessage(error)) {
    return error.message;
  }
  return String(error);
}

/**
 * Get Watchers.
 */
export function getWatchers(req: Request, res: Response) {
  const localWatchers = registry.getState().watcher;
  const items = mapComponentsToList(localWatchers);
  res.json(items);
}

/**
 * Watch a specific watcher.
 */
export async function watchWatcher(req: Request, res: Response) {
  const type = req.params.type as string;
  const name = req.params.name as string;
  const watcherId = `${type.toLowerCase()}.${name.toLowerCase()}`;
  const watcher = registry.getState().watcher[watcherId];

  if (!watcher) {
    sendErrorResponse(res, 404, `Watcher ${name} not found`);
    return;
  }

  try {
    const results = await watcher.watch();
    res.json(results);
  } catch (e: unknown) {
    const errorMessage = normalizeErrorMessage(e);
    log.error(
      `Error watching watcher ${sanitizeLogParam(name)}: ${sanitizeLogParam(errorMessage)}`,
    );
    sendErrorResponse(res, 500, errorMessage);
  }
}

/**
 * Watch a specific container.
 */
export async function watchContainer(req: Request, res: Response) {
  const type = req.params.type as string;
  const name = req.params.name as string;
  const id = req.params.id as string;
  const watcherId = `${type.toLowerCase()}.${name.toLowerCase()}`;
  const watcher = registry.getState().watcher[watcherId];

  if (!watcher) {
    sendErrorResponse(res, 404, `Watcher ${name} not found`);
    return;
  }

  const container = storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, `Container ${id} not found in agent store`);
    return;
  }

  try {
    const result = await watcher.watchContainer(container);
    res.json(result);
  } catch (e: unknown) {
    const errorMessage = normalizeErrorMessage(e);
    log.error(
      `Error watching container ${sanitizeLogParam(id)}: ${sanitizeLogParam(errorMessage)}`,
    );
    sendErrorResponse(res, 500, errorMessage);
  }
}
