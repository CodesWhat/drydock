import express from 'express';
import nocache from 'nocache';
import { getCurlHealthcheckOverrideCompatibility } from '../compatibility/curl-healthcheck.js';
import { getServerConfiguration, getWebhookConfiguration } from '../configuration/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { getLegacyInputSummary } from '../prometheus/compatibility.js';
import { getScannerAssetManager, getSecurityRuntimeStatus } from '../security/runtime.js';
import { getErrorMessage } from '../util/error.js';

const router = express.Router();
const log = logger.child({ component: 'server' });

/**
 * Get store infos.
 * @param req
 * @param res
 */
async function getServer(req, res) {
  const serverConfig = getServerConfiguration();
  const webhookConfig = getWebhookConfiguration();
  const curlHealthcheckOverride = await getCurlHealthcheckOverrideCompatibility();
  const { tls, ...serverConfigWithoutTls } = serverConfig;
  const sanitizedTlsConfig =
    tls && typeof tls === 'object'
      ? (({ key, cert, ...safeTlsConfig }) => safeTlsConfig)(tls)
      : tls;

  res.status(200).json({
    configuration: {
      ...serverConfigWithoutTls,
      tls: sanitizedTlsConfig,
      webhook: {
        enabled: webhookConfig.enabled,
      },
    },
    compatibility: {
      legacyInputs: getLegacyInputSummary(),
      curlHealthcheckOverride,
    },
  });
}

async function getSecurityRuntime(req, res) {
  try {
    const runtimeStatus = await getSecurityRuntimeStatus();
    res.status(200).json(runtimeStatus);
  } catch (e: unknown) {
    log.warn(`Error loading security runtime status (${sanitizeLogParam(getErrorMessage(e))})`);
    res.status(500).json({
      error: 'Error loading security runtime status',
    });
  }
}

async function manageSecurityAsset(req, res) {
  const provider = `${req.params?.provider || ''}`;
  const operation = `${req.params?.operation || ''}`;
  if (!['trivy', 'grype', 'syft'].includes(provider) || !['pull', 'warm'].includes(operation)) {
    res.status(400).json({ error: 'Unsupported scanner asset operation' });
    return;
  }
  try {
    const manager = getScannerAssetManager();
    const requestAuth = req.body && typeof req.body === 'object' ? req.body : {};
    const auth = Object.fromEntries(
      ['username', 'password']
        .filter((key) => typeof requestAuth[key] === 'string')
        .map((key) => [key, requestAuth[key]]),
    );
    const status =
      operation === 'pull'
        ? await manager.pull(
            provider as 'trivy' | 'grype' | 'syft',
            Object.keys(auth).length > 0 ? auth : undefined,
          )
        : await manager.warm(provider as 'trivy' | 'grype' | 'syft');
    res.status(200).json(status);
  } catch (error: unknown) {
    const details = sanitizeLogParam(getErrorMessage(error));
    log.warn(`Scanner asset ${operation} failed (${details})`);
    res.status(503).json({ error: 'Scanner asset operation failed' });
  }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', getServer);
  router.get('/security/runtime', getSecurityRuntime);
  router.post('/security/assets/:provider/:operation', manageSecurityAsset);
  return router;
}
