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

let cronTask: ReturnType<typeof cron.schedule> | undefined;
let running = false;
let scanInProgress = false;

function getContainerImageFullName(container: Container, tagOverride?: string): string {
  return resolveContainerImageFullName(container, registry.getState().registry || {}, tagOverride);
}

async function getContainerRegistryAuth(container: Container) {
  return await resolveContainerRegistryAuth(container, registry.getState().registry || {}, {
    log: logScheduler,
    sanitizeLogParam,
  });
}

function getCronIntervalMs(cronExpression: string): number {
  // Estimate the interval from common cron patterns for cache TTL.
  // For daily scans (0 3 * * *) this should be ~24h.
  // Use a simple heuristic: parse the hour field.
  // Default to 24 hours for safety.
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length < 5) {
    return 24 * 60 * 60 * 1000;
  }
  const minuteField = parts[0];
  const hourField = parts[1];
  const dayField = parts[2];

  // Every N minutes: */N * * * *
  if (minuteField.startsWith('*/') && hourField === '*' && dayField === '*') {
    const minutes = Number.parseInt(minuteField.slice(2), 10);
    if (Number.isFinite(minutes) && minutes > 0) {
      return minutes * 60 * 1000;
    }
  }

  // Every N hours: 0 */N * * *
  if (hourField.startsWith('*/') && dayField === '*') {
    const hours = Number.parseInt(hourField.slice(2), 10);
    if (Number.isFinite(hours) && hours > 0) {
      return hours * 60 * 60 * 1000;
    }
  }

  // Specific hour, daily: M H * * *
  if (dayField === '*' && !hourField.includes('/') && !hourField.includes(',')) {
    return 24 * 60 * 60 * 1000;
  }

  // Fallback: 24 hours
  return 24 * 60 * 60 * 1000;
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
      const digest = container.image.digest.value!;
      const group = digestGroups.get(digest);
      if (group) {
        group.push(container);
      } else {
        digestGroups.set(digest, [container]);
      }
    }

    const scanIntervalMs = getCronIntervalMs(securityConfig.scan.cron);
    const trivyDbStatus = await getTrivyDatabaseStatus();
    const trivyDbUpdatedAt = trivyDbStatus?.updatedAt;
    let cachedCount = 0;
    let scannedCount = 0;
    let errorCount = 0;

    logScheduler.info(
      `Scanning ${digestGroups.size} unique digests across ${containersWithDigest.length} containers`,
    );

    for (const [digest, group] of digestGroups) {
      try {
        const representative = group[0];
        const image = getContainerImageFullName(representative);
        const auth = await getContainerRegistryAuth(representative);

        // Broadcast scan-started for all containers with this digest
        for (const container of group) {
          broadcastScanStarted(container.id);
        }

        const { scanResult, fromCache } = await scanImageWithDedup(
          { image, auth, digest, trivyDbUpdatedAt },
          scanIntervalMs,
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
        errorCount += 1;
        const errorMessage = getErrorMessage(error);
        logScheduler.warn(
          `Scheduled scan failed for digest ${digest.slice(0, 12)}: ${errorMessage}`,
        );

        for (const container of group) {
          broadcastScanCompleted(container.id, 'error');
        }
      }
    }

    logScheduler.info(
      `Scheduled scan complete: ${digestGroups.size} digests, ${cachedCount} cached, ${scannedCount} scanned fresh, ${errorCount} errors`,
    );
  } finally {
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
