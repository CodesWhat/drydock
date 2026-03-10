import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { getServerConfiguration } from '../configuration/index.js';
import logger from '../log/index.js';
import type { AuditEntry } from '../model/audit.js';
import { getContainerActionsCounter } from '../prometheus/container-actions.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { recordAuditEvent } from './audit-events.js';
import { findDockerTriggerForContainer, NO_DOCKER_TRIGGER_FOUND_ERROR } from './docker-trigger.js';
import { sendErrorResponse } from './error-response.js';
import { handleContainerActionError } from './helpers.js';

const log = logger.child({ component: 'container-actions' });

const router = express.Router();

/**
 * Execute a container action (start, stop, restart).
 */
const ACTION_MESSAGES = {
  start: 'Container started successfully',
  stop: 'Container stopped successfully',
  restart: 'Container restarted successfully',
};

type ContainerAction = keyof typeof ACTION_MESSAGES;
type ContainerAuditAction = Extract<
  AuditEntry['action'],
  'container-start' | 'container-stop' | 'container-restart'
>;

type DockerContainerHandle = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  inspect: () => Promise<{ State?: { Status?: string } }>;
};

type DockerWatcher = {
  dockerApi: {
    getContainer: (id: string) => DockerContainerHandle;
  };
};

/**
 * Execute a container action (start, stop, restart).
 *
 * Security note: these action endpoints are intentionally authentication-gated
 * only. In current single-operator deployments, any authenticated user can
 * start, stop, or restart any container. Fine-grained RBAC is planned for a
 * future enterprise access release.
 */
async function executeAction(
  req: Request,
  res: Response,
  action: ContainerAuditAction,
  method: ContainerAction,
) {
  const serverConfiguration = getServerConfiguration();
  if (!serverConfiguration.feature.containeractions) {
    sendErrorResponse(res, 403, 'Container actions are disabled');
    return;
  }

  const id = req.params.id as string;

  const container = storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
    return;
  }

  const trigger = findDockerTriggerForContainer(registry.getState().trigger, container);
  if (!trigger) {
    sendErrorResponse(res, 404, NO_DOCKER_TRIGGER_FOUND_ERROR);
    return;
  }

  try {
    const watcher = trigger.getWatcher(container) as DockerWatcher;
    const { dockerApi } = watcher;
    const dockerContainer = dockerApi.getContainer(container.id);
    await dockerContainer[method]();

    // Update container status in the store so the UI reflects the change
    const inspectResult = await dockerContainer.inspect();
    const newStatus = inspectResult?.State?.Status;
    let updatedContainer = container;
    if (newStatus) {
      const containerForUpdate = storeContainer.getContainer(id);
      if (containerForUpdate) {
        updatedContainer = storeContainer.updateContainer({
          ...containerForUpdate,
          status: newStatus,
        });
      }
    }
    const responseContainer = storeContainer.getContainer(id) || updatedContainer;

    recordAuditEvent({
      action,
      container,
      status: 'success',
    });
    getContainerActionsCounter()?.inc({ action });

    res.status(200).json({ message: ACTION_MESSAGES[method], result: responseContainer });
  } catch (e: unknown) {
    handleContainerActionError({
      error: e,
      action,
      actionLabel: `performing ${method} on`,
      id,
      container,
      log,
      res,
    });
    getContainerActionsCounter()?.inc({ action });
  }
}

/**
 * Start a stopped container.
 */
async function startContainer(req: Request, res: Response) {
  await executeAction(req, res, 'container-start', 'start');
}

/**
 * Stop a running container.
 */
async function stopContainer(req: Request, res: Response) {
  await executeAction(req, res, 'container-stop', 'stop');
}

/**
 * Restart a container.
 */
async function restartContainer(req: Request, res: Response) {
  await executeAction(req, res, 'container-restart', 'restart');
}

/**
 * Update a container by pulling the new image and recreating the container.
 */
async function updateContainer(req: Request, res: Response) {
  const serverConfiguration = getServerConfiguration();
  if (!serverConfiguration.feature.containeractions) {
    sendErrorResponse(res, 403, 'Container actions are disabled');
    return;
  }

  const id = req.params.id as string;
  const container = storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
    return;
  }

  if (!container.updateAvailable) {
    sendErrorResponse(res, 400, 'No update available for this container');
    return;
  }

  const trigger = findDockerTriggerForContainer(registry.getState().trigger, container, {
    triggerTypes: ['docker', 'dockercompose'],
  });
  if (!trigger) {
    sendErrorResponse(res, 404, NO_DOCKER_TRIGGER_FOUND_ERROR);
    return;
  }

  try {
    await trigger.trigger(container);
    const updatedContainer = storeContainer.getContainer(id);
    recordAuditEvent({ action: 'container-update', container, status: 'success' });
    getContainerActionsCounter()?.inc({ action: 'container-update' });
    res.status(200).json({ message: 'Container updated successfully', result: updatedContainer });
  } catch (e: unknown) {
    handleContainerActionError({
      error: e,
      action: 'container-update',
      actionLabel: 'updating',
      id,
      container,
      log,
      res,
    });
    getContainerActionsCounter()?.inc({ action: 'container-update' });
  }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.post('/:id/start', startContainer);
  router.post('/:id/stop', stopContainer);
  router.post('/:id/restart', restartContainer);
  router.post('/:id/update', updateContainer);
  return router;
}
