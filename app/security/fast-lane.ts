import type { Container } from '../model/container.js';

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

function runningScanDescribesRunningImage(container: Container, scan: ContainerScan): boolean {
  const runningDigest = container.image?.digest?.value;
  return !(scan.imageDigest && runningDigest && scan.imageDigest !== runningDigest);
}

/**
 * Decide whether the pending candidate is a security fix for what is running, from scans
 * that already exist. Never scans anything.
 *
 * "Fixes" means at least one critical or high vulnerability ID in the running image's
 * latest scan is absent from the candidate's scan, and the candidate carries no critical ID
 * the running image did not already have. An unscanned candidate, a scan that errored, or a
 * scan of a different image than the one pending, never qualifies.
 */
export function evaluateSecurityFastLane(container: Container): SecurityFastLane | undefined {
  if (!isSecurityFastLaneEnabled(container)) {
    return undefined;
  }
  const running = container.security?.scan;
  const candidate = container.security?.updateScan;
  if (
    !running ||
    !candidate ||
    running.status === 'error' ||
    candidate.status === 'error' ||
    !runningScanDescribesRunningImage(container, running) ||
    !updateScanMatchesCandidate(container, candidate)
  ) {
    return undefined;
  }

  const candidateIds = new Set<string>();
  const candidateCritical = new Set<string>();
  for (const vulnerability of candidate.vulnerabilities ?? []) {
    candidateIds.add(vulnerability.id);
    if (vulnerability.severity === 'CRITICAL') {
      candidateCritical.add(vulnerability.id);
    }
  }

  const runningIds = new Set<string>();
  const fixedCritical = new Set<string>();
  const fixedHigh = new Set<string>();
  for (const vulnerability of running.vulnerabilities ?? []) {
    runningIds.add(vulnerability.id);
    if (candidateIds.has(vulnerability.id)) {
      continue;
    }
    if (vulnerability.severity === 'CRITICAL') {
      fixedCritical.add(vulnerability.id);
    } else if (vulnerability.severity === 'HIGH') {
      fixedHigh.add(vulnerability.id);
    }
  }
  // A vulnerability recorded at both severities (two scanners) counts once, as critical.
  for (const id of fixedCritical) {
    fixedHigh.delete(id);
  }

  const fixedCount = fixedCritical.size + fixedHigh.size;
  if (fixedCount === 0) {
    return undefined;
  }
  for (const id of candidateCritical) {
    if (!runningIds.has(id)) {
      return undefined;
    }
  }

  return {
    fixedIds: [...[...fixedCritical].sort(), ...[...fixedHigh].sort()].slice(
      0,
      SECURITY_FAST_LANE_ID_CAP,
    ),
    fixedCount,
    fixedCritical: fixedCritical.size,
    fixedHigh: fixedHigh.size,
  };
}
