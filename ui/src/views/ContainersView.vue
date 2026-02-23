<script setup lang="ts">
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useColumnVisibility } from '../composables/useColumnVisibility';
import { useContainerFilters } from '../composables/useContainerFilters';
import { useDetailPanel } from '../composables/useDetailPanel';
import { useSorting } from '../composables/useSorting';
import {
  getContainerLogs as fetchContainerLogs,
  getAllContainers,
  getContainerGroups,
  getContainerTriggers,
  refreshAllContainers,
  runTrigger as runContainerTrigger,
  updateContainerPolicy,
} from '../services/container';
import type { ContainerGroup } from '../services/container';
import {
  startContainer as apiStartContainer,
  restartContainer as apiRestartContainer,
  stopContainer as apiStopContainer,
  updateContainer as apiUpdateContainer,
} from '../services/container-actions';
import { getBackups, rollback } from '../services/backup';
import { previewContainer } from '../services/preview';
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

const confirm = useConfirmDialog();

// Loading and error state
const loading = ref(true);
const error = ref<string | null>(null);

// Container data (reactive ref, fetched from API)
const containers = ref<Container[]>([]);

// Map from container name -> API id (needed to call actions/logs by id)
const containerIdMap = ref<Record<string, string>>({});
const containerMetaMap = ref<Record<string, any>>({});

// Fetch containers from API
async function loadContainers() {
  try {
    const apiContainers = await getAllContainers();
    containers.value = mapApiContainers(apiContainers);
    // Build id lookup map
    const idMap: Record<string, string> = {};
    const metaMap: Record<string, any> = {};
    for (const ac of apiContainers) {
      const uiName = ac.displayName || ac.name;
      idMap[uiName] = ac.id;
      metaMap[uiName] = ac;
    }
    containerIdMap.value = idMap;
    containerMetaMap.value = metaMap;
    if (groupByStack.value) {
      await loadGroups();
    }
  } catch (e: any) {
    error.value = e.message || 'Failed to load containers';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadContainers();
});

const rechecking = ref(false);

async function recheckAll() {
  rechecking.value = true;
  try {
    await refreshAllContainers();
    await new Promise((r) => setTimeout(r, 2000));
    await loadContainers();
  } finally {
    rechecking.value = false;
  }
}

// Container logs (fetched async, cached per container)
const containerLogsCache = ref<Record<string, string[]>>({});
const containerLogsLoading = ref<Record<string, boolean>>({});

async function loadContainerLogs(containerName: string) {
  const containerId = containerIdMap.value[containerName];
  if (!containerId) return;
  if (containerLogsCache.value[containerName]) return;
  containerLogsLoading.value[containerName] = true;
  try {
    const result = await fetchContainerLogs(containerId, 100);
    const logs = result?.logs ?? '';
    containerLogsCache.value[containerName] = logs
      ? logs.split('\n').filter((l: string) => l.length > 0)
      : ['No logs available for this container'];
  } catch {
    containerLogsCache.value[containerName] = ['Failed to load container logs'];
  } finally {
    containerLogsLoading.value[containerName] = false;
  }
}

function getContainerLogs(containerName: string): string[] {
  if (!containerLogsCache.value[containerName]) {
    loadContainerLogs(containerName);
    return ['Loading logs...'];
  }
  return containerLogsCache.value[containerName];
}

// Breakpoints
const { isMobile, windowNarrow } = useBreakpoints();

// Detail panel (declared early so isCompact can react to panel state)
const {
  selectedContainer,
  detailPanelOpen,
  activeDetailTab,
  panelSize,
  containerFullPage,
  panelFlex,
  detailTabs,
  selectContainer,
  openFullPage,
  closeFullPage,
  closePanel,
} = useDetailPanel();

const isCompact = computed(() => windowNarrow.value || detailPanelOpen.value);

function syncSelectedContainerReference() {
  if (!selectedContainer.value) {
    return;
  }
  const refreshed = containers.value.find((container) => container.name === selectedContainer.value?.name);
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
const selectedContainerMeta = computed(() =>
  selectedContainer.value ? containerMetaMap.value[selectedContainer.value.name] : undefined,
);
const selectedUpdatePolicy = computed<Record<string, any>>(
  () => selectedContainerMeta.value?.updatePolicy || {},
);
const selectedSkipTags = computed<string[]>(() =>
  Array.isArray(selectedUpdatePolicy.value.skipTags) ? selectedUpdatePolicy.value.skipTags : [],
);
const selectedSkipDigests = computed<string[]>(() =>
  Array.isArray(selectedUpdatePolicy.value.skipDigests) ? selectedUpdatePolicy.value.skipDigests : [],
);
const selectedSnoozeUntil = computed<string | undefined>(() => selectedUpdatePolicy.value.snoozeUntil);

const detailPreview = ref<Record<string, any> | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

const detailTriggers = ref<any[]>([]);
const triggersLoading = ref(false);
const triggerRunInProgress = ref<string | null>(null);
const triggerMessage = ref<string | null>(null);
const triggerError = ref<string | null>(null);

const detailBackups = ref<any[]>([]);
const backupsLoading = ref(false);
const rollbackInProgress = ref<string | null>(null);
const rollbackMessage = ref<string | null>(null);
const rollbackError = ref<string | null>(null);

const policyInProgress = ref<string | null>(null);
const policyMessage = ref<string | null>(null);
const policyError = ref<string | null>(null);

function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) {
    return 'Unknown';
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }
  return parsed.toLocaleString();
}

function resetDetailMessages() {
  triggerMessage.value = null;
  triggerError.value = null;
  rollbackMessage.value = null;
  rollbackError.value = null;
  policyMessage.value = null;
  policyError.value = null;
}

function getTriggerKey(trigger: any): string {
  if (trigger.id) {
    return trigger.id;
  }
  const prefix = trigger.agent ? `${trigger.agent}.` : '';
  return `${prefix}${trigger.type}.${trigger.name}`;
}

async function loadDetailTriggers() {
  const containerId = selectedContainerId.value;
  if (!containerId) {
    detailTriggers.value = [];
    return;
  }
  triggersLoading.value = true;
  triggerError.value = null;
  try {
    detailTriggers.value = await getContainerTriggers(containerId);
  } catch (e: any) {
    detailTriggers.value = [];
    triggerError.value = e?.message || 'Failed to load associated triggers';
  } finally {
    triggersLoading.value = false;
  }
}

async function loadDetailBackups() {
  const containerId = selectedContainerId.value;
  if (!containerId) {
    detailBackups.value = [];
    return;
  }
  backupsLoading.value = true;
  rollbackError.value = null;
  try {
    detailBackups.value = await getBackups(containerId);
  } catch (e: any) {
    detailBackups.value = [];
    rollbackError.value = e?.message || 'Failed to load backups';
  } finally {
    backupsLoading.value = false;
  }
}

async function refreshActionTabData() {
  await Promise.all([loadDetailTriggers(), loadDetailBackups()]);
}

async function runContainerPreview() {
  const containerId = selectedContainerId.value;
  if (!containerId || previewLoading.value) {
    return;
  }
  previewLoading.value = true;
  previewError.value = null;
  try {
    detailPreview.value = await previewContainer(containerId);
  } catch (e: any) {
    detailPreview.value = null;
    previewError.value = e?.message || 'Failed to generate update preview';
  } finally {
    previewLoading.value = false;
  }
}

async function runAssociatedTrigger(trigger: any) {
  const containerId = selectedContainerId.value;
  if (!containerId || triggerRunInProgress.value) {
    return;
  }
  const triggerKey = getTriggerKey(trigger);
  triggerRunInProgress.value = triggerKey;
  triggerMessage.value = null;
  triggerError.value = null;
  try {
    await runContainerTrigger({
      containerId,
      triggerType: trigger.type,
      triggerName: trigger.name,
      triggerAgent: trigger.agent,
    });
    triggerMessage.value = `Trigger ${triggerKey} ran successfully`;
    await loadContainers();
  } catch (e: any) {
    triggerError.value = e?.message || `Failed to run ${triggerKey}`;
  } finally {
    triggerRunInProgress.value = null;
  }
}

async function rollbackToBackup(backupId?: string) {
  const containerId = selectedContainerId.value;
  if (!containerId || rollbackInProgress.value) {
    return;
  }
  rollbackInProgress.value = backupId || 'latest';
  rollbackMessage.value = null;
  rollbackError.value = null;
  try {
    await rollback(containerId, backupId);
    rollbackMessage.value = backupId
      ? 'Rollback completed from selected backup'
      : 'Rollback completed from latest backup';
    skippedUpdates.value.delete(selectedContainer.value?.name || '');
    await loadContainers();
    await loadDetailBackups();
  } catch (e: any) {
    rollbackError.value = e?.message || 'Rollback failed';
  } finally {
    rollbackInProgress.value = null;
  }
}

async function applyPolicy(name: string, action: string, payload: Record<string, any> = {}, message?: string) {
  const containerId = containerIdMap.value[name];
  if (!containerId || policyInProgress.value) {
    return false;
  }
  policyInProgress.value = `${action}:${name}`;
  policyError.value = null;
  try {
    await updateContainerPolicy(containerId, action, payload);
    if (message) {
      policyMessage.value = message;
    }
    await loadContainers();
    return true;
  } catch (e: any) {
    policyError.value = e?.message || 'Failed to update policy';
    return false;
  } finally {
    policyInProgress.value = null;
  }
}

async function skipCurrentForSelected() {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  const applied = await applyPolicy(
    containerName,
    'skip-current',
    {},
    `Skipped current update for ${containerName}`,
  );
  if (applied) {
    skippedUpdates.value.add(containerName);
    await refreshActionTabData();
  }
}

async function snoozeSelected(days: number) {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  await applyPolicy(
    containerName,
    'snooze',
    { days },
    `Snoozed updates for ${days} day${days === 1 ? '' : 's'}`,
  );
}

async function unsnoozeSelected() {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  await applyPolicy(containerName, 'unsnooze', {}, 'Snooze cleared');
}

async function clearSkipsSelected() {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  skippedUpdates.value.delete(containerName);
  await applyPolicy(containerName, 'clear-skips', {}, 'Skipped updates cleared');
}

async function clearPolicySelected() {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  skippedUpdates.value.delete(containerName);
  await applyPolicy(containerName, 'clear', {}, 'Update policy cleared');
}

watch(
  () => [selectedContainer.value?.name, activeDetailTab.value],
  ([containerName, tabName]) => {
    detailPreview.value = null;
    previewError.value = null;
    if (!containerName) {
      detailTriggers.value = [];
      detailBackups.value = [];
      resetDetailMessages();
      return;
    }
    if (tabName === 'actions') {
      resetDetailMessages();
      void refreshActionTabData();
    }
  },
  { immediate: true },
);

// View mode
const containerViewMode = ref<'table' | 'cards' | 'list'>('table');
const tableActionStyle = ref<'icons' | 'buttons'>(
  (localStorage.getItem('dd-table-actions') as 'icons' | 'buttons') || 'icons',
);
watch(
  () => tableActionStyle.value,
  (v) => localStorage.setItem('dd-table-actions', v),
);

// Filters
const {
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
  if (typeof raw !== 'string') {
    filterKind.value = 'all';
    return;
  }
  filterKind.value = VALID_FILTER_KINDS.has(raw) ? raw : 'all';
}

applyFilterKindFromQuery(route.query.filterKind);
watch(
  () => route.query.filterKind,
  (value) => applyFilterKindFromQuery(value),
);

const serverNames = computed(() => [...new Set(containers.value.map((c) => c.server))]);

// Sorting
const {
  sortKey: containerSortKey,
  sortAsc: containerSortAsc,
  toggleSort: toggleContainerSort,
} = useSorting('name');

const sortedContainers = computed(() => {
  const list = [...filteredContainers.value];
  const key = containerSortKey.value;
  const dir = containerSortAsc.value ? 1 : -1;
  const kindOrder: Record<string, number> = { major: 0, minor: 1, patch: 2, digest: 3 };
  const bouncerOrder: Record<string, number> = { blocked: 0, unsafe: 1, safe: 2 };
  return list.sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    if (key === 'name') {
      av = a.name.toLowerCase();
      bv = b.name.toLowerCase();
    } else if (key === 'image') {
      av = a.image.toLowerCase();
      bv = b.image.toLowerCase();
    } else if (key === 'status') {
      av = a.status;
      bv = b.status;
    } else if (key === 'server') {
      av = a.server;
      bv = b.server;
    } else if (key === 'registry') {
      av = a.registry;
      bv = b.registry;
    } else if (key === 'bouncer') {
      av = bouncerOrder[a.bouncer] ?? 9;
      bv = bouncerOrder[b.bouncer] ?? 9;
    } else if (key === 'kind') {
      av = kindOrder[a.updateKind ?? ''] ?? 9;
      bv = kindOrder[b.updateKind ?? ''] ?? 9;
    } else if (key === 'version') {
      av = a.currentTag;
      bv = b.currentTag;
    } else return 0;
    return av < bv ? -dir : av > bv ? dir : 0;
  });
});

// Apply skip-update masking and merge ghost containers
const displayContainers = computed(() => {
  const live = sortedContainers.value.map((c) =>
    skippedUpdates.value.has(c.name) ? { ...c, newTag: undefined, updateKind: undefined } : c,
  );
  // Merge pending (ghost) containers that disappeared during action
  const liveNames = new Set(live.map((c) => c.name));
  const ghosts = [...actionPending.value.entries()]
    .filter(([name]) => !liveNames.has(name))
    .map(([, snapshot]) => ({ ...snapshot, _pending: true as const }));
  return [...live, ...ghosts];
});

// Grouping / stacks
const groupByStack = ref(localStorage.getItem('dd-group-by-stack') === 'true');
const groupMembershipMap = ref<Record<string, string>>({});
const collapsedGroups = ref(new Set<string>());
const groupUpdateInProgress = ref(new Set<string>());

watch(
  () => groupByStack.value,
  (v) => {
    localStorage.setItem('dd-group-by-stack', String(v));
    if (v && Object.keys(groupMembershipMap.value).length === 0) {
      loadGroups();
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
      if (!group.name) continue;
      for (const c of group.containers) {
        const uiName = c.displayName || c.name;
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
  for (const c of displayContainers.value) {
    const groupName = map[c.name] ?? null;
    const key = groupName ?? '__ungrouped__';
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(c);
  }
  const named: RenderGroup[] = [];
  let ungrouped: RenderGroup | null = null;
  for (const [key, containers] of Object.entries(buckets)) {
    const group: RenderGroup = {
      key,
      name: key === '__ungrouped__' ? null : key,
      containers,
      containerCount: containers.length,
      updatesAvailable: containers.filter((c) => c.newTag).length,
      updatableCount: containers.filter((c) => c.newTag && c.bouncer !== 'blocked').length,
    };
    if (key === '__ungrouped__') {
      ungrouped = group;
    } else {
      named.push(group);
    }
  }
  named.sort((a, b) => a.key.localeCompare(b.key));
  if (ungrouped) named.push(ungrouped);
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
        updatesAvailable: displayContainers.value.filter((c) => c.newTag).length,
        updatableCount: displayContainers.value.filter((c) => c.newTag && c.bouncer !== 'blocked')
          .length,
      },
    ];
  }
  return groupedContainers.value;
});

// Column visibility
const { allColumns, visibleColumns, activeColumns, showColumnPicker, toggleColumn } =
  useColumnVisibility(isCompact);

// Map activeColumns to DataTable format
const tableColumns = computed(() =>
  activeColumns.value.map((col) => ({
    key: col.key,
    label: col.label,
    align: col.align,
    sortable: col.key !== 'icon',
    width: col.key === 'name' ? '99%' : col.key === 'icon' ? '40px' : undefined,
    icon: col.key === 'icon',
  })),
);

// Restore panel state on mount
onMounted(() => {
  const saved = sessionStorage.getItem('dd-panel');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      const c = containers.value.find((x) => x.name === s.name);
      if (c) {
        selectedContainer.value = c;
        activeDetailTab.value = s.tab || 'overview';
        detailPanelOpen.value = s.panel ?? false;
        containerFullPage.value = s.full ?? false;
        panelSize.value = s.size || 'sm';
      }
    } catch {
      /* ignore corrupt data */
    }
  }
});

// Skipped updates (optimistic client masking while policy updates propagate)
const skippedUpdates = ref(new Set<string>());

// Actions menu
const openActionsMenu = ref<string | null>(null);
const actionsMenuStyle = ref<Record<string, string>>({});

function toggleActionsMenu(name: string, event: MouseEvent) {
  if (openActionsMenu.value === name) {
    openActionsMenu.value = null;
    return;
  }
  openActionsMenu.value = name;
  const btn = event.currentTarget as HTMLElement;
  const rect = btn.getBoundingClientRect();
  actionsMenuStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    right: `${window.innerWidth - rect.right}px`,
  };
}

function closeActionsMenu() {
  openActionsMenu.value = null;
}

// Column picker fixed positioning
const columnPickerStyle = ref<Record<string, string>>({});
function toggleColumnPicker(event: MouseEvent) {
  showColumnPicker.value = !showColumnPicker.value;
  if (showColumnPicker.value) {
    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    columnPickerStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
    };
  }
}

// Close menus on outside click
function handleGlobalClick() {
  openActionsMenu.value = null;
  showColumnPicker.value = false;
}
function handleSseScanCompleted() {
  loadContainers();
}
onMounted(() => {
  document.addEventListener('click', handleGlobalClick);
  globalThis.addEventListener('dd:sse-scan-completed', handleSseScanCompleted as EventListener);
});
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick);
  globalThis.removeEventListener('dd:sse-scan-completed', handleSseScanCompleted as EventListener);
});

// Container action handlers
const actionInProgress = ref<string | null>(null);

// Ghost state: hold container position during update/restart/stop (#80)
const actionPending = ref<Map<string, Container>>(new Map());
const pollTimers = ref<Map<string, ReturnType<typeof setInterval>>>(new Map());
const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 30000;

function startPolling(name: string) {
  const startTime = Date.now();
  const timer = setInterval(async () => {
    await loadContainers();
    // Check if container reappeared (matched by name)
    const found = containers.value.find((c) => c.name === name);
    if (found || Date.now() - startTime > POLL_TIMEOUT) {
      clearInterval(timer);
      pollTimers.value.delete(name);
      actionPending.value.delete(name);
    }
  }, POLL_INTERVAL);
  pollTimers.value.set(name, timer);
}

onUnmounted(() => {
  for (const timer of pollTimers.value.values()) clearInterval(timer);
});

async function executeAction(name: string, action: (id: string) => Promise<any>) {
  const containerId = containerIdMap.value[name];
  if (!containerId || actionInProgress.value) return false;
  actionInProgress.value = name;
  // Snapshot current state before action
  const snapshot = containers.value.find((c) => c.name === name);
  try {
    await action(containerId);
    await loadContainers();
    // If container disappeared after reload, hold its position
    const stillPresent = containers.value.find((c) => c.name === name);
    if (!stillPresent && snapshot) {
      actionPending.value.set(name, snapshot);
      startPolling(name);
    }
    return true;
  } catch (e: any) {
    console.error(`Action failed for ${name}:`, e.message);
    return false;
  } finally {
    actionInProgress.value = null;
  }
}

function setGroupUpdateState(groupKey: string, updating: boolean) {
  const next = new Set(groupUpdateInProgress.value);
  if (updating) {
    next.add(groupKey);
  } else {
    next.delete(groupKey);
  }
  groupUpdateInProgress.value = next;
}

async function updateAllInGroup(group: RenderGroup) {
  if (groupUpdateInProgress.value.has(group.key)) {
    return;
  }
  const updatableContainers = group.containers.filter((container) => {
    return container.newTag && container.bouncer !== 'blocked';
  });
  if (updatableContainers.length === 0) {
    return;
  }
  setGroupUpdateState(group.key, true);
  try {
    for (const container of updatableContainers) {
      await executeAction(container.name, apiUpdateContainer);
    }
  } finally {
    setGroupUpdateState(group.key, false);
  }
}

async function startContainer(name: string) {
  await executeAction(name, apiStartContainer);
}

async function updateContainer(name: string) {
  await executeAction(name, apiUpdateContainer);
}

async function skipUpdate(name: string) {
  const applied = await applyPolicy(name, 'skip-current', {}, `Skipped current update for ${name}`);
  if (applied) {
    skippedUpdates.value.add(name);
    if (selectedContainer.value?.name === name && activeDetailTab.value === 'actions') {
      await refreshActionTabData();
    }
  }
}

async function forceUpdate(name: string) {
  await applyPolicy(name, 'clear', {}, `Cleared update policy for ${name}`);
  await executeAction(name, apiUpdateContainer);
}

// Tooltip shorthand — shows on 400ms delay
const tt = (label: string) => ({ value: label, showDelay: 400 });

// Confirm wrappers for destructive actions
function confirmStop(name: string) {
  confirm.require({
    header: 'Stop Container',
    message: `Stop ${name}?`,
    rejectLabel: 'Cancel',
    acceptLabel: 'Stop',
    severity: 'danger',
    accept: () => executeAction(name, apiStopContainer),
  });
}

function confirmRestart(name: string) {
  confirm.require({
    header: 'Restart Container',
    message: `Restart ${name}?`,
    rejectLabel: 'Cancel',
    acceptLabel: 'Restart',
    severity: 'warn',
    accept: () => executeAction(name, apiRestartContainer),
  });
}

function confirmForceUpdate(name: string) {
  confirm.require({
    header: 'Force Update',
    message: `Force update ${name}? This clears skip/snooze policy before attempting update.`,
    rejectLabel: 'Cancel',
    acceptLabel: 'Force Update',
    severity: 'warn',
    accept: () => forceUpdate(name),
  });
}
</script>

<template>
    <ConfirmDialog />
    <!-- MAIN CONTAINERS LIST (not full page) -->
    <DataViewLayout v-if="!containerFullPage">

      <!-- FILTER BAR -->
      <DataFilterBar
        v-model="containerViewMode"
        v-model:showFilters="showFilters"
        :filtered-count="filteredContainers.length"
        :total-count="containers.length"
        :active-filter-count="activeFilterCount">
        <template #filters>
          <select v-model="filterStatus"
                  class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
            <option value="all">Status</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
          </select>
          <select v-model="filterBouncer"
                  class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
            <option value="all">Bouncer</option>
            <option value="safe">Safe</option>
            <option value="unsafe">Unsafe</option>
            <option value="blocked">Blocked</option>
          </select>
          <select v-model="filterRegistry"
                  class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
            <option value="all">Registry</option>
            <option value="dockerhub">Docker Hub</option>
            <option value="ghcr">GHCR</option>
            <option value="custom">Custom</option>
          </select>
          <select v-model="filterServer"
                  class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
            <option value="all">Host</option>
            <option v-for="s in serverNames" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-model="filterKind"
                  class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
            <option value="all">Update</option>
            <option value="any">Has Update</option>
            <option value="major">Major</option>
            <option value="minor">Minor</option>
            <option value="patch">Patch</option>
            <option value="digest">Digest</option>
          </select>
          <button v-if="activeFilterCount > 0"
                  class="text-[10px] font-medium px-2 py-1 dd-rounded transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                  @click="clearFilters">
            Clear all
          </button>
        </template>
        <template #extra-buttons>
          <div v-if="containerViewMode === 'table'">
            <button class="w-7 h-7 dd-rounded flex items-center justify-center text-[11px] transition-colors border"
                    :class="showColumnPicker ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                    :style="{ borderColor: 'var(--dd-border-strong)' }"
                    v-tooltip.top="tt('Toggle columns')"
                    @click.stop="toggleColumnPicker($event)">
              <AppIcon name="config" :size="10" />
            </button>
          </div>
        </template>
        <template #left>
          <button class="w-7 h-7 dd-rounded flex items-center justify-center text-[11px] transition-colors border"
                  :class="groupByStack ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text hover:dd-bg-elevated'"
                  :style="{ borderColor: groupByStack ? 'var(--dd-primary)' : 'var(--dd-border-strong)' }"
                  v-tooltip.top="tt('Group by stack')"
                  @click="groupByStack = !groupByStack">
            <AppIcon name="stack" :size="11" />
          </button>
          <button class="w-7 h-7 dd-rounded flex items-center justify-center text-[11px] transition-colors border"
                  :class="rechecking ? 'dd-text-muted cursor-wait' : 'dd-text-muted hover:dd-text hover:dd-bg-elevated'"
                  :style="{ borderColor: 'var(--dd-border-strong)' }"
                  :disabled="rechecking"
                  v-tooltip.top="tt('Recheck for updates')"
                  @click="recheckAll">
            <AppIcon name="restart" :size="11" :class="{ 'animate-spin': rechecking }" />
          </button>
        </template>
      </DataFilterBar>

      <!-- Column picker dropdown (fixed position to escape overflow) -->
      <div v-if="showColumnPicker" @click.stop
           class="z-50 min-w-[160px] py-1.5 dd-rounded shadow-lg"
           :style="{
             ...columnPickerStyle,
             backgroundColor: 'var(--dd-bg-card)',
             border: '1px solid var(--dd-border-strong)',
             boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
           }">
        <div class="px-3 py-1 text-[9px] font-bold uppercase tracking-wider dd-text-muted">Columns</div>
        <button v-for="col in allColumns.filter(c => c.label)" :key="col.key"
                class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 hover:dd-bg-elevated"
                :class="col.required ? 'dd-text-muted cursor-not-allowed' : 'dd-text'"
                @click="toggleColumn(col.key)">
          <AppIcon :name="visibleColumns.has(col.key) ? 'check' : 'square'" :size="10" :style="visibleColumns.has(col.key) ? { color: 'var(--dd-primary)' } : {}" />
          {{ col.label }}
        </button>
      </div>

      <!-- GROUPED / FLAT CONTAINER VIEWS -->
      <template v-if="filteredContainers.length > 0">
      <template v-for="group in renderGroups" :key="group.key">

        <!-- Group header (only shown when grouping is active) -->
        <div v-if="groupByStack && group.key !== '__flat__'"
             class="flex items-center gap-2 px-3 py-2.5 mb-3 cursor-pointer select-none dd-rounded transition-colors hover:dd-bg-elevated"
             :style="{ backgroundColor: 'var(--dd-bg-elevated)', border: '1px solid var(--dd-border-strong)' }"
             :class="group.key === renderGroups[0]?.key ? '' : 'mt-6'"
             @click="toggleGroupCollapse(group.key)">
          <AppIcon :name="collapsedGroups.has(group.key) ? 'chevron-right' : 'chevron-down'" :size="10" class="dd-text-muted shrink-0" />
          <AppIcon name="stack" :size="12" class="dd-text-muted shrink-0" />
          <span class="text-[12px] font-semibold dd-text">{{ group.name ?? 'Ungrouped' }}</span>
          <span class="badge text-[9px] font-bold dd-bg-elevated dd-text-muted">{{ group.containerCount }}</span>
          <span v-if="group.updatesAvailable > 0" class="badge text-[9px] font-bold"
                :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">
            {{ group.updatesAvailable }} update{{ group.updatesAvailable === 1 ? '' : 's' }}
          </span>
          <button
            v-if="group.updatableCount > 0"
            class="ml-auto inline-flex items-center gap-1 px-2 py-1 dd-rounded border text-[10px] font-semibold transition-colors"
            :class="groupUpdateInProgress.has(group.key) || actionInProgress
              ? 'dd-text-muted cursor-wait'
              : 'dd-text hover:dd-bg-elevated'"
            :style="{ borderColor: 'var(--dd-border-strong)' }"
            :disabled="groupUpdateInProgress.has(group.key) || actionInProgress !== null"
            v-tooltip.top="tt('Update all in group')"
            @click.stop="updateAllInGroup(group)">
            <AppIcon
              :name="groupUpdateInProgress.has(group.key) ? 'spinner' : 'cloud-download'"
              :size="11"
              :class="groupUpdateInProgress.has(group.key) ? 'dd-spin' : ''" />
            <span>Update all</span>
          </button>
        </div>

        <!-- Group body (collapsible) -->
        <div v-show="!collapsedGroups.has(group.key)">

      <!-- TABLE VIEW -->
      <DataTable v-if="containerViewMode === 'table'"
                 :columns="tableColumns"
                 :rows="group.containers"
                 row-key="name"
                 :sort-key="containerSortKey"
                 :sort-asc="containerSortAsc"
                 :selected-key="selectedContainer?.name"
                 :show-actions="!isCompact"
                 @update:sort-key="containerSortKey = $event"
                 @update:sort-asc="containerSortAsc = $event"
                 @row-click="selectContainer($event)">
        <!-- Container icon (own column) -->
        <template #cell-icon="{ row: c }">
          <AppIcon v-if="c._pending || actionInProgress === c.name" name="spinner" :size="14" class="dd-spin dd-text-muted" />
          <ContainerIcon v-else :icon="c.icon" :size="20" />
        </template>

        <!-- Container name + image (+ compact actions & badges) -->
        <template #cell-name="{ row: c }">
          <div class="min-w-0" :class="{ 'opacity-50': c._pending }">
              <div class="flex items-center gap-2">
                <div class="font-medium truncate dd-text flex-1">{{ c.name }}</div>
                <!-- Compact: inline action icons (top-right) -->
                <div v-if="isCompact" class="flex items-center gap-0.5 shrink-0">
                  <button v-if="c.newTag && c.bouncer === 'blocked'"
                          class="w-7 h-7 dd-rounded flex items-center justify-center cursor-not-allowed dd-text-muted opacity-50"
                          v-tooltip.top="tt('Blocked by Bouncer')" @click.stop>
                    <AppIcon name="lock" :size="11" />
                  </button>
                  <button v-else-if="c.newTag"
                          class="w-7 h-7 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95"
                          v-tooltip.top="tt('Update')" @click.stop="updateContainer(c.name)">
                    <AppIcon name="cloud-download" :size="14" />
                  </button>
                  <button v-else-if="c.status === 'running'"
                          class="w-7 h-7 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text-danger hover:dd-bg-hover hover:scale-110 active:scale-95"
                          v-tooltip.top="tt('Stop')" @click.stop="confirmStop(c.name)">
                    <AppIcon name="stop" :size="12" />
                  </button>
                  <button v-else
                          class="w-7 h-7 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95"
                          v-tooltip.top="tt('Start')" @click.stop="startContainer(c.name)">
                    <AppIcon name="play" :size="12" />
                  </button>
                  <button class="w-7 h-7 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text hover:dd-bg-hover hover:scale-110 active:scale-95"
                          :class="openActionsMenu === c.name ? 'dd-bg-elevated dd-text' : ''"
                          v-tooltip.top="tt('More')" @click.stop="toggleActionsMenu(c.name, $event)">
                    <AppIcon name="more" :size="11" />
                  </button>
                </div>
              </div>
              <div class="text-[10px] mt-0.5 truncate dd-text-muted">{{ c.image }}</div>
              <!-- Compact mode: folded badge row -->
              <div v-if="isCompact" class="flex items-center gap-1.5 mt-1.5 min-w-0 overflow-hidden">
                <span v-if="c.newTag" class="inline-flex items-center gap-0.5 text-[9px] font-semibold dd-text-secondary min-w-0">
                  <span class="truncate max-w-[80px]">{{ c.currentTag }}</span>
                  <AppIcon name="arrow-right" :size="11" class="dd-text-muted mx-0.5 shrink-0" />
                  <span class="truncate max-w-[100px]" style="color: var(--dd-primary);" :title="c.newTag">{{ c.newTag }}</span>
                </span>
                <div class="flex items-center gap-1.5 ml-auto shrink-0">
                <span v-if="c.updateKind" class="badge px-1.5 py-0 text-[9px]"
                      :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }"
                      v-tooltip.top="tt(c.updateKind)">
                  <AppIcon :name="c.updateKind === 'major' ? 'chevrons-up' : c.updateKind === 'minor' ? 'chevron-up' : c.updateKind === 'patch' ? 'hashtag' : 'fingerprint'" :size="12" />
                </span>
                <span v-if="c.bouncer === 'blocked'" class="badge px-1.5 py-0 text-[9px]"
                      style="background: var(--dd-danger-muted); color: var(--dd-danger);"
                      v-tooltip.top="tt('Blocked')">
                  <AppIcon name="blocked" :size="12" />
                </span>
                <span v-else-if="c.bouncer !== 'safe'" class="badge px-1.5 py-0 text-[9px]"
                      style="background: var(--dd-warning-muted); color: var(--dd-warning);"
                      v-tooltip.top="tt(c.bouncer)">
                  <AppIcon name="warning" :size="12" />
                </span>
                <span class="badge px-1.5 py-0 text-[9px]"
                      :style="{
                        backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                        color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                      }"
                      v-tooltip.top="tt(c.status)">
                  <AppIcon :name="c.status === 'running' ? 'play' : 'stop'" :size="12" />
                </span>
                <span class="badge px-1.5 py-0 text-[9px]"
                      :style="{ backgroundColor: serverBadgeColor(c.server).bg, color: serverBadgeColor(c.server).text }">
                  <AppIcon :name="parseServer(c.server).name === 'Local' ? 'home' : 'remote'" :size="12" />
                </span>
                </div>
              </div>
          </div>
        </template>
        <!-- Version comparison -->
        <template #cell-version="{ row: c }">
          <div v-if="c.newTag" class="flex items-center justify-center gap-1.5 min-w-0 max-w-[260px]">
            <span class="text-[11px] dd-text-secondary truncate shrink-0 max-w-[100px]" :title="c.currentTag">{{ c.currentTag }}</span>
            <AppIcon name="arrow-right" :size="8" class="dd-text-muted shrink-0" />
            <span class="text-[11px] font-semibold truncate max-w-[140px]" style="color: var(--dd-primary);" :title="c.newTag">{{ c.newTag }}</span>
          </div>
          <div v-else class="text-center">
            <span class="text-[11px] dd-text-secondary truncate block max-w-[140px] mx-auto" :title="c.currentTag">{{ c.currentTag }}</span>
          </div>
        </template>
        <!-- Kind badge -->
        <template #cell-kind="{ row: c }">
          <span v-if="c.updateKind" class="badge text-[9px] uppercase font-bold"
                :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }">
            {{ c.updateKind }}
          </span>
          <span v-else class="text-[10px] dd-text-muted">&mdash;</span>
        </template>
        <!-- Status -->
        <template #cell-status="{ row: c }">
          <AppIcon :name="c.status === 'running' ? 'play' : 'stop'" :size="13" class="shrink-0 md:!hidden"
                   :style="{ color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
          <span class="badge text-[9px] font-bold max-md:!hidden"
                :style="{
                  backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                  color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                }">
            {{ c.status }}
          </span>
        </template>
        <!-- Bouncer icon -->
        <template #cell-bouncer="{ row: c }">
          <span v-if="c.bouncer === 'safe'" class="dd-text-muted">–</span>
          <span v-else-if="c.bouncer === 'blocked'" v-tooltip.top="tt('Blocked')" class="cursor-default">
            <AppIcon name="blocked" :size="14" style="color: var(--dd-danger);" />
          </span>
          <span v-else v-tooltip.top="tt(c.bouncer)" class="cursor-default">
            <AppIcon name="warning" :size="14" style="color: var(--dd-warning);" />
          </span>
        </template>
        <!-- Server -->
        <template #cell-server="{ row: c }">
          <span class="badge text-[9px] font-bold"
                :style="{ backgroundColor: serverBadgeColor(c.server).bg, color: serverBadgeColor(c.server).text }">
            {{ c.server }}
          </span>
        </template>
        <!-- Registry badge -->
        <template #cell-registry="{ row: c }">
          <span class="badge text-[9px] uppercase tracking-wide font-bold"
                :style="{ backgroundColor: registryColorBg(c.registry), color: registryColorText(c.registry) }">
            {{ registryLabel(c.registry) }}
          </span>
        </template>
        <!-- Actions (hidden in compact -- inlined into name cell) -->
        <template #actions="{ row: c }">
          <!-- Icon-style actions (compact) -->
          <template v-if="tableActionStyle === 'icons'">
            <div class="flex items-center justify-end gap-0.5">
              <button v-if="c.newTag && c.bouncer === 'blocked'"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-all cursor-not-allowed dd-text-muted opacity-50"
                      v-tooltip.top="tt('Blocked by Bouncer')" @click.stop>
                <AppIcon name="lock" :size="13" />
              </button>
              <button v-else-if="c.newTag"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95"
                      v-tooltip.top="tt('Update')" @click.stop="updateContainer(c.name)">
                <AppIcon name="cloud-download" :size="16" />
              </button>
              <button v-else-if="c.status === 'running'"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text-danger hover:dd-bg-hover hover:scale-110 active:scale-95"
                      v-tooltip.top="tt('Stop')" @click.stop="confirmStop(c.name)">
                <AppIcon name="stop" :size="14" />
              </button>
              <button v-else
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95"
                      v-tooltip.top="tt('Start')" @click.stop="startContainer(c.name)">
                <AppIcon name="play" :size="14" />
              </button>
              <button class="w-8 h-8 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text hover:dd-bg-hover hover:scale-110 active:scale-95"
                      :class="openActionsMenu === c.name ? 'dd-bg-elevated dd-text' : ''"
                      v-tooltip.top="tt('More')" @click.stop="toggleActionsMenu(c.name, $event)">
                <AppIcon name="more" :size="13" />
              </button>
            </div>
          </template>
          <!-- Button-style actions (full) -->
          <template v-else>
            <div v-if="c.newTag" class="inline-flex">
              <!-- Blocked: muted split button -->
              <div v-if="c.bouncer === 'blocked'" class="inline-flex dd-rounded overflow-hidden" style="min-width: 110px;"
                   :style="{ border: '1px solid var(--dd-border-strong)' }">
                <button class="inline-flex items-center justify-center flex-1 whitespace-nowrap px-3 py-1.5 text-[11px] font-bold tracking-wide cursor-not-allowed"
                        :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-text-muted)' }">
                  <AppIcon name="lock" :size="11" class="mr-1" /> Blocked
                </button>
                <button class="inline-flex items-center justify-center w-7 transition-colors dd-text-muted hover:dd-text hover:dd-bg-hover"
                        :style="{ backgroundColor: 'var(--dd-bg)', borderLeft: '1px solid var(--dd-border-strong)' }"
                        :class="openActionsMenu === c.name ? 'dd-bg-elevated dd-text' : ''"
                        @click.stop="toggleActionsMenu(c.name, $event)">
                  <AppIcon name="chevron-down" :size="11" />
                </button>
              </div>
              <!-- Updatable: split button -->
              <div v-else class="inline-flex dd-rounded overflow-hidden"
                   :style="{ border: '1px solid var(--dd-success)' }">
                <button class="inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-[11px] font-bold tracking-wide transition-colors"
                        :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }"
                        @click.stop="updateContainer(c.name)">
                  <AppIcon name="cloud-download" :size="11" class="mr-1" /> Update
                </button>
                <button class="inline-flex items-center justify-center w-7 transition-colors"
                        :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', borderLeft: '1px solid var(--dd-success)' }"
                        :class="openActionsMenu === c.name ? 'brightness-125' : ''"
                        @click.stop="toggleActionsMenu(c.name, $event)">
                  <AppIcon name="chevron-down" :size="11" />
                </button>
              </div>
            </div>
            <div v-else class="flex items-center justify-end gap-1">
              <button v-if="c.status === 'running'"
                      class="w-6 h-6 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text-danger hover:dd-bg-hover"
                      v-tooltip.top="tt('Stop')" @click.stop="confirmStop(c.name)">
                <AppIcon name="stop" :size="11" />
              </button>
              <button v-else
                      class="w-6 h-6 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text-success hover:dd-bg-hover"
                      v-tooltip.top="tt('Start')" @click.stop="startContainer(c.name)">
                <AppIcon name="play" :size="11" />
              </button>
              <button class="w-6 h-6 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text hover:dd-bg-hover"
                      v-tooltip.top="tt('Restart')" @click.stop="confirmRestart(c.name)">
                <AppIcon name="restart" :size="11" />
              </button>
            </div>
          </template>
        </template>
      </DataTable>

      <!-- Actions dropdown (teleported to body so it renders in all view modes) -->
      <Teleport to="body">
        <template v-for="c in displayContainers" :key="'menu-' + c.name">
          <div v-if="openActionsMenu === c.name"
               class="z-[200] min-w-[160px] py-1 dd-rounded shadow-lg"
               :style="{
                 ...actionsMenuStyle,
                 backgroundColor: 'var(--dd-bg-card)',
                 border: '1px solid var(--dd-border-strong)',
                 boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
               }"
               @click.stop>
            <button v-if="c.status === 'running'" class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                    @click="closeActionsMenu(); confirmStop(c.name)">
              <AppIcon name="stop" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-danger)' }" />
              Stop
            </button>
            <button v-else class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                    @click="closeActionsMenu(); startContainer(c.name)">
              <AppIcon name="play" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-success)' }" />
              Start
            </button>
            <button class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                    @click="closeActionsMenu(); confirmRestart(c.name)">
              <AppIcon name="restart" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
              Restart
            </button>
            <!-- Force update for blocked containers (even without newTag) -->
            <template v-if="c.bouncer === 'blocked' && !c.newTag">
              <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
              <button class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                      @click="closeActionsMenu(); confirmForceUpdate(c.name)">
                <AppIcon name="bolt" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-warning)' }" />
                Force update
              </button>
            </template>
            <template v-if="c.newTag">
              <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
              <button v-if="c.bouncer === 'blocked'"
                      class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                      @click="closeActionsMenu(); confirmForceUpdate(c.name)">
                <AppIcon name="bolt" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-warning)' }" />
                Force update
              </button>
              <button class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                      @click="skipUpdate(c.name); closeActionsMenu()">
                <AppIcon name="skip-forward" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
                Skip this update
              </button>
            </template>
          </div>
        </template>
      </Teleport>

      <!-- CONTAINER CARD GRID -->
      <DataCardGrid v-if="containerViewMode === 'cards'"
                    :items="group.containers"
                    item-key="name"
                    :selected-key="selectedContainer?.name"
                    @item-click="selectContainer($event)">
        <template #card="{ item: c }">
          <!-- Card header -->
          <div class="px-4 pt-4 pb-2 flex items-start justify-between" :class="{ 'opacity-50': c._pending }">
            <div class="flex items-center gap-2.5 min-w-0">
              <AppIcon v-if="c._pending" name="spinner" :size="16" class="dd-spin dd-text-muted shrink-0" />
              <ContainerIcon v-else :icon="c.icon" :size="24" class="shrink-0" />
              <div class="min-w-0">
                <div class="text-[15px] font-semibold truncate dd-text">
                  {{ c.name }}
                </div>
                <div class="text-[11px] truncate mt-0.5 dd-text-muted">
                  {{ c.image }}:{{ c.currentTag }} <span class="dd-text-secondary">&middot;</span> {{ parseServer(c.server).name }}<template v-if="parseServer(c.server).env"> <span class="dd-text-secondary">({{ parseServer(c.server).env }})</span></template>
                </div>
              </div>
            </div>
            <span class="badge text-[9px] uppercase tracking-wide font-bold shrink-0 ml-2"
                  :style="{ backgroundColor: registryColorBg(c.registry), color: registryColorText(c.registry) }">
              {{ registryLabel(c.registry) }}
            </span>
          </div>

          <!-- Card body -- inline Current / Latest -->
          <div class="px-4 py-3 min-w-0">
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <span class="text-[11px] dd-text-muted shrink-0">Current</span>
              <span class="text-[12px] font-bold dd-text truncate max-w-[120px]" :title="c.currentTag">
                {{ c.currentTag }}
              </span>
              <template v-if="c.newTag">
                <span class="text-[11px] ml-1 dd-text-muted shrink-0">Latest</span>
                <span class="px-1.5 py-0.5 dd-rounded-sm text-[11px] font-bold truncate max-w-[140px]"
                      :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }"
                      :title="c.newTag">
                  {{ c.newTag }}
                </span>
              </template>
              <template v-else>
                <AppIcon name="check" :size="14" class="ml-1" style="color: var(--dd-success);" />
              </template>
            </div>
          </div>

          <!-- Card footer -->
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{
                 borderTop: '1px solid var(--dd-border-strong)',
                 backgroundColor: 'var(--dd-bg-elevated)',
               }">
            <span class="badge px-1.5 py-0 text-[9px] md:!hidden"
                  :style="{ backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)', color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }">
              <AppIcon :name="c.status === 'running' ? 'play' : 'stop'" :size="12" />
            </span>
            <span class="badge text-[9px] font-bold max-md:!hidden"
                  :style="{ backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)', color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }">
              {{ c.status }}
            </span>
            <div class="flex items-center gap-1.5">
              <button v-if="c.status === 'running'"
                      class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text-danger hover:dd-bg-elevated"
                      v-tooltip.top="tt('Stop')" @click.stop="confirmStop(c.name)">
                <AppIcon name="stop" :size="14" />
              </button>
              <button v-else
                      class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text-success hover:dd-bg-elevated"
                      v-tooltip.top="tt('Start')" @click.stop="startContainer(c.name)">
                <AppIcon name="play" :size="14" />
              </button>
              <button class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                      v-tooltip.top="tt('Restart')" @click.stop="confirmRestart(c.name)">
                <AppIcon name="restart" :size="14" />
              </button>
              <button v-if="c.newTag"
                      class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text-success hover:dd-bg-elevated"
                      v-tooltip.top="tt('Update')" @click.stop="updateContainer(c.name)">
                <AppIcon name="cloud-download" :size="14" />
              </button>
            </div>
          </div>
        </template>
      </DataCardGrid>

      <!-- LIST VIEW -->
      <DataListAccordion v-if="containerViewMode === 'list'"
                         :items="group.containers"
                         item-key="name"
                         :selected-key="selectedContainer?.name"
                         @item-click="selectContainer($event)">
        <template #header="{ item: c }">
          <AppIcon v-if="c._pending" name="spinner" :size="14" class="dd-spin dd-text-muted shrink-0" />
          <ContainerIcon v-else :icon="c.icon" :size="18" class="shrink-0" />
          <div class="min-w-0 flex-1" :class="{ 'opacity-50': c._pending }">
            <div class="text-sm font-semibold truncate dd-text">{{ c.name }}</div>
            <div class="text-[10px] mt-0.5 truncate dd-text-muted" :title="`${c.image}:${c.currentTag}`">{{ c.image }}:{{ c.currentTag }}</div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <!-- Update kind: icon on mobile, badge on desktop -->
            <span v-if="c.updateKind" class="badge px-1.5 py-0 text-[9px] md:!hidden"
                  :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }">
              <AppIcon :name="c.updateKind === 'major' ? 'chevrons-up' : c.updateKind === 'minor' ? 'chevron-up' : c.updateKind === 'patch' ? 'hashtag' : 'fingerprint'" :size="12" />
            </span>
            <span v-if="c.updateKind" class="badge text-[9px] uppercase font-bold max-md:!hidden"
                  :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }">
              {{ c.updateKind }}
            </span>
            <!-- Status: icon on mobile, badge on desktop -->
            <AppIcon :name="c.status === 'running' ? 'play' : 'stop'" :size="13" class="shrink-0 md:!hidden"
                     :style="{ color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
            <span class="badge text-[9px] font-bold max-md:!hidden"
                  :style="{
                    backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ c.status }}
            </span>
            <!-- Bouncer: icon in badge -->
            <span v-if="c.bouncer === 'blocked'" class="badge px-1.5 py-0 text-[9px]"
                  style="background: var(--dd-danger-muted); color: var(--dd-danger);">
              <AppIcon name="blocked" :size="12" />
            </span>
            <!-- Server: icon on mobile, badge on desktop -->
            <AppIcon :name="parseServer(c.server).name === 'Local' ? 'home' : 'remote'" :size="12" class="shrink-0 dd-text-muted md:!hidden" />
            <span class="badge text-[7px] font-bold max-md:!hidden"
                  :style="{ backgroundColor: serverBadgeColor(c.server).bg, color: serverBadgeColor(c.server).text }">
              {{ parseServer(c.server).name }}
            </span>
          </div>
        </template>
      </DataListAccordion>

        </div><!-- /group body -->
      </template><!-- /v-for group -->
      </template><!-- /filteredContainers.length > 0 -->

      <!-- EMPTY STATE -->
      <EmptyState v-if="filteredContainers.length === 0"
                  icon="filter"
                  message="No containers match your filters"
                  :show-clear="activeFilterCount > 0"
                  @clear="clearFilters" />

      <template #panel>
      <!-- DETAIL SIDE PANEL -->
      <DetailPanel
        v-if="selectedContainer"
        :open="detailPanelOpen"
        :is-mobile="isMobile"
        :size="panelSize"
        :show-size-controls="true"
        :show-full-page="true"
        @update:open="detailPanelOpen = $event; if (!$event) closePanel()"
        @update:size="panelSize = $event"
        @full-page="openFullPage">
        <template #header>
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-2.5 h-2.5 rounded-full shrink-0"
                 :style="{ backgroundColor: selectedContainer.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
            <span class="text-sm font-bold truncate dd-text">
              {{ selectedContainer.name }}
            </span>
          </div>
        </template>
        <template #subtitle>
          <span class="text-[11px] font-mono dd-text-secondary">
            {{ selectedContainer.image }}:{{ selectedContainer.currentTag }}
          </span>
          <span class="badge text-[9px]"
                :style="{
                  backgroundColor: selectedContainer.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                  color: selectedContainer.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                }">
            {{ selectedContainer.status }}
          </span>
          <span class="badge text-[9px] font-medium"
                :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
            {{ selectedContainer.server }}
          </span>
        </template>
        <template #tabs>
          <div class="shrink-0 flex px-4 gap-1"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <button v-for="tab in detailTabs" :key="tab.id"
                    class="px-3 py-2.5 text-[11px] font-medium transition-colors relative"
                    :class="activeDetailTab === tab.id
                      ? 'text-drydock-secondary'
                      : 'dd-text-muted hover:dd-text'"
                    @click="activeDetailTab = tab.id">
              <AppIcon :name="tab.icon" :size="12" class="mr-1" />
              {{ tab.label }}
              <div v-if="activeDetailTab === tab.id"
                   class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full" />
            </button>
          </div>
        </template>

        <!-- Tab content -->
        <div class="p-4">

          <!-- Overview tab -->
          <div v-if="activeDetailTab === 'overview'" class="space-y-5">
            <!-- Ports -->
            <div v-if="selectedContainer.details.ports.length > 0">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Ports</div>
              <div class="space-y-1">
                <div v-for="port in selectedContainer.details.ports" :key="port"
                     class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="network" :size="11" class="dd-text-muted" />
                  <span class="dd-text">{{ port }}</span>
                </div>
              </div>
            </div>

            <!-- Volumes -->
            <div v-if="selectedContainer.details.volumes.length > 0">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Volumes</div>
              <div class="space-y-1">
                <div v-for="vol in selectedContainer.details.volumes" :key="vol"
                     class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="hard-drive" :size="11" class="dd-text-muted" />
                  <span class="truncate dd-text">{{ vol }}</span>
                </div>
              </div>
            </div>

            <!-- Version info -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Version</div>
              <div class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px] font-mono"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary">Current:</span>
                <span class="font-bold dd-text">{{ selectedContainer.currentTag }}</span>
                <template v-if="selectedContainer.newTag">
                  <AppIcon name="arrow-right" :size="8" class="dd-text-muted" />
                  <span class="font-bold" style="color: var(--dd-success);">{{ selectedContainer.newTag }}</span>
                </template>
              </div>
            </div>

            <!-- Registry -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Registry</div>
              <div class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="badge text-[9px] uppercase font-bold"
                      :style="{ backgroundColor: registryColorBg(selectedContainer.registry), color: registryColorText(selectedContainer.registry) }">
                  {{ registryLabel(selectedContainer.registry) }}
                </span>
                <span class="font-mono dd-text-secondary">{{ selectedContainer.image }}</span>
              </div>
            </div>
          </div>

          <!-- Logs tab -->
          <div v-if="activeDetailTab === 'logs'">
            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-code)' }">
              <div class="px-3 py-2 flex items-center justify-between"
                   style="border-bottom: 1px solid rgba(255,255,255,0.08);">
                <span class="text-[10px] font-semibold uppercase tracking-wider" style="color: #64748b;">
                  Container Logs
                </span>
                <span class="text-[9px] font-mono" style="color: #475569;">
                  {{ getContainerLogs(selectedContainer.name).length }} lines
                </span>
              </div>
              <div class="overflow-auto" style="max-height: calc(100vh - 400px);">
                <div v-for="(line, i) in getContainerLogs(selectedContainer.name)" :key="i"
                     class="px-3 py-0.5 font-mono text-[10px] leading-relaxed whitespace-pre"
                     :style="{ borderBottom: i < getContainerLogs(selectedContainer.name).length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }">
                  <span style="color: #64748b;">{{ line.substring(0, 24) }}</span>
                  <span :style="{ color: line.includes('[error]') || line.includes('[crit]') || line.includes('[emerg]') ? '#ef4444' : line.includes('[warn]') ? '#f59e0b' : '#94a3b8' }">{{ line.substring(24) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Environment tab -->
          <div v-if="activeDetailTab === 'environment'" class="space-y-5">
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Environment Variables</div>
              <div v-if="selectedContainer.details.env.length > 0" class="space-y-1">
                <div v-for="e in selectedContainer.details.env" :key="e.key"
                     class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="font-semibold shrink-0 text-drydock-secondary">{{ e.key }}</span>
                  <span class="dd-text-muted">=</span>
                  <span class="truncate dd-text">{{ e.value }}</span>
                </div>
              </div>
              <p v-else class="text-[11px] dd-text-muted italic">No environment variables configured</p>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Volumes</div>
              <div v-if="selectedContainer.details.volumes.length > 0" class="space-y-1">
                <div v-for="vol in selectedContainer.details.volumes" :key="vol"
                     class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="hard-drive" :size="11" class="dd-text-muted" />
                  <span class="truncate dd-text">{{ vol }}</span>
                </div>
              </div>
              <p v-else class="text-[11px] dd-text-muted italic">No volumes mounted</p>
            </div>
          </div>

          <!-- Labels tab -->
          <div v-if="activeDetailTab === 'labels'">
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Labels</div>
            <div v-if="selectedContainer.details.labels.length > 0" class="flex flex-wrap gap-1.5">
              <span v-for="label in selectedContainer.details.labels" :key="label"
                    class="badge text-[10px] font-semibold"
                    :style="{
                      backgroundColor: 'var(--dd-neutral-muted)',
                      color: 'var(--dd-text-secondary)',
                    }">
                {{ label }}
              </span>
            </div>
            <p v-else class="text-[11px] dd-text-muted italic">No labels assigned</p>
          </div>

          <!-- Actions tab -->
          <div v-if="activeDetailTab === 'actions'" class="space-y-5">
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Update Workflow</div>
              <div class="flex flex-wrap gap-1.5">
                <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="previewLoading"
                        @click="runContainerPreview">
                  {{ previewLoading ? 'Previewing...' : 'Preview Update' }}
                </button>
                <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="!selectedContainer.newTag || actionInProgress === selectedContainer.name"
                        @click="updateContainer(selectedContainer.name)">
                  Update Now
                </button>
                <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="!selectedContainer.newTag || policyInProgress !== null"
                        @click="skipCurrentForSelected">
                  Skip Current
                </button>
                <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="policyInProgress !== null"
                        @click="snoozeSelected(1)">
                  Snooze 1d
                </button>
                <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="policyInProgress !== null"
                        @click="snoozeSelected(7)">
                  Snooze 7d
                </button>
                <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="!selectedSnoozeUntil || policyInProgress !== null"
                        @click="unsnoozeSelected">
                  Unsnooze
                </button>
                <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="selectedSkipTags.length === 0 && selectedSkipDigests.length === 0"
                        @click="clearSkipsSelected">
                  Clear Skips
                </button>
                <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="Object.keys(selectedUpdatePolicy).length === 0"
                        @click="clearPolicySelected">
                  Clear Policy
                </button>
              </div>
              <div class="mt-2 space-y-1 text-[10px] dd-text-muted">
                <div v-if="selectedSnoozeUntil">
                  Snoozed until:
                  <span class="dd-text">{{ formatTimestamp(selectedSnoozeUntil) }}</span>
                </div>
                <div v-if="selectedSkipTags.length > 0">
                  Skipped tags:
                  <span class="dd-text font-mono">{{ selectedSkipTags.join(', ') }}</span>
                </div>
                <div v-if="selectedSkipDigests.length > 0">
                  Skipped digests:
                  <span class="dd-text font-mono">{{ selectedSkipDigests.join(', ') }}</span>
                </div>
                <div v-if="!selectedSnoozeUntil && selectedSkipTags.length === 0 && selectedSkipDigests.length === 0"
                     class="italic">
                  No active update policy.
                </div>
              </div>
              <p v-if="policyMessage" class="mt-2 text-[10px]" style="color: var(--dd-success);">{{ policyMessage }}</p>
              <p v-if="policyError" class="mt-2 text-[10px]" style="color: var(--dd-danger);">{{ policyError }}</p>
            </div>

            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Preview</div>
              <div class="space-y-1.5">
                <div v-if="previewLoading" class="px-2.5 py-2 dd-rounded text-[11px] dd-text-muted"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  Generating preview...
                </div>
                <div v-else-if="detailPreview" class="px-2.5 py-2 dd-rounded text-[11px] space-y-1"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <div v-if="detailPreview.error" style="color: var(--dd-danger);">{{ detailPreview.error }}</div>
                  <template v-else>
                    <div class="dd-text-muted">Current: <span class="dd-text font-mono">{{ detailPreview.currentImage || '-' }}</span></div>
                    <div class="dd-text-muted">New: <span class="dd-text font-mono">{{ detailPreview.newImage || '-' }}</span></div>
                    <div class="dd-text-muted">Update kind:
                      <span class="dd-text font-mono">{{ detailPreview.updateKind?.kind || detailPreview.updateKind || 'unknown' }}</span>
                    </div>
                    <div class="dd-text-muted">Running:
                      <span class="dd-text">{{ detailPreview.isRunning ? 'yes' : 'no' }}</span>
                    </div>
                    <div v-if="Array.isArray(detailPreview.networks)" class="dd-text-muted">
                      Networks: <span class="dd-text font-mono">{{ detailPreview.networks.join(', ') || '-' }}</span>
                    </div>
                  </template>
                </div>
                <div v-else class="px-2.5 py-2 dd-rounded text-[11px] dd-text-muted italic"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  Run a preview to see what update actions will be executed.
                </div>
              </div>
              <p v-if="previewError" class="mt-2 text-[10px]" style="color: var(--dd-danger);">{{ previewError }}</p>
            </div>

            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Associated Triggers</div>
              <div v-if="triggersLoading" class="text-[11px] dd-text-muted">Loading triggers...</div>
              <div v-else-if="detailTriggers.length > 0" class="space-y-1.5">
                <div v-for="trigger in detailTriggers" :key="getTriggerKey(trigger)"
                     class="flex items-center justify-between gap-2 px-2.5 py-2 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <div class="min-w-0">
                    <div class="font-semibold dd-text truncate">{{ trigger.type }}.{{ trigger.name }}</div>
                    <div v-if="trigger.agent" class="text-[10px] dd-text-muted">agent: {{ trigger.agent }}</div>
                  </div>
                  <button class="px-2 py-1 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="triggerRunInProgress !== null"
                          @click="runAssociatedTrigger(trigger)">
                    {{ triggerRunInProgress === getTriggerKey(trigger) ? 'Running...' : 'Run' }}
                  </button>
                </div>
              </div>
              <p v-else class="text-[11px] dd-text-muted italic">No triggers associated with this container</p>
              <p v-if="triggerMessage" class="mt-2 text-[10px]" style="color: var(--dd-success);">{{ triggerMessage }}</p>
              <p v-if="triggerError" class="mt-2 text-[10px]" style="color: var(--dd-danger);">{{ triggerError }}</p>
            </div>

            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Backups &amp; Rollback</div>
              <div class="mb-2">
                <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="backupsLoading || detailBackups.length === 0 || rollbackInProgress !== null"
                        @click="rollbackToBackup()">
                  {{ rollbackInProgress === 'latest' ? 'Rolling back...' : 'Rollback Latest' }}
                </button>
              </div>
              <div v-if="backupsLoading" class="text-[11px] dd-text-muted">Loading backups...</div>
              <div v-else-if="detailBackups.length > 0" class="space-y-1.5">
                <div v-for="backup in detailBackups" :key="backup.id"
                     class="flex items-center justify-between gap-2 px-2.5 py-2 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <div class="min-w-0">
                    <div class="font-semibold dd-text font-mono truncate">{{ backup.imageName }}:{{ backup.imageTag }}</div>
                    <div class="text-[10px] dd-text-muted">{{ formatTimestamp(backup.timestamp) }}</div>
                  </div>
                  <button class="px-2 py-1 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="rollbackInProgress !== null"
                          @click="rollbackToBackup(backup.id)">
                    {{ rollbackInProgress === backup.id ? 'Rolling...' : 'Use' }}
                  </button>
                </div>
              </div>
              <p v-else class="text-[11px] dd-text-muted italic">No backups available yet</p>
              <p v-if="rollbackMessage" class="mt-2 text-[10px]" style="color: var(--dd-success);">{{ rollbackMessage }}</p>
              <p v-if="rollbackError" class="mt-2 text-[10px]" style="color: var(--dd-danger);">{{ rollbackError }}</p>
            </div>
          </div>

        </div>
      </DetailPanel>
      </template>
    </DataViewLayout>

    <!-- CONTAINER FULL PAGE DETAIL VIEW -->
    <div v-if="containerFullPage && selectedContainer"
         class="flex flex-col flex-1 min-h-0">

      <!-- Full-page header -->
      <div class="shrink-0 mb-4 dd-rounded overflow-hidden"
           :style="{
             backgroundColor: 'var(--dd-bg-card)',
             border: '1px solid var(--dd-border-strong)',
           }">
        <div class="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div class="flex items-center gap-4 min-w-0">
            <button class="flex items-center gap-2 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated shrink-0"
                    :style="{ border: '1px solid var(--dd-border-strong)' }"
                    @click="closeFullPage">
              <AppIcon name="arrow-left" :size="11" />
              Back
            </button>
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-3 h-3 rounded-full shrink-0"
                   :style="{ backgroundColor: selectedContainer.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
              <div class="min-w-0">
                <h1 class="text-base sm:text-lg font-bold truncate dd-text">
                  {{ selectedContainer.name }}
                </h1>
                <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span class="text-[11px] sm:text-[12px] font-mono dd-text-secondary truncate max-w-[180px] sm:max-w-none">
                    {{ selectedContainer.image }}:{{ selectedContainer.currentTag }}
                  </span>
                  <span class="badge text-[9px]"
                        :style="{
                          backgroundColor: selectedContainer.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                          color: selectedContainer.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                        }">
                    {{ selectedContainer.status }}
                  </span>
                  <span class="badge text-[9px] uppercase font-bold max-sm:hidden"
                        :style="{ backgroundColor: registryColorBg(selectedContainer.registry), color: registryColorText(selectedContainer.registry) }">
                    {{ registryLabel(selectedContainer.registry) }}
                  </span>
                  <span v-if="selectedContainer.newTag"
                        class="badge text-[9px] max-sm:hidden"
                        :style="{ backgroundColor: updateKindColor(selectedContainer.updateKind).bg, color: updateKindColor(selectedContainer.updateKind).text }">
                    {{ selectedContainer.updateKind }} update: {{ selectedContainer.newTag }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button v-if="selectedContainer.status === 'running'"
                    class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
                    :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
                    @click="confirmStop(selectedContainer.name)">
              <AppIcon name="stop" :size="12" />
              Stop
            </button>
            <button v-else
                    class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
                    :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', border: '1px solid var(--dd-success)' }"
                    @click="startContainer(selectedContainer.name)">
              <AppIcon name="play" :size="12" />
              Start
            </button>
            <button class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text"
                    :style="{ border: '1px solid var(--dd-border-strong)' }"
                    @click="confirmRestart(selectedContainer.name)">
              <AppIcon name="restart" :size="12" />
              Restart
            </button>
            <button v-if="selectedContainer.newTag"
                    class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-bold transition-colors"
                    :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', border: '1px solid var(--dd-success)' }"
                    @click="updateContainer(selectedContainer.name)">
              <AppIcon name="cloud-download" :size="12" />
              Update
            </button>
          </div>
        </div>

        <!-- Tab bar -->
        <div class="flex px-5 gap-1"
             :style="{ borderTop: '1px solid var(--dd-border)' }">
          <button v-for="tab in detailTabs" :key="tab.id"
                  class="px-4 py-3 text-[12px] font-medium transition-colors relative"
                  :class="activeDetailTab === tab.id
                    ? 'text-drydock-secondary'
                    : 'dd-text-muted hover:dd-text'"
                  @click="activeDetailTab = tab.id">
            <AppIcon :name="tab.icon" :size="12" class="mr-1.5" />
            {{ tab.label }}
            <div v-if="activeDetailTab === tab.id"
                 class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full" />
          </button>
        </div>
      </div>

      <!-- Full-page tab content -->
      <div class="flex-1 overflow-y-auto min-h-0">

        <!-- Overview tab (full page) -->
        <div v-if="activeDetailTab === 'overview'" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- Ports card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="px-4 py-3 flex items-center gap-2"
                 :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
              <AppIcon name="network" :size="12" class="dd-text-muted" />
              <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Ports</span>
              <span class="badge text-[9px] ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.ports.length }}</span>
            </div>
            <div class="p-4">
              <div v-if="selectedContainer.details.ports.length > 0" class="space-y-1.5">
                <div v-for="port in selectedContainer.details.ports" :key="port"
                     class="flex items-center gap-2 px-3 py-2 dd-rounded text-[12px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="network" :size="10" class="dd-text-muted" />
                  <span class="dd-text">{{ port }}</span>
                </div>
              </div>
              <p v-else class="text-[11px] dd-text-muted italic">No ports exposed</p>
            </div>
          </div>

          <!-- Volumes card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="px-4 py-3 flex items-center gap-2"
                 :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
              <AppIcon name="hard-drive" :size="12" class="dd-text-muted" />
              <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Volumes</span>
              <span class="badge text-[9px] ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.volumes.length }}</span>
            </div>
            <div class="p-4">
              <div v-if="selectedContainer.details.volumes.length > 0" class="space-y-1.5">
                <div v-for="vol in selectedContainer.details.volumes" :key="vol"
                     class="flex items-center gap-2 px-3 py-2 dd-rounded text-[12px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="hard-drive" :size="10" class="dd-text-muted" />
                  <span class="truncate dd-text">{{ vol }}</span>
                </div>
              </div>
              <p v-else class="text-[11px] dd-text-muted italic">No volumes mounted</p>
            </div>
          </div>

          <!-- Version card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="px-4 py-3 flex items-center gap-2"
                 :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
              <AppIcon name="updates" :size="12" class="dd-text-muted" />
              <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Version</span>
            </div>
            <div class="p-4 space-y-3">
              <div class="flex items-center gap-3 px-3 py-2 dd-rounded text-[12px] font-mono"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary">Current:</span>
                <span class="font-bold dd-text">{{ selectedContainer.currentTag }}</span>
              </div>
              <div v-if="selectedContainer.newTag" class="flex items-center gap-3 px-3 py-2 dd-rounded text-[12px] font-mono"
                   :style="{ backgroundColor: 'var(--dd-success-muted)' }">
                <span style="color: var(--dd-success);">Latest:</span>
                <span class="font-bold" style="color: var(--dd-success);">{{ selectedContainer.newTag }}</span>
                <span class="badge text-[9px]"
                      :style="{ backgroundColor: updateKindColor(selectedContainer.updateKind).bg, color: updateKindColor(selectedContainer.updateKind).text }">
                  {{ selectedContainer.updateKind }}
                </span>
              </div>
              <div v-else class="flex items-center gap-2 px-3 py-2 dd-rounded text-[12px]"
                   :style="{ backgroundColor: 'var(--dd-success-muted)' }">
                <AppIcon name="up-to-date" :size="11" style="color: var(--dd-success);" />
                <span class="font-medium" style="color: var(--dd-success);">Up to date</span>
              </div>
            </div>
          </div>

          <!-- Registry card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="px-4 py-3 flex items-center gap-2"
                 :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
              <AppIcon name="registries" :size="12" class="dd-text-muted" />
              <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Registry</span>
            </div>
            <div class="p-4">
              <div class="flex items-center gap-3 px-3 py-2 dd-rounded text-[12px]"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="badge text-[9px] uppercase font-bold"
                      :style="{ backgroundColor: registryColorBg(selectedContainer.registry), color: registryColorText(selectedContainer.registry) }">
                  {{ registryLabel(selectedContainer.registry) }}
                </span>
                <span class="font-mono dd-text-secondary">{{ selectedContainer.image }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Logs tab (full page) -->
        <div v-if="activeDetailTab === 'logs'">
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-code)' }">
            <div class="px-4 py-3 flex items-center justify-between"
                 style="border-bottom: 1px solid rgba(255,255,255,0.08);">
              <div class="flex items-center gap-2">
                <AppIcon name="terminal" :size="11" :style="{ color: '#64748b' }" />
                <span class="text-[11px] font-semibold uppercase tracking-wider" style="color: #64748b;">
                  Container Logs
                </span>
                <span class="text-[11px] font-mono" style="color: #0096C7;">{{ selectedContainer.name }}</span>
              </div>
              <span class="text-[10px] font-mono" style="color: #475569;">
                {{ getContainerLogs(selectedContainer.name).length }} lines
              </span>
            </div>
            <div class="overflow-y-auto p-1" style="max-height: calc(100vh - 320px);">
              <div v-for="(line, i) in getContainerLogs(selectedContainer.name)" :key="i"
                   class="px-3 py-0.5 font-mono text-[11px] leading-relaxed whitespace-pre hover:bg-white/[0.02]"
                   :style="{ borderBottom: i < getContainerLogs(selectedContainer.name).length - 1 ? '1px solid rgba(255,255,255,0.02)' : 'none' }">
                <span style="color: #64748b;">{{ line.substring(0, 24) }}</span>
                <span :style="{ color: line.includes('[error]') || line.includes('[crit]') || line.includes('[emerg]') ? '#ef4444' : line.includes('[warn]') || line.includes('[hint]') ? '#f59e0b' : '#94a3b8' }">{{ line.substring(24) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Environment tab (full page) -->
        <div v-if="activeDetailTab === 'environment'" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="px-4 py-3 flex items-center gap-2"
                 :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
              <AppIcon name="config" :size="12" class="dd-text-muted" />
              <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Environment Variables</span>
              <span class="badge text-[9px] ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.env.length }}</span>
            </div>
            <div class="p-4">
              <div v-if="selectedContainer.details.env.length > 0" class="space-y-1.5">
                <div v-for="e in selectedContainer.details.env" :key="e.key"
                     class="flex items-center gap-2 px-3 py-2 dd-rounded text-[12px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="font-semibold shrink-0 text-drydock-secondary">{{ e.key }}</span>
                  <span class="dd-text-muted">=</span>
                  <span class="truncate dd-text">{{ e.value }}</span>
                </div>
              </div>
              <p v-else class="text-[12px] dd-text-muted italic">No environment variables configured</p>
            </div>
          </div>
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="px-4 py-3 flex items-center gap-2"
                 :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
              <AppIcon name="hard-drive" :size="12" class="dd-text-muted" />
              <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Volumes</span>
              <span class="badge text-[9px] ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.volumes.length }}</span>
            </div>
            <div class="p-4">
              <div v-if="selectedContainer.details.volumes.length > 0" class="space-y-1.5">
                <div v-for="vol in selectedContainer.details.volumes" :key="vol"
                     class="flex items-center gap-2 px-3 py-2 dd-rounded text-[12px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="hard-drive" :size="10" class="dd-text-muted" />
                  <span class="truncate dd-text">{{ vol }}</span>
                </div>
              </div>
              <p v-else class="text-[12px] dd-text-muted italic">No volumes mounted</p>
            </div>
          </div>
        </div>

        <!-- Labels tab (full page) -->
        <div v-if="activeDetailTab === 'labels'">
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="px-4 py-3 flex items-center gap-2"
                 :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
              <AppIcon name="containers" :size="12" class="dd-text-muted" />
              <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Labels</span>
              <span class="badge text-[9px] ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.labels.length }}</span>
            </div>
            <div class="p-4">
              <div v-if="selectedContainer.details.labels.length > 0" class="flex flex-wrap gap-2">
                <span v-for="label in selectedContainer.details.labels" :key="label"
                      class="badge text-[11px] font-semibold px-3 py-1.5"
                      :style="{
                        backgroundColor: 'var(--dd-neutral-muted)',
                        color: 'var(--dd-text-secondary)',
                      }">
                  {{ label }}
                </span>
              </div>
              <p v-else class="text-[12px] dd-text-muted italic">No labels assigned</p>
            </div>
          </div>
        </div>

        <!-- Actions tab (full page) -->
        <div v-if="activeDetailTab === 'actions'" class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div class="space-y-4">
            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
              <div class="px-4 py-3 flex items-center gap-2"
                   :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
                <AppIcon name="updates" :size="12" class="dd-text-muted" />
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Update Workflow</span>
              </div>
              <div class="p-4 space-y-3">
                <div class="flex flex-wrap gap-2">
                  <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="previewLoading"
                          @click="runContainerPreview">
                    {{ previewLoading ? 'Previewing...' : 'Preview Update' }}
                  </button>
                  <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="!selectedContainer.newTag || actionInProgress === selectedContainer.name"
                          @click="updateContainer(selectedContainer.name)">
                    Update Now
                  </button>
                  <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="!selectedContainer.newTag || policyInProgress !== null"
                          @click="skipCurrentForSelected">
                    Skip Current
                  </button>
                  <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="policyInProgress !== null"
                          @click="snoozeSelected(1)">
                    Snooze 1d
                  </button>
                  <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="policyInProgress !== null"
                          @click="snoozeSelected(7)">
                    Snooze 7d
                  </button>
                  <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="!selectedSnoozeUntil || policyInProgress !== null"
                          @click="unsnoozeSelected">
                    Unsnooze
                  </button>
                  <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="selectedSkipTags.length === 0 && selectedSkipDigests.length === 0"
                          @click="clearSkipsSelected">
                    Clear Skips
                  </button>
                  <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="Object.keys(selectedUpdatePolicy).length === 0"
                          @click="clearPolicySelected">
                    Clear Policy
                  </button>
                </div>
                <div class="space-y-1 text-[11px] dd-text-muted">
                  <div v-if="selectedSnoozeUntil">
                    Snoozed until:
                    <span class="dd-text">{{ formatTimestamp(selectedSnoozeUntil) }}</span>
                  </div>
                  <div v-if="selectedSkipTags.length > 0">
                    Skipped tags:
                    <span class="dd-text font-mono">{{ selectedSkipTags.join(', ') }}</span>
                  </div>
                  <div v-if="selectedSkipDigests.length > 0">
                    Skipped digests:
                    <span class="dd-text font-mono">{{ selectedSkipDigests.join(', ') }}</span>
                  </div>
                  <div v-if="!selectedSnoozeUntil && selectedSkipTags.length === 0 && selectedSkipDigests.length === 0"
                       class="italic">
                    No active update policy.
                  </div>
                </div>
                <p v-if="policyMessage" class="text-[11px]" style="color: var(--dd-success);">{{ policyMessage }}</p>
                <p v-if="policyError" class="text-[11px]" style="color: var(--dd-danger);">{{ policyError }}</p>
              </div>
            </div>

            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
              <div class="px-4 py-3 flex items-center gap-2"
                   :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
                <AppIcon name="info" :size="12" class="dd-text-muted" />
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Preview</span>
              </div>
              <div class="p-4 space-y-2 text-[12px]">
                <div v-if="previewLoading" class="dd-text-muted">Generating preview...</div>
                <div v-else-if="detailPreview" class="space-y-1">
                  <div v-if="detailPreview.error" style="color: var(--dd-danger);">{{ detailPreview.error }}</div>
                  <template v-else>
                    <div class="dd-text-muted">Current: <span class="dd-text font-mono">{{ detailPreview.currentImage || '-' }}</span></div>
                    <div class="dd-text-muted">New: <span class="dd-text font-mono">{{ detailPreview.newImage || '-' }}</span></div>
                    <div class="dd-text-muted">Update kind:
                      <span class="dd-text font-mono">{{ detailPreview.updateKind?.kind || detailPreview.updateKind || 'unknown' }}</span>
                    </div>
                    <div class="dd-text-muted">Running:
                      <span class="dd-text">{{ detailPreview.isRunning ? 'yes' : 'no' }}</span>
                    </div>
                    <div v-if="Array.isArray(detailPreview.networks)" class="dd-text-muted">
                      Networks: <span class="dd-text font-mono">{{ detailPreview.networks.join(', ') || '-' }}</span>
                    </div>
                  </template>
                </div>
                <div v-else class="dd-text-muted italic">
                  Run a preview to inspect the planned update operations.
                </div>
                <p v-if="previewError" class="text-[11px]" style="color: var(--dd-danger);">{{ previewError }}</p>
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
              <div class="px-4 py-3 flex items-center gap-2"
                   :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
                <AppIcon name="triggers" :size="12" class="dd-text-muted" />
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Associated Triggers</span>
              </div>
              <div class="p-4 space-y-2">
                <div v-if="triggersLoading" class="text-[12px] dd-text-muted">Loading triggers...</div>
                <div v-else-if="detailTriggers.length > 0" class="space-y-2">
                  <div v-for="trigger in detailTriggers" :key="getTriggerKey(trigger)"
                       class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded"
                       :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold dd-text truncate">{{ trigger.type }}.{{ trigger.name }}</div>
                      <div v-if="trigger.agent" class="text-[11px] dd-text-muted">agent: {{ trigger.agent }}</div>
                    </div>
                    <button class="px-2.5 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                            :style="{ border: '1px solid var(--dd-border-strong)' }"
                            :disabled="triggerRunInProgress !== null"
                            @click="runAssociatedTrigger(trigger)">
                      {{ triggerRunInProgress === getTriggerKey(trigger) ? 'Running...' : 'Run' }}
                    </button>
                  </div>
                </div>
                <p v-else class="text-[12px] dd-text-muted italic">No triggers associated with this container</p>
                <p v-if="triggerMessage" class="text-[11px]" style="color: var(--dd-success);">{{ triggerMessage }}</p>
                <p v-if="triggerError" class="text-[11px]" style="color: var(--dd-danger);">{{ triggerError }}</p>
              </div>
            </div>

            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
              <div class="px-4 py-3 flex items-center gap-2"
                   :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
                <AppIcon name="recent-updates" :size="12" class="dd-text-muted" />
                <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Backups &amp; Rollback</span>
              </div>
              <div class="p-4 space-y-2">
                <div>
                  <button class="px-2.5 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="backupsLoading || detailBackups.length === 0 || rollbackInProgress !== null"
                          @click="rollbackToBackup()">
                    {{ rollbackInProgress === 'latest' ? 'Rolling back...' : 'Rollback Latest' }}
                  </button>
                </div>
                <div v-if="backupsLoading" class="text-[12px] dd-text-muted">Loading backups...</div>
                <div v-else-if="detailBackups.length > 0" class="space-y-2">
                  <div v-for="backup in detailBackups" :key="backup.id"
                       class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded"
                       :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold dd-text font-mono truncate">{{ backup.imageName }}:{{ backup.imageTag }}</div>
                      <div class="text-[11px] dd-text-muted">{{ formatTimestamp(backup.timestamp) }}</div>
                    </div>
                    <button class="px-2.5 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                            :style="{ border: '1px solid var(--dd-border-strong)' }"
                            :disabled="rollbackInProgress !== null"
                            @click="rollbackToBackup(backup.id)">
                      {{ rollbackInProgress === backup.id ? 'Rolling...' : 'Use' }}
                    </button>
                  </div>
                </div>
                <p v-else class="text-[12px] dd-text-muted italic">No backups available yet</p>
                <p v-if="rollbackMessage" class="text-[11px]" style="color: var(--dd-success);">{{ rollbackMessage }}</p>
                <p v-if="rollbackError" class="text-[11px]" style="color: var(--dd-danger);">{{ rollbackError }}</p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
</template>
