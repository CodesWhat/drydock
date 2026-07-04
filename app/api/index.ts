import fs from 'node:fs';
import https from 'node:https';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import logger from '../log/index.js';
import { resolveConfiguredPath } from '../runtime/paths.js';
import { getErrorMessage } from '../util/error.js';

const log = logger.child({ component: 'api' });

import {
  ddEnvVars,
  getExperimentalPortwingEnabled,
  getServerConfiguration,
  getWudCardCompatEnabled,
} from '../configuration/index.js';
import { recordLegacyInput } from '../prometheus/compatibility.js';
import * as settingsStore from '../store/settings.js';
import * as apiRouter from './api.js';
import * as auth from './auth.js';
import { getAllIds } from './auth-strategies.js';
import * as wudCardCompatRouter from './compat/wudcard.js';
import { attachContainerLogStreamWebSocketServer } from './container/log-stream.js';
import { sendErrorResponse } from './error-response.js';
import * as healthRouter from './health.js';
import { attachSystemLogStreamWebSocketServer } from './log-stream.js';
import { attachPortwingWsServer } from './portwing-ws.js';
import * as prometheusRouter from './prometheus.js';
import * as uiRouter from './ui.js';
import { createFixedWindowRateLimiter } from './ws-upgrade-utils.js';

const configuration = getServerConfiguration();

function shouldSkipCompression(req) {
  const acceptsEventStream =
    typeof req.headers?.accept === 'string' && req.headers.accept.includes('text/event-stream');
  return (
    acceptsEventStream ||
    req.path.startsWith('/api/events/') ||
    req.path.startsWith('/api/v1/events/') ||
    req.path.startsWith('/events/')
  );
}

function createCompressionMiddleware() {
  return compression({
    threshold: configuration.compression?.threshold ?? 1024,
    // Avoid compressing SSE streams to prevent buffering and delayed events.
    filter: (req, res) => {
      if (shouldSkipCompression(req)) return false;
      return compression.filter(req, res);
    },
  });
}

function configureCors(app) {
  if (!configuration.cors.enabled) return;
  const explicitCorsOrigin =
    typeof ddEnvVars.DD_SERVER_CORS_ORIGIN === 'string'
      ? ddEnvVars.DD_SERVER_CORS_ORIGIN.trim()
      : '';
  if (!explicitCorsOrigin) {
    throw new Error('DD_SERVER_CORS_ORIGIN must be configured when CORS is enabled');
  }
  log.warn(
    `CORS is enabled, please make sure that the provided configuration is not a security breech (${JSON.stringify(configuration.cors)})`,
  );
  app.use(
    cors({
      origin: configuration.cors.origin,
      methods: configuration.cors.methods,
    }),
  );
}

function configureSecurityHeaders(app) {
  const connectSources = ["'self'"];
  if (!settingsStore.isInternetlessModeEnabled()) {
    connectSources.push(
      'https://api.iconify.design',
      'https://api.simplesvg.com',
      'https://api.unisvg.com',
    );
  }

  const tlsEnabled = configuration.tls.enabled === true;

  app.use(
    helmet({
      // Disable HSTS when not serving over TLS — browsers would otherwise
      // try to upgrade all future requests to HTTPS, breaking plain-HTTP
      // deployments (see #105).
      strictTransportSecurity: tlsEnabled,
      crossOriginEmbedderPolicy: { policy: 'require-corp' },
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          // unsafe-inline required for vendor libraries (iconify-icon, Vue
          // Transition) that set element.style programmatically.
          'style-src': ["'self'", "'unsafe-inline'"],
          'style-src-attr': ["'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': connectSources,
          // Prevent browsers from upgrading HTTP sub-resource requests to
          // HTTPS when TLS is not configured (#105).
          // [] = include directive with no value; null = omit directive.
          'upgrade-insecure-requests': tlsEnabled ? [] : null,
        },
      },
    }),
  );
}

function configurePermissionsPolicy(app) {
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
    );
    next();
  });
}

// Unversioned /api/* alias removal (v1.6.0, DEPRECATIONS.md) — track real
// usage through the same compatibility/legacyInputs mechanism the WUD_*
// env/label sources use (recordLegacyInput + dd_legacy_input_total), so the
// UI deprecation banner keeps reflecting live traffic against the removed
// path instead of going dark the moment it starts 410ing. Mounted only on
// the former alias mount below (not on /api/v1), and mounted BEFORE the
// (optional) wud-card compat router so every request under the unversioned
// /api prefix is counted. This ordering matters now: the compat router owns
// its own internal apiRouter instance and answers its whitelisted requests
// directly, without calling next() into anything mounted after it — so if
// this tracking middleware were mounted after the compat router instead,
// whitelisted requests would never reach it.
//
// The v1 router's catch-all (app/api/api.ts) is GET-only, so a non-GET
// request to an unmatched /api/v1/* path never resolves inside that router
// at all — Express falls through past the /api/v1 mount and back into this
// '/api'-mounted middleware, arriving with req.path like '/v1/bogus'. Guard
// explicitly against that so genuine /api/v1/* traffic (any method) is never
// misrecorded as unversioned-alias usage.
//
// The recorded key MUST be a bounded route *pattern* (e.g.
// "/api/containers/:id/stats"), never the raw request path — every dynamic
// route beneath the alias embeds a live identifier (container id, operation
// id, agent name, trigger name...), so keying by req.path would grow the
// legacyInputCounts map and the dd_legacy_input_total series unboundedly,
// one entry per distinct id ever seen. Express's router sets req.route and
// req.baseUrl synchronously the instant a route matches — before the
// handler runs — and they persist on the request for its lifetime, so
// reading them once the response has finished reliably yields the literal
// `:param` template the request resolved to, capping the key space at the
// size of the API surface (same order of magnitude as the fixed env/label
// name sets those other legacy-input sources use). Now that the real alias
// router is gone, req.route is only ever set for the compat router's four
// whitelisted routes (when DD_COMPAT_WUDCARD is enabled) — every other hit
// falls straight through to the tombstone below without matching a route,
// so getLegacyApiAliasRouteKey's 'unmatched' fallback is the common case.
function trackLegacyApiAliasUsage(req, res, next) {
  if (req.path === '/v1' || req.path.startsWith('/v1/')) {
    next();
    return;
  }
  res.on('finish', () => {
    recordLegacyInput('api', getLegacyApiAliasRouteKey(req));
  });
  next();
}

function getLegacyApiAliasRouteKey(req) {
  return req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
}

// Tombstone for the removed unversioned /api/* alias (removed in v1.6.0 —
// see DEPRECATIONS.md). Mounted last in the '/api' chain, after the legacy
// usage tracker and the optional wud-card compat router, so it only ever
// answers requests neither of those handled. A plain function mounted via
// app.use('/api', ...) — rather than a Router with its own catch-all route —
// matches every method and every subpath beneath /api (including /api
// itself), exactly like the apiRouter mount it replaces.
//
// Needs the same /v1 fallthrough guard as trackLegacyApiAliasUsage above, for
// the same reason: the v1 router's catch-all (app/api/api.ts) is GET-only, so
// a non-GET request to an otherwise-valid /api/v1/* path that only defines a
// GET handler (e.g. DELETE /api/v1/app) never resolves inside the /api/v1
// mount and falls through into this '/api'-mounted chain with req.path like
// '/v1/app'. Without the guard this middleware would answer that fallthrough
// with a false "unversioned alias removed" 410 instead of letting it continue
// past this mount to Express's own 404 handling, exactly like it did before
// this middleware existed.
function sendUnversionedApiTombstone(req, res, next) {
  if (req.path === '/v1' || req.path.startsWith('/v1/')) {
    next();
    return;
  }
  sendErrorResponse(res, 410, {
    message: 'The unversioned /api/* path was removed in v1.6.0. Use /api/v1/* instead.',
    details: {
      canonicalBasePath: '/api/v1',
      compat:
        'WUD-era clients (wud-card, Homepage whatsupdocker widget) can enable DD_COMPAT_WUDCARD',
      docs: 'https://getdrydock.com/docs/deprecations#unversioned-api-paths',
    },
  });
}

function registerRoutes(app) {
  // Wire the health readiness gate before auth.init() so that /health
  // returns 503 if somehow a request arrives before passport strategies
  // are registered. getAllIds() is a live check: empty until
  // registerStrategies() populates STRATEGY_IDS inside auth.init().
  // This closes the gap where /health can flip 200 before login is ready
  // (the DAST post-rc.28 401 race).
  healthRouter.setAuthReadyFn(() => getAllIds().length > 0);
  auth.init(app);
  app.use('/health', healthRouter.init());
  app.use('/api/v1', apiRouter.init());
  app.use('/api', trackLegacyApiAliasUsage);
  if (getWudCardCompatEnabled()) {
    log.info('wud-card compatibility enabled at /api (DD_COMPAT_WUDCARD=true)');
    app.use('/api', wudCardCompatRouter.init());
  }
  app.use('/api', sendUnversionedApiTombstone);
  app.use('/metrics', prometheusRouter.init());
  if (configuration.ui?.enabled !== false) {
    app.use('/', uiRouter.init());
    return;
  }
  log.info('UI router disabled by DD_SERVER_UI_ENABLED=false');
}

function registerErrorHandler(app) {
  // Global JSON error handler — ensures unhandled exceptions return JSON instead of HTML
  app.use((err, _req, res, _next) => {
    log.error(`Unhandled error: ${getErrorMessage(err)}`);
    sendErrorResponse(res, err.status || 500, 'Internal server error');
  });
}

function readTlsFile(path, label) {
  try {
    return fs.readFileSync(path);
  } catch (error) {
    log.error(`Unable to read the ${label} file under ${path} (${getErrorMessage(error)})`);
    throw error;
  }
}

function startHttpsServer(app) {
  const keyPath = resolveConfiguredPath(configuration.tls.key, {
    label: 'TLS key path',
  });
  const certPath = resolveConfiguredPath(configuration.tls.cert, {
    label: 'TLS cert path',
  });
  const serverKey = readTlsFile(keyPath, 'key');
  const serverCert = readTlsFile(certPath, 'cert');

  const server = https.createServer({ key: serverKey, cert: serverCert }, app);
  server.listen(configuration.port, () => {
    log.info(`Server listening on port ${configuration.port} (HTTPS)`);
  });
  return server;
}

function startHttpServer(app) {
  return app.listen(configuration.port, () => {
    log.info(`Server listening on port ${configuration.port} (HTTP)`);
  });
}

function startServer(app) {
  if (configuration.tls.enabled === true) {
    return startHttpsServer(app);
  }

  // Listen plain HTTP
  return startHttpServer(app);
}

// Mirror the isTrustProxyEnabled semantics from auth.ts exactly: enabled when
// boolean true, number > 0, or a non-empty string that is not '0' or 'false'.
// Numeric 0 and the strings '0'/'false' are all treated as disabled so that
// DD_SERVER_TRUSTPROXY=0 (which Joi parses to the number 0) gets the
// warnOnReverseProxyProtoMismatch diagnostic middleware, not app.set('trust proxy', 0).
function isTrustProxyEnabled(trustproxy: boolean | number | string): boolean {
  if (trustproxy === true) {
    return true;
  }
  if (typeof trustproxy === 'number') {
    return trustproxy > 0;
  }
  if (typeof trustproxy === 'string') {
    const normalized = trustproxy.trim().toLowerCase();
    return normalized !== '' && normalized !== '0' && normalized !== 'false';
  }
  return false;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Trust proxy (helpful to resolve public facing hostname & protocol)
  if (isTrustProxyEnabled(configuration.trustproxy)) {
    if (configuration.trustproxy === true) {
      log.warn(
        'trust proxy is set to boolean true, which trusts ALL X-Forwarded-For hops. ' +
          'Clients can spoof req.ip and evade per-IP login lockout. ' +
          'Operators behind a single proxy should set DD_SERVER_TRUSTPROXY=1 (the exact hop count) instead.',
      );
    }
    app.set('trust proxy', configuration.trustproxy);
  } else {
    // Trust proxy is disabled. If a TLS-terminating reverse proxy forwards
    // "X-Forwarded-Proto: https" but the internal connection is plain HTTP,
    // drydock treats its own origin as http:// while the browser sends https://
    // — so the same-origin check rejects every state-changing request with a
    // 403 "CSRF validation failed". Warn once (the closure flag suppresses
    // repeats; the middleware itself stays in the stack) so operators can
    // self-diagnose instead of filing a bug.
    let warnedReverseProxyMismatch = false;
    app.use(function warnOnReverseProxyProtoMismatch(req, _res, next) {
      if (!warnedReverseProxyMismatch && req.protocol === 'http') {
        const forwardedProto = String(req.get('x-forwarded-proto') ?? '')
          .split(',')[0]
          .trim()
          .toLowerCase();
        if (forwardedProto === 'https') {
          warnedReverseProxyMismatch = true;
          log.warn(
            'Detected "X-Forwarded-Proto: https" but DD_SERVER_TRUSTPROXY is not set. ' +
              'drydock treats its own origin as http:// while browsers send https://, so ' +
              'every state-changing request (manual update, recheck, scan) is rejected with ' +
              '403 "CSRF validation failed". Set DD_SERVER_TRUSTPROXY=1 (the number of proxy ' +
              'hops) to resolve this. ' +
              'See https://getdrydock.com/docs/faq#csrf-validation-failed-403-behind-a-reverse-proxy',
          );
        }
      }
      next();
    });
  }

  // Replace undefined values by null to prevent them from being removed from json responses
  app.set('json replacer', (key, value) => (value === undefined ? null : value));

  configureSecurityHeaders(app);
  configurePermissionsPolicy(app);

  if (configuration.compression?.enabled !== false) {
    app.use(createCompressionMiddleware());
  }

  configureCors(app);
  registerRoutes(app);
  registerErrorHandler(app);
  return app;
}

/**
 * Init Http API.
 * @returns {Promise<void>}
 */
export async function init() {
  if (!configuration.enabled) {
    log.debug('API/UI disabled');
    return;
  }

  log.debug(`API/UI enabled => Start Http listener on port ${configuration.port}`);
  const app = createApp();
  const server = startServer(app);
  const sharedLimiter = createFixedWindowRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 1000,
  });
  const isRateLimited = (key: string) => !sharedLimiter.consume(key);
  attachContainerLogStreamWebSocketServer({
    server,
    sessionMiddleware: auth.getSessionMiddleware?.(),
    serverConfiguration: configuration as Record<string, unknown>,
    isRateLimited,
  });
  attachSystemLogStreamWebSocketServer({
    server,
    sessionMiddleware: auth.getSessionMiddleware?.(),
    serverConfiguration: configuration as Record<string, unknown>,
    isRateLimited,
  });
  if (getExperimentalPortwingEnabled()) {
    log.info('portwing/1.0 edge endpoint enabled (experimental, DD_EXPERIMENTAL_PORTWING=true)');
    attachPortwingWsServer({
      server,
      serverConfiguration: configuration as Record<string, unknown>,
      isRateLimited,
    });
  } else {
    log.info(
      'portwing/1.0 edge endpoint is disabled — set DD_EXPERIMENTAL_PORTWING=true to enable it',
    );
  }
}
