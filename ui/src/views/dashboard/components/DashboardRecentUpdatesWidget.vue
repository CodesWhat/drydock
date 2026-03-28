<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import AppBadge from '@/components/AppBadge.vue';
import type { RecentUpdateRow, UpdateKind } from '../dashboardTypes';

const UPDATE_TABLE_COLUMNS = [
  { key: 'icon', label: '', icon: true },
  { key: 'container', label: 'Container', sortable: false },
  { key: 'version', label: 'Version', sortable: false, align: 'text-center' },
  { key: 'type', label: 'Type', sortable: false },
  { key: 'actions', label: 'Actions', sortable: false, align: 'text-center' },
] as const;

interface Props {
  dashboardUpdateAllInProgress: boolean;
  dashboardUpdateError: string | null;
  dashboardUpdateInProgress: string | null;
  editMode: boolean;
  getUpdateKindColor: (kind: UpdateKind | null) => string;
  getUpdateKindIcon: (kind: UpdateKind | null) => string;
  getUpdateKindMutedColor: (kind: UpdateKind | null) => string;
  pendingUpdatesCount: number;
  recentUpdates: RecentUpdateRow[];
}

const props = defineProps<Props>();

function getRowClass(row: Record<string, unknown>): string {
  const id = row.id as string;
  if (props.dashboardUpdateInProgress === id || props.dashboardUpdateAllInProgress) {
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
    <div v-if="showHeader" class="shrink-0 flex items-center justify-between px-5 py-3.5" :style="{ borderBottom: '1px solid var(--dd-border)' }">
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
          :class="dashboardUpdateAllInProgress
            ? 'dd-text-muted cursor-not-allowed opacity-60'
            : 'dd-text hover:dd-bg-elevated'"
          :disabled="dashboardUpdateAllInProgress"
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
        class="mx-5 mt-3 px-3 py-2 text-2xs-plus dd-rounded"
        :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
        {{ dashboardUpdateError }}
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain dd-scroll-stable">
        <DataTable
          :columns="UPDATE_TABLE_COLUMNS"
          :rows="recentUpdates"
          row-key="id"
          :row-class="getRowClass"
          compact>
          <template #cell-icon="{ row }">
            <ContainerIcon :icon="row.icon" :size="28" />
          </template>

          <template #cell-container="{ row }">
            <div class="font-medium dd-text leading-tight">{{ row.name }}</div>
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
            <div class="flex sm:hidden flex-col items-start gap-0.5 min-w-0">
              <CopyableTag :tag="row.oldVer" class="text-3xs dd-text-secondary break-all leading-tight">
                {{ row.oldVer }}
              </CopyableTag>
              <CopyableTag
                :tag="row.newVer"
                class="text-3xs font-semibold break-all leading-tight"
                :style="{ color: getUpdateKindColor(row.updateKind) }">
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
            <AppButton
              v-if="row.status === 'pending'"
              data-test="dashboard-update-btn"
              size="none"
              variant="plain"
              weight="none"
              type="button"
              class="w-7 h-7 dd-rounded-sm flex items-center justify-center transition-colors"
              :class="dashboardUpdateInProgress === row.id || dashboardUpdateAllInProgress
                ? 'dd-text-muted opacity-50 cursor-not-allowed'
                : 'dd-text-muted hover:dd-text-success hover:dd-bg-elevated'"
              :disabled="dashboardUpdateInProgress === row.id || dashboardUpdateAllInProgress"
              @click.stop="handleConfirmUpdate(row)">
              <AppIcon
                :name="dashboardUpdateInProgress === row.id ? 'spinner' : 'cloud-download'"
                :size="14"
                :class="dashboardUpdateInProgress === row.id ? 'dd-spin' : ''" />
            </AppButton>
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
