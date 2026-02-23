// @ts-nocheck
import express from 'express';
import rateLimit from 'express-rate-limit';
import * as agentRouter from './agent.js';
import * as appRouter from './app.js';
import * as auditRouter from './audit.js';
import { requireAuthentication } from './auth.js';
import * as authenticationRouter from './authentication.js';
import * as backupRouter from './backup.js';
import * as containerRouter from './container.js';
import * as containerActionsRouter from './container-actions.js';
import * as groupRouter from './group.js';
import * as iconsRouter from './icons.js';
import * as logRouter from './log.js';
import * as notificationRouter from './notification.js';
import * as previewRouter from './preview.js';
import * as registryRouter from './registry.js';
import * as serverRouter from './server.js';
import * as settingsRouter from './settings.js';
import * as sseRouter from './sse.js';
import * as storeRouter from './store.js';
import * as triggerRouter from './trigger.js';
import * as watcherRouter from './watcher.js';
import * as webhookRouter from './webhook.js';

/**
 * Init the API router.
 * @returns {*|Router}
 */
export function init() {
  const router = express.Router();

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });
  router.use(apiLimiter);

  // Mount app router
  router.use('/app', appRouter.init());

  // Mount webhook router (uses its own bearer token auth)
  router.use('/webhook', webhookRouter.init());

  // Routes to protect after this line
  router.use(requireAuthentication);

  // Mount SSE events endpoint (authenticated — UI sends session cookie)
  router.use('/events/ui', sseRouter.init());

  // Mount log router
  router.use('/log', logRouter.init());

  // Mount store router
  router.use('/store', storeRouter.init());

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
  router.get('/{*path}', (req, res) => res.sendStatus(404));

  return router;
}
