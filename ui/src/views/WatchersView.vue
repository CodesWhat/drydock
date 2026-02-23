<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { getAllContainers } from '../services/container';
import { getAllWatchers } from '../services/watcher';
import { useBreakpoints } from '../composables/useBreakpoints';

const { isMobile } = useBreakpoints();
const route = useRoute();
const watchersViewMode = ref<'table' | 'cards' | 'list'>('table');
const selectedWatcher = ref<any | null>(null);
const detailOpen = ref(false);

function openDetail(w: any) {
  selectedWatcher.value = w;
  detailOpen.value = true;
}

const watchersData = ref<any[]>([]);
const loading = ref(true);
const error = ref('');

function watcherStatusColor(status: string) {
  if (status === 'watching') return 'var(--dd-success)';
  if (status === 'paused') return 'var(--dd-warning)';
  return 'var(--dd-neutral)';
}

const searchQuery = ref('');
const showFilters = ref(false);
const activeFilterCount = computed(() => (searchQuery.value ? 1 : 0));

function applySearchFromQuery(queryValue: unknown) {
  const raw = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  searchQuery.value = typeof raw === 'string' ? raw : '';
}

applySearchFromQuery(route.query.q);
watch(
  () => route.query.q,
  (value) => applySearchFromQuery(value),
);

const filteredWatchers = computed(() => {
  if (!searchQuery.value) return watchersData.value;
  const q = searchQuery.value.toLowerCase();
  return watchersData.value.filter((item) => item.name.toLowerCase().includes(q));
});

const tableColumns = [
  { key: 'name', label: 'Watcher', width: '35%', sortable: false },
  { key: 'status', label: 'Status', width: '15%', align: 'text-center', sortable: false },
  { key: 'containers', label: 'Containers', width: '15%', align: 'text-center', sortable: false },
  { key: 'cron', label: 'Schedule', width: '20%', align: 'text-center', sortable: false },
  { key: 'lastRun', label: 'Last Run', width: '15%', align: 'text-right', sortable: false },
];

onMounted(async () => {
  try {
    const [watcherData, containerData] = await Promise.all([getAllWatchers(), getAllContainers()]);

    const containerCounts: Record<string, number> = {};
    for (const c of containerData) {
      const key = c.watcher || 'unknown';
      containerCounts[key] = (containerCounts[key] || 0) + 1;
    }

    watchersData.value = watcherData.map((w: any) => ({
      id: w.id,
      name: w.name,
      type: w.type,
      status: 'watching',
      containers: containerCounts[w.id] ?? containerData.length,
      cron: w.configuration?.cron ?? '',
      lastRun: '\u2014',
      config: w.configuration ?? {},
    }));
  } catch {
    error.value = 'Failed to load watchers';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DataViewLayout>
    <div v-if="error"
         class="mb-3 px-3 py-2 text-[11px] dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="loading" class="text-[11px] dd-text-muted py-3 px-1">Loading watchers...</div>

    <!-- Filter bar -->
    <DataFilterBar
      v-model="watchersViewMode"
      v-model:showFilters="showFilters"
      :filtered-count="filteredWatchers.length"
      :total-count="watchersData.length"
      :active-filter-count="activeFilterCount"
    >
      <template #filters>
        <input v-model="searchQuery"
               type="text"
               placeholder="Filter by name..."
               class="flex-1 min-w-[120px] max-w-[240px] px-2.5 py-1.5 dd-rounded text-[11px] font-medium border outline-none dd-bg dd-text dd-border-strong dd-placeholder" />
        <button v-if="searchQuery"
                class="text-[10px] dd-text-muted hover:dd-text transition-colors"
                @click="searchQuery = ''">
          Clear
        </button>
      </template>
    </DataFilterBar>

    <!-- Table view -->
    <DataTable
      v-if="watchersViewMode === 'table' && filteredWatchers.length > 0 && !loading"
      :columns="tableColumns"
      :rows="filteredWatchers"
      row-key="id"
      :active-row="selectedWatcher?.id"
      @row-click="openDetail($event)"
    >
      <template #cell-name="{ row }">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full shrink-0"
               :style="{ backgroundColor: watcherStatusColor(row.status) }" />
          <span class="font-medium dd-text">{{ row.name }}</span>
        </div>
      </template>
      <template #cell-status="{ row }">
        <AppIcon :name="row.status === 'watching' ? 'watchers' : 'pause'" :size="13" class="shrink-0 md:!hidden"
                 :style="{ color: watcherStatusColor(row.status) }" />
        <span class="badge text-[9px] font-bold max-md:!hidden"
              :style="{
                backgroundColor: row.status === 'watching' ? 'var(--dd-success-muted)' : 'var(--dd-warning-muted)',
                color: row.status === 'watching' ? 'var(--dd-success)' : 'var(--dd-warning)',
              }">
          {{ row.status }}
        </span>
      </template>
      <template #cell-containers="{ row }">
        <span class="dd-text-secondary">{{ row.containers }}</span>
      </template>
      <template #cell-cron="{ row }">
        <span class="font-mono text-[10px] dd-text-secondary">{{ row.cron }}</span>
      </template>
      <template #cell-lastRun="{ row }">
        <span class="dd-text-muted">{{ row.lastRun }}</span>
      </template>
    </DataTable>

    <!-- Card view -->
    <DataCardGrid
      v-if="watchersViewMode === 'cards' && !loading"
      :items="filteredWatchers"
      item-key="id"
      :selected-key="selectedWatcher?.id"
      @item-click="openDetail($event)"
    >
      <template #card="{ item: watcher }">
        <div class="px-4 pt-4 pb-2 flex items-start justify-between">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                 :style="{ backgroundColor: watcherStatusColor(watcher.status) }" />
            <div class="min-w-0">
              <div class="text-[15px] font-semibold truncate dd-text">{{ watcher.name }}</div>
              <div class="text-[11px] truncate mt-0.5 dd-text-muted font-mono">{{ watcher.cron }}</div>
            </div>
          </div>
          <AppIcon :name="watcher.status === 'watching' ? 'watchers' : 'pause'" :size="13" class="shrink-0 ml-2 md:!hidden"
                   :style="{ color: watcherStatusColor(watcher.status) }" />
          <span class="badge text-[9px] uppercase font-bold shrink-0 ml-2 max-md:!hidden"
                :style="{
                  backgroundColor: watcher.status === 'watching' ? 'var(--dd-success-muted)' : 'var(--dd-warning-muted)',
                  color: watcher.status === 'watching' ? 'var(--dd-success)' : 'var(--dd-warning)',
                }">
            {{ watcher.status }}
          </span>
        </div>
        <div class="px-4 py-3">
          <div class="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span class="dd-text-muted">Containers</span>
              <span class="ml-1 font-semibold dd-text">{{ watcher.containers }}</span>
            </div>
            <div>
              <span class="dd-text-muted">Last run</span>
              <span class="ml-1 font-semibold dd-text">{{ watcher.lastRun }}</span>
            </div>
          </div>
        </div>
        <div class="px-4 py-2.5 mt-auto"
             :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
          <span class="text-[10px] dd-text-muted">{{ watcher.containers }} containers watched</span>
        </div>
      </template>
    </DataCardGrid>

    <!-- List view (accordion) -->
    <DataListAccordion
      v-if="watchersViewMode === 'list' && !loading"
      :items="filteredWatchers"
      item-key="id"
      :selected-key="selectedWatcher?.id"
      @item-click="openDetail($event)"
    >
      <template #header="{ item: watcher }">
        <div class="w-2.5 h-2.5 rounded-full shrink-0"
             :style="{ backgroundColor: watcherStatusColor(watcher.status) }" />
        <AppIcon name="watchers" :size="14" class="dd-text-secondary" />
        <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ watcher.name }}</span>
        <AppIcon :name="watcher.status === 'watching' ? 'watchers' : 'pause'" :size="13" class="shrink-0 md:!hidden"
                 :style="{ color: watcherStatusColor(watcher.status) }" />
        <span class="badge text-[9px] uppercase font-bold shrink-0 max-md:!hidden"
              :style="{
                backgroundColor: watcher.status === 'watching' ? 'var(--dd-success-muted)' : 'var(--dd-warning-muted)',
                color: watcher.status === 'watching' ? 'var(--dd-success)' : 'var(--dd-warning)',
              }">
          {{ watcher.status }}
        </span>
        <span v-if="watcher.config.maintenanceWindow"
              class="badge text-[9px] uppercase font-bold shrink-0"
              :style="{ backgroundColor: 'var(--dd-alt-muted)', color: 'var(--dd-alt)' }">
          Maint
        </span>
      </template>
      <template #details="{ item: watcher }">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Cron</div>
            <div class="text-[12px] font-mono dd-text">{{ watcher.cron }}</div>
          </div>
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Last Run</div>
            <div class="text-[12px] font-mono dd-text">{{ watcher.lastRun }}</div>
          </div>
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Containers Watched</div>
            <div class="text-[12px] font-mono dd-text">{{ watcher.containers }}</div>
          </div>
          <div v-for="(val, key) in watcher.config" :key="key">
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">{{ key }}</div>
            <div class="text-[12px] font-mono dd-text">{{ val }}</div>
          </div>
        </div>
      </template>
    </DataListAccordion>

    <!-- Empty state -->
    <EmptyState
      v-if="filteredWatchers.length === 0 && !loading"
      icon="watchers"
      message="No watchers match your filters"
      :show-clear="activeFilterCount > 0"
      @clear="searchQuery = ''"
    />

    <template #panel>
      <DetailPanel
        :open="detailOpen"
        :is-mobile="isMobile"
        :show-size-controls="false"
        :show-full-page="false"
        @update:open="detailOpen = $event; if (!$event) selectedWatcher = null"
      >
        <template #header>
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="text-sm font-bold truncate dd-text">{{ selectedWatcher?.name }}</span>
            <span v-if="selectedWatcher" class="badge text-[9px] font-bold shrink-0"
                  :style="{
                    backgroundColor: selectedWatcher.status === 'watching' ? 'var(--dd-success-muted)' : 'var(--dd-warning-muted)',
                    color: selectedWatcher.status === 'watching' ? 'var(--dd-success)' : 'var(--dd-warning)',
                  }">
              {{ selectedWatcher.status }}
            </span>
          </div>
        </template>

        <template #subtitle>
          <span class="text-[11px] font-mono dd-text-secondary">{{ selectedWatcher?.type }}</span>
        </template>

        <template v-if="selectedWatcher" #default>
          <div class="p-4 space-y-5">
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Containers</div>
              <div class="text-lg font-bold dd-text">{{ selectedWatcher.containers }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Schedule</div>
              <div class="text-[12px] font-mono dd-text">{{ selectedWatcher.cron || '\u2014' }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Last Run</div>
              <div class="text-[12px] dd-text">{{ selectedWatcher.lastRun }}</div>
            </div>
            <div v-for="(val, key) in selectedWatcher.config" :key="key">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">{{ key }}</div>
              <div class="text-[12px] font-mono dd-text break-all">{{ val }}</div>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
