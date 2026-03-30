import express from 'express';
import * as registryWebhookRouter from './webhooks/registry.js';

export function init() {
  const router = express.Router();
  router.use('/registry', registryWebhookRouter.init());
  return router;
}
