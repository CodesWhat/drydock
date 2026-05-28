import type { Request, Response } from 'express';
import express from 'express';
import nocache from 'nocache';

/**
 * Healthcheck router.
 * @type {Router}
 */
const router = express.Router();

type AuthReadyFn = () => boolean;

let isAuthReady: AuthReadyFn = () => true;

/**
 * Set the auth readiness check.
 * Called by api/index.ts after auth strategies have been registered so that
 * /health will not report healthy until passport is fully wired up and login
 * requests will be accepted.
 */
export function setAuthReadyFn(fn: AuthReadyFn): void {
  isAuthReady = fn;
}

/**
 * Reset auth ready function (for tests only).
 */
export function resetAuthReadyFnForTests(): void {
  isAuthReady = () => true;
}

function healthHandler(_req: Request, res: Response): void {
  if (!isAuthReady()) {
    res.status(503).json({ status: 'starting', reason: 'auth strategies not yet registered' });
    return;
  }
  res.status(200).json({ uptime: process.uptime() });
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', healthHandler);
  return router;
}
