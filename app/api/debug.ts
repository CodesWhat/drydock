import type { Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import nocache from 'nocache';
import { getServerConfiguration } from '../configuration/index.js';
import { collectDebugDump, getDebugDumpFilename, serializeDebugDump } from '../debug/dump.js';
import { recordAuditEvent } from './audit-events.js';
import { sendErrorResponse } from './error-response.js';
import {
  createAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled,
} from './rate-limit-key.js';

const router = express.Router();

function parseRecentMinutes(rawValue: unknown): number {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== 'string') {
    return 30;
  }
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 30;
  }
  return parsedValue;
}

async function getDebugDump(req: Request, res: Response): Promise<void> {
  try {
    const recentMinutes = parseRecentMinutes(req.query.minutes);
    const dump = await collectDebugDump({
      recentMinutes,
    });
    const dumpBody = serializeDebugDump(dump);

    // The dump carries redacted container env and every DD_* name, so the
    // download is recorded the same way a POST /:id/env/reveal is. Recorded
    // before the body is sent: an audit failure has to become the 500 below,
    // and writing a header after send() would throw ERR_HTTP_HEADERS_SENT.
    recordAuditEvent({
      action: 'debug-dump',
      containerName: 'diagnostics',
      status: 'info',
      details: `Downloaded debug dump covering the last ${recentMinutes} minute(s)`,
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${getDebugDumpFilename()}"`);
    res.status(200).send(dumpBody);
  } catch {
    sendErrorResponse(res, 500, 'Unable to generate debug dump');
  }
}

export function init() {
  const serverConfiguration = getServerConfiguration() as Record<string, unknown>;
  const identityAwareRateLimitKeyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(
    isIdentityAwareRateLimitKeyingEnabled(serverConfiguration),
  );
  const identityAwareRateLimitOptions = identityAwareRateLimitKeyGenerator
    ? { keyGenerator: identityAwareRateLimitKeyGenerator }
    : {};

  router.use(nocache());
  router.get(
    '/dump',
    rateLimit({
      windowMs: 60_000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
      message: 'Debug dump rate limit exceeded. Max 5 per 60 seconds.',
      ...identityAwareRateLimitOptions,
    }),
    getDebugDump,
  );
  return router;
}
