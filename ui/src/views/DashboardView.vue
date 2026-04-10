<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { type RouteLocationRaw, useRouter } from 'vue-router';
import { GridItem, GridLayout } from 'grid-layout-plus';
import AppIconButton from '@/components/AppIconButton.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { useToast } from '../composables/useToast';
import { preferences } from '../preferences/store';
import { ROUTES } from '../router/routes';
import { updateContainer } from '../services/container-actions';
import {
  createContainerUpdateBatchId,
  formatContainerUpdateStartedCountMessage,
  formatContainersAlreadyUpToDateMessage,
  getContainerAlreadyUpToDateMessage,
  getContainerUpdateStartedMessage,
  isStaleContainerUpdateError,
  runContainerUpdateRequest,
} from '../utils/container-update';
import { errorMessage } from '../utils/error';
import { summarizeContainerResourceUsage } from '../utils/stats-summary';
import DashboardHostStatusWidget from './dashboard/components/DashboardHostStatusWidget.vue';
import DashboardRecentUpdatesWidget from './dashboard/components/DashboardRecentUpdatesWidget.vue';
import DashboardResourceUsageWidget from './dashboard/components/DashboardResourceUsageWidget.vue';
import DashboardSecurityOverviewWidget from './dashboard/components/DashboardSecurityOverviewWidget.vue';
import DashboardUpdateBreakdownWidget from './dashboard/components/DashboardUpdateBreakdownWidget.vue';
import {
  DASHBOARD_WIDGET_META,
  type DashboardUpdateSequenceEntry,
  type DashboardWidgetId,
  type RecentUpdateRow,
} from './dashboard/dashboardTypes';
import { useDashboardDragAutoScroll } from './dashboard/useDashboardDragAutoScroll';
import {
  getWidgetBoundsForBreakpoint,
  GRID_BREAKPOINTS,
  GRID_COLS,
} from './dashboard/dashboardWidgetLayout';
import { useDashboardComputed } from './dashboard/useDashboardComputed';
import { useDashboardData } from './dashboard/useDashboardData';
import { useDashboardWidgetOrder } from './dashboard/useDashboardWidgetOrder';

const router = useRouter();
const confirm = useConfirmDialog();
const toast = useToast();
const { isMobile, windowNarrow } = useBreakpoints();
const dashboardScrollEl = ref<HTMLElement | null>(null);
// Responsive grid margins: slightly wider vertical gaps on touch screens for scroll room
const gridMargin = computed<[number, number]>(() => {
  if (isMobile.value) return [10, 20]; // < 768px: tighter horizontal, taller vertical for touch
  if (windowNarrow.value) return [14, 18]; // < 1024px: tablet
  return [16, 16]; // desktop
});
const dashboardUpdateInProgress = ref<string | null>(null);
const dashboardUpdateAllInProgress = ref(false);
const dashboardUpdateError = ref<string | null>(null);
const dashboardPendingUpdateRows = ref<Map<string, { row: RecentUpdateRow; startedAt: number }>>(
  new Map(),
);
const dashboardUpdateSequence = ref<Map<string, DashboardUpdateSequenceEntry>>(new Map());
const dashboardPendingUpdatePollTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const dashboardPendingUpdatePollInFlight = ref(false);
const dashboardPendingUpdatePollDelayMs = ref(2_000);
const DASHBOARD_PENDING_UPDATE_POLL_INTERVAL_MS = 2_000;
const DASHBOARD_PENDING_UPDATE_POLL_MAX_INTERVAL_MS = 16_000;
const DASHBOARD_PENDING_UPDATE_TIMEOUT_MS = 30_000;

function navigateTo(route: RouteLocationRaw) {
  router.push(route);
}

// Delay enabling grid transitions to prevent fly-in on initial load
const gridReady = ref(false);
let gridReadyTimer: ReturnType<typeof setTimeout> | undefined;
onMounted(() => {
  gridReadyTimer = setTimeout(() => {
    gridReady.value = true;
  }, 300);
});
onUnmounted(() => {
  clearTimeout(gridReadyTimer);
});

const {
  currentBreakpoint,
  gridInstanceKey,
  onBreakpointChanged,
  editMode,
  isWidgetVisible,
  layout,
  responsiveLayouts,
  resetAll,
  toggleEditMode,
  toggleWidgetVisibility,
  widgetOrderIndex,
} = useDashboardWidgetOrder();

const layoutWithBreakpointBounds = computed(() =>
  layout.value.map((item) => ({
    ...item,
    breakpointBounds: getWidgetBoundsForBreakpoint(
      item.i as DashboardWidgetId,
      currentBreakpoint.value,
    ),
  })),
);

const { handleDashboardGridPointerDown, stopDashboardDragAutoScroll } = useDashboardDragAutoScroll({
  editMode,
  dashboardScrollEl,
});

// Widget panel visibility (separate from edit mode so it's opt-in on mobile)
const showWidgetPanel = ref(false);

function handleToggleEditMode() {
  toggleEditMode();
  if (!editMode.value) {
    stopDashboardDragAutoScroll();
  }
  // On desktop, auto-open panel when entering edit mode; on mobile, leave it closed
  showWidgetPanel.value = editMode.value && !isMobile.value;
}

function toggleWidgetPanel() {
  showWidgetPanel.value = !showWidgetPanel.value;
}

function closeWidgetPanel() {
  showWidgetPanel.value = false;
}

// Exit edit mode on Escape key
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && editMode.value) {
    stopDashboardDragAutoScroll();
    editMode.value = false;
    showWidgetPanel.value = false;
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});

const {
  agents,
  containerSummary,
  containerStats,
  containers,
  error,
  fetchDashboardData,
  loading,
  maintenanceCountdownNow,
  recentStatusByContainer,
  recentStatusByIdentity,
  registries,
  serverInfo,
  watchers,
} = useDashboardData();

const resourceUsage = computed(() => summarizeContainerResourceUsage(containerStats.value));

const {
  DONUT_CIRCUMFERENCE,
  getUpdateKindColor,
  getUpdateKindIcon,
  getUpdateKindMutedColor,
  recentUpdates,
  securityCleanArcLength,
  securityCleanCount,
  securityIssueArcLength,
  securityIssueCount,
  securityNotScannedArcLength,
  securityNotScannedCount,
  securitySeverityTotals,
  securityTotalCount,
  servers,
  showSecuritySeverityBreakdown,
  stats,
  totalUpdates,
  updateBreakdownBuckets,
  vulnerabilities,
} = useDashboardComputed({
  agents,
  containerSummary,
  containers,
  hidePinned: computed(() => preferences.containers.filters.hidePinned),
  maintenanceCountdownNow,
  recentStatusByContainer,
  recentStatusByIdentity,
  registries,
  serverInfo,
  watchers,
});

const pendingUpdates = computed(() =>
  recentUpdates.value.filter(
    (row) =>
      row.status === 'pending' &&
      !row.blocked &&
      !dashboardUpdateSequence.value.has(getDashboardRecentUpdateSequenceKey(row)),
  ),
);

const displayRecentUpdates = computed<RecentUpdateRow[]>(() => {
  const liveRowIdentityKeys = new Set(
    recentUpdates.value.map((row) => getDashboardRecentUpdateReconciliationKey(row)),
  );
  const ghosts = [...dashboardPendingUpdateRows.value.values()]
    .filter(({ row }) => !liveRowIdentityKeys.has(getDashboardRecentUpdateReconciliationKey(row)))
    .map(({ row }) => row);
  return [...recentUpdates.value, ...ghosts];
});

function getDashboardRecentUpdateSequenceKey(
  row: Pick<RecentUpdateRow, 'id' | 'identityKey' | 'name'>,
): string {
  return row.id || row.identityKey || row.name;
}

function getDashboardRecentUpdateReconciliationKey(
  row: Pick<RecentUpdateRow, 'identityKey' | 'id' | 'name'>,
): string {
  return row.identityKey || row.id || row.name;
}

function getDashboardContainerReconciliationKey(container: {
  identityKey?: string;
  id?: string;
  name?: string;
}): string {
  return container.identityKey || container.id || container.name || '';
}

function stopDashboardPendingUpdatePolling() {
  if (!dashboardPendingUpdatePollTimer.value) {
    dashboardPendingUpdatePollDelayMs.value = DASHBOARD_PENDING_UPDATE_POLL_INTERVAL_MS;
    return;
  }
  clearTimeout(dashboardPendingUpdatePollTimer.value);
  dashboardPendingUpdatePollTimer.value = null;
  dashboardPendingUpdatePollDelayMs.value = DASHBOARD_PENDING_UPDATE_POLL_INTERVAL_MS;
}

function hasDashboardTrackedUpdates() {
  return dashboardPendingUpdateRows.value.size > 0 || dashboardUpdateSequence.value.size > 0;
}

function getVisibleDashboardTrackedUpdateKeys() {
  const keys = new Set(recentUpdates.value.map((row) => getDashboardRecentUpdateSequenceKey(row)));
  for (const { row } of dashboardPendingUpdateRows.value.values()) {
    keys.add(getDashboardRecentUpdateSequenceKey(row));
  }
  return keys;
}

function startDashboardPendingUpdateTracking() {
  if (!hasDashboardTrackedUpdates()) {
    stopDashboardPendingUpdatePolling();
    return;
  }
  stopDashboardPendingUpdatePolling();
  dashboardPendingUpdatePollDelayMs.value = DASHBOARD_PENDING_UPDATE_POLL_INTERVAL_MS;
  startDashboardPendingUpdatePolling();
}

function syncDashboardUpdateSequenceValue(rowKeys: string[], acceptedRowKeys: string[]) {
  const next = new Map(dashboardUpdateSequence.value);
  for (const key of rowKeys) {
    next.delete(key);
  }
  for (const [index, key] of acceptedRowKeys.entries()) {
    next.set(key, {
      position: index + 1,
      total: acceptedRowKeys.length,
    });
  }
  dashboardUpdateSequence.value = next;
}

function pruneDashboardUpdateSequence() {
  const visibleKeys = getVisibleDashboardTrackedUpdateKeys();
  if (dashboardUpdateAllInProgress.value && visibleKeys.size === 0) {
    return;
  }
  const next = new Map(dashboardUpdateSequence.value);
  for (const key of dashboardUpdateSequence.value.keys()) {
    if (!visibleKeys.has(key)) {
      next.delete(key);
    }
  }
  dashboardUpdateSequence.value = next;
}

function clearDashboardPendingUpdateRow(key: string) {
  dashboardPendingUpdateRows.value.delete(key);
  pruneDashboardUpdateSequence();
}

function pruneDashboardPendingUpdateRows(now: number = Date.now()) {
  const liveContainerIdentityKeys = new Set(
    containers.value
      .map((container) => getDashboardContainerReconciliationKey(container))
      .filter((key) => key.length > 0),
  );
  for (const [key, pendingRow] of dashboardPendingUpdateRows.value.entries()) {
    if (
      liveContainerIdentityKeys.has(key) ||
      now - pendingRow.startedAt > DASHBOARD_PENDING_UPDATE_TIMEOUT_MS
    ) {
      clearDashboardPendingUpdateRow(key);
    }
  }
  pruneDashboardUpdateSequence();
  if (!hasDashboardTrackedUpdates()) {
    stopDashboardPendingUpdatePolling();
  }
}

async function pollDashboardPendingUpdateRows() {
  if (dashboardPendingUpdatePollInFlight.value) {
    return;
  }
  dashboardPendingUpdatePollInFlight.value = true;
  try {
    await fetchDashboardData({ background: true });
  } finally {
    pruneDashboardPendingUpdateRows();
    dashboardPendingUpdatePollInFlight.value = false;
    if (hasDashboardTrackedUpdates()) {
      dashboardPendingUpdatePollDelayMs.value =
        dashboardUpdateSequence.value.size > 0 || pendingUpdates.value.length > 0
          ? DASHBOARD_PENDING_UPDATE_POLL_INTERVAL_MS
          : Math.min(
              dashboardPendingUpdatePollDelayMs.value * 2,
              DASHBOARD_PENDING_UPDATE_POLL_MAX_INTERVAL_MS,
            );
      startDashboardPendingUpdatePolling();
    }
  }
}

function startDashboardPendingUpdatePolling() {
  if (dashboardPendingUpdatePollTimer.value) {
    return;
  }
  dashboardPendingUpdatePollTimer.value = setTimeout(() => {
    dashboardPendingUpdatePollTimer.value = null;
    void pollDashboardPendingUpdateRows();
  }, dashboardPendingUpdatePollDelayMs.value);
}

function capturePendingDashboardRows(rows: RecentUpdateRow[]) {
  const liveContainerIdentityKeys = new Set(
    containers.value
      .map((container) => getDashboardContainerReconciliationKey(container))
      .filter((key) => key.length > 0),
  );
  for (const row of rows) {
    const key = getDashboardRecentUpdateReconciliationKey(row);
    if (!key || liveContainerIdentityKeys.has(key)) {
      continue;
    }
    const existing = dashboardPendingUpdateRows.value.get(key);
    dashboardPendingUpdateRows.value.set(key, {
      row: {
        ...row,
        status: 'updating',
      },
      startedAt: existing?.startedAt ?? Date.now(),
    });
  }
  pruneDashboardPendingUpdateRows();
  startDashboardPendingUpdateTracking();
}

// Stat card data lookup by widget id
const statById = computed(() => {
  const map = new Map<string, (typeof stats.value)[number]>();
  for (const s of stats.value) map.set(s.id, s);
  return map;
});

watch(containers, () => {
  pruneDashboardPendingUpdateRows();
  pruneDashboardUpdateSequence();
});

onUnmounted(() => {
  stopDashboardPendingUpdatePolling();
});

// Widget metadata for customize panel
const allWidgetMeta = DASHBOARD_WIDGET_META;

function widgetSizes(id: DashboardWidgetId): string[] {
  const meta = DASHBOARD_WIDGET_META.find((w) => w.id === id);
  if (!meta) return ['M'];
  if (meta.category === 'stat') return ['S'];
  const sizes: string[] = [];
  // Can it shrink to compact/stat-card size?
  if (meta.minW <= 3 && meta.minH <= 4) sizes.push('S');
  // Standard widget
  sizes.push('M');
  // Can it stretch wide?
  if (meta.canStretch || meta.maxW >= 8) sizes.push('L');
  return sizes;
}

function sizeColor(size: string): { bg: string; fg: string } {
  if (size === 'S') return { bg: 'var(--dd-info-muted)', fg: 'var(--dd-info)' };
  if (size === 'L') return { bg: 'var(--dd-warning-muted)', fg: 'var(--dd-warning)' };
  return { bg: 'var(--dd-neutral-muted)', fg: 'var(--dd-neutral)' };
}

function handleStatClick(id: DashboardWidgetId) {
  if (editMode.value) return;
  const route = statById.value.get(id)?.route;
  if (route) navigateTo(route);
}

// Check if a widget is a stat card
function isStatWidget(id: string): boolean {
  return id.startsWith('stat-');
}

function confirmDashboardUpdate(row: RecentUpdateRow) {
  confirm.require({
    header: 'Update Container',
    message: `Update ${row.name} now? This will apply the latest discovered image.`,
    severity: 'warn',
    acceptLabel: 'Update',
    rejectLabel: 'Cancel',
    accept: async () => {
      dashboardUpdateInProgress.value = row.id;
      dashboardUpdateError.value = null;
      try {
        const result = await runContainerUpdateRequest({
          request: () => updateContainer(row.id),
          onAccepted: async () => {
            await fetchDashboardData();
            capturePendingDashboardRows([row]);
          },
          onStale: async () => {
            await fetchDashboardData();
          },
          isStaleError: isStaleContainerUpdateError,
        });
        if (result === 'accepted') {
          toast.success(getContainerUpdateStartedMessage(row.name));
        } else {
          toast.info(getContainerAlreadyUpToDateMessage(row.name));
        }
      } catch (e: unknown) {
        dashboardUpdateError.value = errorMessage(e, `Failed to update ${row.name}`);
      } finally {
        dashboardUpdateInProgress.value = null;
      }
    },
  });
}

function confirmDashboardUpdateAll() {
  confirm.require({
    header: 'Update All Containers',
    message: `${pendingUpdates.value.length} containers will be updated. Continue?`,
    severity: 'warn',
    acceptLabel: 'Update All',
    rejectLabel: 'Cancel',
    accept: async () => {
      const pendingRowsSnapshot = pendingUpdates.value.filter((row) => !row.blocked);
      dashboardUpdateAllInProgress.value = true;
      dashboardUpdateError.value = null;
      const snapshotRowKeys = pendingRowsSnapshot.map((row) =>
        getDashboardRecentUpdateSequenceKey(row),
      );
      const batchId = createContainerUpdateBatchId();
      const queueTotal = pendingRowsSnapshot.length;
      let acceptedRowKeys = [...snapshotRowKeys];
      syncDashboardUpdateSequenceValue(snapshotRowKeys, acceptedRowKeys);
      startDashboardPendingUpdateTracking();
      try {
        const successfulRows: RecentUpdateRow[] = [];
        const staleRows: RecentUpdateRow[] = [];
        let firstRejectedUpdate: unknown;

        for (const [index, row] of pendingRowsSnapshot.entries()) {
          try {
            const result = await runContainerUpdateRequest({
              request: () =>
                updateContainer(row.id, {
                  batchId,
                  queuePosition: index + 1,
                  queueTotal,
                }),
              isStaleError: isStaleContainerUpdateError,
            });
            if (result === 'accepted') {
              successfulRows.push(row);
              continue;
            }
            const rowKey = getDashboardRecentUpdateSequenceKey(row);
            acceptedRowKeys = acceptedRowKeys.filter((key) => key !== rowKey);
            syncDashboardUpdateSequenceValue(snapshotRowKeys, acceptedRowKeys);
            staleRows.push(row);
          } catch (e: unknown) {
            const rowKey = getDashboardRecentUpdateSequenceKey(row);
            acceptedRowKeys = acceptedRowKeys.filter((key) => key !== rowKey);
            syncDashboardUpdateSequenceValue(snapshotRowKeys, acceptedRowKeys);
            if (!firstRejectedUpdate) {
              firstRejectedUpdate = e;
            }
          }
        }

        await fetchDashboardData();
        capturePendingDashboardRows(successfulRows);
        if (successfulRows.length > 0) {
          toast.success(formatContainerUpdateStartedCountMessage(successfulRows.length));
        }
        if (staleRows.length > 0) {
          toast.info(
            staleRows.length === 1
              ? getContainerAlreadyUpToDateMessage(staleRows[0]!.name)
              : formatContainersAlreadyUpToDateMessage(staleRows.length),
          );
        }
        if (firstRejectedUpdate) {
          dashboardUpdateError.value = errorMessage(
            firstRejectedUpdate,
            'Failed to update all containers',
          );
        }
      } finally {
        if (acceptedRowKeys.length === 0) {
          syncDashboardUpdateSequenceValue(snapshotRowKeys, []);
          pruneDashboardUpdateSequence();
        }
        dashboardUpdateAllInProgress.value = false;
      }
    },
  });
}
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 -ml-4 -mr-2 -my-4 sm:-ml-6 sm:-mr-[9px] sm:-my-6">
    <div class="flex gap-2 min-w-0 flex-1 min-h-0">
    <!-- Main dashboard content -->
    <div ref="dashboardScrollEl" class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-2 py-1 sm:pl-7 sm:pr-6 sm:py-6 dd-touch-scroll">
      <div v-if="loading" class="flex items-center justify-center py-16">
        <div class="text-sm dd-text-muted">Loading dashboard...</div>
      </div>

      <div v-else-if="error" class="flex flex-col items-center justify-center py-16">
        <div class="text-sm font-medium dd-text-danger mb-2">Failed to load dashboard</div>
        <div class="text-xs dd-text-muted">{{ error }}</div>
        <AppButton
          size="none" variant="plain" weight="none"
          class="mt-4 px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors dd-bg-elevated dd-text hover:opacity-90"
          @click="fetchDashboardData">
          Retry
        </AppButton>
      </div>

      <template v-else>
        <!-- Pencil icon teleported to breadcrumb header -->
        <Teleport to="#breadcrumb-actions">
          <div class="flex items-center">
            <AppIconButton
              v-if="editMode && !showWidgetPanel"
              data-test="dashboard-widget-panel-toggle"
              icon="ph:sliders-horizontal"
              size="xs"
              variant="muted"
              class="ml-2"
              tooltip="Show widget panel"
              @click="toggleWidgetPanel" />
            <AppIconButton
              data-test="dashboard-edit-toggle"
              :icon="editMode ? 'check' : 'ph:pencil-simple'"
              size="xs"
              :variant="editMode ? 'plain' : 'muted'"
              :class="editMode ? 'dd-bg-elevated dd-text ml-2' : 'ml-2'"
              :tooltip="editMode ? 'Done customizing' : 'Customize dashboard'"
              @click="handleToggleEditMode" />
          </div>
        </Teleport>

        <!-- Grid Layout -->
        <GridLayout
          :key="gridInstanceKey"
          v-model:layout="layout"
          @pointerdown.capture="handleDashboardGridPointerDown"
          @breakpoint-changed="onBreakpointChanged"
          :col-num="12"
          :row-height="30"
          :margin="gridMargin"
          :responsive="true"
          :responsive-layouts="responsiveLayouts"
          :breakpoints="GRID_BREAKPOINTS"
          :cols="GRID_COLS"
          :class="{ 'dd-grid-ready': gridReady }"
          :is-draggable="editMode"
          :is-resizable="editMode"
          :vertical-compact="true"
          :use-css-transforms="true">
          <GridItem
            v-for="item in layoutWithBreakpointBounds"
            v-show="isWidgetVisible(item.i as DashboardWidgetId)"
            :key="item.i"
            :data-widget-id="item.i"
            :data-widget-order="widgetOrderIndex(item.i as DashboardWidgetId)"
            :x="item.x"
            :y="item.y"
            :w="item.w"
            :h="item.h"
            :i="item.i"
            :min-w="item.breakpointBounds.minW"
            :min-h="item.breakpointBounds.minH"
            :max-w="item.breakpointBounds.maxW"
            :max-h="item.breakpointBounds.maxH"
            drag-ignore-from="input, textarea, button, a, select, .no-drag"
            drag-allow-from=".drag-handle"
            class="dd-grid-item"
            :style="editMode ? { touchAction: 'pan-y' } : undefined"
            :class="editMode ? 'dd-grid-edit' : ''">

            <!-- Stat Cards -->
            <component
              :is="!editMode && statById.get(item.i as DashboardWidgetId)?.route ? 'button' : 'div'"
              v-if="isStatWidget(item.i)"
              :type="!editMode && statById.get(item.i as DashboardWidgetId)?.route ? 'button' : undefined"
              :aria-label="(statById.get(item.i as DashboardWidgetId)?.label ?? '') + ': ' + (statById.get(item.i as DashboardWidgetId)?.value ?? '')"
              class="stat-card dd-rounded px-4 py-2.5 text-left cursor-default relative w-full"
              :class="[
                editMode ? 'm-[3px] h-[calc(100%-6px)]' : 'h-full',
                !editMode && statById.get(item.i as DashboardWidgetId)?.route ? 'cursor-pointer hover:dd-bg-elevated' : '',
              ]"
              :style="{ backgroundColor: 'var(--dd-bg-card)' }"
              @click="handleStatClick(item.i as DashboardWidgetId)">
              <div v-if="editMode" class="drag-handle dd-drag-handle absolute top-1.5 left-1/2 -translate-x-1/2 z-10" v-tooltip.top="'Drag to reorder'">
                <AppIcon name="ph:dots-six" :size="14" />
              </div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-2xs-plus font-medium uppercase tracking-wider dd-text-muted">
                  {{ statById.get(item.i as DashboardWidgetId)?.label }}
                </span>
                <div class="w-9 h-9 dd-rounded flex items-center justify-center"
                     :style="{ backgroundColor: statById.get(item.i as DashboardWidgetId)?.colorMuted, color: statById.get(item.i as DashboardWidgetId)?.color }">
                  <AppIcon :name="statById.get(item.i as DashboardWidgetId)?.icon ?? 'dashboard'" :size="20" />
                </div>
              </div>
              <div class="text-2xl font-bold dd-text">
                {{ statById.get(item.i as DashboardWidgetId)?.value }}
              </div>
              <div v-if="statById.get(item.i as DashboardWidgetId)?.detail" class="mt-1 text-2xs font-medium dd-text-muted">
                {{ statById.get(item.i as DashboardWidgetId)?.detail }}
              </div>
            </component>

            <!-- Grid Widgets -->
            <DashboardRecentUpdatesWidget
              v-else-if="item.i === 'recent-updates'"
              class="h-full"
              :recent-updates="displayRecentUpdates"
              :pending-updates-count="pendingUpdates.length"
              :dashboard-update-error="dashboardUpdateError"
              :dashboard-update-in-progress="dashboardUpdateInProgress"
              :dashboard-update-all-in-progress="dashboardUpdateAllInProgress"
              :dashboard-update-sequence="dashboardUpdateSequence"
              :get-update-kind-color="getUpdateKindColor"
              :get-update-kind-icon="getUpdateKindIcon"
              :get-update-kind-muted-color="getUpdateKindMutedColor"
              :edit-mode="editMode"
              @confirm-update="confirmDashboardUpdate"
              @confirm-update-all="confirmDashboardUpdateAll"
              @view-all="navigateTo({ path: ROUTES.CONTAINERS, query: { filterKind: 'any' } })" />

            <DashboardSecurityOverviewWidget
              v-else-if="item.i === 'security-overview'"
              class="h-full"
              :donut-circumference="DONUT_CIRCUMFERENCE"
              :security-clean-arc-length="securityCleanArcLength"
              :security-clean-count="securityCleanCount"
              :security-issue-arc-length="securityIssueArcLength"
              :security-issue-count="securityIssueCount"
              :security-not-scanned-arc-length="securityNotScannedArcLength"
              :security-not-scanned-count="securityNotScannedCount"
              :security-severity-totals="securitySeverityTotals"
              :security-total-count="securityTotalCount"
              :show-security-severity-breakdown="showSecuritySeverityBreakdown"
              :vulnerabilities="vulnerabilities"
              :edit-mode="editMode"
              @view-all="navigateTo(ROUTES.SECURITY)" />

            <DashboardResourceUsageWidget
              v-else-if="item.i === 'resource-usage'"
              class="h-full"
              :resource-usage="resourceUsage"
              :edit-mode="editMode"
              @view-all="navigateTo(ROUTES.CONTAINERS)" />

            <DashboardHostStatusWidget
              v-else-if="item.i === 'host-status'"
              class="h-full"
              :servers="servers"
              :edit-mode="editMode"
              @view-all="navigateTo(ROUTES.SERVERS)" />

            <DashboardUpdateBreakdownWidget
              v-else-if="item.i === 'update-breakdown'"
              class="h-full"
              :total-updates="totalUpdates"
              :update-breakdown-buckets="updateBreakdownBuckets"
              :edit-mode="editMode"
              @view-all="navigateTo({ path: ROUTES.CONTAINERS, query: { filterKind: 'any' } })" />
          </GridItem>
        </GridLayout>
      </template>
    </div>

    <!-- Customize panel: mobile overlay backdrop -->
    <div v-if="showWidgetPanel && isMobile"
         class="fixed inset-0 bg-black/50 z-40"
         @click="closeWidgetPanel" />

    <!-- Customize panel -->
    <aside
      v-if="showWidgetPanel"
      class="shrink-0 flex flex-col dd-rounded overflow-hidden"
      :class="isMobile ? 'fixed top-0 right-0 z-50' : 'sticky top-0 mr-2'"
      :style="{
        width: isMobile ? '100%' : 'var(--dd-layout-sidebar-expanded-width)',
        minWidth: isMobile ? undefined : 'var(--dd-layout-sidebar-expanded-width)',
        maxWidth: isMobile ? '100%' : undefined,
        backgroundColor: 'var(--dd-bg-card)',
        height: isMobile ? '100vh' : 'calc(100vh - var(--dd-layout-main-viewport-offset))',
      }">
      <div class="shrink-0 px-4 py-3 flex items-center justify-between"
           :style="{ borderBottom: '1px solid var(--dd-border)' }">
        <div class="flex items-center gap-2">
          <AppIcon name="ph:pencil-simple" :size="12" class="dd-text-muted" />
          <span class="text-2xs-plus font-semibold dd-text">Widgets</span>
        </div>
        <AppIconButton
          icon="xmark"
          size="xs"
          variant="muted"
          tooltip="Close panel"
          aria-label="Close panel"
          @click="closeWidgetPanel" />
      </div>

      <div class="flex-1 overflow-y-auto overscroll-contain dd-scroll-stable dd-touch-scroll p-3 space-y-1">
        <label
          v-for="widget in allWidgetMeta"
          :key="widget.id"
          class="flex items-center gap-2.5 px-2.5 py-1.5 dd-rounded cursor-pointer transition-colors hover:dd-bg-elevated">
          <input
            type="checkbox"
            :checked="isWidgetVisible(widget.id)"
            class="shrink-0 w-3.5 h-3.5 dd-rounded-sm cursor-pointer"
            @change="toggleWidgetVisibility(widget.id)" />
          <span class="flex-1 text-2xs-plus dd-text">{{ widget.label }}</span>
          <span class="shrink-0 flex items-center gap-0.5">
            <span
              v-for="size in widgetSizes(widget.id)"
              :key="size"
              class="px-1 py-0.5 dd-rounded text-4xs font-bold uppercase tracking-wider"
              :style="{ backgroundColor: sizeColor(size).bg, color: sizeColor(size).fg }">
              {{ size }}
            </span>
          </span>
        </label>

        <div class="pt-3 mt-2" :style="{ borderTop: '1px solid var(--dd-border)' }">
          <AppButton
            size="none" variant="plain" weight="none"
            class="w-full px-2.5 py-1.5 dd-rounded text-2xs font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated text-center"
            @click="resetAll">
            Reset to Default
          </AppButton>
        </div>
      </div>
    </aside>
    </div>
  </div>
</template>

<style>
/*
 * grid-layout-plus overrides
 *
 * The library exposes CSS custom properties on .vgl-layout for theming.
 * We set those instead of using !important where possible.
 * The 3 remaining !important declarations override inline transition
 * styles that the library sets via JS during mount and drag — there
 * is no custom property for these.
 */

/* Theme the library's built-in placeholder and resizer via its CSS vars */
.vgl-layout {
  --vgl-placeholder-bg: var(--dd-success);
  --vgl-placeholder-opacity: 15%;
  --vgl-resizer-border-color: var(--dd-text-secondary);
  --vgl-resizer-border-width: 1.5px;
  --vgl-resizer-size: 20px;
  /* Grid library adds outer-edge margins equal to the item gap.
     Pull top and left flush to align with page content.
     Vertical stays at -16px (works at all breakpoints).
     Horizontal must match the responsive gridMargin[0]. */
  margin-top: -16px;
  margin-left: -10px;  /* mobile: gridMargin [10, 20] */
}

@media (min-width: 768px) {
  .vgl-layout {
    margin-left: -14px;  /* tablet: gridMargin [14, 18] */
  }
}

@media (min-width: 1024px) {
  .vgl-layout {
    margin-left: -16px;  /* desktop: gridMargin [16, 16] */
  }
}

/* Disable the initial fly-in — library sets inline transition styles */
.vgl-layout:not(.dd-grid-ready) {
  transition: none !important;
}

.vgl-layout:not(.dd-grid-ready) .vgl-item {
  transition: none !important;
}

.vgl-item--dragging {
  transition: none !important;
}

/* Grid item content fills its cell */
.dd-grid-item > div:not(.stat-card) {
  height: 100%;
  overflow: hidden;
}

.dd-grid-item .dashboard-widget {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Edit mode — dashed border + grab cursor, disable interactive content.
   Uses an inset pseudo-element instead of outline because CSS outlines
   are clipped by ancestor overflow-hidden on items at the grid edges. */
.dd-grid-edit {
  cursor: grab;
  position: relative;
}

.dd-grid-edit::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 2px dashed var(--dd-border-strong);
  border-radius: var(--dd-radius);
  pointer-events: none;
  z-index: 1;
}

.dd-grid-edit:active {
  cursor: grabbing;
}

/* Block ALL clicks on card content in edit mode — only drag handles and resize work */
.dd-grid-edit > * {
  pointer-events: none;
}

/* Re-enable pointer events on drag handles so they can be grabbed */
.dd-grid-edit .drag-handle {
  pointer-events: auto;
}

/* Re-enable pointer events on resize handle */
.dd-grid-edit .vgl-item__resizer {
  pointer-events: auto;
}

/* Drag handle pill */
.dd-drag-handle {
  cursor: grab;
  color: var(--dd-neutral);
  background: var(--dd-neutral-muted);
  border-radius: var(--dd-radius);
  padding: 2px 6px;
  touch-action: none;
  opacity: 0.8;
  transition: opacity 150ms ease, background-color 150ms ease, color 150ms ease;
}

.dd-grid-edit:hover .dd-drag-handle,
.dd-drag-handle:hover {
  opacity: 1;
  color: var(--dd-text);
  background: var(--dd-border-strong);
}

.dd-drag-handle:active {
  cursor: grabbing;
}

/* Resize handle pill — matches drag handle style */
.vgl-item .vgl-item__resizer {
  opacity: 0;
  cursor: se-resize;
  background-color: var(--dd-neutral-muted);
  border-radius: var(--dd-radius);
  right: 6px;
  bottom: 6px;
  touch-action: none;
  transition: opacity 150ms ease, background-color 150ms ease;
}

.vgl-item .vgl-item__resizer::before {
  border-color: var(--dd-neutral);
  width: 7px;
  height: 7px;
  border-width: 0;
  border-right-width: 1.5px;
  border-bottom-width: 1.5px;
  inset: auto 4px 4px auto;
}

.dd-grid-edit.vgl-item .vgl-item__resizer {
  opacity: var(--dd-opacity-handle-idle);
}

/* Card hover darkens both handles */
.dd-grid-edit.vgl-item:hover .vgl-item__resizer {
  opacity: 1;
  background-color: var(--dd-border-strong);
}

.dd-grid-edit.vgl-item:hover .vgl-item__resizer::before {
  border-color: var(--dd-text);
}

/* Placeholder border during drag/resize */
.vgl-item--placeholder {
  border-radius: var(--dd-radius);
  border: 2px dashed var(--dd-success);
}
</style>
