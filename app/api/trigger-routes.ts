import type { NextFunction, Request, Response } from 'express';
import logger from '../log/index.js';
import type { TriggerCategory } from '../model/container.js';
import { getTriggerCategoryForType } from '../triggers/trigger-category.js';
import * as component from './component.js';
import { sendErrorResponse } from './error-response.js';
import { runRemoteTrigger, runTrigger } from './trigger.js';

const log = logger.child({ component: 'trigger-routes' });

const LEGACY_TRIGGERS_SEGMENT = /\/triggers$/;
const CATEGORY_SEGMENTS: Record<TriggerCategory, string> = {
  action: 'actions',
  notification: 'notification-triggers',
};

let legacyRouteWarningLogged = false;

export function _resetLegacyTriggerRouteWarningForTests(): void {
  legacyRouteWarningLogged = false;
}

function sameCategory(type: string, category: TriggerCategory): boolean {
  return getTriggerCategoryForType(type) === category;
}

function requireCategory(category: TriggerCategory) {
  return (req: Request<{ type: string }>, res: Response, next: NextFunction): void => {
    if (!sameCategory(req.params.type, category)) {
      sendErrorResponse(res, 404, 'Trigger not found');
      return;
    }
    next();
  };
}

function initCategoryRouter(category: TriggerCategory) {
  const router = component.init('trigger', (c) => sameCategory(c.type, category));
  const guard = requireCategory(category);
  router.post('/:type/:name', guard, runTrigger);
  router.post('/:type/:name/:agent', guard, runRemoteTrigger);
  return router;
}

/**
 * Action triggers (docker, dockercompose, command): `/api/v1/actions`.
 */
export function initActions() {
  return initCategoryRouter('action');
}

/**
 * Notification triggers (everything else): `/api/v1/notification-triggers`.
 * `/api/v1/notifications` is already the notification rules collection.
 */
export function initNotificationTriggers() {
  return initCategoryRouter('notification');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildSuccessorLink(baseUrl: string, category: TriggerCategory, suffix: string): string {
  const base = baseUrl.replace(LEGACY_TRIGGERS_SEGMENT, `/${CATEGORY_SEGMENTS[category]}`);
  return `<${base}${suffix}>; rel="successor-version"`;
}

/**
 * Marks `/triggers` responses deprecated (RFC 9745) and points at the
 * category-specific successor route(s).
 */
export function deprecateLegacyTriggerRoutes(req: Request, res: Response, next: NextFunction) {
  const path = req.path === '/' ? '' : req.path;
  const [, type, ...rest] = path.split('/');
  const suffix = type ? `/${[type, ...rest].join('/')}` : '';
  const links = type
    ? [buildSuccessorLink(req.baseUrl, getTriggerCategoryForType(safeDecode(type)), suffix)]
    : (['action', 'notification'] as const).map((c) => buildSuccessorLink(req.baseUrl, c, suffix));

  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', links.join(', '));

  if (!legacyRouteWarningLogged) {
    legacyRouteWarningLogged = true;
    log.warn(
      '/api/v1/triggers is deprecated and will be removed no earlier than v1.9.0. Use /api/v1/actions and /api/v1/notification-triggers instead.',
    );
  }
  next();
}
