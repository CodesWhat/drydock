import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getAgents } from '../../services/agent';
import {
  getAllContainers,
  getContainerRecentStatus,
  getContainerSummary,
} from '../../services/container';
import { getAllRegistries } from '../../services/registry';
import { getServer } from '../../services/server';
import { getAllWatchers } from '../../services/watcher';
import type { ApiWatcherConfiguration } from '../../types/api';
import type { Container } from '../../types/container';
import { mapApiContainers } from '../../utils/container-mapper';
import { errorMessage } from '../../utils/error';
import type {
  DashboardAgent,
  DashboardContainerSummary,
  DashboardServerInfo,
  RecentAuditStatus,
} from './dashboardTypes';

const DASHBOARD_REALTIME_REFRESH_DEBOUNCE_MS = 1_000;

interface DashboardRefreshOptions {
  background?: boolean;
}

type RealtimeRefreshMode = 'summary' | 'full';

function normalizeRecentStatusByContainer(response: unknown): Record<string, RecentAuditStatus> {
  if (!response || typeof response !== 'object') return {};
  const statusesData = (response as { statuses?: unknown }).statuses;
  if (!statusesData || typeof statusesData !== 'object' || Array.isArray(statusesData)) return {};

  const normalizedStatuses: Record<string, RecentAuditStatus> = {};
  for (const [containerNameRaw, statusRaw] of Object.entries(statusesData)) {
    const containerName = containerNameRaw.trim();
    if (!containerName) continue;
    if (statusRaw === 'updated' || statusRaw === 'pending' || statusRaw === 'failed') {
      normalizedStatuses[containerName] = statusRaw;
    }
  }
  return normalizedStatuses;
}

function getWatcherConfiguration(watcher: Record<string, unknown>): ApiWatcherConfiguration {
  if (watcher?.configuration && typeof watcher.configuration === 'object') {
    return watcher.configuration as ApiWatcherConfiguration;
  }
  if (watcher?.config && typeof watcher.config === 'object') {
    return watcher.config as ApiWatcherConfiguration;
  }
  return {};
}

function watcherHasMaintenanceWindow(watcher: unknown): boolean {
  if (!watcher || typeof watcher !== 'object') return false;
  const configuration = getWatcherConfiguration(watcher as Record<string, unknown>);
  const maintenanceWindow = configuration.maintenancewindow ?? configuration.maintenanceWindow;
  return typeof maintenanceWindow === 'string' && maintenanceWindow.trim().length > 0;
}

function toNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeContainerSummary(summary: unknown): DashboardContainerSummary {
  const containersData =
    summary && typeof summary === 'object' && 'containers' in summary
      ? (summary as { containers?: unknown }).containers
      : undefined;
  const securityData =
    summary && typeof summary === 'object' && 'security' in summary
      ? (summary as { security?: unknown }).security
      : undefined;
  const total = toNonNegativeInteger(
    containersData && typeof containersData === 'object'
      ? (containersData as { total?: unknown }).total
      : undefined,
  );
  const running = toNonNegativeInteger(
    containersData && typeof containersData === 'object'
      ? (containersData as { running?: unknown }).running
      : undefined,
  );
  const stopped = toNonNegativeInteger(
    containersData && typeof containersData === 'object'
      ? (containersData as { stopped?: unknown }).stopped
      : undefined,
  );
  const issues = toNonNegativeInteger(
    securityData && typeof securityData === 'object'
      ? (securityData as { issues?: unknown }).issues
      : undefined,
  );
  return {
    containers: {
      total,
      running,
      stopped,
    },
    security: {
      issues,
    },
  };
}

function buildContainerSummaryFromContainers(containers: Container[]): DashboardContainerSummary {
  const total = containers.length;
  const running = containers.filter((container) => container.status === 'running').length;
  const issues = containers.filter(
    (container) => container.bouncer === 'unsafe' || container.bouncer === 'blocked',
  ).length;
  return {
    containers: {
      total,
      running,
      stopped: Math.max(total - running, 0),
    },
    security: {
      issues,
    },
  };
}

function selectRealtimeRefreshMode(
  current: RealtimeRefreshMode | undefined,
  requested: RealtimeRefreshMode,
): RealtimeRefreshMode {
  if (current === 'full' || requested === 'full') {
    return 'full';
  }
  return 'summary';
}

export function useDashboardData() {
  const loading = ref(true);
  const error = ref<string | null>(null);

  const containerSummary = ref<DashboardContainerSummary | null>(null);
  const containers = ref<Container[]>([]);
  const serverInfo = ref<DashboardServerInfo | null>(null);
  const agents = ref<DashboardAgent[]>([]);
  const watchers = ref<unknown[]>([]);
  const registries = ref<unknown[]>([]);
  const recentStatusByContainer = ref<Record<string, RecentAuditStatus>>({});
  const maintenanceCountdownNow = ref(Date.now());
  const hasMaintenanceWindows = computed(() =>
    watchers.value.some((watcher) => watcherHasMaintenanceWindow(watcher)),
  );

  let maintenanceCountdownTimer: ReturnType<typeof setInterval> | undefined;
  let realtimeRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let scheduledRealtimeRefreshMode: RealtimeRefreshMode | undefined;
  let stopMaintenanceWindowWatch: ReturnType<typeof watch> | undefined;

  function isPageVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  function stopMaintenanceCountdownTimer() {
    if (maintenanceCountdownTimer !== undefined) {
      clearInterval(maintenanceCountdownTimer);
      maintenanceCountdownTimer = undefined;
    }
  }

  function syncMaintenanceCountdownTimer() {
    const shouldRunTimer = hasMaintenanceWindows.value && isPageVisible();
    if (!shouldRunTimer) {
      stopMaintenanceCountdownTimer();
      return;
    }
    maintenanceCountdownNow.value = Date.now();
    if (maintenanceCountdownTimer !== undefined) {
      return;
    }
    maintenanceCountdownTimer = window.setInterval(() => {
      maintenanceCountdownNow.value = Date.now();
    }, 30_000);
  }

  function hasRenderedDashboardData() {
    return (
      containers.value.length > 0 ||
      watchers.value.length > 0 ||
      registries.value.length > 0 ||
      agents.value.length > 0 ||
      serverInfo.value !== null ||
      containerSummary.value !== null
    );
  }

  async function fetchDashboardData(options: DashboardRefreshOptions = {}) {
    const background = options.background === true;
    const hasRenderedData = hasRenderedDashboardData();

    if (!background) {
      loading.value = true;
      error.value = null;
    }
    try {
      const [containersRes, serverRes, agentsRes, watchersRes, registriesRes, recentStatusRes] =
        await Promise.all([
          getAllContainers(),
          getServer(),
          getAgents(),
          getAllWatchers(),
          getAllRegistries(),
          getContainerRecentStatus(),
        ]);
      containers.value = mapApiContainers(containersRes);
      containerSummary.value = buildContainerSummaryFromContainers(containers.value);
      serverInfo.value = serverRes;
      agents.value = agentsRes;
      watchers.value = Array.isArray(watchersRes) ? watchersRes : [];
      registries.value = Array.isArray(registriesRes) ? registriesRes : [];

      recentStatusByContainer.value = normalizeRecentStatusByContainer(recentStatusRes);
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

  async function fetchDashboardSummary() {
    const hasRenderedData = hasRenderedDashboardData();
    try {
      const summary = await getContainerSummary();
      containerSummary.value = normalizeContainerSummary(summary);
      error.value = null;
    } catch (e: unknown) {
      if (!hasRenderedData) {
        error.value = errorMessage(e, 'Failed to load dashboard data');
      } else {
        console.debug(errorMessage(e, 'Dashboard summary refresh failed'));
      }
    }
  }

  function scheduleRealtimeRefresh(mode: RealtimeRefreshMode) {
    scheduledRealtimeRefreshMode = selectRealtimeRefreshMode(scheduledRealtimeRefreshMode, mode);
    if (realtimeRefreshTimer !== undefined) {
      clearTimeout(realtimeRefreshTimer);
    }
    realtimeRefreshTimer = window.setTimeout(() => {
      realtimeRefreshTimer = undefined;
      const refreshMode = scheduledRealtimeRefreshMode ?? 'summary';
      scheduledRealtimeRefreshMode = undefined;
      if (refreshMode === 'full') {
        void fetchDashboardData({ background: true });
        return;
      }
      void fetchDashboardSummary();
    }, DASHBOARD_REALTIME_REFRESH_DEBOUNCE_MS);
  }

  const summaryRefreshListener = (() => scheduleRealtimeRefresh('summary')) as EventListener;
  const fullRefreshListener = (() => scheduleRealtimeRefresh('full')) as EventListener;
  const visibilityChangeListener = syncMaintenanceCountdownTimer as EventListener;

  onMounted(async () => {
    globalThis.addEventListener('dd:sse-container-changed', summaryRefreshListener);
    globalThis.addEventListener('dd:sse-scan-completed', fullRefreshListener);
    globalThis.addEventListener('dd:sse-connected', fullRefreshListener);
    document.addEventListener('visibilitychange', visibilityChangeListener);
    stopMaintenanceWindowWatch = watch(hasMaintenanceWindows, syncMaintenanceCountdownTimer, {
      immediate: true,
    });
    await fetchDashboardData();
  });

  onUnmounted(() => {
    globalThis.removeEventListener('dd:sse-container-changed', summaryRefreshListener);
    globalThis.removeEventListener('dd:sse-scan-completed', fullRefreshListener);
    globalThis.removeEventListener('dd:sse-connected', fullRefreshListener);
    document.removeEventListener('visibilitychange', visibilityChangeListener);
    if (stopMaintenanceWindowWatch) {
      stopMaintenanceWindowWatch();
      stopMaintenanceWindowWatch = undefined;
    }
    if (realtimeRefreshTimer !== undefined) {
      clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = undefined;
    }
    scheduledRealtimeRefreshMode = undefined;
    stopMaintenanceCountdownTimer();
  });

  return {
    agents,
    containerSummary,
    containers,
    error,
    fetchDashboardData,
    loading,
    maintenanceCountdownNow,
    recentStatusByContainer,
    registries,
    serverInfo,
    watchers,
  };
}
