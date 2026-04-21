import { computed, onMounted, onUnmounted, type Ref, ref, watch } from 'vue';
import { getAgents } from '../../services/agent';
import { getAllContainers, getContainerRecentStatus } from '../../services/container';
import { getAllRegistries } from '../../services/registry';
import { getServer } from '../../services/server';
import { type ContainerStatsSummaryItem, getAllContainerStats } from '../../services/stats';
import { getAllWatchers } from '../../services/watcher';
import type { Container } from '../../types/container';
import {
  type ActiveContainerUpdateOperationPhase,
  isActiveContainerUpdateOperationPhaseForStatus,
  isActiveContainerUpdateOperationStatus,
  isContainerUpdateOperationStatus,
} from '../../types/update-operation';
import { type ApiContainerInput, mapApiContainers } from '../../utils/container-mapper';
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
  recentStatusByIdentity: Ref<Record<string, RecentAuditStatus>>;
}

interface DashboardDataResponse {
  containersRes: ApiContainerInput[];
  containerStatsRes: ContainerStatsSummaryItem[];
  serverRes: DashboardServerInfo;
  agentsRes: DashboardAgent[];
  watchersRes: unknown;
  registriesRes: unknown;
  recentStatusRes: unknown;
}

function normalizeRecentStatusMap(input: unknown): Record<string, RecentAuditStatus> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const normalizedStatuses: Record<string, RecentAuditStatus> = {};
  for (const [keyRaw, statusRaw] of Object.entries(input)) {
    const key = keyRaw.trim();
    if (!key) continue;
    if (statusRaw === 'updated' || statusRaw === 'pending' || statusRaw === 'failed') {
      normalizedStatuses[key] = statusRaw;
    }
  }
  return normalizedStatuses;
}

function normalizeRecentStatuses(response: unknown) {
  if (!response || typeof response !== 'object') {
    return {
      byContainer: {},
      byIdentity: {},
    };
  }

  const responseRecord = response as {
    statuses?: unknown;
    statusesByIdentity?: unknown;
  };

  return {
    byContainer: normalizeRecentStatusMap(responseRecord.statuses),
    byIdentity: normalizeRecentStatusMap(responseRecord.statusesByIdentity),
  };
}

function watcherHasMaintenanceWindow(watcher: unknown): boolean {
  if (!watcher || typeof watcher !== 'object') return false;
  const configuration = getWatcherConfiguration(watcher);
  const maintenanceWindow = configuration.maintenancewindow ?? configuration.maintenanceWindow;
  return typeof maintenanceWindow === 'string' && maintenanceWindow.trim().length > 0;
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

function resolveActiveOperationPhase(args: {
  status: 'queued' | 'in-progress';
  phase: unknown;
  previousPhase?: unknown;
}): ActiveContainerUpdateOperationPhase {
  if (isActiveContainerUpdateOperationPhaseForStatus(args.status, args.phase)) {
    return args.phase;
  }
  if (
    args.previousPhase !== undefined &&
    isActiveContainerUpdateOperationPhaseForStatus(args.status, args.previousPhase)
  ) {
    return args.previousPhase;
  }
  return args.status === 'queued' ? 'queued' : 'pulling';
}

function applyDashboardOperationPatch(state: DashboardStateRefs, event: Event): void {
  const payload = (event as CustomEvent)?.detail;
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const { operationId, containerId, newContainerId, containerName, status, phase } =
    payload as Record<string, unknown>;
  if (!isContainerUpdateOperationStatus(status)) {
    return;
  }

  const idx = state.containers.value.findIndex(
    (container) =>
      (typeof containerId === 'string' && container.id === containerId) ||
      (typeof newContainerId === 'string' && container.id === newContainerId) ||
      (typeof containerName === 'string' && container.name === containerName),
  );
  if (idx === -1) {
    return;
  }

  const row = state.containers.value[idx]!;
  if (isActiveContainerUpdateOperationStatus(status)) {
    row.updateOperation = {
      ...(row.updateOperation ?? {}),
      id: typeof operationId === 'string' ? operationId : (row.updateOperation?.id ?? ''),
      status,
      phase: resolveActiveOperationPhase({
        status,
        phase,
        previousPhase: row.updateOperation?.phase,
      }),
      updatedAt: new Date().toISOString(),
    };
    return;
  }

  row.updateOperation = undefined;
}

function applyFetchedDashboardData(state: DashboardStateRefs, response: DashboardDataResponse) {
  state.containers.value = mapApiContainers(response.containersRes);
  state.containerSummary.value = buildContainerSummaryFromContainers(state.containers.value);
  state.containerStats.value = response.containerStatsRes;
  state.serverInfo.value = response.serverRes;
  state.agents.value = response.agentsRes;
  state.watchers.value = Array.isArray(response.watchersRes) ? response.watchersRes : [];
  state.registries.value = Array.isArray(response.registriesRes) ? response.registriesRes : [];
  const normalizedRecentStatuses = normalizeRecentStatuses(response.recentStatusRes);
  state.recentStatusByContainer.value = normalizedRecentStatuses.byContainer;
  state.recentStatusByIdentity.value = normalizedRecentStatuses.byIdentity;
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
  return {
    fetchDashboardData,
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
  const recentStatusByIdentity = ref<Record<string, RecentAuditStatus>>({});
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
    recentStatusByIdentity,
  };

  const { fetchDashboardData } = createDashboardDataFetchers(state);
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
    refreshFull: () => {
      void fetchDashboardData({ background: true });
    },
    setTimeoutFn: window.setTimeout.bind(window),
    clearTimeoutFn: window.clearTimeout.bind(window),
  });

  const fullRefreshListener = (() => realtimeRefreshScheduler.schedule('full')) as EventListener;
  const operationPatchListener = ((event: Event) => {
    applyDashboardOperationPatch(state, event);
  }) as EventListener;
  const visibilityChangeListener = maintenanceCountdownController.sync as EventListener;
  let stopMaintenanceWindowWatch: ReturnType<typeof watch> | undefined;

  onMounted(async () => {
    globalThis.addEventListener('dd:sse-container-changed', fullRefreshListener);
    globalThis.addEventListener('dd:sse-update-operation-changed', operationPatchListener);
    globalThis.addEventListener('dd:sse-connected', fullRefreshListener);
    globalThis.addEventListener('dd:sse-resync-required', fullRefreshListener);
    document.addEventListener('visibilitychange', visibilityChangeListener);
    stopMaintenanceWindowWatch = watch(hasMaintenanceWindows, maintenanceCountdownController.sync, {
      immediate: true,
    });
    await fetchDashboardData();
  });

  onUnmounted(() => {
    globalThis.removeEventListener('dd:sse-container-changed', fullRefreshListener);
    globalThis.removeEventListener('dd:sse-update-operation-changed', operationPatchListener);
    globalThis.removeEventListener('dd:sse-connected', fullRefreshListener);
    globalThis.removeEventListener('dd:sse-resync-required', fullRefreshListener);
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
    recentStatusByIdentity,
    registries,
    serverInfo,
    watchers,
  };
}
