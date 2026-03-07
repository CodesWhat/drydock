import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import nocache from 'nocache';
import { getWebhookConfiguration } from '../configuration/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { getWebhookCounter } from '../prometheus/webhook.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { getErrorMessage } from '../util/error.js';
import { ddWebhookEnabled, wudWebhookEnabled } from '../watchers/providers/docker/label.js';
import { recordAuditEvent } from './audit-events.js';
import { findDockerTriggerForContainer, NO_DOCKER_TRIGGER_FOUND_ERROR } from './docker-trigger.js';
import { sendErrorResponse } from './error-response.js';

const log = logger.child({ component: 'webhook' });

const router = express.Router();

type WebhookAction = 'watchall' | 'watch' | 'update';

function normalizeRequestPath(req: Request): string {
  const rawPath = (req.path || req.originalUrl || req.url || '').split('?')[0];
  if (!rawPath) {
    return '';
  }
  if (rawPath.length > 1 && rawPath.endsWith('/')) {
    return rawPath.slice(0, -1);
  }
  return rawPath;
}

function getWebhookActionFromRequest(req: Request): WebhookAction | undefined {
  const requestPath = normalizeRequestPath(req);
  if (
    requestPath === '/watch' ||
    requestPath.endsWith('/webhook/watch') ||
    requestPath.endsWith('/api/webhook/watch')
  ) {
    return 'watchall';
  }
  if (
    requestPath.startsWith('/watch/') ||
    requestPath.includes('/webhook/watch/') ||
    requestPath.includes('/api/webhook/watch/')
  ) {
    return 'watch';
  }
  if (
    requestPath.startsWith('/update/') ||
    requestPath.includes('/webhook/update/') ||
    requestPath.includes('/api/webhook/update/')
  ) {
    return 'update';
  }
  return undefined;
}

function getTokenForRequest(
  req: Request,
  webhookConfig: ReturnType<typeof getWebhookConfiguration>,
): string {
  const action = getWebhookActionFromRequest(req);
  const endpointToken = action ? webhookConfig.tokens?.[action] : undefined;
  return endpointToken || webhookConfig.token;
}

/**
 * Authenticate webhook requests via Bearer token.
 */
function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const webhookConfig = getWebhookConfiguration();
  if (!webhookConfig.enabled) {
    sendErrorResponse(res, 403, 'Webhooks are disabled');
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    sendErrorResponse(res, 401, 'Missing or invalid authorization header');
    return;
  }

  const token = authHeader.slice(7);
  const configuredToken = getTokenForRequest(req, webhookConfig);

  // Reject empty or missing configured token (misconfiguration guard)
  if (!configuredToken) {
    log.error('Webhook token is not configured; rejecting request');
    sendErrorResponse(res, 500, 'Webhook authentication is misconfigured');
    return;
  }

  // Hash tokens first so timingSafeEqual always compares fixed-length buffers.
  const tokenHash = createHash('sha256').update(token, 'utf8').digest();
  const expectedHash = createHash('sha256').update(configuredToken, 'utf8').digest();
  if (!timingSafeEqual(tokenHash, expectedHash)) {
    sendErrorResponse(res, 401, 'Invalid token');
    return;
  }

  next();
}

/**
 * Find a container by name from the store.
 */
function findContainerByName(containerName: string) {
  const containers = storeContainer.getContainers({});
  return containers.find((c) => c.name === containerName);
}

type ContainerWebhookErrorContext = {
  auditAction: 'webhook-watch-container' | 'webhook-update';
  webhookAction: 'watch-container' | 'update-container';
  actionVerb: 'watching' | 'updating';
};

const CONTAINER_NOT_FOUND_ERROR = 'Container not found';
const CONTAINER_WEBHOOK_DISABLED_ERROR = 'Webhooks are disabled for this container';

/**
 * Check whether webhooks are enabled for the given container.
 * Returns true unless the container has dd.webhook.enabled (or wud.webhook.enabled) set to 'false'.
 */
function isWebhookEnabledForContainer(
  container: NonNullable<ReturnType<typeof findContainerByName>>,
): boolean {
  const labels = container.labels;
  if (!labels) return true;
  const value = labels[ddWebhookEnabled] ?? labels[wudWebhookEnabled];
  if (value === undefined) return true;
  return value.toLowerCase() !== 'false';
}

function handleContainerActionError(
  error: unknown,
  container: NonNullable<ReturnType<typeof findContainerByName>>,
  containerName: string,
  res: Response,
  context: ContainerWebhookErrorContext,
) {
  const message = getErrorMessage(error);
  const safeContainerName = sanitizeLogParam(containerName);
  log.warn(
    `Error ${context.actionVerb} container ${safeContainerName} (${sanitizeLogParam(message)})`,
  );

  recordAuditEvent({
    action: context.auditAction,
    container,
    status: 'error',
    details: message,
  });
  getWebhookCounter()?.inc({ action: context.webhookAction });

  sendErrorResponse(res, 500, `Error ${context.actionVerb} container ${safeContainerName}`);
}

/**
 * POST /watch — trigger full watch cycle on ALL watchers.
 */
async function watchAll(req: Request, res: Response) {
  const watchers = registry.getState().watcher;
  const watcherEntries = Object.entries(watchers);

  try {
    await Promise.all(watcherEntries.map(([, watcher]) => watcher.watch()));

    recordAuditEvent({
      action: 'webhook-watch',
      containerName: '*',
      status: 'success',
      details: `Triggered ${watcherEntries.length} watcher(s)`,
    });
    getWebhookCounter()?.inc({ action: 'watch-all' });

    res.status(200).json({
      message: 'Watch cycle triggered',
      result: { watchers: watcherEntries.length },
    });
  } catch (e: unknown) {
    const message = getErrorMessage(e);
    log.warn(`Error triggering watch cycle (${message})`);

    recordAuditEvent({
      action: 'webhook-watch',
      containerName: '*',
      status: 'error',
      details: message,
    });
    getWebhookCounter()?.inc({ action: 'watch-all' });

    sendErrorResponse(res, 500, 'Error triggering watch cycle');
  }
}

/**
 * POST /watch/:containerName — watch a specific container by name.
 */
async function watchContainer(req: Request, res: Response) {
  const containerName = req.params.containerName as string;
  const safeContainerName = sanitizeLogParam(containerName);
  const container = findContainerByName(containerName);

  if (!container) {
    sendErrorResponse(res, 404, CONTAINER_NOT_FOUND_ERROR);
    return;
  }

  if (!isWebhookEnabledForContainer(container)) {
    sendErrorResponse(res, 403, CONTAINER_WEBHOOK_DISABLED_ERROR);
    return;
  }

  const watchers = registry.getState().watcher;

  try {
    await Promise.all(Object.values(watchers).map((watcher) => watcher.watchContainer(container)));

    recordAuditEvent({
      action: 'webhook-watch-container',
      container,
      status: 'success',
    });
    getWebhookCounter()?.inc({ action: 'watch-container' });

    res.status(200).json({
      message: `Watch triggered for container ${safeContainerName}`,
      result: { container: safeContainerName },
    });
  } catch (e: unknown) {
    handleContainerActionError(e, container, containerName, res, {
      auditAction: 'webhook-watch-container',
      webhookAction: 'watch-container',
      actionVerb: 'watching',
    });
  }
}

/**
 * POST /update/:containerName — trigger update on a specific container by name.
 */
async function updateContainer(req: Request, res: Response) {
  const containerName = req.params.containerName as string;
  const safeContainerName = sanitizeLogParam(containerName);
  const container = findContainerByName(containerName);

  if (!container) {
    sendErrorResponse(res, 404, CONTAINER_NOT_FOUND_ERROR);
    return;
  }

  if (!isWebhookEnabledForContainer(container)) {
    sendErrorResponse(res, 403, CONTAINER_WEBHOOK_DISABLED_ERROR);
    return;
  }

  const trigger = findDockerTriggerForContainer(registry.getState().trigger, container);
  if (!trigger) {
    sendErrorResponse(res, 404, NO_DOCKER_TRIGGER_FOUND_ERROR);
    return;
  }

  try {
    await trigger.trigger(container);

    recordAuditEvent({
      action: 'webhook-update',
      container,
      status: 'success',
    });
    getWebhookCounter()?.inc({ action: 'update-container' });

    res.status(200).json({
      message: `Update triggered for container ${safeContainerName}`,
      result: { container: safeContainerName },
    });
  } catch (e: unknown) {
    handleContainerActionError(e, container, containerName, res, {
      auditAction: 'webhook-update',
      webhookAction: 'update-container',
      actionVerb: 'updating',
    });
  }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });
  router.use(webhookLimiter);
  router.use(nocache());
  router.use(authenticateToken);
  router.post('/watch', watchAll);
  router.post('/watch/:containerName', watchContainer);
  router.post('/update/:containerName', updateContainer);
  return router;
}
