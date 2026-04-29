<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { ROUTES } from '../router/routes';
import AgentDetailConfigTab from '../components/agents/AgentDetailConfigTab.vue';
import AgentDetailLogsTab from '../components/agents/AgentDetailLogsTab.vue';
import AgentDetailOverviewTab from '../components/agents/AgentDetailOverviewTab.vue';
import AppBadge from '../components/AppBadge.vue';
import AppTabBar from '../components/AppTabBar.vue';
import AppIconButton from '../components/AppIconButton.vue';
import DetailField from '../components/DetailField.vue';
import StatusDot from '../components/StatusDot.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { preferences } from '../preferences/store';
import { usePreference } from '../preferences/usePreference';
import { useViewMode } from '../preferences/useViewMode';
import { getAgents } from '../services/agent';
import { getLogEntries } from '../services/log';
import { getAllTriggers } from '../services/trigger';
import { getAllWatchers } from '../services/watcher';
import type { ApiAgent, ApiAgentLogEntry, ApiComponent } from '../types/api';
import { errorMessage } from '../utils/error';

interface Agent {
  id: string;
  name: string;
  host: string;
  status: 'connected' | 'disconnected';
  dockerVersion?: string;
  os?: string;
  arch?: string;
  cpus?: number;
  memoryGb?: number;
  containers: { total: number; running: number; stopped: number };
  images?: number;
  lastSeen?: string;
  version?: string;
  uptime?: string;
  logLevel?: string;
  pollInterval?: string;
  watchers: string[];
  triggers: string[];
}

interface AgentLog {
  displayTimestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  message: string;
}

const { t } = useI18n();
const { isMobile, windowNarrow: isCompact } = useBreakpoints();
const route = useRoute();
const router = useRouter();
let activeAgentStatusListener: EventListener | null = null;

const loading = ref(true);
const error = ref<string | null>(null);
const agentsData = ref<Agent[]>([]);
const agentLogsCache = ref<Record<string, AgentLog[]>>({});
const agentLogsLoading = ref(false);
const agentLogsError = ref('');
const agentLogLevelFilter = ref('all');
const agentLogTail = ref(100);
const agentLogComponent = ref('');
const agentLogsLastFetched = ref('');

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(minutes, 1)}m`;
}

function getAgentLogs(agentId: string): AgentLog[] {
  return agentLogsCache.value[agentId] ?? [];
}

function formatLastFetched(iso: string): string {
  if (!iso) {
    return t('agentsView.detail.fields.never');
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return t('agentsView.detail.fields.never');
  }
  return date.toLocaleTimeString();
}

function normalizeAgentKey(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function mapComponentNamesByAgent(components: ApiComponent[]): Record<string, string[]> {
  const mapped: Record<string, string[]> = {};
  for (const component of components) {
    const agentKey = normalizeAgentKey(component?.agent);
    if (!agentKey) continue;
    const label =
      typeof component?.type === 'string' && typeof component?.name === 'string'
        ? `${component.type}.${component.name}`
        : component?.id;
    if (typeof label !== 'string' || label.length === 0) continue;
    if (!mapped[agentKey]) {
      mapped[agentKey] = [];
    }
    mapped[agentKey].push(label);
  }

  for (const labels of Object.values(mapped)) {
    labels.sort((left, right) => left.localeCompare(right));
  }
  return mapped;
}

async function fetchAgents() {
  loading.value = true;
  error.value = null;
  try {
    const [rawAgents, rawWatchers, rawTriggers] = await Promise.all([
      getAgents(),
      getAllWatchers().catch(() => []),
      getAllTriggers().catch(() => []),
    ]);
    const watchersByAgent = mapComponentNamesByAgent(Array.isArray(rawWatchers) ? rawWatchers : []);
    const triggersByAgent = mapComponentNamesByAgent(Array.isArray(rawTriggers) ? rawTriggers : []);

    agentsData.value = rawAgents.map((a: ApiAgent) => ({
      id: a.name,
      name: a.name,
      host: `${a.host}${a.port ? `:${a.port}` : ''}`,
      status: a.connected ? 'connected' : 'disconnected',
      dockerVersion: typeof a.dockerVersion === 'string' ? a.dockerVersion : undefined,
      os: typeof a.os === 'string' ? a.os : undefined,
      arch: typeof a.arch === 'string' ? a.arch : undefined,
      cpus: Number.isFinite(a.cpus) ? Number(a.cpus) : undefined,
      memoryGb: Number.isFinite(a.memoryGb) ? Number(a.memoryGb) : undefined,
      containers:
        a.containers &&
        Number.isFinite(a.containers.total) &&
        Number.isFinite(a.containers.running) &&
        Number.isFinite(a.containers.stopped)
          ? {
              total: Number(a.containers.total),
              running: Number(a.containers.running),
              stopped: Number(a.containers.stopped),
            }
          : { total: 0, running: 0, stopped: 0 },
      images: Number.isFinite(a.images) ? Number(a.images) : undefined,
      lastSeen: typeof a.lastSeen === 'string' ? a.lastSeen : a.connected ? undefined : 'Never',
      version: typeof a.version === 'string' ? a.version : undefined,
      uptime:
        typeof a.uptime === 'string'
          ? a.uptime
          : Number.isFinite(a.uptimeSeconds)
            ? formatUptime(Number(a.uptimeSeconds))
            : undefined,
      logLevel: typeof a.logLevel === 'string' ? a.logLevel : undefined,
      pollInterval: typeof a.pollInterval === 'string' ? a.pollInterval : undefined,
      watchers: watchersByAgent[normalizeAgentKey(a.name)] ?? [],
      triggers: triggersByAgent[normalizeAgentKey(a.name)] ?? [],
    }));

    if (selectedAgent.value) {
      const refreshedSelectedAgent = agentsData.value.find(
        (agent) => agent.id === selectedAgent.value?.id,
      );
      if (refreshedSelectedAgent) {
        selectedAgent.value = refreshedSelectedAgent;
      } else {
        closeAgentPanel();
      }
    }
  } catch (e: unknown) {
    error.value = errorMessage(e, t('agentsView.list.loadError'));
  } finally {
    loading.value = false;
  }
}

async function fetchAgentLogs(
  agentName: string,
  options: { level?: string; component?: string; tail?: number; silent?: boolean } = {},
) {
  if (!options.silent) {
    agentLogsLoading.value = true;
    agentLogsError.value = '';
  }
  try {
    const level = options.level ?? agentLogLevelFilter.value;
    const component = options.component ?? (agentLogComponent.value.trim() || undefined);
    const tail = options.tail ?? agentLogTail.value;
    const entries = await getLogEntries({
      agent: agentName,
      level: level && level !== 'all' ? level : undefined,
      component,
      tail,
    });
    agentLogsCache.value[agentName] = (entries ?? []).map((e: ApiAgentLogEntry) => ({
      displayTimestamp: e.displayTimestamp ?? '-',
      level: e.level ?? 'info',
      component: e.component ?? '',
      message: e.msg ?? e.message ?? '',
    }));
    if (!options.silent) {
      agentLogsLastFetched.value = new Date().toISOString();
    }
  } catch (e: unknown) {
    void errorMessage(e, 'Failed to load agent logs');
    if (!options.silent) {
      agentLogsError.value = 'Failed to load agent logs';
    }
  } finally {
    if (!options.silent) {
      agentLogsLoading.value = false;
    }
  }
}

function handleAgentStatusChanged() {
  void fetchAgents();
}

const agentStatusChangedListener = handleAgentStatusChanged as EventListener;

onMounted(() => {
  if (activeAgentStatusListener) {
    globalThis.removeEventListener('dd:sse-agent-status-changed', activeAgentStatusListener);
    globalThis.removeEventListener('dd:sse-connected', activeAgentStatusListener);
    globalThis.removeEventListener('dd:sse-resync-required', activeAgentStatusListener);
  }
  activeAgentStatusListener = agentStatusChangedListener;
  globalThis.addEventListener('dd:sse-agent-status-changed', agentStatusChangedListener);
  globalThis.addEventListener('dd:sse-connected', agentStatusChangedListener);
  globalThis.addEventListener('dd:sse-resync-required', agentStatusChangedListener);
  void fetchAgents();
});

onUnmounted(() => {
  globalThis.removeEventListener('dd:sse-agent-status-changed', agentStatusChangedListener);
  globalThis.removeEventListener('dd:sse-connected', agentStatusChangedListener);
  globalThis.removeEventListener('dd:sse-resync-required', agentStatusChangedListener);
  if (activeAgentStatusListener === agentStatusChangedListener) {
    activeAgentStatusListener = null;
  }
});

// -- Search filter --
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

const filteredAgents = computed(() => {
  if (!searchQuery.value) return agentsData.value;
  const q = searchQuery.value.toLowerCase();
  return agentsData.value.filter((item) => item.name.toLowerCase().includes(q));
});

// -- View mode --
const agentViewMode = useViewMode('agents');

// -- Sorting --
const agentSortKey = usePreference(
  () => preferences.views.agents.sortKey,
  (v) => {
    preferences.views.agents.sortKey = v;
  },
);
const agentSortAsc = usePreference(
  () => preferences.views.agents.sortAsc,
  (v) => {
    preferences.views.agents.sortAsc = v;
  },
);

const sortedAgents = computed(() => {
  const list = [...filteredAgents.value];
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

// -- Column visibility --
const agentAllColumns = computed(() => [
  {
    key: 'name',
    label: t('agentsView.list.columns.name'),
    align: 'text-left',
    width: '99%',
    sortable: true,
    required: true,
  },
  { key: 'status', label: t('agentsView.list.columns.status'), sortable: true, required: false },
  {
    key: 'containers',
    label: t('agentsView.list.columns.containers'),
    sortable: true,
    required: false,
  },
  { key: 'docker', label: t('agentsView.list.columns.docker'), sortable: true, required: false },
  { key: 'os', label: t('agentsView.list.columns.os'), sortable: true, required: false },
  { key: 'version', label: t('agentsView.list.columns.version'), sortable: true, required: false },
  {
    key: 'lastSeen',
    label: t('agentsView.list.columns.lastSeen'),
    align: 'text-right',
    sortable: true,
    required: false,
  },
]);

const agentVisibleColumns = ref<Set<string>>(
  new Set(['name', 'status', 'containers', 'docker', 'os', 'version', 'lastSeen']),
);
const showAgentColumnPicker = ref(false);
const agentColumnPickerStyle = ref<Record<string, string>>({});
function toggleAgentColumnPicker(event: MouseEvent) {
  showAgentColumnPicker.value = !showAgentColumnPicker.value;
  if (showAgentColumnPicker.value) {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    agentColumnPickerStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
    };
  }
}

function toggleAgentColumn(key: string) {
  const col = agentAllColumns.value.find((c) => c.key === key);
  if (col?.required) return;
  if (agentVisibleColumns.value.has(key)) agentVisibleColumns.value.delete(key);
  else agentVisibleColumns.value.add(key);
}

const agentActiveColumns = computed(() =>
  agentAllColumns.value.filter(
    (c) => agentVisibleColumns.value.has(c.key) && (!isCompact.value || c.required),
  ),
);

// -- Detail panel --
const selectedAgent = ref<Agent | null>(null);
const agentPanelOpen = ref(false);
const agentDetailTab = ref('overview');

const agentDetailTabs = computed(() => [
  { id: 'overview', label: t('agentsView.detail.tabs.overview'), icon: 'info' },
  { id: 'logs', label: t('agentsView.detail.tabs.logs'), icon: 'logs' },
  { id: 'config', label: t('agentsView.detail.tabs.config'), icon: 'config' },
]);

function selectAgent(agent: Agent) {
  selectedAgent.value = agent;
  agentDetailTab.value = 'overview';
  agentPanelOpen.value = true;
}

function closeAgentPanel() {
  agentPanelOpen.value = false;
  selectedAgent.value = null;
}

function refreshSelectedAgentLogs() {
  if (!selectedAgent.value) return;
  void fetchAgentLogs(selectedAgent.value.name);
}

function resetAgentLogFilters() {
  agentLogLevelFilter.value = 'all';
  agentLogTail.value = 100;
  agentLogComponent.value = '';
  refreshSelectedAgentLogs();
}

watch(
  () => [agentDetailTab.value, selectedAgent.value?.name] as const,
  ([tab, agentName]) => {
    if (tab !== 'logs' || !agentName) return;
    if (getAgentLogs(agentName).length === 0 && !agentLogsLoading.value) {
      void fetchAgentLogs(agentName);
    }
  },
);

type AgentDetailField = {
  label: string;
  value: string | number;
  muted?: boolean;
};

function getResourceFields(agent: Agent): AgentDetailField[] {
  const fields: AgentDetailField[] = [];
  if (Number.isFinite(agent.cpus)) {
    fields.push({ label: t('agentsView.detail.fields.cpus'), value: Number(agent.cpus) });
  }
  if (Number.isFinite(agent.memoryGb)) {
    fields.push({
      label: t('agentsView.detail.fields.memory'),
      value: `${Number(agent.memoryGb)} GB`,
    });
  }
  if (Number.isFinite(agent.images)) {
    fields.push({ label: t('agentsView.detail.fields.images'), value: Number(agent.images) });
  }
  if (agent.uptime) {
    fields.push({ label: t('agentsView.detail.fields.uptime'), value: agent.uptime });
  }
  return fields;
}

function getSystemFields(agent: Agent): AgentDetailField[] {
  const fields: AgentDetailField[] = [];
  if (agent.dockerVersion) {
    fields.push({ label: t('agentsView.detail.fields.docker'), value: agent.dockerVersion });
  }
  if (agent.os) {
    fields.push({ label: t('agentsView.detail.fields.os'), value: agent.os });
  }
  if (agent.arch) {
    fields.push({ label: t('agentsView.detail.fields.architecture'), value: agent.arch });
  }
  if (agent.version) {
    fields.push({ label: t('agentsView.detail.fields.agent'), value: `v${agent.version}` });
  }
  return fields;
}

function getConfigFields(agent: Agent): AgentDetailField[] {
  const fields: AgentDetailField[] = [
    { label: t('agentsView.detail.fields.host'), value: agent.host },
  ];
  if (agent.version) {
    fields.push({ label: t('agentsView.detail.fields.agentVersion'), value: `v${agent.version}` });
  }
  if (agent.logLevel) {
    fields.push({ label: t('agentsView.detail.fields.logLevel'), value: agent.logLevel });
  }
  if (agent.pollInterval) {
    fields.push({ label: t('agentsView.detail.fields.pollInterval'), value: agent.pollInterval });
  }
  fields.push({
    label: t('agentsView.detail.fields.dockerSocket'),
    value: agent.host.startsWith('unix://') ? agent.host : '/var/run/docker.sock',
  });
  if (agent.lastSeen) {
    fields.push({
      label: t('agentsView.detail.fields.lastSeen'),
      value: agent.lastSeen,
      muted: agent.lastSeen === 'Never',
    });
  }
  return fields;
}
</script>

<template>
  <DataViewLayout>
          <div v-if="error"
               class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
               :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
            {{ error }}
          </div>

          <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">{{ t('agentsView.list.loading') }}</div>

          <!-- Filter bar -->
          <DataFilterBar
            v-model="agentViewMode"
            v-model:showFilters="showFilters"
            :filtered-count="filteredAgents.length"
            :total-count="agentsData.length"
            :active-filter-count="activeFilterCount">
            <template #filters>
              <input v-model="searchQuery"
                     type="text"
                     :placeholder="t('agentsView.list.filterPlaceholder')"
                     class="flex-1 min-w-[120px] max-w-[var(--dd-layout-filter-max-width)] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
              <AppButton size="none" variant="text-muted" weight="medium" class="text-2xs" v-if="searchQuery"

                      @click="searchQuery = ''">
                {{ t('agentsView.list.clearFilter') }}
              </AppButton>
            </template>
            <template #extra-buttons>
              <div v-if="agentViewMode === 'table'">
                <AppIconButton icon="config" size="toolbar" variant="plain" class="text-2xs-plus"
                        :class="showAgentColumnPicker ? 'dd-text dd-bg-elevated' : 'dd-text-secondary hover:dd-text hover:dd-bg-elevated'"
                        :aria-label="t('agentsView.list.toggleColumns')"
                        v-tooltip.top="t('agentsView.list.toggleColumns')"
                        @click.stop="toggleAgentColumnPicker" />
              </div>
            </template>
          </DataFilterBar>

          <!-- Column picker popover (rendered outside DataFilterBar to avoid overflow clipping) -->
          <div v-if="showAgentColumnPicker" @click.stop
               class="min-w-[160px] py-1.5 dd-rounded shadow-lg"
               :style="{
                 ...agentColumnPickerStyle,
                 zIndex: 'var(--z-popover)',
                 backgroundColor: 'var(--dd-bg-card)',
                 border: '1px solid var(--dd-border-strong)',
                 boxShadow: 'var(--dd-shadow-tooltip)',
               }">
            <div class="px-3 py-1 text-3xs font-bold uppercase tracking-wider dd-text-muted">{{ t('agentsView.list.columnPickerHeading') }}</div>
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2" v-for="col in agentAllColumns" :key="col.key"

                    :class="col.required ? 'dd-text-muted cursor-not-allowed' : 'dd-text'"
                    @click="toggleAgentColumn(col.key)">
              <AppIcon :name="agentVisibleColumns.has(col.key) ? 'check' : 'square'" :size="10"
                       :style="agentVisibleColumns.has(col.key) ? { color: 'var(--dd-primary)' } : {}" />
              {{ col.label }}
            </AppButton>
          </div>

          <!-- Table view -->
          <DataTable v-if="agentViewMode === 'table' && !loading"
                     :columns="agentActiveColumns"
                     :rows="sortedAgents"
                     row-key="id"
                     :sort-key="agentSortKey"
                     :sort-asc="agentSortAsc"
                     :selected-key="selectedAgent?.id ?? null"
                     @update:sort-key="agentSortKey = $event"
                     @update:sort-asc="agentSortAsc = $event"
                     @row-click="selectAgent($event)">
            <template #cell-name="{ row }">
              <div class="flex items-start gap-2 min-w-0">
                <StatusDot :status="row.status" size="md" class="mt-1.5" v-tooltip.top="row.status === 'connected' ? t('agentsView.list.status.connected') : t('agentsView.list.status.disconnected')" />
                <div class="min-w-0 flex-1">
                  <div class="font-medium truncate dd-text">{{ row.name }}</div>
                  <div class="text-2xs mt-0.5 truncate dd-text-muted">{{ row.host }}</div>
                  <!-- Compact mode: folded badge row -->
                  <div v-if="isCompact" class="flex items-center gap-1.5 mt-1.5">
                    <AppBadge :tone="row.status === 'connected' ? 'success' : 'danger'" size="xs" class="px-1.5 py-0 hidden md:inline-flex">
                      {{ row.status }}
                    </AppBadge>
                    <span class="text-3xs dd-text-secondary">
                      {{ row.containers.running }}/{{ row.containers.total }}
                    </span>
                    <span class="text-3xs dd-text-muted ml-auto">{{ row.lastSeen }}</span>
                  </div>
                </div>
              </div>
            </template>
            <template #cell-status="{ row }">
              <AppBadge :tone="row.status === 'connected' ? 'success' : 'danger'" size="xs" class="hidden md:inline-flex">
                {{ row.status }}
              </AppBadge>
            </template>
            <template #cell-containers="{ row }">
              <span class="font-bold" style="color: var(--dd-success);">{{ row.containers.running }}</span>
              <span class="dd-text-muted">/{{ row.containers.total }}</span>
            </template>
            <template #cell-docker="{ row }">
              <span class="font-mono" :class="row.dockerVersion ? 'dd-text-secondary' : 'dd-text-muted'">
                {{ row.dockerVersion ?? '—' }}
              </span>
            </template>
            <template #cell-os="{ row }">
              <span :class="row.os ? 'dd-text-secondary' : 'dd-text-muted'">{{ row.os ?? '—' }}</span>
            </template>
            <template #cell-version="{ row }">
              <span v-if="!row.version" class="dd-text-muted">-</span>
              <span v-else class="px-1.5 py-0.5 dd-rounded-sm text-2xs font-medium dd-bg-elevated dd-text-secondary">
                v{{ row.version }}
              </span>
            </template>
            <template #cell-lastSeen="{ row }">
              <span class="dd-text-muted">{{ row.lastSeen }}</span>
            </template>
            <template #empty>
              <EmptyState icon="filter"
                          :message="t('agentsView.list.emptyFiltered')"
                          :show-clear="activeFilterCount > 0"
                          @clear="searchQuery = ''" />
            </template>
          </DataTable>

          <!-- Card view -->
          <DataCardGrid v-if="agentViewMode === 'cards' && !loading"
                        :items="sortedAgents"
                        item-key="id"
                        :selected-key="selectedAgent?.id ?? null"
                        @item-click="selectAgent($event)">
            <template #card="{ item: agent }">
              <!-- Card header -->
              <div class="px-4 pt-4 pb-2 flex items-start justify-between">
                <div class="flex items-center gap-2.5 min-w-0">
                  <StatusDot :status="agent.status" size="lg" class="mt-1" v-tooltip.top="agent.status === 'connected' ? t('agentsView.list.status.connected') : t('agentsView.list.status.disconnected')" />
                  <div class="min-w-0">
                    <div class="text-sm-plus font-semibold truncate dd-text">{{ agent.name }}</div>
                    <div class="text-2xs-plus truncate mt-0.5 dd-text-muted">{{ agent.host }}</div>
                  </div>
                </div>
                <AppBadge :tone="agent.status === 'connected' ? 'success' : 'danger'" size="xs" class="tracking-wide shrink-0 ml-2 hidden md:inline-flex">
                  {{ agent.status }}
                </AppBadge>
              </div>
              <!-- Card body -->
              <div class="px-4 py-3">
                <div class="grid grid-cols-2 gap-2 text-2xs-plus">
                  <div>
                    <span class="dd-text-muted">{{ t('agentsView.detail.fields.docker') }}</span>
                    <span class="ml-1 font-semibold" :class="agent.dockerVersion ? 'dd-text' : 'dd-text-muted'">{{ agent.dockerVersion ?? '—' }}</span>
                  </div>
                  <div>
                    <span class="dd-text-muted">{{ t('agentsView.detail.fields.os') }}</span>
                    <span class="ml-1 font-semibold" :class="agent.os ? 'dd-text' : 'dd-text-muted'">{{ agent.os ?? '—' }}</span>
                  </div>
                  <div>
                    <span class="dd-text-muted">{{ t('agentsView.detail.fields.architecture') }}</span>
                    <span class="ml-1 font-semibold" :class="agent.arch ? 'dd-text' : 'dd-text-muted'">{{ agent.arch ?? '—' }}</span>
                  </div>
                  <div>
                    <span class="dd-text-muted">{{ t('agentsView.detail.fields.agent') }}</span>
                    <span class="ml-1 font-semibold" :class="agent.version ? 'dd-text' : 'dd-text-muted'">{{ agent.version ? `v${agent.version}` : '—' }}</span>
                  </div>
                </div>
              </div>
              <!-- Card footer -->
              <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
                   :style="{
                     borderTop: '1px solid var(--dd-border)',
                     backgroundColor: 'var(--dd-bg-elevated)',
                   }">
                <div class="flex items-center gap-3 text-2xs-plus">
                  <span>
                    <span class="font-bold" style="color: var(--dd-success);">{{ agent.containers.running }}</span>
                    <span class="dd-text-muted"> {{ t('agentsView.list.card.running') }}</span>
                  </span>
                  <span v-if="agent.containers.stopped > 0">
                    <span class="font-bold" style="color: var(--dd-danger);">{{ agent.containers.stopped }}</span>
                    <span class="dd-text-muted"> {{ t('agentsView.list.card.stopped') }}</span>
                  </span>
                </div>
                <span class="text-2xs dd-text-muted">{{ agent.lastSeen }}</span>
              </div>
            </template>
          </DataCardGrid>

          <!-- List view -->
          <DataListAccordion v-if="agentViewMode === 'list' && !loading"
                             :items="sortedAgents"
                             item-key="id"
                             :selected-key="selectedAgent?.id ?? null">
            <template #header="{ item: agent }">
              <StatusDot :status="agent.status" size="lg" v-tooltip.top="agent.status === 'connected' ? t('agentsView.list.status.connected') : t('agentsView.list.status.disconnected')" />
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold truncate dd-text">{{ agent.name }}</div>
                <div class="text-2xs mt-0.5 truncate dd-text-muted">{{ agent.host }}</div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <AppBadge :tone="agent.status === 'connected' ? 'success' : 'danger'" size="xs" class="hidden md:inline-flex">
                  {{ agent.status }}
                </AppBadge>
                <span class="text-2xs dd-text-secondary">
                  {{ agent.containers.running }}/{{ agent.containers.total }}
                </span>
                <span class="text-2xs dd-text-muted">{{ agent.lastSeen }}</span>
              </div>
            </template>
            <template #details="{ item: agent }">
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 mt-2">
                <DetailField :label="t('agentsView.detail.fields.docker')" mono compact>
                  <span :class="agent.dockerVersion ? '' : 'dd-text-muted'">{{ agent.dockerVersion ?? '—' }}</span>
                </DetailField>
                <DetailField :label="t('agentsView.detail.fields.os')" compact>
                  <span :class="agent.os ? '' : 'dd-text-muted'">{{ agent.os ?? '—' }}</span>
                </DetailField>
                <DetailField :label="t('agentsView.detail.fields.architecture')" compact>
                  <span :class="agent.arch ? '' : 'dd-text-muted'">{{ agent.arch ?? '—' }}</span>
                </DetailField>
                <DetailField :label="t('agentsView.detail.fields.agent')" mono compact>
                  <span :class="agent.version ? '' : 'dd-text-muted'">{{ agent.version ? `v${agent.version}` : '—' }}</span>
                </DetailField>
                <DetailField :label="t('agentsView.detail.fields.uptime')" compact>
                  <span :class="agent.uptime ? '' : 'dd-text-muted'">{{ agent.uptime ?? '—' }}</span>
                </DetailField>
                <DetailField :label="t('agentsView.detail.overview.containers')" compact>
                  <span class="font-bold" style="color: var(--dd-success);">{{ agent.containers.running }}</span>
                  <span class="dd-text-muted"> {{ t('agentsView.list.card.running') }} / </span>
                  <span>{{ agent.containers.total }}</span>
                </DetailField>
              </div>
              <!-- Action buttons -->
              <div class="mt-4 pt-3 flex items-center gap-2" :style="{ borderTop: '1px solid var(--dd-border)' }">
                <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-medium transition-colors dd-text-secondary hover:dd-text hover:dd-bg-elevated"
                        @click.stop="selectAgent(agent)">
                  <AppIcon name="info" :size="11" />
                  {{ t('agentsView.detail.listView.details') }}
                </AppButton>
              </div>
            </template>
          </DataListAccordion>

          <!-- Empty state (when no data at all, not filtered) -->
          <EmptyState v-if="!loading && sortedAgents.length === 0 && agentViewMode !== 'table'"
                      icon="filter"
                      :message="t('agentsView.list.emptyFiltered')"
                      :show-clear="activeFilterCount > 0"
                      @clear="searchQuery = ''" />

    <template #panel>
        <!-- Detail panel -->
        <DetailPanel
          :open="agentPanelOpen"
          :is-mobile="isMobile"
          size="md"
          :show-size-controls="false"
          :show-full-page="false"
          @update:open="agentPanelOpen = $event; if (!$event) selectedAgent = null">
          <template #header>
            <div class="flex items-center gap-2.5 min-w-0">
              <StatusDot :status="selectedAgent?.status === 'connected' ? 'connected' : 'disconnected'" size="lg" v-tooltip.top="selectedAgent?.status === 'connected' ? t('agentsView.list.status.connected') : t('agentsView.list.status.disconnected')" />
              <span class="text-sm font-bold truncate dd-text">{{ selectedAgent?.name }}</span>
              <AppBadge :tone="selectedAgent?.status === 'connected' ? 'success' : 'danger'" size="xs" class="shrink-0">
                {{ selectedAgent?.status }}
              </AppBadge>
            </div>
          </template>

          <template #subtitle>
            <span class="text-2xs-plus font-mono dd-text-secondary">{{ selectedAgent?.host }}</span>
          </template>

          <template #tabs>
            <AppTabBar
              :tabs="agentDetailTabs"
              :model-value="agentDetailTab"
              @update:model-value="agentDetailTab = $event"
            />
          </template>

          <!-- Tab content -->
          <template v-if="selectedAgent">
            <AgentDetailOverviewTab
              v-if="agentDetailTab === 'overview'"
              :agent="selectedAgent"
              :resource-fields="getResourceFields(selectedAgent)"
              :system-fields="getSystemFields(selectedAgent)"
              @view-containers="router.push({ path: ROUTES.CONTAINERS, query: { filterServer: selectedAgent.name } })"
            />

            <AgentDetailLogsTab
              v-if="agentDetailTab === 'logs'"
              :logs="getAgentLogs(selectedAgent.id)"
              :loading="agentLogsLoading"
              :error="agentLogsError"
              :log-level-filter="agentLogLevelFilter"
              :tail="agentLogTail"
              :component-filter="agentLogComponent"
              :last-fetched-iso="agentLogsLastFetched"
              :status="selectedAgent.status"
              :format-last-fetched="formatLastFetched"
              @update:log-level-filter="agentLogLevelFilter = $event"
              @update:tail="agentLogTail = $event"
              @update:component-filter="agentLogComponent = $event"
              @refresh="refreshSelectedAgentLogs"
              @reset="resetAgentLogFilters"
            />

            <AgentDetailConfigTab
              v-if="agentDetailTab === 'config'"
              :fields="getConfigFields(selectedAgent)"
            />
          </template>
        </DetailPanel>
    </template>
  </DataViewLayout>
</template>
