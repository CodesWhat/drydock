<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppBadge from '../components/AppBadge.vue';
import AppIconButton from '../components/AppIconButton.vue';
import DetailField from '../components/DetailField.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useViewMode } from '../preferences/useViewMode';
import { getAuditLog } from '../services/audit';
import type { AuditEntry } from '../utils/audit-helpers';
import {
  actionIcon,
  actionLabel,
  statusBg,
  statusColor,
  targetLabel,
} from '../utils/audit-helpers';
import { resolveAuditViewModeFromQuery } from './auditViewMode';

const actionTypes = [
  'update-available',
  'update-applied',
  'update-failed',
  'notification-delivery-failed',
  'container-update',
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

function parseActionQuery(value: unknown): string {
  const raw = firstQueryValue(value);
  return raw && actionTypes.includes(raw) ? raw : '';
}

function parseContainerQuery(value: unknown): string {
  const raw = firstQueryValue(value);
  return raw?.trim() ?? '';
}

function parseDateQuery(value: unknown): string {
  const raw = firstQueryValue(value);
  if (!raw) return '';
  const normalized = raw.includes('T') ? raw.slice(0, 10) : raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

const persistedAuditView = useViewMode('audit');
// URL query takes precedence over localStorage
const auditViewMode = ref<'table' | 'cards' | 'list'>(
  resolveAuditViewModeFromQuery(persistedAuditView.value, route.query.view),
);
watch(auditViewMode, (v) => {
  persistedAuditView.value = v;
});
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
const containerFilter = ref(parseContainerQuery(route.query.container));
const fromDateFilter = ref(parseDateQuery(route.query.from));
const toDateFilter = ref(parseDateQuery(route.query.to));
const showFilters = ref(false);
const activeFilterCount = computed(() => {
  let count = 0;
  if (searchQuery.value) count++;
  if (actionFilter.value) count++;
  if (containerFilter.value) count++;
  if (fromDateFilter.value) count++;
  if (toDateFilter.value) count++;
  return count;
});

function clearFilters() {
  searchQuery.value = '';
  actionFilter.value = '';
  containerFilter.value = '';
  fromDateFilter.value = '';
  toDateFilter.value = '';
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

const tableColumns = [
  { key: 'timestamp', label: 'Time', width: '15%', sortable: false },
  { key: 'action', label: 'Event', width: '20%', sortable: false },
  { key: 'containerName', label: 'Target', width: '99%', sortable: false },
  { key: 'status', label: 'Status', sortable: false },
  { key: 'details', label: 'Details', align: 'text-right', sortable: false },
];

async function fetchAudit() {
  loading.value = true;
  error.value = '';
  try {
    const params: Record<string, unknown> = { page: page.value, limit: limit.value };
    if (actionFilter.value) params.action = actionFilter.value;
    if (containerFilter.value) params.container = containerFilter.value;
    if (fromDateFilter.value) params.from = fromDateFilter.value;
    if (toDateFilter.value) params.to = toDateFilter.value;
    const data = await getAuditLog(params);
    entries.value = data.entries ?? [];
    total.value = data.total ?? 0;
  } catch {
    error.value = 'Failed to load audit log';
  } finally {
    loading.value = false;
  }
}

watch([page, actionFilter, containerFilter, fromDateFilter, toDateFilter], () => fetchAudit());
watch(
  () => [
    route.query.page,
    route.query.action,
    route.query.q,
    route.query.view,
    route.query.container,
    route.query.from,
    route.query.to,
  ],
  ([nextPage, nextAction, nextSearch, nextView, nextContainer, nextFrom, nextTo]) => {
    page.value = parsePageQuery(nextPage);
    actionFilter.value = parseActionQuery(nextAction);
    searchQuery.value = firstQueryValue(nextSearch) ?? '';
    auditViewMode.value = resolveAuditViewModeFromQuery(auditViewMode.value, nextView);
    containerFilter.value = parseContainerQuery(nextContainer);
    fromDateFilter.value = parseDateQuery(nextFrom);
    toDateFilter.value = parseDateQuery(nextTo);
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
    <div v-if="error"
         class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">Loading audit log...</div>

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
               class="flex-1 min-w-[120px] max-w-[var(--dd-layout-filter-max-width)] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
        <input v-model="containerFilter"
               name="container-name"
               type="text"
               placeholder="Container name..."
               class="min-w-[140px] max-w-[220px] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
        <select v-model="actionFilter"
                class="px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text">
          <option value="">All events</option>
          <option v-for="a in actionTypes" :key="a" :value="a">{{ actionLabel(a) }}</option>
        </select>
        <input v-model="fromDateFilter"
               name="from-date"
               type="date"
               aria-label="From date"
               class="px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text" />
        <input v-model="toDateFilter"
               name="to-date"
               type="date"
               aria-label="To date"
               class="px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text" />
        <AppButton size="none" variant="plain" weight="none" v-if="activeFilterCount > 0"
                class="text-2xs dd-text-muted hover:dd-text transition-colors"
                @click="clearFilters">
          Clear
        </AppButton>
      </template>
    </DataFilterBar>

    <!-- Table view -->
    <DataTable
      v-if="auditViewMode === 'table' && filteredEntries.length > 0 && !loading"
      :columns="tableColumns"
      :rows="filteredEntries"
      row-key="id"
      :active-row="selectedEntry?.id"
      @row-click="openDetail($event)"
    >
      <template #cell-timestamp="{ row }">
        <span class="whitespace-nowrap text-2xs font-mono dd-text-secondary">{{ formatTimestamp(row.timestamp) }}</span>
      </template>
      <template #cell-action="{ row }">
        <div class="flex items-center gap-2">
          <AppIcon :name="actionIcon(row.action)" :size="12" class="dd-text-secondary shrink-0" />
          <span class="font-medium text-2xs-plus dd-text">{{ actionLabel(row.action) }}</span>
        </div>
      </template>
      <template #cell-containerName="{ row }">
        <span class="block max-w-[220px] truncate font-mono text-2xs-plus dd-text" v-tooltip.top="row.containerName">
          {{ row.containerName }}
        </span>
      </template>
      <template #cell-status="{ row }">
        <AppIcon :name="row.status === 'success' ? 'check' : row.status === 'error' ? 'xmark' : 'info'" :size="13" class="shrink-0 md:!hidden"
                 :style="{ color: statusColor(row.status) }"
                 v-tooltip.top="row.status" />
        <AppBadge :custom="{ bg: statusBg(row.status), text: statusColor(row.status) }" size="xs" class="max-md:!hidden">
          {{ row.status }}
        </AppBadge>
      </template>
      <template #cell-details="{ row }">
        <span
          v-if="row.fromVersion || row.toVersion"
          class="block max-w-[220px] truncate text-2xs font-mono dd-text-secondary"
          v-tooltip.top="`${row.fromVersion || '—'}${row.fromVersion && row.toVersion ? ' → ' : ''}${row.toVersion || '—'}`"
        >
          {{ row.fromVersion }}{{ row.fromVersion && row.toVersion ? ' → ' : '' }}{{ row.toVersion }}
        </span>
        <span v-else-if="row.details" class="text-2xs dd-text-muted truncate max-w-[200px] inline-block">{{ row.details }}</span>
        <span v-else class="dd-text-muted">—</span>
      </template>
    </DataTable>

    <!-- Card view -->
    <DataCardGrid
      v-if="auditViewMode === 'cards' && !loading"
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
              <div class="text-sm font-semibold truncate dd-text">{{ actionLabel(entry.action) }}</div>
              <div class="text-2xs-plus truncate mt-0.5 dd-text-muted font-mono">{{ entry.containerName }}</div>
            </div>
          </div>
          <AppBadge :custom="{ bg: statusBg(entry.status), text: statusColor(entry.status) }" size="xs" class="shrink-0 ml-2">
            {{ entry.status }}
          </AppBadge>
        </div>
        <div class="px-4 py-3">
          <div class="grid grid-cols-2 gap-2 text-2xs-plus">
            <div>
              <span class="dd-text-muted">Time</span>
              <span class="ml-1 font-semibold dd-text">{{ formatTimestamp(entry.timestamp) }}</span>
            </div>
            <div v-if="entry.fromVersion || entry.toVersion">
              <span class="dd-text-muted">Version</span>
              <span
                class="ml-1 max-w-[180px] truncate font-mono dd-text inline-block"
                v-tooltip.top="`${entry.fromVersion || '—'} → ${entry.toVersion || '—'}`"
              >
                {{ entry.fromVersion || '—' }} → {{ entry.toVersion || '—' }}
              </span>
            </div>
          </div>
        </div>
        <div class="px-4 py-2.5 mt-auto"
             :style="{ borderTop: '1px solid var(--dd-border)', backgroundColor: 'var(--dd-bg-elevated)' }">
          <span class="text-2xs dd-text-muted font-mono">{{ formatTimestamp(entry.timestamp) }}</span>
        </div>
      </template>
    </DataCardGrid>

    <!-- List view (accordion) -->
    <DataListAccordion
      v-if="auditViewMode === 'list' && !loading"
      :items="filteredEntries"
      item-key="id"
      :selected-key="selectedEntry?.id"
      @item-click="openDetail($event)"
    >
      <template #header="{ item: entry }">
        <AppIcon :name="actionIcon(entry.action)" :size="14" class="dd-text-secondary shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold truncate dd-text">{{ actionLabel(entry.action) }}</div>
          <div class="text-2xs font-mono dd-text-muted truncate mt-0.5">{{ entry.containerName }}</div>
        </div>
        <span class="text-2xs font-mono dd-text-muted shrink-0 hidden md:inline">{{ formatTimestamp(entry.timestamp) }}</span>
        <AppBadge :custom="{ bg: statusBg(entry.status), text: statusColor(entry.status) }" size="xs" class="shrink-0">
          {{ entry.status }}
        </AppBadge>
      </template>
      <template #details="{ item: entry }">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
          <DetailField label="Timestamp" mono compact>{{ formatTimestamp(entry.timestamp) }}</DetailField>
          <DetailField :label="targetLabel(entry.action)" mono compact>{{ entry.containerName }}</DetailField>
          <DetailField v-if="entry.containerImage" label="Image" mono compact>{{ entry.containerImage }}</DetailField>
          <DetailField v-if="entry.fromVersion" label="From Version" mono compact>{{ entry.fromVersion }}</DetailField>
          <DetailField v-if="entry.toVersion" label="To Version" mono compact>{{ entry.toVersion }}</DetailField>
          <DetailField v-if="entry.details" label="Details" mono compact>{{ entry.details }}</DetailField>
        </div>
      </template>
    </DataListAccordion>

    <!-- Pagination -->
    <div v-if="total > limit" class="flex items-center justify-between px-4 py-2.5"
         :style="{ borderTop: '1px solid var(--dd-border)' }">
      <span class="text-2xs-plus dd-text-muted">
        Page {{ page }} of {{ totalPages }} ({{ total }} entries)
      </span>
      <div class="flex items-center gap-1.5">
        <AppIconButton icon="chevron-left" size="toolbar" variant="plain"
                class="dd-bg dd-text hover:dd-bg-elevated"
                :disabled="page <= 1"
                v-tooltip.top="'Previous page'"
                @click="prevPage" />
        <AppIconButton icon="chevron-right" size="toolbar" variant="plain"
                class="dd-bg dd-text hover:dd-bg-elevated"
                :disabled="page >= totalPages"
                v-tooltip.top="'Next page'"
                @click="nextPage" />
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
            <AppBadge v-if="selectedEntry" :custom="{ bg: statusBg(selectedEntry.status), text: statusColor(selectedEntry.status) }" size="xs" class="shrink-0">
              {{ selectedEntry.status }}
            </AppBadge>
          </div>
        </template>

        <template #subtitle>
          <span class="text-2xs-plus font-mono dd-text-secondary">{{ selectedEntry?.containerName }}</span>
        </template>

        <template v-if="selectedEntry" #default>
          <div class="p-4 space-y-5">
            <DetailField label="Timestamp" mono>{{ formatTimestamp(selectedEntry.timestamp) }}</DetailField>
            <DetailField label="Event">
              <span class="font-medium">{{ actionLabel(selectedEntry.action) }}</span>
            </DetailField>
            <DetailField :label="targetLabel(selectedEntry.action)" mono>
              <span class="break-all">{{ selectedEntry.containerName }}</span>
            </DetailField>
            <DetailField v-if="selectedEntry.containerImage" label="Image" mono>
              <span class="break-all">{{ selectedEntry.containerImage }}</span>
            </DetailField>
            <DetailField v-if="selectedEntry.fromVersion" label="From Version" mono>
              <span class="break-all">{{ selectedEntry.fromVersion }}</span>
            </DetailField>
            <DetailField v-if="selectedEntry.toVersion" label="To Version" mono>
              <span class="break-all">{{ selectedEntry.toVersion }}</span>
            </DetailField>
            <DetailField v-if="selectedEntry.triggerName" label="Trigger" mono>{{ selectedEntry.triggerName }}</DetailField>
            <DetailField v-if="selectedEntry.details" label="Details" mono>
              <span class="break-all">{{ selectedEntry.details }}</span>
            </DetailField>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
