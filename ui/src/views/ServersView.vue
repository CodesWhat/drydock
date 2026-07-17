<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppBadge from '@/components/AppBadge.vue';
import DataTableColumnPicker from '@/components/DataTableColumnPicker.vue';
import DetailField from '@/components/DetailField.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { type PickerColumn, useViewColumnVisibility } from '../composables/useViewColumnVisibility';
import { useViewMode } from '../preferences/useViewMode';
import { getAgents } from '../services/agent';
import { getServer } from '../services/server';
import { getAllWatchers } from '../services/watcher';
import { errorMessage } from '../utils/error';

interface ServerEntry {
  id: string;
  name: string;
  host: string;
  status: 'connected' | 'disconnected';
  containers: { total: number; running: number; stopped: number };
  images: number | string;
  lastSeen: string;
}

const { t } = useI18n();
const loading = ref(true);
const error = ref<string | null>(null);
const servers = ref<ServerEntry[]>([]);

const searchQuery = ref('');
const showFilters = ref(false);
const serverViewMode = useViewMode('servers');
// Set by DataTable's measured-width reflow (< 640px): hides the table/cards toggle when the
// width has already forced cards, so the switcher isn't a dead control at that size.
const cardReflowForced = ref(false);
const activeFilterCount = computed(() => (searchQuery.value ? 1 : 0));

const filteredServers = computed(() => {
  if (!searchQuery.value) return servers.value;
  const q = searchQuery.value.toLowerCase();
  return servers.value.filter(
    (s) => s.name.toLowerCase().includes(q) || s.host.toLowerCase().includes(q),
  );
});

const { isMobile } = useBreakpoints();
const selectedServer = ref<ServerEntry | null>(null);
const detailOpen = ref(false);

function openDetail(server: ServerEntry) {
  selectedServer.value = server;
  detailOpen.value = true;
}

function closeDetail() {
  detailOpen.value = false;
  selectedServer.value = null;
}

const tableColumns = computed(() => [
  {
    key: 'name',
    label: t('serversView.columns.host'),
    size: 220,
    minSize: 160,
    maxSize: 360,
    flex: 1,
    sortable: false,
    required: true,
  },
  {
    key: 'host',
    label: t('serversView.columns.address'),
    size: 240,
    minSize: 180,
    maxSize: 420,
    flex: 1,
    sortable: false,
  },
  {
    key: 'status',
    label: t('serversView.columns.status'),
    size: 120,
    minSize: 96,
    maxSize: 150,
    sortable: false,
    cardPriority: 1,
  },
  {
    key: 'containers',
    label: t('serversView.columns.containers'),
    size: 150,
    minSize: 120,
    maxSize: 190,
    sortable: false,
  },
  {
    key: 'lastSeen',
    label: t('serversView.columns.lastSeen'),
    align: 'text-right',
    size: 140,
    minSize: 116,
    maxSize: 190,
    sortable: false,
  },
]);

const pickerColumns = computed<PickerColumn[]>(() =>
  tableColumns.value.map((column) => ({
    key: column.key,
    label: column.label,
    required: 'required' in column ? column.required : undefined,
  })),
);

const { hiddenColumnKeys, toggleColumn, resetColumns } = useViewColumnVisibility(
  'servers',
  pickerColumns,
);

interface WatcherContainerCounts {
  total: number;
  running: number;
  stopped: number;
}

function readContainerCounts(metadata: unknown): WatcherContainerCounts {
  if (!metadata || typeof metadata !== 'object') {
    return { total: 0, running: 0, stopped: 0 };
  }
  const containers = (metadata as { containers?: unknown }).containers;
  if (!containers || typeof containers !== 'object') {
    return { total: 0, running: 0, stopped: 0 };
  }
  const c = containers as { total?: unknown; running?: unknown; stopped?: unknown };
  return {
    total: typeof c.total === 'number' ? c.total : 0,
    running: typeof c.running === 'number' ? c.running : 0,
    stopped: typeof c.stopped === 'number' ? c.stopped : 0,
  };
}

function readImageCount(metadata: unknown): number {
  if (!metadata || typeof metadata !== 'object') return 0;
  const images = (metadata as { images?: unknown }).images;
  return typeof images === 'number' ? images : 0;
}

function deriveWatcherHost(config: Record<string, unknown>): string {
  if (typeof config.socket === 'string' && config.socket) {
    return `unix://${config.socket}`;
  }
  const host = typeof config.host === 'string' ? config.host : '';
  const port = typeof config.port === 'number' ? config.port : undefined;
  const protocol = typeof config.protocol === 'string' ? config.protocol : '';
  if (host) {
    return port ? `${protocol || 'http'}://${host}:${port}` : host;
  }
  return 'unknown';
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function serverStatusLabel(status: string): string {
  if (status === 'connected') return t('serversView.status.connected');
  return t('serversView.status.disconnected');
}

async function fetchServers() {
  loading.value = true;
  error.value = null;
  try {
    const [, agentsData, watchersData] = await Promise.all([
      getServer(),
      getAgents(),
      getAllWatchers(),
    ]);
    const entries: ServerEntry[] = [];

    const localWatchers = (watchersData ?? []).filter((w: Record<string, unknown>) => !w.agent);

    for (const watcher of localWatchers) {
      const name = String(watcher.name ?? 'unknown');
      const config = (watcher.configuration ?? {}) as Record<string, unknown>;

      entries.push({
        id: String(watcher.id ?? name),
        name: capitalize(name),
        host: deriveWatcherHost(config),
        status: 'connected',
        containers: readContainerCounts(watcher.metadata),
        images: readImageCount(watcher.metadata),
        lastSeen: t('serversView.justNow'),
      });
    }

    for (const agent of agentsData) {
      const agentConnected = !!agent.connected;

      entries.push({
        id: agent.name,
        name: agent.name,
        host: `${agent.host}${agent.port ? `:${agent.port}` : ''}`,
        status: agentConnected ? 'connected' : 'disconnected',
        containers: {
          total: agent.containers?.total ?? 0,
          running: agent.containers?.running ?? 0,
          stopped: agent.containers?.stopped ?? 0,
        },
        images: typeof agent.images === 'number' ? agent.images : 0,
        lastSeen: agentConnected ? t('serversView.justNow') : t('serversView.never'),
      });
    }

    servers.value = entries;
  } catch (e: unknown) {
    error.value = errorMessage(e, t('serversView.loadError'));
  } finally {
    loading.value = false;
  }
}

onMounted(fetchServers);
</script>

<template>
  <DataViewLayout>
    <div v-if="error"
         class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">{{ t('serversView.loadingServerData') }}</div>

    <!-- Filter bar -->
    <DataFilterBar
      v-model="serverViewMode"
      v-model:showFilters="showFilters"
      :filtered-count="filteredServers.length"
      :total-count="servers.length"
      :active-filter-count="activeFilterCount"
      :hide-view-toggle="cardReflowForced"
    >
      <template #filters>
        <input v-model="searchQuery"
               type="text"
               :placeholder="t('serversView.filterPlaceholder')"
               class="flex-1 min-w-[120px] max-w-[var(--dd-layout-filter-max-width)] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
        <AppButton size="none" variant="text-muted" weight="medium" class="text-2xs" v-if="searchQuery"
                
                @click="searchQuery = ''">
          {{ t('serversView.clear') }}
        </AppButton>
      </template>
      <template #extra-buttons>
        <DataTableColumnPicker
          :columns="pickerColumns"
          :hidden-keys="hiddenColumnKeys"
          @toggle="toggleColumn"
          @reset="resetColumns" />
      </template>
    </DataFilterBar>

        <!-- Table view -->
        <DataTable
          v-if="filteredServers.length > 0 && !loading"
          :columns="tableColumns"
          storage-key="servers"
          :rows="filteredServers"
          row-key="id"
          :hidden-column-keys="hiddenColumnKeys"
          :active-row="selectedServer?.id"
          :prefer-cards="serverViewMode === 'cards'"
          @update:card-reflow-forced="cardReflowForced = $event"
          @row-click="openDetail($event)"
        >
          <template #cell-name="{ row }">
            <div class="flex items-center gap-2">
              <AppIcon name="servers" :size="12" class="dd-text-secondary" />
              <span class="font-medium dd-text">{{ row.name }}</span>
            </div>
          </template>
          <template #cell-host="{ row }">
            <span class="block max-w-[220px] truncate font-mono text-2xs dd-text-secondary"
                  :title="row.host"
                  v-tooltip.top="row.host">
              {{ row.host }}
            </span>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="row.status === 'connected' ? 'success' : 'danger'" size="xs" class="px-1.5 py-0 md:!hidden" v-tooltip.top="serverStatusLabel(row.status)">
              <AppIcon :name="row.status === 'connected' ? 'check' : 'xmark'" :size="12" />
            </AppBadge>
            <AppBadge :tone="row.status === 'connected' ? 'success' : 'danger'" size="xs" class="max-md:!hidden">
              {{ serverStatusLabel(row.status) }}
            </AppBadge>
          </template>
          <template #cell-containers="{ row }">
            <div class="flex items-center justify-center gap-2">
              <span class="font-semibold dd-text">{{ row.containers.total }}</span>
              <span class="text-2xs" :style="{ color: row.containers.running > 0 ? 'var(--dd-success)' : 'var(--dd-text-muted)' }">
                {{ row.containers.running }} {{ t('serversView.detail.running') }}
              </span>
            </div>
          </template>
          <template #cell-lastSeen="{ row }">
            <span :class="row.status === 'connected' ? 'dd-text-muted' : 'dd-text-danger'">
              {{ row.lastSeen }}
            </span>
          </template>
          <template #card="{ row }">
            <div class="relative flex flex-col flex-1">
              <!-- Header: servers icon + name + host address + status badge -->
              <div class="px-4 pt-4 pb-2 flex items-start justify-between">
                <div class="flex items-center gap-2.5 min-w-0">
                  <AppIcon name="servers" :size="14" class="dd-text-secondary shrink-0 mt-1" />
                  <div class="min-w-0">
                    <div class="text-sm-plus font-semibold truncate dd-text">{{ row.name }}</div>
                    <div class="text-2xs-plus truncate mt-0.5 dd-text-muted font-mono"
                         :title="row.host"
                         v-tooltip.top="row.host">
                      {{ row.host }}
                    </div>
                  </div>
                </div>
                <AppBadge :tone="row.status === 'connected' ? 'success' : 'danger'" size="xs" class="px-1.5 py-0 shrink-0 ml-2 md:!hidden" v-tooltip.top="serverStatusLabel(row.status)">
                  <AppIcon :name="row.status === 'connected' ? 'check' : 'xmark'" :size="12" />
                </AppBadge>
                <AppBadge :tone="row.status === 'connected' ? 'success' : 'danger'" size="xs" class="shrink-0 ml-2 max-md:!hidden">
                  {{ serverStatusLabel(row.status) }}
                </AppBadge>
              </div>
              <!-- Body: containers / running / images / last seen grid -->
              <div class="px-4 py-3">
                <div class="grid grid-cols-2 gap-2 text-2xs-plus">
                  <div>
                    <span class="dd-text-muted">{{ t('serversView.card.containers') }}</span>
                    <span class="ml-1 font-semibold dd-text">{{ row.containers.total }}</span>
                  </div>
                  <div>
                    <span class="dd-text-muted">{{ t('serversView.card.running') }}</span>
                    <span class="ml-1 font-semibold" :style="{ color: row.containers.running > 0 ? 'var(--dd-success)' : 'var(--dd-text-muted)' }">
                      {{ row.containers.running }}
                    </span>
                  </div>
                  <div>
                    <span class="dd-text-muted">{{ t('serversView.card.images') }}</span>
                    <span class="ml-1 font-semibold dd-text">{{ row.images }}</span>
                  </div>
                  <div>
                    <span class="dd-text-muted">{{ t('serversView.card.lastSeen') }}</span>
                    <span class="ml-1 font-semibold" :class="row.status === 'connected' ? 'dd-text' : 'dd-text-danger'">
                      {{ row.lastSeen }}
                    </span>
                  </div>
                </div>
              </div>
              <!-- Footer: running/total count -->
              <div class="px-4 py-2.5 mt-auto"
                   :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
                <span class="text-2xs"
                      :style="{ color: row.containers.running > 0 ? 'var(--dd-success)' : 'var(--dd-text-muted)' }">
                  {{ row.containers.running }}/{{ row.containers.total }} {{ t('serversView.detail.running') }}
                </span>
              </div>
            </div>
          </template>
        </DataTable>

        <!-- Empty state -->
        <EmptyState
          v-if="filteredServers.length === 0 && !loading"
          icon="servers"
          :message="t('serversView.emptyFiltered')"
          :show-clear="activeFilterCount > 0"
          @clear="searchQuery = ''"
        />

    <template #panel>
      <!-- Detail panel slide-in -->
      <DetailPanel
        :open="detailOpen"
        :is-mobile="isMobile"
        :show-size-controls="false"
        :show-full-page="false"
        @update:open="detailOpen = $event; if (!$event) selectedServer = null"
      >
        <template #header>
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="text-sm font-bold truncate dd-text">{{ selectedServer?.name }}</span>
            <AppBadge v-if="selectedServer" :tone="selectedServer.status === 'connected' ? 'success' : 'danger'" size="xs" class="shrink-0">
              {{ serverStatusLabel(selectedServer.status) }}
            </AppBadge>
          </div>
        </template>

        <template #subtitle>
          <span class="block max-w-[220px] truncate text-2xs-plus font-mono dd-text-secondary"
                :title="selectedServer?.host"
                v-tooltip.top="selectedServer?.host || ''">
            {{ selectedServer?.host }}
          </span>
        </template>

        <template v-if="selectedServer" #default>
          <div class="p-4 space-y-5">
            <!-- Containers -->
            <DetailField :label="t('serversView.detail.containers')">
              <div class="flex items-baseline gap-3 mt-1">
                <span class="text-lg font-bold dd-text">{{ selectedServer.containers.total }}</span>
                <span class="text-2xs-plus font-medium" :style="{ color: 'var(--dd-success)' }">
                  {{ selectedServer.containers.running }} {{ t('serversView.detail.running') }}
                </span>
                <span v-if="selectedServer.containers.stopped > 0"
                      class="text-2xs-plus font-medium" style="color: var(--dd-danger);">
                  {{ selectedServer.containers.stopped }} {{ t('serversView.detail.stopped') }}
                </span>
              </div>
            </DetailField>

            <!-- Images -->
            <DetailField :label="t('serversView.detail.images')" mono>{{ selectedServer.images }}</DetailField>

            <!-- Last Seen -->
            <DetailField :label="t('serversView.detail.lastSeen')">
              <div class="text-xs font-medium"
                   :class="selectedServer.status === 'connected' ? 'dd-text' : 'dd-text-danger'">
                {{ selectedServer.lastSeen }}
              </div>
            </DetailField>

            <!-- Actions -->
            <div class="pt-2 flex gap-2"
                 :style="{ borderTop: '1px solid var(--dd-border)' }">
              <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated"
                      @click="fetchServers()">
                <AppIcon name="restart" :size="11" />
                {{ t('serversView.detail.refresh') }}
              </AppButton>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
