import cronParser from 'cron-parser';
import cron from 'node-cron';
import {
  resolveContainerImageFullName,
  resolveContainerRegistryAuth,
} from '../api/container/shared.js';
import { broadcastScanCompleted, broadcastScanStarted } from '../api/sse.js';
import { getSecurityConfiguration } from '../configuration/index.js';
import log from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { Container } from '../model/container.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { getErrorMessage } from '../util/error.js';
import { getTrivyDatabaseStatus } from './runtime.js';
import { clearDigestScanCache, scanImageWithDedup } from './scan.js';

const logScheduler = log.child({ component: 'security.scheduler' });
const DEFAULT_CRON_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CRON_INTERVAL_SAMPLE_SIZE = 64;

let cronTask: ReturnType<typeof cron.schedule> | undefined;
let running = false;
let scanInProgress = false;
let scanAbortController: AbortController | undefined;

function getContainerImageFullName(container: Container, tagOverride?: string): string {
  return resolveContainerImageFullName(container, registry.getState().registry || {}, tagOverride);
}

async function getContainerRegistryAuth(container: Container) {
  return await resolveContainerRegistryAuth(container, registry.getState().registry || {}, {
    log: logScheduler,
    sanitizeLogParam,
  });
}

function getSimpleHourListIntervalMs(cronExpression: string): number | undefined {
  const simpleHourListPattern = /^(\d{1,2})\s+(\d{1,2}(?:,\d{1,2})+)\s+\*\s+\*\s+\*$/;
  const matches = cronExpression.trim().match(simpleHourListPattern);
  if (!matches) {
    return undefined;
  }

  const hours = matches[2]
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23)
    .sort((left, right) => left - right);
  if (hours.length < 2) {
    return undefined;
  }

  let shortestHours = 24;
  for (let index = 0; index < hours.length; index += 1) {
    const current = hours[index];
    const next = index === hours.length - 1 ? hours[0] + 24 : hours[index + 1];
    const delta = next - current;
    if (delta > 0 && delta < shortestHours) {
      shortestHours = delta;
    }
  }

  return shortestHours < 24 ? shortestHours * 60 * 60 * 1000 : undefined;
}

function getCronIntervalMs(cronExpression: string): number {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length < 5) {
    return DEFAULT_CRON_INTERVAL_MS;
  }

  const simpleHourListIntervalMs = getSimpleHourListIntervalMs(cronExpression);
  if (simpleHourListIntervalMs) {
    return simpleHourListIntervalMs;
  }

  // Compute a conservative cache TTL based on the shortest upcoming gap
  // between scheduled runs. This avoids over-caching for irregular crons.
  try {
    const iterator = cronParser.parseExpression(cronExpression, {
      currentDate: new Date(),
      tz: 'UTC',
    });
    let previousRun = iterator.next().toDate();
    let minimumIntervalMs = Number.POSITIVE_INFINITY;

    for (let i = 0; i < CRON_INTERVAL_SAMPLE_SIZE; i += 1) {
      const nextRun = iterator.next().toDate();
      const intervalMs = nextRun.getTime() - previousRun.getTime();
      if (Number.isFinite(intervalMs) && intervalMs > 0 && intervalMs < minimumIntervalMs) {
        minimumIntervalMs = intervalMs;
      }
      previousRun = nextRun;
    }

    if (Number.isFinite(minimumIntervalMs) && minimumIntervalMs > 0) {
      return minimumIntervalMs;
    }
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logScheduler.debug(`Could not derive cron interval from "${cronExpression}": ${errorMessage}`);
  }

  return DEFAULT_CRON_INTERVAL_MS;
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getAbortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === 'string' && reason) {
    return createAbortError(reason);
  }
  return createAbortError('Scheduled scan batch aborted');
}

function withAbortSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(getAbortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      reject(getAbortReason(signal));
    };
    signal.addEventListener('abort', handleAbort, { once: true });

    operation.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error);
      },
    );
  });
}

export async function runScheduledScans(): Promise<void> {
  if (scanInProgress) {
    logScheduler.info('Scheduled scan already in progress, skipping');
    return;
  }

  const securityConfig = getSecurityConfiguration();
  if (!securityConfig.enabled || securityConfig.scanner !== 'trivy') {
    logScheduler.info('Security scanner not enabled, skipping scheduled scan');
    return;
  }

  scanInProgress = true;
  let batchController: AbortController | undefined;
  let batchTimeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const containers = storeContainer.getContainers();
    const containersWithDigest = containers.filter(
      (c: Container) => c.image?.digest?.value && typeof c.image.digest.value === 'string',
    );

    if (containersWithDigest.length === 0) {
      logScheduler.info('No containers with digest values found, skipping scheduled scan');
      return;
    }

    // Group by digest
    const digestGroups = new Map<string, Container[]>();
    for (const container of containersWithDigest) {
      const digest = container.image?.digest?.value;
      if (typeof digest !== 'string') {
        continue;
      }
      const group = digestGroups.get(digest);
      if (group) {
        group.push(container);
      } else {
        digestGroups.set(digest, [container]);
      }
    }

    const scanIntervalMs = getCronIntervalMs(securityConfig.scan.cron);
    const scanConcurrency = Math.max(1, Math.floor(Number(securityConfig.scan.concurrency) || 1));
    const batchTimeoutMs = Math.max(0, Math.floor(Number(securityConfig.scan.batchTimeout) || 0));
    const trivyDbStatus = await getTrivyDatabaseStatus();
    const trivyDbUpdatedAt = trivyDbStatus?.updatedAt;
    let cachedCount = 0;
    let scannedCount = 0;
    let errorCount = 0;
    let abortedCount = 0;

    const timeoutLabel = batchTimeoutMs > 0 ? `${batchTimeoutMs}ms` : 'disabled';
    logScheduler.info(
      `Scanning ${digestGroups.size} unique digests across ${containersWithDigest.length} containers (concurrency: ${scanConcurrency}, batch timeout: ${timeoutLabel})`,
    );

    const digestEntries = Array.from(digestGroups.entries());
    const workerCount = Math.min(scanConcurrency, digestEntries.length);
    batchController = new AbortController();
    scanAbortController = batchController;

    if (batchTimeoutMs > 0) {
      batchTimeoutHandle = setTimeout(() => {
        const timeoutMessage = `Scheduled scan batch timed out after ${batchTimeoutMs}ms`;
        logScheduler.warn(timeoutMessage);
        batchController?.abort(createAbortError(timeoutMessage));
      }, batchTimeoutMs);
    }

    let nextDigestIndex = 0;
    const getNextDigestGroup = (): [string, Container[]] | undefined => {
      if (batchController?.signal.aborted || nextDigestIndex >= digestEntries.length) {
        return undefined;
      }
      const nextDigestGroup = digestEntries[nextDigestIndex];
      nextDigestIndex += 1;
      return nextDigestGroup;
    };

    const scanDigestGroup = async (digest: string, group: Container[]) => {
      let startedBroadcast = false;
      try {
        const signal = batchController?.signal;
        if (!signal) {
          throw createAbortError('Scheduled scan batch controller unavailable');
        }
        if (signal.aborted) {
          throw getAbortReason(signal);
        }

        const representative = group[0];
        const image = getContainerImageFullName(representative);
        const auth = await withAbortSignal(getContainerRegistryAuth(representative), signal);

        // Broadcast scan-started for all containers with this digest
        for (const container of group) {
          broadcastScanStarted(container.id);
        }
        startedBroadcast = true;

        const { scanResult, fromCache } = await withAbortSignal(
          scanImageWithDedup({ image, auth, digest, trivyDbUpdatedAt }, scanIntervalMs),
          signal,
        );

        if (fromCache) {
          cachedCount += 1;
          logScheduler.info(`Digest ${digest.slice(0, 12)} unchanged, using cached scan`);
        } else {
          scannedCount += 1;
        }

        // Update all containers sharing this digest
        for (const container of group) {
          const containerToStore = {
            ...container,
            security: {
              ...(container.security || {}),
              scan: scanResult,
            },
          };
          storeContainer.updateContainer(containerToStore);
          broadcastScanCompleted(container.id, scanResult.status);
        }
      } catch (error: unknown) {
        if (isAbortError(error)) {
          abortedCount += 1;
        } else {
          errorCount += 1;
          const errorMessage = getErrorMessage(error);
          logScheduler.warn(
            `Scheduled scan failed for digest ${digest.slice(0, 12)}: ${errorMessage}`,
          );
        }

        if (startedBroadcast) {
          for (const container of group) {
            broadcastScanCompleted(container.id, 'error');
          }
        }
      }
    };

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const nextDigestGroup = getNextDigestGroup();
          if (!nextDigestGroup) {
            return;
          }
          const [digest, group] = nextDigestGroup;
          await scanDigestGroup(digest, group);
        }
      }),
    );

    const skippedCount = digestEntries.length - nextDigestIndex;

    logScheduler.info(
      `Scheduled scan complete: ${digestGroups.size} digests, ${cachedCount} cached, ${scannedCount} scanned fresh, ${errorCount} errors, ${abortedCount} aborted, ${skippedCount} skipped`,
    );
  } finally {
    if (batchTimeoutHandle) {
      clearTimeout(batchTimeoutHandle);
    }
    if (batchController && scanAbortController === batchController) {
      scanAbortController = undefined;
    }
    scanInProgress = false;
  }
}

export function init(): void {
  const securityConfig = getSecurityConfiguration();
  const cronExpression = securityConfig.scan.cron;

  if (!cronExpression) {
    logScheduler.info('Scheduled security scanning not configured (DD_SECURITY_SCAN_CRON not set)');
    return;
  }

  if (!securityConfig.enabled || securityConfig.scanner !== 'trivy') {
    logScheduler.info('Security scanner not enabled, scheduled scanning disabled');
    return;
  }

  if (!cron.validate(cronExpression)) {
    logScheduler.warn(`Invalid cron expression for DD_SECURITY_SCAN_CRON: "${cronExpression}"`);
    return;
  }

  const jitter = securityConfig.scan.jitter;

  cronTask = cron.schedule(
    cronExpression,
    () => {
      runScheduledScans().catch((error: unknown) => {
        const msg = getErrorMessage(error);
        logScheduler.warn(`Scheduled scan run failed: ${msg}`);
      });
    },
    {
      maxRandomDelay: jitter,
    },
  );

  running = true;
  logScheduler.info(
    `Scheduled security scanning enabled (cron: ${cronExpression}, jitter: ${jitter}ms)`,
  );
}

export function shutdown(): void {
  if (scanAbortController && !scanAbortController.signal.aborted) {
    scanAbortController.abort(createAbortError('Scheduled scan aborted during shutdown'));
  }
  scanAbortController = undefined;
  if (cronTask) {
    cronTask.stop();
    cronTask = undefined;
  }
  clearDigestScanCache();
  running = false;
  scanInProgress = false;
}

export function isRunning(): boolean {
  return running;
}

/** @internal — test-only access */
export function _isScanInProgress(): boolean {
  return scanInProgress;
}

/** @internal — test-only reset */
export function _resetForTesting(): void {
  shutdown();
}
