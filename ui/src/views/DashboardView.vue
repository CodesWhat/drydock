<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { type RouteLocationRaw, useRouter } from 'vue-router';
import { preferences } from '../preferences/store';
import { getAgents } from '../services/agent';
import { getAuditLog } from '../services/audit';
import { getAllContainers } from '../services/container';
import { getAllRegistries } from '../services/registry';
import { getServer } from '../services/server';
import { getAllWatchers } from '../services/watcher';
import type { ApiWatcherConfiguration } from '../types/api';
import type { Container } from '../types/container';
import { mapApiContainers } from '../utils/container-mapper';
import {
  buildDashboardContainerMetrics,
  type ImageSecurityAggregate,
} from '../utils/dashboard-container-metrics';
import { errorMessage } from '../utils/error';

const router = useRouter();

function navigateTo(route: RouteLocationRaw) {
  router.push(route);
}

const DASHBOARD_REALTIME_REFRESH_DEBOUNCE_MS = 1_000;
const DASHBOARD_WIDGET_IDS = [
  'stat-containers',
  'stat-updates',
  'stat-security',
  'stat-registries',
  'recent-updates',
  'security-overview',
  'host-status',
  'update-breakdown',
] as const;
type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value);
}

function sanitizeWidgetOrder(rawOrder: unknown): DashboardWidgetId[] {
  if (!Array.isArray(rawOrder)) {
    return [...DASHBOARD_WIDGET_IDS];
  }

  const seen = new Set<DashboardWidgetId>();
  const normalized: DashboardWidgetId[] = [];
  for (const value of rawOrder) {
    if (!isDashboardWidgetId(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }

  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!seen.has(id)) {
      normalized.push(id);
    }
  }

  return normalized;
}

// Loading and error state
const loading = ref(true);
const error = ref<string | null>(null);

// Raw data from APIs
const containers = ref<Container[]>([]);
interface DashboardServerInfo {
  configuration?: {
    webhook?: {
      enabled?: boolean;
    };
  };
}

interface DashboardAgent {
  name: string;
  connected: boolean;
  host?: string;
  port?: number | string;
}

const serverInfo = ref<DashboardServerInfo | null>(null);
const agents = ref<DashboardAgent[]>([]);
const watchers = ref<unknown[]>([]);
const registries = ref<unknown[]>([]);
type RecentAuditStatus = 'updated' | 'pending' | 'failed';
const recentStatusByContainer = ref<Record<string, RecentAuditStatus>>({});
const maintenanceCountdownNow = ref(Date.now());
let maintenanceCountdownTimer: ReturnType<typeof setInterval> | undefined;
let realtimeRefreshTimer: ReturnType<typeof setTimeout> | undefined;
const widgetOrder = ref<DashboardWidgetId[]>([...DASHBOARD_WIDGET_IDS]);
const draggedWidgetId = ref<DashboardWidgetId | null>(null);

function mapAuditActionToRecentStatus(action: unknown): RecentAuditStatus | null {
  if (action === 'update-applied') return 'updated';
  if (action === 'update-failed') return 'failed';
  if (action === 'update-available') return 'pending';
  return null;
}

function buildRecentStatusByContainer(entries: unknown): Record<string, RecentAuditStatus> {
  if (!Array.isArray(entries)) return {};
  const statusByContainer: Record<string, RecentAuditStatus> = {};
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const containerNameRaw = (entry as { containerName?: unknown }).containerName;
    const containerName = typeof containerNameRaw === 'string' ? containerNameRaw.trim() : '';
    if (!containerName || statusByContainer[containerName]) continue;
    const mappedStatus = mapAuditActionToRecentStatus((entry as { action?: unknown }).action);
    if (!mappedStatus) continue;
    statusByContainer[containerName] = mappedStatus;
  }
  return statusByContainer;
}

function loadWidgetOrder() {
  widgetOrder.value = sanitizeWidgetOrder(preferences.dashboard.widgetOrder);
}

function persistWidgetOrder(order: DashboardWidgetId[]) {
  preferences.dashboard.widgetOrder = [...order];
}

watch(widgetOrder, (order) => {
  persistWidgetOrder(order);
});

function widgetOrderIndex(widgetId: DashboardWidgetId) {
  const index = widgetOrder.value.indexOf(widgetId);
  return index >= 0 ? index : DASHBOARD_WIDGET_IDS.indexOf(widgetId);
}

function widgetOrderStyle(widgetId: DashboardWidgetId) {
  return {
    order: widgetOrderIndex(widgetId),
  };
}

function moveWidget(draggedId: DashboardWidgetId, targetId: DashboardWidgetId) {
  if (draggedId === targetId) {
    return;
  }

  const nextOrder = [...widgetOrder.value];
  const draggedIndex = nextOrder.indexOf(draggedId);
  const targetIndex = nextOrder.indexOf(targetId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return;
  }

  nextOrder.splice(draggedIndex, 1);
  nextOrder.splice(targetIndex, 0, draggedId);
  widgetOrder.value = nextOrder;
}

function onWidgetDragStart(widgetId: DashboardWidgetId, event: DragEvent) {
  draggedWidgetId.value = widgetId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', widgetId);
  }
}

function onWidgetDragOver(widgetId: DashboardWidgetId, event: DragEvent) {
  if (!draggedWidgetId.value || draggedWidgetId.value === widgetId) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onWidgetDrop(widgetId: DashboardWidgetId, event: DragEvent) {
  event.preventDefault();
  const transferWidgetId = event.dataTransfer?.getData('text/plain');
  const draggedId = isDashboardWidgetId(transferWidgetId)
    ? transferWidgetId
    : draggedWidgetId.value;
  if (!draggedId || draggedId === widgetId) {
    draggedWidgetId.value = null;
    return;
  }
  moveWidget(draggedId, widgetId);
  draggedWidgetId.value = null;
}

function onWidgetDragEnd() {
  draggedWidgetId.value = null;
}

function resetWidgetOrder() {
  widgetOrder.value = [...DASHBOARD_WIDGET_IDS];
}

interface DashboardRefreshOptions {
  background?: boolean;
}

async function fetchDashboardData(options: DashboardRefreshOptions = {}) {
  const background = options.background === true;
  const hasRenderedData =
    containers.value.length > 0 ||
    watchers.value.length > 0 ||
    registries.value.length > 0 ||
    agents.value.length > 0 ||
    serverInfo.value !== null;

  if (!background) {
    loading.value = true;
    error.value = null;
  }
  try {
    const [containersRes, serverRes, agentsRes, watchersRes, registriesRes, auditLogRes] =
      await Promise.all([
        getAllContainers(),
        getServer().catch(() => null),
        getAgents().catch(() => []),
        getAllWatchers().catch(() => []),
        getAllRegistries().catch(() => []),
        getAuditLog({ limit: 100 }).catch(() => ({ entries: [] })),
      ]);
    containers.value = mapApiContainers(containersRes);
    serverInfo.value = serverRes;
    agents.value = agentsRes;
    watchers.value = Array.isArray(watchersRes) ? watchersRes : [];
    registries.value = Array.isArray(registriesRes) ? registriesRes : [];

    const auditEntries = Array.isArray((auditLogRes as { entries?: unknown }).entries)
      ? (auditLogRes as { entries: unknown[] }).entries
      : [];
    recentStatusByContainer.value = buildRecentStatusByContainer(auditEntries);
    error.value = null;
  } catch (e: unknown) {
    if (!background || !hasRenderedData) {
      error.value = errorMessage(e, 'Failed to load dashboard data');
    } else {
      console.debug(errorMessage(e, 'Dashboard background refresh failed'));
    }
  } finally {
    if (!background) {
      loading.value = false;
    }
  }
}

function handleRealtimeRefresh() {
  if (realtimeRefreshTimer !== undefined) {
    clearTimeout(realtimeRefreshTimer);
  }
  realtimeRefreshTimer = window.setTimeout(() => {
    realtimeRefreshTimer = undefined;
    void fetchDashboardData({ background: true });
  }, DASHBOARD_REALTIME_REFRESH_DEBOUNCE_MS);
}

const realtimeRefreshListener = handleRealtimeRefresh as EventListener;

onMounted(async () => {
  loadWidgetOrder();
  globalThis.addEventListener('dd:sse-container-changed', realtimeRefreshListener);
  globalThis.addEventListener('dd:sse-scan-completed', realtimeRefreshListener);
  globalThis.addEventListener('dd:sse-connected', realtimeRefreshListener);
  maintenanceCountdownTimer = window.setInterval(() => {
    maintenanceCountdownNow.value = Date.now();
  }, 30_000);
  await fetchDashboardData();
});

onUnmounted(() => {
  globalThis.removeEventListener('dd:sse-container-changed', realtimeRefreshListener);
  globalThis.removeEventListener('dd:sse-scan-completed', realtimeRefreshListener);
  globalThis.removeEventListener('dd:sse-connected', realtimeRefreshListener);
  if (realtimeRefreshTimer !== undefined) {
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = undefined;
  }
  if (maintenanceCountdownTimer !== undefined) {
    clearInterval(maintenanceCountdownTimer);
    maintenanceCountdownTimer = undefined;
  }
});

function getWatcherConfiguration(watcher: Record<string, unknown>): ApiWatcherConfiguration {
  if (watcher?.configuration && typeof watcher.configuration === 'object') {
    return watcher.configuration as ApiWatcherConfiguration;
  }
  if (watcher?.config && typeof watcher.config === 'object') {
    return watcher.config as ApiWatcherConfiguration;
  }
  return {};
}

const maintenanceWindowWatchers = computed(() =>
  watchers.value.filter((watcher) => {
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

function formatMaintenanceDuration(durationMs: number): string {
  const totalMinutes = Math.max(1, Math.ceil(durationMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

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
  const remainingMs = nextMaintenanceWindowAt.value - maintenanceCountdownNow.value;
  if (remainingMs <= 0) {
    return 'Opening soon';
  }
  return formatMaintenanceDuration(remainingMs);
});

const containerMetrics = computed(() => buildDashboardContainerMetrics(containers.value));
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

// Computed: stat cards
const stats = computed(() => {
  const {
    totalContainers: total,
    runningContainers: running,
    updatesAvailable,
    securityIssueImageCount: securityIssues,
  } = containerMetrics.value;

  const stopped = Math.max(total - running, 0);
  const registryCount = registries.value.length;
  return [
    {
      id: 'stat-containers' as DashboardWidgetId,
      label: 'Containers',
      value: String(total),
      icon: 'containers',
      color: 'var(--dd-primary)',
      colorMuted: 'var(--dd-primary-muted)',
      route: '/containers',
      detail: `${running} running · ${stopped} stopped`,
    },
    {
      id: 'stat-updates' as DashboardWidgetId,
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
      id: 'stat-security' as DashboardWidgetId,
      label: 'Security Issues',
      value: String(securityIssues),
      icon: 'security',
      color: securityIssues > 0 ? 'var(--dd-danger)' : 'var(--dd-success)',
      colorMuted: securityIssues > 0 ? 'var(--dd-danger-muted)' : 'var(--dd-success-muted)',
      route: '/security',
    },
    {
      id: 'stat-registries' as DashboardWidgetId,
      label: 'Registries',
      value: String(registryCount),
      icon: 'registries',
      color: 'var(--dd-primary)',
      colorMuted: 'var(--dd-primary-muted)',
      route: '/registries',
    },
  ];
});

interface RecentUpdateRow {
  id: string;
  name: string;
  image: string;
  icon: string;
  oldVer: string;
  newVer: string;
  releaseLink?: string;
  status: 'updated' | 'pending' | 'failed' | 'error' | 'snoozed' | 'skipped';
  running: boolean;
  registryError?: string;
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

function deriveRecentUpdateStatus(container: Container): RecentUpdateRow['status'] {
  if (container.updatePolicyState === 'snoozed') {
    return 'snoozed';
  }
  if (container.updatePolicyState === 'skipped') {
    return 'skipped';
  }
  return recentStatusByContainer.value[container.name] ?? 'pending';
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

// Computed: recent updates + registry-check failures
const recentUpdates = computed<RecentUpdateRow[]>(() => {
  const registryFailures = containers.value
    .filter((c) => !c.newTag && !!c.registryError)
    .map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image,
      icon: c.icon,
      oldVer: c.currentTag,
      newVer: 'check failed',
      releaseLink: undefined,
      status: 'error' as const,
      running: c.status === 'running',
      registryError: c.registryError,
    }));

  const pendingUpdates = containers.value
    .filter((c) => !!c.newTag || !!c.updatePolicyState)
    .slice()
    .sort((a, b) => {
      const byDetectedAt =
        parseDetectedAt(b.updateDetectedAt) - parseDetectedAt(a.updateDetectedAt);
      if (byDetectedAt !== 0) return byDetectedAt;
      return a.name.localeCompare(b.name);
    })
    .map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image,
      icon: c.icon,
      oldVer: c.currentTag,
      newVer: deriveRecentUpdateVersion(c),
      releaseLink: c.releaseLink,
      status: deriveRecentUpdateStatus(c),
      running: c.status === 'running',
      registryError: undefined,
    }));

  return [...registryFailures, ...pendingUpdates].slice(0, 6);
});

// Computed: security vulnerabilities (containers flagged by bouncer)
const vulnerabilities = computed(() => {
  return containers.value
    .filter((c) => c.bouncer === 'blocked' || c.bouncer === 'unsafe')
    .slice(0, 5)
    .map((c) => ({
      id: c.name,
      severity: c.bouncer === 'blocked' ? 'CRITICAL' : 'HIGH',
      package: c.image,
      image: c.name,
    }));
});

// Computed: servers list (local server + agents)
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

const servers = computed(() => {
  const list: Array<{
    name: string;
    host?: string;
    status: 'connected' | 'disconnected';
    statusLabel?: string;
    containers: { running: number; total: number };
  }> = [];

  // Local server is always present
  const localContainers = containers.value.filter((c) => c.server === 'Local');
  list.push({
    name: 'Local',
    host: 'unix:///var/run/docker.sock',
    status: 'connected',
    containers: {
      running: localContainers.filter((c) => c.status === 'running').length,
      total: localContainers.length,
    },
  });

  // Add agents as remote hosts
  for (const agent of agents.value) {
    const agentName =
      typeof agent.name === 'string' && agent.name.length > 0 ? agent.name : 'unknown-agent';
    const agentContainers = containers.value.filter((c) => c.server === agentName);
    list.push({
      name: agentName,
      host: formatAgentHost(agent),
      status: agent.connected ? 'connected' : 'disconnected',
      containers: {
        running: agentContainers.filter((c) => c.status === 'running').length,
        total: agentContainers.length,
      },
    });
  }

  return list;
});

// Computed: security donut chart data
const DONUT_CIRCUMFERENCE = 301.6;
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

// Total containers with any update for breakdown bar scaling
const totalUpdates = computed(() => containers.value.filter((c) => c.updateKind).length);
</script>

<template>
  <div class="flex-1 min-h-0 min-w-0 overflow-y-auto pr-1 sm:pr-2">
      <!-- LOADING STATE -->
      <div v-if="loading" class="flex items-center justify-center py-16">
        <div class="text-sm dd-text-muted">Loading dashboard...</div>
      </div>

      <!-- ERROR STATE -->
      <div v-else-if="error" class="flex flex-col items-center justify-center py-16">
        <div class="text-sm font-medium dd-text-danger mb-2">Failed to load dashboard</div>
        <div class="text-xs dd-text-muted">{{ error }}</div>
        <button
          class="mt-4 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-bg-elevated dd-text hover:opacity-90"
          @click="fetchDashboardData">
          Retry
        </button>
      </div>

      <template v-else>
      <!-- STAT CARDS -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <component
          :is="stat.route ? 'button' : 'div'"
          v-for="stat in stats"
          :key="stat.id"
          :data-widget-id="stat.id"
          :data-widget-order="widgetOrderIndex(stat.id)"
          draggable="true"
          :aria-label="stat.label + ': ' + stat.value"
          :type="stat.route ? 'button' : undefined"
          class="stat-card dd-rounded p-4 text-left w-full"
          :class="[
            stat.route ? 'cursor-pointer transition-colors hover:dd-bg-elevated' : '',
            { 'opacity-60': draggedWidgetId === stat.id },
          ]"
          :style="{
            ...widgetOrderStyle(stat.id),
            backgroundColor: 'var(--dd-bg-card)',
            borderTop: '1px solid var(--dd-border-strong)',
            borderRight: '1px solid var(--dd-border-strong)',
            borderBottom: '1px solid var(--dd-border-strong)',
            borderLeft: `4px solid ${stat.color}`,
          }"
          @click="stat.route && navigateTo(stat.route)"
          @dragstart="onWidgetDragStart(stat.id, $event)"
          @dragover="onWidgetDragOver(stat.id, $event)"
          @drop="onWidgetDrop(stat.id, $event)"
          @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-medium uppercase tracking-wider dd-text-muted">
              {{ stat.label }}
            </span>
            <div class="w-9 h-9 dd-rounded flex items-center justify-center"
                 :style="{ backgroundColor: stat.colorMuted, color: stat.color }">
              <AppIcon :name="stat.icon" :size="20" />
            </div>
          </div>
          <div class="text-2xl font-bold dd-text">
            {{ stat.value }}
          </div>
          <div v-if="stat.detail" class="mt-1 text-[10px] font-medium dd-text-muted">
            {{ stat.detail }}
          </div>
        </component>
      </div>

      <!-- WIDGET GRID -->
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 min-w-0">

        <!-- Recent Updates Widget (2/3) -->
        <div
             data-widget-id="recent-updates"
             :data-widget-order="widgetOrderIndex('recent-updates')"
             draggable="true"
             aria-label="Updates Available widget"
             class="dashboard-widget xl:col-span-2 dd-rounded overflow-hidden min-w-0"
             :class="{ 'opacity-60': draggedWidgetId === 'recent-updates' }"
             :style="{
               ...widgetOrderStyle('recent-updates'),
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }"
             @dragstart="onWidgetDragStart('recent-updates', $event)"
             @dragover="onWidgetDragOver('recent-updates', $event)"
             @drop="onWidgetDrop('recent-updates', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="recent-updates" :size="14" class="text-drydock-secondary" />
              <h2 class="text-xs font-semibold dd-text">
                Updates Available
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo({ path: '/containers', query: { filterKind: 'any' } })">View all &rarr;</button>
          </div>

          <div>
            <table class="w-full text-xs table-fixed">
              <thead>
                <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <th class="w-10 px-0 py-2.5" />
                  <th class="text-left px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Container</th>
                  <th class="text-center px-2 sm:px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Version</th>
                  <th class="w-10 sm:w-auto text-center px-1 sm:px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">
                    <span class="hidden sm:inline">Status</span>
                    <span class="sm:hidden inline-flex items-center justify-center"><AppIcon name="info" :size="12" /></span>
                  </th>
                </tr>
              </thead>
            </table>
            <div class="sm:overflow-y-auto sm:max-h-[340px]">
            <table class="w-full text-xs table-fixed">
              <tbody>
                <tr v-for="(row, i) in recentUpdates" :key="row.id"
                    :data-update-status="row.status"
                    class="transition-colors hover:dd-bg-elevated"
                    :style="{ borderBottom: i < recentUpdates.length - 1 ? '1px solid var(--dd-border-strong)' : 'none' }">
                  <td class="w-12 px-0 py-3">
                    <div class="flex items-center justify-center">
                      <ContainerIcon :icon="row.icon" :size="28" />
                    </div>
                  </td>
                  <td class="px-3 py-3 align-middle">
                    <div class="font-medium dd-text leading-tight">{{ row.name }}</div>
                    <div class="text-[10px] dd-text-muted mt-0.5 truncate">{{ row.image }}</div>
                    <div v-if="row.registryError" class="text-[10px] mt-0.5 truncate" style="color: var(--dd-danger);">
                      {{ row.registryError }}
                    </div>
                    <a
                      v-if="row.releaseLink"
                      :href="row.releaseLink"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-[10px] mt-0.5 inline-flex underline hover:no-underline"
                      style="color: var(--dd-info);"
                    >
                      Release notes
                    </a>
                  </td>
                  <td class="px-2 sm:px-5 py-3 align-middle overflow-hidden">
                    <!-- Desktop: horizontal old → new -->
                    <div class="hidden sm:flex items-center justify-center gap-1.5 min-w-0">
                      <span class="text-[11px] dd-text-secondary truncate max-w-[100px]" v-tooltip.top="row.oldVer">
                        {{ row.oldVer }}
                      </span>
                      <AppIcon name="arrow-right" :size="8" class="dd-text-muted shrink-0" />
                      <span class="text-[11px] font-semibold truncate max-w-[120px]"
                            :style="{ color: getRecentUpdateStatusColor(row.status) }">
                        {{ row.newVer }}
                      </span>
                    </div>
                    <!-- Mobile: stacked old ↓ new -->
                    <div class="flex sm:hidden flex-col items-start gap-0.5 min-w-0">
                      <span class="text-[9px] dd-text-secondary break-all leading-tight">
                        {{ row.oldVer }}
                      </span>
                      <AppIcon name="chevron-down" :size="7" class="dd-text-muted shrink-0 self-center" />
                      <span class="text-[9px] font-semibold break-all leading-tight"
                            :style="{ color: getRecentUpdateStatusColor(row.status) }">
                        {{ row.newVer }}
                      </span>
                    </div>
                  </td>
                  <td class="px-1 sm:px-5 py-3 text-center align-middle">
                    <span class="badge px-1.5 py-0 text-[9px] md:!hidden"
                          :style="{
                            backgroundColor: getRecentUpdateStatusMutedColor(row.status),
                            color: getRecentUpdateStatusColor(row.status),
                          }">
                      <AppIcon :name="getRecentUpdateStatusIcon(row.status)" :size="12" />
                    </span>
                    <span class="badge max-md:!hidden"
                          :style="{
                            backgroundColor: getRecentUpdateStatusMutedColor(row.status),
                            color: getRecentUpdateStatusColor(row.status),
                          }">
                      <AppIcon :name="getRecentUpdateStatusIcon(row.status)"
                         :size="12" class="mr-1" />
                      {{ row.status }}
                    </span>
                  </td>
                </tr>
                <tr v-if="recentUpdates.length === 0">
                  <td colspan="4" class="px-4 py-6 text-center text-[11px] dd-text-muted">
                    No updates available
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <!-- Security Summary Widget (1/3) -->
        <div
             data-widget-id="security-overview"
             :data-widget-order="widgetOrderIndex('security-overview')"
             draggable="true"
             aria-label="Security Overview widget"
             class="dashboard-widget dd-rounded overflow-hidden"
             :class="{ 'opacity-60': draggedWidgetId === 'security-overview' }"
             :style="{
               ...widgetOrderStyle('security-overview'),
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }"
             @dragstart="onWidgetDragStart('security-overview', $event)"
             @dragover="onWidgetDragOver('security-overview', $event)"
             @drop="onWidgetDrop('security-overview', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="security" :size="14" class="text-drydock-accent" />
              <h2 class="text-xs font-semibold dd-text">
                Security Overview
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo('/security')">View all &rarr;</button>
          </div>

          <div class="p-5">
            <!-- Donut chart -->
            <div class="flex items-center justify-center mb-5">
              <div class="relative" style="width: 140px; height: 140px;">
                <svg viewBox="0 0 120 120" class="w-full h-full" style="transform: rotate(-90deg);">
                  <circle cx="60" cy="60" r="48" fill="none"
                          stroke="var(--dd-border-strong)" stroke-width="14" />
                  <circle cx="60" cy="60" r="48" fill="none" stroke="var(--dd-success)" stroke-width="14"
                          stroke-linecap="round" class="donut-ring"
                          :stroke-dasharray="securityCleanArcLength + ' ' + DONUT_CIRCUMFERENCE" />
                  <circle v-if="securityIssueCount > 0" cx="60" cy="60" r="48" fill="none" stroke="var(--dd-danger)" stroke-width="14"
                          stroke-linecap="round" class="donut-ring"
                          :stroke-dasharray="securityIssueArcLength + ' ' + DONUT_CIRCUMFERENCE"
                          :stroke-dashoffset="-securityCleanArcLength" />
                  <circle v-if="securityNotScannedCount > 0" cx="60" cy="60" r="48" fill="none" stroke="var(--dd-neutral)" stroke-width="14"
                          stroke-linecap="round" class="donut-ring"
                          :stroke-dasharray="securityNotScannedArcLength + ' ' + DONUT_CIRCUMFERENCE"
                          :stroke-dashoffset="-(securityCleanArcLength + securityIssueArcLength)" />
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center">
                  <span class="text-xl font-bold dd-text">{{ securityTotalCount }}</span>
                  <span class="text-[10px] dd-text-muted">images</span>
                </div>
              </div>
            </div>

            <!-- Legend -->
            <div class="flex justify-center gap-5 mb-5">
              <div class="flex items-center gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-success);" />
                <span class="text-[11px] dd-text-secondary">{{ securityCleanCount }} Clean</span>
              </div>
              <div v-if="securityIssueCount > 0" class="flex items-center gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-danger);" />
                <span class="text-[11px] dd-text-secondary">{{ securityIssueCount }} Issues</span>
              </div>
              <div v-if="securityNotScannedCount > 0" class="flex items-center gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-neutral);" />
                <span class="text-[11px] dd-text-secondary">
                  {{ securityNotScannedCount }} Not Scanned
                </span>
              </div>
            </div>

            <div v-if="showSecuritySeverityBreakdown"
                 data-test="security-severity-breakdown"
                 class="mb-5">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">
                Severity Breakdown
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-danger-muted)' }">
                  <span class="text-[10px] font-semibold" style="color: var(--dd-danger);">
                    {{ securitySeverityTotals.critical }} Critical
                  </span>
                </div>
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-warning-muted)' }">
                  <span class="text-[10px] font-semibold" style="color: var(--dd-warning);">
                    {{ securitySeverityTotals.high }} High
                  </span>
                </div>
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-caution-muted)' }">
                  <span class="text-[10px] font-semibold" style="color: var(--dd-caution);">
                    {{ securitySeverityTotals.medium }} Medium
                  </span>
                </div>
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-info-muted)' }">
                  <span class="text-[10px] font-semibold" style="color: var(--dd-info);">
                    {{ securitySeverityTotals.low }} Low
                  </span>
                </div>
              </div>
            </div>

            <div class="mb-4" :style="{ borderTop: '1px solid var(--dd-border-strong)' }" />

            <!-- Top vulnerabilities -->
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-3 dd-text-muted">
              Top Vulnerabilities
            </div>
            <div class="space-y-2.5">
              <div v-for="vuln in vulnerabilities" :key="vuln.id"
                   class="flex items-start gap-3 p-2.5 dd-rounded"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <div class="shrink-0 mt-0.5">
                  <span class="badge px-1.5 py-0 text-[9px] md:!hidden"
                        :style="{
                          backgroundColor: vuln.severity === 'CRITICAL'
                            ? 'var(--dd-danger-muted)'
                            : 'var(--dd-warning-muted)',
                          color: vuln.severity === 'CRITICAL' ? 'var(--dd-danger)' : 'var(--dd-warning)',
                        }">
                    <AppIcon :name="vuln.severity === 'CRITICAL' ? 'warning' : 'chevrons-up'" :size="12" />
                  </span>
                  <span class="badge text-[9px] max-md:!hidden"
                        :style="{
                          backgroundColor: vuln.severity === 'CRITICAL'
                            ? 'var(--dd-danger-muted)'
                            : 'var(--dd-warning-muted)',
                          color: vuln.severity === 'CRITICAL' ? 'var(--dd-danger)' : 'var(--dd-warning)',
                        }">
                    {{ vuln.severity }}
                  </span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-[11px] font-semibold truncate dd-text">
                    {{ vuln.id }}
                  </div>
                  <div class="text-[10px] mt-0.5 truncate dd-text-muted">
                    {{ vuln.package }} &middot; {{ vuln.image }}
                  </div>
                </div>
              </div>
              <div v-if="vulnerabilities.length === 0"
                   class="p-2.5 dd-rounded text-[11px] text-center dd-text-muted"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                No vulnerabilities reported
              </div>
            </div>
          </div>
        </div>

        <!-- Host Status Widget (1/3) -->
        <div
             data-widget-id="host-status"
             :data-widget-order="widgetOrderIndex('host-status')"
             draggable="true"
             aria-label="Host Status widget"
             class="dashboard-widget dd-rounded overflow-hidden"
             :class="{ 'opacity-60': draggedWidgetId === 'host-status' }"
             :style="{
               ...widgetOrderStyle('host-status'),
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }"
             @dragstart="onWidgetDragStart('host-status', $event)"
             @dragover="onWidgetDragOver('host-status', $event)"
             @drop="onWidgetDrop('host-status', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="servers" :size="14" class="text-drydock-secondary" />
              <h2 class="text-sm font-semibold dd-text">
                Host Status
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo('/servers')">View all &rarr;</button>
          </div>

          <div class="p-4 space-y-3">
            <div v-for="server in servers" :key="server.name"
                 class="flex items-center gap-3 p-3 dd-rounded cursor-pointer transition-colors hover:dd-bg-elevated"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
                 @click="navigateTo('/servers')">
              <span class="badge px-1.5 py-0 text-[9px] max-md:!hidden"
                    :style="{
                      backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                <AppIcon :name="server.status === 'connected' ? 'check' : 'xmark'" :size="12" />
              </span>
              <div class="flex-1 min-w-0">
                <div class="text-[12px] font-semibold truncate dd-text">{{ server.name }}</div>
                <div v-if="server.host" class="text-[10px] font-mono dd-text-muted truncate mt-0.5">
                  {{ server.host }}
                </div>
                <div class="text-[10px] dd-text-muted">{{ server.containers.running }}/{{ server.containers.total }} containers</div>
              </div>
              <span class="badge px-1.5 py-0 text-[9px] md:!hidden"
                    :style="{
                      backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                <AppIcon :name="server.status === 'connected' ? 'check' : 'xmark'" :size="12" />
              </span>
              <span class="badge text-[9px] uppercase font-bold max-md:!hidden"
                    :style="{
                      backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                {{ server.statusLabel ?? server.status }}
              </span>
            </div>
          </div>
        </div>

        <!-- Update Breakdown Widget (2/3) -->
        <div
             data-widget-id="update-breakdown"
             :data-widget-order="widgetOrderIndex('update-breakdown')"
             draggable="true"
             aria-label="Update Breakdown widget"
             class="dashboard-widget xl:col-span-2 dd-rounded overflow-hidden"
             :class="{ 'opacity-60': draggedWidgetId === 'update-breakdown' }"
             :style="{
               ...widgetOrderStyle('update-breakdown'),
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }"
             @dragstart="onWidgetDragStart('update-breakdown', $event)"
             @dragover="onWidgetDragOver('update-breakdown', $event)"
             @drop="onWidgetDrop('update-breakdown', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="updates" :size="14" class="text-drydock-secondary" />
              <h2 class="text-sm font-semibold dd-text">
                Update Breakdown
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo({ path: '/containers', query: { filterKind: 'any' } })">View all &rarr;</button>
          </div>

          <div class="p-5">
            <div v-if="totalUpdates === 0"
                 class="p-3 dd-rounded text-[11px] text-center dd-text-muted"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              No updates to categorize
            </div>
            <div v-else class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div v-for="kind in [
                { label: 'Major', count: containers.filter(c => c.updateKind === 'major').length, color: 'var(--dd-danger)', colorMuted: 'var(--dd-danger-muted)', icon: 'chevrons-up' },
                { label: 'Minor', count: containers.filter(c => c.updateKind === 'minor').length, color: 'var(--dd-warning)', colorMuted: 'var(--dd-warning-muted)', icon: 'chevron-up' },
                { label: 'Patch', count: containers.filter(c => c.updateKind === 'patch').length, color: 'var(--dd-primary)', colorMuted: 'var(--dd-primary-muted)', icon: 'hashtag' },
                { label: 'Digest', count: containers.filter(c => c.updateKind === 'digest').length, color: 'var(--dd-neutral)', colorMuted: 'var(--dd-neutral-muted)', icon: 'fingerprint' },
              ]" :key="kind.label"
                   class="text-center p-3 dd-rounded"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <div class="w-9 h-9 mx-auto dd-rounded flex items-center justify-center mb-2"
                     :style="{ backgroundColor: kind.colorMuted, color: kind.color }">
                  <AppIcon :name="kind.icon" :size="20" />
                </div>
                <div class="text-xl font-bold dd-text">{{ kind.count }}</div>
                <div class="text-[10px] font-medium uppercase tracking-wider mt-0.5 dd-text-muted">{{ kind.label }}</div>
                <!-- Mini bar -->
                <div class="mt-2 h-1.5 dd-rounded-sm overflow-hidden" style="background: var(--dd-bg-elevated);">
                  <div class="h-full dd-rounded-sm transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                       :style="{ width: Math.max(kind.count / Math.max(totalUpdates, 1) * 100, 4) + '%', backgroundColor: kind.color }" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </template>
  </div>
</template>
