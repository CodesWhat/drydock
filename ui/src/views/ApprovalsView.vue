<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import AppBadge from '@/components/AppBadge.vue';
import AppButton from '@/components/AppButton.vue';
import AppIcon from '@/components/AppIcon.vue';
import AppIconButton from '@/components/AppIconButton.vue';
import DataTable, { type DataTableColumn } from '@/components/DataTable.vue';
import DataViewLayout from '@/components/DataViewLayout.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { isTextEntryTarget } from '@/composables/useKeyboardShortcuts';
import { useToast } from '@/composables/useToast';
import { useUpdateMode } from '@/composables/useUpdateMode';
import { getContainerReleaseNotes } from '@/services/container';
import {
  approveApproval,
  deferApproval,
  getApproval,
  getApprovalSummary,
  listApprovals,
  rejectApproval,
  type ApprovalHoldReason,
  type ApprovalRecord,
  type ApprovalStatusFilter,
  type ApprovalSummary,
} from '@/services/approval';
import type { ContainerReleaseNotes } from '@/types/container';
import { timeAgo } from '@/utils/audit-helpers';
import { errorMessage } from '@/utils/error';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const confirm = useConfirmDialog();
const { t, locale } = useI18n();
const { updateMode } = useUpdateMode();

const APPROVAL_DEFER_DAYS = 7;

const STATUS_TABS: Array<{ key: ApprovalStatusFilter }> = [
  { key: 'pending' },
  { key: 'deferred' },
  { key: 'decided' },
];

const VALID_STATUSES: ApprovalStatusFilter[] = ['pending', 'deferred', 'decided', 'all'];

function statusFromQuery(value: unknown): ApprovalStatusFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'string' && (VALID_STATUSES as string[]).includes(raw)) {
    return raw as ApprovalStatusFilter;
  }
  return 'pending';
}

const status = ref<ApprovalStatusFilter>(statusFromQuery(route.query.status));
const approvals = ref<ApprovalRecord[]>([]);
const summary = ref<ApprovalSummary>({ pending: 0, deferred: 0, decidedToday: 0 });
const loading = ref(true);
const error = ref('');
const actingId = ref<string | null>(null);
const expandedId = ref<string | null>(null);
const focusedId = ref<string | null>(null);
const releaseNotesById = ref<Record<string, ContainerReleaseNotes | null>>({});
const holdReasonsById = ref<Record<string, ApprovalHoldReason[]>>({});
const detailLoadingId = ref<string | null>(null);
let loadRequestId = 0;

const isNotifyMode = computed(() => updateMode.value === 'notify');

interface DetailRow {
  __kind: 'detail';
  __key: string;
  approvalId: string;
}
type TableRow = ApprovalRecord | DetailRow;

function isDetailRow(row: Record<string, unknown>): row is DetailRow {
  return row.__kind === 'detail';
}

const tableRows = computed<TableRow[]>(() => {
  const rows: TableRow[] = [];
  for (const approval of approvals.value) {
    rows.push(approval);
    if (expandedId.value === approval.id) {
      rows.push({ __kind: 'detail', __key: `${approval.id}-detail`, approvalId: approval.id });
    }
  }
  return rows;
});

function rowKey(row: Record<string, unknown>): string {
  return isDetailRow(row) ? row.__key : (row as ApprovalRecord).id;
}

const tableColumns = computed<DataTableColumn[]>(() => [
  {
    key: 'containerName',
    label: t('approvalsView.columns.container'),
    sortable: false,
    size: 220,
    minSize: 160,
    maxSize: 320,
    align: 'text-left',
    cardTitle: true,
  },
  {
    key: 'image',
    label: t('approvalsView.columns.image'),
    sortable: false,
    size: 240,
    minSize: 160,
    maxSize: 360,
    align: 'text-left',
  },
  {
    key: 'version',
    label: t('approvalsView.columns.version'),
    sortable: false,
    size: 220,
    minSize: 160,
    maxSize: 320,
    align: 'text-left',
  },
  {
    key: 'scan',
    label: t('approvalsView.columns.scan'),
    sortable: false,
    size: 120,
    minSize: 90,
    maxSize: 160,
  },
  {
    key: 'age',
    label: t('approvalsView.columns.age'),
    sortable: false,
    size: 110,
    minSize: 90,
    maxSize: 150,
  },
]);

function statusToCount(s: ApprovalStatusFilter): number {
  if (s === 'pending') return summary.value.pending;
  if (s === 'deferred') return summary.value.deferred;
  return summary.value.decidedToday;
}

async function loadSummary() {
  try {
    summary.value = await getApprovalSummary();
  } catch {
    // Non-fatal: tab counts stay stale rather than blocking the list.
  }
}

async function loadApprovals() {
  const requestId = ++loadRequestId;
  loading.value = true;
  error.value = '';
  try {
    const response = await listApprovals({ status: status.value });
    if (requestId !== loadRequestId) return;
    approvals.value = response.data;
  } catch (e: unknown) {
    if (requestId !== loadRequestId) return;
    error.value = errorMessage(e, t('approvalsView.loadError'));
  } finally {
    if (requestId === loadRequestId) {
      loading.value = false;
    }
  }
}

async function refresh() {
  await Promise.all([loadApprovals(), loadSummary()]);
}

watch(
  () => route.query.status,
  (value) => {
    const next = statusFromQuery(value);
    if (next !== status.value) {
      status.value = next;
      loadApprovals();
    }
  },
);

function selectStatus(next: ApprovalStatusFilter) {
  if (next === status.value) return;
  router.replace({ query: { ...route.query, status: next } });
}

async function ensureDetailLoaded(approval: ApprovalRecord) {
  if (holdReasonsById.value[approval.id] !== undefined) return;
  detailLoadingId.value = approval.id;
  try {
    const [detail, notes] = await Promise.all([
      getApproval(approval.id).catch(() => undefined),
      getContainerReleaseNotes(approval.containerId).catch(() => null),
    ]);
    holdReasonsById.value = {
      ...holdReasonsById.value,
      [approval.id]: detail?.holdReasons ?? [],
    };
    releaseNotesById.value = {
      ...releaseNotesById.value,
      [approval.id]: (notes as ContainerReleaseNotes | null) ?? null,
    };
  } finally {
    if (detailLoadingId.value === approval.id) {
      detailLoadingId.value = null;
    }
  }
}

function toggleExpanded(approval: ApprovalRecord) {
  if (expandedId.value === approval.id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = approval.id;
  void ensureDetailLoaded(approval);
}

async function getHoldReasons(approval: ApprovalRecord): Promise<ApprovalHoldReason[]> {
  if (holdReasonsById.value[approval.id] !== undefined) {
    return holdReasonsById.value[approval.id];
  }
  try {
    const detail = await getApproval(approval.id);
    holdReasonsById.value = { ...holdReasonsById.value, [approval.id]: detail.holdReasons };
    return detail.holdReasons;
  } catch {
    return [];
  }
}

function semverTone(diff: string): 'danger' | 'warning' | 'success' | 'caution' | 'neutral' {
  if (diff === 'major') return 'danger';
  if (diff === 'minor') return 'warning';
  if (diff === 'patch') return 'success';
  if (diff === 'prerelease') return 'caution';
  return 'neutral';
}

function scanTone(approval: ApprovalRecord): 'danger' | 'warning' | 'neutral' {
  if ((approval.scanCritical ?? 0) > 0) return 'danger';
  if ((approval.scanHigh ?? 0) > 0) return 'warning';
  return 'neutral';
}

function hasScanData(approval: ApprovalRecord): boolean {
  return (
    approval.scanCritical !== undefined ||
    approval.scanHigh !== undefined ||
    approval.scanMedium !== undefined ||
    approval.scanLow !== undefined
  );
}

async function approveRow(approval: ApprovalRecord) {
  if (actingId.value) return;
  actingId.value = approval.id;
  try {
    await approveApproval(approval.id);
    toast.success(t('approvalsView.toast.approved', { name: approval.containerName }));
    expandedId.value = null;
    await refresh();
  } catch (e: unknown) {
    toast.error(
      errorMessage(e, t('approvalsView.toast.approveFailed', { name: approval.containerName })),
    );
  } finally {
    actingId.value = null;
  }
}

async function rejectRow(approval: ApprovalRecord) {
  if (actingId.value) return;
  actingId.value = approval.id;
  try {
    await rejectApproval(approval.id);
    toast.success(t('approvalsView.toast.rejected', { name: approval.containerName }));
    expandedId.value = null;
    await refresh();
  } catch (e: unknown) {
    toast.error(
      errorMessage(e, t('approvalsView.toast.rejectFailed', { name: approval.containerName })),
    );
  } finally {
    actingId.value = null;
  }
}

async function deferRow(approval: ApprovalRecord) {
  if (actingId.value) return;
  actingId.value = approval.id;
  try {
    await deferApproval(approval.id, { days: APPROVAL_DEFER_DAYS });
    toast.success(t('approvalsView.toast.deferred', { name: approval.containerName }));
    expandedId.value = null;
    await refresh();
  } catch (e: unknown) {
    toast.error(
      errorMessage(e, t('approvalsView.toast.deferFailed', { name: approval.containerName })),
    );
  } finally {
    actingId.value = null;
  }
}

async function confirmApprove(approval: ApprovalRecord) {
  const holdReasons = await getHoldReasons(approval);
  let message = t('approvalsView.confirm.approve.message', {
    name: approval.containerName,
    toRef: approval.toRef,
  });
  if (holdReasons.length > 0) {
    const list = holdReasons.map((reason) => `• ${reason.message}`).join('\n');
    message = `${message}${t('approvalsView.confirm.approve.softBlockerSuffix', { list })}`;
  }
  confirm.require({
    header: t('approvalsView.confirm.approve.header'),
    message,
    rejectLabel: t('approvalsView.confirm.cancel'),
    acceptLabel: t('approvalsView.confirm.approve.acceptLabel'),
    severity: 'warn',
    accept: () => approveRow(approval),
  });
}

function confirmReject(approval: ApprovalRecord) {
  confirm.require({
    header: t('approvalsView.confirm.reject.header'),
    message: t('approvalsView.confirm.reject.message', {
      name: approval.containerName,
      toRef: approval.toRef,
    }),
    rejectLabel: t('approvalsView.confirm.cancel'),
    acceptLabel: t('approvalsView.confirm.reject.acceptLabel'),
    severity: 'warn',
    accept: () => rejectRow(approval),
  });
}

function confirmDefer(approval: ApprovalRecord) {
  confirm.require({
    header: t('approvalsView.confirm.defer.header'),
    message: t('approvalsView.confirm.defer.message', {
      name: approval.containerName,
      days: APPROVAL_DEFER_DAYS,
    }),
    rejectLabel: t('approvalsView.confirm.cancel'),
    acceptLabel: t('approvalsView.confirm.defer.acceptLabel'),
    severity: 'warn',
    accept: () => deferRow(approval),
  });
}

function formatAge(approval: ApprovalRecord): string {
  return timeAgo(approval.createdAt, locale.value, t);
}

function focusableRows(): ApprovalRecord[] {
  return approvals.value;
}

function moveFocus(delta: number) {
  const rows = focusableRows();
  if (rows.length === 0) return;
  const currentIndex = rows.findIndex((row) => row.id === focusedId.value);
  const nextIndex =
    currentIndex === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, currentIndex + delta));
  focusedId.value = rows[nextIndex].id;
}

function focusedRow(): ApprovalRecord | undefined {
  return approvals.value.find((row) => row.id === focusedId.value);
}

function handleKeydown(event: KeyboardEvent) {
  if (isTextEntryTarget(event.target)) return;
  if (route.path !== '/approvals') return;
  if (event.key === 'j') {
    event.preventDefault();
    moveFocus(1);
    return;
  }
  if (event.key === 'k') {
    event.preventDefault();
    moveFocus(-1);
    return;
  }
  const row = focusedRow();
  if (!row) return;
  if (event.key === 'a' && !isNotifyMode.value) {
    event.preventDefault();
    void confirmApprove(row);
    return;
  }
  if (event.key === 'r') {
    event.preventDefault();
    confirmReject(row);
    return;
  }
  if (event.key === 'd') {
    event.preventDefault();
    confirmDefer(row);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    toggleExpanded(row);
  }
}

function handleApprovalSseEvent() {
  void refresh();
}

onMounted(() => {
  loadApprovals();
  loadSummary();
  globalThis.addEventListener('keydown', handleKeydown);
  globalThis.addEventListener('dd:sse-approval-created', handleApprovalSseEvent);
  globalThis.addEventListener('dd:sse-approval-decided', handleApprovalSseEvent);
  globalThis.addEventListener('dd:sse-approval-resolved', handleApprovalSseEvent);
});

onUnmounted(() => {
  globalThis.removeEventListener('keydown', handleKeydown);
  globalThis.removeEventListener('dd:sse-approval-created', handleApprovalSseEvent);
  globalThis.removeEventListener('dd:sse-approval-decided', handleApprovalSseEvent);
  globalThis.removeEventListener('dd:sse-approval-resolved', handleApprovalSseEvent);
});
</script>

<template>
  <DataViewLayout>
    <div class="mb-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <h2 class="text-base font-semibold dd-text">{{ t('appShell.layout.nav.approvals') }}</h2>
        <span class="text-xs dd-text-muted">{{ t('approvalsView.ofCount', { count: approvals.length }) }}</span>
      </div>
      <AppButton size="xs" variant="text-muted" weight="medium" :disabled="loading" @click="refresh">
        <AppIcon name="refresh" :size="14" class="mr-1" /> {{ t('approvalsView.refresh') }}
      </AppButton>
    </div>

    <div class="mb-3 flex flex-wrap items-center gap-2">
      <AppButton v-for="tab in STATUS_TABS" :key="tab.key" type="button" size="md" weight="medium"
                 :variant="status === tab.key ? 'elevated' : 'text-muted'"
                 @click="selectStatus(tab.key)">
        {{ t(`approvalsView.tabs.${tab.key}`) }}
        <AppBadge tone="neutral" size="xs" class="ml-2">
          {{ statusToCount(tab.key) }}
        </AppBadge>
      </AppButton>
    </div>

    <div v-if="isNotifyMode"
         class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
         :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
      {{ t('approvalsView.notifyModeBanner') }}
    </div>

    <div v-if="error"
         class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">{{ t('approvalsView.loading') }}</div>

    <DataTable
      v-if="!loading"
      :columns="tableColumns"
      storage-key="approvals"
      :rows="tableRows"
      :row-key="rowKey"
      :fixed-layout="true"
      :show-actions="true"
      actions-width="260px"
      :full-width-row="(row) => isDetailRow(row)"
      :row-class="(row) => (row.id === focusedId ? 'dd-data-table-row-selected' : '')"
    >
      <template #cell-containerName="{ row }">
        <span data-testid="approval-container-name" class="block min-w-0 truncate whitespace-nowrap font-semibold text-2xs-plus dd-text" :title="row.containerName">
          {{ row.containerName }}
        </span>
        <span class="block min-w-0 truncate whitespace-nowrap text-2xs dd-text-muted">
          {{ row.agent || row.watcher }}
        </span>
      </template>
      <template #cell-image="{ row }">
        <span class="block min-w-0 truncate whitespace-nowrap font-mono text-2xs-plus dd-text" :title="row.image">
          {{ row.image }}
        </span>
      </template>
      <template #cell-version="{ row }">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="truncate font-mono text-2xs-plus dd-text-muted" :title="row.fromRef">{{ row.fromRef }}</span>
          <AppIcon name="arrow-right" :size="10" class="shrink-0 dd-text-muted" />
          <span class="truncate font-mono text-2xs-plus dd-text" :title="row.toRef">{{ row.toRef }}</span>
          <AppBadge :tone="semverTone(row.semverDiff)" size="xs" class="shrink-0">
            {{ t(`approvalsView.semver.${row.semverDiff}`) }}
          </AppBadge>
        </div>
      </template>
      <template #cell-scan="{ row }">
        <AppBadge v-if="hasScanData(row)" :tone="scanTone(row)" size="xs">
          {{ (row.scanCritical ?? 0) + (row.scanHigh ?? 0) }}
        </AppBadge>
        <span v-else class="text-2xs dd-text-muted">—</span>
      </template>
      <template #cell-age="{ row }">
        <span class="block whitespace-nowrap text-2xs dd-text-muted">
          {{ formatAge(row) }}
        </span>
      </template>
      <template #actions="{ row }">
        <div class="flex items-center justify-end gap-1 whitespace-nowrap">
          <AppIconButton
            icon="file-text"
            size="sm"
            variant="muted"
            :tooltip="t('approvalsView.actions.notesAriaLabel')"
            :aria-label="t('approvalsView.actions.notesAriaLabel')"
            :aria-expanded="String(expandedId === row.id)"
            data-testid="approval-expand-toggle"
            @click.stop="toggleExpanded(row)"
          />
          <AppButton
            size="sm"
            variant="success-subtle"
            weight="bold"
            class="inline-flex min-w-[74px] items-center justify-center gap-1 whitespace-nowrap"
            :disabled="actingId === row.id || isNotifyMode"
            :title="isNotifyMode ? t('approvalsView.actions.approveDisabledNotify') : undefined"
            :aria-label="t('approvalsView.actions.approveAriaLabel')"
            @click.stop="confirmApprove(row)"
          >
            <AppIcon name="check" :size="12" />
            {{ t('approvalsView.actions.approve') }}
          </AppButton>
          <AppButton
            size="sm"
            variant="danger-subtle"
            weight="bold"
            class="inline-flex min-w-[74px] items-center justify-center gap-1 whitespace-nowrap"
            :disabled="actingId === row.id"
            :aria-label="t('approvalsView.actions.rejectAriaLabel')"
            @click.stop="confirmReject(row)"
          >
            <AppIcon name="xmark" :size="12" />
            {{ t('approvalsView.actions.reject') }}
          </AppButton>
          <AppButton
            size="sm"
            variant="text-muted"
            weight="bold"
            class="inline-flex min-w-[74px] items-center justify-center gap-1 whitespace-nowrap"
            :disabled="actingId === row.id"
            :aria-label="t('approvalsView.actions.deferAriaLabel')"
            @click.stop="confirmDefer(row)"
          >
            <AppIcon name="clock" :size="12" />
            {{ t('approvalsView.actions.defer') }}
          </AppButton>
        </div>
      </template>
      <template #full-row="{ row }">
        <div class="px-5 py-3 space-y-2" :style="{ backgroundColor: 'var(--dd-bg-inset)' }" data-testid="approval-detail-row">
          <div v-if="detailLoadingId === row.approvalId" class="text-2xs dd-text-muted">
            {{ t('approvalsView.detail.loading') }}
          </div>
          <template v-else>
            <div v-if="holdReasonsById[row.approvalId].length > 0" class="space-y-1" data-testid="approval-hold-reasons">
              <div class="text-2xs-plus font-semibold dd-text-secondary">{{ t('approvalsView.detail.holdReasons') }}</div>
              <div v-for="reason in holdReasonsById[row.approvalId]" :key="reason.reason" class="text-2xs dd-text-muted">
                {{ reason.message }}
              </div>
            </div>
            <div v-if="releaseNotesById[row.approvalId]" class="space-y-1" data-testid="approval-release-notes">
              <div class="text-2xs-plus font-semibold dd-text">{{ releaseNotesById[row.approvalId]?.title }}</div>
              <p class="text-2xs dd-text-muted whitespace-pre-line break-words">{{ releaseNotesById[row.approvalId]?.body }}</p>
              <a
                :href="releaseNotesById[row.approvalId]?.url"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-2xs underline hover:no-underline dd-text-info"
              >
                {{ t('approvalsView.detail.viewFullNotes') }}
                <AppIcon name="external-link" :size="10" />
              </a>
            </div>
            <div v-if="!releaseNotesById[row.approvalId] && holdReasonsById[row.approvalId].length === 0" class="text-2xs dd-text-muted">
              {{ t('approvalsView.detail.empty') }}
            </div>
          </template>
        </div>
      </template>
      <template #empty>
        <EmptyState icon="updates" :message="t(`approvalsView.empty.${status}`)" />
      </template>
    </DataTable>
  </DataViewLayout>
</template>
