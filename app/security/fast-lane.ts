import type { Container } from '../model/container.js';
import { isImmutableDigest, isScannedRefPinnedTo } from './digest.js';

/** Per-container opt-in (or opt-out of the global default). */
export const SECURITY_FAST_LANE_LABEL = 'dd.security.fastlane';
/** Global default for containers that carry no label. */
export const SECURITY_FAST_LANE_ENV = 'DD_SECURITY_FASTLANE';
/** Most fixed vulnerability IDs carried on the container, events and audit entries. */
export const SECURITY_FAST_LANE_ID_CAP = 10;

export interface SecurityFastLane {
  /** Capped list of critical/high IDs present in the running image and absent from the candidate. */
  fixedIds: string[];
  /** Total number of such IDs, including those past the cap. */
  fixedCount: number;
  fixedCritical: number;
  fixedHigh: number;
}

type ContainerScan = NonNullable<NonNullable<Container['security']>['scan']>;

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return undefined;
}

/**
 * The label wins over the global default, in either direction, so one container can opt out
 * of a fleet-wide `DD_SECURITY_FASTLANE=true`.
 */
export function isSecurityFastLaneEnabled(container: Pick<Container, 'labels'>): boolean {
  return (
    parseBoolean(container.labels?.[SECURITY_FAST_LANE_LABEL]) ??
    parseBoolean(process.env[SECURITY_FAST_LANE_ENV]) ??
    false
  );
}

/**
 * Whether a candidate scan describes the candidate the container currently has pending.
 * Digest wins; a tag-only candidate falls back to the scanned image reference.
 */
export function updateScanMatchesCandidate(container: Container, updateScan: ContainerScan) {
  const candidateDigest = container.result?.digest;
  if (candidateDigest) {
    return (
      updateScan.imageDigest === candidateDigest || updateScan.image.endsWith(`@${candidateDigest}`)
    );
  }

  const candidateTag = container.result?.tag;
  return Boolean(
    candidateTag &&
      (updateScan.image === candidateTag || updateScan.image.endsWith(`:${candidateTag}`)),
  );
}

/** A scan usable as fast lane evidence: no error or partial failure, and the full ID sets. */
function isCompleteScan(scan: ContainerScan): boolean {
  return !scan.error && scan.status !== 'error' && scan.severityIds !== undefined;
}

/**
 * The running image's scan, when it positively describes the digest that is running. A
 * missing digest on either side is not a match.
 */
function getRunningEvidence(container: Container): ContainerScan | undefined {
  const scan = container.security?.scan;
  const runningDigest = container.image?.digest?.value;
  if (
    !scan ||
    !isImmutableDigest(runningDigest) ||
    scan.imageDigest !== runningDigest ||
    !isScannedRefPinnedTo(scan.scannedRef, runningDigest) ||
    !isCompleteScan(scan)
  ) {
    return undefined;
  }
  return scan;
}

/**
 * Whether the stored candidate scan can be compared with the running scan: it was taken of
 * the pending candidate digest by the same scanner, and not before the running scan (a
 * scan of an older vulnerability database would credit fixes the candidate doesn't have).
 */
export function isComparableCandidateScan(
  candidate: ContainerScan,
  running: ContainerScan,
  candidateDigest: string,
): boolean {
  return (
    isImmutableDigest(candidateDigest) &&
    candidate.imageDigest === candidateDigest &&
    isScannedRefPinnedTo(candidate.scannedRef, candidateDigest) &&
    isCompleteScan(candidate) &&
    candidate.scanner === running.scanner &&
    Date.parse(candidate.scannedAt) >= Date.parse(running.scannedAt)
  );
}

/**
 * Whether an opted-in container's pending candidate still needs a scan before the fast lane
 * can judge it: there is trustworthy running evidence, a candidate digest, and no stored
 * candidate scan that is comparable with it.
 */
export function needsFastLaneCandidateScan(container: Container): boolean {
  const running = getRunningEvidence(container);
  const candidateDigest = container.result?.digest;
  if (!running || !isImmutableDigest(candidateDigest)) {
    return false;
  }
  const candidate = container.security?.updateScan;
  return !(candidate && isComparableCandidateScan(candidate, running, candidateDigest));
}

/**
 * Decide whether the pending candidate is a security fix for what is running, from scans
 * that already exist. Never scans anything.
 *
 * "Fixes" means at least one critical or high vulnerability ID in the running image's
 * latest scan is absent from the candidate's critical and high IDs, and the candidate
 * carries no critical ID the running image did not already list as critical or high. Both
 * scans must be complete (no error, full ID sets recorded before the stored list is cut
 * off), positively bound to the running digest and the pending candidate digest, and
 * comparable in time and scanner. Anything less means no fast lane.
 */
export function evaluateSecurityFastLane(container: Container): SecurityFastLane | undefined {
  if (!isSecurityFastLaneEnabled(container)) {
    return undefined;
  }
  const running = getRunningEvidence(container);
  const candidateDigest = container.result?.digest;
  const candidate = container.security?.updateScan;
  if (
    !running?.severityIds ||
    !isImmutableDigest(candidateDigest) ||
    !candidate?.severityIds ||
    !isComparableCandidateScan(candidate, running, candidateDigest)
  ) {
    return undefined;
  }

  const candidateCritical = new Set(candidate.severityIds.critical);
  const candidateAll = new Set([...candidateCritical, ...candidate.severityIds.high]);
  const runningAll = new Set([...running.severityIds.critical, ...running.severityIds.high]);
  const fixedCritical = running.severityIds.critical.filter((id) => !candidateAll.has(id));
  const fixedCriticalSet = new Set(fixedCritical);
  const fixedHigh = running.severityIds.high.filter(
    (id) => !candidateAll.has(id) && !fixedCriticalSet.has(id),
  );

  const fixedCount = fixedCritical.length + fixedHigh.length;
  if (fixedCount === 0) {
    return undefined;
  }
  for (const id of candidateCritical) {
    if (!runningAll.has(id)) {
      return undefined;
    }
  }

  return {
    fixedIds: [...[...fixedCritical].sort(), ...[...fixedHigh].sort()].slice(
      0,
      SECURITY_FAST_LANE_ID_CAP,
    ),
    fixedCount,
    fixedCritical: fixedCritical.length,
    fixedHigh: fixedHigh.length,
  };
}
