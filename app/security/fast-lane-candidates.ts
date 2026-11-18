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
import { isSecurityFastLaneEnabled, needsFastLaneCandidateScan } from './fast-lane.js';
import { scanImageForVulnerabilities } from './scan.js';

const logFastLane = log.child({ component: 'security.fast-lane' });

/**
 * Candidates already scanned (or attempted) for the fast lane, keyed by container, candidate
 * digest and the running scan they are compared with. One attempt per candidate digest per
 * running-scan generation: a failed scan is not retried until the candidate or the running
 * scan changes, so this can never turn into a scan storm.
 */
const attemptedCandidates = new Set<string>();

export function resetFastLaneCandidateAttempts(): void {
  attemptedCandidates.clear();
}

function candidateKey(container: Container): string {
  return `${container.id}|${container.result?.digest}|${container.security?.scan?.scannedAt}`;
}

/**
 * Opted-in containers whose pending candidate digest has no scan comparable with the
 * running scan yet (missing, of another digest, older than the running scan, or from another
 * scanner).
 */
export function selectFastLaneCandidates(containers: Container[]): Container[] {
  return containers.filter(
    (container) =>
      isSecurityFastLaneEnabled(container) &&
      hasRawUpdate(container) &&
      needsFastLaneCandidateScan(container) &&
      !attemptedCandidates.has(candidateKey(container)),
  );
}

async function scanFastLaneCandidate(
  container: Container,
  options: { signal: AbortSignal },
): Promise<boolean> {
  attemptedCandidates.add(candidateKey(container));
  try {
    // Scan the candidate by digest, never by the mutable tag: the result is stamped with that
    // digest and must describe exactly it, even if the tag moves while the scan runs.
    const digest = container.result?.digest as string;
    const registries = registry.getState().registry || {};
    const image = resolveContainerImageFullName(container, registries, digest);
    const auth = await resolveContainerRegistryAuth(container, registries, {
      log: logFastLane,
      sanitizeLogParam,
    });
    const scanResult = await scanImageForVulnerabilities({
      image,
      auth,
      signal: options.signal,
    });
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
        updateScan: { ...scanResult, imageDigest: digest },
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
