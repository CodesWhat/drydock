import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { byString, byValues } from 'sort-es';
import { getAgent } from '../agent/manager.js';
import logger from '../log/index.js';
import * as registry from '../registry/index.js';
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

async function resolveWatcherItem(id: string, watcher: Watcher): Promise<ApiComponent> {
  const fallback = mapComponentToItem(id, watcher, 'watcher');

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
      metadata: remoteWatcher.metadata ?? fallback.metadata,
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
  const items = await Promise.all(
    Object.entries(watchers).map(([id, watcher]) => resolveWatcherItem(id, watcher)),
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

  const item = await resolveWatcherItem(watcherId, watcher);
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
