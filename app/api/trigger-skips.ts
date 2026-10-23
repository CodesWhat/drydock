import type { Request, Response, Router } from 'express';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { getNotificationSkipsForTrigger } from '../triggers/notification-skips.js';
import { normalizeLimitOffsetPagination } from './container/request-helpers.js';
import { sendErrorResponse } from './error-response.js';
import { scoped } from './route-scopes.js';

interface TriggerSkipsRouteParams {
  agent?: string;
  type: string;
  name: string;
}

export const TRIGGER_SKIPS_DEFAULT_LIMIT = 50;
export const TRIGGER_SKIPS_MAX_LIMIT = 200;

/**
 * Recent notification skips for one trigger, newest first (DR-85). Backed by the in-memory
 * skip record, which keeps one entry per (trigger, container) pair, so this is the most
 * recent skip for each container that trigger passed over. `limit` is capped and defaults to
 * 50 when absent or zero.
 */
export function getTriggerSkips(req: Request<TriggerSkipsRouteParams>, res: Response) {
  const { agent, type, name } = req.params;
  const id = agent ? `${agent}.${type}.${name}` : `${type}.${name}`;
  if (!registry.getState().trigger[id]) {
    sendErrorResponse(res, 404, 'Component not found');
    return;
  }
  const requested = normalizeLimitOffsetPagination(req.query, {
    maxLimit: TRIGGER_SKIPS_MAX_LIMIT,
  });
  const limit = requested.limit || TRIGGER_SKIPS_DEFAULT_LIMIT;
  const offset = requested.offset;
  const all = getNotificationSkipsForTrigger(id);
  const data = all.slice(offset, offset + limit).map((skip) => ({
    containerId: skip.containerId,
    containerName: storeContainer.getContainer(skip.containerId)?.name ?? null,
    reason: skip.reason,
    at: skip.at,
  }));
  res.status(200).json({
    data,
    total: all.length,
    limit,
    offset,
    hasMore: offset + data.length < all.length,
  });
}

/** Register the skip routes. Must run before the generic `/:type/:name/:agent` route. */
export function registerTriggerSkipRoutes(router: Router) {
  router.get('/:type/:name/skips', scoped('read', getTriggerSkips));
  router.get('/:type/:name/:agent/skips', scoped('read', getTriggerSkips));
}
