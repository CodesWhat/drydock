// @ts-nocheck
import fs from 'node:fs';
import https from 'node:https';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import logger from '../log/index.js';
import { resolveConfiguredPath } from '../runtime/paths.js';

const log = logger.child({ component: 'api' });

import { getServerConfiguration } from '../configuration/index.js';
import * as apiRouter from './api.js';
import * as auth from './auth.js';
import * as healthRouter from './health.js';
import * as prometheusRouter from './prometheus.js';
import * as uiRouter from './ui.js';

const configuration = getServerConfiguration();

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function shouldSkipCompression(req) {
  const acceptsEventStream =
    typeof req.headers?.accept === 'string' && req.headers.accept.includes('text/event-stream');
  return (
    acceptsEventStream || req.path.startsWith('/api/events/') || req.path.startsWith('/events/')
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
  app.use(
    cors({
      origin: configuration.cors.origin,
      methods: configuration.cors.methods,
    }),
  );
}

function registerRoutes(app) {
  auth.init(app);
  app.use('/health', healthRouter.init());
  app.use('/api', apiRouter.init());
  app.use('/metrics', prometheusRouter.init());
  app.use('/', uiRouter.init());
}

function registerErrorHandler(app) {
  // Global JSON error handler — ensures unhandled exceptions return JSON instead of HTML
  app.use((err, _req, res, _next) => {
    log.error(`Unhandled error: ${toErrorMessage(err)}`);
    res.status(err.status || 500).json({ error: 'Internal server error' });
  });
}

function readTlsFile(path, label) {
  try {
    return fs.readFileSync(path);
  } catch (error) {
    log.error(`Unable to read the ${label} file under ${path} (${toErrorMessage(error)})`);
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

  https.createServer({ key: serverKey, cert: serverCert }, app).listen(configuration.port, () => {
    log.info(`Server listening on port ${configuration.port} (HTTPS)`);
  });
}

function startHttpServer(app) {
  app.listen(configuration.port, () => {
    log.info(`Server listening on port ${configuration.port} (HTTP)`);
  });
}

function startServer(app) {
  if (configuration.tls.enabled) {
    startHttpsServer(app);
    return;
  }

  // Listen plain HTTP
  startHttpServer(app);
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

  if (configuration.compression?.enabled !== false) {
    app.use(createCompressionMiddleware());
  }

  configureCors(app);
  app.use(express.json());
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
  startServer(app);
}
