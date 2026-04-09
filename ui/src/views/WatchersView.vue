<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppBadge from '@/components/AppBadge.vue';
import DetailField from '@/components/DetailField.vue';
import StatusDot from '@/components/StatusDot.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useViewMode } from '../preferences/useViewMode';
import { getAllContainers } from '../services/container';
import { getAllWatchers, getWatcher } from '../services/watcher';
import type { ApiComponent } from '../types/api';
import { ROUTES } from '../router/routes';
import { timeAgo } from '../utils/audit-helpers';

function watcherServerName(name: unknown): string {
  const s = String(name || '');
  if (s === 'local') return 'Local';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const { isMobile } = useBreakpoints();
const route = useRoute();
const router = useRouter();
const watchersViewMode = useViewMode('watchers');
const selectedWatcher = ref<Record<string, unknown> | null>(null);
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
let detailRequestId = 0;

const watchersData = ref<Record<string, unknown>[]>([]);
const loading = ref(true);
const error = ref('');
const containerCounts = ref<Record<string, number>>({});
const totalContainers = ref(0);

function watcherStatusColor(status: string) {
  if (status === 'watching') return 'var(--dd-success)';
  if (status === 'paused') return 'var(--dd-warning)';
  return 'var(--dd-neutral)';
}

function timeUntil(isoString: string): string {
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return isoString;

  const diffMs = then - Date.now();
  if (diffMs <= 0) return 'soon';

  const totalMinutes = Math.max(1, Math.ceil(diffMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
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
  { key: 'name', label: 'Watcher', width: '28%', sortable: false },
  { key: 'status', label: 'Status', width: '12%', sortable: false },
  { key: 'containers', label: 'Containers', width: '12%', sortable: false },
  { key: 'cron', label: 'Schedule', width: '18%', sortable: false },
  { key: 'nextRun', label: 'Next Run', width: '15%', sortable: false },
  { key: 'lastRun', label: 'Last Run', width: '15%', align: 'text-right', sortable: false },
];

function mapWatcher(watcher: ApiComponent, status = 'watching') {
  return {
    id: watcher.id,
    name: watcher.name,
    type: watcher.type,
    status,
    containers: containerCounts.value[watcher.name] ?? 0,
    cron: watcher.configuration?.cron ?? '',
    nextRun: watcher.metadata?.nextRunAt ? timeUntil(String(watcher.metadata.nextRunAt)) : '\u2014',
    lastRun: watcher.metadata?.lastRunAt ? timeAgo(String(watcher.metadata.lastRunAt)) : '\u2014',
    config: Object.fromEntries(
      Object.entries(watcher.configuration ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ),
    agent: watcher.agent,
  };
}

function resetDetailState() {
  detailOpen.value = false;
  detailLoading.value = false;
  detailError.value = '';
  selectedWatcher.value = null;
  detailRequestId += 1;
}

function handleDetailOpenChange(value: boolean) {
  if (!value) {
    resetDetailState();
  } else {
    detailOpen.value = true;
  }
}

async function openDetail(watcher: Record<string, unknown>) {
  selectedWatcher.value = watcher;
  detailOpen.value = true;
  detailLoading.value = true;
  detailError.value = '';
  const requestId = ++detailRequestId;

  try {
    const detail = await getWatcher({
      type: String(watcher.type),
      name: String(watcher.name),
      agent: watcher.agent as string | undefined,
    });
    if (requestId !== detailRequestId || !detailOpen.value) return;
    selectedWatcher.value = mapWatcher(detail, String(watcher.status));
  } catch {
    if (requestId !== detailRequestId) return;
    detailError.value = 'Unable to load latest watcher details';
  } finally {
    if (requestId === detailRequestId) {
      detailLoading.value = false;
    }
  }
}

onMounted(async () => {
  try {
    const [watcherData, containerData] = await Promise.all([getAllWatchers(), getAllContainers()]);

    const counts: Record<string, number> = {};
    for (const c of containerData) {
      const key = c.watcher || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    }
    containerCounts.value = counts;
    totalContainers.value = containerData.length;

    watchersData.value = watcherData.map((watcher: ApiComponent) => mapWatcher(watcher));
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
         class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">Loading watchers...</div>

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
               class="flex-1 min-w-[120px] max-w-[var(--dd-layout-filter-max-width)] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
        <AppButton size="none" variant="text-muted" weight="medium" class="text-2xs" v-if="searchQuery"
                
                @click="searchQuery = ''">
          Clear
        </AppButton>
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
          <StatusDot :color="watcherStatusColor(row.status)" v-tooltip.top="row.status === 'watching' ? 'Watching' : 'Paused'" />
          <span class="font-medium dd-text">{{ row.name }}</span>
        </div>
      </template>
      <template #cell-status="{ row }">
        <AppIcon :name="row.status === 'watching' ? 'watchers' : 'pause'" :size="13" class="shrink-0 md:!hidden"
                 v-tooltip.top="row.status === 'watching' ? 'Watching' : 'Paused'"
                 :style="{ color: watcherStatusColor(row.status) }" />
        <AppBadge :tone="row.status === 'watching' ? 'success' : 'warning'" size="xs" class="max-md:!hidden">
          {{ row.status }}
        </AppBadge>
      </template>
      <template #cell-containers="{ row }">
        <span class="dd-text-secondary">{{ row.containers }}</span>
      </template>
      <template #cell-cron="{ row }">
        <span class="font-mono text-2xs dd-text-secondary">{{ row.cron }}</span>
      </template>
      <template #cell-nextRun="{ row }">
        <span class="dd-text-secondary">{{ row.nextRun }}</span>
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
            <StatusDot :color="watcherStatusColor(watcher.status)" size="lg" class="mt-1" v-tooltip.top="watcher.status === 'watching' ? 'Watching' : 'Paused'" />
            <div class="min-w-0">
              <div class="text-sm-plus font-semibold truncate dd-text">{{ watcher.name }}</div>
              <div class="text-2xs-plus truncate mt-0.5 dd-text-muted font-mono">{{ watcher.cron }}</div>
            </div>
          </div>
          <AppIcon :name="watcher.status === 'watching' ? 'watchers' : 'pause'" :size="13" class="shrink-0 ml-2 md:!hidden"
                   v-tooltip.top="watcher.status === 'watching' ? 'Watching' : 'Paused'"
                   :style="{ color: watcherStatusColor(watcher.status) }" />
          <AppBadge :tone="watcher.status === 'watching' ? 'success' : 'warning'" size="xs" class="shrink-0 ml-2 max-md:!hidden">
            {{ watcher.status }}
          </AppBadge>
        </div>
        <div class="px-4 py-3">
          <div class="grid grid-cols-2 gap-2 text-2xs-plus">
            <div>
              <span class="dd-text-muted">Containers</span>
              <span class="ml-1 font-semibold dd-text">{{ watcher.containers }}</span>
            </div>
            <div>
              <span class="dd-text-muted">Next run</span>
              <span class="ml-1 font-semibold dd-text">{{ watcher.nextRun }}</span>
            </div>
            <div>
              <span class="dd-text-muted">Last run</span>
              <span class="ml-1 font-semibold dd-text">{{ watcher.lastRun }}</span>
            </div>
          </div>
        </div>
        <div class="px-4 py-2.5 mt-auto"
             :style="{ borderTop: '1px solid var(--dd-border)', backgroundColor: 'var(--dd-bg-elevated)' }">
          <span class="text-2xs dd-text-muted">{{ watcher.containers }} containers watched</span>
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
        <StatusDot :color="watcherStatusColor(watcher.status)" size="lg" v-tooltip.top="watcher.status === 'watching' ? 'Watching' : 'Paused'" />
        <AppIcon name="watchers" :size="14" class="dd-text-secondary" />
        <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ watcher.name }}</span>
        <AppIcon :name="watcher.status === 'watching' ? 'watchers' : 'pause'" :size="13" class="shrink-0 md:!hidden"
                 v-tooltip.top="watcher.status === 'watching' ? 'Watching' : 'Paused'"
                 :style="{ color: watcherStatusColor(watcher.status) }" />
        <AppBadge :tone="watcher.status === 'watching' ? 'success' : 'warning'" size="xs" class="shrink-0 max-md:!hidden">
          {{ watcher.status }}
        </AppBadge>
        <AppBadge v-if="watcher.config.maintenanceWindow" tone="alt" size="xs" class="shrink-0">
          Maint
        </AppBadge>
      </template>
      <template #details="{ item: watcher }">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
          <DetailField label="Cron" compact mono>{{ watcher.cron }}</DetailField>
          <DetailField label="Last Run" compact mono>{{ watcher.lastRun }}</DetailField>
          <DetailField label="Containers Watched" compact mono>{{ watcher.containers }}</DetailField>
          <DetailField v-for="(val, key) in watcher.config" :key="key" :label="String(key)" compact mono>{{ val }}</DetailField>
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
        @update:open="handleDetailOpenChange"
      >
        <template #header>
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="text-sm font-bold truncate dd-text">{{ selectedWatcher?.name }}</span>
            <AppBadge v-if="selectedWatcher" :tone="selectedWatcher.status === 'watching' ? 'success' : 'warning'" size="xs" class="shrink-0">
              {{ selectedWatcher.status }}
            </AppBadge>
          </div>
        </template>

        <template #subtitle>
          <span class="text-2xs-plus font-mono dd-text-secondary">{{ selectedWatcher?.type }}</span>
        </template>

        <template v-if="selectedWatcher" #default>
          <div class="p-4 space-y-5">
            <div v-if="detailLoading" class="text-2xs-plus dd-text-muted">Refreshing watcher details...</div>
            <div v-if="detailError"
                 class="px-3 py-2 text-2xs-plus dd-rounded"
                 :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ detailError }}
            </div>

            <DetailField label="Containers">
              <div class="text-lg font-bold dd-text">{{ selectedWatcher.containers }}</div>
              <AppButton
                v-if="selectedWatcher.containers > 0"
                size="none"
                variant="plain"
                weight="none"
                class="mt-1 inline-flex items-center gap-1 text-2xs-plus font-medium transition-colors text-drydock-secondary hover:text-drydock-secondary-hover"
                @click="router.push({ path: ROUTES.CONTAINERS, query: { filterServer: watcherServerName(selectedWatcher.name) } })">
                <AppIcon name="arrow-right" :size="10" />
                View containers
              </AppButton>
            </DetailField>
            <DetailField label="Schedule" mono>{{ selectedWatcher.cron || '\u2014' }}</DetailField>
            <DetailField label="Next Run">{{ selectedWatcher.nextRun }}</DetailField>
            <DetailField label="Last Run">{{ selectedWatcher.lastRun }}</DetailField>
            <DetailField v-for="(val, key) in selectedWatcher.config" :key="key" :label="String(key)" mono>{{ val }}</DetailField>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
