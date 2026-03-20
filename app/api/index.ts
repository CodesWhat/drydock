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

import { ddEnvVars, getServerConfiguration } from '../configuration/index.js';
import * as settingsStore from '../store/settings.js';
import * as apiRouter from './api.js';
import * as auth from './auth.js';
import { attachContainerLogStreamWebSocketServer } from './container/log-stream.js';
import { sendErrorResponse } from './error-response.js';
import * as healthRouter from './health.js';
import { attachSystemLogStreamWebSocketServer } from './log-stream.js';
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
  log.warn(
    `CORS is enabled, please make sure that the provided configuration is not a security breech (${JSON.stringify(configuration.cors)})`,
  );
  const hasExplicitCorsOrigin = Object.hasOwn(ddEnvVars, 'DD_SERVER_CORS_ORIGIN');
  if (configuration.cors.origin === '*' && !hasExplicitCorsOrigin) {
    log.warn(
      'CORS enabled without explicit origin. The default wildcard origin is deprecated and will be removed in v1.6.0. Set DD_SERVER_CORS_ORIGIN to your trusted origin(s) to silence this warning.',
    );
  }
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

function registerRoutes(app) {
  auth.init(app);
  app.use('/health', healthRouter.init());
  app.use('/api/v1', apiRouter.init());
  log.warn(
    'Unversioned /api/* path is deprecated and will be removed in v1.6.0. Use /api/v1/* instead.',
  );
  app.use('/api', apiRouter.init());
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

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Trust proxy (helpful to resolve public facing hostname & protocol)
  if (configuration.trustproxy !== false) {
    app.set('trust proxy', configuration.trustproxy);
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
}
