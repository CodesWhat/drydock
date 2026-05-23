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

type TriggerRequest = Request<TriggerRouteParams>;

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
export async function runTrigger(req: TriggerRequest, res: Response) {
  if (req.body?.agent) {
    delete req.body.agent;
  }
  return triggerApi.runTrigger(req, res);
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
    // Extract per-container operationIds injected by the controller (fixes #289),
    // then strip them (and the agent field) from the container objects before
    // forwarding so local triggers see a clean Container.
    const operationIds: Record<string, string> = {};
    const sanitizedContainers = containers.map((container) => {
      if (container.agent) {
        delete container.agent;
      }
      if (
        container.id &&
        typeof container.operationId === 'string' &&
        container.operationId.length > 0
      ) {
        operationIds[String(container.id)] = container.operationId;
        delete container.operationId;
      }
      return container;
    });
    const runtimeContext = Object.keys(operationIds).length > 0 ? { operationIds } : undefined;
    await trigger.triggerBatch(sanitizedContainers, runtimeContext);
    res.status(200).json({});
  } catch (e: unknown) {
    const errorMessage = getErrorMessage(e);
    log.error(
      `Error running batch trigger ${sanitizeLogParam(name)}: ${sanitizeLogParam(errorMessage ?? '')}`,
    );
    if (errorMessage) {
      sendErrorResponse(res, 500, {
        message: `Error when running batch trigger ${type}.${name}`,
        details: {
          reason: errorMessage,
        },
      });
      return;
    }
    sendErrorResponse(res, 500);
  }
}
