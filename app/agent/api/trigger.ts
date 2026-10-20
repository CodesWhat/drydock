import type { Request, Response } from 'express';
import { mapComponentsToList } from '../../api/component.js';
import { sendErrorResponse } from '../../api/error-response.js';
import { sanitizePreviewErrorReason } from '../../api/preview-errors.js';
import * as triggerApi from '../../api/trigger.js';
import logger from '../../log/index.js';
import { sanitizeLogParam } from '../../log/sanitize.js';
import type { Container } from '../../model/container.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import { getTriggerCategoryForType } from '../../triggers/trigger-category.js';
import { getErrorMessageProperty } from '../../util/error.js';

const log = logger.child({ component: 'agent-api-trigger' });

interface TriggerRouteParams {
  type: string;
  name: string;
}

type TriggerRequest = Request<TriggerRouteParams>;

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
export async function runTriggerBatch(req: TriggerRequest, res: Response) {
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
    // Use a Map so that container.id values from the request body cannot
    // reach Object.prototype (CodeQL js/remote-property-injection).
    const operationIds = new Map<string, string>();
    let batchContainers: Container[];
    if (getTriggerCategoryForType(type) === 'action') {
      // Action triggers run hooks and commands from container labels, so the
      // body only names which containers to run and which controller-issued
      // operationId goes with each (fixes #289). Each container is re-read from
      // the agent's own store, as the single trigger route does, so the labels
      // (and the hook provenance judged from them) are what this agent
      // observes, never what the caller sent.
      const storedContainers: Container[] = [];
      const unknownIds: string[] = [];
      for (const requested of containers) {
        const id = requested?.id;
        const stored =
          typeof id === 'string' && id.length > 0 ? storeContainer.getContainer(id) : undefined;
        if (!stored) {
          unknownIds.push(String(id));
          continue;
        }
        storedContainers.push(stored);
        if (typeof requested.operationId === 'string' && requested.operationId.length > 0) {
          operationIds.set(stored.id, requested.operationId);
        }
      }
      if (unknownIds.length > 0) {
        log.warn(
          `Batch trigger ${sanitizeLogParam(triggerId)} names unknown containers (${sanitizeLogParam(unknownIds.join(','), 500)})`,
        );
        sendErrorResponse(res, 404, 'Container not found');
        return;
      }
      batchContainers = storedContainers;
    } else {
      // Notification payloads carry transient fields (notificationEvent,
      // security-digest summary rows with no id, snapshots of containers the
      // agent already pruned) that no stored row has, so they run as sent.
      // Extract per-container operationIds injected by the controller (#289),
      // then strip them (and the agent field) before forwarding.
      batchContainers = containers.map((container) => {
        if (container.agent) {
          delete container.agent;
        }
        if (
          typeof container.id === 'string' &&
          container.id.length > 0 &&
          typeof container.operationId === 'string' &&
          container.operationId.length > 0
        ) {
          operationIds.set(container.id, container.operationId);
          delete container.operationId;
        }
        return container;
      });
    }
    const runtimeContext = operationIds.size > 0 ? { operationIds } : undefined;
    await trigger.triggerBatch(batchContainers, runtimeContext);
    res.status(200).json({});
  } catch (e: unknown) {
    const errorMessage = getErrorMessageProperty(e);
    const sanitizedReason = errorMessage ? sanitizePreviewErrorReason(errorMessage) : '';
    log.error(
      `Error running batch trigger ${sanitizeLogParam(name)}: ${sanitizeLogParam(sanitizedReason)}`,
    );
    if (sanitizedReason) {
      sendErrorResponse(res, 500, {
        message: `Error when running batch trigger ${type}.${name}`,
        details: {
          reason: sanitizedReason,
        },
      });
      return;
    }
    sendErrorResponse(res, 500);
  }
}
