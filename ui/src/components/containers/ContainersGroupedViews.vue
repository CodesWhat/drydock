<script setup lang="ts">
import { computed, onScopeDispose, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '../../composables/useToast';
import AppBadge from '../AppBadge.vue';
import AppIconButton from '../AppIconButton.vue';
import type { ContainersViewRenderGroup } from './containersViewTemplateContext';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';
import { useUpdateBatches } from '../../composables/useUpdateBatches';
import { getContainerViewKey } from '../../utils/container-view-key';
import { getUpdateInProgressPhaseLabelKey } from '../../utils/container-update';
import { imageAge } from '../../utils/audit-helpers';
import { displayGroupName } from '../../utils/display';
import {
  getPrimaryHardBlocker,
  getPrimarySoftBlocker,
  updateButtonState,
  type UpdateButtonState,
} from '../../utils/update-eligibility';
import type { Container } from '../../types/container';
import UpdateMaturityBadge from './UpdateMaturityBadge.vue';
import SuggestedTagBadge from './SuggestedTagBadge.vue';
import ReleaseNotesLink from './ReleaseNotesLink.vue';
import ProjectLink from './ProjectLink.vue';
import ContainersGroupHeader from './ContainersGroupHeader.vue';
import NoUpdateReasonBadge from './NoUpdateReasonBadge.vue';

const {
  filteredContainers,
  renderGroups,
  groupByStack,
  toggleGroupCollapse,
  collapsedGroups,
  containerActionsEnabled,
  containerActionsDisabledReason,
  isContainerUpdateInProgress,
  isContainerUpdateQueued,
  isContainerScanInProgress,
  isContainerRowLocked,
  updateAllInGroup,
  tt,
  containerViewMode,
  tableColumns,
  containerSortKey,
  containerSortAsc,
  selectedContainer,
  isCompact,
  selectContainer,
  activeDetailTab,
  tableActionStyle,
  openActionsMenu,
  toggleActionsMenu,
  cancelUpdate,
  confirmUpdate,
  confirmStop,
  startContainer,
  confirmRestart,
  scanContainer,
  confirmForceUpdate,
  skipUpdate,
  closeActionsMenu,
  confirmDelete,
  displayContainers,
  actionsMenuStyle,
  updateKindColor,
  hasRegistryError,
  registryErrorTooltip,
  containerPolicyTooltip,
  getContainerListPolicyState,
  serverBadgeColor,
  parseServer,
  registryColorBg,
  registryColorText,
  registryLabel,
  activeFilterCount,
  filterSearch,
  clearFilters,
} = useContainersViewTemplateContext();
const { t } = useI18n();
const { batches, clearBatch, getBatch, incrementSucceeded, incrementFailed } = useUpdateBatches();
const toast = useToast();

const openActionsContainer = computed(
  () => displayContainers.value.find((container) => container.id === openActionsMenu.value) ?? null,
);

type DisplayContainer = (typeof displayContainers.value)[number];

interface GroupHeaderTableRow {
  __rowType: 'group';
  __rowKey: string;
  group: ContainersViewRenderGroup;
  isFirst: boolean;
}

type ContainerTableRow = DisplayContainer & {
  __rowType: 'container';
  __rowKey: string;
  __groupKey: string;
  __source: DisplayContainer;
};

type GroupedTableRow = GroupHeaderTableRow | ContainerTableRow;

function isGroupHeaderTableRow(row: GroupedTableRow): row is GroupHeaderTableRow {
  return row.__rowType === 'group';
}

function isContainerTableRow(row: GroupedTableRow): row is ContainerTableRow {
  return row.__rowType === 'container';
}

// Build the row using the container as a prototype so field reads (c.name,
// c.image, ...) fall through to the live container — no spread snapshot that
// would go stale when applyContainerPatch mutates the container in place. The
// only own properties on the row are the meta fields (__rowType/__rowKey/
// __groupKey/__source) plus the Vue key computed from the container view key.
// Rows are memoized by container reference so unchanged rows keep identity
// across recomputes, preserving slot-prop identity for cell templates.
const containerTableRowCache = new WeakMap<DisplayContainer, ContainerTableRow>();

function makeContainerTableRow(container: DisplayContainer, groupKey: string): ContainerTableRow {
  const cached = containerTableRowCache.get(container);
  if (cached && cached.__groupKey === groupKey) {
    return cached;
  }
  const row = Object.create(container as object) as ContainerTableRow;
  row.__rowType = 'container';
  row.__rowKey = getContainerViewKey(container);
  row.__groupKey = groupKey;
  row.__source = container;
  containerTableRowCache.set(container, row);
  return row;
}

const tableRows = computed<GroupedTableRow[]>(() => {
  if (!groupByStack.value) {
    const flat = renderGroups.value[0]?.containers ?? displayContainers.value;
    return flat.map((container) => makeContainerTableRow(container, '__flat__'));
  }

  const rows: GroupedTableRow[] = [];
  renderGroups.value.forEach((group, index) => {
    rows.push({
      __rowType: 'group',
      __rowKey: `group:${group.key}`,
      group,
      isFirst: index === 0,
    });
    if (!collapsedGroups.value.has(group.key)) {
      rows.push(
        ...group.containers.map((container) => makeContainerTableRow(container, group.key)),
      );
    }
  });
  return rows;
});

const selectedContainerKey = computed(() =>
  selectedContainer.value ? getContainerViewKey(selectedContainer.value) : null,
);

function isContainerUpdating(container: { id?: unknown; name?: unknown }) {
  return isContainerUpdateInProgress(container);
}

function isContainerQueued(container: { id?: unknown; name?: unknown }) {
  return isContainerUpdateQueued(container);
}

function isContainerScanning(container: { id?: unknown; name?: unknown }) {
  return isContainerScanInProgress(container);
}

function isRowLocked(container: { id?: unknown; name?: unknown }) {
  return isContainerRowLocked(container);
}

const RECENT_FAILURE_DISPLAY_MS = 10 * 60 * 1000;

function isContainerRecentlyFailed(c: {
  lastUpdateFailureAt?: number;
  lastUpdateFailureReason?: string;
}): boolean {
  if (!c.lastUpdateFailureAt || !c.lastUpdateFailureReason) {
    return false;
  }
  return Date.now() - c.lastUpdateFailureAt < RECENT_FAILURE_DISPLAY_MS;
}

function recentFailureReasonText(c: { lastUpdateFailureReason?: string }): string {
  return c.lastUpdateFailureReason ?? '';
}

function blockedUpdateTooltip(container: {
  newTag?: string | null;
  updateBouncer?: string;
  updateSecuritySummary?: { critical?: number; high?: number };
  updateEligibility?: Container['updateEligibility'];
}) {
  const hardBlocker = getPrimaryHardBlocker(container.updateEligibility);
  if (hardBlocker) {
    return hardBlocker.message;
  }
  const tag = container.newTag ?? 'update';
  const summary = container.updateSecuritySummary;
  const critical = summary?.critical ?? 0;
  if (critical > 0) {
    const noun = critical === 1 ? 'critical CVE' : 'critical CVEs';
    return `Blocked: ${tag} (${critical} ${noun})`;
  }
  return `Blocked: ${tag}`;
}

function canCancelUpdate(c: { updateOperation?: { status?: string; id?: string } }): boolean {
  const status = c.updateOperation?.status;
  return (status === 'queued' || status === 'in-progress') && Boolean(c.updateOperation?.id);
}

const PHASE_LABEL_KEY_TO_I18N: Record<
  ReturnType<typeof getUpdateInProgressPhaseLabelKey>,
  string
> = {
  verifyingSignature: 'containerComponents.groupedViews.statusVerifyingSignature',
  pulling: 'containerComponents.groupedViews.statusPulling',
  scanning: 'containerComponents.groupedViews.statusScanningPhase',
  generatingSbom: 'containerComponents.groupedViews.statusGeneratingSbom',
  updating: 'containerComponents.groupedViews.statusUpdating',
  healthChecking: 'containerComponents.groupedViews.statusHealthChecking',
  rollingBack: 'containerComponents.groupedViews.statusRollingBack',
};

function getInProgressBadgeLabel(c: { updateOperation?: { phase?: string } }): string {
  const labelKey = getUpdateInProgressPhaseLabelKey(c.updateOperation?.phase);
  return t(PHASE_LABEL_KEY_TO_I18N[labelKey]);
}

function updateBtnState(c: {
  newTag?: string | null;
  updateEligibility?: Container['updateEligibility'];
  id?: unknown;
  name?: unknown;
}): UpdateButtonState {
  return updateButtonState(
    c.updateEligibility,
    Boolean(c.newTag),
    isContainerUpdateInProgress(c) || isContainerUpdateQueued(c),
  );
}

function updateBtnTooltip(c: {
  newTag?: string | null;
  updateEligibility?: Container['updateEligibility'];
  updateBouncer?: string;
  updateSecuritySummary?: { critical?: number; high?: number };
  id?: unknown;
  name?: unknown;
}): string {
  const state = updateBtnState(c);
  if (state === 'hard') return blockedUpdateTooltip(c);
  if (state === 'soft') {
    const soft = getPrimarySoftBlocker(c.updateEligibility);
    return soft ? `Manual update only — ${soft.message}` : 'Manual update only';
  }
  return 'Update';
}

function getGroupByKey(groupKey: string) {
  return renderGroups.value.find((group) => group.key === groupKey);
}

function getGroupActiveUpdateCount(group: ContainersViewRenderGroup) {
  return group.containers.filter((container) => {
    return isContainerUpdating(container) || isContainerQueued(container);
  }).length;
}

function isGroupUpdateInProgress(group: ContainersViewRenderGroup) {
  return getGroupActiveUpdateCount(group) > 0;
}

function getGroupFrozenTotal(group: ContainersViewRenderGroup) {
  return getBatch(group.key)?.frozenTotal;
}

function getGroupDoneCount(group: ContainersViewRenderGroup) {
  const batch = getBatch(group.key);
  if (!batch) {
    return undefined;
  }

  return batch.succeededCount + batch.failedCount;
}

function getContainerStatusLabel(container: { id?: unknown; name?: unknown; status?: string }) {
  if (isContainerScanning(container)) {
    return t('containerComponents.groupedViews.statusScanning');
  }
  if (isContainerUpdating(container)) {
    return t('containerComponents.groupedViews.statusUpdating');
  }
  if (isContainerQueued(container)) {
    return t('containerComponents.groupedViews.statusQueued');
  }
  return container.status ?? 'unknown';
}

function getContainerStatusTone(container: { id?: unknown; name?: unknown; status?: string }) {
  if (isContainerScanning(container)) {
    return 'neutral';
  }
  if (isContainerUpdating(container)) {
    return 'warning';
  }
  if (isContainerQueued(container)) {
    return 'neutral';
  }
  return container.status === 'running' ? 'success' : 'danger';
}

function getContainerStatusIcon(container: { id?: unknown; name?: unknown; status?: string }) {
  if (isContainerScanning(container)) {
    return 'spinner';
  }
  if (isContainerUpdating(container)) {
    return 'spinner';
  }
  if (isContainerQueued(container)) {
    return 'clock';
  }
  return container.status === 'running' ? 'play' : 'stop';
}

function getContainerStatusIconStyle(container: { id?: unknown; name?: unknown; status?: string }) {
  if (isContainerScanning(container)) {
    return { color: 'var(--dd-text-muted)' };
  }
  if (isContainerUpdating(container)) {
    return { color: 'var(--dd-warning)' };
  }
  if (isContainerQueued(container)) {
    return { color: 'var(--dd-text-muted)' };
  }
  return {
    color: container.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
  };
}

function isTableRowFullWidth(row: Record<string, unknown>) {
  return isGroupHeaderTableRow(row as GroupedTableRow);
}

function isTableRowInteractive(row: Record<string, unknown>) {
  return isContainerTableRow(row as GroupedTableRow);
}

function tableRowClass(row: Record<string, unknown>) {
  const typedRow = row as GroupedTableRow;
  if (!isContainerTableRow(typedRow)) {
    return '';
  }
  if (isRowLocked(typedRow)) {
    return 'dd-row-updating pointer-events-none';
  }
  if (isContainerScanning(typedRow.__source)) {
    return 'dd-row-scanning';
  }
  return '';
}

function getTableRowKey(row: Record<string, unknown>) {
  return (row as GroupedTableRow).__rowKey;
}

function selectTableRow(row: Record<string, unknown>) {
  const typedRow = row as GroupedTableRow;
  if (!isContainerTableRow(typedRow)) {
    return;
  }
  selectContainer(typedRow.__source);
}

// Timers for the display-hold window: keyed by groupKey, hold for ~1500ms
// at "Y of Y done" before clearing so the user can see the final count.
const batchClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

watchEffect(() => {
  batches.value;
  renderGroups.value.forEach((group) => {
    const batch = getBatch(group.key);
    if (!batch) {
      return;
    }
    const done = batch.succeededCount + batch.failedCount;
    if (done >= batch.frozenTotal) {
      // All terminal events received — start/reset the display-hold timer.
      if (!batchClearTimers.has(group.key)) {
        const timer = setTimeout(() => {
          batchClearTimers.delete(group.key);
          clearBatch(group.key);
        }, 1500);
        batchClearTimers.set(group.key, timer);
      }
    }
  });
});

// Resolve a groupKey for a given containerId by searching the current renderGroups.
function resolveGroupKeyForContainer(containerId: string): string | undefined {
  for (const group of renderGroups.value) {
    if (group.containers.some((c: { id?: string }) => c.id === containerId)) {
      return group.key;
    }
  }
  return undefined;
}

// Subscribe to per-container terminal events to tick the live counter.
function onUpdateApplied(event: Event) {
  const payload = (event as CustomEvent).detail as Record<string, unknown> | undefined;
  if (!payload) return;
  const containerId = typeof payload.containerId === 'string' ? payload.containerId : undefined;
  if (!containerId) return;
  const groupKey = resolveGroupKeyForContainer(containerId);
  if (!groupKey || !getBatch(groupKey)) return;
  incrementSucceeded(groupKey);
}

function onUpdateFailed(event: Event) {
  const payload = (event as CustomEvent).detail as Record<string, unknown> | undefined;
  if (!payload) return;
  const containerId = typeof payload.containerId === 'string' ? payload.containerId : undefined;
  if (!containerId) return;
  const groupKey = resolveGroupKeyForContainer(containerId);
  if (!groupKey || !getBatch(groupKey)) return;
  incrementFailed(groupKey);
}

// Subscribe to the batch-completion SSE event to fire the summary toast.
function onBatchUpdateCompleted(event: Event) {
  const payload = (event as CustomEvent).detail as Record<string, unknown> | undefined;
  if (!payload) return;

  const batchId = typeof payload.batchId === 'string' ? payload.batchId : undefined;
  const total = typeof payload.total === 'number' ? payload.total : 0;
  const succeeded = typeof payload.succeeded === 'number' ? payload.succeeded : 0;
  const failed = typeof payload.failed === 'number' ? payload.failed : 0;

  // Resolve a single group name only when every item in the batch belongs to
  // the same group; otherwise drop the "in <group>" qualifier rather than
  // mislabeling a flat "Update All" toast or showing the raw batchId UUID.
  let groupName: string | undefined;
  if (Array.isArray(payload.items)) {
    const items = payload.items as Array<{ containerId?: string }>;
    const groupKeys = new Set<string>();
    for (const item of items) {
      if (typeof item.containerId !== 'string') continue;
      const groupKey = resolveGroupKeyForContainer(item.containerId);
      if (groupKey) groupKeys.add(groupKey);
    }
    if (groupKeys.size === 1) {
      const onlyKey = groupKeys.values().next().value as string;
      const resolvedName =
        renderGroups.value.find((g: { key: string; name?: string | null }) => g.key === onlyKey)
          ?.name ?? onlyKey;
      groupName = displayGroupName(resolvedName);
    }
  }

  if (failed === 0) {
    toast.success(
      groupName
        ? t('containersView.toast.batchUpdated', { count: succeeded, group: groupName })
        : t('containersView.toast.batchUpdatedNoGroup', { count: succeeded }),
    );
  } else if (succeeded === 0) {
    toast.error(
      groupName
        ? t('containersView.toast.batchFailed', { count: failed, group: groupName })
        : t('containersView.toast.batchFailedNoGroup', { count: failed }),
    );
  } else {
    toast.warning(
      groupName
        ? t('containersView.toast.batchPartial', {
            succeeded,
            total,
            group: groupName,
            failed,
          })
        : t('containersView.toast.batchPartialNoGroup', { succeeded, total, failed }),
    );
  }
}

globalThis.addEventListener('dd:sse-update-applied', onUpdateApplied);
globalThis.addEventListener('dd:sse-update-failed', onUpdateFailed);
globalThis.addEventListener('dd:sse-batch-update-completed', onBatchUpdateCompleted);

// Clean up timers and event listeners when the component is torn down.
onScopeDispose(() => {
  for (const timer of batchClearTimers.values()) {
    clearTimeout(timer);
  }
  batchClearTimers.clear();
  globalThis.removeEventListener('dd:sse-update-applied', onUpdateApplied);
  globalThis.removeEventListener('dd:sse-update-failed', onUpdateFailed);
  globalThis.removeEventListener('dd:sse-batch-update-completed', onBatchUpdateCompleted);
});
</script>

<template>
  <div data-test="containers-grouped-views">
    <!-- GROUPED / FLAT CONTAINER VIEWS -->
    <template v-if="filteredContainers.length > 0">
      <DataTable
        v-if="containerViewMode === 'table'"
        :columns="tableColumns"
        :fixed-layout="true"
        :rows="tableRows"
        :row-key="getTableRowKey"
        :sort-key="containerSortKey"
        :sort-asc="containerSortAsc"
        :selected-key="selectedContainerKey"
        :show-actions="true"
        actions-width="180px"
        :virtual-scroll="false"
        :full-width-row="isTableRowFullWidth"
        :row-interactive="isTableRowInteractive"
        :row-class="tableRowClass"
        @update:sort-key="containerSortKey = $event"
        @update:sort-asc="containerSortAsc = $event"
        @row-click="selectTableRow($event)"
      >
        <template #full-row="{ row }">
          <ContainersGroupHeader
            v-if="isGroupHeaderTableRow(row)"
            :group="row.group"
            :is-first="row.isFirst"
            :collapsed="collapsedGroups.has(row.group.key)"
            :container-actions-enabled="containerActionsEnabled"
            :container-actions-disabled-reason="containerActionsDisabledReason"
            :in-progress="isGroupUpdateInProgress(row.group)"
            :frozen-total="getGroupFrozenTotal(row.group)"
            :done-count="getGroupDoneCount(row.group)"
            :tt="tt"
            @toggle="toggleGroupCollapse"
            @update-all="updateAllInGroup($event)"
          />
        </template>
        <!-- Container icon (own column) -->
        <template #cell-icon="{ row: c }">
          <div
            v-if="isContainerScanning(c) || isContainerUpdating(c) || isContainerQueued(c)"
            class="dd-row-overlay absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          >
            <div
              class="flex items-center gap-2 px-4 py-1.5 dd-rounded text-2xs-plus font-bold uppercase tracking-wider shadow-lg"
              :style="{
                backgroundColor: 'var(--dd-bg-elevated)',
                border: '1px solid var(--dd-border)',
                color: 'var(--dd-text)',
              }"
            >
              <AppIcon
                :name="isContainerQueued(c) && !isContainerUpdating(c) && !isContainerScanning(c) ? 'clock' : 'spinner'"
                :size="14"
                :class="isContainerQueued(c) && !isContainerUpdating(c) && !isContainerScanning(c) ? '' : 'dd-spin'"
              />
              <span>{{ isContainerQueued(c) && !isContainerUpdating(c) && !isContainerScanning(c) ? t('containerComponents.groupedViews.statusQueued') : isContainerScanning(c) && !isContainerUpdating(c) ? t('containerComponents.groupedViews.statusScanning') : getInProgressBadgeLabel(c) }}</span>
            </div>
          </div>
          <ContainerIcon :icon="c.icon" :size="32" />
        </template>

        <!-- Container name + image (+ compact actions & badges) -->
        <template #cell-name="{ row: c }">
          <div class="min-w-0">
              <div class="flex items-center gap-2">
                <div class="font-medium truncate dd-text flex-1">{{ c.name }}</div>
              </div>
              <div class="text-2xs mt-0.5 truncate dd-text-muted">{{ c.image }}</div>
          </div>
        </template>
        <!-- Version comparison -->
        <template #cell-version="{ row: c }">
            <div v-if="c.newTag" class="flex items-center justify-center gap-1.5 w-full">
            <span class="text-2xs-plus dd-text-secondary truncate shrink-0 max-w-[100px]" v-tooltip.top="c.currentTag">{{ c.currentTag }}</span>
            <AppIcon name="arrow-right" :size="8" class="dd-text-muted shrink-0" />
            <CopyableTag :tag="c.newTag" class="text-2xs-plus font-semibold truncate max-w-[140px]" style="color: var(--dd-primary);" @click.stop>{{ c.newTag }}</CopyableTag>
          </div>
          <div v-else class="text-center">
            <div class="inline-flex items-center justify-center gap-1">
              <span class="text-2xs-plus dd-text-secondary truncate max-w-[140px]" v-tooltip.top="c.currentTag">{{ c.currentTag }}</span>
              <NoUpdateReasonBadge v-if="c.noUpdateReason" :reason="c.noUpdateReason" />
            </div>
            <div v-if="getContainerListPolicyState(c).snoozed || getContainerListPolicyState(c).skipped || getContainerListPolicyState(c).maturityBlocked"
                 class="mt-1 inline-flex items-center justify-center gap-1">
              <span v-if="getContainerListPolicyState(c).snoozed"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-info);"
                    :aria-label="t('containerComponents.groupedViews.ariaSnoozedUpdates')"
                    v-tooltip.top="tt(containerPolicyTooltip(c, 'snoozed'))">
                <AppIcon name="pause" :size="14" />
              </span>
              <span v-if="getContainerListPolicyState(c).skipped"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-warning);"
                    :aria-label="t('containerComponents.groupedViews.ariaSkippedUpdates')"
                    v-tooltip.top="tt(containerPolicyTooltip(c, 'skipped'))">
                <AppIcon name="skip-forward" :size="14" />
              </span>
              <span v-if="getContainerListPolicyState(c).maturityBlocked"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-primary);"
                    :aria-label="t('containerComponents.groupedViews.ariaMaturityBlocked')"
                    v-tooltip.top="tt(containerPolicyTooltip(c, 'maturity'))">
                <AppIcon name="clock" :size="14" />
              </span>
            </div>
          </div>
        </template>
        <!-- Kind badge (3 breaks: icon-only → stack → row) -->
        <template #cell-kind="{ row: c }">
          <div class="flex flex-col @[160px]:flex-row items-center justify-center gap-1">
            <AppBadge
              v-if="c.updateKind"
              size="xs"
              :custom="{ bg: updateKindColor(c.updateKind).bg, text: updateKindColor(c.updateKind).text }"
              v-tooltip.top="tt(c.updateKind)"
            >
              <AppIcon :name="c.updateKind === 'major' ? 'chevrons-up' : c.updateKind === 'minor' ? 'chevron-up' : c.updateKind === 'patch' ? 'hashtag' : 'fingerprint'" :size="12" />
              <span class="dd-cell-show-100 ml-1">{{ c.updateKind }}</span>
            </AppBadge>
            <AppBadge
              v-else-if="getContainerListPolicyState(c).skipped"
              size="xs"
              v-tooltip.top="t('containerComponents.groupedViews.pinnedTooltip')"
              :custom="{ bg: 'var(--dd-success-muted)', text: 'var(--dd-success)' }"
            >
              <AppIcon name="pin" :size="12" />
              <span class="dd-cell-show-100 ml-1">{{ t('containerComponents.groupedViews.pinnedTooltip') }}</span>
            </AppBadge>
            <AppBadge
              v-else-if="!c.updateKind && !c.updateMaturity && !c.suggestedTag"
              size="xs"
              v-tooltip.top="t('containerComponents.groupedViews.upToDateTooltip')"
              :custom="{ bg: 'var(--dd-success-muted)', text: 'var(--dd-success)' }"
            >
              <AppIcon name="up-to-date" :size="12" />
              <span class="dd-cell-show-100 ml-1">{{ t('containerComponents.groupedViews.upToDateTooltip') }}</span>
            </AppBadge>
            <AppBadge
              v-if="c.newTag && c.bouncer === 'blocked'"
              tone="danger"
              size="xs"
              class="px-1.5 py-0 dd-cell-show-100"
              v-tooltip.top="tt(blockedUpdateTooltip(c))"
            >
              <AppIcon name="lock" :size="12" class="mr-0.5" />
              {{ t('containerComponents.groupedViews.blockedTooltip') }}
            </AppBadge>
            <UpdateMaturityBadge class="dd-cell-show-100" :maturity="c.updateMaturity" :tooltip="c.updateMaturityTooltip" />
            <SuggestedTagBadge class="dd-cell-show-100" :tag="c.suggestedTag" :current-tag="c.currentTag" />
          </div>
        </template>
        <!-- Status (2 breaks: icon-only → badge+text) -->
        <template #cell-status="{ row: c }">
          <div class="flex items-center justify-center">
            <AppBadge size="xs" :tone="getContainerStatusTone(c)" v-tooltip.top="tt(getContainerStatusLabel(c))">
              <AppIcon :name="getContainerStatusIcon(c)" :size="12" :style="getContainerStatusIconStyle(c)" />
              <span class="dd-cell-show-80 ml-1">{{ getContainerStatusLabel(c) }}</span>
            </AppBadge>
          </div>
        </template>
        <!-- Bouncer column removed — blocked state integrated into update button -->
        <!-- Image Age -->
        <template #cell-imageAge="{ row: c }">
          <span class="text-2xs-plus dd-text-secondary whitespace-nowrap"
                v-tooltip.top="c.imageCreated ? tt(new Date(c.imageCreated).toLocaleString()) : undefined">
            {{ imageAge(c.imageCreated) }}
          </span>
        </template>
        <!-- Server -->
        <template #cell-server="{ row: c }">
          <AppBadge
            size="xs"
            :custom="{ bg: serverBadgeColor(c.server).bg, text: serverBadgeColor(c.server).text }"
            v-tooltip.top="tt(c.server)"
          >
            <span class="block max-w-[140px] truncate">
              {{ c.server }}
            </span>
          </AppBadge>
        </template>
        <!-- Registry badge -->
        <template #cell-registry="{ row: c }">
          <div class="inline-flex items-center justify-center gap-1.5">
            <AppBadge
              size="xs"
              :custom="{ bg: registryColorBg(c.registry), text: registryColorText(c.registry) }"
              v-tooltip.top="tt(registryLabel(c.registry, c.registryUrl, c.registryName))"
            >
              <span class="block max-w-[140px] truncate">
                {{ registryLabel(c.registry, c.registryUrl, c.registryName) }}
              </span>
            </AppBadge>
            <span v-if="hasRegistryError(c)"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-danger);"
                  aria-label="Registry error"
                  v-tooltip.top="tt(registryErrorTooltip(c))">
              <AppIcon name="warning" :size="12" />
            </span>
          </div>
        </template>
        <!-- Actions -->
        <template #actions="{ row: c }">
          <template v-if="!containerActionsEnabled">
            <div class="flex items-center justify-end gap-2">
              <span class="text-2xs dd-text-muted">{{ t('containerComponents.groupedViews.actionsDisabled') }}</span>
              <AppIconButton icon="lock" size="sm" variant="muted"
                class="cursor-not-allowed opacity-60"
                :disabled="true"
                :tooltip="tt(containerActionsDisabledReason)"
                @click.stop />
            </div>
          </template>
          <!-- Icon-style actions (compact) -->
          <template v-else-if="tableActionStyle === 'icons'">
            <div class="flex items-center justify-end gap-0.5">
              <ReleaseNotesLink
                v-if="c.releaseNotes?.url || c.currentReleaseNotes?.url || c.releaseLink"
                :release-notes="c.releaseNotes"
                :current-release-notes="c.currentReleaseNotes"
                :release-link="c.releaseLink"
                icon-only
              />
              <ProjectLink v-if="c.sourceRepo" :source-repo="c.sourceRepo" icon-only />
              <AppIconButton v-if="updateBtnState(c) === 'hard'" icon="lock" size="sm" variant="muted"
                      class="cursor-not-allowed opacity-50"
                      :disabled="true"
                      :tooltip="tt(updateBtnTooltip(c))" @click.stop />
              <AppIconButton v-else-if="updateBtnState(c) === 'soft'" icon="cloud-download" size="sm" variant="warning"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt(updateBtnTooltip(c))" @click.stop="confirmUpdate(c)" />
              <AppIconButton v-else-if="updateBtnState(c) === 'ready'" icon="cloud-download" size="sm" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt(updateBtnTooltip(c))" @click.stop="confirmUpdate(c)" />
              <AppIconButton v-else-if="c.status === 'running'" icon="stop" size="sm" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-danger hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt('Stop')" @click.stop="confirmStop(c)" />
              <AppIconButton v-else icon="play" size="sm" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt('Start')" @click.stop="startContainer(c)" />
              <AppIconButton v-if="canCancelUpdate(c)" icon="x" size="sm" variant="danger"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow] hover:dd-bg-hover hover:scale-110 active:scale-95"
                      :tooltip="tt('Cancel update')" @click.stop="cancelUpdate(c)" />
              <AppIconButton icon="more" size="sm" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="[
                        isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text hover:dd-bg-hover hover:scale-110 active:scale-95',
                        openActionsMenu === c.id && !isRowLocked(c) ? 'dd-bg-elevated dd-text' : '',
                      ]"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt('More')" @click.stop="toggleActionsMenu(c.id, $event)" />
            </div>
          </template>
          <!-- Button-style actions (full) -->
          <template v-else>
            <div class="flex items-center justify-end gap-1">
              <ReleaseNotesLink
                v-if="c.releaseNotes?.url || c.currentReleaseNotes?.url || c.releaseLink"
                :release-notes="c.releaseNotes"
                :current-release-notes="c.currentReleaseNotes"
                :release-link="c.releaseLink"
                icon-only
              />
              <ProjectLink v-if="c.sourceRepo" :source-repo="c.sourceRepo" icon-only />
              <AppButton v-if="canCancelUpdate(c)" size="none" variant="plain" weight="none"
                      class="inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-2xs-plus font-bold tracking-wide transition-colors hover:brightness-110"
                      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)', borderRadius: 'var(--dd-radius)' }"
                      @click.stop="cancelUpdate(c)">
                <AppIcon name="x" :size="12" class="mr-1" /> Cancel
              </AppButton>
            <div v-if="c.newTag" class="inline-flex items-center gap-1">
              <!-- Blocked: muted split button (any hard eligibility blocker) -->
              <div v-if="updateBtnState(c) === 'hard'" class="inline-flex dd-rounded overflow-hidden" style="min-width: 110px;"
                   v-tooltip.top="tt(updateBtnTooltip(c))">
                <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center flex-1 whitespace-nowrap px-3 py-1.5 text-2xs-plus font-bold tracking-wide cursor-not-allowed"
                        :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-text-muted)' }">
                  <AppIcon name="lock" :size="14" class="mr-1" /> Blocked
                </AppButton>
                <AppIconButton icon="chevron-down" size="toolbar" variant="plain"
                        class="transition-colors dd-text-muted hover:dd-text hover:dd-bg-hover"
                        :style="{ backgroundColor: 'var(--dd-bg)' }"
                        :class="openActionsMenu === c.id ? 'dd-bg-elevated dd-text' : ''"
                        :aria-label="t('containerComponents.groupedViews.openActionsMenu')"
                        @click.stop="toggleActionsMenu(c.id, $event)" />
              </div>
              <!-- Soft-blocked: amber split button (manual update still works, warn-and-confirm on click) -->
              <div v-else-if="updateBtnState(c) === 'soft'" class="inline-flex dd-rounded overflow-hidden"
                   :class="isRowLocked(c) ? 'opacity-50' : ''"
                   :style="{ border: '1px solid var(--dd-warning)' }"
                   v-tooltip.top="tt(updateBtnTooltip(c))">
                <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-2xs-plus font-bold tracking-wide transition-colors"
                        :class="isRowLocked(c) ? 'cursor-not-allowed' : ''"
                        :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }"
                        :disabled="isRowLocked(c)"
                        @click.stop="confirmUpdate(c)">
                  <AppIcon name="cloud-download" :size="14" class="mr-1" /> Update
                </AppButton>
                <AppIconButton icon="chevron-down" size="toolbar" variant="plain"
                        class="transition-colors"
                        :class="isRowLocked(c) ? 'cursor-not-allowed' : openActionsMenu === c.id ? 'brightness-125' : ''"
                        :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)', borderLeft: '1px solid var(--dd-warning)' }"
                        :disabled="isRowLocked(c)"
                        :aria-label="t('containerComponents.groupedViews.openUpdateActionsMenu')"
                        @click.stop="toggleActionsMenu(c.id, $event)" />
              </div>
              <!-- Ready: green split button -->
              <div v-else class="inline-flex dd-rounded overflow-hidden"
                   :class="isRowLocked(c) ? 'opacity-50' : ''"
                   :style="{ border: '1px solid var(--dd-success)' }">
                <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-2xs-plus font-bold tracking-wide transition-colors"
                        :class="isRowLocked(c) ? 'cursor-not-allowed' : ''"
                        :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }"
                        :disabled="isRowLocked(c)"
                        @click.stop="confirmUpdate(c)">
                  <AppIcon name="cloud-download" :size="14" class="mr-1" /> Update
                </AppButton>
                <AppIconButton icon="chevron-down" size="toolbar" variant="plain"
                        class="transition-colors"
                        :class="isRowLocked(c) ? 'cursor-not-allowed' : openActionsMenu === c.id ? 'brightness-125' : ''"
                        :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', borderLeft: '1px solid var(--dd-success)' }"
                        :disabled="isRowLocked(c)"
                        :aria-label="t('containerComponents.groupedViews.openUpdateActionsMenu')"
                        @click.stop="toggleActionsMenu(c.id, $event)" />
              </div>
            </div>
            <div v-else class="flex items-center justify-end gap-1">
              <AppIconButton v-if="c.status === 'running'"
                      icon="stop" size="toolbar" variant="danger"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt('Stop')" @click.stop="confirmStop(c)" />
              <AppIconButton v-else
                      icon="play" size="toolbar" variant="success"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt('Start')" @click.stop="startContainer(c)" />
              <AppIconButton icon="restart" size="toolbar" variant="muted"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt('Restart')" @click.stop="confirmRestart(c)" />
            </div>
            </div>
          </template>
        </template>
      </DataTable>

      <template v-else>
        <template v-for="group in renderGroups" :key="group.key">
          <ContainersGroupHeader
            v-if="groupByStack && group.key !== '__flat__'"
            :group="group"
            :is-first="group.key === renderGroups[0]?.key"
            :collapsed="collapsedGroups.has(group.key)"
            :container-actions-enabled="containerActionsEnabled"
            :container-actions-disabled-reason="containerActionsDisabledReason"
            :in-progress="isGroupUpdateInProgress(group)"
            :frozen-total="getGroupFrozenTotal(group)"
            :done-count="getGroupDoneCount(group)"
            :tt="tt"
            @toggle="toggleGroupCollapse"
            @update-all="updateAllInGroup($event)"
          />

          <!-- Group body (collapsible) -->
          <div v-show="!collapsedGroups.has(group.key)">

      <!-- CONTAINER CARD GRID -->
      <DataCardGrid v-if="containerViewMode === 'cards'"
                    :items="group.containers"
                    :item-key="getContainerViewKey"
                    :selected-key="selectedContainer ? getContainerViewKey(selectedContainer) : null"
                    @item-click="selectContainer($event)">
        <template #card="{ item: c }">
          <div
            class="flex flex-col flex-1 transition-opacity"
            :class="{ 'opacity-30': isRowLocked(c) }"
          >
          <!-- Card header -->
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <ContainerIcon :icon="c.icon" :size="44" class="shrink-0" />
              <div class="min-w-0">
                <div class="text-sm-plus font-semibold truncate dd-text">
                  {{ c.name }}
                </div>
                <div class="text-2xs-plus truncate mt-0.5 dd-text-muted">
                  {{ c.image }}:{{ c.currentTag }} <span class="dd-text-secondary">&middot;</span> {{ parseServer(c.server).name }}<template v-if="parseServer(c.server).env"> <span class="dd-text-secondary">({{ parseServer(c.server).env }})</span></template>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0 ml-2">
              <AppBadge
                size="xs"
                :custom="{ bg: registryColorBg(c.registry), text: registryColorText(c.registry) }"
                v-tooltip.top="tt(registryLabel(c.registry, c.registryUrl, c.registryName))"
              >
                <span class="block max-w-[140px] truncate">
                  {{ registryLabel(c.registry, c.registryUrl, c.registryName) }}
                </span>
              </AppBadge>
              <span v-if="hasRegistryError(c)"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-danger);"
                    :aria-label="t('containerComponents.groupedViews.ariaRegistryError')"
                    v-tooltip.top="tt(registryErrorTooltip(c))">
                <AppIcon name="warning" :size="12" />
              </span>
              <span v-if="getContainerListPolicyState(c).snoozed"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-info);"
                    :aria-label="t('containerComponents.groupedViews.ariaSnoozedUpdates')"
                    v-tooltip.top="tt(containerPolicyTooltip(c, 'snoozed'))">
                <AppIcon name="pause" :size="12" />
              </span>
              <span v-if="getContainerListPolicyState(c).skipped"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-warning);"
                    :aria-label="t('containerComponents.groupedViews.ariaSkippedUpdates')"
                    v-tooltip.top="tt(containerPolicyTooltip(c, 'skipped'))">
                <AppIcon name="skip-forward" :size="12" />
              </span>
              <span v-if="getContainerListPolicyState(c).maturityBlocked"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-primary);"
                    :aria-label="t('containerComponents.groupedViews.ariaMaturityBlocked')"
                    v-tooltip.top="tt(containerPolicyTooltip(c, 'maturity'))">
                <AppIcon name="clock" :size="12" />
              </span>
            </div>
          </div>

          <!-- Card body -- inline Current / Latest -->
          <div class="px-4 py-3 min-w-0">
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <span class="text-2xs-plus dd-text-muted shrink-0">{{ t('containerComponents.groupedViews.currentLabel') }}</span>
              <CopyableTag :tag="c.currentTag" class="text-xs font-bold dd-text truncate max-w-[120px]" @click.stop>
                {{ c.currentTag }}
              </CopyableTag>
              <template v-if="c.newTag">
                <span class="text-2xs-plus ml-1 dd-text-muted shrink-0">{{ t('containerComponents.groupedViews.latestLabel') }}</span>
                <CopyableTag :tag="c.newTag" class="text-xs font-bold truncate max-w-[140px]"
                      :style="{ color: updateKindColor(c.updateKind).text }" @click.stop>
                  {{ c.newTag }}
                </CopyableTag>
                <span class="ml-1 shrink-0"><UpdateMaturityBadge :maturity="c.updateMaturity" :tooltip="c.updateMaturityTooltip" /></span>
              </template>
              <template v-else>
                <NoUpdateReasonBadge v-if="c.noUpdateReason" :reason="c.noUpdateReason" class="ml-1" />
                <template v-else-if="getContainerListPolicyState(c).snoozed || getContainerListPolicyState(c).skipped || getContainerListPolicyState(c).maturityBlocked">
                  <span v-if="getContainerListPolicyState(c).snoozed"
                        class="inline-flex items-center justify-center ml-1"
                        style="color: var(--dd-info);"
                        :aria-label="t('containerComponents.groupedViews.ariaSnoozedUpdates')"
                        v-tooltip.top="tt(containerPolicyTooltip(c, 'snoozed'))">
                    <AppIcon name="pause" :size="13" />
                  </span>
                  <span v-if="getContainerListPolicyState(c).skipped"
                        class="inline-flex items-center justify-center"
                        style="color: var(--dd-warning);"
                        :aria-label="t('containerComponents.groupedViews.ariaSkippedUpdates')"
                        v-tooltip.top="tt(containerPolicyTooltip(c, 'skipped'))">
                    <AppIcon name="skip-forward" :size="13" />
                  </span>
                  <span v-if="getContainerListPolicyState(c).maturityBlocked"
                        class="inline-flex items-center justify-center"
                        style="color: var(--dd-primary);"
                        :aria-label="t('containerComponents.groupedViews.ariaMaturityBlocked')"
                        v-tooltip.top="tt(containerPolicyTooltip(c, 'maturity'))">
                    <AppIcon name="clock" :size="13" />
                  </span>
                </template>
                <AppIcon v-else name="check" :size="14" class="ml-1" style="color: var(--dd-success);" v-tooltip.top="tt('Up to date')" />
              </template>
            </div>
            <div v-if="c.suggestedTag || c.releaseNotes || c.currentReleaseNotes || c.releaseLink || c.sourceRepo" class="flex items-center gap-2 flex-wrap mt-2">
              <SuggestedTagBadge :tag="c.suggestedTag" :current-tag="c.currentTag" />
              <ReleaseNotesLink
                :release-notes="c.releaseNotes"
                :current-release-notes="c.currentReleaseNotes"
                :release-link="c.releaseLink"
              />
              <ProjectLink :source-repo="c.sourceRepo" />
            </div>
          </div>

          <!-- Card footer -->
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{
                 borderTop: '1px solid var(--dd-border)',
                 backgroundColor: 'var(--dd-bg-elevated)',
               }">
            <AppBadge class="px-1.5 py-0 md:!hidden" size="xs" :tone="getContainerStatusTone(c)" v-tooltip.top="tt(getContainerStatusLabel(c))">
              <AppIcon :name="getContainerStatusIcon(c)" :size="12" :class="isContainerUpdating(c) || isContainerScanning(c) ? 'dd-spin' : ''" />
            </AppBadge>
            <AppBadge class="max-md:!hidden" size="xs" :tone="getContainerStatusTone(c)">
              <AppIcon v-if="isContainerUpdating(c) || isContainerScanning(c)" name="spinner" :size="12" class="mr-1 dd-spin" />
              <AppIcon v-else-if="isContainerQueued(c)" name="clock" :size="12" class="mr-1" />
              {{ getContainerStatusLabel(c) }}
            </AppBadge>
            <div class="flex items-center gap-1.5">
              <template v-if="containerActionsEnabled">
                <AppIconButton v-if="c.status === 'running'" icon="stop" size="xs" variant="muted"
                        :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-danger hover:dd-bg-elevated'"
                        :disabled="isRowLocked(c)"
                      :tooltip="tt('Stop')" @click.stop="confirmStop(c)" />
                <AppIconButton v-else icon="play" size="xs" variant="muted"
                        :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-elevated'"
                        :disabled="isRowLocked(c)"
                        :tooltip="tt('Start')" @click.stop="startContainer(c)" />
                <AppIconButton icon="restart" size="xs" variant="muted"
                        :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text hover:dd-bg-elevated'"
                        :disabled="isRowLocked(c)"
                        :tooltip="tt('Restart')" @click.stop="confirmRestart(c)" />
                <AppIconButton icon="security" size="xs" variant="muted"
                        class="hover:dd-text-secondary hover:dd-bg-elevated"
                        :tooltip="tt('Scan')" @click.stop="scanContainer(c)" />
                <AppIconButton v-if="updateBtnState(c) === 'hard'" icon="lock" size="xs" variant="muted"
                        class="opacity-60 cursor-not-allowed"
                        :disabled="true"
                        :tooltip="tt(updateBtnTooltip(c))" />
                <AppIconButton v-else-if="updateBtnState(c) === 'soft'" icon="cloud-download" size="xs" variant="warning"
                        :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-bg-elevated'"
                        :disabled="isRowLocked(c)"
                        :tooltip="tt(updateBtnTooltip(c))" @click.stop="confirmUpdate(c)" />
                <AppIconButton v-else-if="updateBtnState(c) === 'ready'" icon="cloud-download" size="xs" variant="muted"
                        :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-elevated'"
                        :disabled="isRowLocked(c)"
                        :tooltip="tt(updateBtnTooltip(c))" @click.stop="confirmUpdate(c)" />
              </template>
              <template v-else>
                <span class="text-2xs dd-text-muted">{{ t('containerComponents.groupedViews.actionsDisabled') }}</span>
                <AppIconButton icon="lock" size="xs" variant="muted"
                  class="cursor-not-allowed opacity-60"
                  :disabled="true"
                  :tooltip="tt(containerActionsDisabledReason)"
                  @click.stop />
              </template>
            </div>
          </div>
          </div>
          <div
            v-if="isContainerScanning(c) || isContainerUpdating(c) || isContainerQueued(c)"
            class="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          >
            <div
              class="flex items-center gap-2 px-4 py-2 dd-rounded text-sm font-bold uppercase tracking-wider shadow-lg"
              :style="{
                backgroundColor: 'var(--dd-bg-elevated)',
                border: '1px solid var(--dd-border)',
                color: 'var(--dd-text)',
              }"
            >
              <AppIcon
                :name="isContainerQueued(c) && !isContainerUpdating(c) && !isContainerScanning(c) ? 'clock' : 'spinner'"
                :size="18"
                :class="isContainerQueued(c) && !isContainerUpdating(c) && !isContainerScanning(c) ? '' : 'dd-spin'"
              />
              <span>{{ isContainerQueued(c) && !isContainerUpdating(c) && !isContainerScanning(c) ? t('containerComponents.groupedViews.statusQueued') : isContainerScanning(c) && !isContainerUpdating(c) ? t('containerComponents.groupedViews.statusScanning') : getInProgressBadgeLabel(c) }}</span>
            </div>
          </div>
        </template>
      </DataCardGrid>

      <!-- LIST VIEW -->
      <DataListAccordion v-if="containerViewMode === 'list'"
                         :items="group.containers"
                         :item-key="getContainerViewKey"
                         :selected-key="selectedContainer ? getContainerViewKey(selectedContainer) : null"
                         @item-click="selectContainer($event)">
        <template #header="{ item: c }">
          <AppIcon v-if="isContainerUpdating(c) || isContainerScanning(c)" name="spinner" :size="14" class="dd-spin dd-text-muted shrink-0" />
          <AppIcon v-else-if="isContainerQueued(c)" name="clock" :size="14" class="dd-text-muted shrink-0" />
          <ContainerIcon v-else :icon="c.icon" :size="28" class="shrink-0" />
          <div class="min-w-0 flex-1" :class="{ 'opacity-50': isRowLocked(c) }">
            <div class="text-sm font-semibold truncate dd-text">{{ c.name }}</div>
            <div class="text-2xs mt-0.5 truncate dd-text-muted" v-tooltip.top="`${c.image}:${c.currentTag}`">{{ c.image }}:{{ c.currentTag }}</div>
            <div
              v-if="isContainerScanning(c) && !isContainerUpdating(c)"
              class="text-2xs mt-0.5 inline-flex items-center gap-1 dd-text-muted">
              <AppIcon name="spinner" :size="10" class="dd-spin shrink-0" />
              {{ t('containerComponents.groupedViews.statusScanning') }}
            </div>
            <div
              v-else-if="isContainerUpdating(c)"
              class="text-2xs mt-0.5 inline-flex items-center gap-1"
              style="color: var(--dd-warning);">
              <AppIcon name="spinner" :size="10" class="dd-spin shrink-0" />
              {{ getInProgressBadgeLabel(c) }}
            </div>
            <div
              v-else-if="isContainerQueued(c)"
              class="text-2xs mt-0.5 inline-flex items-center gap-1 dd-text-muted">
              <AppIcon name="clock" :size="10" class="shrink-0" />
              {{ t('containerComponents.groupedViews.statusQueued') }}
            </div>
            <div
              v-else-if="isContainerRecentlyFailed(c)"
              class="text-2xs mt-0.5 inline-flex items-center gap-1 max-w-full"
              style="color: var(--dd-danger);"
              v-tooltip.top="recentFailureReasonText(c)">
              <AppIcon name="warning" :size="10" class="shrink-0" />
              <span class="truncate">{{ t('containerComponents.groupedViews.lastUpdateFailed', { reason: recentFailureReasonText(c) }) }}</span>
            </div>
            <div v-else-if="!c.newTag && c.noUpdateReason" class="mt-0.5">
              <NoUpdateReasonBadge :reason="c.noUpdateReason" />
            </div>
            <div
              v-if="c.suggestedTag || c.releaseNotes || c.currentReleaseNotes || c.releaseLink || c.sourceRepo"
              class="flex items-center gap-2 flex-wrap mt-1"
            >
              <SuggestedTagBadge :tag="c.suggestedTag" :current-tag="c.currentTag" />
              <ReleaseNotesLink
                :release-notes="c.releaseNotes"
                :current-release-notes="c.currentReleaseNotes"
                :release-link="c.releaseLink"
              />
              <ProjectLink :source-repo="c.sourceRepo" />
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <!-- Update kind: icon on mobile, badge on desktop -->
            <AppBadge v-if="c.updateKind" size="xs" class="px-1.5 py-0 md:!hidden"
                  v-tooltip.top="tt(c.updateKind)"
                  :custom="{ bg: updateKindColor(c.updateKind).bg, text: updateKindColor(c.updateKind).text }">
              <AppIcon :name="c.updateKind === 'major' ? 'chevrons-up' : c.updateKind === 'minor' ? 'chevron-up' : c.updateKind === 'patch' ? 'hashtag' : 'fingerprint'" :size="12" />
            </AppBadge>
            <AppBadge v-if="c.updateKind" size="xs" class="max-md:!hidden"
                  :custom="{ bg: updateKindColor(c.updateKind).bg, text: updateKindColor(c.updateKind).text }">
              {{ c.updateKind }}
            </AppBadge>
            <UpdateMaturityBadge :maturity="c.updateMaturity" :tooltip="c.updateMaturityTooltip" />
            <!-- Status: icon on mobile, badge on desktop -->
            <AppIcon :name="getContainerStatusIcon(c)" :size="13" class="shrink-0 md:!hidden"
                     :class="isContainerUpdating(c) || isContainerScanning(c) ? 'dd-spin' : ''"
                     v-tooltip.top="tt(getContainerStatusLabel(c))"
                     :style="getContainerStatusIconStyle(c)" />
            <AppBadge class="max-md:!hidden" size="xs" :tone="getContainerStatusTone(c)">
              <AppIcon v-if="isContainerUpdating(c) || isContainerScanning(c)" name="spinner" :size="12" class="mr-1 dd-spin" />
              <AppIcon v-else-if="isContainerQueued(c)" name="clock" :size="12" class="mr-1" />
              {{ getContainerStatusLabel(c) }}
            </AppBadge>
            <span v-if="hasRegistryError(c)"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-danger);"
                  aria-label="Registry error"
                  v-tooltip.top="tt(registryErrorTooltip(c))">
              <AppIcon name="warning" :size="12" />
            </span>
            <span v-if="getContainerListPolicyState(c).snoozed"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-info);"
                  aria-label="Snoozed updates"
                  v-tooltip.top="tt(containerPolicyTooltip(c, 'snoozed'))">
              <AppIcon name="pause" :size="12" />
            </span>
            <span v-if="getContainerListPolicyState(c).skipped"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-warning);"
                  aria-label="Skipped updates"
                  v-tooltip.top="tt(containerPolicyTooltip(c, 'skipped'))">
              <AppIcon name="skip-forward" :size="12" />
            </span>
            <span v-if="getContainerListPolicyState(c).maturityBlocked"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-primary);"
                  aria-label="Maturity-blocked updates"
                  v-tooltip.top="tt(containerPolicyTooltip(c, 'maturity'))">
              <AppIcon name="clock" :size="12" />
            </span>
            <!-- Bouncer: icon in badge -->
            <AppBadge v-if="c.bouncer === 'blocked'" tone="danger" size="xs" class="px-1.5 py-0" v-tooltip.top="tt(t('containerComponents.groupedViews.blockedByBouncer'))">
              <AppIcon name="blocked" :size="12" />
            </AppBadge>
            <!-- Server: icon on mobile, badge on desktop -->
            <AppIcon :name="parseServer(c.server).name === 'Local' ? 'home' : 'remote'" :size="12" class="shrink-0 dd-text-muted md:!hidden" v-tooltip.top="tt(parseServer(c.server).name)" />
            <AppBadge
              class="max-md:!hidden"
              size="xs"
              :custom="{ bg: serverBadgeColor(c.server).bg, text: serverBadgeColor(c.server).text }"
              v-tooltip.top="tt(parseServer(c.server).name)"
            >
              <span class="block max-w-[140px] truncate">
                {{ parseServer(c.server).name }}
              </span>
            </AppBadge>
          </div>
        </template>
      </DataListAccordion>

          </div><!-- /group body -->
        </template><!-- /v-for group -->
      </template>
    </template><!-- /filteredContainers.length > 0 -->

      <!-- Actions dropdown (teleported to body so it renders in all view modes) -->
      <Teleport to="body">
        <div v-if="containerActionsEnabled && openActionsContainer"
             class="z-modal min-w-[160px] py-1 dd-rounded shadow-lg"
             :style="{
               ...actionsMenuStyle,
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
               boxShadow: 'var(--dd-shadow-tooltip)',
             }"
             @click.stop>
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" v-if="openActionsContainer.status === 'running'"
                  @click="confirmStop(openActionsContainer); closeActionsMenu()">
            <AppIcon name="stop" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-danger)' }" />
            {{ t('containerComponents.groupedViews.stopAction') }}
          </AppButton>
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" v-else
                  @click="startContainer(openActionsContainer); closeActionsMenu()">
            <AppIcon name="play" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-success)' }" />
            {{ t('containerComponents.groupedViews.startAction') }}
          </AppButton>
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="confirmRestart(openActionsContainer); closeActionsMenu()">
            <AppIcon name="restart" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
            {{ t('containerComponents.groupedViews.restartAction') }}
          </AppButton>
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="scanContainer(openActionsContainer); closeActionsMenu()">
            <AppIcon name="security" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-secondary)' }" />
            {{ t('containerComponents.groupedViews.scanAction') }}
          </AppButton>
          <!-- Force update for blocked containers (even without newTag) -->
          <template v-if="openActionsContainer.bouncer === 'blocked' && !openActionsContainer.newTag">
            <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="confirmForceUpdate(openActionsContainer); closeActionsMenu()">
              <AppIcon name="bolt" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-warning)' }" />
              {{ t('containerComponents.groupedViews.forceUpdateAction') }}
            </AppButton>
          </template>
          <template v-if="openActionsContainer.newTag">
            <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" v-if="openActionsContainer.bouncer === 'blocked'"
                    @click="confirmForceUpdate(openActionsContainer); closeActionsMenu()">
              <AppIcon name="bolt" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-warning)' }" />
              {{ t('containerComponents.groupedViews.forceUpdateAction') }}
            </AppButton>
            <AppButton v-if="openActionsContainer.bouncer !== 'blocked'" size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text"
                    @click="confirmUpdate(openActionsContainer); closeActionsMenu()">
              <AppIcon name="cloud-download" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-success)' }" />
              {{ t('containerComponents.groupedViews.updateAction') }}
            </AppButton>
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="skipUpdate(openActionsContainer); closeActionsMenu()">
              <AppIcon name="skip-forward" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
              {{ t('containerComponents.groupedViews.skipUpdateAction') }}
            </AppButton>
          </template>
          <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text"
                  @click="selectContainer(openActionsContainer!); activeDetailTab = 'actions'; closeActionsMenu()">
            <AppIcon name="recent-updates" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
            {{ t('containerComponents.groupedViews.rollbackAction') }}
          </AppButton>
          <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2" style="color: var(--dd-danger);"
                  @click="confirmDelete(openActionsContainer); closeActionsMenu()">
            <AppIcon name="trash" :size="12" class="w-3 text-center inline-flex justify-center" />
            {{ t('containerComponents.groupedViews.deleteAction') }}
          </AppButton>
        </div>
      </Teleport>

      <!-- EMPTY STATE -->
      <EmptyState v-if="filteredContainers.length === 0"
                  icon="filter"
                  message="No containers match your filters"
                  :show-clear="activeFilterCount > 0 || !!filterSearch"
                  @clear="clearFilters" />
  </div>
</template>
