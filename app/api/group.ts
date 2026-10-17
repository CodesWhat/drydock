import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { getContainerGroup } from '../model/container-group.js';
import * as storeContainer from '../store/container.js';
import { scoped } from './route-scopes.js';

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
 * Priority: dd.group > com.docker.compose.project > com.docker.stack.namespace > null (ungrouped)
 *
 * com.docker.stack.namespace is the Docker Swarm equivalent of com.docker.compose.project
 * and is carried by services deployed via `docker stack deploy`.
 */
function getGroups(req: Request, res: Response) {
  const containers = storeContainer.getContainers();
  const groups = new Map<string | null, Group>();

  for (const container of containers) {
    const groupName = getContainerGroup(container);

    let group = groups.get(groupName);
    if (!group) {
      group = {
        name: groupName,
        containers: [],
        containerCount: 0,
        updatesAvailable: 0,
      };
      groups.set(groupName, group);
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
  router.get('/groups', scoped('read', getGroups));
  return router;
}
