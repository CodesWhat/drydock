<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { getAgents } from '../services/agent';
import { getAllContainers } from '../services/container';
import { getServer } from '../services/server';

interface ServerEntry {
  id: string;
  name: string;
  host: string;
  status: 'connected' | 'disconnected';
  containers: { total: number; running: number; stopped: number };
  images: number | string;
  lastSeen: string;
}

const serversViewMode = ref<'table' | 'cards' | 'list'>('table');
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

function statusColor(status: string) {
  return status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)';
}
function statusBg(status: string) {
  return status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)';
}

const tableColumns = [
  { key: 'name', label: 'Host', width: '30%', sortable: false },
  { key: 'host', label: 'Address', width: '30%', sortable: false },
  { key: 'status', label: 'Status', align: 'text-center', sortable: false },
  { key: 'containers', label: 'Containers', align: 'text-center', sortable: false },
  { key: 'lastSeen', label: 'Last Seen', align: 'text-right', sortable: false },
];

function countContainersByWatcher(
  containers: any[],
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

function countImagesByWatcher(containers: any[]): Record<string, number> {
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

async function fetchServers() {
  loading.value = true;
  error.value = null;
  try {
    const [_serverData, agentsData, containersData] = await Promise.all([
      getServer(),
      getAgents(),
      getAllContainers(),
    ]);

    const safeContainers = containersData ?? [];
    const containerCounts = countContainersByWatcher(safeContainers);
    const imageCounts = countImagesByWatcher(safeContainers);
    const entries: ServerEntry[] = [];

    const localCounts = containerCounts.local ?? { total: 0, running: 0, stopped: 0 };
    entries.push({
      id: 'local',
      name: 'Local',
      host: 'unix:///var/run/docker.sock',
      status: 'connected',
      containers: localCounts,
      images: imageCounts.local ?? 0,
      lastSeen: 'Just now',
    });

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
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load server data';
  } finally {
    loading.value = false;
  }
}

onMounted(fetchServers);
</script>

<template>
  <DataViewLayout>
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
          v-if="serversViewMode === 'table' && filteredServers.length > 0"
          :columns="tableColumns"
          :rows="filteredServers"
          row-key="id"
          :active-row="selectedServer?.id"
          @row-click="openDetail($event)"
        >
          <template #cell-name="{ row }">
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 rounded-full shrink-0"
                   :style="{ backgroundColor: statusColor(row.status) }" />
              <AppIcon name="servers" :size="12" class="dd-text-secondary" />
              <span class="font-medium dd-text">{{ row.name }}</span>
            </div>
          </template>
          <template #cell-host="{ row }">
            <span class="font-mono text-[10px] dd-text-secondary">{{ row.host }}</span>
          </template>
          <template #cell-status="{ row }">
            <span class="badge text-[9px] font-bold uppercase"
                  :style="{ backgroundColor: statusBg(row.status), color: statusColor(row.status) }">
              {{ row.status }}
            </span>
          </template>
          <template #cell-containers="{ row }">
            <div class="flex items-center justify-center gap-2">
              <span class="font-semibold dd-text">{{ row.containers.total }}</span>
              <span class="text-[10px]" :style="{ color: row.containers.running > 0 ? 'var(--dd-success)' : 'var(--dd-text-muted)' }">
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
          v-if="serversViewMode === 'cards'"
          :items="filteredServers"
          item-key="id"
        >
          <template #card="{ item: server }">
            <div class="px-4 pt-4 pb-2 flex items-start justify-between cursor-pointer" @click="openDetail(server)">
              <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                     :style="{ backgroundColor: statusColor(server.status) }" />
                <div class="min-w-0">
                  <div class="text-[15px] font-semibold truncate dd-text">{{ server.name }}</div>
                  <div class="text-[11px] truncate mt-0.5 dd-text-muted font-mono">{{ server.host }}</div>
                </div>
              </div>
              <span class="badge text-[9px] uppercase font-bold shrink-0 ml-2"
                    :style="{ backgroundColor: statusBg(server.status), color: statusColor(server.status) }">
                {{ server.status }}
              </span>
            </div>
            <div class="px-4 py-3">
              <div class="grid grid-cols-2 gap-2 text-[11px]">
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
                 :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
              <span class="text-[10px]"
                    :style="{ color: server.containers.running > 0 ? 'var(--dd-success)' : 'var(--dd-text-muted)' }">
                {{ server.containers.running }}/{{ server.containers.total }} running
              </span>
            </div>
          </template>
        </DataCardGrid>

        <!-- List view -->
        <DataListAccordion
          v-if="serversViewMode === 'list'"
          :items="filteredServers"
          item-key="id"
        >
          <template #header="{ item: server }">
            <div class="w-2.5 h-2.5 rounded-full shrink-0"
                 :style="{ backgroundColor: statusColor(server.status) }" />
            <AppIcon name="servers" :size="14" class="dd-text-secondary" />
            <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ server.name }}</span>
            <span class="text-[11px] font-mono dd-text-muted hidden sm:inline">{{ server.host }}</span>
            <span class="badge text-[9px] uppercase font-bold shrink-0"
                  :style="{ backgroundColor: statusBg(server.status), color: statusColor(server.status) }">
              {{ server.status }}
            </span>
          </template>
          <template #details="{ item: server }">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Address</div>
                <div class="text-[12px] font-mono dd-text">{{ server.host }}</div>
              </div>
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Status</div>
                <div class="text-[12px] font-semibold" :style="{ color: statusColor(server.status) }">{{ server.status }}</div>
              </div>
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Containers</div>
                <div class="text-[12px] dd-text">
                  {{ server.containers.total }} total
                  <span class="ml-2" :style="{ color: 'var(--dd-success)' }">{{ server.containers.running }} running</span>
                  <span v-if="server.containers.stopped > 0" class="ml-2" style="color: var(--dd-danger);">{{ server.containers.stopped }} stopped</span>
                </div>
              </div>
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Last Seen</div>
                <div class="text-[12px]" :class="server.status === 'connected' ? 'dd-text' : 'dd-text-danger'">{{ server.lastSeen }}</div>
              </div>
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
            <div class="w-2.5 h-2.5 rounded-full shrink-0"
                 :style="{ backgroundColor: selectedServer ? statusColor(selectedServer.status) : undefined }" />
            <span class="text-sm font-bold truncate dd-text">{{ selectedServer?.name }}</span>
            <span class="badge text-[9px] uppercase font-bold shrink-0"
                  :style="{
                    backgroundColor: selectedServer ? statusBg(selectedServer.status) : undefined,
                    color: selectedServer ? statusColor(selectedServer.status) : undefined,
                  }">
              {{ selectedServer?.status }}
            </span>
          </div>
        </template>

        <template #subtitle>
          <span class="text-[11px] font-mono dd-text-secondary">{{ selectedServer?.host }}</span>
        </template>

        <template v-if="selectedServer" #default>
          <div class="p-4 space-y-5">
            <!-- Containers -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Containers</div>
              <div class="flex items-baseline gap-3 mt-1">
                <span class="text-lg font-bold dd-text">{{ selectedServer.containers.total }}</span>
                <span class="text-[11px] font-medium" :style="{ color: 'var(--dd-success)' }">
                  {{ selectedServer.containers.running }} running
                </span>
                <span v-if="selectedServer.containers.stopped > 0"
                      class="text-[11px] font-medium" style="color: var(--dd-danger);">
                  {{ selectedServer.containers.stopped }} stopped
                </span>
              </div>
            </div>

            <!-- Images -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Images</div>
              <div class="text-[12px] font-mono dd-text">{{ selectedServer.images }}</div>
            </div>

            <!-- Last Seen -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Last Seen</div>
              <div class="text-[12px] font-medium"
                   :class="selectedServer.status === 'connected' ? 'dd-text' : 'dd-text-danger'">
                {{ selectedServer.lastSeen }}
              </div>
            </div>

            <!-- Actions -->
            <div class="pt-2 flex gap-2"
                 :style="{ borderTop: '1px solid var(--dd-border)' }">
              <button class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated"
                      :style="{ border: '1px solid var(--dd-border-strong)' }"
                      @click="fetchServers()">
                <AppIcon name="restart" :size="11" />
                Refresh
              </button>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
