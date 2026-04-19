import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { byString, byValues } from 'sort-es';
import { getAgent } from '../agent/manager.js';
import logger from '../log/index.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import {
  buildContainerStatsByKey,
  type ContainerStatsBucket,
  createEmptyContainerStatsBucket,
  projectStatsBucket,
} from '../util/container-summary.js';
import { getErrorMessage } from '../util/error.js';
import type Watcher from '../watchers/Watcher.js';
import { type ApiComponent, mapComponentToItem } from './component.js';
import { normalizeLimitOffsetPagination } from './container/request-helpers.js';
import { sendErrorResponse } from './error-response.js';

const log = logger.child({ component: 'api-watcher' });
const WATCHER_LIST_MAX_LIMIT = 200;

interface WatcherRouteParams {
  agent?: string;
  type: string;
  name: string;
}

function resolveWatcherId(params: WatcherRouteParams): string {
  return params.agent
    ? `${params.agent}.${params.type}.${params.name}`
    : `${params.type}.${params.name}`;
}

function paginateWatcherItems(
  watchers: ApiComponent[],
  pagination: { limit: number; offset: number },
): ApiComponent[] {
  if (pagination.offset >= watchers.length) {
    return [];
  }

  if (pagination.limit === 0) {
    return watchers.slice(pagination.offset);
  }

  return watchers.slice(pagination.offset, pagination.offset + pagination.limit);
}

function sortWatcherItems(watchers: ApiComponent[]): ApiComponent[] {
  return [...watchers].sort(
    byValues([
      [(watcher) => watcher.type, byString()],
      [(watcher) => watcher.name, byString()],
    ]),
  );
}

function attachStatsToMetadata(item: ApiComponent, bucket: ContainerStatsBucket): ApiComponent {
  const stats = projectStatsBucket(bucket);
  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      containers: stats.containers,
      images: stats.images,
    },
  };
}

async function resolveWatcherItem(
  id: string,
  watcher: Watcher,
  statsBucket: ContainerStatsBucket = createEmptyContainerStatsBucket(),
): Promise<ApiComponent> {
  const fallback = attachStatsToMetadata(mapComponentToItem(id, watcher, 'watcher'), statsBucket);

  if (!watcher.agent) {
    return fallback;
  }

  const agentClient = getAgent(watcher.agent);
  if (!agentClient) {
    return fallback;
  }

  try {
    const remoteWatcher = await agentClient.getWatcher(watcher.type, watcher.name);
    return {
      ...fallback,
      configuration: remoteWatcher.configuration ?? fallback.configuration,
      metadata: {
        ...(remoteWatcher.metadata ?? fallback.metadata ?? {}),
        containers: fallback.metadata?.containers,
        images: fallback.metadata?.images,
      },
    };
  } catch (error: unknown) {
    log.debug(
      `Unable to refresh watcher ${watcher.agent}.${watcher.type}.${watcher.name} (${getErrorMessage(error)})`,
    );
    return fallback;
  }
}

export async function getWatchers(req: Request, res: Response): Promise<void> {
  const watchers = registry.getState().watcher || {};
  const watcherEntries = Object.entries(watchers);
  const statsByWatcher = buildContainerStatsByKey(
    storeContainer.getContainersRaw({}),
    watcherEntries.map(([, watcher]) => watcher.name),
    (container) => (typeof container.watcher === 'string' ? container.watcher : undefined),
  );
  const items = await Promise.all(
    watcherEntries.map(([id, watcher]) =>
      resolveWatcherItem(
        id,
        watcher,
        statsByWatcher.get(watcher.name) ?? createEmptyContainerStatsBucket(),
      ),
    ),
  );
  const allItems = sortWatcherItems(items);
  const pagination = normalizeLimitOffsetPagination(req.query, {
    maxLimit: WATCHER_LIST_MAX_LIMIT,
  });
  const data = paginateWatcherItems(allItems, pagination);

  res.status(200).json({
    data,
    total: allItems.length,
    limit: pagination.limit,
    offset: pagination.offset,
    hasMore: pagination.limit > 0 && pagination.offset + data.length < allItems.length,
  });
}

export async function getWatcher(req: Request<WatcherRouteParams>, res: Response): Promise<void> {
  const watcherId = resolveWatcherId(req.params);
  const watcher = registry.getState().watcher[watcherId];

  if (!watcher) {
    sendErrorResponse(res, 404, 'Component not found');
    return;
  }

  const statsByWatcher = buildContainerStatsByKey(
    storeContainer.getContainersRaw({}),
    [watcher.name],
    (container) => (typeof container.watcher === 'string' ? container.watcher : undefined),
  );
  const item = await resolveWatcherItem(
    watcherId,
    watcher,
    statsByWatcher.get(watcher.name) ?? createEmptyContainerStatsBucket(),
  );
  res.status(200).json(item);
}

/**
 * Init Router.
 */
export function init() {
  const router = express.Router();
  router.use(nocache());
  router.get('/', (req: Request, res: Response) => {
    void getWatchers(req, res);
  });
  router.get('/:type/:name', (req: Request<WatcherRouteParams>, res: Response) => {
    void getWatcher(req, res);
  });
  router.get('/:type/:name/:agent', (req: Request<WatcherRouteParams>, res: Response) => {
    void getWatcher(req, res);
  });
  return router;
}
