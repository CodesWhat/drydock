import express, { type NextFunction, type Request, type Response } from 'express';
import nocache from 'nocache';
import { getLastCleanupRuns, resolvePolicyHosts, runCleanupOnHost } from '../cleanup/run.js';
import { getCleanupPolicyList } from '../cleanup/scheduler.js';
import { getServerConfiguration } from '../configuration/index.js';
import { requireDestructiveActionConfirmation } from './destructive-confirmation.js';
import { sendErrorResponse } from './error-response.js';
import { scoped } from './route-scopes.js';

const router = express.Router();

const CONTAINER_ACTIONS_DISABLED_MESSAGE = 'Container actions are disabled';

const confirmCleanupRun = requireDestructiveActionConfirmation('cleanup-run');

/** A dry run deletes nothing, so only a real run needs the confirmation header. */
function confirmUnlessDryRun(req: Request, res: Response, next: NextFunction): void {
  if ((req.body as { dryRun?: unknown } | undefined)?.dryRun === true) {
    next();
    return;
  }
  confirmCleanupRun(req, res, next);
}

/** Configured cleanup policies and the most recent result per policy and host. */
function listCleanup(_req: Request, res: Response) {
  res.status(200).json({ policies: getCleanupPolicyList(), lastRuns: getLastCleanupRuns() });
}

/**
 * Run a configured policy now, on one host or on every host it covers.
 * `dryRun: true` reports what would be removed without removing it.
 */
async function runCleanup(req: Request, res: Response) {
  if (!getServerConfiguration().feature.containeractions) {
    sendErrorResponse(res, 403, CONTAINER_ACTIONS_DISABLED_MESSAGE);
    return;
  }

  const body = (req.body ?? {}) as { policy?: unknown; host?: unknown; dryRun?: unknown };
  const policy = getCleanupPolicyList().find((candidate) => candidate.name === body.policy);
  if (!policy) {
    sendErrorResponse(res, 404, 'Cleanup policy not found');
    return;
  }
  const hostId = typeof body.host === 'string' ? body.host : undefined;
  const hosts = resolvePolicyHosts(policy).filter((host) => !hostId || host.id === hostId);
  if (hosts.length === 0) {
    sendErrorResponse(res, 404, 'Cleanup host not found');
    return;
  }

  const results = [];
  for (const host of hosts) {
    results.push(
      await runCleanupOnHost(host, policy, 'manual', body.dryRun === true ? true : undefined),
    );
  }
  res.status(200).json({ data: results });
}

export function init() {
  router.use(nocache());
  router.get('/', scoped('read', listCleanup));
  router.post('/run', confirmUnlessDryRun, scoped('admin', runCleanup));
  return router;
}
