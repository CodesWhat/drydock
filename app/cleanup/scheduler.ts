import cron from 'node-cron';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { getErrorMessage } from '../util/error.js';
import { getCleanupPolicies } from './config.js';
import { executeCleanup } from './engine.js';
import { isHostBusy, resolvePolicyHosts, runCleanupOnHost } from './run.js';
import type { CleanupPolicy } from './types.js';

const log = logger.child({ component: 'cleanup.scheduler' });

let policies: CleanupPolicy[] = [];
let tasks: Array<ReturnType<typeof cron.schedule>> = [];

async function runScheduled(policy: CleanupPolicy): Promise<void> {
  for (const resolved of resolvePolicyHosts(policy)) {
    await runCleanupOnHost(resolved, policy, 'schedule');
  }
}

/**
 * Estimate what the enabled types would reclaim on each host and run the
 * policy where it reaches `thresholdBytes`. Hosts that are busy or cannot run
 * cleanup are skipped without a record: the check repeats every few minutes.
 */
async function checkThreshold(policy: CleanupPolicy): Promise<void> {
  for (const resolved of resolvePolicyHosts(policy)) {
    const { host } = resolved;
    if (!host || isHostBusy(host)) {
      continue;
    }
    const estimate = await executeCleanup(host, policy, { dryRun: true });
    if (estimate.totalReclaimedBytes >= (policy.thresholdBytes as number)) {
      await runCleanupOnHost(resolved, policy, 'threshold');
    }
  }
}

function schedule(
  expression: string,
  policy: CleanupPolicy,
  job: (p: CleanupPolicy) => Promise<void>,
) {
  tasks.push(
    cron.schedule(expression, () => {
      job(policy).catch((error: unknown) => {
        log.warn(
          `Cleanup policy ${sanitizeLogParam(policy.name)} run failed (${sanitizeLogParam(getErrorMessage(error))})`,
        );
      });
    }),
  );
}

export function init(): void {
  policies = getCleanupPolicies();
  for (const policy of policies) {
    if (policy.cron) {
      schedule(policy.cron, policy, runScheduled);
    }
    if (policy.thresholdBytes !== undefined) {
      schedule(policy.checkCron, policy, checkThreshold);
    }
    log.info(
      `Cleanup policy ${sanitizeLogParam(policy.name)} enabled (cron: ${policy.cron || 'none'}, threshold: ${policy.thresholdBytes ?? 'none'} bytes)`,
    );
  }
}

export function shutdown(): void {
  for (const task of tasks) {
    task.stop();
  }
  tasks = [];
  policies = [];
}

export function getCleanupPolicyList(): CleanupPolicy[] {
  return policies;
}
