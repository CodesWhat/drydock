import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { recordAuditEvent } from './audit-events.js';
import { findDockerTriggerForContainer, NO_DOCKER_TRIGGER_FOUND_ERROR } from './docker-trigger.js';
import {
  classifyPreviewError,
  sanitizePreviewErrorReason,
  sendPreviewError,
  TRIGGER_ACTION,
} from './preview-errors.js';

const log = logger.child({ component: 'preview' });

const router = express.Router();

/**
 * Preview what an update would do for a container.
 */
async function previewContainer(req: Request, res: Response) {
  const id = req.params.id as string;

  const container = storeContainer.getContainer(id);
  if (!container) {
    sendPreviewError(res, 404, {
      code: 'container-not-found',
      message: 'Container not found',
    });
    return;
  }

  const trigger = findDockerTriggerForContainer(registry.getState().trigger, container, {
    triggerTypes: ['docker', 'dockercompose'],
  });
  if (!trigger) {
    log.warn(`${NO_DOCKER_TRIGGER_FOUND_ERROR} (${sanitizeLogParam(id)})`);
    sendPreviewError(res, 404, {
      code: 'no-trigger-configured',
      message: 'No action trigger configured for this container',
      action: TRIGGER_ACTION,
    });
    return;
  }

  try {
    const preview = await trigger.preview(container);

    if (typeof preview?.error === 'string') {
      const reason = sanitizePreviewErrorReason(preview.error);
      log.warn(
        `Container ${sanitizeLogParam(id)} was not found by its configured watcher (${sanitizeLogParam(reason)})`,
      );
      recordAuditEvent({
        action: 'preview',
        container,
        status: 'error',
        details: `container-runtime-not-found: ${reason}`,
      });
      sendPreviewError(res, 404, {
        code: 'container-runtime-not-found',
        message: 'Container was not found by the configured Docker watcher',
      });
      return;
    }

    recordAuditEvent({
      action: 'preview',
      container,
      status: 'info',
    });

    res.status(200).json(preview);
  } catch (e: unknown) {
    const classified = classifyPreviewError(e, container);
    const diagnosticReason = classified.payload.details?.reason ?? sanitizePreviewErrorReason(e);
    log.warn(
      `Error previewing container ${sanitizeLogParam(id)} (${sanitizeLogParam(diagnosticReason)})`,
    );
    recordAuditEvent({
      action: 'preview',
      container,
      status: 'error',
      details: `${classified.payload.code}: ${diagnosticReason}`,
    });
    sendPreviewError(res, classified.status, classified.payload);
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
