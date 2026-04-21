<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import AppBadge from '@/components/AppBadge.vue';
import AppIconButton from '@/components/AppIconButton.vue';
import { useBreakpoints } from '@/composables/useBreakpoints';
import type { DashboardUpdateSequenceEntry, RecentUpdateRow, UpdateKind } from '../dashboardTypes';

const { isMobile } = useBreakpoints();

const tableColumns = computed(() =>
  isMobile.value
    ? [
        { key: 'container', label: 'Container', sortable: false, width: '55%' },
        { key: 'version', label: 'Version', sortable: false, align: 'text-center', width: '22%' },
        { key: 'type', label: '', sortable: false, width: '11%' },
        { key: 'actions', label: '', sortable: false, align: 'text-center', width: '12%' },
      ]
    : [
        { key: 'icon', label: '', icon: true, width: '6%' },
        { key: 'container', label: 'Container', sortable: false, width: '38%' },
        { key: 'version', label: 'Version', sortable: false, align: 'text-center', width: '28%' },
        { key: 'type', label: 'Type', sortable: false, width: '16%' },
        { key: 'actions', label: 'Actions', sortable: false, align: 'text-center', width: '12%' },
      ],
);

interface Props {
  dashboardUpdateAllInProgress: boolean;
  dashboardUpdateError: string | null;
  dashboardUpdateInProgress: string | null;
  dashboardUpdatingById: Map<string, true>;
  dashboardUpdateSequence: Map<string, DashboardUpdateSequenceEntry>;
  editMode: boolean;
  getUpdateKindColor: (kind: UpdateKind | null) => string;
  getUpdateKindIcon: (kind: UpdateKind | null) => string;
  getUpdateKindMutedColor: (kind: UpdateKind | null) => string;
  pendingUpdatesCount: number;
  recentUpdates: RecentUpdateRow[];
}

const props = defineProps<Props>();

const dashboardUpdateSequenceHeadPosition = computed<number | null>(() => {
  let headPosition: number | null = null;
  for (const sequence of props.dashboardUpdateSequence.values()) {
    if (headPosition === null || sequence.position < headPosition) {
      headPosition = sequence.position;
    }
  }
  return headPosition;
});

const isDashboardBulkUpdateLocked = computed(
  () =>
    props.dashboardUpdateAllInProgress ||
    props.dashboardUpdateSequence.size > 0 ||
    props.recentUpdates.some((row) => row.status === 'queued' || row.status === 'updating'),
);

function getDashboardRecentUpdateRowKey(row: Record<string, unknown>) {
  const id = row.id as string | undefined;
  const name = row.name as string | undefined;
  return id || name;
}

function getRowSequence(row: Record<string, unknown>) {
  const key = getDashboardRecentUpdateRowKey(row);
  return key ? props.dashboardUpdateSequence.get(key) : undefined;
}

function getRowUpdateState(row: Record<string, unknown>): 'queued' | 'updating' | null {
  const localSequence = getRowSequence(row);
  if (localSequence) {
    return dashboardUpdateSequenceHeadPosition.value === localSequence.position
      ? 'updating'
      : 'queued';
  }

  const status = row.status as string | undefined;
  if (status === 'queued' || status === 'updating') {
    return status;
  }

  const id = row.id as string;
  if (
    status === 'updating' ||
    props.dashboardUpdateInProgress === id ||
    props.dashboardUpdatingById.has(id)
  ) {
    return 'updating';
  }

  return null;
}

function isRowUpdating(row: Record<string, unknown>): boolean {
  return getRowUpdateState(row) === 'updating';
}

function isRowQueued(row: Record<string, unknown>): boolean {
  return getRowUpdateState(row) === 'queued';
}

function getRowUpdateLabel(row: Record<string, unknown>): string {
  const updateState = getRowUpdateState(row);
  if (!updateState) {
    return '';
  }

  return updateState === 'queued' ? 'Queued' : 'Updating';
}

function getRowClass(row: Record<string, unknown>): string {
  if (isRowUpdating(row) || isRowQueued(row)) {
    return 'opacity-50 pointer-events-none transition-opacity duration-300';
  }
  return '';
}

const emit = defineEmits<{
  confirmUpdate: [row: RecentUpdateRow];
  confirmUpdateAll: [];
  viewAll: [];
}>();

function handleConfirmUpdate(row: RecentUpdateRow) {
  emit('confirmUpdate', row);
}

function handleConfirmUpdateAll() {
  emit('confirmUpdateAll');
}

function handleViewAll() {
  emit('viewAll');
}

const rootEl = ref<HTMLElement | null>(null);
const containerHeight = ref(999);

let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!rootEl.value) return;
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      containerHeight.value = entry.contentRect.height;
    }
  });
  observer.observe(rootEl.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
});

// Progressive collapse thresholds
const showHeader = ref(true);

watchEffect(() => {
  const h = containerHeight.value;
  showHeader.value = h >= 200;
});
</script>

<template>
  <div
    ref="rootEl"
    aria-label="Updates Available widget"
    class="dashboard-widget xl:col-span-2 dd-rounded overflow-hidden min-w-0 flex flex-col"
    :style="{ backgroundColor: 'var(--dd-bg-card)' }">

    <!-- Header — hides when compact -->
    <div v-if="showHeader" class="shrink-0 flex items-center justify-between px-3 py-2.5 sm:px-5 sm:py-3.5" :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="editMode" class="drag-handle dd-drag-handle" v-tooltip.top="'Drag to reorder'"><AppIcon name="ph:dots-six-vertical" :size="14" /></div>
        <AppIcon name="recent-updates" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">
          Updates Available
        </h2>
      </div>
      <div class="flex items-center gap-3">
        <AppButton
          v-if="pendingUpdatesCount > 0"
          data-test="dashboard-update-all-btn"
          size="none"
          variant="plain"
          weight="none"
          type="button"
          class="inline-flex items-center justify-center px-2 py-1 dd-rounded border text-2xs font-semibold transition-colors"
          :class="isDashboardBulkUpdateLocked
            ? 'dd-text-muted cursor-not-allowed opacity-60'
            : 'dd-text hover:dd-bg-elevated'"
          :disabled="isDashboardBulkUpdateLocked"
          @click="handleConfirmUpdateAll">
          <AppIcon
            :name="dashboardUpdateAllInProgress ? 'spinner' : 'cloud-download'"
            :size="11"
            class="mr-1"
            :class="dashboardUpdateAllInProgress ? 'dd-spin' : ''" />
          Update all
        </AppButton>
        <AppButton
          size="none"
          variant="link-secondary"
          weight="medium"
          type="button"
          class="text-2xs-plus font-medium text-drydock-secondary hover:underline"
          @click="handleViewAll">
          View all &rarr;
        </AppButton>
      </div>
    </div>

    <!-- Full view: error banner + data table -->
    <template v-if="showHeader">
      <div
        v-if="dashboardUpdateError"
        data-test="dashboard-update-error"
        class="mx-3 sm:mx-5 mt-3 px-3 py-2 text-2xs-plus dd-rounded"
        :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
        {{ dashboardUpdateError }}
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain dd-scroll-stable" :class="{ 'mobile-updates-table': isMobile }">
        <DataTable
          :columns="tableColumns"
          :rows="recentUpdates"
          row-key="id"
          :row-class="getRowClass"
          fixed-layout
          compact>
          <template #cell-icon="{ row }">
            <AppIcon
              v-if="isRowUpdating(row)"
              name="spinner"
              :size="18"
              class="dd-spin dd-text-muted" />
            <ContainerIcon v-else :icon="row.icon" :size="28" />
          </template>

          <template #cell-container="{ row }">
            <div class="flex items-start gap-2">
              <div v-if="isMobile" class="shrink-0 mt-0.5">
                <AppIcon v-if="isRowUpdating(row)" name="spinner" :size="16" class="dd-spin dd-text-muted" />
                <AppIcon v-else-if="isRowQueued(row)" name="clock" :size="16" class="dd-text-muted" />
                <ContainerIcon v-else :icon="row.icon" :size="20" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <div class="font-medium dd-text leading-tight truncate">{{ row.name }}</div>
                  <AppBadge
                    v-if="isRowUpdating(row)"
                    size="xs"
                    :custom="{ bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' }">
                    <AppIcon name="spinner" :size="12" class="mr-1 dd-spin" />
                    {{ getRowUpdateLabel(row) }}
                  </AppBadge>
                  <AppBadge
                    v-else-if="isRowQueued(row)"
                    size="xs"
                    :custom="{ bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' }">
                    <AppIcon name="clock" :size="12" class="mr-1" />
                    {{ getRowUpdateLabel(row) }}
                  </AppBadge>
                </div>
                <div class="text-2xs dd-text-muted mt-0.5 truncate">{{ row.image }}</div>
                <div v-if="row.registryError" class="text-2xs mt-0.5 truncate" style="color: var(--dd-danger);">
                  {{ row.registryError }}
                </div>
                <a
                  v-if="row.releaseLink"
                  :href="row.releaseLink"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-2xs mt-0.5 inline-flex underline hover:no-underline"
                  style="color: var(--dd-info);">
                  Release notes
                </a>
              </div>
            </div>
          </template>

          <template #cell-version="{ row }">
            <div class="hidden sm:flex items-center justify-center gap-1.5 min-w-0">
              <CopyableTag :tag="row.oldVer" class="text-2xs-plus dd-text-secondary truncate max-w-[100px]">
                {{ row.oldVer }}
              </CopyableTag>
              <AppIcon name="arrow-right" :size="8" class="dd-text-muted shrink-0" />
              <CopyableTag
                :tag="row.newVer"
                class="text-2xs-plus font-semibold truncate max-w-[120px]"
                :style="{ color: getUpdateKindColor(row.updateKind) }">
                {{ row.newVer }}
              </CopyableTag>
            </div>
            <div class="flex sm:hidden flex-col items-center gap-0.5 min-w-0 max-w-full">
              <CopyableTag :tag="row.oldVer" class="text-3xs dd-text-secondary truncate max-w-full leading-tight" v-tooltip.top="row.oldVer">
                {{ row.oldVer }}
              </CopyableTag>
              <CopyableTag
                :tag="row.newVer"
                class="text-3xs font-semibold truncate max-w-full leading-tight"
                :style="{ color: getUpdateKindColor(row.updateKind) }"
                v-tooltip.top="row.newVer">
                {{ row.newVer }}
              </CopyableTag>
            </div>
          </template>

          <template #cell-type="{ row }">
            <AppBadge
              v-tooltip.top="row.updateKind ?? 'unknown'"
              size="xs"
              class="px-1.5 py-0 sm:!hidden"
              :custom="{
                bg: getUpdateKindMutedColor(row.updateKind),
                text: getUpdateKindColor(row.updateKind),
              }">
              <AppIcon :name="getUpdateKindIcon(row.updateKind)" :size="12" />
            </AppBadge>
            <AppBadge
              v-tooltip.top="row.updateKind ?? 'unknown'"
              size="sm"
              class="max-sm:!hidden"
              :custom="{
                bg: getUpdateKindMutedColor(row.updateKind),
                text: getUpdateKindColor(row.updateKind),
              }">
              <AppIcon :name="getUpdateKindIcon(row.updateKind)" :size="12" class="mr-1" />
              {{ row.updateKind ?? 'unknown' }}
            </AppBadge>
          </template>

          <template #cell-actions="{ row }">
            <div class="flex justify-center">
            <span
              v-if="isRowUpdating(row)"
              class="w-7 h-7 dd-rounded-sm flex items-center justify-center dd-text-muted"
              v-tooltip.top="getRowUpdateLabel(row)">
              <AppIcon name="spinner" :size="14" class="dd-spin" />
            </span>
            <span
              v-else-if="isRowQueued(row)"
              class="w-7 h-7 dd-rounded-sm flex items-center justify-center dd-text-muted"
              v-tooltip.top="getRowUpdateLabel(row)">
              <AppIcon name="clock" :size="14" />
            </span>
            <span
              v-else-if="row.blocked"
              class="w-7 h-7 dd-rounded-sm flex items-center justify-center dd-text-muted opacity-60 cursor-not-allowed"
              v-tooltip.top="'Security blocked'">
              <AppIcon name="lock" :size="14" />
            </span>
            <AppIconButton
              v-else-if="row.status === 'pending'"
              icon="cloud-download"
              size="toolbar"
              variant="plain"
              data-test="dashboard-update-btn"
              class="dd-rounded-sm transition-colors"
              :class="dashboardUpdateInProgress === row.id
                ? 'dd-text-muted opacity-50 cursor-not-allowed'
                : 'dd-text-muted hover:dd-text-success hover:dd-bg-elevated'"
              :disabled="dashboardUpdateInProgress === row.id"
              :loading="dashboardUpdateInProgress === row.id"
              tooltip="Update container"
              aria-label="Update container"
              @click.stop="handleConfirmUpdate(row)" />
            </div>
          </template>

          <template #empty>
            <div class="px-4 py-6 text-center text-2xs-plus dd-text-muted">
              No updates available
            </div>
          </template>
        </DataTable>
      </div>
    </template>

    <!-- Compact: inline summary -->
    <div v-else class="flex-1 min-h-0 flex flex-col items-center justify-center p-4">
      <div v-if="editMode" class="drag-handle dd-drag-handle mb-2" v-tooltip.top="'Drag to reorder'"><AppIcon name="ph:dots-six" :size="14" /></div>
      <div class="flex items-center gap-2 cursor-pointer" @click="handleViewAll">
        <AppIcon name="recent-updates" :size="16" class="text-drydock-secondary" />
        <span class="text-xs font-semibold dd-text">{{ pendingUpdatesCount }} update{{ pendingUpdatesCount === 1 ? '' : 's' }} available</span>
        <AppBadge
          v-if="pendingUpdatesCount > 0"
          tone="warning"
          size="xs">
          {{ pendingUpdatesCount }}
        </AppBadge>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mobile-updates-table :deep(td),
.mobile-updates-table :deep(th) {
  padding-left: 0.5rem !important;
  padding-right: 0.5rem !important;
}
</style>
