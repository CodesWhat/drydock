// @ts-nocheck
import fs from 'node:fs';
import https from 'node:https';
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

/**
 * Init Http API.
 * @returns {Promise<void>}
 */
export async function init() {
  // Start API if enabled
  if (configuration.enabled) {
    log.debug(`API/UI enabled => Start Http listener on port ${configuration.port}`);

    // Init Express app
    const app = express();

    // Trust proxy (helpful to resolve public facing hostname & protocol)
    if (configuration.trustproxy !== false) {
      app.set('trust proxy', configuration.trustproxy);
    }

    // Replace undefined values by null to prevent them from being removed from json responses
    app.set('json replacer', (key, value) => (value === undefined ? null : value));

    if (configuration.cors.enabled) {
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

    // Init auth
    auth.init(app);

    // Parse json payloads
    app.use(express.json());

    // Mount Healthcheck
    app.use('/health', healthRouter.init());

    // Mount API
    app.use('/api', apiRouter.init());

    // Mount Prometheus metrics
    app.use('/metrics', prometheusRouter.init());

    // Serve ui (resulting from ui built & copied on docker build)
    app.use('/', uiRouter.init());

    if (configuration.tls.enabled) {
      let serverKey;
      let serverCert;
      const keyPath = resolveConfiguredPath(configuration.tls.key, {
        label: 'TLS key path',
      });
      const certPath = resolveConfiguredPath(configuration.tls.cert, {
        label: 'TLS cert path',
      });
      try {
        serverKey = fs.readFileSync(keyPath);
      } catch (e) {
        log.error(`Unable to read the key file under ${keyPath} (${e.message})`);
        throw e;
      }
      try {
        serverCert = fs.readFileSync(certPath);
      } catch (e) {
        log.error(`Unable to read the cert file under ${certPath} (${e.message})`);
        throw e;
      }
      https
        .createServer({ key: serverKey, cert: serverCert }, app)
        .listen(configuration.port, () => {
          log.info(`Server listening on port ${configuration.port} (HTTPS)`);
        });
    } else {
      // Listen plain HTTP
      app.listen(configuration.port, () => {
        log.info(`Server listening on port ${configuration.port} (HTTP)`);
      });
    }
  } else {
    log.debug('API/UI disabled');
  }
}
