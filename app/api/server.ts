// @ts-nocheck
import express from 'express';
import nocache from 'nocache';
import { getServerConfiguration, getWebhookConfiguration } from '../configuration/index.js';
import { getLegacyInputSummary } from '../prometheus/compatibility.js';
import { getSecurityRuntimeStatus } from '../security/runtime.js';

const router = express.Router();

/**
 * Get store infos.
 * @param req
 * @param res
 */
function getServer(req, res) {
  const serverConfig = getServerConfiguration();
  const webhookConfig = getWebhookConfiguration();
  res.status(200).json({
    configuration: {
      ...serverConfig,
      webhook: {
        enabled: webhookConfig.enabled,
      },
    },
    compatibility: {
      legacyInputs: getLegacyInputSummary(),
    },
  });
}

async function getSecurityRuntime(req, res) {
  try {
    const runtimeStatus = await getSecurityRuntimeStatus();
    res.status(200).json(runtimeStatus);
  } catch (e: any) {
    res.status(500).json({
      error: `Error loading security runtime status (${e.message})`,
    });
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
  return router;
}
