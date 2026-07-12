<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIconButton from '@/components/AppIconButton.vue';
import AppStatusIndicator from '@/components/AppStatusIndicator.vue';
import ProjectLink from '@/components/containers/ProjectLink.vue';
import ReleaseNotesLink from '@/components/containers/ReleaseNotesLink.vue';
import { useBreakpoints } from '@/composables/useBreakpoints';
import type { DashboardUpdateSequenceEntry, RecentUpdateRow, UpdateKind } from '../dashboardTypes';

const { t } = useI18n();
const { isMobile } = useBreakpoints();

const tableColumns = computed(() =>
  isMobile.value
    ? [
        {
          key: 'container',
          label: t('dashboardView.recentUpdates.columns.container'),
          sortable: false,
          size: 240,
          minSize: 170,
          maxSize: 420,
          flex: 1,
        },
        {
          key: 'version',
          label: t('dashboardView.recentUpdates.columns.version'),
          sortable: false,
          align: 'text-center',
          size: 150,
          minSize: 120,
          maxSize: 220,
        },
        {
          key: 'type',
          label: t('dashboardView.recentUpdates.columns.type'),
          sortable: false,
          size: 64,
          minSize: 56,
          maxSize: 82,
        },
        {
          key: 'actions',
          label: t('dashboardView.recentUpdates.columns.actions'),
          sortable: false,
          align: 'text-center',
          size: 72,
          minSize: 64,
          maxSize: 90,
        },
      ]
    : [
        {
          key: 'icon',
          label: '',
          icon: true,
          // 52 = 28px ContainerIcon (rendered in the `cell-icon` slot below via
          // <ContainerIcon :icon="row.icon" :size="28" />) + 20px pl-5 padding DataTable
          // hardcodes for icon columns + 4px breathing room. Was 42 until the icon cell gained
          // `overflow-hidden` (commit 9b017a99): a 42-20=22px content box clipped the 28px icon
          // ~6px. Same formula as the Containers icon column fix in useColumnVisibility.ts
          // (56 = 32px icon + 20px + 4px) — this icon is 28px, not 32px, so the total is smaller.
          size: 52,
          minSize: 52,
          maxSize: 52,
        },
        {
          key: 'container',
          label: t('dashboardView.recentUpdates.columns.container'),
          sortable: false,
          size: 260,
          minSize: 180,
          maxSize: 460,
          flex: 1,
        },
        {
          key: 'version',
          label: t('dashboardView.recentUpdates.columns.version'),
          sortable: false,
          align: 'text-center',
          size: 180,
          minSize: 140,
          maxSize: 260,
        },
        {
          key: 'type',
          label: t('dashboardView.recentUpdates.columns.type'),
          sortable: false,
          size: 110,
          minSize: 90,
          maxSize: 150,
        },
        {
          key: 'actions',
          label: t('dashboardView.recentUpdates.columns.actions'),
          sortable: false,
          align: 'text-center',
          size: 90,
          minSize: 76,
          maxSize: 120,
        },
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

function getUpdateKindTone(kind: UpdateKind | null) {
  if (kind === 'major') return 'danger';
  if (kind === 'minor') return 'warning';
  if (kind === 'patch') return 'primary';
  if (kind === 'digest') return 'neutral';
  return 'neutral';
}

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

  return updateState === 'queued'
    ? t('dashboardView.recentUpdates.status.queued')
    : t('dashboardView.recentUpdates.status.updating');
}

function getRowClass(row: Record<string, unknown>): string {
  if (isRowUpdating(row) || isRowQueued(row)) {
    return 'dd-row-updating pointer-events-none transition-opacity duration-300';
  }
  return '';
}

const emit = defineEmits<{
  confirmUpdate: [row: RecentUpdateRow];
  confirmUpdateAll: [];
  viewAll: [];
  openContainer: [row: RecentUpdateRow];
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

function handleRowClick(row: Record<string, unknown>) {
  emit('openContainer', row as RecentUpdateRow);
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

function updateKindLabel(kind?: string): string {
  if (!kind) return t('common.unknown');
  return t(`dashboardView.updateKind.${kind}`);
}

function updateKindInitial(kind?: string): string {
  return updateKindLabel(kind).slice(0, 1);
}
</script>

<template>
  <div
    ref="rootEl"
    :aria-label="t('dashboardView.recentUpdates.widgetAria')"
    class="dashboard-widget xl:col-span-2 dd-rounded overflow-hidden min-w-0 flex flex-col"
    :style="{ backgroundColor: 'var(--dd-bg-card)' }">

    <!-- Header — hides when compact -->
    <div v-if="showHeader" class="shrink-0 flex items-center justify-between px-3 py-2.5 sm:px-5 sm:py-3.5" :style="{ borderBottom: '1px solid var(--dd-border)' }">
      <div class="flex items-center gap-2">
        <div v-if="editMode" class="drag-handle dd-drag-handle" v-tooltip.top="t('dashboardView.dragToReorder')"><AppIcon name="ph:dots-six-vertical" :size="14" /></div>
        <AppIcon name="recent-updates" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">
          {{ t('dashboardView.recentUpdates.title') }}
        </h2>
      </div>
      <div class="flex items-center gap-3">
        <AppButton
          v-if="pendingUpdatesCount > 0"
          data-test="dashboard-update-all-btn"
          size="compact"
          :variant="isDashboardBulkUpdateLocked ? 'muted-subtle' : 'success'"
          weight="semibold"
          type="button"
          class="inline-flex items-center justify-center"
          :class="isDashboardBulkUpdateLocked ? 'cursor-not-allowed' : ''"
          :disabled="isDashboardBulkUpdateLocked"
          @click="handleConfirmUpdateAll">
          <AppIcon
            :name="dashboardUpdateAllInProgress ? 'spinner' : 'cloud-download'"
            :size="11"
            class="mr-1"
            :class="dashboardUpdateAllInProgress ? 'dd-spin' : ''" />
          {{ t('dashboardView.recentUpdates.updateAll') }}
        </AppButton>
        <AppButton
          size="compact"
          variant="link-secondary"
          weight="medium"
          type="button"
          class="text-2xs-plus font-medium text-drydock-secondary hover:underline"
          @click="handleViewAll">
          {{ t('dashboardView.viewAll') }}
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
          storage-key="dashboard-recent-updates"
          :rows="recentUpdates"
          row-key="id"
          :row-class="getRowClass"
          fixed-layout
          compact
          @row-click="handleRowClick">
          <template #cell-icon="{ row }">
            <div
              v-if="isRowUpdating(row) || isRowQueued(row)"
              class="dd-row-overlay absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div
                class="flex items-center gap-2 px-4 py-1.5 dd-rounded text-2xs-plus font-bold uppercase tracking-wider shadow-lg"
                :style="{
                  backgroundColor: 'var(--dd-bg-elevated)',
                  border: '1px solid var(--dd-border)',
                  color: 'var(--dd-text)',
                }">
                <AppIcon
                  :name="isRowQueued(row) && !isRowUpdating(row) ? 'clock' : 'spinner'"
                  :size="14"
                  :class="isRowQueued(row) && !isRowUpdating(row) ? '' : 'dd-spin'" />
                <span>{{ getRowUpdateLabel(row) }}</span>
              </div>
            </div>
            <ContainerIcon :icon="row.icon" :size="28" />
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
                </div>
                <div class="text-2xs dd-text-muted mt-0.5 truncate">{{ row.image }}</div>
                <div v-if="row.registryError" class="text-2xs mt-0.5 truncate" style="color: var(--dd-danger);">
                  {{ row.registryError }}
                </div>
                <ReleaseNotesLink
                  v-if="row.releaseNotes || row.currentReleaseNotes || row.releaseLink"
                  :release-notes="row.releaseNotes"
                  :current-release-notes="row.currentReleaseNotes"
                  :release-link="row.releaseLink"
                  :container-id="row.id"
                  :from-tag="row.oldVer"
                  :to-tag="row.newVer"
                  icon-only
                />
                <ProjectLink
                  v-if="row.sourceRepo"
                  :source-repo="row.sourceRepo"
                  icon-only
                />
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
              <CopyableTag :tag="row.oldVer" class="text-3xs dd-text-secondary truncate max-w-full leading-tight" :idle-tooltip="row.oldVer">
                {{ row.oldVer }}
              </CopyableTag>
              <CopyableTag
                :tag="row.newVer"
                class="text-3xs font-semibold truncate max-w-full leading-tight"
                :style="{ color: getUpdateKindColor(row.updateKind) }"
                :idle-tooltip="row.newVer">
                {{ row.newVer }}
              </CopyableTag>
            </div>
          </template>

          <template #cell-type="{ row }">
            <AppStatusIndicator
              v-tooltip.top="updateKindLabel(row.updateKind)"
              marker="icon"
              :icon="getUpdateKindIcon(row.updateKind)"
              :tone="getUpdateKindTone(row.updateKind)"
              :label="updateKindInitial(row.updateKind)"
              size="xs"
              uppercase
              class="sm:!hidden" />
            <AppStatusIndicator
              v-tooltip.top="updateKindLabel(row.updateKind)"
              marker="icon"
              :icon="getUpdateKindIcon(row.updateKind)"
              :tone="getUpdateKindTone(row.updateKind)"
              :label="updateKindLabel(row.updateKind)"
              size="sm"
              class="max-sm:!hidden" />
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
              v-tooltip.top="t('dashboardView.recentUpdates.securityBlocked')">
              <AppIcon name="lock" :size="14" />
            </span>
            <AppIconButton
              v-else-if="row.status === 'pending' || row.status === 'maturity-blocked'"
              icon="cloud-download"
              size="toolbar"
              :variant="row.status === 'maturity-blocked' ? 'warning' : 'plain'"
              data-test="dashboard-update-btn"
              class="dd-rounded-sm transition-colors"
              :class="
                dashboardUpdateInProgress === row.id
                  ? 'dd-text-muted opacity-50 cursor-not-allowed'
                  : row.status === 'maturity-blocked'
                    ? 'dd-text-warning hover:dd-bg-elevated'
                    : 'dd-text-muted hover:dd-text-success hover:dd-bg-elevated'
              "
              :disabled="dashboardUpdateInProgress === row.id"
              :loading="dashboardUpdateInProgress === row.id"
              :tooltip="t('dashboardView.recentUpdates.updateContainer')"
              :aria-label="t('dashboardView.recentUpdates.updateContainer')"
              @click.stop="handleConfirmUpdate(row)" />
            </div>
          </template>

          <template #empty>
            <div class="px-4 py-6 text-center text-2xs-plus dd-text-muted">
              {{ t('dashboardView.recentUpdates.noUpdates') }}
            </div>
          </template>
        </DataTable>
      </div>
    </template>

    <!-- Compact: inline summary -->
    <div v-else class="flex-1 min-h-0 flex flex-col items-center justify-center p-4">
      <div v-if="editMode" class="drag-handle dd-drag-handle mb-2" v-tooltip.top="t('dashboardView.dragToReorder')"><AppIcon name="ph:dots-six" :size="14" /></div>
      <div class="flex items-center gap-2 cursor-pointer" @click="handleViewAll">
        <AppIcon name="recent-updates" :size="16" class="text-drydock-secondary" />
        <span class="text-xs font-semibold dd-text">{{ pendingUpdatesCount === 1 ? t('dashboardView.recentUpdates.compactSingle', { count: pendingUpdatesCount }) : t('dashboardView.recentUpdates.compactPlural', { count: pendingUpdatesCount }) }}</span>
        <AppStatusIndicator
          v-if="pendingUpdatesCount > 0"
          marker="none"
          tone="warning"
          size="xs"
          :label="pendingUpdatesCount" />
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
