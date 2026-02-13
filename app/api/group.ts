import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import * as storeContainer from '../store/container.js';

const router = express.Router();

/**
 * GET /groups — return containers grouped by stack / group label.
 *
 * Priority: dd.group > wud.group > com.docker.compose.project > null (ungrouped)
 */
function getGroups(req: Request, res: Response) {
  const containers = storeContainer.getContainers();
  const groups: Record<
    string,
    {
      name: string | null;
      containers: { id: string; name: string; displayName: string; updateAvailable: boolean }[];
      containerCount: number;
      updatesAvailable: number;
    }
  > = {};

  for (const container of containers) {
    const groupName =
      container.labels?.['dd.group'] ??
      container.labels?.['wud.group'] ??
      container.labels?.['com.docker.compose.project'] ??
      null;

    const key = groupName ?? '__ungrouped__';

    if (!groups[key]) {
      groups[key] = {
        name: groupName,
        containers: [],
        containerCount: 0,
        updatesAvailable: 0,
      };
    }

    const group = groups[key];
    group.containers.push({
      id: container.id,
      name: container.name,
      displayName: container.displayName,
      updateAvailable: container.updateAvailable,
    });
    group.containerCount++;
    if (container.updateAvailable) {
      group.updatesAvailable++;
    }
  }

  res.status(200).json(Object.values(groups));
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/groups', getGroups);
  return router;
}
