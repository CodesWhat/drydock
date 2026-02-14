import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import logger from '../log/index.js';
import * as registry from '../registry/index.js';
import * as storeBackup from '../store/backup.js';
import * as storeContainer from '../store/container.js';
import { recordAuditEvent } from './audit-events.js';
import { findDockerTriggerForContainer, NO_DOCKER_TRIGGER_FOUND_ERROR } from './docker-trigger.js';
import { handleContainerActionError } from './helpers.js';

const log = logger.child({ component: 'backup' });

const router = express.Router();

/**
 * Get all backups, optionally filtered by containerId query param.
 */
function getBackups(req: Request, res: Response) {
  const { containerId } = req.query;
  if (containerId) {
    res.status(200).json(storeBackup.getBackups(containerId as string));
  } else {
    res.status(200).json(storeBackup.getAllBackups());
  }
}

/**
 * Get backups for a specific container.
 */
function getContainerBackups(req: Request, res: Response) {
  const { id } = req.params;

  const container = storeContainer.getContainer(id);
  if (!container) {
    res.sendStatus(404);
    return;
  }

  res.status(200).json(storeBackup.getBackups(id));
}

/**
 * Rollback a container to its latest backup image.
 */
async function rollbackContainer(req: Request, res: Response) {
  const { id } = req.params;

  const container = storeContainer.getContainer(id);
  if (!container) {
    res.sendStatus(404);
    return;
  }

  const { backupId } = req.body || {};

  let backup;
  if (backupId) {
    backup = storeBackup.getBackup(backupId);
    if (!backup || backup.containerId !== id) {
      res.status(404).json({ error: 'Backup not found for this container' });
      return;
    }
  } else {
    const backups = storeBackup.getBackups(id);
    if (backups.length === 0) {
      res.status(404).json({ error: 'No backups found for this container' });
      return;
    }
    backup = backups[0];
  }

  const trigger = findDockerTriggerForContainer(registry.getState().trigger, container);
  if (!trigger) {
    res.status(404).json({ error: NO_DOCKER_TRIGGER_FOUND_ERROR });
    return;
  }

  const latestBackup = backup;
  const backupImage = `${latestBackup.imageName}:${latestBackup.imageTag}`;

  try {
    const watcher = trigger.getWatcher(container);
    const { dockerApi } = watcher;
    const reg = registry.getState().registry[container.image.registry.name];
    const auth = await reg.getAuthPull();

    // Pull the backup image
    await trigger.pullImage(dockerApi, auth, backupImage, log);

    // Get current container
    const currentContainer = await trigger.getCurrentContainer(dockerApi, container);
    if (!currentContainer) {
      res.status(500).json({ error: 'Container not found in Docker' });
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
  router.get('/', getBackups);
  router.get('/:id/backups', getContainerBackups);
  router.post('/:id/rollback', rollbackContainer);
  return router;
}
