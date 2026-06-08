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
import { requestContainerUpdate, UpdateRequestError } from '../updates/request-update.js';
import { getErrorMessage } from '../util/error.js';
import { ddWebhookEnabled, wudWebhookEnabled } from '../watchers/providers/docker/label.js';
import { recordAuditEvent } from './audit-events.js';
import { resolveWatcherIdForContainer } from './container/handlers/common.js';
import { sendErrorResponse } from './error-response.js';

const log = logger.child({ component: 'webhook' });

const router = express.Router();

type WebhookAction = 'watchall' | 'watch' | 'update';
const LOCAL_AGENT_QUERY_VALUE = '__local__';

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
  if (!action) {
    return webhookConfig.token;
  }

  const hasAnyEndpointToken = [
    webhookConfig.tokens?.watchall,
    webhookConfig.tokens?.watch,
    webhookConfig.tokens?.update,
  ].some((token) => typeof token === 'string' && token.length > 0);

  if (hasAnyEndpointToken) {
    // Fail closed: once endpoint-specific token mode is enabled, each endpoint must set its own token.
    return webhookConfig.tokens?.[action] || '';
  }

  return webhookConfig.token;
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
 * Find a container by name from the store, with optional agent/watcher disambiguation. // #386
 * Returns { container } on unambiguous match, { candidates } when multiple match (409 caller),
 * or undefined when no match (404 caller).
 */
function findContainerByName(
  containerName: string,
  filters: { agent?: string; watcher?: string } = {},
):
  | { container: ReturnType<typeof storeContainer.getContainers>[number]; candidates?: undefined }
  | { container?: undefined; candidates: ReturnType<typeof storeContainer.getContainers> }
  | undefined {
  const allByName = storeContainer.getContainers({}).filter((c) => c.name === containerName);

  // Apply optional disambiguation filters // #386
  const candidates =
    filters.agent !== undefined || filters.watcher !== undefined
      ? allByName.filter(
          (c) =>
            (filters.agent === undefined || matchesAgentFilter(c.agent, filters.agent)) &&
            (filters.watcher === undefined || c.watcher === filters.watcher),
        )
      : allByName;

  if (candidates.length === 0) {
    return undefined;
  }
  if (candidates.length === 1) {
    return { container: candidates[0] };
  }
  // Multiple matches — caller must return 409 // #386
  return { candidates };
}

type StoreContainer = ReturnType<typeof storeContainer.getContainers>[number];

function matchesAgentFilter(containerAgent: unknown, agentFilter: string): boolean {
  if (agentFilter === LOCAL_AGENT_QUERY_VALUE) {
    return containerAgent === undefined || containerAgent === null || containerAgent === '';
  }
  return containerAgent === agentFilter;
}

function formatAgentForAmbiguityMessage(agent: unknown): string {
  if (agent === undefined || agent === null || agent === '') {
    return LOCAL_AGENT_QUERY_VALUE;
  }
  return String(agent);
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
function isWebhookEnabledForContainer(container: StoreContainer): boolean {
  const labels = container.labels;
  if (!labels) return true;
  const value = labels[ddWebhookEnabled] ?? labels[wudWebhookEnabled];
  if (value === undefined) return true;
  return value.toLowerCase() !== 'false';
}

function handleContainerActionError(
  error: unknown,
  container: StoreContainer,
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
    details: sanitizeLogParam(message),
  });
  getWebhookCounter()?.inc({ action: context.webhookAction });

  sendErrorResponse(res, 500, `Error ${context.actionVerb} container ${safeContainerName}`);
}

function handleWatchAllError(error: unknown, res: Response) {
  const message = getErrorMessage(error);
  log.warn(`Error triggering watch cycle (${sanitizeLogParam(message)})`);

  recordAuditEvent({
    action: 'webhook-watch',
    containerName: '*',
    status: 'error',
    details: sanitizeLogParam(message),
  });
  getWebhookCounter()?.inc({ action: 'watch-all' });

  sendErrorResponse(res, 500, 'Error triggering watch cycle');
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
    handleWatchAllError(e, res);
  }
}

/**
 * POST /watch/:containerName — watch a specific container by name.
 */
async function watchContainer(req: Request, res: Response) {
  const containerName = req.params.containerName as string;
  const safeContainerName = sanitizeLogParam(containerName);

  // #386: disambiguate across agents/watchers via optional query params
  const agentFilter = typeof req.query.agent === 'string' ? req.query.agent : undefined;
  const watcherFilter = typeof req.query.watcher === 'string' ? req.query.watcher : undefined;
  const found = findContainerByName(containerName, { agent: agentFilter, watcher: watcherFilter });

  if (!found) {
    sendErrorResponse(res, 404, CONTAINER_NOT_FOUND_ERROR);
    return;
  }

  if (found.candidates) {
    // #386: ambiguous name across agents/watchers — require disambiguation
    const pairs = found.candidates
      .map((c) => `agent=${formatAgentForAmbiguityMessage(c.agent)},watcher=${c.watcher}`)
      .join('; ');
    sendErrorResponse(
      res,
      409,
      `Ambiguous container name: matches multiple sources (${pairs}). Add ?agent=${LOCAL_AGENT_QUERY_VALUE} for controller-local containers, or use ?agent= and/or ?watcher= to disambiguate.`,
    );
    return;
  }

  const container = found.container;

  if (!isWebhookEnabledForContainer(container)) {
    sendErrorResponse(res, 403, CONTAINER_WEBHOOK_DISABLED_ERROR);
    return;
  }

  // #386: dispatch to the owning watcher only, mirroring actions.ts
  const watcherId = resolveWatcherIdForContainer(container);
  const watcher = registry.getState().watcher[watcherId];
  if (!watcher) {
    sendErrorResponse(
      res,
      500,
      `No provider found for container ${safeContainerName} and provider ${watcherId}`,
    );
    return;
  }

  try {
    await watcher.watchContainer(container);

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

  // #386: disambiguate across agents/watchers via optional query params
  const agentFilter = typeof req.query.agent === 'string' ? req.query.agent : undefined;
  const watcherFilter = typeof req.query.watcher === 'string' ? req.query.watcher : undefined;
  const found = findContainerByName(containerName, { agent: agentFilter, watcher: watcherFilter });

  if (!found) {
    sendErrorResponse(res, 404, CONTAINER_NOT_FOUND_ERROR);
    return;
  }

  if (found.candidates) {
    // #386: ambiguous name across agents/watchers — require disambiguation
    const pairs = found.candidates
      .map((c) => `agent=${formatAgentForAmbiguityMessage(c.agent)},watcher=${c.watcher}`)
      .join('; ');
    sendErrorResponse(
      res,
      409,
      `Ambiguous container name: matches multiple sources (${pairs}). Add ?agent=${LOCAL_AGENT_QUERY_VALUE} for controller-local containers, or use ?agent= and/or ?watcher= to disambiguate.`,
    );
    return;
  }

  const container = found.container;

  if (!isWebhookEnabledForContainer(container)) {
    sendErrorResponse(res, 403, CONTAINER_WEBHOOK_DISABLED_ERROR);
    return;
  }

  try {
    const accepted = await requestContainerUpdate(container);
    getWebhookCounter()?.inc({ action: 'update-container' });

    res.status(202).json({
      message: `Update accepted for container ${safeContainerName}`,
      operationId: accepted.operationId,
      result: { container: safeContainerName },
    });
  } catch (e: unknown) {
    if (e instanceof UpdateRequestError) {
      sendErrorResponse(res, e.statusCode, e.message);
      return;
    }

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
