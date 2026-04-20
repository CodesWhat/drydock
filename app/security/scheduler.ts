import { CronExpressionParser } from 'cron-parser';
import cron from 'node-cron';
import {
  resolveContainerImageFullName,
  resolveContainerRegistryAuth,
} from '../api/container/shared.js';
import { broadcastScanCompleted, broadcastScanStarted } from '../api/sse.js';
import { getSecurityConfiguration } from '../configuration/index.js';
import { emitSecurityAlert, emitSecurityScanCycleComplete } from '../event/index.js';
import log from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { Container } from '../model/container.js';
import { fullName } from '../model/container.js';
import { MS_PER_DAY } from '../model/maturity-policy.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { getErrorMessage } from '../util/error.js';
import { uuidv7 } from '../util/uuid.js';
import { getTrivyDatabaseStatus } from './runtime.js';
import { clearDigestScanCache, scanImageWithDedup } from './scan.js';

const logScheduler = log.child({ component: 'security.scheduler' });
const DEFAULT_CRON_INTERVAL_MS = MS_PER_DAY;
const CRON_INTERVAL_SAMPLE_SIZE = 64;

let cronTask: ReturnType<typeof cron.schedule> | undefined;
let running = false;
let scanInProgress = false;
let scanAbortController: AbortController | undefined;
let cachedSecurityConfiguration: ReturnType<typeof getSecurityConfiguration> | undefined;
let cachedScanIntervalMs: number | undefined;

function getSchedulerSecurityConfiguration(): ReturnType<typeof getSecurityConfiguration> {
  if (!cachedSecurityConfiguration) {
    cachedSecurityConfiguration = getSecurityConfiguration();
  }
  return cachedSecurityConfiguration;
}

function getSchedulerScanIntervalMs(): number {
  if (cachedScanIntervalMs === undefined) {
    const securityConfig = getSchedulerSecurityConfiguration();
    cachedScanIntervalMs = getCronIntervalMs(securityConfig.scan.cron);
  }
  return cachedScanIntervalMs;
}

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
    const iterator = CronExpressionParser.parse(cronExpression, {
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
  return signal.reason as Error;
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

type ScanDigestGroupOutcome = 'cached' | 'scanned' | 'error' | 'aborted';

interface ScanDigestGroupResult {
  outcome: ScanDigestGroupOutcome;
  alertCount: number;
}

async function scanDigestGroup(options: {
  digest: string;
  group: Container[];
  signal: AbortSignal;
  scanIntervalMs: number;
  trivyDbUpdatedAt?: string;
  cycleId: string;
}): Promise<ScanDigestGroupResult> {
  const { digest, group, signal, scanIntervalMs, trivyDbUpdatedAt, cycleId } = options;
  let startedBroadcast = false;

  try {
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
      logScheduler.info(`Digest ${digest.slice(0, 12)} unchanged, using cached scan`);
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

    const securityConfig = getSchedulerSecurityConfiguration();
    const alertCount = securityConfig.scan.notifications
      ? await emitPerContainerSecurityAlerts(group, scanResult, cycleId)
      : 0;

    return { outcome: fromCache ? 'cached' : 'scanned', alertCount };
  } catch (error: unknown) {
    if (!isAbortError(error)) {
      const errorMessage = getErrorMessage(error);
      logScheduler.warn(`Scheduled scan failed for digest ${digest.slice(0, 12)}: ${errorMessage}`);
    }

    if (startedBroadcast) {
      for (const container of group) {
        broadcastScanCompleted(container.id, 'error');
      }
    }

    return { outcome: isAbortError(error) ? 'aborted' : 'error', alertCount: 0 };
  }
}

async function emitPerContainerSecurityAlerts(
  group: Container[],
  scanResult: Awaited<ReturnType<typeof scanImageWithDedup>>['scanResult'],
  cycleId: string,
): Promise<number> {
  const summary = scanResult.summary;
  if (!summary) {
    return 0;
  }
  const hasHighSeverity = (summary.critical ?? 0) > 0 || (summary.high ?? 0) > 0;
  if (!hasHighSeverity) {
    return 0;
  }

  const details = `critical=${summary.critical}, high=${summary.high}, medium=${summary.medium}, low=${summary.low}, unknown=${summary.unknown}`;
  let emitted = 0;
  for (const container of group) {
    await emitSecurityAlert({
      containerName: fullName(container),
      details,
      status: scanResult.status,
      summary,
      container,
      cycleId,
    });
    emitted += 1;
  }
  return emitted;
}

function isScheduledScannerEnabled(
  securityConfig: ReturnType<typeof getSecurityConfiguration>,
): boolean {
  return securityConfig.enabled && securityConfig.scanner === 'trivy';
}

function getContainersWithDigestValues(containers: Container[]): Container[] {
  return containers.filter(
    (container: Container) =>
      container.image?.digest?.value && typeof container.image.digest.value === 'string',
  );
}

function groupContainersByDigest(containersWithDigest: Container[]): Map<string, Container[]> {
  const digestGroups = new Map<string, Container[]>();
  for (const container of containersWithDigest) {
    const digest = container.image?.digest?.value as string;
    const group = digestGroups.get(digest);
    if (group) {
      group.push(container);
    } else {
      digestGroups.set(digest, [container]);
    }
  }
  return digestGroups;
}

function normalizeScanConcurrency(concurrency: unknown): number {
  return Math.max(1, Math.floor(Number(concurrency) || 1));
}

function normalizeBatchTimeoutMs(batchTimeout: unknown): number {
  return Math.max(0, Math.floor(Number(batchTimeout) || 0));
}

function createBatchTimeout(
  batchController: AbortController,
  batchTimeoutMs: number,
): ReturnType<typeof setTimeout> | undefined {
  if (batchTimeoutMs <= 0) {
    return undefined;
  }

  return setTimeout(() => {
    const timeoutMessage = `Scheduled scan batch timed out after ${batchTimeoutMs}ms`;
    logScheduler.warn(timeoutMessage);
    batchController.abort(createAbortError(timeoutMessage));
  }, batchTimeoutMs);
}

type ScheduledBatchPreparation = {
  digestGroups: Map<string, Container[]>;
  scanIntervalMs: number;
  scanConcurrency: number;
  batchTimeoutMs: number;
  trivyDbUpdatedAt?: string;
};

async function prepareScheduledBatch(
  securityConfig: ReturnType<typeof getSecurityConfiguration>,
): Promise<ScheduledBatchPreparation | undefined> {
  const containers = storeContainer.getContainersRaw();
  const containersWithDigest = getContainersWithDigestValues(containers);

  if (containersWithDigest.length === 0) {
    logScheduler.info('No containers with digest values found, skipping scheduled scan');
    return undefined;
  }

  const digestGroups = groupContainersByDigest(containersWithDigest);
  const scanIntervalMs = getSchedulerScanIntervalMs();
  const scanConcurrency = normalizeScanConcurrency(securityConfig.scan.concurrency);
  const batchTimeoutMs = normalizeBatchTimeoutMs(securityConfig.scan.batchTimeout);
  const trivyDbStatus = await getTrivyDatabaseStatus();
  const trivyDbUpdatedAt = trivyDbStatus?.updatedAt;

  const timeoutLabel = batchTimeoutMs > 0 ? `${batchTimeoutMs}ms` : 'disabled';
  logScheduler.info(
    `Scanning ${digestGroups.size} unique digests across ${containersWithDigest.length} containers (concurrency: ${scanConcurrency}, batch timeout: ${timeoutLabel})`,
  );

  return {
    digestGroups,
    scanIntervalMs,
    scanConcurrency,
    batchTimeoutMs,
    trivyDbUpdatedAt,
  };
}

type ScheduledScanOutcomeCounts = {
  cachedCount: number;
  scannedCount: number;
  errorCount: number;
  abortedCount: number;
  alertCount: number;
};

function createInitialScheduledScanOutcomeCounts(): ScheduledScanOutcomeCounts {
  return {
    cachedCount: 0,
    scannedCount: 0,
    errorCount: 0,
    abortedCount: 0,
    alertCount: 0,
  };
}

function incrementScheduledScanOutcomeCount(
  outcomeCounts: ScheduledScanOutcomeCounts,
  result: ScanDigestGroupResult,
): void {
  outcomeCounts.alertCount += result.alertCount;
  switch (result.outcome) {
    case 'cached':
      outcomeCounts.cachedCount += 1;
      return;
    case 'scanned':
      outcomeCounts.scannedCount += 1;
      return;
    case 'aborted':
      outcomeCounts.abortedCount += 1;
      return;
    default:
      outcomeCounts.errorCount += 1;
      return;
  }
}

type ScheduledBatchExecutionResult = ScheduledScanOutcomeCounts & {
  skippedCount: number;
};

async function runScheduledBatchDigestWorkers(options: {
  batchController: AbortController;
  digestEntries: Array<[string, Container[]]>;
  scanConcurrency: number;
  scanIntervalMs: number;
  trivyDbUpdatedAt?: string;
  cycleId: string;
}): Promise<ScheduledBatchExecutionResult> {
  const {
    batchController,
    digestEntries,
    scanConcurrency,
    scanIntervalMs,
    trivyDbUpdatedAt,
    cycleId,
  } = options;
  const workerCount = Math.min(scanConcurrency, digestEntries.length);
  const outcomeCounts = createInitialScheduledScanOutcomeCounts();
  let nextDigestIndex = 0;

  const getNextDigestGroup = (): [string, Container[]] | undefined => {
    if (batchController.signal.aborted || nextDigestIndex >= digestEntries.length) {
      return undefined;
    }

    const nextDigestGroup = digestEntries[nextDigestIndex];
    nextDigestIndex += 1;
    return nextDigestGroup;
  };

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const nextDigestGroup = getNextDigestGroup();
        if (!nextDigestGroup) {
          return;
        }

        const [digest, group] = nextDigestGroup;
        const result = await scanDigestGroup({
          digest,
          group,
          signal: batchController.signal,
          scanIntervalMs,
          trivyDbUpdatedAt,
          cycleId,
        });
        incrementScheduledScanOutcomeCount(outcomeCounts, result);
      }
    }),
  );

  return {
    ...outcomeCounts,
    skippedCount: digestEntries.length - nextDigestIndex,
  };
}

export async function runScheduledScans(): Promise<void> {
  if (scanInProgress) {
    logScheduler.info('Scheduled scan already in progress, skipping');
    return;
  }

  const securityConfig = getSchedulerSecurityConfiguration();
  if (!isScheduledScannerEnabled(securityConfig)) {
    logScheduler.info('Security scanner not enabled, skipping scheduled scan');
    return;
  }

  scanInProgress = true;
  const cycleId = uuidv7();
  const startedAt = new Date().toISOString();
  let batchController: AbortController | undefined;
  let batchTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let totalScannedForCycle = 0;
  let totalAlertsForCycle = 0;

  try {
    const scheduledBatch = await prepareScheduledBatch(securityConfig);
    if (!scheduledBatch) {
      return;
    }

    const { digestGroups, scanIntervalMs, scanConcurrency, batchTimeoutMs, trivyDbUpdatedAt } =
      scheduledBatch;
    const digestEntries = Array.from(digestGroups.entries());

    batchController = new AbortController();
    scanAbortController = batchController;
    batchTimeoutHandle = createBatchTimeout(batchController, batchTimeoutMs);
    const { cachedCount, scannedCount, errorCount, abortedCount, skippedCount, alertCount } =
      await runScheduledBatchDigestWorkers({
        batchController,
        digestEntries,
        scanConcurrency,
        scanIntervalMs,
        trivyDbUpdatedAt,
        cycleId,
      });
    totalScannedForCycle = cachedCount + scannedCount;
    totalAlertsForCycle = alertCount;

    logScheduler.info(
      `Scheduled scan complete: ${digestGroups.size} digests, ${cachedCount} cached, ${scannedCount} scanned fresh, ${errorCount} errors, ${abortedCount} aborted, ${skippedCount} skipped, ${alertCount} alerts emitted`,
    );
  } finally {
    if (batchTimeoutHandle) {
      clearTimeout(batchTimeoutHandle);
    }
    if (batchController && scanAbortController === batchController) {
      scanAbortController = undefined;
    }
    scanInProgress = false;
    await emitSecurityScanCycleComplete({
      cycleId,
      scannedCount: totalScannedForCycle,
      alertCount: totalAlertsForCycle,
      startedAt,
      completedAt: new Date().toISOString(),
      scope: 'scheduled',
    });
  }
}

export function init(): void {
  const securityConfig = getSchedulerSecurityConfiguration();
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

  cachedScanIntervalMs = getSchedulerScanIntervalMs();
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
  cachedSecurityConfiguration = undefined;
  cachedScanIntervalMs = undefined;
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
