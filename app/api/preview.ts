// @ts-nocheck
import express from 'express';
import nocache from 'nocache';
import * as storeContainer from '../store/container.js';
import * as registry from '../registry/index.js';
import * as auditStore from '../store/audit.js';
import { getAuditCounter } from '../prometheus/audit.js';
import logger from '../log/index.js';

const log = logger.child({ component: 'preview' });

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
 * Preview what an update would do for a container.
 */
async function previewContainer(req, res) {
    const { id } = req.params;

    const container = storeContainer.getContainer(id);
    if (!container) {
        res.sendStatus(404);
        return;
    }

    const trigger = findDockerTrigger(container);
    if (!trigger) {
        res.status(404).json({ error: 'No docker trigger found for this container' });
        return;
    }

    try {
        const preview = await trigger.preview(container);

        auditStore.insertAudit({
            id: '',
            timestamp: new Date().toISOString(),
            action: 'preview',
            containerName: container.name,
            containerImage: container.image?.name,
            status: 'info',
        });
        getAuditCounter()?.inc({ action: 'preview' });

        res.status(200).json(preview);
    } catch (e) {
        log.warn(`Error previewing container ${id} (${e.message})`);

        auditStore.insertAudit({
            id: '',
            timestamp: new Date().toISOString(),
            action: 'preview',
            containerName: container.name,
            containerImage: container.image?.name,
            status: 'error',
            details: e.message,
        });
        getAuditCounter()?.inc({ action: 'preview' });

        res.status(500).json({
            error: `Error previewing container update (${e.message})`,
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
