<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { getAgents } from '../services/agent';
import { getLogEntries } from '../services/log';

interface Agent {
  id: string;
  name: string;
  host: string;
  status: 'connected' | 'disconnected';
  dockerVersion: string;
  os: string;
  arch: string;
  cpus: number;
  memoryGb: number;
  containers: { total: number; running: number; stopped: number };
  images: number;
  lastSeen: string;
  version: string;
  uptime: string;
  logLevel: string;
  pollInterval: string;
}

interface AgentLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  message: string;
}

const { isMobile, windowNarrow: isCompact } = useBreakpoints();

const loading = ref(true);
const error = ref<string | null>(null);
const agentsData = ref<Agent[]>([]);
const agentLogsCache = ref<Record<string, AgentLog[]>>({});

function formatAgentLogTimestamp(iso: string) {
  const d = new Date(iso);
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatTimestamp(ts: number | string): string {
  if (typeof ts === 'number') {
    return new Date(ts).toISOString();
  }
  return ts;
}

function getAgentLogs(agentId: string): AgentLog[] {
  return agentLogsCache.value[agentId] ?? [];
}

async function fetchAgents() {
  loading.value = true;
  error.value = null;
  try {
    const rawAgents = await getAgents();
    agentsData.value = rawAgents.map((a: any) => ({
      id: a.name,
      name: a.name,
      host: `${a.host}${a.port ? `:${a.port}` : ''}`,
      status: a.connected ? 'connected' : 'disconnected',
      dockerVersion: a.dockerVersion ?? '-',
      os: a.os ?? '-',
      arch: a.arch ?? '-',
      cpus: a.cpus ?? 0,
      memoryGb: a.memoryGb ?? 0,
      containers: a.containers ?? { total: 0, running: 0, stopped: 0 },
      images: a.images ?? 0,
      lastSeen: a.lastSeen ?? (a.connected ? '-' : 'Never'),
      version: a.version ?? '-',
      uptime: a.uptime ?? '-',
      logLevel: a.logLevel ?? '-',
      pollInterval: a.pollInterval ?? '-',
    }));

    // Fetch logs for connected agents
    for (const agent of agentsData.value) {
      if (agent.status === 'connected') {
        fetchAgentLogs(agent.name);
      }
    }
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load agents';
  } finally {
    loading.value = false;
  }
}

async function fetchAgentLogs(agentName: string) {
  try {
    const entries = await getLogEntries({ agent: agentName, tail: 50 });
    agentLogsCache.value[agentName] = (entries ?? []).map((e: any) => ({
      timestamp: formatTimestamp(e.timestamp),
      level: e.level ?? 'info',
      component: e.component ?? '',
      message: e.msg ?? e.message ?? '',
    }));
  } catch {
    agentLogsCache.value[agentName] = [];
  }
}

onMounted(fetchAgents);

// ── View mode ──
const agentViewMode = ref<'table' | 'cards' | 'list'>('table');

// ── Sorting ──
const agentSortKey = ref('name');
const agentSortAsc = ref(true);

function toggleAgentSort(key: string) {
  if (agentSortKey.value === key) {
    agentSortAsc.value = !agentSortAsc.value;
  } else {
    agentSortKey.value = key;
    agentSortAsc.value = true;
  }
}

const sortedAgents = computed(() => {
  const list = [...agentsData.value];
  const key = agentSortKey.value;
  const asc = agentSortAsc.value;
  list.sort((a, b) => {
    const av = String((a as Record<string, unknown>)[key] ?? '');
    const bv = String((b as Record<string, unknown>)[key] ?? '');
    const cmp = av.localeCompare(bv);
    return asc ? cmp : -cmp;
  });
  return list;
});

// ── Column visibility ──
const agentAllColumns = [
  {
    key: 'name',
    label: 'Agent',
    align: 'text-left',
    px: 'px-5',
    style: 'width: 99%;',
    required: true,
  },
  { key: 'status', label: 'Status', align: 'text-center', px: 'px-3', style: '', required: false },
  {
    key: 'containers',
    label: 'Containers',
    align: 'text-center',
    px: 'px-3',
    style: '',
    required: false,
  },
  { key: 'docker', label: 'Docker', align: 'text-center', px: 'px-3', style: '', required: false },
  { key: 'os', label: 'OS', align: 'text-center', px: 'px-3', style: '', required: false },
  {
    key: 'version',
    label: 'Version',
    align: 'text-center',
    px: 'px-3',
    style: '',
    required: false,
  },
  {
    key: 'lastSeen',
    label: 'Last Seen',
    align: 'text-right',
    px: 'px-3',
    style: '',
    required: false,
  },
];

const agentVisibleColumns = ref<Set<string>>(new Set(agentAllColumns.map((c) => c.key)));
const showAgentColumnPicker = ref(false);

function toggleAgentColumn(key: string) {
  const col = agentAllColumns.find((c) => c.key === key);
  if (col?.required) return;
  if (agentVisibleColumns.value.has(key)) agentVisibleColumns.value.delete(key);
  else agentVisibleColumns.value.add(key);
}

const agentActiveColumns = computed(() =>
  agentAllColumns.filter(
    (c) => agentVisibleColumns.value.has(c.key) && (!isCompact.value || c.required),
  ),
);

// ── Detail panel ──
const selectedAgent = ref<Agent | null>(null);
const agentPanelOpen = ref(false);
const agentDetailTab = ref('overview');

const agentDetailTabs = [
  { id: 'overview', label: 'Overview', icon: 'info' },
  { id: 'logs', label: 'Logs', icon: 'logs' },
  { id: 'config', label: 'Config', icon: 'config' },
];

function selectAgent(agent: Agent) {
  selectedAgent.value = agent;
  agentDetailTab.value = 'overview';
  agentPanelOpen.value = true;
}

function closeAgentPanel() {
  agentPanelOpen.value = false;
  selectedAgent.value = null;
}

// ── Expandable list items ──
const expandedItems = ref<Set<string>>(new Set());

function toggleExpandItem(key: string) {
  if (expandedItems.value.has(key)) expandedItems.value.delete(key);
  else expandedItems.value.add(key);
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-col" style="height: calc(100vh - 80px);">
      <!-- Content + detail panel flex wrapper -->
      <div class="flex gap-4 min-w-0 flex-1 min-h-0 pb-4">

        <!-- Left: filter bar + table -->
        <div class="flex-1 min-w-0 overflow-y-auto pr-4 pb-4">

          <!-- Filter bar -->
          <div class="shrink-0 mb-4">
            <div class="px-3 py-2 dd-rounded relative z-[1]"
                 :style="{
                   backgroundColor: 'var(--dd-bg-card)',
                   border: '1px solid var(--dd-border-strong)',
                 }">
              <div class="flex items-center gap-2.5">
                <!-- Result count + view toggle -->
                <div class="flex items-center gap-2 ml-auto">
                  <span class="text-[10px] font-semibold tabular-nums shrink-0 px-2 py-1 dd-rounded dd-text-muted dd-bg-card">
                    {{ agentsData.length }} agents
                  </span>
                  <div class="flex items-center dd-rounded overflow-hidden border"
                       :style="{ borderColor: 'var(--dd-border-strong)' }">
                    <button v-for="vm in ([
                      { id: 'table' as const, icon: 'table' },
                      { id: 'cards' as const, icon: 'grid' },
                      { id: 'list' as const, icon: 'list' },
                    ])" :key="vm.id"
                            class="w-7 h-7 flex items-center justify-center text-[11px] transition-colors"
                            :class="agentViewMode === vm.id ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                            :style="vm.id !== 'table' ? { borderLeft: '1px solid var(--dd-border-strong)' } : {}"
                            :title="vm.id.charAt(0).toUpperCase() + vm.id.slice(1) + ' view'"
                            @click="agentViewMode = vm.id">
                      <AppIcon :name="vm.icon" :size="11" />
                    </button>
                  </div>
                  <!-- Column picker -->
                  <div v-if="agentViewMode === 'table'" class="relative">
                    <button class="w-7 h-7 dd-rounded flex items-center justify-center text-[11px] transition-colors border"
                            :class="showAgentColumnPicker ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                            :style="{ borderColor: 'var(--dd-border-strong)' }"
                            title="Toggle columns"
                            @click.stop="showAgentColumnPicker = !showAgentColumnPicker">
                      <AppIcon name="config" :size="10" />
                    </button>
                    <div v-if="showAgentColumnPicker" @click.stop
                         class="absolute right-0 top-9 z-50 min-w-[160px] py-1.5 dd-rounded shadow-lg"
                         :style="{
                           backgroundColor: 'var(--dd-bg-card)',
                           border: '1px solid var(--dd-border-strong)',
                           boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                         }">
                      <div class="px-3 py-1 text-[9px] font-bold uppercase tracking-wider dd-text-muted">Columns</div>
                      <button v-for="col in agentAllColumns" :key="col.key"
                              class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 hover:dd-bg-elevated"
                              :class="col.required ? 'dd-text-muted cursor-not-allowed' : 'dd-text'"
                              @click="toggleAgentColumn(col.key)">
                        <AppIcon :name="agentVisibleColumns.has(col.key) ? 'check' : 'square'" :size="10"
                                 :style="agentVisibleColumns.has(col.key) ? { color: 'var(--dd-primary)' } : {}" />
                        {{ col.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Table view -->
          <div v-if="agentViewMode === 'table'"
               class="dd-rounded overflow-hidden"
               :style="{ border: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-card)' }">
            <div>
              <table class="w-full text-xs">
                <thead>
                  <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <th v-for="col in agentActiveColumns" :key="col.key"
                        :class="[col.align, col.px, 'whitespace-nowrap py-2.5 font-semibold uppercase tracking-wider text-[10px] select-none cursor-pointer transition-colors', agentSortKey === col.key ? 'dd-text-secondary' : 'dd-text-muted hover:dd-text-secondary']"
                        :style="col.style"
                        @click="toggleAgentSort(col.key)">
                      {{ col.label }}
                      <span v-if="agentSortKey === col.key" class="inline-block ml-0.5 text-[8px]">{{ agentSortAsc ? '&#9650;' : '&#9660;' }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(agent, i) in sortedAgents" :key="agent.id"
                      class="cursor-pointer transition-colors hover:dd-bg-elevated"
                      :class="selectedAgent?.id === agent.id ? 'ring-1 ring-inset ring-drydock-secondary' : ''"
                      :style="{
                        backgroundColor: selectedAgent?.id === agent.id ? 'var(--dd-bg-elevated)' : (i % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-bg-inset)'),
                        borderBottom: i < sortedAgents.length - 1 ? '1px solid var(--dd-border-strong)' : 'none',
                      }"
                      @click="selectAgent(agent)">
                    <!-- Agent name (+ compact fold) -->
                    <td class="px-5 py-3">
                      <div class="flex items-start gap-2 min-w-0">
                        <div class="w-2 h-2 rounded-full shrink-0 mt-1.5"
                             :style="{ backgroundColor: agent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
                        <div class="min-w-0 flex-1">
                          <div class="font-medium truncate dd-text">{{ agent.name }}</div>
                          <div class="text-[10px] mt-0.5 truncate dd-text-muted">{{ agent.host }}</div>
                          <!-- Compact mode: folded badge row -->
                          <div v-if="isCompact" class="flex items-center gap-1.5 mt-1.5">
                            <span class="badge px-1.5 py-0 text-[9px]"
                                  :style="{
                                    backgroundColor: agent.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                                    color: agent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                                  }">
                              {{ agent.status }}
                            </span>
                            <span class="text-[9px] dd-text-secondary">
                              {{ agent.containers.running }}/{{ agent.containers.total }}
                            </span>
                            <span class="text-[9px] dd-text-muted ml-auto">{{ agent.lastSeen }}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <!-- Status -->
                    <td v-if="agentVisibleColumns.has('status') && !isCompact" class="px-3 py-3 text-center whitespace-nowrap">
                      <span class="badge text-[9px] font-bold"
                            :style="{
                              backgroundColor: agent.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                              color: agent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                            }">
                        {{ agent.status }}
                      </span>
                    </td>
                    <!-- Containers -->
                    <td v-if="agentVisibleColumns.has('containers') && !isCompact" class="px-3 py-3 text-center whitespace-nowrap">
                      <span class="font-bold" style="color: var(--dd-success);">{{ agent.containers.running }}</span>
                      <span class="dd-text-muted">/{{ agent.containers.total }}</span>
                    </td>
                    <!-- Docker -->
                    <td v-if="agentVisibleColumns.has('docker') && !isCompact" class="px-3 py-3 text-center whitespace-nowrap font-mono" :class="agent.dockerVersion === '-' ? 'dd-text-muted' : 'dd-text-secondary'">
                      {{ agent.dockerVersion }}
                    </td>
                    <!-- OS -->
                    <td v-if="agentVisibleColumns.has('os') && !isCompact" class="px-3 py-3 text-center whitespace-nowrap" :class="agent.os === '-' ? 'dd-text-muted' : 'dd-text-secondary'">
                      {{ agent.os }}
                    </td>
                    <!-- Version -->
                    <td v-if="agentVisibleColumns.has('version') && !isCompact" class="px-3 py-3 text-center whitespace-nowrap">
                      <span v-if="agent.version === '-'" class="dd-text-muted">-</span>
                      <span v-else class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium dd-bg-elevated dd-text-secondary">
                        v{{ agent.version }}
                      </span>
                    </td>
                    <!-- Last Seen -->
                    <td v-if="agentVisibleColumns.has('lastSeen') && !isCompact" class="px-3 py-3 text-right whitespace-nowrap dd-text-muted">
                      {{ agent.lastSeen }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Card view -->
          <div v-if="agentViewMode === 'cards'"
               class="grid gap-4"
               style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
            <div v-for="agent in sortedAgents" :key="agent.id"
                 class="container-card dd-rounded cursor-pointer overflow-hidden flex flex-col"
                 :class="[
                   selectedAgent?.id === agent.id && agentPanelOpen
                     ? 'ring-2 ring-drydock-secondary ring-offset-0'
                     : '',
                 ]"
                 :style="{
                   backgroundColor: 'var(--dd-bg-card)',
                   border: selectedAgent?.id === agent.id && agentPanelOpen
                     ? '1.5px solid var(--color-drydock-secondary)'
                     : '1px solid var(--dd-border-strong)',
                   borderRadius: 'var(--dd-radius)',
                   overflow: 'hidden',
                 }"
                 @click="selectAgent(agent)">
              <!-- Card header -->
              <div class="px-4 pt-4 pb-2 flex items-start justify-between">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                       :style="{ backgroundColor: agent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
                  <div class="min-w-0">
                    <div class="text-[15px] font-semibold truncate dd-text">
                      {{ agent.name }}
                    </div>
                    <div class="text-[11px] truncate mt-0.5 dd-text-muted">
                      {{ agent.host }}
                    </div>
                  </div>
                </div>
                <span class="badge text-[9px] uppercase tracking-wide font-bold shrink-0 ml-2"
                      :style="{
                        backgroundColor: agent.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                        color: agent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                      }">
                  {{ agent.status }}
                </span>
              </div>
              <!-- Card body -->
              <div class="px-4 py-3">
                <div class="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span class="dd-text-muted">Docker</span>
                    <span class="ml-1 font-semibold" :class="agent.dockerVersion === '-' ? 'dd-text-muted' : 'dd-text'">{{ agent.dockerVersion }}</span>
                  </div>
                  <div>
                    <span class="dd-text-muted">OS</span>
                    <span class="ml-1 font-semibold" :class="agent.os === '-' ? 'dd-text-muted' : 'dd-text'">{{ agent.os }}</span>
                  </div>
                  <div>
                    <span class="dd-text-muted">Arch</span>
                    <span class="ml-1 font-semibold" :class="agent.arch === '-' ? 'dd-text-muted' : 'dd-text'">{{ agent.arch }}</span>
                  </div>
                  <div>
                    <span class="dd-text-muted">Version</span>
                    <span class="ml-1 font-semibold" :class="agent.version === '-' ? 'dd-text-muted' : 'dd-text'">{{ agent.version === '-' ? '-' : 'v' + agent.version }}</span>
                  </div>
                </div>
              </div>
              <!-- Card footer -->
              <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
                   :style="{
                     borderTop: '1px solid var(--dd-border-strong)',
                     backgroundColor: 'var(--dd-bg-elevated)',
                   }">
                <div class="flex items-center gap-3 text-[11px]">
                  <span>
                    <span class="font-bold" style="color: var(--dd-success);">{{ agent.containers.running }}</span>
                    <span class="dd-text-muted"> running</span>
                  </span>
                  <span v-if="agent.containers.stopped > 0">
                    <span class="font-bold" style="color: var(--dd-danger);">{{ agent.containers.stopped }}</span>
                    <span class="dd-text-muted"> stopped</span>
                  </span>
                </div>
                <span class="text-[10px] dd-text-muted">{{ agent.lastSeen }}</span>
              </div>
            </div>
          </div>

          <!-- List view -->
          <div v-if="agentViewMode === 'list'"
               class="space-y-2">
            <div v-for="agent in sortedAgents" :key="agent.id"
                 class="dd-rounded overflow-hidden transition-all"
                 :style="{
                   backgroundColor: 'var(--dd-bg-card)',
                   border: selectedAgent?.id === agent.id
                     ? '1.5px solid var(--color-drydock-secondary)'
                     : '1px solid var(--dd-border-strong)',
                 }">
              <!-- List item header -->
              <div class="flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors hover:dd-bg-elevated"
                   @click="toggleExpandItem('agent-' + agent.id)">
                <div class="w-2.5 h-2.5 rounded-full shrink-0"
                     :style="{ backgroundColor: agent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-semibold truncate dd-text">{{ agent.name }}</div>
                  <div class="text-[10px] mt-0.5 truncate dd-text-muted">{{ agent.host }}</div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <span class="badge text-[9px] font-bold"
                        :style="{
                          backgroundColor: agent.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                          color: agent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                        }">
                    {{ agent.status }}
                  </span>
                  <span class="text-[10px] dd-text-secondary">
                    {{ agent.containers.running }}/{{ agent.containers.total }}
                  </span>
                  <span class="text-[10px] dd-text-muted">{{ agent.lastSeen }}</span>
                </div>
                <AppIcon :name="expandedItems.has('agent-' + agent.id) ? 'chevron-up' : 'chevron-down'" :size="10" class="shrink-0 dd-text-muted" />
              </div>
              <!-- Expanded details -->
              <div v-if="expandedItems.has('agent-' + agent.id)"
                   class="px-5 pb-4 pt-1"
                   :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 mt-2">
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Docker</div>
                    <div class="text-[12px] font-mono" :class="agent.dockerVersion === '-' ? 'dd-text-muted' : 'dd-text'">{{ agent.dockerVersion }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">OS</div>
                    <div class="text-[12px]" :class="agent.os === '-' ? 'dd-text-muted' : 'dd-text'">{{ agent.os }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Architecture</div>
                    <div class="text-[12px]" :class="agent.arch === '-' ? 'dd-text-muted' : 'dd-text'">{{ agent.arch }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Version</div>
                    <div class="text-[12px] font-mono" :class="agent.version === '-' ? 'dd-text-muted' : 'dd-text'">{{ agent.version === '-' ? '-' : 'v' + agent.version }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Uptime</div>
                    <div class="text-[12px]" :class="agent.uptime === '-' ? 'dd-text-muted' : 'dd-text'">{{ agent.uptime }}</div>
                  </div>
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Containers</div>
                    <div class="text-[12px] dd-text">
                      <span class="font-bold" style="color: var(--dd-success);">{{ agent.containers.running }}</span>
                      <span class="dd-text-muted"> running / </span>
                      <span>{{ agent.containers.total }}</span>
                      <span class="dd-text-muted"> total</span>
                    </div>
                  </div>
                </div>
                <!-- Action buttons -->
                <div class="mt-4 pt-3 flex items-center gap-2" :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
                  <button class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-medium transition-colors dd-text-secondary hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          @click.stop="selectAgent(agent)">
                    <AppIcon name="info" :size="10" />
                    Details
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div><!-- end left: filter bar + table/cards -->

        <!-- Detail side panel overlay -->
        <div v-if="agentPanelOpen && isMobile"
             class="fixed inset-0 bg-black/50 z-40"
             @click="closeAgentPanel" />

        <!-- Detail side panel -->
        <aside v-if="agentPanelOpen && selectedAgent"
               class="flex flex-col dd-rounded overflow-clip transition-all duration-300 ease-in-out"
               :class="isMobile ? 'fixed top-0 right-0 h-full z-50' : 'sticky top-0'"
               :style="{
                 flex: isMobile ? undefined : '0 0 45%',
                 width: isMobile ? '100%' : undefined,
                 backgroundColor: 'var(--dd-bg-card)',
                 border: '1px solid var(--dd-border-strong)',
                 height: isMobile ? '100vh' : 'calc(100vh - 96px)',
                 minHeight: '480px',
               }">
          <!-- Panel toolbar -->
          <div class="shrink-0 px-4 py-2.5 flex items-center justify-between"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-2.5 h-2.5 rounded-full shrink-0"
                   :style="{ backgroundColor: selectedAgent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
              <span class="text-sm font-bold truncate dd-text">{{ selectedAgent.name }}</span>
              <span class="badge text-[9px] uppercase font-bold shrink-0"
                    :style="{
                      backgroundColor: selectedAgent.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: selectedAgent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                {{ selectedAgent.status }}
              </span>
            </div>
            <button class="flex items-center justify-center w-7 h-7 dd-rounded text-xs font-medium transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                    @click="closeAgentPanel">
              <AppIcon name="xmark" :size="14" />
            </button>
          </div>

          <!-- Subtitle -->
          <div class="shrink-0 px-4 py-2 text-[11px] font-mono dd-text-secondary"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            {{ selectedAgent.host }}
          </div>

          <!-- Tabs -->
          <div class="shrink-0 flex px-4 gap-1"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <button v-for="tab in agentDetailTabs" :key="tab.id"
                    class="px-3 py-2.5 text-[11px] font-medium transition-colors relative"
                    :class="agentDetailTab === tab.id
                      ? 'text-drydock-secondary'
                      : 'dd-text-muted hover:dd-text'"
                    @click="agentDetailTab = tab.id">
              <AppIcon :name="tab.icon" :size="10" class="mr-1" />
              {{ tab.label }}
              <div v-if="agentDetailTab === tab.id"
                   class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full" />
            </button>
          </div>

          <!-- Tab content -->
          <div class="flex-1 overflow-y-auto">

            <!-- Overview tab -->
            <div v-if="agentDetailTab === 'overview'" class="p-4 space-y-5">
              <!-- Resources -->
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Resources</div>
                <div class="grid grid-cols-2 gap-2">
                  <div v-for="field in [
                    { label: 'CPUs', value: selectedAgent.cpus, muted: selectedAgent.cpus === 0 },
                    { label: 'Memory', value: selectedAgent.memoryGb === 0 ? '-' : selectedAgent.memoryGb + ' GB', muted: selectedAgent.memoryGb === 0 },
                    { label: 'Images', value: selectedAgent.images, muted: selectedAgent.images === 0 },
                    { label: 'Uptime', value: selectedAgent.uptime, muted: selectedAgent.uptime === '-' },
                  ]" :key="field.label"
                       class="px-2.5 py-1.5 dd-rounded text-[11px]"
                       :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <div class="text-[10px] dd-text-muted">{{ field.label }}</div>
                    <div class="font-semibold" :class="field.muted ? 'dd-text-muted' : 'dd-text'">{{ field.value }}</div>
                  </div>
                </div>
              </div>

              <!-- System -->
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">System</div>
                <div class="space-y-1">
                  <div v-for="field in [
                    { label: 'Docker', value: selectedAgent.dockerVersion, muted: selectedAgent.dockerVersion === '-' },
                    { label: 'OS', value: selectedAgent.os, muted: selectedAgent.os === '-' },
                    { label: 'Architecture', value: selectedAgent.arch, muted: selectedAgent.arch === '-' },
                    { label: 'Agent', value: selectedAgent.version === '-' ? '-' : 'v' + selectedAgent.version, muted: selectedAgent.version === '-' },
                  ]" :key="field.label"
                       class="flex items-center justify-between px-2.5 py-1.5 dd-rounded text-[11px]"
                       :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <span class="dd-text-muted">{{ field.label }}</span>
                    <span class="font-mono font-semibold" :class="field.muted ? 'dd-text-muted' : 'dd-text'">{{ field.value }}</span>
                  </div>
                </div>
              </div>

              <!-- Containers -->
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Containers</div>
                <div class="grid grid-cols-3 gap-2 text-center">
                  <div class="px-2 py-2 dd-rounded"
                       :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <div class="text-lg font-bold dd-text">{{ selectedAgent.containers.total }}</div>
                    <div class="text-[10px] dd-text-muted">Total</div>
                  </div>
                  <div class="px-2 py-2 dd-rounded"
                       :style="{ backgroundColor: 'var(--dd-success-muted)' }">
                    <div class="text-lg font-bold" :style="{ color: 'var(--dd-success)' }">{{ selectedAgent.containers.running }}</div>
                    <div class="text-[10px]" :style="{ color: 'var(--dd-success)' }">Running</div>
                  </div>
                  <div class="px-2 py-2 dd-rounded"
                       :style="{ backgroundColor: selectedAgent.containers.stopped > 0 ? 'var(--dd-danger-muted)' : 'var(--dd-bg-inset)' }">
                    <div class="text-lg font-bold" :style="{ color: selectedAgent.containers.stopped > 0 ? 'var(--dd-danger)' : 'var(--dd-text-muted)' }">{{ selectedAgent.containers.stopped }}</div>
                    <div class="text-[10px]" :style="{ color: selectedAgent.containers.stopped > 0 ? 'var(--dd-danger)' : 'var(--dd-text-muted)' }">Stopped</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Logs tab -->
            <div v-if="agentDetailTab === 'logs'" class="flex flex-col" style="height: calc(100% - 0px);">
              <div class="flex-1 min-h-0 flex flex-col overflow-hidden"
                   :style="{ backgroundColor: 'var(--dd-bg-code)' }">
                <div class="flex-1 overflow-y-auto px-1"
                     style="box-shadow: inset 0 8px 16px -8px rgba(0,0,0,0.4);">
                  <div v-for="(line, i) in getAgentLogs(selectedAgent.id)" :key="i"
                       class="px-3 py-[3px] font-mono text-[11px] leading-relaxed flex gap-3 transition-colors"
                       :style="{ borderBottom: '1px solid rgba(255,255,255,0.03)' }">
                    <span class="shrink-0 tabular-nums" style="color: #64748b;">{{ formatAgentLogTimestamp(line.timestamp) }}</span>
                    <span class="shrink-0 w-11 text-right font-semibold uppercase text-[10px]"
                          :style="{
                            color: line.level === 'error' ? 'var(--dd-danger)'
                                 : line.level === 'warn' ? 'var(--dd-warning)'
                                 : line.level === 'debug' ? '#64748b'
                                 : 'var(--dd-success)'
                          }">
                      {{ line.level }}
                    </span>
                    <span class="shrink-0" style="color: #0096C7;">{{ line.component }}</span>
                    <span class="break-all" style="color: #94a3b8;">{{ line.message }}</span>
                  </div>
                </div>
                <!-- Status bar -->
                <div class="shrink-0 px-4 py-2 flex items-center justify-between"
                     :style="{ borderTop: '1px solid rgba(255,255,255,0.06)', backgroundColor: 'rgba(0,0,0,0.2)' }">
                  <span class="text-[10px] font-medium" style="color: #64748b;">
                    {{ getAgentLogs(selectedAgent.id).length }} entries
                  </span>
                  <div class="flex items-center gap-1.5">
                    <div class="w-2 h-2 rounded-full"
                         :style="{ backgroundColor: selectedAgent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
                    <span class="text-[10px] font-semibold"
                          :style="{ color: selectedAgent.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }">
                      {{ selectedAgent.status === 'connected' ? 'Live' : 'Offline' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Config tab -->
            <div v-if="agentDetailTab === 'config'" class="p-4 space-y-3">
              <div v-for="field in [
                { label: 'Host', value: selectedAgent.host, muted: false },
                { label: 'Agent Version', value: selectedAgent.version === '-' ? '-' : 'v' + selectedAgent.version, muted: selectedAgent.version === '-' },
                { label: 'Log Level', value: selectedAgent.logLevel, muted: selectedAgent.logLevel === '-' },
                { label: 'Poll Interval', value: selectedAgent.pollInterval, muted: selectedAgent.pollInterval === '-' },
                { label: 'Docker Socket', value: selectedAgent.host.startsWith('unix://') ? selectedAgent.host : '/var/run/docker.sock', muted: false },
                { label: 'Last Seen', value: selectedAgent.lastSeen, muted: selectedAgent.lastSeen === 'Never' || selectedAgent.lastSeen === '-' },
              ]" :key="field.label"
                   class="flex items-center justify-between px-3 py-2 dd-rounded"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="text-[10px] font-semibold uppercase tracking-wider dd-text-muted">{{ field.label }}</span>
                <span class="text-[12px] font-mono" :class="field.muted ? 'dd-text-muted' : 'dd-text'">{{ field.value }}</span>
              </div>
            </div>

          </div>
        </aside>

      </div><!-- end flex wrapper -->
    </div>
  </AppLayout>
</template>
