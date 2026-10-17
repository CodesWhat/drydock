import express from 'express';
import { mountRouter } from './route-scopes.js';
import * as registryWebhookRouter from './webhooks/registry.js';

export function init() {
  const router = express.Router();
  mountRouter(router, '/registry', registryWebhookRouter.init());
  return router;
}
