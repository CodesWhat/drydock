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
import { preferences } from '../preferences/store';
import { usePreference } from '../preferences/usePreference';
import { useViewMode } from '../preferences/useViewMode';
import type { ContainerGroup } from '../services/container';
import { getAllContainers, getContainerGroups, refreshAllContainers } from '../services/container';
import type { Container } from '../types/container';
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

async function loadContainers() {
  try {
    const apiContainers = await getAllContainers();
    containers.value = mapApiContainers(apiContainers);
    const { idMap, metaMap } = buildContainerLookupMaps(apiContainers as Record<string, unknown>[]);
    containerIdMap.value = idMap;
    containerMetaMap.value = metaMap;
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

const { isMobile, windowNarrow } = useBreakpoints();

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

const isCompact = computed(() => windowNarrow.value || detailPanelOpen.value);

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

const sortedContainers = computed(() => {
  const list = [...filteredContainers.value];
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

const displayContainers = computed(() => {
  const live = sortedContainers.value.map((container) =>
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
  return [...live, ...ghosts];
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
  for (const container of displayContainers.value) {
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
        containers: displayContainers.value,
        containerCount: displayContainers.value.length,
        updatesAvailable: displayContainers.value.filter((container) => container.newTag).length,
        updatableCount: displayContainers.value.filter(
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
    width: column.key === 'name' ? '99%' : column.key === 'icon' ? '40px' : undefined,
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

async function handleSseScanCompleted() {
  await loadContainers();
  if (selectedContainerId.value) {
    await loadDetailSecurityData();
  }
}

const sseScanCompletedListener = handleSseScanCompleted as EventListener;
const sseContainerChangedListener = (() => {
  clearSseContainerChangedTimer();
  sseContainerChangedTimer = setTimeout(() => {
    sseContainerChangedTimer = undefined;
    void handleSseScanCompleted();
  }, SSE_CONTAINER_CHANGED_DEBOUNCE_MS);
}) as EventListener;
const ACTIVE_OP_STATUSES = new Set(['queued', 'in-progress']);

function applyOperationPatch(event: Event) {
  const payload = (event as CustomEvent)?.detail;
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const { operationId, containerId, newContainerId, containerName, status, phase } =
    payload as Record<string, unknown>;
  if (typeof status !== 'string') {
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

  const updated = { ...containers.value[idx] };
  if (ACTIVE_OP_STATUSES.has(status)) {
    updated.updateOperation = {
      ...(updated.updateOperation || {}),
      id: typeof operationId === 'string' ? operationId : (updated.updateOperation?.id ?? ''),
      status: status as 'queued' | 'in-progress',
      phase: (typeof phase === 'string' ? phase : status) as typeof updated.updateOperation.phase,
      updatedAt: new Date().toISOString(),
    };
  } else {
    updated.updateOperation = undefined;
  }

  const next = [...containers.value];
  next[idx] = updated;
  containers.value = next;
}

const sseConnectedListener = handleSseScanCompleted as EventListener;
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
});
onUnmounted(() => {
  clearSseContainerChangedTimer();
  document.removeEventListener('click', handleGlobalClick);
  globalThis.removeEventListener('dd:sse-scan-completed', sseScanCompletedListener);
  globalThis.removeEventListener('dd:sse-container-changed', sseContainerChangedListener);
  globalThis.removeEventListener(
    'dd:sse-update-operation-changed',
    sseUpdateOperationChangedListener,
  );
  globalThis.removeEventListener('dd:sse-connected', sseConnectedListener);
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
