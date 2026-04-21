<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
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
import { useOperationDisplayHold } from '../composables/useOperationDisplayHold';
import { useToast } from '../composables/useToast';
import { preferences } from '../preferences/store';
import { usePreference } from '../preferences/usePreference';
import { useViewMode } from '../preferences/useViewMode';
import type { ContainerGroup } from '../services/container';
import { getAllContainers, getContainerGroups, refreshAllContainers } from '../services/container';
import type { Container } from '../types/container';
import {
  isActiveContainerUpdateOperationPhaseForStatus,
  isActiveContainerUpdateOperationStatus,
  isContainerUpdateOperationStatus,
  type ActiveContainerUpdateOperationPhase,
} from '../types/update-operation';
import { getContainerActionIdentityKey } from '../utils/container-action-key';
import { mapApiContainers } from '../utils/container-mapper';
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

const loading = ref(true);
const error = ref<string | null>(null);

const containers = ref<Container[]>([]);
const containerIdMap = ref<Record<string, string>>({});
const containerMetaMap = ref<Record<string, unknown>>({});
const {
  clearAllOperationDisplayHolds,
  findMatchingOperationIds,
  holdOperationDisplay,
  projectContainerDisplayState,
  reconcileHoldsAgainstContainers,
  scheduleHeldOperationRelease,
  clearHeldOperation,
} = useOperationDisplayHold();
const toast = useToast();

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
 * Performance note: this walk is O(N × fields) but produces no Vue reactive
 * side-effects and allocates far less than the chain re-eval + DOM diffing
 * that would otherwise occur on every cron-triggered reload.
 */
function fingerprintValue(value: unknown): string | undefined {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return JSON.stringify(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    case 'object':
      break;
    default:
      return JSON.stringify(String(value));
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => fingerprintValue(item) ?? 'null').join(',')}]`;
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toJSON());
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .flatMap((key) => {
      const serialized = fingerprintValue(record[key]);
      return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`];
    });
  return `{${entries.join(',')}}`;
}

function containerListFingerprint(list: Container[]): string {
  return fingerprintValue(list) ?? '[]';
}

async function loadContainers() {
  try {
    const apiContainers = await getAllContainers();
    const mapped = mapApiContainers(apiContainers);
    // Skip reactive assignment (and downstream chain re-eval) when incoming
    // data is bit-for-bit identical to the current list.
    if (
      containers.value.length !== mapped.length ||
      containerListFingerprint(mapped) !== containerListFingerprint(containers.value)
    ) {
      containers.value = mapped;
    }
    const { idMap, metaMap } = buildContainerLookupMaps(apiContainers as Record<string, unknown>[]);
    containerIdMap.value = idMap;
    containerMetaMap.value = metaMap;
    reconcileHoldsAgainstContainers(containers.value);
    if (groupByStack.value) {
      await loadGroups();
    }
  } catch (e: unknown) {
    error.value = errorMessage(e, 'Failed to load containers');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadContainers();
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
    error.value = errorMessage(e, 'Failed to recheck containers');
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
      updatableCount: groupContainers.filter(
        (container) => container.newTag && container.bouncer !== 'blocked',
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
          (container) => container.newTag && container.bouncer !== 'blocked',
        ).length,
      },
    ];
  }
  return groupedContainers.value;
});

const { allColumns, visibleColumns, activeColumns, showColumnPicker, toggleColumn } =
  useColumnVisibility(isCompact);

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

function toggleActionsMenu(name: string, event: MouseEvent) {
  if (openActionsMenu.value === name) {
    openActionsMenu.value = null;
    return;
  }
  openActionsMenu.value = name;
  const button = event.currentTarget as HTMLElement;
  const rect = button.getBoundingClientRect();
  actionsMenuStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    right: `${window.innerWidth - rect.right}px`,
  };
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
    columnPickerStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
    };
  }
}

function handleGlobalClick() {
  openActionsMenu.value = null;
  showColumnPicker.value = false;
}

const SSE_CONTAINER_CHANGED_DEBOUNCE_MS = 500;
let sseContainerChangedTimer: ReturnType<typeof setTimeout> | undefined;

function clearSseContainerChangedTimer() {
  if (sseContainerChangedTimer === undefined) {
    return;
  }
  clearTimeout(sseContainerChangedTimer);
  sseContainerChangedTimer = undefined;
}

// Refreshes container list and security detail data. Used by container-changed and connected
// events where the container set itself may have changed.
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
const sseContainerChangedListener = (() => {
  clearSseContainerChangedTimer();
  sseContainerChangedTimer = setTimeout(() => {
    sseContainerChangedTimer = undefined;
    void handleSseContainerChanged();
  }, SSE_CONTAINER_CHANGED_DEBOUNCE_MS);
}) as EventListener;
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

function applyOperationPatch(event: Event) {
  const payload = (event as CustomEvent)?.detail;
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const { operationId, containerId, newContainerId, containerName, status, phase } =
    payload as Record<string, unknown>;
  if (!isContainerUpdateOperationStatus(status)) {
    return;
  }

  const idx = containers.value.findIndex(
    (c) =>
      (typeof containerId === 'string' && c.id === containerId) ||
      (typeof newContainerId === 'string' && c.id === newContainerId) ||
      (typeof containerName === 'string' && c.name === containerName),
  );
  if (idx === -1) {
    return;
  }

  // Mutate the container at idx in place instead of spreading containers.value into a new
  // 88-element array. Reassigning the array reference invalidates every downstream computed
  // (filteredContainers, sortedContainers, groupedContainers) on every SSE phase event —
  // targeted mutation triggers re-evaluation only for effects that actually read
  // updateOperation on the matched row.
  const row = containers.value[idx]!;
  if (isActiveContainerUpdateOperationStatus(status)) {
    const nextOperation = {
      ...(row.updateOperation || {}),
      id: typeof operationId === 'string' ? operationId : (row.updateOperation?.id ?? ''),
      status,
      phase: resolveActiveOperationPhase({
        status,
        phase,
        previousPhase: row.updateOperation?.phase,
      }),
      updatedAt: new Date().toISOString(),
    };
    row.updateOperation = nextOperation;
    if (typeof operationId === 'string' && operationId.length > 0) {
      holdOperationDisplay({
        operationId,
        operation: nextOperation,
        containerId: typeof containerId === 'string' ? containerId : undefined,
        newContainerId: typeof newContainerId === 'string' ? newContainerId : undefined,
        containerName: typeof containerName === 'string' ? containerName : undefined,
        sortSnapshot: {
          status: row.status,
          updateKind: row.updateKind,
          newTag: row.newTag,
          currentTag: row.currentTag,
          image: row.image,
          imageCreated: row.imageCreated,
        },
      });
    }
  } else {
    row.updateOperation = undefined;
    const target = {
      operationId: typeof operationId === 'string' ? operationId : undefined,
      containerId: typeof containerId === 'string' ? containerId : undefined,
      newContainerId: typeof newContainerId === 'string' ? newContainerId : undefined,
      containerName: typeof containerName === 'string' ? containerName : undefined,
    };
    const wasTracked = findMatchingOperationIds(target).length > 0;
    if (status === 'succeeded') {
      scheduleHeldOperationRelease(target);
      if (wasTracked) {
        toast.success(`Updated: ${row.name}`);
      }
    } else if (status === 'failed') {
      scheduleHeldOperationRelease(target);
      if (wasTracked) {
        toast.error(`Update failed: ${row.name}`);
      }
    } else if (status === 'rolled-back') {
      scheduleHeldOperationRelease(target);
      if (wasTracked) {
        toast.error(`Rolled back: ${row.name}`);
      }
    } else {
      clearHeldOperation(target);
    }
  }
}

const sseConnectedListener = handleSseContainerChanged as EventListener;
const sseResyncRequiredListener = handleSseContainerChanged as EventListener;
const sseUpdateOperationChangedListener = ((event: Event) => {
  clearSseContainerChangedTimer();
  applyOperationPatch(event);
}) as EventListener;
onMounted(() => {
  document.addEventListener('click', handleGlobalClick);
  globalThis.addEventListener('dd:sse-scan-completed', sseScanCompletedListener);
  globalThis.addEventListener('dd:sse-container-changed', sseContainerChangedListener);
  globalThis.addEventListener('dd:sse-update-operation-changed', sseUpdateOperationChangedListener);
  globalThis.addEventListener('dd:sse-connected', sseConnectedListener);
  globalThis.addEventListener('dd:sse-resync-required', sseResyncRequiredListener);
});
onUnmounted(() => {
  clearSseContainerChangedTimer();
  clearAllOperationDisplayHolds();
  document.removeEventListener('click', handleGlobalClick);
  globalThis.removeEventListener('dd:sse-scan-completed', sseScanCompletedListener);
  globalThis.removeEventListener('dd:sse-container-changed', sseContainerChangedListener);
  globalThis.removeEventListener(
    'dd:sse-update-operation-changed',
    sseUpdateOperationChangedListener,
  );
  globalThis.removeEventListener('dd:sse-connected', sseConnectedListener);
  globalThis.removeEventListener('dd:sse-resync-required', sseResyncRequiredListener);
});

const tt = (label: string) => ({ value: label, showDelay: 400 });

function hasRegistryError(container: Container): boolean {
  return typeof container.registryError === 'string' && container.registryError.trim().length > 0;
}

function registryErrorTooltip(container: Container): string {
  if (!hasRegistryError(container)) {
    return 'Registry error';
  }
  return `Registry error: ${container.registryError}`;
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
  containerActionsEnabled,
  containerActionsDisabledReason,
  actionInProgress,
  isContainerUpdateInProgress,
  isContainerUpdateQueued,
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
