import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import nocache from 'nocache';
import { getServerConfiguration } from '../configuration/index.js';
import { output } from '../prometheus/index.js';
import * as auth from './auth.js';

/**
 * Prometheus Metrics router.
 * @type {Router}
 */
const router = express.Router();
let expectedMetricsTokenHash: Buffer | null = null;

/**
 * Failed-attempt budget for the credential fallback below.
 *
 * `/metrics` only reaches the authenticator chain when `DD_SERVER_METRICS_TOKEN`
 * is unset, and on that branch any credential a configured provider accepts gets
 * in. Nothing sat in front of it: `/api/v1` has its own limiter and the login
 * route has lockout, but this route had neither, under the chain and under
 * `passport.authenticate()` before it, so a password could be guessed against it
 * at whatever rate the network allowed.
 *
 * `skipSuccessfulRequests` is what makes a budget this small safe. A scrape that
 * authenticates is never charged, so no scrape interval and no number of
 * Prometheus servers can exhaust it; only 4xx and 5xx responses accumulate. The
 * window rolls off on its own, so a target left holding a stale credential
 * recovers without an operator. The bearer branch is not limited and does not
 * need to be: it is a constant-time compare against a single configured secret.
 */
const METRICS_AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const METRICS_AUTH_MAX_FAILURES = 100;

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
    // Charges failed attempts only, so a working scrape never meets it.
    router.use(
      rateLimit({
        windowMs: METRICS_AUTH_FAILURE_WINDOW_MS,
        max: METRICS_AUTH_MAX_FAILURES,
        skipSuccessfulRequests: true,
        standardHeaders: true,
        legacyHeaders: false,
        validate: { xForwardedForHeader: false },
      }),
    );
    // Fallback to the authenticator chain: a session cookie, or any credential
    // a configured provider accepts. `passport.authenticate(getAllIds())` never
    // looked at the session it had just restored, so a logged-in browser used to
    // get a 401 here despite the comment above it saying "passport/session auth";
    // going through requireAuthentication makes the session work as intended. It
    // widens nothing, since a session can only exist for a principal one of those
    // same providers already accepted.
    router.use(auth.requireAuthentication);
  }

  router.get('/', outputMetrics);
  return router;
}
