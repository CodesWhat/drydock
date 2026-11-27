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
import {
  isComparableCandidateScan,
  isSecurityFastLaneEnabled,
  needsFastLaneCandidateScan,
} from './fast-lane.js';
import { type ContainerSecurityScan, scanImageForVulnerabilities } from './scan.js';

const logFastLane = log.child({ component: 'security.fast-lane' });

/**
 * Candidates already scanned (or attempted) for the fast lane, keyed by container, candidate
 * digest and the running scan they are compared with. One attempt per candidate digest per
 * running-scan generation: a failed scan is not retried until the candidate or the running
 * scan changes, so this can never turn into a scan storm.
 */
const attemptedCandidates = new Set<string>();

/**
 * The latest candidate scan per digest, shared by every container pending that digest (replicas,
 * or several services on one image). A container only takes it when it is comparable with its
 * own running scan, so a stale result is never reused.
 */
const candidateScanByDigest = new Map<string, ContainerSecurityScan>();
const CANDIDATE_SCAN_CACHE_MAX_ENTRIES = 200;

function rememberCandidateScan(digest: string, scanResult: ContainerSecurityScan): void {
  candidateScanByDigest.delete(digest);
  candidateScanByDigest.set(digest, scanResult);
  if (candidateScanByDigest.size > CANDIDATE_SCAN_CACHE_MAX_ENTRIES) {
    candidateScanByDigest.delete(candidateScanByDigest.keys().next().value as string);
  }
}

export function resetFastLaneCandidateAttempts(): void {
  attemptedCandidates.clear();
  candidateScanByDigest.clear();
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

function isScanUsableFor(
  container: Container,
  digest: string,
  scanResult: ContainerSecurityScan | undefined,
): scanResult is ContainerSecurityScan {
  const running = container.security?.scan;
  return (
    scanResult !== undefined &&
    running !== undefined &&
    isComparableCandidateScan({ ...scanResult, imageDigest: digest }, running, digest)
  );
}

async function scanCandidateDigest(
  representative: Container,
  digest: string,
  signal: AbortSignal,
): Promise<ContainerSecurityScan | undefined> {
  try {
    // Scan the candidate by digest, never by the mutable tag: the result is stamped with that
    // digest and must describe exactly it, even if the tag moves while the scan runs.
    const registries = registry.getState().registry || {};
    const image = resolveContainerImageFullName(representative, registries, digest);
    const auth = await resolveContainerRegistryAuth(representative, registries, {
      log: logFastLane,
      sanitizeLogParam,
    });
    const scanResult = await scanImageForVulnerabilities({ image, auth, signal });
    return scanResult.status === 'error' ? undefined : { ...scanResult, imageDigest: digest };
  } catch (error: unknown) {
    logFastLane.warn(
      `Fast lane candidate scan failed for digest ${sanitizeLogParam(digest, 80)}: ${getErrorMessage(error)}`,
    );
    return undefined;
  }
}

/** Write a candidate scan onto the container's CURRENT record, unless the candidate moved. */
function storeCandidateScan(container: Container, scanResult: ContainerSecurityScan): boolean {
  const current = storeContainer.getContainerRaw(container.id);
  if (!current || hasCandidateIdentityChanged(container.result, current.result)) {
    return false;
  }
  storeContainer.updateContainer({
    ...current,
    security: { ...(current.security || {}), updateScan: scanResult },
  });
  return true;
}

/**
 * One candidate digest and every opted-in container pending it. The digest is scanned at most
 * once for the group (and not at all when a comparable result is already remembered), and the
 * result is shared by every container whose running scan it is comparable with.
 */
async function processCandidateGroup(
  digest: string,
  containers: Container[],
  signal: AbortSignal,
): Promise<number> {
  const remembered = candidateScanByDigest.get(digest);
  let shared = remembered;
  // Members the remembered scan cannot serve (their running scan is newer) get a fresh scan.
  // Only those are marked attempted, so no member is parked on a scan that was never its own.
  const unserved = containers.filter(
    (container) => !isScanUsableFor(container, digest, remembered),
  );
  for (const container of unserved) {
    attemptedCandidates.add(candidateKey(container));
  }
  if (unserved.length > 0) {
    const fresh = await scanCandidateDigest(unserved[0], digest, signal);
    if (fresh) {
      rememberCandidateScan(digest, fresh);
      shared = fresh;
    }
  }
  let stored = 0;
  for (const container of containers) {
    if (isScanUsableFor(container, digest, shared) && storeCandidateScan(container, shared)) {
      stored += 1;
    }
  }
  return stored;
}

/**
 * Scan the pending candidate of each opted-in container so the fast lane has the evidence it
 * needs for a held update. Runs after the scheduled scan with the same worker count. Containers
 * pending the same candidate digest share one scan, and only candidates without a comparable
 * scan are touched. Returns how many containers received a scan.
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
  const groups = new Map<string, Container[]>();
  for (const container of candidates) {
    const digest = container.result?.digest as string;
    groups.set(digest, [...(groups.get(digest) ?? []), container]);
  }
  logFastLane.info(
    `Scanning ${groups.size} fast lane update candidates for ${candidates.length} containers`,
  );

  const entries = [...groups.entries()];
  let nextIndex = 0;
  let stored = 0;
  const workerCount = Math.min(options.scanConcurrency, entries.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!options.signal.aborted && nextIndex < entries.length) {
        const [digest, containers] = entries[nextIndex];
        nextIndex += 1;
        const storedForGroup = await processCandidateGroup(digest, containers, options.signal);
        stored += storedForGroup;
      }
    }),
  );
  return stored;
}
