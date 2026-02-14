import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import logger from '../log/index.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { recordAuditEvent } from './audit-events.js';
import { findDockerTriggerForContainer, NO_DOCKER_TRIGGER_FOUND_ERROR } from './docker-trigger.js';
import { handleContainerActionError } from './helpers.js';

const log = logger.child({ component: 'preview' });

const router = express.Router();

/**
 * Preview what an update would do for a container.
 */
async function previewContainer(req: Request, res: Response) {
  const { id } = req.params;

  const container = storeContainer.getContainer(id);
  if (!container) {
    res.sendStatus(404);
    return;
  }

  const trigger = findDockerTriggerForContainer(registry.getState().trigger, container);
  if (!trigger) {
    res.status(404).json({ error: NO_DOCKER_TRIGGER_FOUND_ERROR });
    return;
  }

  try {
    const preview = await trigger.preview(container);

    recordAuditEvent({
      action: 'preview',
      container,
      status: 'info',
    });

    res.status(200).json(preview);
  } catch (e: unknown) {
    handleContainerActionError({
      error: e,
      action: 'preview',
      actionLabel: 'previewing',
      id,
      container,
      log,
      res,
    });
  }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.post('/:id/preview', previewContainer);
  return router;
}
