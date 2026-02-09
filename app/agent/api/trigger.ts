import { Request, Response } from 'express';
import * as registry from '../../registry';
import { mapComponentsToList } from '../../api/component';
import * as triggerApi from '../../api/trigger';
import logger from '../../log';

const log = logger.child({ component: 'agent-api-trigger' });

/**
 * Get Triggers.
 */
export function getTriggers(req: Request, res: Response) {
    const localTriggers = registry.getState().trigger;
    const items = mapComponentsToList(localTriggers);
    res.json(items);
}

/**
 * Run Remote Trigger.
 * Delegates to the common API handler but ensures no proxying happens.
 */
export async function runTrigger(req: Request, res: Response) {
    if (req.body && req.body.agent) {
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
        return res
            .status(400)
            .json({ error: 'Body must be an array of containers' });
    }

    const triggerId = `${type}.${name}`;
    const trigger = registry.getState().trigger[triggerId];

    if (!trigger) {
        return res.status(404).json({ error: `Trigger ${name} not found` });
    }

    try {
        const sanitizedContainers = containers.map((container) => {
            if (container.agent) {
                delete container.agent;
            }
            return container;
        });
        await trigger.triggerBatch(sanitizedContainers);
        res.status(200).json({});
    } catch (e: any) {
        log.error(`Error running batch trigger ${name}: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
}
