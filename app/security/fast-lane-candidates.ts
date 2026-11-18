import {
  resolveContainerImageFullName,
  resolveContainerRegistryAuth,
} from '../api/container/shared.js';
import log from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { Container } from '../model/container.js';
import { hasCandidateIdentityChanged, hasRawUpdate } from '../model/container.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { getErrorMessage } from '../util/error.js';
import { isSecurityFastLaneEnabled, updateScanMatchesCandidate } from './fast-lane.js';
import { scanImageForVulnerabilities, scanImageWithDedup } from './scan.js';

const logFastLane = log.child({ component: 'security.fast-lane' });

/**
 * Candidates already scanned (or attempted) for the fast lane, keyed by container and
 * candidate identity. One attempt per candidate: a failed scan is not retried until the
 * candidate changes, so this can never turn into a scan storm.
 */
const attemptedCandidates = new Set<string>();

export function resetFastLaneCandidateAttempts(): void {
  attemptedCandidates.clear();
}

function candidateKey(container: Container): string {
  return `${container.id}|${container.result?.digest ?? container.result?.tag}`;
}

/** Opted-in containers with a pending candidate that has no scan yet and a usable baseline. */
export function selectFastLaneCandidates(containers: Container[]): Container[] {
  return containers.filter((container) => {
    const baseline = container.security?.scan;
    const updateScan = container.security?.updateScan;
    return (
      isSecurityFastLaneEnabled(container) &&
      hasRawUpdate(container) &&
      container.result?.tag !== undefined &&
      baseline !== undefined &&
      baseline.status !== 'error' &&
      !(updateScan && updateScanMatchesCandidate(container, updateScan)) &&
      !attemptedCandidates.has(candidateKey(container))
    );
  });
}

async function scanFastLaneCandidate(
  container: Container,
  options: { signal: AbortSignal; scanIntervalMs: number; trivyDbUpdatedAt?: string },
): Promise<boolean> {
  attemptedCandidates.add(candidateKey(container));
  try {
    const tag = container.result?.tag as string;
    const digest = container.result?.digest;
    const registries = registry.getState().registry || {};
    const image = resolveContainerImageFullName(container, registries, tag);
    const auth = await resolveContainerRegistryAuth(container, registries, {
      log: logFastLane,
      sanitizeLogParam,
    });
    const scanResult = digest
      ? (
          await scanImageWithDedup(
            {
              image,
              auth,
              digest,
              trivyDbUpdatedAt: options.trivyDbUpdatedAt,
              signal: options.signal,
            },
            options.scanIntervalMs,
          )
        ).scanResult
      : await scanImageForVulnerabilities({ image, auth, signal: options.signal });
    // Read the CURRENT record at write-back time, and drop the result when the candidate
    // moved while the scan ran, so it never lands on a different pending update. An errored
    // scan is not stored: it describes nothing about the candidate.
    const current =
      scanResult.status === 'error' ? undefined : storeContainer.getContainerRaw(container.id);
    if (!current || hasCandidateIdentityChanged(container.result, current.result)) {
      return false;
    }
    storeContainer.updateContainer({
      ...current,
      security: {
        ...(current.security || {}),
        updateScan: digest ? { ...scanResult, imageDigest: digest } : scanResult,
      },
    });
    return true;
  } catch (error: unknown) {
    logFastLane.warn(
      `Fast lane candidate scan failed for container ${sanitizeLogParam(container.id, 80)}: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

/**
 * Scan the pending candidate of each opted-in container once, so the fast lane has the
 * evidence it needs for a held update. Runs after the scheduled scan with the same worker
 * count, and only touches candidates that are still unscanned.
 */
export async function scanFastLaneCandidates(options: {
  signal: AbortSignal;
  scanConcurrency: number;
  scanIntervalMs: number;
  trivyDbUpdatedAt?: string;
}): Promise<number> {
  const candidates = selectFastLaneCandidates(
    storeContainer.getContainersRaw().map(storeContainer.cloneContainer),
  );
  if (candidates.length === 0) {
    return 0;
  }
  logFastLane.info(`Scanning ${candidates.length} fast lane update candidates`);

  let nextIndex = 0;
  let scanned = 0;
  const workerCount = Math.min(options.scanConcurrency, candidates.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!options.signal.aborted && nextIndex < candidates.length) {
        const container = candidates[nextIndex];
        nextIndex += 1;
        if (await scanFastLaneCandidate(container, options)) {
          scanned += 1;
        }
      }
    }),
  );
  return scanned;
}
