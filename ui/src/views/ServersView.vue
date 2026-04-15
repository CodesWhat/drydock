<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppBadge from '@/components/AppBadge.vue';
import DetailField from '@/components/DetailField.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useViewMode } from '../preferences/useViewMode';
import { getAgents } from '../services/agent';
import { getAllContainers } from '../services/container';
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

const serversViewMode = useViewMode('servers');
const loading = ref(true);
const error = ref<string | null>(null);
const servers = ref<ServerEntry[]>([]);

const searchQuery = ref('');
const showFilters = ref(false);
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

const tableColumns = [
  { key: 'name', label: 'Host', width: '30%', sortable: false },
  { key: 'host', label: 'Address', width: '30%', sortable: false },
  { key: 'status', label: 'Status', sortable: false },
  { key: 'containers', label: 'Containers', sortable: false },
  { key: 'lastSeen', label: 'Last Seen', align: 'text-right', sortable: false },
];

function countContainersByWatcher(
  containers: Record<string, unknown>[],
): Record<string, { total: number; running: number; stopped: number }> {
  const counts: Record<string, { total: number; running: number; stopped: number }> = {};
  for (const c of containers) {
    const watcher = c.watcher ?? 'local';
    if (!counts[watcher]) {
      counts[watcher] = { total: 0, running: 0, stopped: 0 };
    }
    counts[watcher].total++;
    if (c.status === 'running') {
      counts[watcher].running++;
    } else {
      counts[watcher].stopped++;
    }
  }
  return counts;
}

function countImagesByWatcher(containers: Record<string, unknown>[]): Record<string, number> {
  const imagesByWatcher: Record<string, Set<string>> = {};
  for (const c of containers) {
    const watcher = c.watcher ?? 'local';
    if (!imagesByWatcher[watcher]) imagesByWatcher[watcher] = new Set();
    imagesByWatcher[watcher].add(c.image ?? 'unknown');
  }
  const counts: Record<string, number> = {};
  for (const [watcher, images] of Object.entries(imagesByWatcher)) {
    counts[watcher] = images.size;
  }
  return counts;
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

async function fetchServers() {
  loading.value = true;
  error.value = null;
  try {
    const [, agentsData, containersData, watchersData] = await Promise.all([
      getServer(),
      getAgents(),
      getAllContainers(),
      getAllWatchers(),
    ]);
    const safeContainers = containersData ?? [];
    const containerCounts = countContainersByWatcher(safeContainers);
    const imageCounts = countImagesByWatcher(safeContainers);
    const entries: ServerEntry[] = [];

    const localWatchers = (watchersData ?? []).filter((w: Record<string, unknown>) => !w.agent);

    for (const watcher of localWatchers) {
      const name = String(watcher.name ?? 'unknown');
      const config = (watcher.configuration ?? {}) as Record<string, unknown>;
      const counts = containerCounts[name] ?? { total: 0, running: 0, stopped: 0 };

      entries.push({
        id: String(watcher.id ?? name),
        name: capitalize(name),
        host: deriveWatcherHost(config),
        status: 'connected',
        containers: counts,
        images: imageCounts[name] ?? 0,
        lastSeen: 'Just now',
      });
    }

    for (const agent of agentsData) {
      const agentConnected = !!agent.connected;
      const watcherName = agent.name?.toLowerCase();
      const agentCounts =
        watcherName && containerCounts[watcherName]
          ? containerCounts[watcherName]
          : { total: 0, running: 0, stopped: 0 };

      entries.push({
        id: agent.name,
        name: agent.name,
        host: `${agent.host}${agent.port ? `:${agent.port}` : ''}`,
        status: agentConnected ? 'connected' : 'disconnected',
        containers: agentCounts,
        images: watcherName && imageCounts[watcherName] ? imageCounts[watcherName] : 0,
        lastSeen: agentConnected ? 'Just now' : 'Never',
      });
    }

    servers.value = entries;
  } catch (e: unknown) {
    error.value = errorMessage(e, 'Failed to load server data');
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

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">Loading server data...</div>

    <!-- Filter bar -->
    <DataFilterBar
      v-model="serversViewMode"
      v-model:showFilters="showFilters"
      :filtered-count="filteredServers.length"
      :total-count="servers.length"
      :active-filter-count="activeFilterCount"
    >
      <template #filters>
        <input v-model="searchQuery"
               type="text"
               placeholder="Filter by name or address..."
               class="flex-1 min-w-[120px] max-w-[var(--dd-layout-filter-max-width)] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
        <AppButton size="none" variant="text-muted" weight="medium" class="text-2xs" v-if="searchQuery"
                
                @click="searchQuery = ''">
          Clear
        </AppButton>
      </template>
    </DataFilterBar>

        <!-- Table view -->
        <DataTable
          v-if="serversViewMode === 'table' && filteredServers.length > 0 && !loading"
          :columns="tableColumns"
          :rows="filteredServers"
          row-key="id"
          :active-row="selectedServer?.id"
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
            <AppBadge :tone="row.status === 'connected' ? 'success' : 'danger'" size="xs" class="px-1.5 py-0 md:!hidden" v-tooltip.top="row.status === 'connected' ? 'Connected' : 'Disconnected'">
              <AppIcon :name="row.status === 'connected' ? 'check' : 'xmark'" :size="12" />
            </AppBadge>
            <AppBadge :tone="row.status === 'connected' ? 'success' : 'danger'" size="xs" class="max-md:!hidden">
              {{ row.status }}
            </AppBadge>
          </template>
          <template #cell-containers="{ row }">
            <div class="flex items-center justify-center gap-2">
              <span class="font-semibold dd-text">{{ row.containers.total }}</span>
              <span class="text-2xs" :style="{ color: row.containers.running > 0 ? 'var(--dd-success)' : 'var(--dd-text-muted)' }">
                {{ row.containers.running }} running
              </span>
            </div>
          </template>
          <template #cell-lastSeen="{ row }">
            <span :class="row.status === 'connected' ? 'dd-text-muted' : 'dd-text-danger'">
              {{ row.lastSeen }}
            </span>
          </template>
        </DataTable>

        <!-- Card view -->
        <DataCardGrid
          v-if="serversViewMode === 'cards' && !loading"
          :items="filteredServers"
          item-key="id"
          :selected-key="selectedServer?.id"
          @item-click="openDetail($event)"
        >
          <template #card="{ item: server }">
            <div class="px-4 pt-4 pb-2 flex items-start justify-between">
              <div class="flex items-center gap-2.5 min-w-0">
                <AppIcon name="servers" :size="14" class="dd-text-secondary shrink-0 mt-1" />
                <div class="min-w-0">
                  <div class="text-sm-plus font-semibold truncate dd-text">{{ server.name }}</div>
                  <div class="text-2xs-plus truncate mt-0.5 dd-text-muted font-mono"
                       :title="server.host"
                       v-tooltip.top="server.host">
                    {{ server.host }}
                  </div>
                </div>
              </div>
              <AppBadge :tone="server.status === 'connected' ? 'success' : 'danger'" size="xs" class="px-1.5 py-0 shrink-0 ml-2 md:!hidden" v-tooltip.top="server.status === 'connected' ? 'Connected' : 'Disconnected'">
                <AppIcon :name="server.status === 'connected' ? 'check' : 'xmark'" :size="12" />
              </AppBadge>
              <AppBadge :tone="server.status === 'connected' ? 'success' : 'danger'" size="xs" class="shrink-0 ml-2 max-md:!hidden">
                {{ server.status }}
              </AppBadge>
            </div>
            <div class="px-4 py-3">
              <div class="grid grid-cols-2 gap-2 text-2xs-plus">
                <div>
                  <span class="dd-text-muted">Containers</span>
                  <span class="ml-1 font-semibold dd-text">{{ server.containers.total }}</span>
                </div>
                <div>
                  <span class="dd-text-muted">Running</span>
                  <span class="ml-1 font-semibold" :style="{ color: server.containers.running > 0 ? 'var(--dd-success)' : 'var(--dd-text-muted)' }">
                    {{ server.containers.running }}
                  </span>
                </div>
                <div>
                  <span class="dd-text-muted">Images</span>
                  <span class="ml-1 font-semibold dd-text">{{ server.images }}</span>
                </div>
                <div>
                  <span class="dd-text-muted">Last seen</span>
                  <span class="ml-1 font-semibold" :class="server.status === 'connected' ? 'dd-text' : 'dd-text-danger'">
                    {{ server.lastSeen }}
                  </span>
                </div>
              </div>
            </div>
            <div class="px-4 py-2.5 mt-auto"
                 :style="{ borderTop: '1px solid var(--dd-border)', backgroundColor: 'var(--dd-bg-elevated)' }">
              <span class="text-2xs"
                    :style="{ color: server.containers.running > 0 ? 'var(--dd-success)' : 'var(--dd-text-muted)' }">
                {{ server.containers.running }}/{{ server.containers.total }} running
              </span>
            </div>
          </template>
        </DataCardGrid>

        <!-- List view -->
        <DataListAccordion
          v-if="serversViewMode === 'list' && !loading"
          :items="filteredServers"
          item-key="id"
          :selected-key="selectedServer?.id"
          @item-click="openDetail($event)"
        >
          <template #header="{ item: server }">
          <AppIcon name="servers" :size="14" class="dd-text-secondary" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate dd-text">{{ server.name }}</div>
            <div class="text-2xs font-mono dd-text-muted truncate mt-0.5"
                 :title="server.host"
                 v-tooltip.top="server.host">
              {{ server.host }}
            </div>
          </div>
            <div class="flex items-center gap-3 shrink-0">
              <span class="text-2xs-plus dd-text-muted hidden md:inline">
                <span class="font-semibold dd-text">{{ server.containers.total }}</span> containers
              </span>
              <span class="text-2xs-plus hidden md:inline"
                    :class="server.status === 'connected' ? 'dd-text-muted' : 'dd-text-danger'">
                {{ server.lastSeen }}
              </span>
              <AppBadge :tone="server.status === 'connected' ? 'success' : 'danger'" size="xs" class="hidden md:inline-flex">
                {{ server.status }}
              </AppBadge>
            </div>
          </template>
        </DataListAccordion>

        <!-- Empty state -->
        <EmptyState
          v-if="filteredServers.length === 0 && !loading"
          icon="servers"
          message="No hosts match your filters"
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
              {{ selectedServer.status }}
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
            <DetailField label="Containers">
              <div class="flex items-baseline gap-3 mt-1">
                <span class="text-lg font-bold dd-text">{{ selectedServer.containers.total }}</span>
                <span class="text-2xs-plus font-medium" :style="{ color: 'var(--dd-success)' }">
                  {{ selectedServer.containers.running }} running
                </span>
                <span v-if="selectedServer.containers.stopped > 0"
                      class="text-2xs-plus font-medium" style="color: var(--dd-danger);">
                  {{ selectedServer.containers.stopped }} stopped
                </span>
              </div>
            </DetailField>

            <!-- Images -->
            <DetailField label="Images" mono>{{ selectedServer.images }}</DetailField>

            <!-- Last Seen -->
            <DetailField label="Last Seen">
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
                Refresh
              </AppButton>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
