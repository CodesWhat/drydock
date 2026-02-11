// @ts-nocheck
import express from 'express';
import nocache from 'nocache';
import * as storeContainer from '../store/container.js';
import * as storeBackup from '../store/backup.js';
import * as registry from '../registry/index.js';
import * as auditStore from '../store/audit.js';
import { getAuditCounter } from '../prometheus/audit.js';
import logger from '../log/index.js';

const log = logger.child({ component: 'backup' });

const router = express.Router();

/**
 * Return registered triggers.
 */
function getTriggers() {
    return registry.getState().trigger;
}

/**
 * Find a docker trigger that can handle this container.
 */
function findDockerTrigger(container) {
    const triggers = getTriggers();
    for (const [id, trigger] of Object.entries(triggers)) {
        if (trigger.type !== 'docker') {
            continue;
        }
        if (trigger.agent && trigger.agent !== container.agent) {
            continue;
        }
        if (container.agent && !trigger.agent) {
            continue;
        }
        return trigger;
    }
    return undefined;
}

/**
 * Get all backups, optionally filtered by containerId query param.
 */
function getBackups(req, res) {
    const { containerId } = req.query;
    if (containerId) {
        res.status(200).json(storeBackup.getBackups(containerId));
    } else {
        res.status(200).json(storeBackup.getAllBackups());
    }
}

/**
 * Get backups for a specific container.
 */
function getContainerBackups(req, res) {
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
async function rollbackContainer(req, res) {
    const { id } = req.params;

    const container = storeContainer.getContainer(id);
    if (!container) {
        res.sendStatus(404);
        return;
    }

    const backups = storeBackup.getBackups(id);
    if (backups.length === 0) {
        res.status(404).json({ error: 'No backups found for this container' });
        return;
    }

    const trigger = findDockerTrigger(container);
    if (!trigger) {
        res.status(404).json({ error: 'No docker trigger found for this container' });
        return;
    }

    const latestBackup = backups[0];
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

        auditStore.insertAudit({
            id: '',
            timestamp: new Date().toISOString(),
            action: 'rollback',
            containerName: container.name,
            containerImage: container.image?.name,
            fromVersion: container.image?.tag?.value,
            toVersion: latestBackup.imageTag,
            status: 'success',
        });
        getAuditCounter()?.inc({ action: 'rollback' });

        res.status(200).json({
            message: 'Container rolled back successfully',
            backup: latestBackup,
        });
    } catch (e) {
        log.warn(`Error rolling back container ${id} (${e.message})`);

        auditStore.insertAudit({
            id: '',
            timestamp: new Date().toISOString(),
            action: 'rollback',
            containerName: container.name,
            containerImage: container.image?.name,
            status: 'error',
            details: e.message,
        });
        getAuditCounter()?.inc({ action: 'rollback' });

        res.status(500).json({
            error: `Error rolling back container (${e.message})`,
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
