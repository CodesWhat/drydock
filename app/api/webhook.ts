import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import nocache from 'nocache';
import { getWebhookConfiguration } from '../configuration/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { getWebhookCounter } from '../prometheus/webhook.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { recordAuditEvent } from './audit-events.js';
import { findDockerTriggerForContainer, NO_DOCKER_TRIGGER_FOUND_ERROR } from './docker-trigger.js';

const log = logger.child({ component: 'webhook' });

const router = express.Router();

/**
 * Authenticate webhook requests via Bearer token.
 */
function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const webhookConfig = getWebhookConfiguration();
  if (!webhookConfig.enabled) {
    res.status(403).json({ error: 'Webhooks are disabled' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const configuredToken = webhookConfig.token;

  // Reject empty or missing configured token (misconfiguration guard)
  if (!configuredToken) {
    log.error('Webhook token is not configured; rejecting request');
    res.status(500).json({ error: 'Webhook authentication is misconfigured' });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token, 'utf8');
  const expectedBuf = Buffer.from(configuredToken, 'utf8');
  if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  next();
}

/**
 * Find a container by name from the store.
 */
function findContainerByName(containerName: string) {
  const containers = storeContainer.getContainers();
  return containers.find((c) => c.name === containerName);
}

type ContainerWebhookErrorContext = {
  auditAction: 'webhook-watch-container' | 'webhook-update';
  webhookAction: 'watch-container' | 'update-container';
  actionVerb: 'watching' | 'updating';
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function handleContainerActionError(
  error: unknown,
  container: NonNullable<ReturnType<typeof findContainerByName>>,
  containerName: string,
  res: Response,
  context: ContainerWebhookErrorContext,
) {
  const message = getErrorMessage(error);
  log.warn(
    `Error ${context.actionVerb} container ${sanitizeLogParam(containerName)} (${sanitizeLogParam(message)})`,
  );

  recordAuditEvent({
    action: context.auditAction,
    container,
    status: 'error',
    details: message,
  });
  getWebhookCounter()?.inc({ action: context.webhookAction });

  res.status(500).json({ error: `Error ${context.actionVerb} container ${containerName}` });
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
      watchers: watcherEntries.length,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn(`Error triggering watch cycle (${message})`);

    recordAuditEvent({
      action: 'webhook-watch',
      containerName: '*',
      status: 'error',
      details: message,
    });
    getWebhookCounter()?.inc({ action: 'watch-all' });

    res.status(500).json({ error: 'Error triggering watch cycle' });
  }
}

/**
 * POST /watch/:containerName — watch a specific container by name.
 */
async function watchContainer(req: Request, res: Response) {
  const { containerName } = req.params;
  const container = findContainerByName(containerName);

  if (!container) {
    res.status(404).json({ error: `Container ${containerName} not found` });
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
      message: `Watch triggered for container ${containerName}`,
      container: containerName,
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
  const { containerName } = req.params;
  const container = findContainerByName(containerName);

  if (!container) {
    res.status(404).json({ error: `Container ${containerName} not found` });
    return;
  }

  const trigger = findDockerTriggerForContainer(registry.getState().trigger, container);
  if (!trigger) {
    res.status(404).json({ error: NO_DOCKER_TRIGGER_FOUND_ERROR });
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
      message: `Update triggered for container ${containerName}`,
      container: containerName,
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
