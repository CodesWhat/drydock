import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import logger from '../log/index.js';
import * as registry from '../registry/index.js';
import * as storeBackup from '../store/backup.js';
import * as storeContainer from '../store/container.js';
import {
  cleanupCreatedContainerCandidate,
  getCreatedContainerCandidate,
} from '../triggers/providers/docker/created-container-candidate.js';
import { buildRollbackImageReference, createContainerBackupScope } from '../util/backup.js';
import { recordAuditEvent } from './audit-events.js';
import { requireDestructiveActionConfirmation } from './destructive-confirmation.js';
import {
  AGENT_LIFECYCLE_UNSUPPORTED_ERROR,
  findDockerTriggerForContainer,
  isAgentLifecycleUnsupported,
  NO_DOCKER_TRIGGER_FOUND_ERROR,
} from './docker-trigger.js';
import { sendErrorResponse } from './error-response.js';
import { handleContainerActionError } from './helpers.js';

const log = logger.child({ component: 'backup' });

const router = express.Router();

function getContainerBackupScope(container: Parameters<typeof createContainerBackupScope>[0]) {
  return createContainerBackupScope(
    container,
    storeContainer.getContainers({ name: container.name }),
  );
}

/**
 * Get all backups, optionally filtered by containerName query param.
 */
function getBackups(req: Request, res: Response) {
  const { containerName } = req.query;
  const backups = containerName
    ? storeBackup.getBackupsByName(containerName as string)
    : storeBackup.getAllBackups();

  res.status(200).json({
    data: backups,
    total: backups.length,
  });
}

/**
 * Get backups for a specific container.
 */
function getContainerBackups(req: Request, res: Response) {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const container = storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
    return;
  }

  const backups = storeBackup.getBackupsForContainer(getContainerBackupScope(container));
  res.status(200).json({
    data: backups,
    total: backups.length,
  });
}

/**
 * Rollback a container to its latest backup image.
 */
async function rollbackContainer(req: Request, res: Response) {
  const id = req.params.id as string;

  const container = storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
    return;
  }

  const { backupId } = req.body || {};
  const backupScope = getContainerBackupScope(container);

  let backup;
  if (backupId) {
    backup = storeBackup.getBackup(backupId);
    if (!backup || !storeBackup.isBackupInScope(backup, backupScope)) {
      sendErrorResponse(res, 404, 'Backup not found for this container');
      return;
    }
  } else {
    const backups = storeBackup.getBackupsForContainer(backupScope);
    if (backups.length === 0) {
      sendErrorResponse(res, 404, 'No backups found for this container');
      return;
    }
    backup = backups[0];
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

  const latestBackup = backup;
  const backupImage = buildRollbackImageReference(latestBackup);

  try {
    const watcher = trigger.getWatcher(container);
    const { dockerApi } = watcher;
    const reg = registry.getState().registry[container.image.registry.name];
    const auth = await reg.getAuthPull();

    // Pull the backup image
    await trigger.pullImage(dockerApi, auth, backupImage, log);

    // Get current container (look up by name since the Docker ID may have
    // changed after the most recent update recreated the container)
    const currentContainer = await trigger.getCurrentContainer(dockerApi, { id: container.name });
    if (!currentContainer) {
      sendErrorResponse(res, 500, 'Container not found in Docker');
      return;
    }

    const currentContainerSpec = await trigger.inspectContainer(currentContainer, log);

    // Stop and remove current container
    await trigger.stopAndRemoveContainer(currentContainer, currentContainerSpec, container, log);

    // Recreate with backup image
    await trigger.recreateContainer(dockerApi, currentContainerSpec, backupImage, container, log);

    recordAuditEvent({
      action: 'rollback',
      container,
      fromVersion: container.image?.tag?.value,
      toVersion: latestBackup.imageTag,
      status: 'success',
    });

    res.status(200).json({
      message: 'Container rolled back successfully',
      backup: latestBackup,
    });
  } catch (e: unknown) {
    // recreateContainer may have created a replacement before a later step
    // (e.g. an additional-network connect) failed. The prior container was
    // already stopped/removed above, so reclaim the orphan so it doesn't
    // squat the container name.
    await cleanupCreatedContainerCandidate(getCreatedContainerCandidate(e), container.name, log);
    handleContainerActionError({
      error: e,
      action: 'rollback',
      actionLabel: 'rolling back',
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
  router.get('/backups', getBackups);
  router.get('/:id/backups', getContainerBackups);
  router.post(
    '/:id/rollback',
    requireDestructiveActionConfirmation('container-rollback'),
    rollbackContainer,
  );
  return router;
}
