<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppBadge from '@/components/AppBadge.vue';
import AppButton from '@/components/AppButton.vue';
import AppIcon from '@/components/AppIcon.vue';
import DataTable from '@/components/DataTable.vue';
import DataViewLayout from '@/components/DataViewLayout.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useToast } from '../composables/useToast';
import {
  type NotificationOutboxEntry,
  type NotificationOutboxEntryStatus,
  type NotificationOutboxStatusCounts,
  deleteOutboxEntry,
  getOutboxEntries,
  retryOutboxEntry,
} from '../services/notification-outbox';
import { errorMessage } from '../utils/error';

const route = useRoute();
const router = useRouter();
const toast = useToast();

const STATUS_TABS: Array<{ key: NotificationOutboxEntryStatus; label: string }> = [
  { key: 'dead-letter', label: 'Dead-letter' },
  { key: 'pending', label: 'Pending' },
  { key: 'delivered', label: 'Delivered' },
];

const VALID_STATUSES: NotificationOutboxEntryStatus[] = ['dead-letter', 'pending', 'delivered'];

function statusFromQuery(value: unknown): NotificationOutboxEntryStatus {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'string' && (VALID_STATUSES as string[]).includes(raw)) {
    return raw as NotificationOutboxEntryStatus;
  }
  return 'dead-letter';
}

const status = ref<NotificationOutboxEntryStatus>(statusFromQuery(route.query.status));
const entries = ref<NotificationOutboxEntry[]>([]);
const counts = ref<NotificationOutboxStatusCounts>({
  pending: 0,
  delivered: 0,
  deadLetter: 0,
});
const loading = ref(true);
const error = ref('');
const actingId = ref<string | null>(null);

const tableColumns = computed(() => [
  { key: 'eventName', label: 'Event', sortable: false, width: '20%' },
  { key: 'triggerId', label: 'Trigger', sortable: false, width: '20%' },
  { key: 'attempts', label: 'Attempts', sortable: false, width: '8%' },
  { key: 'lastError', label: 'Last error', sortable: false, width: '32%' },
  { key: 'createdAt', label: 'Created', sortable: false, width: '12%' },
  { key: 'actions', label: '', sortable: false, width: '8%' },
]);

function statusToCount(s: NotificationOutboxEntryStatus): number {
  if (s === 'pending') return counts.value.pending;
  if (s === 'delivered') return counts.value.delivered;
  return counts.value.deadLetter;
}

async function loadEntries() {
  loading.value = true;
  error.value = '';
  try {
    const response = await getOutboxEntries(status.value);
    entries.value = response.data;
    counts.value = response.counts;
  } catch (e: unknown) {
    error.value = errorMessage(e, 'Failed to load notification outbox');
  } finally {
    loading.value = false;
  }
}

watch(
  () => route.query.status,
  (value) => {
    const next = statusFromQuery(value);
    if (next !== status.value) {
      status.value = next;
      loadEntries();
    }
  },
);

function selectStatus(next: NotificationOutboxEntryStatus) {
  if (next === status.value) return;
  router.replace({ query: { ...route.query, status: next } });
}

async function retryEntry(entry: NotificationOutboxEntry) {
  if (actingId.value) return;
  actingId.value = entry.id;
  try {
    await retryOutboxEntry(entry.id);
    toast.success(`Requeued: ${entry.eventName}`);
    await loadEntries();
  } catch (e: unknown) {
    toast.error(errorMessage(e, `Failed to retry ${entry.eventName}`));
  } finally {
    actingId.value = null;
  }
}

async function discardEntry(entry: NotificationOutboxEntry) {
  if (actingId.value) return;
  actingId.value = entry.id;
  try {
    await deleteOutboxEntry(entry.id);
    toast.success(`Discarded: ${entry.eventName}`);
    await loadEntries();
  } catch (e: unknown) {
    toast.error(errorMessage(e, `Failed to discard ${entry.eventName}`));
  } finally {
    actingId.value = null;
  }
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusBadge(s: NotificationOutboxEntryStatus): {
  tone: 'danger' | 'warning' | 'success';
  label: string;
} {
  if (s === 'dead-letter') return { tone: 'danger', label: 'Dead-letter' };
  if (s === 'pending') return { tone: 'warning', label: 'Pending' };
  return { tone: 'success', label: 'Delivered' };
}

onMounted(() => {
  loadEntries();
});
</script>

<template>
  <DataViewLayout>
    <div class="mb-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <h2 class="text-base font-semibold dd-text">Notification outbox</h2>
        <span class="text-xs dd-text-muted">{{ entries.length }} of {{ statusToCount(status) }}</span>
      </div>
      <AppButton size="xs" variant="text-muted" weight="medium" :disabled="loading" @click="loadEntries">
        <AppIcon name="refresh" :size="14" class="mr-1" /> Refresh
      </AppButton>
    </div>

    <div class="mb-3 flex flex-wrap items-center gap-2">
      <button v-for="tab in STATUS_TABS" :key="tab.key" type="button"
              class="px-3 py-1.5 text-2xs-plus font-medium dd-rounded transition-colors"
              :class="status === tab.key ? 'dd-bg-elevated dd-text' : 'dd-text-muted hover:dd-text'"
              @click="selectStatus(tab.key)">
        {{ tab.label }}
        <AppBadge :tone="statusBadge(tab.key).tone" size="xs" class="ml-2">
          {{ statusToCount(tab.key) }}
        </AppBadge>
      </button>
    </div>

    <div v-if="error"
         class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">Loading outbox entries…</div>

    <DataTable v-if="!loading" :columns="tableColumns" :rows="entries" row-key="id">
      <template #cell-eventName="{ row }">
        <span class="font-medium dd-text">{{ row.eventName }}</span>
      </template>
      <template #cell-triggerId="{ row }">
        <span class="text-2xs-plus dd-text">{{ row.triggerId }}</span>
        <span v-if="row.containerId" class="block text-2xs dd-text-muted truncate">{{ row.containerId }}</span>
      </template>
      <template #cell-attempts="{ row }">
        <AppBadge :tone="row.attempts >= row.maxAttempts ? 'danger' : 'warning'" size="xs">
          {{ row.attempts }} / {{ row.maxAttempts }}
        </AppBadge>
      </template>
      <template #cell-lastError="{ row }">
        <span class="text-2xs dd-text-muted truncate" :title="row.lastError">{{ row.lastError ?? '—' }}</span>
      </template>
      <template #cell-createdAt="{ row }">
        <span class="text-2xs dd-text-muted">{{ formatTimestamp(row.createdAt) }}</span>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex items-center justify-end gap-1">
          <AppButton v-if="row.status === 'dead-letter'" size="xs" variant="primary" weight="medium"
                     :disabled="actingId === row.id" @click.stop="retryEntry(row)">
            Retry
          </AppButton>
          <AppButton size="xs" variant="text-muted" weight="medium" :disabled="actingId === row.id"
                     @click.stop="discardEntry(row)">
            Discard
          </AppButton>
        </div>
      </template>
      <template #empty>
        <EmptyState icon="notifications" :message="`No ${status} entries`" />
      </template>
    </DataTable>
  </DataViewLayout>
</template>
