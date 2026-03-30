import type { Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import nocache from 'nocache';
import { getWebhookConfiguration } from '../../configuration/index.js';
import logger from '../../log/index.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import { markContainerFreshForScheduledPollSkip } from '../../watchers/registry-webhook-fresh.js';
import { sendErrorResponse } from '../error-response.js';
import { getFirstHeaderValue } from '../header-value.js';
import { parseRegistryWebhookPayload } from './parsers/index.js';
import { runRegistryWebhookDispatch } from './registry-dispatch.js';
import { verifyRegistryWebhookSignature } from './signature.js';

const router = express.Router();
const log = logger.child({ component: 'api.webhooks.registry' });

const SIGNATURE_HEADERS = [
  'x-registry-signature',
  'x-hub-signature-256',
  'x-quay-signature',
  'x-harbor-signature',
  'x-ms-signature',
  'x-drydock-signature',
] as const;

function getRequestSignature(req: Request): string | undefined {
  for (const headerName of SIGNATURE_HEADERS) {
    const value = getFirstHeaderValue(req.headers[headerName]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function getRawPayload(req: Request): Buffer {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (Buffer.isBuffer(rawBody)) {
    return rawBody;
  }
  if (typeof req.body === 'string') {
    return Buffer.from(req.body);
  }
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

async function handleRegistryWebhook(req: Request, res: Response) {
  const webhookConfiguration = getWebhookConfiguration();
  if (!webhookConfiguration.enabled) {
    sendErrorResponse(res, 403, 'Registry webhooks are disabled');
    return;
  }

  const secret = webhookConfiguration.secret || '';
  if (!secret) {
    log.error('Registry webhook secret is not configured while endpoint is enabled');
    sendErrorResponse(res, 500, 'Registry webhook secret is not configured');
    return;
  }

  const signatureVerification = verifyRegistryWebhookSignature({
    payload: getRawPayload(req),
    secret,
    signature: getRequestSignature(req),
  });

  if (!signatureVerification.valid) {
    if (signatureVerification.reason === 'missing-signature') {
      sendErrorResponse(res, 401, 'Missing registry webhook signature');
      return;
    }
    sendErrorResponse(res, 401, 'Invalid registry webhook signature');
    return;
  }

  const parseResult = parseRegistryWebhookPayload(req.body);
  if (!parseResult) {
    sendErrorResponse(res, 400, 'Unsupported registry webhook payload');
    return;
  }

  const dispatchResult = await runRegistryWebhookDispatch({
    references: parseResult.references,
    containers: storeContainer.getContainers({}),
    watchers: registry.getState().watcher,
    markContainerFresh: markContainerFreshForScheduledPollSkip,
  });

  res.status(202).json({
    message: 'Registry webhook processed',
    result: {
      provider: parseResult.provider,
      ...dispatchResult,
    },
  });
}

export function init() {
  const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });

  router.use(webhookLimiter);
  router.use(nocache());
  router.post('/', handleRegistryWebhook);
  return router;
}
