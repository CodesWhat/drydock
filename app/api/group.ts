import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import * as storeContainer from '../store/container.js';

const router = express.Router();

type Group = {
  name: string | null;
  containers: { id: string; name: string; displayName: string; updateAvailable: boolean }[];
  containerCount: number;
  updatesAvailable: number;
};

/**
 * GET /groups — return containers grouped by stack / group label.
 *
 * Priority: dd.group > wud.group > com.docker.compose.project > com.docker.stack.namespace > null (ungrouped)
 *
 * com.docker.stack.namespace is the Docker Swarm equivalent of com.docker.compose.project
 * and is carried by services deployed via `docker stack deploy`.
 */
function getGroups(req: Request, res: Response) {
  const containers = storeContainer.getContainers();
  const groups = new Map<string, Group>();

  for (const container of containers) {
    const groupName =
      container.labels?.['dd.group'] ??
      container.labels?.['wud.group'] ??
      container.labels?.['com.docker.compose.project'] ??
      container.labels?.['com.docker.stack.namespace'] ??
      null;

    const key = groupName ?? '__ungrouped__';

    let group = groups.get(key);
    if (!group) {
      group = {
        name: groupName,
        containers: [],
        containerCount: 0,
        updatesAvailable: 0,
      };
      groups.set(key, group);
    }

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

  const data = Array.from(groups.values());
  res.status(200).json({
    data,
    total: data.length,
  });
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
