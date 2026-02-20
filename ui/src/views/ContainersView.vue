<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useColumnVisibility } from '../composables/useColumnVisibility';
import { useContainerFilters } from '../composables/useContainerFilters';
import { useDetailPanel } from '../composables/useDetailPanel';
import { useSorting } from '../composables/useSorting';
import { getContainerLogs as fetchContainerLogs, getAllContainers } from '../services/container';
import { updateContainer as apiUpdateContainer } from '../services/container-actions';
import type { Container } from '../types/container';
import { mapApiContainers } from '../utils/container-mapper';
import {
  bouncerColor,
  parseServer,
  registryColorBg,
  registryColorText,
  registryLabel,
  serverBadgeColor,
  updateKindColor,
} from '../utils/display';

// Loading and error state
const loading = ref(true);
const error = ref<string | null>(null);

// Container data (reactive ref, fetched from API)
const containers = ref<Container[]>([]);

// Map from container name -> API id (needed to call actions/logs by id)
const containerIdMap = ref<Record<string, string>>({});

// Fetch containers from API
async function loadContainers() {
  try {
    const apiContainers = await getAllContainers();
    containers.value = mapApiContainers(apiContainers);
    // Build id lookup map
    const idMap: Record<string, string> = {};
    for (const ac of apiContainers) {
      const uiName = ac.displayName || ac.name;
      idMap[uiName] = ac.id;
    }
    containerIdMap.value = idMap;
  } catch (e: any) {
    error.value = e.message || 'Failed to load containers';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadContainers();
});

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
const isCompact = computed(() => windowNarrow.value);

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

// Column visibility
const { allColumns, visibleColumns, activeColumns, showColumnPicker, toggleColumn } =
  useColumnVisibility(isCompact);

// Map activeColumns to DataTable format
const tableColumns = computed(() =>
  activeColumns.value.map((col) => ({
    key: col.key,
    label: col.label,
    align: col.align,
    sortable: true,
    width: col.key === 'name' ? '99%' : undefined,
  })),
);

// Detail panel
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

// Close menus on outside click
function handleGlobalClick() {
  openActionsMenu.value = null;
  showColumnPicker.value = false;
}
onMounted(() => document.addEventListener('click', handleGlobalClick));
onUnmounted(() => document.removeEventListener('click', handleGlobalClick));

// Container action handlers
const actionInProgress = ref<string | null>(null);

async function updateContainer(name: string) {
  const containerId = containerIdMap.value[name];
  if (!containerId || actionInProgress.value) return;
  actionInProgress.value = name;
  try {
    await apiUpdateContainer(containerId);
    await loadContainers();
  } catch (e: any) {
    console.error('Update failed:', e.message);
  } finally {
    actionInProgress.value = null;
  }
}

function skipUpdate(name: string) {
  console.log('skip', name);
}

function forceUpdate(name: string) {
  console.log('force', name);
}
</script>

<template>
  <AppLayout>
    <!-- MAIN CONTAINERS LIST (not full page) -->
    <div v-if="!containerFullPage" class="flex flex-col" style="height: calc(100vh - 48px);">

      <!-- CONTENT + DETAIL PANEL FLEX WRAPPER -->
      <div class="flex gap-4 min-w-0 flex-1 min-h-0 pb-4">

      <!-- Left: filters + table (scrollbar outside table) -->
      <div class="flex-1 min-w-0 overflow-y-auto pr-4 pb-4 pl-4 pt-4">

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
          <div v-if="containerViewMode === 'table'" class="relative">
            <button class="w-7 h-7 dd-rounded flex items-center justify-center text-[11px] transition-colors border"
                    :class="showColumnPicker ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                    :style="{ borderColor: 'var(--dd-border-strong)' }"
                    title="Toggle columns"
                    @click.stop="showColumnPicker = !showColumnPicker">
              <AppIcon name="config" :size="10" />
            </button>
            <div v-if="showColumnPicker" @click.stop
                 class="absolute right-0 top-9 z-50 min-w-[160px] py-1.5 dd-rounded shadow-lg"
                 :style="{
                   backgroundColor: 'var(--dd-bg-card)',
                   border: '1px solid var(--dd-border-strong)',
                   boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                 }">
              <div class="px-3 py-1 text-[9px] font-bold uppercase tracking-wider dd-text-muted">Columns</div>
              <button v-for="col in allColumns" :key="col.key"
                      class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 hover:dd-bg-elevated"
                      :class="col.required ? 'dd-text-muted cursor-not-allowed' : 'dd-text'"
                      @click="toggleColumn(col.key)">
                <AppIcon :name="visibleColumns.has(col.key) ? 'check' : 'square'" :size="10" :style="visibleColumns.has(col.key) ? { color: 'var(--dd-primary)' } : {}" />
                {{ col.label }}
              </button>
            </div>
          </div>
        </template>
      </DataFilterBar>

      <!-- TABLE VIEW -->
      <DataTable v-if="containerViewMode === 'table' && filteredContainers.length > 0"
                 :columns="tableColumns"
                 :rows="sortedContainers"
                 row-key="name"
                 :sort-key="containerSortKey"
                 :sort-asc="containerSortAsc"
                 :selected-key="selectedContainer?.name"
                 :show-actions="!isCompact"
                 @update:sort-key="containerSortKey = $event"
                 @update:sort-asc="containerSortAsc = $event"
                 @row-click="selectContainer($event)">
        <!-- Container name + image (+ compact actions & badges) -->
        <template #cell-name="{ row: c }">
          <div class="flex items-start gap-2 min-w-0">
            <ContainerIcon :icon="c.icon" :size="20" class="shrink-0 mt-0.5" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <div class="font-medium truncate dd-text flex-1">{{ c.name }}</div>
                <!-- Compact: inline action icons (top-right) -->
                <div v-if="isCompact" class="flex items-center gap-0.5 shrink-0">
                  <button v-if="c.newTag && c.bouncer === 'blocked'"
                          class="w-7 h-7 dd-rounded flex items-center justify-center cursor-not-allowed dd-text-muted opacity-50"
                          title="Blocked by Bouncer" @click.stop>
                    <i class="fa-solid fa-lock text-[11px]" />
                  </button>
                  <button v-else-if="c.newTag"
                          class="w-7 h-7 dd-rounded flex items-center justify-center transition-all hover:dd-bg-elevated hover:scale-110 active:scale-95"
                          style="color: var(--dd-primary);"
                          title="Update" @click.stop="updateContainer(c.name)">
                    <AppIcon name="cloud-download" :size="14" />
                  </button>
                  <button v-else-if="c.status === 'running'"
                          class="w-7 h-7 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text-danger hover:dd-bg-elevated hover:scale-110 active:scale-95"
                          title="Stop" @click.stop>
                    <AppIcon name="stop" :size="12" />
                  </button>
                  <button v-else
                          class="w-7 h-7 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text-success hover:dd-bg-elevated hover:scale-110 active:scale-95"
                          title="Start" @click.stop>
                    <AppIcon name="play" :size="12" />
                  </button>
                  <button class="w-7 h-7 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text hover:dd-bg-elevated hover:scale-110 active:scale-95"
                          :class="openActionsMenu === c.name ? 'dd-bg-elevated dd-text' : ''"
                          title="More" @click.stop="toggleActionsMenu(c.name, $event)">
                    <i class="fa-solid fa-ellipsis-vertical text-[11px]" />
                  </button>
                </div>
              </div>
              <div class="text-[10px] mt-0.5 truncate dd-text-muted">{{ c.image }}</div>
              <!-- Compact mode: folded badge row -->
              <div v-if="isCompact" class="flex items-center gap-1.5 mt-1.5">
                <span v-if="c.newTag" class="inline-flex items-center gap-0.5 text-[9px] font-semibold dd-text-secondary shrink-0">
                  {{ c.currentTag }}
                  <i class="fa-solid fa-arrow-right text-[7px] dd-text-muted mx-0.5" />
                  <span style="color: var(--dd-primary);">{{ c.newTag }}</span>
                </span>
                <div class="flex items-center gap-1.5 ml-auto shrink-0">
                <span v-if="c.updateKind" class="badge px-1.5 py-0 text-[9px]"
                      :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }"
                      :title="c.updateKind">
                  <i :class="c.updateKind === 'major' ? 'fa-solid fa-angles-up' : c.updateKind === 'minor' ? 'fa-solid fa-angle-up' : c.updateKind === 'patch' ? 'fa-solid fa-hashtag' : 'fa-solid fa-fingerprint'" />
                </span>
                <span class="badge px-1.5 py-0 text-[9px]"
                      :style="{ backgroundColor: bouncerColor(c.bouncer).bg, color: bouncerColor(c.bouncer).text }"
                      :title="c.bouncer">
                  <i :class="c.bouncer === 'safe' ? 'fa-solid fa-check' : c.bouncer === 'blocked' ? 'fa-solid fa-ban' : 'fa-solid fa-triangle-exclamation'" />
                </span>
                <span class="badge px-1.5 py-0 text-[9px]"
                      :style="{
                        backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                        color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                      }"
                      :title="c.status">
                  <i :class="c.status === 'running' ? 'fa-solid fa-circle-play' : 'fa-solid fa-circle-stop'" />
                </span>
                <span class="badge text-[7px] font-bold px-1.5 py-0"
                      :style="{ backgroundColor: serverBadgeColor(c.server).bg, color: serverBadgeColor(c.server).text }">
                  {{ parseServer(c.server).name }}
                </span>
                </div>
              </div>
            </div>
          </div>
        </template>
        <!-- Version comparison -->
        <template #cell-version="{ row: c }">
          <div v-if="c.newTag" class="flex items-center justify-center gap-1.5">
            <span class="text-[11px] dd-text-secondary">{{ c.currentTag }}</span>
            <AppIcon name="arrow-right" :size="8" class="dd-text-muted" />
            <span class="text-[11px] font-semibold" style="color: var(--dd-primary);">{{ c.newTag }}</span>
          </div>
          <div v-else class="text-center">
            <span class="text-[11px] dd-text-secondary">{{ c.currentTag }}</span>
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
          <span class="badge text-[9px] font-bold"
                :style="{
                  backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                  color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                }">
            {{ c.status }}
          </span>
        </template>
        <!-- Bouncer badge -->
        <template #cell-bouncer="{ row: c }">
          <span class="badge text-[9px] uppercase font-bold"
                :style="{ backgroundColor: bouncerColor(c.bouncer).bg, color: bouncerColor(c.bouncer).text }">
            {{ c.bouncer }}
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
                      title="Blocked by Bouncer" @click.stop>
                <i class="fa-solid fa-lock text-[13px]" />
              </button>
              <button v-else-if="c.newTag"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-all hover:dd-bg-elevated hover:scale-110 active:scale-95"
                      style="color: var(--dd-primary);"
                      title="Update" @click.stop="updateContainer(c.name)">
                <AppIcon name="cloud-download" :size="16" />
              </button>
              <button v-else-if="c.status === 'running'"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text-danger hover:dd-bg-elevated hover:scale-110 active:scale-95"
                      title="Stop" @click.stop>
                <AppIcon name="stop" :size="14" />
              </button>
              <button v-else
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text-success hover:dd-bg-elevated hover:scale-110 active:scale-95"
                      title="Start" @click.stop>
                <AppIcon name="play" :size="14" />
              </button>
              <button class="w-8 h-8 dd-rounded flex items-center justify-center transition-all dd-text-muted hover:dd-text hover:dd-bg-elevated hover:scale-110 active:scale-95"
                      :class="openActionsMenu === c.name ? 'dd-bg-elevated dd-text' : ''"
                      title="More" @click.stop="toggleActionsMenu(c.name, $event)">
                <i class="fa-solid fa-ellipsis-vertical text-[13px]" />
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
                  <i class="fa-solid fa-lock text-[9px] mr-1" /> Blocked
                </button>
                <button class="inline-flex items-center justify-center w-7 transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ backgroundColor: 'var(--dd-bg)', borderLeft: '1px solid var(--dd-border-strong)' }"
                        :class="openActionsMenu === c.name ? 'dd-bg-elevated dd-text' : ''"
                        @click.stop="toggleActionsMenu(c.name, $event)">
                  <i class="fa-solid fa-chevron-down text-[8px]" />
                </button>
              </div>
              <!-- Updatable: gradient split button -->
              <div v-else class="inline-flex dd-rounded overflow-hidden" style="min-width: 110px;"
                   :style="{ boxShadow: '0 1px 3px rgba(0,150,199,0.3)' }">
                <button class="inline-flex items-center justify-center flex-1 whitespace-nowrap px-3 py-1.5 text-[11px] font-bold tracking-wide transition-all text-white"
                        :style="{ background: 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))' }"
                        @click.stop="updateContainer(c.name)">
                  <AppIcon name="updates" :size="10" class="mr-1" /> Update
                </button>
                <button class="inline-flex items-center justify-center w-7 text-white transition-all"
                        :style="{ background: 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))', borderLeft: '1px solid rgba(255,255,255,0.2)' }"
                        :class="openActionsMenu === c.name ? 'brightness-125' : ''"
                        @click.stop="toggleActionsMenu(c.name, $event)">
                  <i class="fa-solid fa-chevron-down text-[8px]" />
                </button>
              </div>
            </div>
            <div v-else class="flex items-center justify-end gap-1">
              <button v-if="c.status === 'running'"
                      class="w-6 h-6 dd-rounded-sm flex items-center justify-center transition-colors dd-text-danger hover:dd-bg-elevated"
                      title="Stop" @click.stop>
                <AppIcon name="stop" :size="11" />
              </button>
              <button v-else
                      class="w-6 h-6 dd-rounded-sm flex items-center justify-center transition-colors dd-text-success hover:dd-bg-elevated"
                      title="Start" @click.stop>
                <AppIcon name="play" :size="11" />
              </button>
              <button class="w-6 h-6 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                      title="Restart" @click.stop>
                <AppIcon name="restart" :size="11" />
              </button>
            </div>
          </template>
          <!-- Dropdown (fixed to escape table overflow) -->
          <div v-if="openActionsMenu === c.name"
               class="z-50 min-w-[160px] py-1 dd-rounded shadow-lg"
               :style="{
                 ...actionsMenuStyle,
                 backgroundColor: 'var(--dd-bg-card)',
                 border: '1px solid var(--dd-border-strong)',
                 boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
               }">
            <button v-if="c.status === 'running'" class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                    @click="closeActionsMenu()">
              <i class="fa-solid fa-stop text-[9px] w-3 text-center" style="color: var(--dd-danger);" />
              Stop
            </button>
            <button v-else class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                    @click="closeActionsMenu()">
              <i class="fa-solid fa-play text-[9px] w-3 text-center" style="color: var(--dd-success);" />
              Start
            </button>
            <button class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                    @click="closeActionsMenu()">
              <i class="fa-solid fa-rotate-right text-[9px] w-3 text-center dd-text-muted" />
              Restart
            </button>
            <template v-if="c.newTag">
              <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
              <button class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                      @click="skipUpdate(c.name); closeActionsMenu()">
                <i class="fa-solid fa-forward text-[9px] w-3 text-center dd-text-muted" />
                Skip this update
              </button>
              <button class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text hover:dd-bg-elevated"
                      @click="forceUpdate(c.name); closeActionsMenu()">
                <i class="fa-solid fa-bolt text-[9px] w-3 text-center dd-text-muted" />
                Force update
              </button>
            </template>
            <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
            <button class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 dd-text-danger hover:dd-bg-elevated"
                    @click="closeActionsMenu()">
              <i class="fa-solid fa-eye-slash text-[9px] w-3 text-center" />
              Ignore container
            </button>
          </div>
        </template>
      </DataTable>

      <!-- CONTAINER CARD GRID -->
      <DataCardGrid v-if="containerViewMode === 'cards' && sortedContainers.length > 0"
                    :items="sortedContainers"
                    item-key="name"
                    :selected-key="selectedContainer?.name"
                    @item-click="selectContainer($event)">
        <template #card="{ item: c }">
          <!-- Card header -->
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="flex items-center gap-2.5 min-w-0">
              <ContainerIcon :icon="c.icon" :size="24" class="shrink-0" />
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
          <div class="px-4 py-3">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[11px] dd-text-muted">Current</span>
              <span class="text-[12px] font-bold dd-text">
                {{ c.currentTag }}
              </span>
              <template v-if="c.newTag">
                <span class="text-[11px] ml-1 dd-text-muted">Latest</span>
                <span class="px-1.5 py-0.5 dd-rounded-sm text-[11px] font-bold"
                      :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">
                  {{ c.newTag }}
                </span>
              </template>
              <template v-else>
                <span class="flex items-center gap-1.5 text-[11px] font-medium ml-2"
                      :style="{ color: 'var(--dd-success)' }">
                  <AppIcon name="up-to-date" :size="10" />
                  Up to date
                </span>
              </template>
            </div>
          </div>

          <!-- Card footer -->
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{
                 borderTop: '1px solid var(--dd-border-strong)',
                 backgroundColor: 'var(--dd-bg-elevated)',
               }">
            <span class="text-[11px] font-semibold capitalize"
                  :style="{ color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }">
              {{ c.status === 'running' ? 'Running' : 'Stopped' }}
            </span>
            <div class="flex items-center gap-1.5">
              <button v-if="c.status === 'running'"
                      class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-danger hover:dd-bg-elevated"
                      title="Stop" @click.stop>
                <AppIcon name="stop" :size="14" />
              </button>
              <button v-else
                      class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-success hover:dd-text-success hover:dd-bg-elevated"
                      title="Start" @click.stop>
                <AppIcon name="play" :size="14" />
              </button>
              <button class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                      title="Restart" @click.stop>
                <AppIcon name="restart" :size="14" />
              </button>
              <button v-if="c.newTag"
                      class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors dd-text-warning hover:dd-text-warning hover:dd-bg-elevated"
                      title="Update" @click.stop>
                <AppIcon name="cloud-download" :size="14" />
              </button>
            </div>
          </div>
        </template>
      </DataCardGrid>

      <!-- LIST VIEW -->
      <DataListAccordion v-if="containerViewMode === 'list' && sortedContainers.length > 0"
                         :items="sortedContainers"
                         item-key="name"
                         :selected-key="selectedContainer?.name">
        <template #header="{ item: c }">
          <ContainerIcon :icon="c.icon" :size="18" class="shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold truncate dd-text">{{ c.name }}</div>
            <div class="text-[10px] mt-0.5 truncate dd-text-muted">{{ c.image }}:{{ c.currentTag }}</div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span v-if="c.updateKind" class="badge text-[9px] uppercase font-bold"
                  :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }">
              {{ c.updateKind }}
            </span>
            <span class="badge text-[9px] font-bold"
                  :style="{
                    backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ c.status }}
            </span>
            <span class="badge text-[9px] uppercase font-bold"
                  :style="{ backgroundColor: bouncerColor(c.bouncer).bg, color: bouncerColor(c.bouncer).text }">
              {{ c.bouncer }}
            </span>
            <span class="badge text-[7px] font-bold"
                  :style="{ backgroundColor: serverBadgeColor(c.server).bg, color: serverBadgeColor(c.server).text }">
              {{ parseServer(c.server).name }}
            </span>
          </div>
        </template>
        <template #details="{ item: c }">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 mt-2">
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Image</div>
              <div class="text-[12px] font-mono dd-text">{{ c.image }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Current Version</div>
              <div class="text-[12px] font-mono dd-text">{{ c.currentTag }}</div>
            </div>
            <div v-if="c.newTag">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Latest Version</div>
              <div class="text-[12px] font-mono font-semibold" style="color: var(--dd-primary);">{{ c.newTag }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Registry</div>
              <span class="badge text-[10px] uppercase font-bold"
                    :style="{ backgroundColor: registryColorBg(c.registry), color: registryColorText(c.registry) }">
                {{ registryLabel(c.registry) }}
              </span>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Host</div>
              <div class="text-[12px] dd-text">{{ c.server }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Bouncer</div>
              <span class="badge text-[10px] uppercase font-bold"
                    :style="{ backgroundColor: bouncerColor(c.bouncer).bg, color: bouncerColor(c.bouncer).text }">
                {{ c.bouncer }}
              </span>
            </div>
          </div>
          <!-- Action buttons -->
          <div class="mt-4 pt-3 flex items-center gap-2" :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
            <button v-if="c.newTag && c.bouncer !== 'blocked'"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-bold tracking-wide transition-all text-white"
                    :style="{ background: 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))', boxShadow: '0 1px 3px rgba(0,150,199,0.3)' }"
                    @click.stop="updateContainer(c.name)">
              <AppIcon name="cloud-download" :size="10" />
              Update
            </button>
            <button class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-medium transition-colors dd-text-secondary hover:dd-bg-elevated"
                    :style="{ border: '1px solid var(--dd-border-strong)' }"
                    @click.stop="selectContainer(c)">
              <AppIcon name="info" :size="10" />
              Details
            </button>
          </div>
        </template>
      </DataListAccordion>

      <!-- EMPTY STATE -->
      <EmptyState v-if="filteredContainers.length === 0"
                  icon="filter"
                  message="No containers match your filters"
                  :show-clear="activeFilterCount > 0"
                  @clear="clearFilters" />

      </div><!-- end left: filters + cards -->

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
          <span v-if="selectedContainer.newTag"
                class="badge text-[9px]"
                :style="{ backgroundColor: updateKindColor(selectedContainer.updateKind).bg, color: updateKindColor(selectedContainer.updateKind).text }">
            {{ selectedContainer.updateKind }} update
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
              <AppIcon :name="tab.icon" :size="10" class="mr-1" />
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
                  <AppIcon name="network" :size="9" class="dd-text-muted" />
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
                  <AppIcon name="hard-drive" :size="9" class="dd-text-muted" />
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
                  <span class="badge text-[9px] ml-1"
                        :style="{ backgroundColor: updateKindColor(selectedContainer.updateKind).bg, color: updateKindColor(selectedContainer.updateKind).text }">
                    {{ selectedContainer.updateKind }}
                  </span>
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
              <div class="overflow-y-auto" style="max-height: calc(100vh - 400px);">
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
                  <AppIcon name="hard-drive" :size="9" class="dd-text-muted" />
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

        </div>
      </DetailPanel>

      </div><!-- end content + detail panel flex wrapper -->
    </div>

    <!-- CONTAINER FULL PAGE DETAIL VIEW -->
    <div v-if="containerFullPage && selectedContainer"
         class="flex flex-col" style="height: calc(100vh - 48px);">

      <!-- Full-page header -->
      <div class="shrink-0 mx-4 mt-4 mb-4 dd-rounded overflow-hidden"
           :style="{
             backgroundColor: 'var(--dd-bg-card)',
             border: '1px solid var(--dd-border-strong)',
           }">
        <div class="px-5 py-4 flex items-center justify-between">
          <div class="flex items-center gap-4 min-w-0">
            <button class="flex items-center gap-2 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                    :style="{ border: '1px solid var(--dd-border-strong)' }"
                    @click="closeFullPage">
              <i class="fa-solid fa-arrow-left text-[10px]" />
              Back
            </button>
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-3 h-3 rounded-full shrink-0"
                   :style="{ backgroundColor: selectedContainer.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
              <div class="min-w-0">
                <h1 class="text-lg font-bold truncate dd-text">
                  {{ selectedContainer.name }}
                </h1>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-[12px] font-mono dd-text-secondary">
                    {{ selectedContainer.image }}:{{ selectedContainer.currentTag }}
                  </span>
                  <span class="badge text-[9px]"
                        :style="{
                          backgroundColor: selectedContainer.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                          color: selectedContainer.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                        }">
                    {{ selectedContainer.status }}
                  </span>
                  <span class="badge text-[9px] uppercase font-bold"
                        :style="{ backgroundColor: registryColorBg(selectedContainer.registry), color: registryColorText(selectedContainer.registry) }">
                    {{ registryLabel(selectedContainer.registry) }}
                  </span>
                  <span v-if="selectedContainer.newTag"
                        class="badge text-[9px]"
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
                    :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }">
              <AppIcon name="stop" :size="10" />
              Stop
            </button>
            <button v-else
                    class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
                    :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', border: '1px solid var(--dd-success)' }">
              <AppIcon name="play" :size="10" />
              Start
            </button>
            <button class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text"
                    :style="{ border: '1px solid var(--dd-border-strong)' }">
              <AppIcon name="restart" :size="10" />
              Restart
            </button>
            <button v-if="selectedContainer.newTag"
                    class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-bold transition-all text-white"
                    :style="{ background: 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))', boxShadow: '0 1px 3px rgba(0,150,199,0.3)' }">
              <AppIcon name="cloud-download" :size="10" />
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
            <AppIcon :name="tab.icon" :size="11" class="mr-1.5" />
            {{ tab.label }}
            <div v-if="activeDetailTab === tab.id"
                 class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full" />
          </button>
        </div>
      </div>

      <!-- Full-page tab content -->
      <div class="flex-1 overflow-y-auto min-h-0 px-4 pb-4">

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
                <i class="fa-solid fa-terminal text-[10px]" style="color: #64748b;" />
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

      </div>
    </div>
  </AppLayout>
</template>
