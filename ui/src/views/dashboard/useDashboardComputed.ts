import { type ComputedRef, computed, type Ref } from 'vue';
import { ROUTES } from '../../router/routes';
import type { Container } from '../../types/container';
import { shouldRenderStandaloneQueuedUpdateAsUpdating } from '../../utils/container-update';
import {
  buildDashboardContainerMetrics,
  type ImageSecurityAggregate,
} from '../../utils/dashboard-container-metrics';
import { filterContainersByHidePinned } from '../../utils/hide-pinned';
import type {
  DashboardAgent,
  DashboardContainerSummary,
  DashboardServerInfo,
  DashboardServerRow,
  DashboardStatCard,
  RecentAuditStatus,
  RecentUpdateRow,
  UpdateBreakdownBucket,
  UpdateKind,
} from './dashboardTypes';
import { getWatcherConfiguration } from './watcherConfiguration';

const DONUT_CIRCUMFERENCE = 301.6;

const FILTER_KIND_ANY = 'ANY'.toLowerCase();

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

function assertNever(value: never): never {
  throw new Error(`Unexpected dashboard status: ${String(value)}`);
}

const RECENT_UPDATE_STATUS_STYLES: Record<
  RecentUpdateRow['status'],
  { color: string; colorMuted: string; icon: string }
> = {
  updated: {
    color: 'var(--dd-success)',
    colorMuted: 'var(--dd-success-muted)',
    icon: 'check',
  },
  pending: {
    color: 'var(--dd-warning)',
    colorMuted: 'var(--dd-warning-muted)',
    icon: 'pending',
  },
  queued: {
    color: 'var(--dd-warning)',
    colorMuted: 'var(--dd-warning-muted)',
    icon: 'pending',
  },
  updating: {
    color: 'var(--dd-warning)',
    colorMuted: 'var(--dd-warning-muted)',
    icon: 'pending',
  },
  snoozed: {
    color: 'var(--dd-primary)',
    colorMuted: 'var(--dd-primary-muted)',
    icon: 'pending',
  },
  'maturity-blocked': {
    color: 'var(--dd-primary)',
    colorMuted: 'var(--dd-primary-muted)',
    icon: 'clock',
  },
  skipped: {
    color: 'var(--dd-text-muted)',
    colorMuted: 'var(--dd-bg-elevated)',
    icon: 'skip-forward',
  },
  failed: {
    color: 'var(--dd-danger)',
    colorMuted: 'var(--dd-danger-muted)',
    icon: 'xmark',
  },
  error: {
    color: 'var(--dd-danger)',
    colorMuted: 'var(--dd-danger-muted)',
    icon: 'xmark',
  },
};

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
  const style = RECENT_UPDATE_STATUS_STYLES[status];
  if (!style) {
    return assertNever(status);
  }
  return style.color;
}

function getRecentUpdateStatusMutedColor(status: RecentUpdateRow['status']): string {
  const style = RECENT_UPDATE_STATUS_STYLES[status];
  if (!style) {
    return assertNever(status);
  }
  return style.colorMuted;
}

function getRecentUpdateStatusIcon(status: RecentUpdateRow['status']): string {
  const style = RECENT_UPDATE_STATUS_STYLES[status];
  if (!style) {
    return assertNever(status);
  }
  return style.icon;
}

function getUpdateKindColor(kind: UpdateKind | null): string {
  switch (kind) {
    case 'major':
      return 'var(--dd-danger)';
    case 'minor':
      return 'var(--dd-warning)';
    case 'patch':
      return 'var(--dd-primary)';
    case 'digest':
      return 'var(--dd-neutral)';
    default:
      return 'var(--dd-text-muted)';
  }
}

function getUpdateKindMutedColor(kind: UpdateKind | null): string {
  switch (kind) {
    case 'major':
      return 'var(--dd-danger-muted)';
    case 'minor':
      return 'var(--dd-warning-muted)';
    case 'patch':
      return 'var(--dd-primary-muted)';
    case 'digest':
      return 'var(--dd-neutral-muted)';
    default:
      return 'var(--dd-bg-elevated)';
  }
}

function getUpdateKindIcon(kind: UpdateKind | null): string {
  switch (kind) {
    case 'major':
      return 'chevrons-up';
    case 'minor':
      return 'chevron-up';
    case 'patch':
      return 'hashtag';
    case 'digest':
      return 'fingerprint';
    default:
      return 'info';
  }
}

function deriveRecentUpdateStatus(
  container: Container,
  containers: readonly Container[],
  recentStatusByContainer: Record<string, RecentAuditStatus>,
  recentStatusByIdentity: Record<string, RecentAuditStatus>,
  containerNameCounts: ReadonlyMap<string, number>,
): RecentUpdateRow['status'] {
  if (container.updateOperation?.status === 'in-progress') {
    return 'updating';
  }
  if (container.updateOperation?.status === 'queued') {
    return shouldRenderStandaloneQueuedUpdateAsUpdating({
      containers,
      operation: container.updateOperation,
      targetId: container.id,
    })
      ? 'updating'
      : 'queued';
  }
  if (container.updatePolicyState === 'snoozed') {
    return 'snoozed';
  }
  if (container.updatePolicyState === 'skipped') {
    return 'skipped';
  }
  if (container.updatePolicyState === 'maturity-blocked') {
    return 'maturity-blocked';
  }

  const identityStatus = recentStatusByIdentity[container.identityKey];
  if (identityStatus) {
    return identityStatus;
  }

  if ((containerNameCounts.get(container.name) ?? 0) === 1) {
    return recentStatusByContainer[container.name] ?? 'pending';
  }

  return 'pending';
}

function deriveCurrentVersion(container: Container): string {
  return container.updateOperation?.fromVersion ?? container.currentTag;
}

function deriveRecentUpdateVersion(container: Container): string {
  if (container.newTag) {
    return container.newTag;
  }
  if (container.updateOperation?.toVersion) {
    return container.updateOperation.toVersion;
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
  containerSummary: Ref<DashboardContainerSummary | null>;
  containers: Ref<Container[]>;
  hidePinned: Ref<boolean>;
  maintenanceCountdownNow: Ref<number>;
  recentStatusByContainer: Ref<Record<string, RecentAuditStatus>>;
  recentStatusByIdentity: Ref<Record<string, RecentAuditStatus>>;
  registries: Ref<unknown[]>;
  serverInfo: Ref<DashboardServerInfo | null>;
  watchers: Ref<unknown[]>;
}

type DashboardContainerMetrics = ReturnType<typeof buildDashboardContainerMetrics>;
type SecurityCounts = { clean: number; issues: number; notScanned: number };
type SecuritySeverityTotals = { critical: number; high: number; medium: number; low: number };
type ServerContainerCounts = { running: number; total: number };

function hasMaintenanceWindow(watcher: unknown): boolean {
  const configuration = getWatcherConfiguration(watcher);
  const maintenanceWindow = configuration.maintenancewindow ?? configuration.maintenanceWindow;
  return typeof maintenanceWindow === 'string' && maintenanceWindow.trim().length > 0;
}

function isMaintenanceWindowOpen(watcher: unknown): boolean {
  const configuration = getWatcherConfiguration(watcher);
  const open = configuration.maintenancewindowopen ?? configuration.maintenanceWindowOpen;
  return open === true;
}

function getWatcherName(watcher: unknown): string {
  if (watcher && typeof watcher === 'object') {
    const name = (watcher as Record<string, unknown>).name;
    if (typeof name === 'string' && name.length > 0) {
      return name;
    }
  }
  return 'local';
}

function parseMaintenanceWindowAt(watcher: unknown): number | undefined {
  const configuration = getWatcherConfiguration(watcher);
  const value = configuration.maintenancenextwindow ?? configuration.maintenanceNextWindow;
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function resolveMaintenanceCountdownLabel(
  maintenanceWindowCount: number,
  maintenanceWindowOpenCount: number,
  nextMaintenanceWindowAt: number | undefined,
  now: number,
): string {
  if (maintenanceWindowCount === 0) {
    return '';
  }
  if (maintenanceWindowOpenCount > 0) {
    return 'Open now';
  }
  if (!nextMaintenanceWindowAt) {
    return 'Scheduled';
  }
  const remainingMs = nextMaintenanceWindowAt - now;
  if (remainingMs <= 0) {
    return 'Opening soon';
  }
  return formatMaintenanceDuration(remainingMs);
}

function useMaintenanceComputed(input: UseDashboardComputedInput) {
  const maintenanceWindowWatchers = computed(() =>
    input.watchers.value.filter(hasMaintenanceWindow),
  );

  const maintenanceWindowOpenCount = computed(
    () => maintenanceWindowWatchers.value.filter(isMaintenanceWindowOpen).length,
  );

  const nextMaintenanceWindowByWatcher = computed<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const watcher of maintenanceWindowWatchers.value) {
      const ts = parseMaintenanceWindowAt(watcher);
      if (ts !== undefined) {
        map.set(getWatcherName(watcher), ts);
      }
    }
    return map;
  });

  const nextMaintenanceWindowAt = computed<number | undefined>(() => {
    const map = nextMaintenanceWindowByWatcher.value;
    if (map.size === 0) {
      return undefined;
    }
    let min = Number.POSITIVE_INFINITY;
    for (const ts of map.values()) {
      if (ts < min) {
        min = ts;
      }
    }
    return min;
  });

  const maintenanceCountdownLabel = computed(() =>
    resolveMaintenanceCountdownLabel(
      maintenanceWindowWatchers.value.length,
      maintenanceWindowOpenCount.value,
      nextMaintenanceWindowAt.value,
      input.maintenanceCountdownNow.value,
    ),
  );

  return {
    maintenanceCountdownLabel,
    maintenanceWindowWatchers,
    nextMaintenanceWindowByWatcher,
  };
}

function countSecurityByImage(aggregates: ImageSecurityAggregate[]): SecurityCounts {
  let clean = 0;
  let issues = 0;
  let notScanned = 0;

  for (const aggregate of aggregates) {
    if (!aggregate.scanned) {
      notScanned += 1;
    } else if (aggregate.hasIssue) {
      issues += 1;
    } else {
      clean += 1;
    }
  }

  return { clean, issues, notScanned };
}

function sumSecuritySeverityTotals(aggregates: ImageSecurityAggregate[]): SecuritySeverityTotals {
  return aggregates.reduce(
    (totals, aggregate) => {
      totals.critical += aggregate.summary.critical;
      totals.high += aggregate.summary.high;
      totals.medium += aggregate.summary.medium;
      totals.low += aggregate.summary.low;
      return totals;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
}

function computeSecurityArcLength(partialCount: number, totalCount: number): number {
  return totalCount > 0 ? (partialCount / totalCount) * DONUT_CIRCUMFERENCE : 0;
}

function useSecurityComputed(input: UseDashboardComputedInput) {
  const updateContainers = computed(() =>
    filterContainersByHidePinned(input.containers.value, input.hidePinned.value),
  );
  const containerMetrics = computed(() =>
    buildDashboardContainerMetrics(input.containers.value, {
      updateContainers: updateContainers.value,
    }),
  );

  const securityByImage = computed<ImageSecurityAggregate[]>(
    () => containerMetrics.value.securityByImage,
  );

  const securityCounts = computed(() => countSecurityByImage(securityByImage.value));

  const securityCleanCount = computed(() => securityCounts.value.clean);
  const securityIssueCount = computed(() => securityCounts.value.issues);
  const securityNotScannedCount = computed(() => securityCounts.value.notScanned);
  const securitySeverityTotals = computed(() => sumSecuritySeverityTotals(securityByImage.value));

  const showSecuritySeverityBreakdown = computed(() => {
    const totals = securitySeverityTotals.value;
    return totals.critical + totals.high + totals.medium + totals.low > 0;
  });

  const securityTotalCount = computed(() => securityByImage.value.length);

  const securityCleanArcLength = computed(() =>
    computeSecurityArcLength(securityCleanCount.value, securityTotalCount.value),
  );

  const securityIssueArcLength = computed(() =>
    computeSecurityArcLength(securityIssueCount.value, securityTotalCount.value),
  );

  const securityNotScannedArcLength = computed(() =>
    computeSecurityArcLength(securityNotScannedCount.value, securityTotalCount.value),
  );

  return {
    containerMetrics,
    updateContainers,
    securityCleanArcLength,
    securityCleanCount,
    securityIssueArcLength,
    securityIssueCount,
    securityNotScannedArcLength,
    securityNotScannedCount,
    securitySeverityTotals,
    securityTotalCount,
    showSecuritySeverityBreakdown,
  };
}

function getUpdatesStatColor(updatesAvailable: number, total: number): string {
  if (updatesAvailable === 0) {
    return 'var(--dd-success)';
  }
  const ratio = total > 0 ? updatesAvailable / total : 0;
  if (ratio >= 0.75) {
    return 'var(--dd-danger)';
  }
  if (ratio >= 0.5) {
    return 'var(--dd-warning)';
  }
  return 'var(--dd-caution)';
}

function getUpdatesStatMutedColor(updatesAvailable: number, total: number): string {
  if (updatesAvailable === 0) {
    return 'var(--dd-success-muted)';
  }
  const ratio = total > 0 ? updatesAvailable / total : 0;
  if (ratio >= 0.75) {
    return 'var(--dd-danger-muted)';
  }
  if (ratio >= 0.5) {
    return 'var(--dd-warning-muted)';
  }
  return 'var(--dd-caution-muted)';
}

function useStatsComputed(
  input: UseDashboardComputedInput,
  containerMetrics: ComputedRef<DashboardContainerMetrics>,
  securityTotalCount: ComputedRef<number>,
) {
  return computed<DashboardStatCard[]>(() => {
    const summary = input.containerSummary.value;
    const total = summary?.containers.total ?? containerMetrics.value.totalContainers;
    const running = summary?.containers.running ?? containerMetrics.value.runningContainers;
    const stopped = summary?.containers.stopped ?? Math.max(total - running, 0);
    const updatesAvailable = containerMetrics.value.updatesAvailable;
    const freshUpdates = containerMetrics.value.freshUpdates;
    const securityIssues = containerMetrics.value.securityIssueImageCount;
    const registryCount = input.registries.value.length;

    const updatesStatColor = getUpdatesStatColor(updatesAvailable, total);
    const updatesStatMutedColor = getUpdatesStatMutedColor(updatesAvailable, total);
    const securityStatColor =
      securityIssues > 0
        ? 'var(--dd-danger)'
        : securityTotalCount.value > 0
          ? 'var(--dd-success)'
          : 'var(--dd-neutral)';
    const securityStatMutedColor =
      securityIssues > 0
        ? 'var(--dd-danger-muted)'
        : securityTotalCount.value > 0
          ? 'var(--dd-success-muted)'
          : 'var(--dd-neutral-muted)';

    return [
      {
        id: 'stat-containers',
        label: 'Containers',
        value: String(total),
        icon: 'containers',
        color: 'var(--dd-primary)',
        colorMuted: 'var(--dd-primary-muted)',
        route: ROUTES.CONTAINERS,
        detail: `${running} running · ${stopped} stopped`,
      },
      {
        id: 'stat-updates',
        label: 'Updates Available',
        value: String(updatesAvailable),
        icon: 'updates',
        color: updatesStatColor,
        colorMuted: updatesStatMutedColor,
        route: { path: ROUTES.CONTAINERS, query: { filterKind: FILTER_KIND_ANY } },
        detail:
          freshUpdates > 0
            ? `${freshUpdates} new · ${updatesAvailable - freshUpdates} mature`
            : undefined,
      },
      {
        id: 'stat-security',
        label: 'Security Issues',
        value: String(securityIssues),
        icon: 'security',
        color: securityStatColor,
        colorMuted: securityStatMutedColor,
        route: ROUTES.SECURITY,
      },
      {
        id: 'stat-registries',
        label: 'Registries',
        value: String(registryCount),
        icon: 'registries',
        color: 'var(--dd-primary)',
        colorMuted: 'var(--dd-primary-muted)',
        route: ROUTES.REGISTRIES,
      },
    ];
  });
}

function isPendingRecentUpdateContainer(container: Container): boolean {
  return (
    container.updateOperation?.status === 'queued' ||
    container.updateOperation?.status === 'in-progress' ||
    !!container.newTag ||
    !!container.updatePolicyState
  );
}

interface PendingRecentUpdateCandidateContext {
  containers: readonly Container[];
  recentStatusByContainer: Record<string, RecentAuditStatus>;
  recentStatusByIdentity: Record<string, RecentAuditStatus>;
  containerNameCounts: ReadonlyMap<string, number>;
}

function toPendingRecentUpdateCandidate(
  container: Container,
  context: PendingRecentUpdateCandidateContext,
  blocked: boolean,
): PendingRecentUpdateCandidate {
  const batchId = container.updateOperation?.batchId;
  const queuePosition = container.updateOperation?.queuePosition;
  const queueTotal = container.updateOperation?.queueTotal;

  return {
    detectedAt: parseDetectedAt(container.updateDetectedAt),
    row: {
      id: container.id,
      identityKey: container.identityKey,
      name: container.name,
      image: container.image,
      icon: container.icon,
      oldVer: deriveCurrentVersion(container),
      newVer: deriveRecentUpdateVersion(container),
      releaseLink: container.releaseLink,
      status: deriveRecentUpdateStatus(
        container,
        context.containers,
        context.recentStatusByContainer,
        context.recentStatusByIdentity,
        context.containerNameCounts,
      ),
      updateKind: container.updateKind ?? null,
      running: container.status === 'running',
      registryError: undefined,
      blocked,
      ...(batchId && queuePosition && queueTotal && queuePosition <= queueTotal
        ? {
            batchId,
            queuePosition,
            queueTotal,
          }
        : {}),
    },
  };
}

const containerNameCountsCache = new WeakMap<readonly Container[], Map<string, number>>();

function buildContainerNameCounts(containers: readonly Container[]): Map<string, number> {
  const cached = containerNameCountsCache.get(containers);
  if (cached !== undefined) {
    return cached;
  }
  const counts = new Map<string, number>();
  for (const container of containers) {
    counts.set(container.name, (counts.get(container.name) ?? 0) + 1);
  }
  containerNameCountsCache.set(containers, counts);
  return counts;
}

function buildRecentUpdateRows(
  visibleContainers: Container[],
  allContainers: Container[],
  recentStatusByContainer: Record<string, RecentAuditStatus>,
  recentStatusByIdentity: Record<string, RecentAuditStatus>,
): RecentUpdateRow[] {
  // Only show containers with actual available updates — registry failures
  // ("check failed") are surfaced elsewhere and should not appear in the
  // "Updates Available" widget (#186).
  const candidates: PendingRecentUpdateCandidate[] = [];
  const containerNameCounts = buildContainerNameCounts(allContainers);
  const candidateContext: PendingRecentUpdateCandidateContext = {
    containers: allContainers,
    recentStatusByContainer,
    recentStatusByIdentity,
    containerNameCounts,
  };
  for (const container of visibleContainers) {
    if (!isPendingRecentUpdateContainer(container)) {
      continue;
    }

    candidates.push(
      toPendingRecentUpdateCandidate(container, candidateContext, container.bouncer === 'blocked'),
    );
  }

  candidates.sort(comparePendingRecentUpdates);
  return candidates.map((candidate) => candidate.row);
}

function useRecentUpdatesComputed(
  updateContainers: ComputedRef<Container[]>,
  input: UseDashboardComputedInput,
) {
  return computed<RecentUpdateRow[]>(() =>
    buildRecentUpdateRows(
      updateContainers.value,
      input.containers.value,
      input.recentStatusByContainer.value,
      input.recentStatusByIdentity.value,
    ),
  );
}

function getContainerVulnerabilityTotal(container: Container): number {
  return container.securitySummary
    ? container.securitySummary.critical +
        container.securitySummary.high +
        container.securitySummary.medium +
        container.securitySummary.low
    : 0;
}

function compareVulnerableContainers(left: Container, right: Container): number {
  const leftTotal = getContainerVulnerabilityTotal(left);
  const rightTotal = getContainerVulnerabilityTotal(right);
  if (rightTotal !== leftTotal) {
    return rightTotal - leftTotal;
  }
  const leftCritical = left.securitySummary?.critical ?? 0;
  const rightCritical = right.securitySummary?.critical ?? 0;
  return rightCritical - leftCritical;
}

function toVulnerabilityRow(container: Container) {
  return {
    id: container.name,
    severity: container.bouncer === 'blocked' ? 'CRITICAL' : 'HIGH',
    package: container.image,
    image: container.name,
  };
}

function useVulnerabilitiesComputed(input: UseDashboardComputedInput) {
  return computed(() => {
    return input.containers.value
      .filter((container) => container.bouncer === 'blocked' || container.bouncer === 'unsafe')
      .sort(compareVulnerableContainers)
      .slice(0, 5)
      .map(toVulnerabilityRow);
  });
}

function buildServerContainerCounts(containers: Container[]): Map<string, ServerContainerCounts> {
  const countsByServer = new Map<string, ServerContainerCounts>();

  for (const container of containers) {
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

  return countsByServer;
}

function deriveWatcherServerName(watcherName: string): string {
  if (watcherName === 'local') {
    return 'Local';
  }
  return watcherName.charAt(0).toUpperCase() + watcherName.slice(1);
}

function deriveWatcherHost(watcher: unknown): string {
  const configuration = getWatcherConfiguration(watcher);
  const socket = configuration.socket;
  if (typeof socket === 'string' && socket) {
    return `unix://${socket}`;
  }
  const host = typeof configuration.host === 'string' ? configuration.host : '';
  const port = typeof configuration.port === 'number' ? configuration.port : undefined;
  const protocol = typeof configuration.protocol === 'string' ? configuration.protocol : '';
  if (host) {
    return port ? `${protocol || 'http'}://${host}:${port}` : host;
  }
  return 'unix:///var/run/docker.sock';
}

function isNonAgentWatcher(watcher: unknown): boolean {
  return (
    !!watcher &&
    typeof watcher === 'object' &&
    !('agent' in watcher && (watcher as Record<string, unknown>).agent)
  );
}

function toServerContainerCounts(
  countsByServer: Map<string, ServerContainerCounts>,
  serverName: string,
): ServerContainerCounts {
  return countsByServer.get(serverName) ?? { running: 0, total: 0 };
}

function toWatcherServerRow(
  watcher: unknown,
  countsByServer: Map<string, ServerContainerCounts>,
): DashboardServerRow {
  const watcherRecord = watcher as Record<string, unknown>;
  const rawName = typeof watcherRecord.name === 'string' ? watcherRecord.name : 'local';
  const serverName = deriveWatcherServerName(rawName);
  const counts = toServerContainerCounts(countsByServer, serverName);

  return {
    name: serverName,
    host: deriveWatcherHost(watcher),
    status: 'connected',
    containers: {
      running: counts.running,
      total: counts.total,
    },
  };
}

function toLocalServerRow(countsByServer: Map<string, ServerContainerCounts>): DashboardServerRow {
  const localContainerCounts = toServerContainerCounts(countsByServer, 'Local');

  return {
    name: 'Local',
    host: 'unix:///var/run/docker.sock',
    status: 'connected',
    containers: {
      running: localContainerCounts.running,
      total: localContainerCounts.total,
    },
  };
}

function toAgentServerRow(
  agent: DashboardAgent,
  countsByServer: Map<string, ServerContainerCounts>,
): DashboardServerRow {
  const agentName =
    typeof agent.name === 'string' && agent.name.length > 0 ? agent.name : 'unknown-agent';
  const agentContainerCounts = toServerContainerCounts(countsByServer, agentName);

  return {
    name: agentName,
    host: formatAgentHost(agent),
    status: agent.connected ? 'connected' : 'disconnected',
    containers: {
      running: agentContainerCounts.running,
      total: agentContainerCounts.total,
    },
  };
}

function buildWatcherServerRows(
  watchers: unknown[],
  countsByServer: Map<string, ServerContainerCounts>,
): DashboardServerRow[] {
  const nonAgentWatchers = watchers.filter(isNonAgentWatcher);
  if (nonAgentWatchers.length > 0) {
    return nonAgentWatchers.map((watcher) => toWatcherServerRow(watcher, countsByServer));
  }

  return [toLocalServerRow(countsByServer)];
}

function buildAgentServerRows(
  agents: DashboardAgent[],
  countsByServer: Map<string, ServerContainerCounts>,
): DashboardServerRow[] {
  return agents.map((agent) => toAgentServerRow(agent, countsByServer));
}

function useServersComputed(input: UseDashboardComputedInput) {
  return computed<DashboardServerRow[]>(() => {
    const countsByServer = buildServerContainerCounts(input.containers.value);
    const watcherRows = buildWatcherServerRows(input.watchers.value, countsByServer);
    const agentRows = buildAgentServerRows(input.agents.value, countsByServer);
    return watcherRows.concat(agentRows);
  });
}

function buildUpdateKindCounts(containers: Container[]): Record<UpdateKind, number> {
  const counts: Record<UpdateKind, number> = {
    major: 0,
    minor: 0,
    patch: 0,
    digest: 0,
  };

  for (const container of containers) {
    if (container.updateKind) {
      counts[container.updateKind] += 1;
    }
  }

  return counts;
}

function useUpdateBreakdownComputed(updateContainers: ComputedRef<Container[]>) {
  const updateBreakdownBuckets = computed<UpdateBreakdownBucket[]>(() => {
    const counts = buildUpdateKindCounts(updateContainers.value);
    return UPDATE_BREAKDOWN_BUCKETS.map((bucket) => ({
      ...bucket,
      count: counts[bucket.kind],
    }));
  });

  const totalUpdates = computed(
    () => updateContainers.value.filter((container) => container.updateKind).length,
  );

  return {
    totalUpdates,
    updateBreakdownBuckets,
  };
}

export function useDashboardComputed(input: UseDashboardComputedInput) {
  const { maintenanceCountdownLabel, maintenanceWindowWatchers, nextMaintenanceWindowByWatcher } =
    useMaintenanceComputed(input);
  const {
    containerMetrics,
    updateContainers,
    securityCleanArcLength,
    securityCleanCount,
    securityIssueArcLength,
    securityIssueCount,
    securityNotScannedArcLength,
    securityNotScannedCount,
    securitySeverityTotals,
    securityTotalCount,
    showSecuritySeverityBreakdown,
  } = useSecurityComputed(input);
  const stats = useStatsComputed(input, containerMetrics, securityTotalCount);
  const recentUpdates = useRecentUpdatesComputed(updateContainers, input);
  const vulnerabilities = useVulnerabilitiesComputed(input);
  const servers = useServersComputed(input);
  const { totalUpdates, updateBreakdownBuckets } = useUpdateBreakdownComputed(updateContainers);

  return {
    DONUT_CIRCUMFERENCE,
    getRecentUpdateStatusColor,
    getRecentUpdateStatusIcon,
    getRecentUpdateStatusMutedColor,
    getUpdateKindColor,
    getUpdateKindIcon,
    getUpdateKindMutedColor,
    maintenanceCountdownLabel,
    maintenanceWindowWatchers,
    nextMaintenanceWindowByWatcher,
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
  };
}
