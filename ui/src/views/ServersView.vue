<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getAgents } from '../services/agent';
import { getAllContainers } from '../services/container';
import { getServer } from '../services/server';

interface ServerEntry {
  name: string;
  host: string;
  status: 'connected' | 'disconnected';
  dockerVersion: string;
  os: string;
  arch: string;
  cpus: number | string;
  memoryGb: number | string;
  containers: { total: number; running: number; stopped: number };
  images: number | string;
  lastSeen: string;
}

const loading = ref(true);
const error = ref<string | null>(null);
const servers = ref<ServerEntry[]>([]);

const serversStats = computed(() => {
  const all = servers.value;
  return {
    total: all.length,
    totalContainers: all.reduce((sum, s) => sum + s.containers.total, 0),
    connected: all.filter((s) => s.status === 'connected').length,
    disconnected: all.filter((s) => s.status === 'disconnected').length,
  };
});

/**
 * Count containers per watcher/host from the containers list.
 */
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

async function fetchServers() {
  loading.value = true;
  error.value = null;
  try {
    const [serverData, agentsData, containersData] = await Promise.all([
      getServer(),
      getAgents(),
      getAllContainers(),
    ]);

    const containerCounts = countContainersByWatcher(containersData ?? []);
    const entries: ServerEntry[] = [];

    // Local server from getServer() — API only returns configuration,
    // no Docker version/OS/arch/CPU/memory, so show "-" for those fields
    const localCounts = containerCounts.local ?? { total: 0, running: 0, stopped: 0 };
    entries.push({
      name: 'Local',
      host: 'unix:///var/run/docker.sock',
      status: 'connected',
      dockerVersion: '-',
      os: '-',
      arch: '-',
      cpus: '-',
      memoryGb: '-',
      containers: localCounts,
      images: '-',
      lastSeen: 'Just now',
    });

    // Remote agents from getAgents() — API only returns name/host/port/connected,
    // no Docker info for disconnected agents
    for (const agent of agentsData) {
      const agentConnected = !!agent.connected;
      const watcherName = agent.name?.toLowerCase();
      const agentCounts =
        watcherName && containerCounts[watcherName]
          ? containerCounts[watcherName]
          : { total: 0, running: 0, stopped: 0 };

      entries.push({
        name: agent.name,
        host: `${agent.host}${agent.port ? `:${agent.port}` : ''}`,
        status: agentConnected ? 'connected' : 'disconnected',
        dockerVersion: '-',
        os: '-',
        arch: '-',
        cpus: '-',
        memoryGb: '-',
        containers: agentCounts,
        images: '-',
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

function refreshServer(_name: string) {
  fetchServers();
}

function viewServerContainers(_name: string) {
  // placeholder for view containers action
}
</script>

<template>
  <AppLayout>
    <div>
      <!-- Stat cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <!-- Total Hosts -->
        <div class="dd-rounded p-4"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
               borderLeftWidth: '4px',
               borderLeftColor: 'var(--dd-primary)',
             }">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-medium uppercase tracking-wider dd-text-muted">
              Total Hosts
            </span>
            <div class="w-8 h-8 dd-rounded flex items-center justify-center"
                 style="background-color: var(--dd-primary-muted); color: var(--dd-primary);">
              <AppIcon name="servers" :size="14" />
            </div>
          </div>
          <div class="text-2xl font-bold dd-text">
            {{ serversStats.total }}
          </div>
          <div class="text-[11px] mt-1 dd-text-muted">
            Docker hosts monitored
          </div>
        </div>

        <!-- Total Containers -->
        <div class="dd-rounded p-4"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
               borderLeftWidth: '4px',
               borderLeftColor: 'var(--dd-success)',
             }">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-medium uppercase tracking-wider dd-text-muted">
              Total Containers
            </span>
            <div class="w-8 h-8 dd-rounded flex items-center justify-center"
                 style="background-color: var(--dd-success-muted); color: var(--dd-success);">
              <AppIcon name="containers" :size="14" />
            </div>
          </div>
          <div class="text-2xl font-bold dd-text">
            {{ serversStats.totalContainers }}
          </div>
          <div class="text-[11px] mt-1 dd-text-muted">
            Across all servers
          </div>
        </div>

        <!-- Connected / Disconnected -->
        <div class="dd-rounded p-4"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
               borderLeftWidth: '4px',
               borderLeftColor: serversStats.disconnected > 0 ? 'var(--dd-danger)' : 'var(--dd-success)',
             }">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-medium uppercase tracking-wider dd-text-muted">
              Connection Status
            </span>
            <div class="w-8 h-8 dd-rounded flex items-center justify-center"
                 :style="{
                   backgroundColor: serversStats.disconnected > 0 ? 'var(--dd-danger-muted)' : 'var(--dd-success-muted)',
                   color: serversStats.disconnected > 0 ? 'var(--dd-danger)' : 'var(--dd-success)',
                 }">
              <AppIcon name="agents" :size="14" />
            </div>
          </div>
          <div class="flex items-baseline gap-3">
            <div>
              <span class="text-2xl font-bold" style="color: var(--dd-success);">{{ serversStats.connected }}</span>
              <span class="text-[11px] ml-1 dd-text-muted">connected</span>
            </div>
            <div>
              <span class="text-2xl font-bold" :style="{ color: serversStats.disconnected > 0 ? 'var(--dd-danger)' : 'var(--dd-neutral)' }">{{ serversStats.disconnected }}</span>
              <span class="text-[11px] ml-1 dd-text-muted">disconnected</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Server cards -->
      <div class="space-y-4">
        <div v-for="server in servers" :key="server.name"
             class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">

          <!-- Card header -->
          <div class="px-5 py-3.5 flex items-center gap-3"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="w-2.5 h-2.5 rounded-full shrink-0"
                 :style="{ backgroundColor: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <AppIcon name="servers" :size="14" class="shrink-0"
                       :style="{ color: server.status === 'connected' ? 'var(--dd-primary)' : 'var(--dd-neutral)' }" />
              <h2 class="text-sm font-semibold truncate dd-text">
                {{ server.name }}
              </h2>
              <span class="text-[11px] font-mono truncate dd-text-muted">
                {{ server.host }}
              </span>
            </div>
            <span class="badge text-[9px] uppercase tracking-wide font-bold shrink-0"
                  :style="{
                    backgroundColor: server.status === 'connected'
                      ? 'var(--dd-success-muted)'
                      : 'var(--dd-danger-muted)',
                    color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ server.status }}
            </span>
          </div>

          <!-- Card body grid -->
          <div class="p-5">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">

              <!-- Left column — Docker info (hidden when unavailable) -->
              <div v-if="server.dockerVersion !== '-'" class="space-y-4">
                <div>
                  <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">
                    Docker Version
                  </div>
                  <div class="text-[13px] font-medium font-mono dd-text">
                    {{ server.dockerVersion }}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">
                    Operating System
                  </div>
                  <div class="text-[13px] font-medium dd-text">
                    {{ server.os }}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">
                    Architecture
                  </div>
                  <div class="text-[13px] font-medium font-mono dd-text">
                    {{ server.arch }}
                  </div>
                </div>
                <div class="flex gap-6">
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">
                      CPUs
                    </div>
                    <div class="text-[13px] font-medium font-mono dd-text">
                      {{ server.cpus }}
                    </div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">
                      Memory
                    </div>
                    <div class="text-[13px] font-medium font-mono dd-text">
                      {{ server.memoryGb }} GB
                    </div>
                  </div>
                </div>
              </div>

              <!-- Right column -->
              <div class="space-y-4">
                <div>
                  <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">
                    Containers
                  </div>
                  <div class="flex items-baseline gap-3">
                    <span class="text-[13px] font-bold dd-text">
                      {{ server.containers.total }}
                    </span>
                    <span class="text-[11px] font-medium" style="color: var(--dd-success);">
                      {{ server.containers.running }} running
                    </span>
                    <span v-if="server.containers.stopped > 0"
                          class="text-[11px] font-medium" style="color: var(--dd-danger);">
                      {{ server.containers.stopped }} stopped
                    </span>
                  </div>
                </div>
                <div>
                  <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">
                    Images
                  </div>
                  <div class="text-[13px] font-medium font-mono dd-text">
                    {{ server.images }}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">
                    Last Seen
                  </div>
                  <div class="text-[13px] font-medium"
                       :class="server.status === 'connected'
                         ? 'dd-text'
                         : ''
                       "
                       :style="server.status === 'disconnected' ? { color: 'var(--dd-danger)' } : {}">
                    {{ server.lastSeen }}
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- Card footer -->
          <div class="px-5 py-3 flex items-center justify-end gap-2"
               :style="{
                 borderTop: '1px solid var(--dd-border-strong)',
                 backgroundColor: 'var(--dd-bg-elevated)',
               }">
            <button class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated"
                    @click="refreshServer(server.name)">
              <AppIcon name="restart" :size="10" />
              Refresh
            </button>
            <button class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors text-drydock-secondary hover:bg-drydock-secondary/15"
                    @click="viewServerContainers(server.name)">
              <AppIcon name="containers" :size="10" />
              View Containers
            </button>
          </div>

        </div>
      </div>
    </div>
  </AppLayout>
</template>
