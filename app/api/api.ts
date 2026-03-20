import type { Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getServerConfiguration } from '../configuration/index.js';
import * as agentRouter from './agent.js';
import * as appRouter from './app.js';
import * as auditRouter from './audit.js';
import { requireAuthentication } from './auth.js';
import * as authenticationRouter from './authentication.js';
import * as backupRouter from './backup.js';
import * as containerRouter from './container.js';
import * as containerActionsRouter from './container-actions.js';
import { requireSameOriginForMutations } from './csrf.js';
import * as debugRouter from './debug.js';
import { sendErrorResponse } from './error-response.js';
import * as groupRouter from './group.js';
import * as iconsRouter from './icons.js';
import { requireJsonContentTypeForMutations, shouldParseJsonBody } from './json-content-type.js';
import * as logRouter from './log.js';
import * as notificationRouter from './notification.js';
import * as previewRouter from './preview.js';
import {
  createAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled,
} from './rate-limit-key.js';
import * as registryRouter from './registry.js';
import * as serverRouter from './server.js';
import * as settingsRouter from './settings.js';
import * as sseRouter from './sse.js';
import * as storeRouter from './store.js';
import * as triggerRouter from './trigger.js';
import * as watcherRouter from './watcher.js';
import * as webhookRouter from './webhook.js';
import * as webhooksRouter from './webhooks.js';

/**
 * Init the API router.
 * @returns {*|Router}
 */
export function init(): express.Router {
  const router = express.Router();
  const serverConfiguration = getServerConfiguration() as Record<string, unknown>;
  const identityAwareRateLimitKeyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(
    isIdentityAwareRateLimitKeyingEnabled(serverConfiguration),
  );

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    ...(identityAwareRateLimitKeyGenerator
      ? { keyGenerator: identityAwareRateLimitKeyGenerator }
      : {}),
  });
  router.use(apiLimiter);

  const mutationJsonBodyParser = express.json({
    limit: '256kb',
    verify: (req, _res, buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  });
  router.use(requireJsonContentTypeForMutations);
  router.use((req, res, next) => {
    if (shouldParseJsonBody(req.method)) {
      return mutationJsonBodyParser(req, res, next);
    }
    return next();
  });

  // Mount webhook router (uses its own bearer token auth)
  router.use('/webhook', webhookRouter.init());
  router.use('/webhooks', webhooksRouter.init());

  // Public OpenAPI document for integrations and API clients.
  router.get('/openapi.json', async (_req: Request, res: Response) => {
    const { openApiDocument } = await import('./openapi.js');
    res.status(200).json(openApiDocument);
  });

  // Routes to protect after this line
  router.use(requireAuthentication);
  router.use(requireSameOriginForMutations);

  // Mount app router (authenticated — exposes version info)
  router.use('/app', appRouter.init());

  // Mount SSE events endpoint (authenticated — UI sends session cookie)
  router.use('/events/ui', sseRouter.init());

  // Mount log router
  router.use('/log', logRouter.init());

  // Mount store router
  router.use('/store', storeRouter.init());

  // Mount debug dump router
  router.use('/debug', debugRouter.init());

  // Mount server router
  router.use('/server', serverRouter.init());

  // Mount container groups router BEFORE container router (/:id would shadow /groups)
  router.use('/containers', groupRouter.init());

  // Mount container router
  router.use('/containers', containerRouter.init());

  // Mount preview router (container preview/dry-run)
  router.use('/containers', previewRouter.init());

  // Mount backup router (image backup/rollback)
  router.use('/containers', backupRouter.init());

  // Mount container actions router (start/stop/restart)
  router.use('/containers', containerActionsRouter.init());

  // Mount trigger router
  router.use('/triggers', triggerRouter.init());

  // Mount notification rules router
  router.use('/notifications', notificationRouter.init());

  // Mount watcher router
  router.use('/watchers', watcherRouter.init());

  // Mount registry router
  router.use('/registries', registryRouter.init());

  // Mount auth
  router.use('/authentications', authenticationRouter.init());

  // Mount agents
  router.use('/agents', agentRouter.init());

  // Mount audit log
  router.use('/audit', auditRouter.init());

  // Mount icons proxy (CDN cache)
  router.use('/icons', iconsRouter.init());

  // Mount settings
  router.use('/settings', settingsRouter.init());

  // All other API routes => 404
  router.get('/{*path}', (_req: Request, res: Response) => {
    sendErrorResponse(res, 404, 'Route not found');
  });

  return router;
}
