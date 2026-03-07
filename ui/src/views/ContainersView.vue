<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
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
import { mapApiContainers } from '../utils/container-mapper';
import {
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

const loading = ref(true);
const error = ref<string | null>(null);

const containers = ref<Container[]>([]);
const containerIdMap = ref<Record<string, string>>({});
const containerMetaMap = ref<Record<string, unknown>>({});

async function loadContainers() {
  try {
    const apiContainers = await getAllContainers();
    containers.value = mapApiContainers(apiContainers);
    const idMap: Record<string, string> = {};
    const metaMap: Record<string, unknown> = {};
    for (const apiContainer of apiContainers) {
      const uiName = apiContainer.displayName || apiContainer.name;
      idMap[uiName] = apiContainer.id;
      metaMap[uiName] = apiContainer;
    }
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
  try {
    await refreshAllContainers();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await loadContainers();
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
  const refreshed = containers.value.find(
    (container) => container.name === selectedContainer.value?.name,
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

const selectedContainerId = computed(() =>
  selectedContainer.value ? containerIdMap.value[selectedContainer.value.name] : undefined,
);
const selectedContainerMeta = computed<Record<string, unknown> | undefined>(() => {
  if (!selectedContainer.value) {
    return undefined;
  }
  const meta = containerMetaMap.value[selectedContainer.value.name];
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
  clearPolicySelected,
  clearSkipsSelected,
  confirmDelete,
  confirmForceUpdate,
  confirmRestart,
  confirmStop,
  containerPolicyTooltip,
  detailBackups,
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
  groupUpdateInProgress,
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
  selectedSkipDigests,
  selectedSkipTags,
  selectedSnoozeUntil,
  selectedUpdatePolicy,
  skipCurrentForSelected,
  skipUpdate,
  skippedUpdates,
  snoozeDateInput,
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
  showFilters,
  activeFilterCount,
  filteredContainers,
  clearFilters,
} = useContainerFilters(containers);
const route = useRoute();
const VALID_FILTER_KINDS = new Set(['all', 'any', 'major', 'minor', 'patch', 'digest']);

function applyFilterKindFromQuery(queryValue: unknown) {
  const raw = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  if (raw === undefined || raw === null) {
    filterKind.value = 'all';
    return;
  }
  if (typeof raw !== 'string') {
    filterKind.value = 'all';
    return;
  }
  filterKind.value = VALID_FILTER_KINDS.has(raw) ? raw : 'all';
}

function applyFilterSearchFromQuery(queryValue: unknown) {
  const raw = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  filterSearch.value = typeof raw === 'string' ? raw : '';
  // When navigating with a search query (e.g. from Ctrl+K), clear persisted
  // dropdown filters so the target container is always visible.
  if (filterSearch.value) {
    filterStatus.value = 'all';
    filterRegistry.value = 'all';
    filterBouncer.value = 'all';
    filterServer.value = 'all';
  }
}

applyFilterSearchFromQuery(route.query.q);
watch(
  () => route.query.q,
  (value) => applyFilterSearchFromQuery(value),
);

applyFilterKindFromQuery(route.query.filterKind);
watch(
  () => route.query.filterKind,
  (value) => applyFilterKindFromQuery(value),
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
  const kindOrder: Record<string, number> = { major: 0, minor: 1, patch: 2, digest: 3 };
  const bouncerOrder: Record<string, number> = { blocked: 0, unsafe: 1, safe: 2 };
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
      leftValue = bouncerOrder[left.bouncer] ?? 9;
      rightValue = bouncerOrder[right.bouncer] ?? 9;
    } else if (key === 'kind') {
      leftValue = kindOrder[left.updateKind ?? ''] ?? 9;
      rightValue = kindOrder[right.updateKind ?? ''] ?? 9;
    } else if (key === 'version') {
      leftValue = left.currentTag;
      rightValue = right.currentTag;
    } else {
      return 0;
    }
    return leftValue < rightValue ? -dir : leftValue > rightValue ? dir : 0;
  });
});

const displayContainers = computed(() => {
  const live = sortedContainers.value.map((container) =>
    skippedUpdates.value.has(container.name)
      ? {
          ...container,
          newTag: undefined,
          releaseLink: undefined,
          updateKind: undefined,
        }
      : container,
  );
  const liveNames = new Set(live.map((container) => container.name));
  const ghosts = [...actionPending.value.entries()]
    .filter(([name]) => !liveNames.has(name))
    .map(([, snapshot]) => ({ ...snapshot, _pending: true as const }));
  return [...live, ...ghosts];
});

const groupByStack = usePreference(
  () => preferences.containers.groupByStack,
  (value) => {
    preferences.containers.groupByStack = value;
  },
);
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
        const uiName = container.displayName || container.name;
        map[uiName] = group.name;
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
    const groupName = map[container.name] ?? null;
    const key = groupName ?? '__ungrouped__';
    if (!buckets[key]) {
      buckets[key] = [];
    }
    buckets[key].push(container);
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

async function handleSseScanCompleted() {
  await loadContainers();
  if (selectedContainerId.value) {
    await loadDetailSecurityData();
  }
}

const sseScanCompletedListener = handleSseScanCompleted as EventListener;
onMounted(() => {
  document.addEventListener('click', handleGlobalClick);
  globalThis.addEventListener('dd:sse-scan-completed', sseScanCompletedListener);
});
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick);
  globalThis.removeEventListener('dd:sse-scan-completed', sseScanCompletedListener);
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
  groupUpdateInProgress,
  actionInProgress,
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
  clearPolicySelected,
  policyMessage,
  policyError,
  removeSkipTagSelected,
  removeSkipDigestSelected,
  detailPreview,
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
  <ConfirmDialog />
  <DataViewLayout v-if="!containerFullPage">
    <ContainersListContent />
    <template #panel>
      <ContainerSideDetail />
    </template>
  </DataViewLayout>
  <ContainerFullPageDetail v-if="containerFullPage && selectedContainer" />
</template>
