import { Request, Response } from 'express';
import * as storeContainer from '../../store/container';
import { getServerConfiguration } from '../../configuration';

/**
 * Get Containers (Handshake).
 */
export function getContainers(req: Request, res: Response) {
    const containers = storeContainer.getContainers();
    res.json(containers);
}

/**
 * Delete a container by id.
 * @param req
 * @param res
 */
export function deleteContainer(req: Request, res: Response) {
    const serverConfiguration = getServerConfiguration();
    if (!serverConfiguration.feature.delete) {
        res.sendStatus(403);
    } else {
        const { id } = req.params;
        const container = storeContainer.getContainer(id);
        if (container) {
            storeContainer.deleteContainer(id);
            res.sendStatus(204);
        } else {
            res.sendStatus(404);
        }
    }
}
