<script setup lang="ts">
import {
  computed,
  onMounted,
  onScopeDispose,
  onUnmounted,
  provide,
  ref,
  watch,
  type WatchStopHandle,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import ContainerFullPageDetail from '../components/containers/ContainerFullPageDetail.vue';
import ContainerSideDetail from '../components/containers/ContainerSideDetail.vue';
import ContainersListContent from '../components/containers/ContainersListContent.vue';
import { containersViewTemplateContextKey } from '../components/containers/containersViewTemplateContext';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useColumnVisibility } from '../composables/useColumnVisibility';
import { useContainerFilters } from '../composables/useContainerFilters';
import { useDetailPanel, useDetailPanelStorage } from '../composables/useDetailPanel';
import { LOG_AUTO_FETCH_INTERVALS } from '../composables/useLogViewerBehavior';
import {
  applyUpdateOperationSseToHold,
  OPERATION_DISPLAY_HOLD_MS,
  parseUpdateOperationSsePayload,
  useOperationDisplayHold,
} from '../composables/useOperationDisplayHold';
import { useToast } from '../composables/useToast';
import { preferences } from '../preferences/store';
import { usePreference } from '../preferences/usePreference';
import { useViewMode } from '../preferences/useViewMode';
import type { ContainerGroup } from '../services/container';
import { getAllContainers, getContainerGroups, refreshAllContainers } from '../services/container';
import type { Container, ContainerUpdateOperation } from '../types/container';
import { getContainerActionIdentityKey } from '../utils/container-action-key';
import { hasHardBlocker } from '../utils/update-eligibility';
import { mapApiContainer, mapApiContainers } from '../utils/container-mapper';
import {
  maturityColor,
  parseServer,
  registryColorBg,
  registryColorText,
  registryLabel,
  serverBadgeColor,
  updateKindColor,
} from '../utils/display';
import { errorMessage } from '../utils/error';
import { resolveUpdateFailureReason } from '../utils/update-error-summary';
import { useOperationStore } from '../stores/operations';
import { useContainerActions } from './containers/useContainerActions';
import { useContainerLogs } from './containers/useContainerLogs';
import { useContainerSecurity } from './containers/useContainerSecurity';

const UPDATE_KIND_SORT_ORDER: Readonly<Record<string, number>> = Object.freeze({
  major: 0,
  minor: 1,
  patch: 2,
  digest: 3,
});
const BOUNCER_SORT_ORDER: Readonly<Record<string, number>> = Object.freeze({
  blocked: 0,
  unsafe: 1,
  safe: 2,
});
// How long to wait for a deferred operation-attach watcher before giving up.
// 30 s is generous enough to outlast any SSE relay delay while still bounding
// the worst-case watcher lifetime.
const DEFERRED_OPERATION_ATTACH_TIMEOUT_MS = 30_000;

const { t } = useI18n();

const loading = ref(true);
const error = ref<string | null>(null);

const containers = ref<Container[]>([]);
const containerIdMap = ref<Record<string, string>>({});
const containerMetaMap = ref<Record<string, unknown>>({});
const {
  clearAllOperationDisplayHolds,
  projectContainerDisplayState,
  reconcileHoldsAgainstContainers,
} = useOperationDisplayHold();
const operationStore = useOperationStore();
const toast = useToast();
const completionToastTimers = new Set<ReturnType<typeof setTimeout>>();

// Deferred operation re-attach: when dd:container-added arrives before
// dd:update-operation-changed (agent-relay path has no ordering guarantee),
// the synchronous resolveStoreOperation lookup misses. Each entry here is a
// pending watcher waiting for the operation to appear in the store.
// Keyed by container ID so at most one watcher exists per container.
const pendingOperationWatchers = new Map<string, WatchStopHandle>();
const pendingOperationWatcherTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleCompletionToast(callback: () => void) {
  const timer = setTimeout(() => {
    completionToastTimers.delete(timer);
    callback();
  }, OPERATION_DISPLAY_HOLD_MS);
  completionToastTimers.add(timer);
}

onScopeDispose(() => {
  for (const timer of completionToastTimers) {
    clearTimeout(timer);
  }
  completionToastTimers.clear();
  for (const stop of pendingOperationWatchers.values()) {
    stop();
  }
  pendingOperationWatchers.clear();
  for (const timer of pendingOperationWatcherTimers.values()) {
    clearTimeout(timer);
  }
  pendingOperationWatcherTimers.clear();
});

function buildContainerLookupMaps(apiContainers: Record<string, unknown>[]) {
  const idMap: Record<string, string> = {};
  const metaMap: Record<string, unknown> = {};
  const aliasCounts = new Map<string, number>();

  for (const apiContainer of apiContainers) {
    const containerId = typeof apiContainer.id === 'string' ? apiContainer.id : '';
    if (!containerId) {
      continue;
    }
    const uiName =
      typeof apiContainer.displayName === 'string' && apiContainer.displayName.trim().length > 0
        ? apiContainer.displayName
        : typeof apiContainer.name === 'string'
          ? apiContainer.name
          : '';

    idMap[containerId] = containerId;
    metaMap[containerId] = apiContainer;

    if (!uiName) {
      continue;
    }
    aliasCounts.set(uiName, (aliasCounts.get(uiName) ?? 0) + 1);
  }

  for (const apiContainer of apiContainers) {
    const containerId = typeof apiContainer.id === 'string' ? apiContainer.id : '';
    if (!containerId) {
      continue;
    }
    const uiName =
      typeof apiContainer.displayName === 'string' && apiContainer.displayName.trim().length > 0
        ? apiContainer.displayName
        : typeof apiContainer.name === 'string'
          ? apiContainer.name
          : '';

    if (!uiName || aliasCounts.get(uiName) !== 1) {
      continue;
    }

    idMap[uiName] = containerId;
    metaMap[uiName] = apiContainer;
  }

  return { idMap, metaMap };
}

/**
 * Produce a stable fingerprint string for a container list so that
 * loadContainers() can skip reassigning `containers.value` — and thereby
 * avoid re-running the full displayContainers → sortedContainers →
 * groupedContainers computed chain — when the incoming data is identical to
 * what is already stored.
 *
 * Only hashes fields that affect row rendering or the downstream computed
 * chain (identity, tag, status, update indicators, safety state). Deep
 * structures like `details` (ports/volumes/env/labels) are intentionally
 * excluded — they do not change the grouped table render and would dominate
 * the cost of this walk on every reload. See #301.
 *
 * This is a best-effort dedup, not a correctness primitive: a false-positive
 * (hash collision / missed change) results in a redundant reactive
 * reassignment, i.e. the same work the pre-fingerprint code already did
 * unconditionally.
 */
function containerRowFingerprint(c: Container): string {
  const op = c.updateOperation;
  return [
    c.id,
    c.name,
    c.currentTag,
    c.newTag ?? '',
    c.status,
    c.updateKind ?? '',
    c.updateDetectedAt ?? '',
    c.bouncer,
    c.updateBouncer ?? '',
    c.updatePolicyState ?? '',
    c.noUpdateReason ?? '',
    c.registryError ?? '',
    op ? `${op.id}:${op.status}:${op.phase}:${op.updatedAt}` : '',
  ].join('|');
}

function containerListFingerprint(list: Container[]): string {
  const parts = new Array<string>(list.length);
  for (let i = 0; i < list.length; i += 1) {
    parts[i] = containerRowFingerprint(list[i]!);
  }
  return parts.join('\n');
}

// UI-only fields that mapApiContainer does not produce. Preserve them across
// loadContainers() reassignments so an immediate post-update reload does not
// wipe the freshly-set failure reason banner.
function preserveTransientUiFields(prev: Container[], next: Container[]): Container[] {
  if (prev.length === 0) return next;
  const byId = new Map<string, Container>();
  const byName = new Map<string, Container>();
  for (const c of prev) {
    if (c.id) byId.set(c.id, c);
    if (c.name) byName.set(c.name, c);
  }
  for (const c of next) {
    const match = (c.id && byId.get(c.id)) || (c.name && byName.get(c.name));
    if (!match) continue;
    if (match.lastUpdateFailureReason !== undefined) {
      c.lastUpdateFailureReason = match.lastUpdateFailureReason;
    }
    if (match.lastUpdateFailureAt !== undefined) {
      c.lastUpdateFailureAt = match.lastUpdateFailureAt;
    }
  }
  return next;
}

async function loadContainers() {
  try {
    const apiContainers = await getAllContainers();
    const mappedRaw = mapApiContainers(apiContainers);
    const mapped = preserveTransientUiFields(containers.value, mappedRaw);
    // Skip reactive assignment (and downstream chain re-eval) when incoming
    // data is bit-for-bit identical to the current list. Gate the lookup map
    // reassignment on the same guard so unchanged reloads don't churn
    // containerIdMap/containerMetaMap reactivity either.
    if (
      containers.value.length !== mapped.length ||
      containerListFingerprint(mapped) !== containerListFingerprint(containers.value)
    ) {
      containers.value = mapped;
      const { idMap, metaMap } = buildContainerLookupMaps(
        apiContainers as Record<string, unknown>[],
      );
      containerIdMap.value = idMap;
      containerMetaMap.value = metaMap;
    }
    reconcileHoldsAgainstContainers(containers.value);
    if (groupByStack.value) {
      await loadGroups();
    }
  } catch (e: unknown) {
    error.value = errorMessage(e, t('containersView.error.loadFailed'));
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadContainers();
});

// Safety net only: if the SSE container-removed/added/updated stream hasn't
// reconciled the row within ~3s of a terminal event, run a single reload so
// the user is never stuck looking at stale data. The primary path is the
// SSE patches (applyContainerPatch); this is a belt-and-suspenders fallback,
// not the main mechanism.
let pendingReloadTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePostTerminalReload() {
  if (pendingReloadTimer) clearTimeout(pendingReloadTimer);
  pendingReloadTimer = setTimeout(() => {
    pendingReloadTimer = undefined;
    void loadContainers();
  }, 3000);
}
onScopeDispose(() => {
  if (pendingReloadTimer) {
    clearTimeout(pendingReloadTimer);
    pendingReloadTimer = undefined;
  }
});

const rechecking = ref(false);

async function recheckAll() {
  rechecking.value = true;
  error.value = null;
  try {
    await refreshAllContainers();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await loadContainers();
  } catch (e: unknown) {
    error.value = errorMessage(e, t('containersView.error.recheckFailed'));
  } finally {
    rechecking.value = false;
  }
}

const { isMobile, windowNarrow, windowWidth } = useBreakpoints();

const {
  selectedContainer,
  detailPanelOpen,
  activeDetailTab,
  panelSize,
  containerFullPage,
  detailTabs,
  selectContainer,
  openFullPage,
  closeFullPage,
  closePanel,
} = useDetailPanel();
const detailPanelStorage = useDetailPanelStorage();

const PANEL_WIDTH_PX = { sm: 420, md: 560, lg: 720 } as const;
const isCompact = computed(() => {
  if (!detailPanelOpen.value) return windowNarrow.value;
  const panelPx = PANEL_WIDTH_PX[panelSize.value];
  return windowWidth.value - panelPx < 1024;
});

function syncSelectedContainerReference() {
  if (!selectedContainer.value) {
    return;
  }
  const selectedId = selectedContainer.value.id;
  const selectedName = selectedContainer.value.name;
  const refreshed = containers.value.find(
    (container) =>
      (selectedId ? container.id === selectedId : false) ||
      (!selectedId && selectedName ? container.name === selectedName : false),
  );
  if (refreshed) {
    selectedContainer.value = refreshed;
    return;
  }
  closePanel();
}

watch(
  () => containers.value,
  () => {
    syncSelectedContainerReference();
  },
);

const selectedContainerId = computed(() => selectedContainer.value?.id);
const selectedContainerMeta = computed<Record<string, unknown> | undefined>(() => {
  if (!selectedContainer.value) {
    return undefined;
  }
  const meta =
    containerMetaMap.value[selectedContainer.value.id] ??
    containerMetaMap.value[selectedContainer.value.name];
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : undefined;
});

const {
  containerAutoFetchInterval,
  containerHandleLogScroll,
  containerLogRef,
  containerResumeAutoScroll,
  containerScrollBlocked,
  getContainerLogs,
} = useContainerLogs({
  activeDetailTab,
  containerIdMap,
  selectedContainer,
});

const {
  detailSbomError,
  detailSbomLoading,
  detailVulnerabilityError,
  detailVulnerabilityLoading,
  getVulnerabilityPackage,
  lifecycleHookTemplateVariables,
  loadDetailSbom,
  loadDetailSecurityData,
  normalizeSeverity,
  runtimeOriginLabel,
  runtimeOriginStyle,
  sbomComponentCount,
  sbomDocument,
  sbomGeneratedAt,
  selectedAutoRollbackConfig,
  selectedComposePaths,
  selectedImageMetadata,
  selectedLifecycleHooks,
  selectedRuntimeDriftWarnings,
  selectedRuntimeOrigins,
  selectedSbomFormat,
  severityStyle,
  vulnerabilityPreview,
  vulnerabilitySummary,
  vulnerabilityTotal,
} = useContainerSecurity({
  selectedContainerId,
  selectedContainerMeta,
});

const {
  actionInProgress,
  actionPending,
  backupsLoading,
  cancelUpdate,
  containerActionsDisabledReason,
  containerActionsEnabled,
  clearPolicySelected,
  clearMaturityPolicySelected,
  clearSkipsSelected,
  confirmClearPolicy,
  confirmDelete,
  confirmForceUpdate,
  confirmUpdate,
  confirmRollback,
  confirmRestart,
  confirmStop,
  containerPolicyTooltip,
  detailBackups,
  detailComposePreview,
  detailPreview,
  detailTriggers,
  detailUpdateOperations,
  executeAction,
  formatOperationPhase,
  formatOperationStatus,
  formatRollbackReason,
  formatTimestamp,
  getContainerListPolicyState,
  getOperationStatusStyle,
  getTriggerKey,
  isContainerUpdateInProgress,
  isContainerUpdateQueued,
  isContainerScanInProgress,
  isContainerRowLocked,
  policyError,
  policyInProgress,
  policyMessage,
  previewError,
  previewLoading,
  removeSkipDigestSelected,
  removeSkipTagSelected,
  rollbackError,
  rollbackInProgress,
  rollbackMessage,
  rollbackToBackup,
  runAssociatedTrigger,
  runContainerPreview,
  scanContainer,
  selectedHasMaturityPolicy,
  selectedMaturityMinAgeDays,
  selectedMaturityMode,
  selectedSkipDigests,
  selectedSkipTags,
  selectedSnoozeUntil,
  selectedUpdatePolicy,
  setMaturityPolicySelected,
  skipCurrentForSelected,
  skipUpdate,
  skippedUpdates,
  snoozeDateInput,
  maturityModeInput,
  maturityMinAgeDaysInput,
  snoozeSelected,
  snoozeSelectedUntilDate,
  startContainer,
  triggerError,
  triggerMessage,
  triggerRunInProgress,
  triggersLoading,
  unsnoozeSelected,
  updateAllInGroup,
  updateContainer,
  updateOperationsError,
  updateOperationsLoading,
} = useContainerActions({
  activeDetailTab,
  closeFullPage,
  closePanel,
  containerIdMap,
  containerMetaMap,
  containers,
  error,
  loadContainers,
  selectedContainer,
  selectedContainerId,
});

const containerViewMode = useViewMode('containers');
const tableActionStyle = usePreference(
  () => preferences.containers.tableActions,
  (value) => {
    preferences.containers.tableActions = value;
  },
);

const {
  filterSearch,
  filterStatus,
  filterRegistry,
  filterBouncer,
  filterServer,
  filterKind,
  filterHidePinned,
  showFilters,
  activeFilterCount,
  filteredContainers,
  clearFilters,
} = useContainerFilters(containers);
const route = useRoute();
const router = useRouter();

const filterContainerIds = ref<Set<string>>(new Set());

function parseContainerIdsQuery(queryValue: unknown): Set<string> {
  const raw = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

watch(
  () => route.query.containerIds,
  (queryValue) => {
    filterContainerIds.value = parseContainerIdsQuery(queryValue);
  },
  { immediate: true },
);

function clearContainerIdsFilter() {
  filterContainerIds.value = new Set();
  const { containerIds: _omit, ...rest } = route.query as Record<string, unknown>;
  void router.replace({ query: rest as Record<string, string> });
}

const VALID_FILTER_KIND_VALUES = ['all', 'a\u006Ey', 'major', 'minor', 'patch', 'digest'] as const;
type FilterKindQueryValue = (typeof VALID_FILTER_KIND_VALUES)[number];
const DEFAULT_FILTER_KIND: FilterKindQueryValue = 'all';
const VALID_FILTER_KINDS: ReadonlySet<FilterKindQueryValue> = new Set(VALID_FILTER_KIND_VALUES);
const DEFAULT_FILTER_VALUE = 'all';
const QUERY_SYNC_KEYS = new Set([
  'q',
  'filterKind',
  'filterStatus',
  'filterRegistry',
  'filterBouncer',
  'filterServer',
  'groupByStack',
  'sort',
] as const);
const VALID_CONTAINER_SORT_KEYS = [
  'name',
  'image',
  'status',
  'server',
  'registry',
  'bouncer',
  'kind',
  'version',
  'imageAge',
] as const;
type ContainerSortKey = (typeof VALID_CONTAINER_SORT_KEYS)[number];
const DEFAULT_CONTAINER_SORT_KEY: ContainerSortKey = 'name';
const DEFAULT_CONTAINER_SORT_ASC = true;
const VALID_CONTAINER_SORT_KEYS_SET = new Set<string>(VALID_CONTAINER_SORT_KEYS);
const isSyncingRouteFromState = ref(false);

function isFilterKindQueryValue(value: string): value is FilterKindQueryValue {
  return VALID_FILTER_KINDS.has(value as FilterKindQueryValue);
}

function firstQueryValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw : undefined;
}

function isContainerSortKey(value: string): value is ContainerSortKey {
  return VALID_CONTAINER_SORT_KEYS_SET.has(value);
}

function parseSortFromQuery(queryValue: unknown):
  | {
      key: ContainerSortKey;
      asc: boolean;
    }
  | undefined {
  const raw = firstQueryValue(queryValue);
  if (!raw) {
    return undefined;
  }
  if (raw === 'oldest-first') {
    return { key: 'imageAge', asc: true };
  }
  if (raw === 'newest-first') {
    return { key: 'imageAge', asc: false };
  }
  if (raw.endsWith('-desc')) {
    const key = raw.slice(0, -5);
    if (isContainerSortKey(key)) {
      return { key, asc: false };
    }
    return undefined;
  }
  if (isContainerSortKey(raw)) {
    return { key: raw, asc: true };
  }
  return undefined;
}

function encodeSortQueryValue(key: string, asc: boolean): string | undefined {
  if (!isContainerSortKey(key)) {
    return undefined;
  }
  if (key === DEFAULT_CONTAINER_SORT_KEY && asc === DEFAULT_CONTAINER_SORT_ASC) {
    return undefined;
  }
  if (key === 'imageAge') {
    return asc ? 'oldest-first' : 'newest-first';
  }
  return asc ? key : `${key}-desc`;
}

function resolveRouteParamId(rawValue: unknown): string | undefined {
  if (Array.isArray(rawValue)) {
    return typeof rawValue[0] === 'string' ? rawValue[0] : undefined;
  }
  return typeof rawValue === 'string' ? rawValue : undefined;
}

const isContainerLogsRoute = computed(() => route.name === 'container-logs');

function syncRouteDrivenContainerLogsView(): void {
  if (!isContainerLogsRoute.value) {
    return;
  }

  const containerIdFromRoute = resolveRouteParamId((route.params as Record<string, unknown>)?.id);
  if (!containerIdFromRoute) {
    return;
  }

  const targetContainer = containers.value.find(
    (container) => container.id === containerIdFromRoute,
  );

  if (!targetContainer) {
    return;
  }

  selectedContainer.value = targetContainer;
  activeDetailTab.value = 'logs';
  detailPanelOpen.value = false;
  containerFullPage.value = true;
}

function applyFilterKindFromQuery(queryValue: unknown) {
  const raw = firstQueryValue(queryValue);
  if (raw === undefined) {
    return;
  }
  if (!raw) {
    filterKind.value = DEFAULT_FILTER_KIND;
    return;
  }
  filterKind.value = isFilterKindQueryValue(raw) ? raw : DEFAULT_FILTER_KIND;
}

function applyFilterSearchFromQuery(
  queryValue: unknown,
  options?: { clearDropdownFilters?: boolean },
) {
  const raw = firstQueryValue(queryValue);
  filterSearch.value = typeof raw === 'string' ? raw : '';
  if (!options?.clearDropdownFilters) {
    return;
  }
  // When navigating with a search query (e.g. from Ctrl+K), clear persisted
  // dropdown filters so the target container is always visible.
  if (filterSearch.value) {
    filterStatus.value = DEFAULT_FILTER_VALUE;
    filterRegistry.value = DEFAULT_FILTER_VALUE;
    filterBouncer.value = DEFAULT_FILTER_VALUE;
    filterServer.value = DEFAULT_FILTER_VALUE;
    filterKind.value = DEFAULT_FILTER_KIND;
  }
}

function applyOptionalFilterValueFromQuery(
  queryValue: unknown,
  setter: (value: string) => void,
  fallback: string,
) {
  const raw = firstQueryValue(queryValue);
  if (raw === undefined) {
    return;
  }
  setter(raw || fallback);
}

function applySortFromQuery(queryValue: unknown) {
  const sort = parseSortFromQuery(queryValue);
  if (!sort) {
    return;
  }
  containerSortKey.value = sort.key;
  containerSortAsc.value = sort.asc;
}

watch(
  [() => route.name, () => route.path, () => route.params, () => containers.value.length],
  () => {
    syncRouteDrivenContainerLogsView();
  },
  { immediate: true },
);

const serverNames = computed(() => [
  ...new Set(containers.value.map((container) => container.server)),
]);

const containerSortKey = usePreference(
  () => preferences.containers.sort.key,
  (value) => {
    preferences.containers.sort.key = value;
  },
);
const containerSortAsc = usePreference(
  () => preferences.containers.sort.asc,
  (value) => {
    preferences.containers.sort.asc = value;
  },
);
const groupByStack = usePreference(
  () => preferences.containers.groupByStack,
  (value) => {
    preferences.containers.groupByStack = value;
  },
);

function applyGroupByStackFromQuery(queryValue: unknown) {
  const raw = firstQueryValue(queryValue);
  if (raw === undefined) {
    return;
  }
  groupByStack.value = raw === 'true' || raw === '1';
}

watch(
  () => [
    route.query.q,
    route.query.filterKind,
    route.query.filterStatus,
    route.query.filterRegistry,
    route.query.filterBouncer,
    route.query.filterServer,
    route.query.groupByStack,
    route.query.sort,
  ],
  ([
    querySearch,
    queryFilterKind,
    queryFilterStatus,
    queryFilterRegistry,
    queryFilterBouncer,
    queryFilterServer,
    queryGroupByStack,
    querySort,
  ]) => {
    applyFilterSearchFromQuery(querySearch, {
      clearDropdownFilters: !isSyncingRouteFromState.value,
    });
    applyFilterKindFromQuery(queryFilterKind);
    applyOptionalFilterValueFromQuery(
      queryFilterStatus,
      (value) => {
        filterStatus.value = value;
      },
      DEFAULT_FILTER_VALUE,
    );
    applyOptionalFilterValueFromQuery(
      queryFilterRegistry,
      (value) => {
        filterRegistry.value = value;
      },
      DEFAULT_FILTER_VALUE,
    );
    applyOptionalFilterValueFromQuery(
      queryFilterBouncer,
      (value) => {
        filterBouncer.value = value;
      },
      DEFAULT_FILTER_VALUE,
    );
    applyOptionalFilterValueFromQuery(
      queryFilterServer,
      (value) => {
        filterServer.value = value;
      },
      DEFAULT_FILTER_VALUE,
    );
    applyGroupByStackFromQuery(queryGroupByStack);
    applySortFromQuery(querySort);
  },
  { immediate: true },
);

function normalizeQueryRecord(query: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    const normalizedValue = firstQueryValue(value);
    if (normalizedValue !== undefined) {
      normalized[key] = normalizedValue;
    }
  }
  return normalized;
}

function buildSyncedRouteQuery(): Record<string, string> {
  const nextQuery = normalizeQueryRecord(route.query as Record<string, unknown>);
  for (const key of QUERY_SYNC_KEYS) {
    delete nextQuery[key];
  }
  if (filterContainerIds.value.size === 0) {
    delete nextQuery.containerIds;
  }

  if (filterSearch.value) {
    nextQuery.q = filterSearch.value;
  }
  if (filterKind.value !== DEFAULT_FILTER_KIND) {
    nextQuery.filterKind = filterKind.value;
  }
  if (filterStatus.value !== DEFAULT_FILTER_VALUE) {
    nextQuery.filterStatus = filterStatus.value;
  }
  if (filterRegistry.value !== DEFAULT_FILTER_VALUE) {
    nextQuery.filterRegistry = filterRegistry.value;
  }
  if (filterBouncer.value !== DEFAULT_FILTER_VALUE) {
    nextQuery.filterBouncer = filterBouncer.value;
  }
  if (filterServer.value !== DEFAULT_FILTER_VALUE) {
    nextQuery.filterServer = filterServer.value;
  }
  if (groupByStack.value) {
    nextQuery.groupByStack = 'true';
  }
  const sortQuery = encodeSortQueryValue(containerSortKey.value, containerSortAsc.value);
  if (sortQuery) {
    nextQuery.sort = sortQuery;
  }
  return nextQuery;
}

function areQueriesEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

async function syncRouteQueryFromState() {
  if (isContainerLogsRoute.value) {
    return;
  }
  const currentQuery = normalizeQueryRecord(route.query as Record<string, unknown>);
  const nextQuery = buildSyncedRouteQuery();
  if (areQueriesEqual(currentQuery, nextQuery)) {
    return;
  }
  isSyncingRouteFromState.value = true;
  try {
    await router.replace({ query: nextQuery });
  } finally {
    isSyncingRouteFromState.value = false;
  }
}

watch(
  [
    filterSearch,
    filterKind,
    filterStatus,
    filterRegistry,
    filterBouncer,
    filterServer,
    groupByStack,
    containerSortKey,
    containerSortAsc,
  ],
  () => {
    void syncRouteQueryFromState();
  },
);

function toggleContainerSort(key: string) {
  if (containerSortKey.value === key) {
    containerSortAsc.value = !containerSortAsc.value;
  } else {
    containerSortKey.value = key;
    containerSortAsc.value = true;
  }
}

// displayContainers runs projection BEFORE sort so sort-affecting fields (status, updateKind,
// newTag) reflect the held snapshot during a docker recreate window, preventing position shifts.
// When containerIds is set (deep-link e.g. from Security's "View in Containers") it's a directed
// lookup, so it bypasses filter state — otherwise Hide Pinned / kind / server filters could hide
// the exact container the link targets (#299).
const displayContainers = computed<Array<Container & { _pending?: true }>>(() => {
  const ids = filterContainerIds.value;
  const sourceContainers =
    ids.size > 0
      ? containers.value.filter((container) => ids.has(container.id))
      : filteredContainers.value;
  const live = sourceContainers.map((container) =>
    skippedUpdates.value.has(container.id) || skippedUpdates.value.has(container.name)
      ? {
          ...container,
          newTag: undefined,
          releaseLink: undefined,
          updateKind: undefined,
        }
      : container,
  );
  const liveIdentityKeys = new Set(
    live.map((container) => getContainerActionIdentityKey(container)).filter(Boolean),
  );
  const ghosts = [...actionPending.value.values()]
    .filter((snapshot) => !liveIdentityKeys.has(getContainerActionIdentityKey(snapshot)))
    .map((snapshot) => ({ ...snapshot, _pending: true as const }));
  return [...live, ...ghosts].map(projectContainerDisplayState);
});

const sortedContainers = computed(() => {
  const list = [...displayContainers.value];
  const key = containerSortKey.value;
  const dir = containerSortAsc.value ? 1 : -1;
  return list.sort((left, right) => {
    let leftValue: string | number;
    let rightValue: string | number;
    if (key === 'name') {
      leftValue = left.name.toLowerCase();
      rightValue = right.name.toLowerCase();
    } else if (key === 'image') {
      leftValue = left.image.toLowerCase();
      rightValue = right.image.toLowerCase();
    } else if (key === 'status') {
      leftValue = left.status;
      rightValue = right.status;
    } else if (key === 'server') {
      leftValue = left.server;
      rightValue = right.server;
    } else if (key === 'registry') {
      leftValue = left.registry;
      rightValue = right.registry;
    } else if (key === 'bouncer') {
      leftValue = BOUNCER_SORT_ORDER[left.bouncer] ?? 9;
      rightValue = BOUNCER_SORT_ORDER[right.bouncer] ?? 9;
    } else if (key === 'kind') {
      leftValue = UPDATE_KIND_SORT_ORDER[left.updateKind ?? ''] ?? 9;
      rightValue = UPDATE_KIND_SORT_ORDER[right.updateKind ?? ''] ?? 9;
    } else if (key === 'version') {
      leftValue = left.currentTag;
      rightValue = right.currentTag;
    } else if (key === 'imageAge') {
      const leftMs = left.imageCreated ? new Date(left.imageCreated).getTime() : 0;
      const rightMs = right.imageCreated ? new Date(right.imageCreated).getTime() : 0;
      return leftMs < rightMs ? -dir : leftMs > rightMs ? dir : 0;
    } else {
      return 0;
    }
    return leftValue < rightValue ? -dir : leftValue > rightValue ? dir : 0;
  });
});

const groupMembershipMap = ref<Record<string, string>>({});
const collapsedGroups = ref(new Set<string>());

watch(
  () => groupByStack.value,
  (value) => {
    if (value && Object.keys(groupMembershipMap.value).length === 0) {
      void loadGroups();
    }
  },
);

function toggleGroupCollapse(key: string) {
  const next = new Set(collapsedGroups.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  collapsedGroups.value = next;
}

function expandAllGroups() {
  collapsedGroups.value = new Set();
}

function collapseAllGroups() {
  collapsedGroups.value = new Set(
    renderGroups.value.map((group) => group.key).filter((key) => key !== '__flat__'),
  );
}

const allGroupsCollapsed = computed(() => {
  const collapsibleKeys = renderGroups.value
    .map((group) => group.key)
    .filter((key) => key !== '__flat__');
  if (collapsibleKeys.length === 0) {
    return false;
  }
  return collapsibleKeys.every((key) => collapsedGroups.value.has(key));
});

async function loadGroups() {
  try {
    const groups: ContainerGroup[] = await getContainerGroups();
    const map: Record<string, string> = {};
    for (const group of groups) {
      if (!group.name) {
        continue;
      }
      for (const container of group.containers) {
        const groupKey =
          (typeof container.id === 'string' && container.id) ||
          (typeof container.displayName === 'string' && container.displayName) ||
          (typeof container.name === 'string' && container.name) ||
          undefined;
        if (!groupKey) {
          continue;
        }
        map[groupKey] = group.name;
      }
    }
    groupMembershipMap.value = map;
  } catch {
    groupMembershipMap.value = {};
  }
}

interface RenderGroup {
  key: string;
  name: string | null;
  containers: typeof displayContainers.value;
  containerCount: number;
  updatesAvailable: number;
  updatableCount: number;
}

const groupedContainers = computed<RenderGroup[]>(() => {
  const map = groupMembershipMap.value;
  const buckets: Record<string, typeof displayContainers.value> = {};
  for (const container of sortedContainers.value) {
    const groupName = map[container.id] ?? map[container.name] ?? null;
    const key = groupName ?? '__ungrouped__';
    if (!buckets[key]) {
      buckets[key] = [];
    }
    buckets[key].push(container);
  }
  // Flatten single-container stacks into the ungrouped bucket so they render
  // without a collapsible group header (GitHub Discussion #179).
  for (const key of Object.keys(buckets)) {
    if (key !== '__ungrouped__' && buckets[key].length === 1) {
      if (!buckets.__ungrouped__) {
        buckets.__ungrouped__ = [];
      }
      buckets.__ungrouped__.push(...buckets[key]);
      delete buckets[key];
    }
  }
  const named: RenderGroup[] = [];
  let ungrouped: RenderGroup | null = null;
  for (const [key, groupContainers] of Object.entries(buckets)) {
    const group: RenderGroup = {
      key,
      name: key === '__ungrouped__' ? null : key,
      containers: groupContainers,
      containerCount: groupContainers.length,
      updatesAvailable: groupContainers.filter((container) => container.newTag).length,
      // updatableCount excludes any hard-eligibility-blocked container so the Update-all
      // button doesn't enqueue agent-mismatched / no-trigger / rollback / security-blocked
      // rows that the API would only reject one-by-one. Soft blockers stay updatable
      // (manual bypass via the per-row Update button + confirm modal).
      updatableCount: groupContainers.filter(
        (container) => container.newTag && !hasHardBlocker(container.updateEligibility),
      ).length,
    };
    if (key === '__ungrouped__') {
      ungrouped = group;
    } else {
      named.push(group);
    }
  }
  named.sort((left, right) => left.key.localeCompare(right.key));
  if (ungrouped) {
    named.push(ungrouped);
  }
  return named;
});

const renderGroups = computed<RenderGroup[]>(() => {
  if (!groupByStack.value) {
    return [
      {
        key: '__flat__',
        name: null,
        containers: sortedContainers.value,
        containerCount: sortedContainers.value.length,
        updatesAvailable: sortedContainers.value.filter((container) => container.newTag).length,
        updatableCount: sortedContainers.value.filter(
          (container) => container.newTag && !hasHardBlocker(container.updateEligibility),
        ).length,
      },
    ];
  }
  return groupedContainers.value;
});

const { allColumns, visibleColumns, activeColumns, showColumnPicker, toggleColumn } =
  useColumnVisibility();

const tableColumns = computed(() =>
  activeColumns.value.map((column) => ({
    key: column.key,
    label: column.label,
    align: column.align,
    sortable: column.key !== 'icon',
    width: column.width,
    px: column.px,
    icon: column.key === 'icon',
  })),
);

onMounted(() => {
  if (isContainerLogsRoute.value) {
    return;
  }

  const saved = detailPanelStorage.read();
  if (!saved) {
    return;
  }

  const container = containers.value.find((entry) => entry.name === saved.name);
  if (container) {
    selectedContainer.value = container;
    activeDetailTab.value = saved.tab;
    detailPanelOpen.value = saved.panel;
    containerFullPage.value = saved.full;
    panelSize.value = saved.size;
  }
});

const openActionsMenu = ref<string | null>(null);
const actionsMenuStyle = ref<Record<string, string>>({});

// Estimated max menu heights — used so popovers flip above the trigger when
// available room below the viewport is shorter than the menu would render at.
// Slightly generous to bias toward correct behavior on the boundary.
const ACTIONS_MENU_ESTIMATED_HEIGHT_PX = 320;
const COLUMN_PICKER_ESTIMATED_HEIGHT_PX = 360;
const POPOVER_GAP_PX = 4;

type PopoverHorizontalAnchor = { right: number } | { left: number };

function buildPopoverStyle(
  rect: DOMRect,
  horizontalAnchor: PopoverHorizontalAnchor,
  estimatedHeightPx: number,
): Record<string, string> {
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const flipUp = spaceBelow < estimatedHeightPx && spaceAbove > spaceBelow;
  const verticalAnchor = flipUp
    ? { bottom: `${window.innerHeight - rect.top + POPOVER_GAP_PX}px` }
    : { top: `${rect.bottom + POPOVER_GAP_PX}px` };
  const horizontal =
    'right' in horizontalAnchor
      ? { right: `${horizontalAnchor.right}px` }
      : { left: `${horizontalAnchor.left}px` };
  return { position: 'fixed', ...verticalAnchor, ...horizontal };
}

function toggleActionsMenu(name: string, event: MouseEvent) {
  if (openActionsMenu.value === name) {
    openActionsMenu.value = null;
    return;
  }
  openActionsMenu.value = name;
  const button = event.currentTarget as HTMLElement;
  const rect = button.getBoundingClientRect();
  actionsMenuStyle.value = buildPopoverStyle(
    rect,
    { right: window.innerWidth - rect.right },
    ACTIONS_MENU_ESTIMATED_HEIGHT_PX,
  );
}

function closeActionsMenu() {
  openActionsMenu.value = null;
}

const columnPickerStyle = ref<Record<string, string>>({});
function toggleColumnPicker(event: MouseEvent) {
  showColumnPicker.value = !showColumnPicker.value;
  if (showColumnPicker.value) {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    columnPickerStyle.value = buildPopoverStyle(
      rect,
      { left: rect.left },
      COLUMN_PICKER_ESTIMATED_HEIGHT_PX,
    );
  }
}

function handleGlobalClick() {
  openActionsMenu.value = null;
  showColumnPicker.value = false;
}

// Popovers are position:fixed and anchored at click-time via getBoundingClientRect;
// scrolling moves the trigger button while the popover stays put. Close on scroll
// to keep the popover from drifting away from its visual anchor.
function handleGlobalScroll() {
  if (openActionsMenu.value !== null || showColumnPicker.value) {
    openActionsMenu.value = null;
    showColumnPicker.value = false;
  }
}

// Refreshes container list and security detail data. Used on (re)connect and resync-required
// events where the whole list needs a reconciliation sweep, and as the fallback path when
// applyContainerPatch cannot derive identity from a malformed SSE payload.
async function handleSseContainerChanged() {
  await loadContainers();
  if (selectedContainerId.value) {
    await loadDetailSecurityData();
  }
}

// Scan-completed only refreshes security detail — container-changed events emitted by the same
// scan cycle already drive loadContainers() via the debounced container-changed listener.
// Calling loadContainers() here would produce a duplicate GET /api/containers per scan.
async function handleSseScanCompleted() {
  if (selectedContainerId.value) {
    await loadDetailSecurityData();
  }
}

const sseScanCompletedListener = handleSseScanCompleted as EventListener;

type ContainerPatchKind = 'added' | 'updated' | 'removed';

function findContainerIndexByIdOrName(id: unknown, name: unknown): number {
  return containers.value.findIndex(
    (c) =>
      (typeof id === 'string' && id.length > 0 && c.id === id) ||
      (typeof name === 'string' && name.length > 0 && c.name === name),
  );
}

// Patch the id+meta maps once per SSE event instead of spread-copying the full
// map per field. On a 400-container deployment the old code did 4 full
// O(N) spreads per event (id-key, meta-key, alias-key, alias-meta-key); this
// does 2. Identity still changes per call so downstream caches keyed on
// `containerMetaMap.value !== cached` invalidate correctly. See #301.
function updateLookupMapsForContainer(raw: Record<string, unknown>) {
  const containerId = typeof raw.id === 'string' ? raw.id : '';
  if (!containerId) {
    return;
  }
  const uiName =
    typeof raw.displayName === 'string' && raw.displayName.trim().length > 0
      ? raw.displayName
      : typeof raw.name === 'string'
        ? raw.name
        : '';

  const nextId = { ...containerIdMap.value, [containerId]: containerId };
  const nextMeta = { ...containerMetaMap.value, [containerId]: raw };
  if (uiName) {
    nextId[uiName] = containerId;
    nextMeta[uiName] = raw;
  }
  containerIdMap.value = nextId;
  containerMetaMap.value = nextMeta;
}

function removeLookupMapsForContainer(id: string, name: string | undefined) {
  const current = containerIdMap.value;
  const hasId = !!id && current[id] !== undefined;
  const hasName = !!name && current[name] !== undefined;
  if (!hasId && !hasName) {
    return;
  }
  const nextId = { ...containerIdMap.value };
  const nextMeta = { ...containerMetaMap.value };
  if (hasId) {
    delete nextId[id];
    delete nextMeta[id];
  }
  if (hasName) {
    delete nextId[name!];
    delete nextMeta[name!];
  }
  containerIdMap.value = nextId;
  containerMetaMap.value = nextMeta;
}

/**
 * Look up an active operation in the Pinia operations store by container id
 * and coerce it to the ContainerUpdateOperation shape used on row objects.
 * Returns undefined when no active operation exists for the given id.
 */
function resolveStoreOperation(containerId: string): ContainerUpdateOperation | undefined {
  const storeOp = operationStore.getOperationByContainerId(containerId);
  if (!storeOp) {
    return undefined;
  }
  return {
    id: storeOp.operationId,
    status: storeOp.status as ContainerUpdateOperation['status'],
    phase: (storeOp.phase ?? 'queued') as ContainerUpdateOperation['phase'],
    batchId: storeOp.batchId,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Deferred operation re-attach for SSE ordering races.
 *
 * In the direct-controller path, dd:update-operation-changed fires synchronously
 * before dd:container-added (the container event is debounced through the watcher),
 * so resolveStoreOperation() finds the operation immediately. In the agent-relay
 * path ordering is NOT guaranteed: dd:container-added can win the race and push a
 * row before the operation lands in the store.
 *
 * When the synchronous lookup misses, this function sets up a one-shot watcher on
 * operationStore.getOperationByContainerId(containerId). When the operation arrives,
 * the watcher attaches it to the row. The watcher self-cancels on success, when the
 * container is removed, or after DEFERRED_OPERATION_ATTACH_TIMEOUT_MS to bound
 * watcher lifetime. At most one watcher exists per container ID.
 */
function attachOperationWhenAvailable(containerId: string, name: string | undefined) {
  // Cancel any existing watcher for this container to avoid stacking.
  const existingStop = pendingOperationWatchers.get(containerId);
  if (existingStop) {
    existingStop();
    pendingOperationWatchers.delete(containerId);
    const existingTimer = pendingOperationWatcherTimers.get(containerId);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      pendingOperationWatcherTimers.delete(containerId);
    }
  }

  const stop = watch(
    () => operationStore.getOperationByContainerId(containerId),
    (op) => {
      if (!op) {
        return;
      }
      const idx = findContainerIndexByIdOrName(containerId, name);
      if (idx === -1) {
        // Container was removed before the operation arrived.
        cleanup();
        return;
      }
      if (containers.value[idx]!.updateOperation === undefined) {
        containers.value[idx]!.updateOperation = resolveStoreOperation(containerId);
      }
      cleanup();
    },
    { immediate: false },
  );

  function cleanup() {
    stop();
    pendingOperationWatchers.delete(containerId);
    const timer = pendingOperationWatcherTimers.get(containerId);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingOperationWatcherTimers.delete(containerId);
    }
  }

  pendingOperationWatchers.set(containerId, stop);

  const timeoutTimer = setTimeout(() => {
    pendingOperationWatcherTimers.delete(containerId);
    // stop() also removes from pendingOperationWatchers via cleanup() if still present,
    // but we call stop directly here since the timer callback owns the cleanup.
    stop();
    pendingOperationWatchers.delete(containerId);
  }, DEFERRED_OPERATION_ATTACH_TIMEOUT_MS);
  pendingOperationWatcherTimers.set(containerId, timeoutTimer);
}

// Apply a single-container SSE payload in place instead of falling back to a
// full GET /api/v1/containers + remap + array reassign. The backend emits the
// full validated container object on dd:container-added/-updated, so we can
// run it through mapApiContainer() and merge field-by-field onto the matching
// row — preserving row object identity so downstream computeds
// (filteredContainers → displayContainers → sortedContainers → groupedContainers)
// do not invalidate for unaffected rows. Falls back to loadContainers() when
// the payload is malformed or the mapper cannot derive identity.
function applyContainerPatch(event: Event, kind: ContainerPatchKind) {
  const raw = (event as CustomEvent)?.detail as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    void handleSseContainerChanged();
    return;
  }
  const id = typeof raw.id === 'string' ? raw.id : undefined;
  const name = typeof raw.name === 'string' ? raw.name : undefined;
  if (!id && !name) {
    void handleSseContainerChanged();
    return;
  }

  if (kind === 'removed') {
    const idx = findContainerIndexByIdOrName(id, name);
    if (idx !== -1) {
      containers.value.splice(idx, 1);
    }
    // If a deferred operation-attach watcher is pending for this container, cancel
    // it immediately — no point attaching an operation to a container that is gone.
    if (id) {
      const stop = pendingOperationWatchers.get(id);
      if (stop) {
        stop();
        pendingOperationWatchers.delete(id);
        const timer = pendingOperationWatcherTimers.get(id);
        if (timer !== undefined) {
          clearTimeout(timer);
          pendingOperationWatcherTimers.delete(id);
        }
      }
    }
    removeLookupMapsForContainer(id ?? '', name);
    reconcileHoldsAgainstContainers(containers.value);
    return;
  }

  let mapped: Container;
  try {
    mapped = mapApiContainer(raw);
  } catch {
    void handleSseContainerChanged();
    return;
  }

  const idx = findContainerIndexByIdOrName(id, name);
  if (idx === -1) {
    if (kind === 'added' || kind === 'updated') {
      // Container metadata SSE doesn't carry updateOperation. If there's an active
      // operation in the store keyed to this container's id or newContainerId,
      // attach it before push so reconcileHoldsAgainstContainers doesn't
      // false-positive-release the hold.
      if (mapped.updateOperation === undefined) {
        mapped.updateOperation = resolveStoreOperation(mapped.id);
      }
      containers.value.push(mapped);
      // Deferred fallback: if the synchronous lookup still found nothing, set up a
      // one-shot watcher so the operation is attached as soon as it arrives in the
      // store. This covers the agent-relay path where dd:container-added can arrive
      // before dd:update-operation-changed with no ordering guarantee.
      if (mapped.updateOperation === undefined) {
        attachOperationWhenAvailable(mapped.id, mapped.name);
      }
    }
  } else {
    // In-place merge preserves the row object identity; downstream row wrappers
    // and :key bindings therefore keep pointing at the same object reference.
    //
    // updateOperation is owned by the SSE operation-stream pipeline
    // (applyOperationPatch → applyUpdateOperationSseToHold). Container-metadata
    // SSE events (dd:container-updated / dd:container-added) carry only container
    // metadata — they do not carry the live updateOperation. If we blindly
    // Object.assign the mapped result, mapped.updateOperation (undefined) clobbers
    // the row's live updateOperation, causing reconcileHoldsAgainstContainers to
    // read undefined status → rawIsActive:false → scheduleHeldOperationRelease.
    // Preserve the existing operation when the patch does not carry a replacement.
    // When neither the row nor the patch carry an operation, fall back to the store.
    const existingOp = containers.value[idx]!.updateOperation;
    Object.assign(containers.value[idx]!, mapped);
    if (mapped.updateOperation === undefined) {
      containers.value[idx]!.updateOperation =
        existingOp ?? resolveStoreOperation(containers.value[idx]!.id);
    }
  }
  updateLookupMapsForContainer(raw);
  reconcileHoldsAgainstContainers(containers.value);
}

function findContainerForOperationTarget(target: {
  containerId?: string;
  newContainerId?: string;
  containerName?: string;
}): Container | undefined {
  const idx = containers.value.findIndex(
    (c) =>
      (typeof target.containerId === 'string' && c.id === target.containerId) ||
      (typeof target.newContainerId === 'string' && c.id === target.newContainerId) ||
      (typeof target.containerName === 'string' && c.name === target.containerName),
  );
  return idx === -1 ? undefined : containers.value[idx];
}

function applyOperationPatch(event: Event) {
  const parsed = parseUpdateOperationSsePayload((event as CustomEvent)?.detail);
  if (!parsed) {
    return;
  }
  applyUpdateOperationSseToHold({
    parsed,
    resolveContainer: findContainerForOperationTarget,
    // ContainersView drives row reactivity by mutating updateOperation in place,
    // so the view keeps responsibility for that while the composable owns the
    // hold map + snapshot.
    onActiveOperationComputed: ({ container, nextOperation }) => {
      (container as Container).updateOperation = nextOperation;
    },
    // Terminal operation SSEs can race ahead of the container-list refresh that
    // renames the row post-recreate, so still release the hold even when the row
    // has already fallen out of containers.value.
    onTerminalEvent: ({ container, status }) => {
      const reason = resolveUpdateFailureReason({
        lastError: parsed.lastError,
        rollbackReason: parsed.rollbackReason,
      });
      if (container) {
        (container as Container).updateOperation = undefined;
        if (
          status === 'failed' ||
          (status === 'rolled-back' && parsed.rollbackReason !== 'cancelled')
        ) {
          (container as Container).lastUpdateFailureReason = reason ?? 'Update failed';
          (container as Container).lastUpdateFailureAt = Date.now();
        } else if (status === 'succeeded') {
          (container as Container).lastUpdateFailureReason = undefined;
          (container as Container).lastUpdateFailureAt = undefined;
        }
      }
      // Resync the full list so the row reflects post-update state — new image
      // tag on success, restored update-available banner with lastUpdateFailureReason
      // on failure. Granular SSE patches don't always cover renames/new container IDs.
      schedulePostTerminalReload();
    },
  });
}

function handleSseUpdateApplied(event: Event) {
  const detail = (event as CustomEvent)?.detail as Record<string, unknown> | undefined;
  if (!detail) {
    return;
  }
  const operationId = typeof detail.operationId === 'string' ? detail.operationId : undefined;
  const containerName =
    typeof detail.containerName === 'string' ? detail.containerName : 'container';
  const batchId = detail.batchId ?? null;
  // Batch completions are handled by Track D — suppress per-container toast.
  if (batchId !== null) {
    return;
  }
  if (!operationId) {
    return;
  }
  scheduleCompletionToast(() =>
    toast.success(t('containersView.toast.updated', { name: containerName })),
  );
}

function handleSseUpdateFailed(event: Event) {
  const detail = (event as CustomEvent)?.detail as Record<string, unknown> | undefined;
  if (!detail) {
    return;
  }
  const operationId = typeof detail.operationId === 'string' ? detail.operationId : undefined;
  const containerName =
    typeof detail.containerName === 'string' ? detail.containerName : 'container';
  const batchId = detail.batchId ?? null;
  if (batchId !== null) {
    return;
  }
  if (!operationId) {
    return;
  }
  // Classify the failure reason from the SSE payload. The dd:update-failed payload
  // carries `error` and `rollbackReason`; the presence of rollbackReason signals
  // a rolled-back (vs failed) terminal state and drives the toast variant.
  const error = typeof detail.error === 'string' ? detail.error : undefined;
  const rollbackReason =
    typeof detail.rollbackReason === 'string' ? detail.rollbackReason : undefined;
  const reason = resolveUpdateFailureReason({ lastError: error, rollbackReason });
  const isCancelled = rollbackReason === 'cancelled' || error === 'Cancelled by operator';
  if (rollbackReason !== undefined) {
    if (isCancelled) {
      scheduleCompletionToast(() =>
        toast.success(t('containersView.toast.cancelled', { name: containerName })),
      );
    } else {
      scheduleCompletionToast(() =>
        toast.warning(
          reason
            ? t('containersView.toast.rolledBackWithReason', { name: containerName, reason })
            : t('containersView.toast.rolledBack', { name: containerName }),
        ),
      );
    }
  } else {
    scheduleCompletionToast(() =>
      toast.error(
        reason
          ? t('containersView.toast.updateFailedWithReason', { name: containerName, reason })
          : t('containersView.toast.updateFailed', { name: containerName }),
      ),
    );
  }
}

const sseUpdateAppliedListener = handleSseUpdateApplied as EventListener;
const sseUpdateFailedListener = handleSseUpdateFailed as EventListener;

const sseConnectedListener = handleSseContainerChanged as EventListener;
const sseResyncRequiredListener = handleSseContainerChanged as EventListener;
const sseUpdateOperationChangedListener = ((event: Event) => {
  applyOperationPatch(event);
}) as EventListener;
const sseContainerAddedListener = ((event: Event) => {
  applyContainerPatch(event, 'added');
}) as EventListener;
const sseContainerUpdatedListener = ((event: Event) => {
  applyContainerPatch(event, 'updated');
}) as EventListener;
const sseContainerRemovedListener = ((event: Event) => {
  applyContainerPatch(event, 'removed');
}) as EventListener;
onMounted(() => {
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('scroll', handleGlobalScroll, true);
  globalThis.addEventListener('dd:sse-scan-completed', sseScanCompletedListener);
  globalThis.addEventListener('dd:sse-container-added', sseContainerAddedListener);
  globalThis.addEventListener('dd:sse-container-updated', sseContainerUpdatedListener);
  globalThis.addEventListener('dd:sse-container-removed', sseContainerRemovedListener);
  globalThis.addEventListener('dd:sse-update-operation-changed', sseUpdateOperationChangedListener);
  globalThis.addEventListener('dd:sse-connected', sseConnectedListener);
  globalThis.addEventListener('dd:sse-resync-required', sseResyncRequiredListener);
  globalThis.addEventListener('dd:sse-update-applied', sseUpdateAppliedListener);
  globalThis.addEventListener('dd:sse-update-failed', sseUpdateFailedListener);
});
onUnmounted(() => {
  clearAllOperationDisplayHolds();
  document.removeEventListener('click', handleGlobalClick);
  document.removeEventListener('scroll', handleGlobalScroll, true);
  globalThis.removeEventListener('dd:sse-scan-completed', sseScanCompletedListener);
  globalThis.removeEventListener('dd:sse-container-added', sseContainerAddedListener);
  globalThis.removeEventListener('dd:sse-container-updated', sseContainerUpdatedListener);
  globalThis.removeEventListener('dd:sse-container-removed', sseContainerRemovedListener);
  globalThis.removeEventListener(
    'dd:sse-update-operation-changed',
    sseUpdateOperationChangedListener,
  );
  globalThis.removeEventListener('dd:sse-connected', sseConnectedListener);
  globalThis.removeEventListener('dd:sse-resync-required', sseResyncRequiredListener);
  globalThis.removeEventListener('dd:sse-update-applied', sseUpdateAppliedListener);
  globalThis.removeEventListener('dd:sse-update-failed', sseUpdateFailedListener);
});

const tt = (label: string) => ({ value: label, showDelay: 400 });

function hasRegistryError(container: Container): boolean {
  return typeof container.registryError === 'string' && container.registryError.trim().length > 0;
}

function registryErrorTooltip(container: Container): string {
  if (!hasRegistryError(container)) {
    return t('containersView.registryError.generic');
  }
  return t('containersView.registryError.detail', { error: container.registryError });
}

provide(containersViewTemplateContextKey, {
  error,
  loading,
  containers,
  containerViewMode,
  showFilters,
  filteredContainers,
  activeFilterCount,
  filterSearch,
  filterStatus,
  filterBouncer,
  filterRegistry,
  filterServer,
  serverNames,
  filterKind,
  filterHidePinned,
  clearFilters,
  showColumnPicker,
  toggleColumnPicker,
  columnPickerStyle,
  allColumns,
  toggleColumn,
  visibleColumns,
  tt,
  groupByStack,
  rechecking,
  recheckAll,
  renderGroups,
  toggleGroupCollapse,
  collapsedGroups,
  expandAllGroups,
  collapseAllGroups,
  allGroupsCollapsed,
  containerActionsEnabled,
  containerActionsDisabledReason,
  actionInProgress,
  cancelUpdate,
  isContainerUpdateInProgress,
  isContainerUpdateQueued,
  isContainerScanInProgress,
  isContainerRowLocked,
  updateAllInGroup,
  tableColumns,
  containerSortKey,
  containerSortAsc,
  selectedContainer,
  isCompact,
  selectContainer,
  tableActionStyle,
  openActionsMenu,
  toggleActionsMenu,
  updateContainer,
  confirmUpdate,
  confirmStop,
  startContainer,
  confirmRestart,
  scanContainer,
  confirmForceUpdate,
  skipUpdate,
  closeActionsMenu,
  confirmDelete,
  displayContainers,
  actionsMenuStyle,
  updateKindColor,
  maturityColor,
  hasRegistryError,
  registryErrorTooltip,
  containerPolicyTooltip,
  getContainerListPolicyState,
  serverBadgeColor,
  parseServer,
  registryColorBg,
  registryColorText,
  registryLabel,
  detailPanelOpen,
  isMobile,
  panelSize,
  closePanel,
  openFullPage,
  detailTabs,
  activeDetailTab,
  selectedRuntimeOrigins,
  runtimeOriginStyle,
  runtimeOriginLabel,
  selectedRuntimeDriftWarnings,
  selectedComposePaths,
  selectedLifecycleHooks,
  lifecycleHookTemplateVariables,
  selectedAutoRollbackConfig,
  selectedImageMetadata,
  formatTimestamp,
  detailVulnerabilityLoading,
  detailSbomLoading,
  loadDetailSecurityData,
  detailVulnerabilityError,
  vulnerabilitySummary,
  vulnerabilityTotal,
  vulnerabilityPreview,
  severityStyle,
  normalizeSeverity,
  getVulnerabilityPackage,
  selectedSbomFormat,
  loadDetailSbom,
  detailSbomError,
  sbomDocument,
  sbomComponentCount,
  sbomGeneratedAt,
  LOG_AUTO_FETCH_INTERVALS,
  containerAutoFetchInterval,
  getContainerLogs,
  containerLogRef,
  containerHandleLogScroll,
  containerScrollBlocked,
  containerResumeAutoScroll,
  previewLoading,
  runContainerPreview,
  policyInProgress,
  skipCurrentForSelected,
  snoozeSelected,
  snoozeDateInput,
  snoozeSelectedUntilDate,
  selectedSnoozeUntil,
  unsnoozeSelected,
  selectedSkipTags,
  selectedSkipDigests,
  clearSkipsSelected,
  selectedUpdatePolicy,
  selectedHasMaturityPolicy,
  selectedMaturityMode,
  selectedMaturityMinAgeDays,
  maturityModeInput,
  maturityMinAgeDaysInput,
  setMaturityPolicySelected,
  clearMaturityPolicySelected,
  confirmClearPolicy,
  clearPolicySelected,
  policyMessage,
  policyError,
  removeSkipTagSelected,
  removeSkipDigestSelected,
  detailPreview,
  detailComposePreview,
  previewError,
  triggersLoading,
  detailTriggers,
  getTriggerKey,
  triggerRunInProgress,
  runAssociatedTrigger,
  triggerMessage,
  triggerError,
  backupsLoading,
  detailBackups,
  rollbackInProgress,
  confirmRollback,
  rollbackToBackup,
  rollbackMessage,
  rollbackError,
  updateOperationsLoading,
  detailUpdateOperations,
  getOperationStatusStyle,
  formatOperationStatus,
  formatOperationPhase,
  formatRollbackReason,
  updateOperationsError,
  closeFullPage,
  filterContainerIds,
  clearContainerIdsFilter,
});
</script>

<template>
  <DataViewLayout v-if="!containerFullPage">
    <ContainersListContent />
    <template #panel>
      <ContainerSideDetail />
    </template>
  </DataViewLayout>
  <ContainerFullPageDetail v-if="containerFullPage && selectedContainer" />
</template>
