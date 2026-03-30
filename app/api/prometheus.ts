import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import nocache from 'nocache';
import passport from 'passport';
import { getServerConfiguration } from '../configuration/index.js';
import { output } from '../prometheus/index.js';
import * as auth from './auth.js';

/**
 * Prometheus Metrics router.
 * @type {Router}
 */
const router = express.Router();
let expectedMetricsTokenHash: Buffer | null = null;

function hashMetricsToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Return Prometheus Metrics as String.
 * @param req
 * @param res
 */
async function outputMetrics(req: Request, res: Response) {
  res
    .status(200)
    .type('text')
    .send(await output());
}

/**
 * Authenticate metrics requests via DD_SERVER_METRICS_TOKEN bearer token.
 * Uses SHA-256 hashing + timingSafeEqual for constant-time comparison.
 */
export function authenticateMetricsToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (
    !authHeader ||
    !authHeader.toLowerCase().startsWith('bearer ') ||
    expectedMetricsTokenHash == null
  ) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);
  const tokenHash = hashMetricsToken(token);
  if (!timingSafeEqual(tokenHash, expectedMetricsTokenHash)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  const configuration = getServerConfiguration();
  router.use(nocache());
  expectedMetricsTokenHash = null;

  const metricsToken = configuration.metrics?.token;
  if (typeof metricsToken === 'string' && metricsToken.length > 0) {
    expectedMetricsTokenHash = hashMetricsToken(metricsToken);
    // Bearer token auth takes priority when DD_SERVER_METRICS_TOKEN is set
    router.use(authenticateMetricsToken);
  } else if (configuration.metrics?.auth !== false) {
    // Fallback to passport/session auth
    router.use(passport.authenticate(auth.getAllIds()));
  }

  router.get('/', outputMetrics);
  return router;
}
