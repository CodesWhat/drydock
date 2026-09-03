import type { Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getExperimentalPortwingEnabled, getServerConfiguration } from '../configuration/index.js';
import * as agentRouter from './agent.js';
import * as apiKeysRouter from './api-keys.js';
import * as appRouter from './app.js';
import * as approvalsRouter from './approvals.js';
import * as auditRouter from './audit.js';
import { requireAuthentication } from './auth.js';
import * as authenticationRouter from './authentication.js';
import * as backupRouter from './backup.js';
import * as containerRouter from './container.js';
import * as containerActionsRouter from './container-actions.js';
import * as containerDependenciesRouter from './container-dependencies.js';
import { requireSameOriginForMutations } from './csrf.js';
import * as debugRouter from './debug.js';
import * as dependencyGroupsRouter from './dependency-groups.js';
import { sendErrorResponse } from './error-response.js';
import * as groupRouter from './group.js';
import { isIconProxyApiPath } from './icons/route.js';
import * as iconsRouter from './icons.js';
import * as internalSelfUpdateRouter from './internal-self-update.js';
import { requireJsonContentTypeForMutations, shouldParseJsonBody } from './json-content-type.js';
import * as logRouter from './log.js';
import * as notificationRouter from './notification.js';
import * as notificationOutboxRouter from './notification-outbox.js';
import { withRouteScopes } from './openapi-scopes.js';
import * as operationRouter from './operation.js';
import { createOuterApiRateLimitKeyGenerator } from './outer-api-rate-limit-key.js';
import * as portwingRouter from './portwing.js';
import * as preferencesRouter from './preferences.js';
import * as previewRouter from './preview.js';
import { getPrincipal } from './principal.js';
import {
  getAuthenticatedRouteRateLimitKey,
  isIdentityAwareRateLimitKeyingEnabled,
  isRequestAuthenticated,
} from './rate-limit-key.js';
import * as registryRouter from './registry.js';
import { mountRouter, scoped } from './route-scopes.js';
import * as selfUpdateRouter from './self-update.js';
import * as serverRouter from './server.js';
import * as settingsRouter from './settings.js';
import * as sseRouter from './sse.js';
import * as statsRouter from './stats.js';
import * as storeRouter from './store.js';
import * as triggerRouter from './trigger.js';
import * as updateOperationsRouter from './update-operations.js';
import * as watcherRouter from './watcher.js';
import * as webhookRouter from './webhook.js';
import * as webhooksRouter from './webhooks.js';

function shouldSkipOuterApiRateLimit(req: Request): boolean {
  const isSafeRead = req.method === 'GET' || req.method === 'HEAD';
  return isRequestAuthenticated(req) && isSafeRead && isIconProxyApiPath(req.path);
}

/**
 * Init the API router.
 * @returns {*|Router}
 */
export function init(): express.Router {
  const router = express.Router();
  const serverConfiguration = getServerConfiguration() as Record<string, unknown>;
  const outerApiRateLimitKeyGenerator = createOuterApiRateLimitKeyGenerator(
    isIdentityAwareRateLimitKeyingEnabled(serverConfiguration),
  );
  const apiRateLimitMaximum =
    (serverConfiguration.ratelimit as { max?: number } | undefined)?.max ?? 1000;

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: apiRateLimitMaximum,
    // Icon reads have their own stricter limiter in icons.ts. Do not charge
    // those immutable assets against this outer API budget as well; Playwright
    // routing and cache-disabled clients otherwise exhaust it while the
    // dedicated icon limiter is still providing endpoint-specific protection.
    skip: shouldSkipOuterApiRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    // Always supplied, unlike before: identity-aware keying stays behind
    // DD_SERVER_RATELIMIT_IDENTITYKEYING, but splitting a presented key onto
    // its own bucket is not optional, because with it off every integration
    // behind one reverse proxy shared this budget.
    keyGenerator: outerApiRateLimitKeyGenerator,
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
  mountRouter(router, '/webhook', webhookRouter.init());
  mountRouter(router, '/webhooks', webhooksRouter.init());

  // Public OpenAPI document for integrations and API clients.
  // The document is static (built at module-load time), so we serialize it
  // once and serve a cached buffer on every request instead of re-serializing
  // the full document tree per call. The scope annotations are applied on the
  // first request rather than at module load, because they are read off this
  // router and it is still being built here.
  let cachedOpenApiJson: string | undefined;
  router.get(
    '/openapi.json',
    scoped('read', async (_req: Request, res: Response) => {
      if (!cachedOpenApiJson) {
        const { openApiDocument } = await import('./openapi.js');
        cachedOpenApiJson = JSON.stringify(withRouteScopes(openApiDocument, router));
      }
      res.type('application/json').send(cachedOpenApiJson);
    }),
  );

  // Internal self-update finalize callback used by the surviving Drydock
  // process after helper-container handoff. Guarded by loopback-only checks
  // plus a per-process shared secret in the sub-router, so it must remain
  // ahead of session auth.
  mountRouter(router, '/internal', internalSelfUpdateRouter.init());

  // Public self-update status endpoint — the UI polls this while Drydock replaces
  // its own container; the session may be unavailable mid-restart. The operation
  // UUID acts as the capability token; the response is minimal (no secrets, no
  // container snapshot). The global apiLimiter still applies.
  mountRouter(router, '/self-update', selfUpdateRouter.init());

  // The post-authentication API key budget.
  //
  // The outer apiLimiter above stays exactly as it was: it is the
  // pre-authentication IP abuse ceiling, and an invalid key spends that budget
  // and fails before ever reaching this one. This second limiter skips every
  // principal that is not a key, so sessions, Basic, OIDC and anonymous
  // traverse only the outer one.
  //
  // Keying is unconditional, unlike the outer limiter's, which is opt-in
  // behind DD_SERVER_RATELIMIT_IDENTITYKEYING. With that flag off every key
  // would otherwise be bucketed by IP, so several integrations behind one
  // reverse proxy would share a single budget — the exact deployment this
  // feature exists for.
  //
  // requestPropertyName is distinct so this limiter cannot overwrite the outer
  // limiter's state on the same request.
  const apiKeyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: (req: Request) => {
      const principal = getPrincipal(req);
      return principal?.kind === 'api-key'
        ? (principal.rateLimitMax ?? apiRateLimitMaximum)
        : apiRateLimitMaximum;
    },
    skip: (req: Request) => getPrincipal(req)?.kind !== 'api-key',
    keyGenerator: (req: Request) => getAuthenticatedRouteRateLimitKey(req),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    requestPropertyName: 'apiKeyRateLimit',
  });

  // Routes to protect after this line
  router.use(requireAuthentication);
  router.use(apiKeyLimiter);
  router.use(requireSameOriginForMutations);

  // Mount app router (authenticated — exposes version info)
  mountRouter(router, '/app', appRouter.init());

  // Mount SSE events endpoint (authenticated — UI sends session cookie)
  mountRouter(router, '/events/ui', sseRouter.init());

  // Mount log router
  mountRouter(router, '/log', logRouter.init());

  // Mount store router
  mountRouter(router, '/store', storeRouter.init());

  // Mount debug dump router
  mountRouter(router, '/debug', debugRouter.init());

  // Mount server router
  mountRouter(router, '/server', serverRouter.init());

  // Mount container groups router BEFORE container router (/:id would shadow /groups)
  mountRouter(router, '/containers', groupRouter.init());

  // Mount backup router BEFORE container router (/:id would shadow /backups)
  mountRouter(router, '/containers', backupRouter.init());

  // Mount container dependencies router BEFORE container router (/:id would shadow /dependencies)
  mountRouter(router, '/containers', containerDependenciesRouter.init());

  // Mount container router
  mountRouter(router, '/containers', containerRouter.init());

  // Mount preview router (container preview/dry-run)
  mountRouter(router, '/containers', previewRouter.init());

  // Mount container actions router (start/stop/restart)
  mountRouter(router, '/containers', containerActionsRouter.init());

  // Mount fleet-aggregate stats router (dashboard summary, sibling of /containers)
  mountRouter(router, '/stats', statsRouter.init());

  // Mount dependency groups router (bulk dependency-chain update, sibling of /containers)
  mountRouter(router, '/dependency-groups', dependencyGroupsRouter.init());

  // Mount update-operations router (single-operation lookup by id)
  mountRouter(router, '/update-operations', updateOperationsRouter.init());

  // Mount trigger router
  mountRouter(router, '/triggers', triggerRouter.init());

  // Mount notification rules router
  mountRouter(router, '/notifications', notificationRouter.init());

  // Mount notification outbox (DLQ) router
  mountRouter(router, '/notifications/outbox', notificationOutboxRouter.init());

  // Mount operations router (cancel queued operations)
  mountRouter(router, '/operations', operationRouter.init());

  // Mount watcher router
  mountRouter(router, '/watchers', watcherRouter.init());

  // Mount registry router
  mountRouter(router, '/registries', registryRouter.init());

  // Mount auth
  mountRouter(router, '/authentications', authenticationRouter.init());

  // Mount agents
  mountRouter(router, '/agents', agentRouter.init());

  // Mount Portwing key management (edge agent auth registry). It is enabled by
  // default after edge graduation and can be disabled explicitly for emergency
  // rollback with DD_EXPERIMENTAL_PORTWING=false.
  if (getExperimentalPortwingEnabled()) {
    mountRouter(router, '/portwing', portwingRouter.init());
  }

  // Mount the pending-approval queue (read-only in this slice)
  mountRouter(router, '/approvals', approvalsRouter.init());

  // Mount audit log
  mountRouter(router, '/audit', auditRouter.init());

  // Mount icons proxy (CDN cache)
  mountRouter(router, '/icons', iconsRouter.init());

  // Mount settings
  mountRouter(router, '/settings', settingsRouter.init());

  // Mount preferences (per-user synced UI preferences, #220)
  mountRouter(router, '/preferences', preferencesRouter.init());

  // Mount API key management. Declared `api-keys:manage`, which `admin` never
  // implies, so an ordinary admin key gets 403 here while a session does not.
  mountRouter(router, '/api-keys', apiKeysRouter.init());

  // All other API routes => 404. Declared `read` rather than denied: it is a
  // terminal not-found handler, and answering an unmatched path with 403
  // instead of 404 would tell a caller less while reading as a permissions
  // bug. It exposes nothing — there is no route behind it.
  router.get(
    '/{*path}',
    scoped('read', (_req: Request, res: Response) => {
      sendErrorResponse(res, 404, 'Route not found');
    }),
  );

  return router;
}
