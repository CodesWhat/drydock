import type { Request, Response } from 'express';
import { mapComponentsToList } from '../../api/component.js';
import { sendErrorResponse } from '../../api/error-response.js';
import * as triggerApi from '../../api/trigger.js';
import logger from '../../log/index.js';
import { sanitizeLogParam } from '../../log/sanitize.js';
import * as registry from '../../registry/index.js';

const log = logger.child({ component: 'agent-api-trigger' });

interface TriggerRouteParams {
  type: string;
  name: string;
}

function getErrorMessage(error: unknown): string | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return undefined;
}

/**
 * Get Triggers.
 */
export function getTriggers(req: Request, res: Response) {
  const localTriggers = registry.getState().trigger;
  const items = mapComponentsToList(localTriggers, 'trigger');
  res.json(items);
}

/**
 * Run Remote Trigger.
 * Delegates to the common API handler but ensures no proxying happens.
 */
export async function runTrigger(req: Request, res: Response) {
  if (req.body?.agent) {
    delete req.body.agent;
  }
  return triggerApi.runTrigger(req as unknown as Request<TriggerRouteParams>, res);
}

/**
 * Run Remote Trigger Batch.
 */
export async function runTriggerBatch(req: Request, res: Response) {
  const { type, name } = req.params;
  const containers = req.body;

  if (!Array.isArray(containers)) {
    sendErrorResponse(res, 400, 'Body must be an array of containers');
    return;
  }

  const triggerId = `${type}.${name}`;
  const trigger = registry.getState().trigger[triggerId];

  if (!trigger) {
    sendErrorResponse(res, 404, `Trigger ${name} not found`);
    return;
  }

  try {
    const sanitizedContainers = containers.map((container) => {
      if (container.agent) {
        delete container.agent;
      }
      return container;
    });
    await trigger.triggerBatch(sanitizedContainers);
    res.status(200).json({});
  } catch (e: unknown) {
    const errorMessage = getErrorMessage(e);
    log.error(
      `Error running batch trigger ${sanitizeLogParam(name)}: ${sanitizeLogParam(errorMessage ?? '')}`,
    );
    if (errorMessage) {
      sendErrorResponse(res, 500, `Error when running batch trigger ${type}.${name}`);
      return;
    }
    sendErrorResponse(res, 500);
  }
}
