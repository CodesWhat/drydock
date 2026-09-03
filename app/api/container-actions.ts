import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { getServerConfiguration } from '../configuration/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { AuditEntry } from '../model/audit.js';
import type { Container } from '../model/container.js';
import { getContainerActionsCounter } from '../prometheus/container-actions.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import {
  type RejectedContainerUpdateRequest,
  requestContainerUpdates,
} from '../updates/request-update.js';
import { recordAuditEvent } from './audit-events.js';
import {
  areContainerActionsEnabled,
  CONTAINER_ACTIONS_DISABLED_MESSAGE,
  CONTAINER_NOT_FOUND_MESSAGE,
  dispatchManualContainerUpdate,
  sendContainerUpdateDispatchOutcome,
} from './container-update-dispatch.js';
import {
  AGENT_LIFECYCLE_UNSUPPORTED_ERROR,
  findDockerTriggerForContainer,
  isAgentLifecycleUnsupported,
  NO_DOCKER_TRIGGER_FOUND_ERROR,
} from './docker-trigger.js';
import { sendErrorResponse } from './error-response.js';
import { handleContainerActionError } from './helpers.js';
import { scoped } from './route-scopes.js';

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

type BulkUpdateResponseItem = {
  containerId: string;
  containerName: string;
  message?: string;
  operationId?: string;
  statusCode?: number;
};

function parseBulkContainerIds(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const containerIds = (body as Record<string, unknown>).containerIds;
  if (!Array.isArray(containerIds) || containerIds.length === 0) {
    return undefined;
  }

  const normalized = containerIds
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value !== '');
  if (normalized.length === 0) {
    return undefined;
  }

  return Array.from(new Set(normalized));
}

function serializeRejectedUpdateRequest(
  rejected: RejectedContainerUpdateRequest,
): BulkUpdateResponseItem {
  return {
    containerId: rejected.container.id,
    containerName: rejected.container.name,
    statusCode: rejected.statusCode,
    message: rejected.message,
  };
}

/**
 * Execute a container action (start, stop, restart).
 *
 * Security note: these action endpoints are intentionally authentication-gated
 * only. In current single-operator deployments, all authenticated users can
 * start, stop, or restart containers. Fine-grained RBAC is planned for a
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

  if (isAgentLifecycleUnsupported(container)) {
    sendErrorResponse(res, 501, AGENT_LIFECYCLE_UNSUPPORTED_ERROR);
    return;
  }

  const trigger = findDockerTriggerForContainer(registry.getState().trigger, container);
  if (!trigger) {
    sendErrorResponse(res, 404, NO_DOCKER_TRIGGER_FOUND_ERROR);
    return;
  }

  let dockerContainer: DockerContainerHandle;
  try {
    const watcher = trigger.getWatcher(container) as DockerWatcher;
    const { dockerApi } = watcher;
    dockerContainer = dockerApi.getContainer(container.id);
    await dockerContainer[method]();
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
    return;
  }

  let responseContainer: Container;
  try {
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
    responseContainer = storeContainer.getContainer(id) || updatedContainer;
  } catch (e: unknown) {
    log.warn(
      `Container ${method} succeeded but status refresh failed for ${sanitizeLogParam(id)} (${sanitizeLogParam(
        e instanceof Error ? e.message : String(e),
      )})`,
    );
    responseContainer = storeContainer.getContainer(id) || container;
  }

  recordAuditEvent({
    action,
    container,
    status: 'success',
  });
  getContainerActionsCounter()?.inc({ action });

  res.status(200).json({ message: ACTION_MESSAGES[method], result: responseContainer });
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
  if (!areContainerActionsEnabled()) {
    sendErrorResponse(res, 403, CONTAINER_ACTIONS_DISABLED_MESSAGE);
    return;
  }

  const id = req.params.id as string;
  const container = storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, CONTAINER_NOT_FOUND_MESSAGE);
    return;
  }

  sendContainerUpdateDispatchOutcome(res, await dispatchManualContainerUpdate(container));
}

async function updateContainers(req: Request, res: Response) {
  const serverConfiguration = getServerConfiguration();
  if (!serverConfiguration.feature.containeractions) {
    sendErrorResponse(res, 403, 'Container actions are disabled');
    return;
  }

  const containerIds = parseBulkContainerIds(req.body);
  if (!containerIds) {
    sendErrorResponse(res, 400, 'containerIds must be a non-empty array of container ids');
    return;
  }

  const containers: Container[] = [];
  const rejected: BulkUpdateResponseItem[] = [];

  for (const id of containerIds) {
    const container = storeContainer.getContainer(id);
    if (!container) {
      rejected.push({
        containerId: id,
        containerName: id,
        statusCode: 404,
        message: 'Container not found',
      });
      continue;
    }
    containers.push(container);
  }

  try {
    const result = await requestContainerUpdates(containers);

    result.accepted.forEach(() => {
      getContainerActionsCounter()?.inc({ action: 'container-update' });
    });

    res.status(200).json({
      message: 'Container update requests processed',
      accepted: result.accepted.map((accepted) => ({
        containerId: accepted.container.id,
        containerName: accepted.container.name,
        operationId: accepted.operationId,
      })),
      rejected: [...rejected, ...result.rejected.map(serializeRejectedUpdateRequest)],
    });
  } catch (error: unknown) {
    log.warn(
      `Unexpected error accepting bulk updates (${sanitizeLogParam(
        error instanceof Error ? error.message : String(error),
      )})`,
    );
    sendErrorResponse(res, 500, 'Unable to accept container updates');
  }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.post('/update', scoped('containers:update', updateContainers));
  router.post('/:id/start', scoped('admin', startContainer));
  router.post('/:id/stop', scoped('admin', stopContainer));
  router.post('/:id/restart', scoped('admin', restartContainer));
  router.post('/:id/update', scoped('containers:update', updateContainer));
  return router;
}
