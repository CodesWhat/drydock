import express from 'express';
import nocache from 'nocache';
import { getServerConfiguration, getWebhookConfiguration } from '../configuration/index.js';

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
  });
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', getServer);
  return router;
}
