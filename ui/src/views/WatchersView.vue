<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getAllWatchers } from '../services/watcher';

const watchersViewMode = ref<'table' | 'cards' | 'list'>('table');

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

const filteredWatchers = computed(() => {
  if (!searchQuery.value) return watchersData.value;
  const q = searchQuery.value.toLowerCase();
  return watchersData.value.filter((item) => item.name.toLowerCase().includes(q));
});

const tableColumns = [
  { key: 'name', label: 'Watcher', width: '99%', sortable: false },
  { key: 'status', label: 'Status', align: 'text-center', sortable: false },
  { key: 'containers', label: 'Containers', align: 'text-center', sortable: false },
  { key: 'cron', label: 'Schedule', align: 'text-center', sortable: false },
  { key: 'lastRun', label: 'Last Run', align: 'text-right', sortable: false },
];

onMounted(async () => {
  try {
    const data = await getAllWatchers();
    watchersData.value = data.map((w: any) => ({
      id: w.id,
      name: w.name,
      type: w.type,
      status: 'watching',
      containers: 0,
      cron: w.configuration?.cron ?? '',
      lastRun: '',
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
      v-if="watchersViewMode === 'table' && filteredWatchers.length > 0"
      :columns="tableColumns"
      :rows="filteredWatchers"
      row-key="id"
    >
      <template #cell-name="{ row }">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full shrink-0"
               :style="{ backgroundColor: watcherStatusColor(row.status) }" />
          <span class="font-medium dd-text">{{ row.name }}</span>
        </div>
      </template>
      <template #cell-status="{ row }">
        <span class="badge text-[9px] font-bold"
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
      v-if="watchersViewMode === 'cards'"
      :items="filteredWatchers"
      item-key="id"
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
          <span class="badge text-[9px] uppercase font-bold shrink-0 ml-2"
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
      v-if="watchersViewMode === 'list'"
      :items="filteredWatchers"
      item-key="id"
    >
      <template #header="{ item: watcher }">
        <div class="w-2.5 h-2.5 rounded-full shrink-0"
             :style="{ backgroundColor: watcherStatusColor(watcher.status) }" />
        <AppIcon name="watchers" :size="14" class="dd-text-secondary" />
        <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ watcher.name }}</span>
        <span class="badge text-[9px] uppercase font-bold shrink-0"
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
  </DataViewLayout>
</template>
