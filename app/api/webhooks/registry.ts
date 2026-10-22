import type { Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import nocache from 'nocache';
import {
  getRegistryWebhookAuthConfiguration,
  getWebhookConfiguration,
} from '../../configuration/index.js';
import logger from '../../log/index.js';
import { sanitizeLogParam } from '../../log/sanitize.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import { markContainerFreshForScheduledPollSkip } from '../../watchers/registry-webhook-fresh.js';
import { sendErrorResponse } from '../error-response.js';
import { getFirstHeaderValue } from '../header-value.js';
import { SESSION_ONLY, scoped } from '../route-scopes.js';
import { parseRegistryWebhookPayload } from './parsers/index.js';
import { authenticateRegistryWebhook, redactRegistryWebhookPath } from './registry-auth.js';
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

  await processRegistryWebhook(req, res);
}

async function processRegistryWebhook(req: Request, res: Response, expectedProvider?: string) {
  const parseResult = parseRegistryWebhookPayload(req.body);
  if (!parseResult) {
    sendErrorResponse(res, 400, 'Unsupported registry webhook payload');
    return;
  }
  if (expectedProvider && parseResult.provider !== expectedProvider) {
    sendErrorResponse(res, 400, 'Registry webhook payload does not match the provider in the URL');
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

/**
 * Provider-scoped endpoint: `POST /:provider` (bearer, query secret, HMAC) and
 * `POST /:provider/:secret` (secret in the path). Which of those a provider
 * accepts is per-provider configuration; the bare `POST /` stays HMAC-only.
 */
async function handleProviderRegistryWebhook(req: Request, res: Response) {
  const webhookConfiguration = getWebhookConfiguration();
  if (!webhookConfiguration.enabled) {
    sendErrorResponse(res, 403, 'Registry webhooks are disabled');
    return;
  }

  const provider = String(req.params.provider ?? '').toLowerCase();
  const providerAuthByName = getRegistryWebhookAuthConfiguration();
  if (!Object.hasOwn(providerAuthByName, provider)) {
    sendErrorResponse(res, 404, 'Unknown registry webhook provider');
    return;
  }
  const providerAuth = providerAuthByName[provider as keyof typeof providerAuthByName];

  const result = authenticateRegistryWebhook({
    modes: providerAuth.modes,
    staticSecret: providerAuth.staticSecret,
    hmacSecret: webhookConfiguration.secret || '',
    payload: getRawPayload(req),
    signature: getRequestSignature(req),
    pathSecret: typeof req.params.secret === 'string' ? req.params.secret : undefined,
    querySecret: req.query?.secret,
    authorizationHeader: getFirstHeaderValue(req.headers.authorization),
  });

  if (result.status !== 'ok') {
    log.warn(
      `Registry webhook authentication failed (provider=${sanitizeLogParam(provider)}, reason=${result.status}, path=${sanitizeLogParam(redactRegistryWebhookPath(req.originalUrl))})`,
    );
    sendErrorResponse(
      res,
      401,
      result.status === 'missing'
        ? 'Missing registry webhook credentials'
        : 'Invalid registry webhook credentials',
    );
    return;
  }

  await processRegistryWebhook(req, res, provider);
}

export function init() {
  const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });

  // Failed authentication attempts get a tighter budget than the shared one,
  // so a guessed static secret costs the caller far more than a signed push.
  const failedAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });

  router.use(webhookLimiter);
  router.use(failedAuthLimiter);
  router.use(nocache());
  router.post('/', scoped(SESSION_ONLY, handleRegistryWebhook));
  router.post('/:provider', scoped(SESSION_ONLY, handleProviderRegistryWebhook));
  router.post('/:provider/:secret', scoped(SESSION_ONLY, handleProviderRegistryWebhook));
  return router;
}
