import { computed, type Ref } from 'vue';
import type { ApiWatcherConfiguration } from '../../types/api';
import type { Container } from '../../types/container';
import {
  buildDashboardContainerMetrics,
  type ImageSecurityAggregate,
} from '../../utils/dashboard-container-metrics';
import type {
  DashboardAgent,
  DashboardServerInfo,
  DashboardServerRow,
  DashboardStatCard,
  RecentAuditStatus,
  RecentUpdateRow,
  UpdateBreakdownBucket,
  UpdateKind,
} from './dashboardTypes';

const DONUT_CIRCUMFERENCE = 301.6;
const RECENT_UPDATES_LIMIT = 6;

const UPDATE_BREAKDOWN_BUCKETS: ReadonlyArray<Omit<UpdateBreakdownBucket, 'count'>> = [
  {
    kind: 'major',
    label: 'Major',
    color: 'var(--dd-danger)',
    colorMuted: 'var(--dd-danger-muted)',
    icon: 'chevrons-up',
  },
  {
    kind: 'minor',
    label: 'Minor',
    color: 'var(--dd-warning)',
    colorMuted: 'var(--dd-warning-muted)',
    icon: 'chevron-up',
  },
  {
    kind: 'patch',
    label: 'Patch',
    color: 'var(--dd-primary)',
    colorMuted: 'var(--dd-primary-muted)',
    icon: 'hashtag',
  },
  {
    kind: 'digest',
    label: 'Digest',
    color: 'var(--dd-neutral)',
    colorMuted: 'var(--dd-neutral-muted)',
    icon: 'fingerprint',
  },
];

function getWatcherConfiguration(watcher: Record<string, unknown>): ApiWatcherConfiguration {
  if (watcher?.configuration && typeof watcher.configuration === 'object') {
    return watcher.configuration as ApiWatcherConfiguration;
  }
  if (watcher?.config && typeof watcher.config === 'object') {
    return watcher.config as ApiWatcherConfiguration;
  }
  return {};
}

function formatMaintenanceDuration(durationMs: number): string {
  const totalMinutes = Math.max(1, Math.ceil(durationMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getRecentUpdateStatusColor(status: RecentUpdateRow['status']): string {
  switch (status) {
    case 'updated':
      return 'var(--dd-success)';
    case 'pending':
      return 'var(--dd-warning)';
    case 'snoozed':
      return 'var(--dd-primary)';
    case 'skipped':
      return 'var(--dd-text-muted)';
    case 'failed':
    case 'error':
      return 'var(--dd-danger)';
  }
}

function getRecentUpdateStatusMutedColor(status: RecentUpdateRow['status']): string {
  switch (status) {
    case 'updated':
      return 'var(--dd-success-muted)';
    case 'pending':
      return 'var(--dd-warning-muted)';
    case 'snoozed':
      return 'var(--dd-primary-muted)';
    case 'skipped':
      return 'var(--dd-bg-elevated)';
    case 'failed':
    case 'error':
      return 'var(--dd-danger-muted)';
  }
}

function getRecentUpdateStatusIcon(status: RecentUpdateRow['status']): string {
  switch (status) {
    case 'updated':
      return 'check';
    case 'pending':
      return 'pending';
    case 'snoozed':
      return 'pending';
    case 'skipped':
      return 'skip-forward';
    case 'failed':
    case 'error':
      return 'xmark';
  }
}

function deriveRecentUpdateStatus(
  container: Container,
  recentStatusByContainer: Record<string, RecentAuditStatus>,
): RecentUpdateRow['status'] {
  if (container.updatePolicyState === 'snoozed') {
    return 'snoozed';
  }
  if (container.updatePolicyState === 'skipped') {
    return 'skipped';
  }
  return recentStatusByContainer[container.name] ?? 'pending';
}

function deriveRecentUpdateVersion(container: Container): string {
  if (container.newTag) {
    return container.newTag;
  }
  return container.suppressedUpdateTag ?? '';
}

function parseDetectedAt(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

interface PendingRecentUpdateCandidate {
  detectedAt: number;
  row: RecentUpdateRow;
}

function comparePendingRecentUpdates(
  left: PendingRecentUpdateCandidate,
  right: PendingRecentUpdateCandidate,
): number {
  const byDetectedAt = right.detectedAt - left.detectedAt;
  if (byDetectedAt !== 0) {
    return byDetectedAt;
  }
  return left.row.name.localeCompare(right.row.name);
}

function insertPendingRecentUpdate(
  topPendingUpdates: PendingRecentUpdateCandidate[],
  candidate: PendingRecentUpdateCandidate,
  maxItems: number,
) {
  if (maxItems <= 0) {
    return;
  }

  let insertAt = -1;
  for (let index = 0; index < topPendingUpdates.length; index += 1) {
    if (comparePendingRecentUpdates(candidate, topPendingUpdates[index]) < 0) {
      insertAt = index;
      break;
    }
  }

  if (insertAt === -1) {
    if (topPendingUpdates.length < maxItems) {
      topPendingUpdates.push(candidate);
    }
    return;
  }

  topPendingUpdates.splice(insertAt, 0, candidate);
  if (topPendingUpdates.length > maxItems) {
    topPendingUpdates.pop();
  }
}

function formatAgentHost(agent: DashboardAgent): string | undefined {
  const host = typeof agent.host === 'string' ? agent.host.trim() : '';
  if (!host) {
    return undefined;
  }
  const portValue = agent.port;
  if (typeof portValue === 'number' && Number.isFinite(portValue)) {
    return `${host}:${portValue}`;
  }
  if (typeof portValue === 'string') {
    const port = portValue.trim();
    if (port.length > 0) {
      return `${host}:${port}`;
    }
  }
  return host;
}

interface UseDashboardComputedInput {
  agents: Ref<DashboardAgent[]>;
  containers: Ref<Container[]>;
  maintenanceCountdownNow: Ref<number>;
  recentStatusByContainer: Ref<Record<string, RecentAuditStatus>>;
  registries: Ref<unknown[]>;
  serverInfo: Ref<DashboardServerInfo | null>;
  watchers: Ref<unknown[]>;
}

export function useDashboardComputed(input: UseDashboardComputedInput) {
  const maintenanceWindowWatchers = computed(() =>
    input.watchers.value.filter((watcher) => {
      const configuration = getWatcherConfiguration(watcher as Record<string, unknown>);
      const maintenanceWindow = configuration.maintenancewindow ?? configuration.maintenanceWindow;
      return typeof maintenanceWindow === 'string' && maintenanceWindow.trim().length > 0;
    }),
  );

  const maintenanceWindowOpenCount = computed(
    () =>
      maintenanceWindowWatchers.value.filter((watcher) => {
        const configuration = getWatcherConfiguration(watcher as Record<string, unknown>);
        const open = configuration.maintenancewindowopen ?? configuration.maintenanceWindowOpen;
        return open === true;
      }).length,
  );

  const nextMaintenanceWindowAt = computed<number | undefined>(() => {
    const windows = maintenanceWindowWatchers.value
      .map((watcher) => {
        const configuration = getWatcherConfiguration(watcher as Record<string, unknown>);
        return configuration.maintenancenextwindow ?? configuration.maintenanceNextWindow;
      })
      .map((value: unknown) => {
        if (typeof value !== 'string') return undefined;
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? undefined : parsed;
      })
      .filter((value): value is number => value !== undefined);

    if (windows.length === 0) {
      return undefined;
    }

    return Math.min(...windows);
  });

  const maintenanceCountdownLabel = computed(() => {
    if (maintenanceWindowWatchers.value.length === 0) {
      return '';
    }
    if (maintenanceWindowOpenCount.value > 0) {
      return 'Open now';
    }
    if (!nextMaintenanceWindowAt.value) {
      return 'Scheduled';
    }
    const remainingMs = nextMaintenanceWindowAt.value - input.maintenanceCountdownNow.value;
    if (remainingMs <= 0) {
      return 'Opening soon';
    }
    return formatMaintenanceDuration(remainingMs);
  });

  const containerMetrics = computed(() => buildDashboardContainerMetrics(input.containers.value));
  const securityByImage = computed<ImageSecurityAggregate[]>(
    () => containerMetrics.value.securityByImage,
  );

  const securityCounts = computed(() => {
    let clean = 0;
    let issues = 0;
    let notScanned = 0;

    for (const aggregate of securityByImage.value) {
      if (!aggregate.scanned) {
        notScanned += 1;
      } else if (aggregate.hasIssue) {
        issues += 1;
      } else {
        clean += 1;
      }
    }

    return { clean, issues, notScanned };
  });

  const securityCleanCount = computed(() => securityCounts.value.clean);
  const securityIssueCount = computed(() => securityCounts.value.issues);
  const securityNotScannedCount = computed(() => securityCounts.value.notScanned);
  const securitySeverityTotals = computed(() =>
    securityByImage.value.reduce(
      (totals, aggregate) => {
        totals.critical += aggregate.summary.critical;
        totals.high += aggregate.summary.high;
        totals.medium += aggregate.summary.medium;
        totals.low += aggregate.summary.low;
        return totals;
      },
      { critical: 0, high: 0, medium: 0, low: 0 },
    ),
  );

  const showSecuritySeverityBreakdown = computed(() => {
    const totals = securitySeverityTotals.value;
    return totals.critical + totals.high + totals.medium + totals.low > 0;
  });

  const securityTotalCount = computed(() => securityByImage.value.length);

  const stats = computed<DashboardStatCard[]>(() => {
    const {
      totalContainers: total,
      runningContainers: running,
      updatesAvailable,
      securityIssueImageCount: securityIssues,
    } = containerMetrics.value;

    const stopped = Math.max(total - running, 0);
    const registryCount = input.registries.value.length;
    return [
      {
        id: 'stat-containers',
        label: 'Containers',
        value: String(total),
        icon: 'containers',
        color: 'var(--dd-primary)',
        colorMuted: 'var(--dd-primary-muted)',
        route: '/containers',
        detail: `${running} running · ${stopped} stopped`,
      },
      {
        id: 'stat-updates',
        label: 'Updates Available',
        value: String(updatesAvailable),
        icon: 'updates',
        color: (() => {
          if (updatesAvailable === 0) return 'var(--dd-success)';
          const ratio = total > 0 ? updatesAvailable / total : 0;
          if (ratio >= 0.75) return 'var(--dd-danger)';
          if (ratio >= 0.5) return 'var(--dd-warning)';
          return 'var(--dd-caution)';
        })(),
        colorMuted: (() => {
          if (updatesAvailable === 0) return 'var(--dd-success-muted)';
          const ratio = total > 0 ? updatesAvailable / total : 0;
          if (ratio >= 0.75) return 'var(--dd-danger-muted)';
          if (ratio >= 0.5) return 'var(--dd-warning-muted)';
          return 'var(--dd-caution-muted)';
        })(),
        route: { path: '/containers', query: { filterKind: 'any' } },
      },
      {
        id: 'stat-security',
        label: 'Security Issues',
        value: String(securityIssues),
        icon: 'security',
        color: securityIssues > 0 ? 'var(--dd-danger)' : 'var(--dd-success)',
        colorMuted: securityIssues > 0 ? 'var(--dd-danger-muted)' : 'var(--dd-success-muted)',
        route: '/security',
      },
      {
        id: 'stat-registries',
        label: 'Registries',
        value: String(registryCount),
        icon: 'registries',
        color: 'var(--dd-primary)',
        colorMuted: 'var(--dd-primary-muted)',
        route: '/registries',
      },
    ];
  });

  const recentUpdates = computed<RecentUpdateRow[]>(() => {
    const registryFailures = input.containers.value
      .filter((container) => !container.newTag && !!container.registryError)
      .map((container) => ({
        id: container.id,
        name: container.name,
        image: container.image,
        icon: container.icon,
        oldVer: container.currentTag,
        newVer: 'check failed',
        releaseLink: undefined,
        status: 'error' as const,
        running: container.status === 'running',
        registryError: container.registryError,
      }));

    const availablePendingSlots = Math.max(RECENT_UPDATES_LIMIT - registryFailures.length, 0);
    if (availablePendingSlots === 0) {
      return registryFailures.slice(0, RECENT_UPDATES_LIMIT);
    }

    const topPendingUpdates: PendingRecentUpdateCandidate[] = [];
    for (const container of input.containers.value) {
      if (!container.newTag && !container.updatePolicyState) {
        continue;
      }

      insertPendingRecentUpdate(
        topPendingUpdates,
        {
          detectedAt: parseDetectedAt(container.updateDetectedAt),
          row: {
            id: container.id,
            name: container.name,
            image: container.image,
            icon: container.icon,
            oldVer: container.currentTag,
            newVer: deriveRecentUpdateVersion(container),
            releaseLink: container.releaseLink,
            status: deriveRecentUpdateStatus(container, input.recentStatusByContainer.value),
            running: container.status === 'running',
            registryError: undefined,
          },
        },
        availablePendingSlots,
      );
    }

    return [...registryFailures, ...topPendingUpdates.map((candidate) => candidate.row)].slice(
      0,
      RECENT_UPDATES_LIMIT,
    );
  });

  const vulnerabilities = computed(() => {
    return input.containers.value
      .filter((container) => container.bouncer === 'blocked' || container.bouncer === 'unsafe')
      .slice(0, 5)
      .map((container) => ({
        id: container.name,
        severity: container.bouncer === 'blocked' ? 'CRITICAL' : 'HIGH',
        package: container.image,
        image: container.name,
      }));
  });

  const servers = computed<DashboardServerRow[]>(() => {
    const list: DashboardServerRow[] = [];
    const countsByServer = new Map<string, { running: number; total: number }>();

    for (const container of input.containers.value) {
      const existing = countsByServer.get(container.server);
      if (existing) {
        existing.total += 1;
        if (container.status === 'running') {
          existing.running += 1;
        }
        continue;
      }
      countsByServer.set(container.server, {
        running: container.status === 'running' ? 1 : 0,
        total: 1,
      });
    }

    const localContainerCounts = countsByServer.get('Local') ?? { running: 0, total: 0 };
    list.push({
      name: 'Local',
      host: 'unix:///var/run/docker.sock',
      status: 'connected',
      containers: {
        running: localContainerCounts.running,
        total: localContainerCounts.total,
      },
    });

    for (const agent of input.agents.value) {
      const agentName =
        typeof agent.name === 'string' && agent.name.length > 0 ? agent.name : 'unknown-agent';
      const agentContainerCounts = countsByServer.get(agentName) ?? { running: 0, total: 0 };
      list.push({
        name: agentName,
        host: formatAgentHost(agent),
        status: agent.connected ? 'connected' : 'disconnected',
        containers: {
          running: agentContainerCounts.running,
          total: agentContainerCounts.total,
        },
      });
    }

    return list;
  });

  const webhookApiEnabled = computed(
    () => input.serverInfo.value?.configuration?.webhook?.enabled === true,
  );

  const securityCleanArcLength = computed(() =>
    securityTotalCount.value > 0
      ? (securityCleanCount.value / securityTotalCount.value) * DONUT_CIRCUMFERENCE
      : 0,
  );

  const securityIssueArcLength = computed(() =>
    securityTotalCount.value > 0
      ? (securityIssueCount.value / securityTotalCount.value) * DONUT_CIRCUMFERENCE
      : 0,
  );

  const securityNotScannedArcLength = computed(() =>
    securityTotalCount.value > 0
      ? (securityNotScannedCount.value / securityTotalCount.value) * DONUT_CIRCUMFERENCE
      : 0,
  );

  const updateBreakdownBuckets = computed<UpdateBreakdownBucket[]>(() => {
    const counts: Record<UpdateKind, number> = {
      major: 0,
      minor: 0,
      patch: 0,
      digest: 0,
    };

    for (const container of input.containers.value) {
      if (container.updateKind) {
        counts[container.updateKind] += 1;
      }
    }

    return UPDATE_BREAKDOWN_BUCKETS.map((bucket) => ({
      ...bucket,
      count: counts[bucket.kind],
    }));
  });

  const totalUpdates = computed(
    () => input.containers.value.filter((container) => container.updateKind).length,
  );

  return {
    DONUT_CIRCUMFERENCE,
    getRecentUpdateStatusColor,
    getRecentUpdateStatusIcon,
    getRecentUpdateStatusMutedColor,
    maintenanceCountdownLabel,
    maintenanceWindowWatchers,
    recentUpdates,
    securityCleanArcLength,
    securityCleanCount,
    securityIssueArcLength,
    securityIssueCount,
    securityNotScannedArcLength,
    securityNotScannedCount,
    securitySeverityTotals,
    securityTotalCount,
    servers,
    showSecuritySeverityBreakdown,
    stats,
    totalUpdates,
    updateBreakdownBuckets,
    vulnerabilities,
    webhookApiEnabled,
  };
}
