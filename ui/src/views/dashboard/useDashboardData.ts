import { computed, onMounted, onUnmounted, type Ref, ref, watch } from 'vue';
import { getAgents } from '../../services/agent';
import {
  getAllContainers,
  getContainerRecentStatus,
  getContainerSummary,
} from '../../services/container';
import { getAllRegistries } from '../../services/registry';
import { getServer } from '../../services/server';
import { type ContainerStatsSummaryItem, getAllContainerStats } from '../../services/stats';
import { getAllWatchers } from '../../services/watcher';
import type { Container } from '../../types/container';
import { mapApiContainers } from '../../utils/container-mapper';
import { errorMessage } from '../../utils/error';
import type {
  DashboardAgent,
  DashboardContainerSummary,
  DashboardServerInfo,
  RecentAuditStatus,
} from './dashboardTypes';
import {
  createMaintenanceCountdownController,
  createRealtimeRefreshScheduler,
} from './useDashboardData.helpers';
import { getWatcherConfiguration } from './watcherConfiguration';

const DASHBOARD_REALTIME_REFRESH_DEBOUNCE_MS = 1_000;

interface DashboardRefreshOptions {
  background?: boolean;
}

interface DashboardStateRefs {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  containerSummary: Ref<DashboardContainerSummary | null>;
  containerStats: Ref<ContainerStatsSummaryItem[]>;
  containers: Ref<Container[]>;
  serverInfo: Ref<DashboardServerInfo | null>;
  agents: Ref<DashboardAgent[]>;
  watchers: Ref<unknown[]>;
  registries: Ref<unknown[]>;
  recentStatusByContainer: Ref<Record<string, RecentAuditStatus>>;
}

interface DashboardDataResponse {
  containersRes: unknown;
  containerStatsRes: ContainerStatsSummaryItem[];
  serverRes: DashboardServerInfo;
  agentsRes: DashboardAgent[];
  watchersRes: unknown;
  registriesRes: unknown;
  recentStatusRes: unknown;
}

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

function watcherHasMaintenanceWindow(watcher: unknown): boolean {
  if (!watcher || typeof watcher !== 'object') return false;
  const configuration = getWatcherConfiguration(watcher);
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

function isPageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function hasRenderedDashboardData(state: DashboardStateRefs): boolean {
  const hasRenderedCollections = [
    state.containers.value,
    state.containerStats.value,
    state.watchers.value,
    state.registries.value,
    state.agents.value,
  ].some((items) => items.length > 0);

  return (
    hasRenderedCollections ||
    state.serverInfo.value !== null ||
    state.containerSummary.value !== null
  );
}

function applyFetchedDashboardData(state: DashboardStateRefs, response: DashboardDataResponse) {
  state.containers.value = mapApiContainers(response.containersRes);
  state.containerSummary.value = buildContainerSummaryFromContainers(state.containers.value);
  state.containerStats.value = response.containerStatsRes;
  state.serverInfo.value = response.serverRes;
  state.agents.value = response.agentsRes;
  state.watchers.value = Array.isArray(response.watchersRes) ? response.watchersRes : [];
  state.registries.value = Array.isArray(response.registriesRes) ? response.registriesRes : [];
  state.recentStatusByContainer.value = normalizeRecentStatusByContainer(response.recentStatusRes);
  state.error.value = null;
}

function createDashboardDataFetchers(state: DashboardStateRefs) {
  async function fetchDashboardData(options: DashboardRefreshOptions = {}) {
    const background = options.background === true;
    const hasRenderedData = hasRenderedDashboardData(state);

    if (!background) {
      state.loading.value = true;
      state.error.value = null;
    }

    try {
      const [
        containersRes,
        containerStatsRes,
        serverRes,
        agentsRes,
        watchersRes,
        registriesRes,
        recentStatusRes,
      ] = await Promise.all([
        getAllContainers(),
        getAllContainerStats(),
        getServer(),
        getAgents(),
        getAllWatchers(),
        getAllRegistries(),
        getContainerRecentStatus(),
      ]);
      applyFetchedDashboardData(state, {
        containersRes,
        containerStatsRes,
        serverRes,
        agentsRes,
        watchersRes,
        registriesRes,
        recentStatusRes,
      });
    } catch (e: unknown) {
      if (!background || !hasRenderedData) {
        state.error.value = errorMessage(e, 'Failed to load dashboard data');
      } else {
        console.debug(errorMessage(e, 'Dashboard background refresh failed'));
      }
    } finally {
      if (!background) {
        state.loading.value = false;
      }
    }
  }

  async function fetchDashboardSummary() {
    const hasRenderedData = hasRenderedDashboardData(state);
    try {
      const summary = await getContainerSummary();
      state.containerSummary.value = normalizeContainerSummary(summary);
      state.error.value = null;
    } catch (e: unknown) {
      if (!hasRenderedData) {
        state.error.value = errorMessage(e, 'Failed to load dashboard data');
      } else {
        console.debug(errorMessage(e, 'Dashboard summary refresh failed'));
      }
    }
  }

  return {
    fetchDashboardData,
    fetchDashboardSummary,
  };
}

export function useDashboardData() {
  const loading = ref(true);
  const error = ref<string | null>(null);
  const containerSummary = ref<DashboardContainerSummary | null>(null);
  const containerStats = ref<ContainerStatsSummaryItem[]>([]);
  const containers = ref<Container[]>([]);
  const serverInfo = ref<DashboardServerInfo | null>(null);
  const agents = ref<DashboardAgent[]>([]);
  const watchers = ref<unknown[]>([]);
  const registries = ref<unknown[]>([]);
  const recentStatusByContainer = ref<Record<string, RecentAuditStatus>>({});
  const maintenanceCountdownNow = ref(Date.now());

  const state: DashboardStateRefs = {
    loading,
    error,
    containerSummary,
    containerStats,
    containers,
    serverInfo,
    agents,
    watchers,
    registries,
    recentStatusByContainer,
  };

  const { fetchDashboardData, fetchDashboardSummary } = createDashboardDataFetchers(state);
  const hasMaintenanceWindows = computed(() =>
    watchers.value.some((watcher) => watcherHasMaintenanceWindow(watcher)),
  );
  const maintenanceCountdownController = createMaintenanceCountdownController({
    hasMaintenanceWindows,
    maintenanceCountdownNow,
    isPageVisible,
    setIntervalFn: window.setInterval.bind(window),
    clearIntervalFn: window.clearInterval.bind(window),
  });
  const realtimeRefreshScheduler = createRealtimeRefreshScheduler({
    debounceMs: DASHBOARD_REALTIME_REFRESH_DEBOUNCE_MS,
    refreshSummary: () => {
      void fetchDashboardSummary();
    },
    refreshFull: () => {
      void fetchDashboardData({ background: true });
    },
    setTimeoutFn: window.setTimeout.bind(window),
    clearTimeoutFn: window.clearTimeout.bind(window),
  });

  const summaryRefreshListener = (() =>
    realtimeRefreshScheduler.schedule('summary')) as EventListener;
  const fullRefreshListener = (() => realtimeRefreshScheduler.schedule('full')) as EventListener;
  const visibilityChangeListener = maintenanceCountdownController.sync as EventListener;
  let stopMaintenanceWindowWatch: ReturnType<typeof watch> | undefined;

  onMounted(async () => {
    globalThis.addEventListener('dd:sse-container-changed', summaryRefreshListener);
    globalThis.addEventListener('dd:sse-scan-completed', fullRefreshListener);
    globalThis.addEventListener('dd:sse-connected', fullRefreshListener);
    document.addEventListener('visibilitychange', visibilityChangeListener);
    stopMaintenanceWindowWatch = watch(hasMaintenanceWindows, maintenanceCountdownController.sync, {
      immediate: true,
    });
    await fetchDashboardData();
  });

  onUnmounted(() => {
    globalThis.removeEventListener('dd:sse-container-changed', summaryRefreshListener);
    globalThis.removeEventListener('dd:sse-scan-completed', fullRefreshListener);
    globalThis.removeEventListener('dd:sse-connected', fullRefreshListener);
    document.removeEventListener('visibilitychange', visibilityChangeListener);
    stopMaintenanceWindowWatch?.();
    realtimeRefreshScheduler.dispose();
    maintenanceCountdownController.dispose();
  });

  return {
    agents,
    containerSummary,
    containerStats,
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
