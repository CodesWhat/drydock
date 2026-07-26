import cron from 'node-cron';
import { getMaturitySweepConfiguration } from '../configuration/index.js';
import log from '../log/index.js';
import * as storeContainer from '../store/container.js';
import { getErrorMessage } from '../util/error.js';
import { maybeEmitMaturityGateCleared } from './gate-watch.js';

const logScheduler = log.child({ component: 'maturity.scheduler' });

let cronTask: ReturnType<typeof cron.schedule> | undefined;
let running = false;
let sweepInProgress = false;

function hasMaturityGatePendingSince(containerToCheck: {
  maturityGatePendingSince?: string;
}): boolean {
  return (
    typeof containerToCheck.maturityGatePendingSince === 'string' &&
    containerToCheck.maturityGatePendingSince.length > 0
  );
}

export async function runMaturitySweep(): Promise<void> {
  if (sweepInProgress) {
    logScheduler.info('Maturity gate sweep already in progress, skipping');
    return;
  }

  sweepInProgress = true;
  try {
    const pendingContainers = storeContainer
      .getContainersRaw()
      .filter(hasMaturityGatePendingSince)
      .map(storeContainer.cloneContainer);

    if (pendingContainers.length === 0) {
      return;
    }

    let clearedCount = 0;
    for (const containerToCheck of pendingContainers) {
      try {
        const cleared = await maybeEmitMaturityGateCleared(containerToCheck);
        if (cleared) {
          clearedCount += 1;
        }
      } catch (error: unknown) {
        logScheduler.warn(
          `Maturity gate sweep failed for container ${containerToCheck.id} (${getErrorMessage(error)})`,
        );
      }
    }

    logScheduler.info(
      `Maturity gate sweep complete: ${pendingContainers.length} pending, ${clearedCount} cleared`,
    );
  } finally {
    sweepInProgress = false;
  }
}

export function init(): void {
  const maturitySweepConfig = getMaturitySweepConfiguration();
  const cronExpression = maturitySweepConfig.cron;

  if (!cronExpression) {
    logScheduler.info('Maturity gate sweep not configured (DD_MATURITY_SWEEP_CRON is empty)');
    return;
  }

  if (!cron.validate(cronExpression)) {
    logScheduler.warn(`Invalid cron expression for DD_MATURITY_SWEEP_CRON: "${cronExpression}"`);
    return;
  }

  cronTask = cron.schedule(cronExpression, () => {
    runMaturitySweep().catch((error: unknown) => {
      const msg = getErrorMessage(error);
      logScheduler.warn(`Maturity gate sweep run failed: ${msg}`);
    });
  });

  running = true;
  logScheduler.info(`Maturity gate sweep enabled (cron: ${cronExpression})`);
}

export function shutdown(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = undefined;
  }
  running = false;
  sweepInProgress = false;
}

export function isRunning(): boolean {
  return running;
}

/** @internal — test-only reset */
export function _resetForTesting(): void {
  shutdown();
}
