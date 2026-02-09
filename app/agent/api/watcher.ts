import { Request, Response } from 'express';
import * as registry from '../../registry';
import { mapComponentsToList } from '../../api/component';
import * as storeContainer from '../../store/container';
import logger from '../../log';

const log = logger.child({ component: 'agent-api-watcher' });

/**
 * Get Watchers.
 */
export function getWatchers(req: Request, res: Response) {
    const localWatchers = registry.getState().watcher;
    const items = mapComponentsToList(localWatchers);
    res.json(items);
}

/**
 * Watch a specific watcher.
 */
export async function watchWatcher(req: Request, res: Response) {
    const { type, name } = req.params;
    const watcherId = `${type.toLowerCase()}.${name.toLowerCase()}`;
    const watcher = registry.getState().watcher[watcherId];

    if (!watcher) {
        return res.status(404).json({ error: `Watcher ${name} not found` });
    }

    try {
        const results = await watcher.watch();
        res.json(results);
    } catch (e: any) {
        log.error(`Error watching watcher ${name}: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
}

/**
 * Watch a specific container.
 */
export async function watchContainer(req: Request, res: Response) {
    const { type, name, id } = req.params;
    const watcherId = `${type.toLowerCase()}.${name.toLowerCase()}`;
    const watcher = registry.getState().watcher[watcherId];

    if (!watcher) {
        return res.status(404).json({ error: `Watcher ${name} not found` });
    }

    const container = storeContainer.getContainer(id);
    if (!container) {
        return res
            .status(404)
            .json({ error: `Container ${id} not found in agent store` });
    }

    try {
        const result = await watcher.watchContainer(container);
        res.json(result);
    } catch (e: any) {
        log.error(`Error watching container ${id}: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
}
