<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useBreakpoints } from '../composables/useBreakpoints';
import { getAuditLog } from '../services/audit';

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  containerName: string;
  containerImage?: string;
  fromVersion?: string;
  toVersion?: string;
  triggerName?: string;
  status: 'success' | 'error' | 'info';
  details?: string;
}

const actionTypes = [
  'update-available',
  'update-applied',
  'update-failed',
  'security-alert',
  'agent-disconnect',
  'container-added',
  'container-removed',
  'rollback',
  'preview',
  'container-start',
  'container-stop',
  'container-restart',
  'webhook-watch',
  'webhook-watch-container',
  'webhook-update',
  'hook-pre-success',
  'hook-pre-failed',
  'hook-post-success',
  'hook-post-failed',
  'auto-rollback',
];

const route = useRoute();
const { isMobile } = useBreakpoints();

function firstQueryValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw : undefined;
}

function parsePageQuery(value: unknown): number {
  const raw = firstQueryValue(value);
  if (!raw || !/^\d+$/.test(raw)) return 1;
  return Math.max(1, Number.parseInt(raw, 10));
}

function parseViewModeQuery(value: unknown): 'table' | 'cards' | 'list' {
  const raw = firstQueryValue(value);
  if (raw === 'cards' || raw === 'list') return raw;
  return 'table';
}

function parseActionQuery(value: unknown): string {
  const raw = firstQueryValue(value);
  return raw && actionTypes.includes(raw) ? raw : '';
}

const auditViewMode = ref<'table' | 'cards' | 'list'>(parseViewModeQuery(route.query.view));
const selectedEntry = ref<AuditEntry | null>(null);
const detailOpen = ref(false);

function openDetail(entry: AuditEntry) {
  selectedEntry.value = entry;
  detailOpen.value = true;
}

const entries = ref<AuditEntry[]>([]);
const loading = ref(true);
const error = ref('');

// Pagination
const page = ref(parsePageQuery(route.query.page));
const limit = ref(50);
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));

// Filters
const searchQuery = ref(firstQueryValue(route.query.q) ?? '');
const actionFilter = ref(parseActionQuery(route.query.action));
const showFilters = ref(false);
const activeFilterCount = computed(() => {
  let count = 0;
  if (searchQuery.value) count++;
  if (actionFilter.value) count++;
  return count;
});

function clearFilters() {
  searchQuery.value = '';
  actionFilter.value = '';
  page.value = 1;
}

const filteredEntries = computed(() => {
  let result = entries.value;
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(
      (e) =>
        e.containerName?.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        e.details?.toLowerCase().includes(q),
    );
  }
  return result;
});

function statusColor(status: string) {
  if (status === 'success') return 'var(--dd-success)';
  if (status === 'error') return 'var(--dd-danger)';
  return 'var(--dd-info)';
}

function statusBg(status: string) {
  if (status === 'success') return 'var(--dd-success-muted)';
  if (status === 'error') return 'var(--dd-danger-muted)';
  return 'var(--dd-info-muted)';
}

function actionLabel(action: string) {
  return action
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatTimestamp(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

function actionIcon(action: string) {
  if (action.includes('update-available')) return 'updates';
  if (action.includes('update-applied')) return 'check';
  if (action.includes('update-failed')) return 'xmark';
  if (action.includes('security-alert')) return 'security';
  if (action.includes('agent-disconnect')) return 'network';
  if (action.includes('rollback') || action === 'auto-rollback') return 'restart';
  if (action.includes('start')) return 'play';
  if (action.includes('stop')) return 'stop';
  if (action.includes('restart')) return 'restart';
  if (action.includes('added')) return 'containers';
  if (action.includes('removed')) return 'trash';
  if (action.includes('webhook')) return 'bolt';
  if (action.includes('hook')) return 'triggers';
  if (action === 'preview') return 'search';
  return 'info';
}

function targetLabel(action: string) {
  return action.includes('agent-disconnect') ? 'Agent' : 'Container';
}

const tableColumns = [
  { key: 'timestamp', label: 'Time', width: '15%', sortable: false },
  { key: 'action', label: 'Event', width: '20%', sortable: false },
  { key: 'containerName', label: 'Target', width: '99%', sortable: false },
  { key: 'status', label: 'Status', align: 'text-center', sortable: false },
  { key: 'details', label: 'Details', align: 'text-right', sortable: false },
];

async function fetchAudit() {
  loading.value = true;
  error.value = '';
  try {
    const params: Record<string, any> = { page: page.value, limit: limit.value };
    if (actionFilter.value) params.action = actionFilter.value;
    const data = await getAuditLog(params);
    entries.value = data.entries ?? [];
    total.value = data.total ?? 0;
  } catch {
    error.value = 'Failed to load audit log';
  } finally {
    loading.value = false;
  }
}

watch([page, actionFilter], () => fetchAudit());
watch(
  () => [route.query.page, route.query.action, route.query.q, route.query.view],
  ([nextPage, nextAction, nextSearch, nextView]) => {
    page.value = parsePageQuery(nextPage);
    actionFilter.value = parseActionQuery(nextAction);
    searchQuery.value = firstQueryValue(nextSearch) ?? '';
    auditViewMode.value = parseViewModeQuery(nextView);
  },
);

function prevPage() {
  if (page.value > 1) page.value--;
}
function nextPage() {
  if (page.value < totalPages.value) page.value++;
}

onMounted(fetchAudit);
</script>

<template>
  <DataViewLayout>
    <!-- Filter bar -->
    <DataFilterBar
      v-model="auditViewMode"
      v-model:showFilters="showFilters"
      :filtered-count="filteredEntries.length"
      :total-count="total"
      :active-filter-count="activeFilterCount"
    >
      <template #filters>
        <input v-model="searchQuery"
               type="text"
               placeholder="Filter by target or event..."
               class="flex-1 min-w-[120px] max-w-[240px] px-2.5 py-1.5 dd-rounded text-[11px] font-medium border outline-none dd-bg dd-text dd-border-strong dd-placeholder" />
        <select v-model="actionFilter"
                class="px-2.5 py-1.5 dd-rounded text-[11px] font-medium border outline-none dd-bg dd-text dd-border-strong">
          <option value="">All events</option>
          <option v-for="a in actionTypes" :key="a" :value="a">{{ actionLabel(a) }}</option>
        </select>
        <button v-if="activeFilterCount > 0"
                class="text-[10px] dd-text-muted hover:dd-text transition-colors"
                @click="clearFilters">
          Clear
        </button>
      </template>
    </DataFilterBar>

    <!-- Table view -->
    <DataTable
      v-if="auditViewMode === 'table' && filteredEntries.length > 0"
      :columns="tableColumns"
      :rows="filteredEntries"
      row-key="id"
      :active-row="selectedEntry?.id"
      @row-click="openDetail($event)"
    >
      <template #cell-timestamp="{ row }">
        <span class="whitespace-nowrap text-[10px] font-mono dd-text-secondary">{{ formatTimestamp(row.timestamp) }}</span>
      </template>
      <template #cell-action="{ row }">
        <div class="flex items-center gap-2">
          <AppIcon :name="actionIcon(row.action)" :size="12" class="dd-text-secondary shrink-0" />
          <span class="font-medium text-[11px] dd-text">{{ actionLabel(row.action) }}</span>
        </div>
      </template>
      <template #cell-containerName="{ row }">
        <span class="font-mono text-[11px] dd-text">{{ row.containerName }}</span>
      </template>
      <template #cell-status="{ row }">
        <AppIcon :name="row.status === 'success' ? 'check' : row.status === 'error' ? 'xmark' : 'info'" :size="13" class="shrink-0 md:!hidden"
                 :style="{ color: statusColor(row.status) }" />
        <span class="badge text-[9px] font-bold max-md:!hidden"
              :style="{ backgroundColor: statusBg(row.status), color: statusColor(row.status) }">
          {{ row.status }}
        </span>
      </template>
      <template #cell-details="{ row }">
        <span v-if="row.fromVersion || row.toVersion" class="text-[10px] font-mono dd-text-secondary whitespace-nowrap">
          {{ row.fromVersion }}{{ row.fromVersion && row.toVersion ? ' → ' : '' }}{{ row.toVersion }}
        </span>
        <span v-else-if="row.details" class="text-[10px] dd-text-muted truncate max-w-[200px] inline-block">{{ row.details }}</span>
        <span v-else class="dd-text-muted">—</span>
      </template>
    </DataTable>

    <!-- Card view -->
    <DataCardGrid
      v-if="auditViewMode === 'cards'"
      :items="filteredEntries"
      item-key="id"
      :selected-key="selectedEntry?.id"
      @item-click="openDetail($event)"
    >
      <template #card="{ item: entry }">
        <div class="px-4 pt-4 pb-2 flex items-start justify-between">
          <div class="flex items-center gap-2.5 min-w-0">
            <AppIcon :name="actionIcon(entry.action)" :size="14" class="dd-text-secondary shrink-0 mt-0.5" />
            <div class="min-w-0">
              <div class="text-[14px] font-semibold truncate dd-text">{{ actionLabel(entry.action) }}</div>
              <div class="text-[11px] truncate mt-0.5 dd-text-muted font-mono">{{ entry.containerName }}</div>
            </div>
          </div>
          <span class="badge text-[9px] font-bold shrink-0 ml-2"
                :style="{ backgroundColor: statusBg(entry.status), color: statusColor(entry.status) }">
            {{ entry.status }}
          </span>
        </div>
        <div class="px-4 py-3">
          <div class="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span class="dd-text-muted">Time</span>
              <span class="ml-1 font-semibold dd-text">{{ formatTimestamp(entry.timestamp) }}</span>
            </div>
            <div v-if="entry.fromVersion || entry.toVersion">
              <span class="dd-text-muted">Version</span>
              <span class="ml-1 font-mono dd-text">{{ entry.fromVersion || '—' }} → {{ entry.toVersion || '—' }}</span>
            </div>
          </div>
        </div>
        <div class="px-4 py-2.5 mt-auto"
             :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
          <span class="text-[10px] dd-text-muted font-mono">{{ formatTimestamp(entry.timestamp) }}</span>
        </div>
      </template>
    </DataCardGrid>

    <!-- List view (accordion) -->
    <DataListAccordion
      v-if="auditViewMode === 'list'"
      :items="filteredEntries"
      item-key="id"
      :selected-key="selectedEntry?.id"
      @item-click="openDetail($event)"
    >
      <template #header="{ item: entry }">
        <AppIcon :name="actionIcon(entry.action)" :size="14" class="dd-text-secondary shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold truncate dd-text">{{ actionLabel(entry.action) }}</div>
          <div class="text-[10px] font-mono dd-text-muted truncate mt-0.5">{{ entry.containerName }}</div>
        </div>
        <span class="text-[10px] font-mono dd-text-muted shrink-0 hidden md:inline">{{ formatTimestamp(entry.timestamp) }}</span>
        <span class="badge text-[9px] font-bold shrink-0"
              :style="{ backgroundColor: statusBg(entry.status), color: statusColor(entry.status) }">
          {{ entry.status }}
        </span>
      </template>
      <template #details="{ item: entry }">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Timestamp</div>
            <div class="text-[12px] font-mono dd-text">{{ formatTimestamp(entry.timestamp) }}</div>
          </div>
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">{{ targetLabel(entry.action) }}</div>
            <div class="text-[12px] font-mono dd-text">{{ entry.containerName }}</div>
          </div>
          <div v-if="entry.containerImage">
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Image</div>
            <div class="text-[12px] font-mono dd-text">{{ entry.containerImage }}</div>
          </div>
          <div v-if="entry.fromVersion">
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">From Version</div>
            <div class="text-[12px] font-mono dd-text">{{ entry.fromVersion }}</div>
          </div>
          <div v-if="entry.toVersion">
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">To Version</div>
            <div class="text-[12px] font-mono dd-text">{{ entry.toVersion }}</div>
          </div>
          <div v-if="entry.details">
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Details</div>
            <div class="text-[12px] font-mono dd-text">{{ entry.details }}</div>
          </div>
        </div>
      </template>
    </DataListAccordion>

    <!-- Pagination -->
    <div v-if="total > limit" class="flex items-center justify-between px-4 py-2.5"
         :style="{ borderTop: '1px solid var(--dd-border)' }">
      <span class="text-[11px] dd-text-muted">
        Page {{ page }} of {{ totalPages }} ({{ total }} entries)
      </span>
      <div class="flex items-center gap-1.5">
        <button class="px-2.5 py-1 dd-rounded text-[11px] font-medium border dd-bg dd-text dd-border-strong disabled:opacity-40"
                :disabled="page <= 1"
                @click="prevPage">
          <AppIcon name="chevron-left" :size="11" />
        </button>
        <button class="px-2.5 py-1 dd-rounded text-[11px] font-medium border dd-bg dd-text dd-border-strong disabled:opacity-40"
                :disabled="page >= totalPages"
                @click="nextPage">
          <AppIcon name="chevron-right" :size="11" />
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <EmptyState
      v-if="filteredEntries.length === 0 && !loading"
      icon="audit"
      message="No audit entries match your filters"
      :show-clear="activeFilterCount > 0"
      @clear="clearFilters"
    />

    <template #panel>
      <DetailPanel
        :open="detailOpen"
        :is-mobile="isMobile"
        :show-size-controls="false"
        :show-full-page="false"
        @update:open="detailOpen = $event; if (!$event) selectedEntry = null"
      >
        <template #header>
          <div class="flex items-center gap-2.5 min-w-0">
            <AppIcon v-if="selectedEntry" :name="actionIcon(selectedEntry.action)" :size="14" class="dd-text-secondary shrink-0" />
            <span class="text-sm font-bold truncate dd-text">{{ selectedEntry ? actionLabel(selectedEntry.action) : '' }}</span>
            <span v-if="selectedEntry" class="badge text-[9px] font-bold shrink-0"
                  :style="{ backgroundColor: statusBg(selectedEntry.status), color: statusColor(selectedEntry.status) }">
              {{ selectedEntry.status }}
            </span>
          </div>
        </template>

        <template #subtitle>
          <span class="text-[11px] font-mono dd-text-secondary">{{ selectedEntry?.containerName }}</span>
        </template>

        <template v-if="selectedEntry" #default>
          <div class="p-4 space-y-5">
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Timestamp</div>
              <div class="text-[12px] font-mono dd-text">{{ formatTimestamp(selectedEntry.timestamp) }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Event</div>
              <div class="text-[12px] font-medium dd-text">{{ actionLabel(selectedEntry.action) }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">{{ targetLabel(selectedEntry.action) }}</div>
              <div class="text-[12px] font-mono dd-text break-all">{{ selectedEntry.containerName }}</div>
            </div>
            <div v-if="selectedEntry.containerImage">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Image</div>
              <div class="text-[12px] font-mono dd-text break-all">{{ selectedEntry.containerImage }}</div>
            </div>
            <div v-if="selectedEntry.fromVersion">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">From Version</div>
              <div class="text-[12px] font-mono dd-text break-all">{{ selectedEntry.fromVersion }}</div>
            </div>
            <div v-if="selectedEntry.toVersion">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">To Version</div>
              <div class="text-[12px] font-mono dd-text break-all">{{ selectedEntry.toVersion }}</div>
            </div>
            <div v-if="selectedEntry.triggerName">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Trigger</div>
              <div class="text-[12px] font-mono dd-text">{{ selectedEntry.triggerName }}</div>
            </div>
            <div v-if="selectedEntry.details">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Details</div>
              <div class="text-[12px] font-mono dd-text break-all">{{ selectedEntry.details }}</div>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
