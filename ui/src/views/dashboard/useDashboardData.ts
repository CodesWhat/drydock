import { computed, onMounted, onUnmounted, type Ref, ref, watch } from 'vue';
import { getAgents } from '../../services/agent';
import { getAllContainers, getContainerRecentStatus } from '../../services/container';
import { getAllRegistries } from '../../services/registry';
import { getServer } from '../../services/server';
import {
  type ContainerStatsSummarySnapshot,
  connectStatsSummaryStream,
  getStatsSummary,
  type StatsSummaryStreamController,
} from '../../services/stats';
import { getAllWatchers } from '../../services/watcher';
import type { Container } from '../../types/container';
import {
  type ActiveContainerUpdateOperationPhase,
  isActiveContainerUpdateOperationPhaseForStatus,
  isActiveContainerUpdateOperationStatus,
  isContainerUpdateOperationStatus,
} from '../../types/update-operation';
import {
  type ApiContainerInput,
  mapApiContainer,
  mapApiContainers,
} from '../../utils/container-mapper';
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
// Watchers / registries / agents / server info change rarely and have their own
// SSE refresh paths where relevant. On reconnect-driven background refreshes we
// skip refetching them unless this TTL has elapsed, so a reconnect storm on a
// flaky LAN does not stampede 7 endpoints for every blip. See #301.
const DASHBOARD_STATIC_ENDPOINT_TTL_MS = 30_000;

interface DashboardRefreshOptions {
  background?: boolean;
  // When true, skip watchers/registries/agents/server info if their last
  // successful fetch is within DASHBOARD_STATIC_ENDPOINT_TTL_MS. Used for the
  // reconnect-driven background refresh path.
  skipStaticIfFresh?: boolean;
}

interface DashboardStateRefs {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  containerSummary: Ref<DashboardContainerSummary | null>;
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
  // The static-endpoint fields are optional so a reconnect-driven refresh can
  // skip them when the cached values are still within the TTL.
  serverRes?: DashboardServerInfo;
  agentsRes?: DashboardAgent[];
  watchersRes?: unknown;
  registriesRes?: unknown;
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

type DashboardContainerPatchKind = 'added' | 'updated' | 'removed';

// Apply a single-container SSE payload to the dashboard's containers ref in place,
// then recompute the in-memory containerSummary (O(N) walk, no HTTP). Replaces
// the previous behaviour of firing fetchDashboardData({ background: true }) —
// which issued 7 parallel GETs — for every single-container event.
// Stats (containerStats) and recent-status maps are NOT patched here; they use
// independent data sources and the caller keeps a periodic reconciliation refresh
// for them.
function applyDashboardContainerPatch(
  state: DashboardStateRefs,
  event: Event,
  kind: DashboardContainerPatchKind,
  fallback: () => void,
): void {
  const raw = (event as CustomEvent)?.detail as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    fallback();
    return;
  }
  const id = typeof raw.id === 'string' ? raw.id : undefined;
  const name = typeof raw.name === 'string' ? raw.name : undefined;
  if (!id && !name) {
    fallback();
    return;
  }

  const idx = state.containers.value.findIndex(
    (container) =>
      (typeof id === 'string' && id.length > 0 && container.id === id) ||
      (typeof name === 'string' && name.length > 0 && container.name === name),
  );

  if (kind === 'removed') {
    if (idx !== -1) {
      state.containers.value.splice(idx, 1);
    }
    state.containerSummary.value = buildContainerSummaryFromContainers(state.containers.value);
    return;
  }

  let mapped: Container;
  try {
    mapped = mapApiContainer(raw);
  } catch {
    fallback();
    return;
  }

  if (idx === -1) {
    state.containers.value.push(mapped);
  } else {
    Object.assign(state.containers.value[idx]!, mapped);
  }
  state.containerSummary.value = buildContainerSummaryFromContainers(state.containers.value);
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
  if (response.serverRes !== undefined) {
    state.serverInfo.value = response.serverRes;
  }
  if (response.agentsRes !== undefined) {
    state.agents.value = response.agentsRes;
  }
  if (response.watchersRes !== undefined) {
    state.watchers.value = Array.isArray(response.watchersRes) ? response.watchersRes : [];
  }
  if (response.registriesRes !== undefined) {
    state.registries.value = Array.isArray(response.registriesRes) ? response.registriesRes : [];
  }
  const normalizedRecentStatuses = normalizeRecentStatuses(response.recentStatusRes);
  state.recentStatusByContainer.value = normalizedRecentStatuses.byContainer;
  state.recentStatusByIdentity.value = normalizedRecentStatuses.byIdentity;
  state.error.value = null;
}

function createDashboardDataFetchers(state: DashboardStateRefs) {
  let lastStaticFetchAt = 0;

  async function fetchDashboardData(options: DashboardRefreshOptions = {}) {
    const background = options.background === true;
    const hasRenderedData = hasRenderedDashboardData(state);
    const now = Date.now();
    const staticFresh =
      options.skipStaticIfFresh === true &&
      lastStaticFetchAt > 0 &&
      now - lastStaticFetchAt < DASHBOARD_STATIC_ENDPOINT_TTL_MS;

    if (!background) {
      state.loading.value = true;
      state.error.value = null;
    }

    try {
      const livePromises = Promise.all([getAllContainers(), getContainerRecentStatus()]);

      const staticPromises = staticFresh
        ? Promise.resolve([undefined, undefined, undefined, undefined] as [
            DashboardServerInfo | undefined,
            DashboardAgent[] | undefined,
            unknown,
            unknown,
          ])
        : Promise.all([getServer(), getAgents(), getAllWatchers(), getAllRegistries()]);

      const [[containersRes, recentStatusRes], [serverRes, agentsRes, watchersRes, registriesRes]] =
        await Promise.all([livePromises, staticPromises]);

      if (!staticFresh) {
        lastStaticFetchAt = Date.now();
      }

      applyFetchedDashboardData(state, {
        containersRes,
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
  const summary = ref<ContainerStatsSummarySnapshot | null>(null);
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
    containers,
    serverInfo,
    agents,
    watchers,
    registries,
    recentStatusByContainer,
    recentStatusByIdentity,
  };

  let statsSummaryController: StatsSummaryStreamController | null = null;

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
    refreshFullLive: () => {
      void fetchDashboardData({ background: true, skipStaticIfFresh: true });
    },
    refreshFull: () => {
      void fetchDashboardData({ background: true });
    },
    setTimeoutFn: window.setTimeout.bind(window),
    clearTimeoutFn: window.clearTimeout.bind(window),
  });

  // dd:sse-connected blips during network flaps — cheap refresh that TTL-guards
  // watchers/registries/agents/server. dd:sse-resync-required is the server
  // telling us we definitely missed events, so always do the full fan-out.
  const reconnectRefreshListener = (() =>
    realtimeRefreshScheduler.schedule('full-live')) as EventListener;
  const resyncRefreshListener = (() => realtimeRefreshScheduler.schedule('full')) as EventListener;
  const operationPatchListener = ((event: Event) => {
    applyDashboardOperationPatch(state, event);
  }) as EventListener;
  const containerAddedListener = ((event: Event) => {
    applyDashboardContainerPatch(state, event, 'added', () =>
      realtimeRefreshScheduler.schedule('full'),
    );
  }) as EventListener;
  const containerUpdatedListener = ((event: Event) => {
    applyDashboardContainerPatch(state, event, 'updated', () =>
      realtimeRefreshScheduler.schedule('full'),
    );
  }) as EventListener;
  const containerRemovedListener = ((event: Event) => {
    applyDashboardContainerPatch(state, event, 'removed', () =>
      realtimeRefreshScheduler.schedule('full'),
    );
  }) as EventListener;
  const visibilityChangeListener = ((event: Event) => {
    maintenanceCountdownController.sync(event);
    if (!isPageVisible()) {
      statsSummaryController?.pause();
    } else {
      statsSummaryController?.resume();
    }
  }) as EventListener;
  let stopMaintenanceWindowWatch: ReturnType<typeof watch> | undefined;

  onMounted(async () => {
    globalThis.addEventListener('dd:sse-container-added', containerAddedListener);
    globalThis.addEventListener('dd:sse-container-updated', containerUpdatedListener);
    globalThis.addEventListener('dd:sse-container-removed', containerRemovedListener);
    globalThis.addEventListener('dd:sse-update-operation-changed', operationPatchListener);
    globalThis.addEventListener('dd:sse-connected', reconnectRefreshListener);
    globalThis.addEventListener('dd:sse-resync-required', resyncRefreshListener);
    document.addEventListener('visibilitychange', visibilityChangeListener);
    stopMaintenanceWindowWatch = watch(hasMaintenanceWindows, maintenanceCountdownController.sync, {
      immediate: true,
    });

    // Open summary SSE stream — initial fetch populates the ref immediately;
    // the stream keeps it live. Tolerate initial-fetch errors: the stream will
    // update summary on its first event regardless.
    getStatsSummary()
      .then((s) => {
        summary.value = s;
      })
      .catch((e: unknown) => {
        console.debug(
          typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Failed to fetch stats summary',
        );
      });
    statsSummaryController = connectStatsSummaryStream({
      onSummary: (s) => {
        summary.value = s;
      },
      onError: () => undefined,
    });

    await fetchDashboardData();
  });

  onUnmounted(() => {
    globalThis.removeEventListener('dd:sse-container-added', containerAddedListener);
    globalThis.removeEventListener('dd:sse-container-updated', containerUpdatedListener);
    globalThis.removeEventListener('dd:sse-container-removed', containerRemovedListener);
    globalThis.removeEventListener('dd:sse-update-operation-changed', operationPatchListener);
    globalThis.removeEventListener('dd:sse-connected', reconnectRefreshListener);
    globalThis.removeEventListener('dd:sse-resync-required', resyncRefreshListener);
    document.removeEventListener('visibilitychange', visibilityChangeListener);
    statsSummaryController?.disconnect();
    stopMaintenanceWindowWatch?.();
    realtimeRefreshScheduler.dispose();
    maintenanceCountdownController.dispose();
  });

  return {
    agents,
    containerSummary,
    summary,
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
