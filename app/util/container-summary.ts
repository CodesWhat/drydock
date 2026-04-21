interface ContainerStatusLike {
  status?: unknown;
  updateAvailable?: boolean;
}

interface ContainerDashboardLike extends ContainerStatusLike {
  updateMaturityLevel?: unknown;
  security?: {
    scan?: {
      summary?: { critical?: unknown; high?: unknown } | null;
    } | null;
  } | null;
}

export interface ContainerDashboardSummary {
  status: ContainerStatusSummary;
  securityIssues: number;
  hotUpdates: number;
  matureUpdates: number;
}

interface ContainerWithImageLike extends ContainerStatusLike {
  id?: unknown;
  image?: { id?: unknown; name?: unknown } | null;
  agent?: unknown;
  watcher?: unknown;
}

interface ContainerStatusSummary {
  total: number;
  running: number;
  stopped: number;
  updatesAvailable: number;
}

export interface ContainerStatsBucket {
  total: number;
  running: number;
  updatesAvailable: number;
  imageFingerprints: Set<string>;
}

export function isContainerRunning(container: ContainerStatusLike): boolean {
  return String(container.status ?? '').toLowerCase() === 'running';
}

export function getContainerStatusSummary(
  containers: ContainerStatusLike[],
): ContainerStatusSummary {
  const total = containers.length;
  const running = containers.filter((container) => isContainerRunning(container)).length;
  const updatesAvailable = containers.filter(
    (container) => container.updateAvailable === true,
  ).length;
  return {
    total,
    running,
    stopped: Math.max(total - running, 0),
    updatesAvailable,
  };
}

function hasSecurityIssue(container: ContainerDashboardLike): boolean {
  const summary = container.security?.scan?.summary;
  return Number(summary?.critical ?? 0) > 0 || Number(summary?.high ?? 0) > 0;
}

// Computes containers.total/running/stopped/updatesAvailable, security issues, and the
// hot/mature update breakdown in a single pass. Previously the summary handler filtered
// the container list four separate times — on a large tenant each pass re-read reactive
// fields (and, pre-fix, the tagPinned getter) for every container.
export function buildContainerDashboardSummary(
  containers: Iterable<ContainerDashboardLike>,
): ContainerDashboardSummary {
  let total = 0;
  let running = 0;
  let updatesAvailable = 0;
  let securityIssues = 0;
  let hotUpdates = 0;
  let matureUpdates = 0;

  for (const container of containers) {
    total += 1;
    if (isContainerRunning(container)) {
      running += 1;
    }
    if (container.updateAvailable === true) {
      updatesAvailable += 1;
      if (container.updateMaturityLevel === 'hot') {
        hotUpdates += 1;
      } else if (
        container.updateMaturityLevel === 'mature' ||
        container.updateMaturityLevel === 'established'
      ) {
        matureUpdates += 1;
      }
    }
    if (hasSecurityIssue(container)) {
      securityIssues += 1;
    }
  }

  return {
    status: {
      total,
      running,
      stopped: Math.max(total - running, 0),
      updatesAvailable,
    },
    securityIssues,
    hotUpdates,
    matureUpdates,
  };
}

export function createEmptyContainerStatsBucket(): ContainerStatsBucket {
  return {
    total: 0,
    running: 0,
    updatesAvailable: 0,
    imageFingerprints: new Set<string>(),
  };
}

/**
 * Build a per-key container stats map in a single pass over the input list.
 *
 * Used by `/api/agents` (keyed by `container.agent`) and `/api/watchers`
 * (keyed by `container.watcher`) to avoid O(keys × containers) filter
 * fan-out. Each container is attributed to exactly one bucket via `getKey`;
 * containers returning `undefined` are skipped. Buckets are pre-allocated
 * for every entry in `allKeys` so keys with zero containers still show up.
 *
 * See #301 for the regression that motivated this helper.
 */
export function buildContainerStatsByKey<T extends ContainerWithImageLike>(
  containers: Iterable<T>,
  allKeys: Iterable<string>,
  getKey: (container: T) => string | undefined,
): Map<string, ContainerStatsBucket> {
  const byKey = new Map<string, ContainerStatsBucket>();
  for (const key of allKeys) {
    byKey.set(key, createEmptyContainerStatsBucket());
  }
  for (const container of containers) {
    const key = getKey(container);
    if (key === undefined) {
      continue;
    }
    const bucket = byKey.get(key);
    if (!bucket) {
      continue;
    }
    bucket.total += 1;
    if (isContainerRunning(container)) {
      bucket.running += 1;
    }
    if (container.updateAvailable === true) {
      bucket.updatesAvailable += 1;
    }
    const imageKey = container.image?.id ?? container.image?.name ?? container.id;
    if (typeof imageKey === 'string' && imageKey !== '') {
      bucket.imageFingerprints.add(imageKey);
    }
  }
  return byKey;
}

export function projectStatsBucket(bucket: ContainerStatsBucket) {
  const stopped = Math.max(bucket.total - bucket.running, 0);
  return {
    containers: {
      total: bucket.total,
      running: bucket.running,
      stopped,
      updatesAvailable: bucket.updatesAvailable,
    },
    images: bucket.imageFingerprints.size,
  };
}
