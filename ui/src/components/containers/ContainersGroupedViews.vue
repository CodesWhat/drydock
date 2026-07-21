<script setup lang="ts">
import { computed, onScopeDispose, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIconButton from '../AppIconButton.vue';
import type { ContainersViewRenderGroup } from './containersViewTemplateContext';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';
import { useUpdateBatches } from '../../composables/useUpdateBatches';
import { getContainerViewKey } from '../../utils/container-view-key';
import {
  getUpdateInProgressPhaseLabelKey,
  UPDATE_IN_PROGRESS_PHASE_I18N,
} from '../../utils/container-update';
import { formatShortDigest } from '../../utils/digest-format';
import { formatUptimeFromIso } from '../../utils/uptime';
import { updateInsightColor } from '../../utils/display';
import { useNow } from '../../composables/useNow';
import { useColumnVisibility } from '../../composables/useColumnVisibility';
import {
  getPrimaryHardBlocker,
  getPrimarySoftBlocker,
  hasRawUpdateCandidate,
  updateButtonState,
  type UpdateButtonState,
} from '../../utils/update-eligibility';
import { getUpdateKindLabel as resolveUpdateKindLabel } from '../../utils/update-kind-labels';
import type { Container } from '../../types/container';
import SuggestedTagBadge from './SuggestedTagBadge.vue';
import ContainerLinkActions from './ContainerLinkActions.vue';
import ContainersGroupHeader from './ContainersGroupHeader.vue';
import NoUpdateReasonBadge from './NoUpdateReasonBadge.vue';

const {
  filteredContainers,
  renderGroups,
  groupByStack,
  containerViewMode,
  containerCardReflowForced,
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
  tableColumns,
  hiddenColumnKeys,
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
  recheckContainer,
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
  parseServer,
  registryLabel,
  activeFilterCount,
  filterSearch,
  clearFilters,
  updateMode: configuredUpdateMode,
} = useContainersViewTemplateContext();
const updateMode = computed(() => configuredUpdateMode?.value ?? 'manual');
const { visibleColumns } = useColumnVisibility();
const nowMs = useNow(30_000, () => visibleColumns.value.has('uptime'));
const { t, te } = useI18n();
const { batches, clearBatch, getBatch, incrementSucceeded, incrementFailed } = useUpdateBatches();

const openActionsContainer = computed(() =>
  openActionsMenu.value
    ? (displayContainers.value.find((container) => container.id === openActionsMenu.value) ?? null)
    : null,
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

function isUpdateHardBlocked(container: Pick<Container, 'updateEligibility'>) {
  return getPrimaryHardBlocker(container.updateEligibility) !== undefined;
}

function getUpdateHardBlockerMessage(container: Pick<Container, 'updateEligibility'>) {
  return (
    getPrimaryHardBlocker(container.updateEligibility)?.message ??
    t('containerComponents.groupedViews.blockedTooltip')
  );
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

function registryErrorPillLabel(c: {
  registryErrorKind?: 'rate-limited' | 'auth' | 'not-found' | 'transient' | 'unknown';
}): string {
  if (c.registryErrorKind === 'rate-limited')
    return t('containerComponents.groupedViews.registryErrorRateLimited');
  if (c.registryErrorKind === 'auth')
    return t('containerComponents.groupedViews.registryErrorAuth');
  if (c.registryErrorKind === 'not-found')
    return t('containerComponents.groupedViews.registryErrorNotFound');
  return t('containerComponents.groupedViews.registryErrorCheckFailed');
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
    const key =
      critical === 1
        ? 'containerComponents.groupedViews.blockedTagWithCriticals'
        : 'containerComponents.groupedViews.blockedTagWithCriticalsCVEs';
    return t(key, { tag, count: critical });
  }
  return t('containerComponents.groupedViews.blockedTag', { tag });
}

function canCancelUpdate(c: { updateOperation?: { status?: string; id?: string } }): boolean {
  const status = c.updateOperation?.status;
  return (status === 'queued' || status === 'in-progress') && Boolean(c.updateOperation?.id);
}

function getInProgressBadgeLabel(c: { updateOperation?: { phase?: string } }): string {
  const labelKey = getUpdateInProgressPhaseLabelKey(c.updateOperation?.phase);
  return t(UPDATE_IN_PROGRESS_PHASE_I18N[labelKey]);
}

function updateBtnState(c: {
  newTag?: string | null;
  newDigest?: string | null;
  updateEligibility?: Container['updateEligibility'];
  id?: unknown;
  name?: unknown;
}): UpdateButtonState {
  return updateButtonState(
    c.updateEligibility,
    hasRawUpdateCandidate(c),
    isContainerUpdateInProgress(c) || isContainerUpdateQueued(c),
    updateMode.value,
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
    return soft
      ? t('containerComponents.groupedViews.manualUpdateOnlyWithMessage', { message: soft.message })
      : t('containerComponents.groupedViews.manualUpdateOnly');
  }
  return t('containerComponents.groupedViews.updateBtnTooltipDefault');
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

function localizeStatus(status: string | undefined): string {
  if (!status) return t('common.unknown');
  const key = `containersView.status.${status}`;
  return te(key) ? t(key) : status;
}

function getContainerStatusLabel(container: {
  id?: unknown;
  name?: unknown;
  status?: string;
  updateOperation?: { phase?: string };
}) {
  if (isContainerScanning(container)) {
    return t('containerComponents.groupedViews.statusScanning');
  }
  if (isContainerUpdating(container)) {
    return getInProgressBadgeLabel(container);
  }
  if (isContainerQueued(container)) {
    return t('containerComponents.groupedViews.statusQueued');
  }
  return localizeStatus(container.status);
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

function getContainerStatusColor(container: { id?: unknown; name?: unknown; status?: string }) {
  return getContainerStatusIconStyle(container).color;
}

function getUpdateKindLabel(kind: Container['updateKind']): string {
  return resolveUpdateKindLabel(kind, t);
}

function updateInsightTooltip(insight: Container['updateInsight']): string {
  if (!insight) return '';
  return t('containerComponents.updateInsight.tooltip', { tag: insight.tag });
}

function getContainerUpdateStateLabel(
  container: Pick<Container, 'updateKind' | 'updateInsight'> & { name?: string },
) {
  if (container.updateKind) {
    return getUpdateKindLabel(container.updateKind);
  }
  if (getContainerListPolicyState(container).skipped) {
    return t('containerComponents.groupedViews.skippedLabel');
  }
  // Insight-only rows (pinned tag with a newer out-of-family candidate) read "Current":
  // the candidate is informational, surfaced by the tag-cell pin glyph + insight tooltip,
  // never as an actionable-looking update state (#498 pinned-chip inconsistency).
  return t('containerComponents.groupedViews.currentLabel');
}

function getContainerUpdateStateColor(
  container: Pick<Container, 'updateKind' | 'updateInsight'> & { name?: string },
) {
  if (container.updateKind) {
    return updateKindColor(container.updateKind).text;
  }
  if (getContainerListPolicyState(container).skipped) {
    return 'var(--dd-warning)';
  }
  return 'var(--dd-success)';
}

function getContainerUpdateStateTooltip(
  container: Pick<Container, 'updateKind' | 'updateInsight' | 'updateMaturityTooltip'> & {
    name?: string;
  },
) {
  if (container.updateKind) {
    return container.updateMaturityTooltip || getUpdateKindLabel(container.updateKind);
  }
  if (getContainerListPolicyState(container).skipped) {
    return containerPolicyTooltip(container, 'skipped');
  }
  if (container.updateInsight) return updateInsightTooltip(container.updateInsight);
  return t('containerComponents.groupedViews.upToDateTooltip');
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

globalThis.addEventListener('dd:sse-update-applied', onUpdateApplied);
globalThis.addEventListener('dd:sse-update-failed', onUpdateFailed);

// Clean up timers and event listeners when the component is torn down.
onScopeDispose(() => {
  for (const timer of batchClearTimers.values()) {
    clearTimeout(timer);
  }
  batchClearTimers.clear();
  globalThis.removeEventListener('dd:sse-update-applied', onUpdateApplied);
  globalThis.removeEventListener('dd:sse-update-failed', onUpdateFailed);
});
</script>

<template>
  <div data-test="containers-grouped-views">
    <!-- GROUPED / FLAT CONTAINER VIEWS -->
    <template v-if="filteredContainers.length > 0">
      <DataTable
        :columns="tableColumns"
        :hidden-column-keys="hiddenColumnKeys"
        storage-key="containers"
        :fixed-layout="true"
        :rows="tableRows"
        :row-key="getTableRowKey"
        :sort-key="containerSortKey"
        :sort-asc="containerSortAsc"
        :selected-key="selectedContainerKey"
        :show-actions="true"
        actions-width="180px"
        :virtual-scroll="false"
        :prefer-cards="containerViewMode === 'cards'"
        :hoist-card-sort="containerCardReflowForced || containerViewMode === 'cards'"
        :full-width-row="isTableRowFullWidth"
        :row-interactive="isTableRowInteractive"
        :row-class="tableRowClass"
        @update:sort-key="containerSortKey = $event"
        @update:sort-asc="containerSortAsc = $event"
        @update:card-reflow-forced="containerCardReflowForced = $event"
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
            :show-update-controls="updateMode !== 'notify'"
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
          <div>
          <div v-if="c.isDigestPinned && c.updateKind === 'digest' && c.newDigest && c.currentDigest" class="container-version-query">
            <div class="container-version-flow">
              <span class="inline-flex items-center gap-1 min-w-0">
                <AppIcon
                  v-if="c.tagPinGated"
                  name="pin"
                  :size="12"
                  class="dd-text-muted shrink-0"
                  data-test="container-tag-pinned-glyph"
                  :aria-label="t('containerComponents.groupedViews.ariaPinnedTag')"
                  v-tooltip.top="tt(t('containerComponents.groupedViews.pinnedTagTooltip'))"
                />
                <span class="container-version-tag text-2xs-plus dd-text-secondary" v-tooltip.top="c.currentDigest">{{ formatShortDigest(c.currentDigest) }}</span>
              </span>
              <AppIcon name="arrow-right" :size="8" class="container-version-arrow dd-text-muted shrink-0" />
              <CopyableTag :tag="c.newDigest" class="container-version-tag container-version-tag-target text-2xs-plus font-semibold" style="color: var(--dd-primary);" @click.stop>{{ formatShortDigest(c.newDigest) }}</CopyableTag>
            </div>
          </div>
          <!-- #356 / #370 regression guard: non-digest-pinned containers (floating or
               specific tag with digest watch, e.g. `:latest`, `v8.13.2`) show the
               human-readable TAG ONLY here — the digest delta belongs in the tooltip.
               Do NOT render a visible `sha256:… → sha256:…` pair in this branch; that
               display is for the digest-PINNED branch directly above. This bug has
               regressed twice (#356 fixed it, b40d3db8 re-broke it → #370). -->
          <div v-else-if="c.updateKind === 'digest' && c.newDigest && c.currentDigest" class="container-version-query">
            <div class="container-version-flow">
              <template v-if="c.updateInsight">
                <span class="inline-flex items-center gap-1 min-w-0">
                  <AppIcon
                    v-if="c.tagPinGated"
                    name="pin"
                    :size="12"
                    class="dd-text-muted shrink-0"
                    data-test="container-tag-pinned-glyph"
                    :aria-label="t('containerComponents.groupedViews.ariaPinnedTag')"
                    v-tooltip.top="tt(t('containerComponents.groupedViews.pinnedTagTooltip'))"
                  />
                  <CopyableTag
                    :tag="c.currentTag"
                    class="container-version-tag text-2xs-plus dd-text-secondary"
                    :idle-tooltip="tt(`${c.currentTag} — ${formatShortDigest(c.currentDigest)} → ${formatShortDigest(c.newDigest)}`)"
                    @click.stop
                  >{{ c.currentTag }}</CopyableTag>
                </span>
                <AppIcon name="arrow-right" :size="8" class="container-version-arrow dd-text-muted shrink-0" />
                <CopyableTag
                  :tag="c.updateInsight.tag"
                  class="container-version-tag container-version-tag-target text-2xs-plus font-semibold"
                  :style="{ color: updateInsightColor().text }"
                  :idle-tooltip="tt(updateInsightTooltip(c.updateInsight))"
                  @click.stop
                >{{ c.updateInsight.tag }}</CopyableTag>
                <NoUpdateReasonBadge v-if="c.noUpdateReason" :reason="c.noUpdateReason" />
              </template>
              <span v-else class="inline-flex items-center gap-1 min-w-0">
                <AppIcon
                  v-if="c.tagPinGated"
                  name="pin"
                  :size="12"
                  class="dd-text-muted shrink-0"
                  data-test="container-tag-pinned-glyph"
                  :aria-label="t('containerComponents.groupedViews.ariaPinnedTag')"
                  v-tooltip.top="tt(t('containerComponents.groupedViews.pinnedTagTooltip'))"
                />
                <CopyableTag
                  :tag="c.currentTag"
                  class="container-version-tag container-version-tag-target text-2xs-plus font-semibold"
                  style="color: var(--dd-primary);"
                  :idle-tooltip="tt(`${c.currentTag} — ${formatShortDigest(c.currentDigest)} → ${formatShortDigest(c.newDigest)}`)"
                  @click.stop
                >{{ c.currentTag }}</CopyableTag>
              </span>
            </div>
          </div>
          <div v-else-if="c.newTag" class="container-version-query">
            <div class="container-version-flow">
              <span class="inline-flex items-center gap-1 min-w-0">
                <AppIcon
                  v-if="c.tagPinGated"
                  name="pin"
                  :size="12"
                  class="dd-text-muted shrink-0"
                  data-test="container-tag-pinned-glyph"
                  :aria-label="t('containerComponents.groupedViews.ariaPinnedTag')"
                  v-tooltip.top="tt(t('containerComponents.groupedViews.pinnedTagTooltip'))"
                />
                <span class="container-version-tag text-2xs-plus dd-text-secondary" v-tooltip.top="c.currentTag">{{ c.currentTag }}</span>
              </span>
              <AppIcon name="arrow-right" :size="8" class="container-version-arrow dd-text-muted shrink-0" />
              <CopyableTag :tag="c.newTag" class="container-version-tag container-version-tag-target text-2xs-plus font-semibold" style="color: var(--dd-primary);" @click.stop>{{ c.newTag }}</CopyableTag>
            </div>
          </div>
          <div v-else-if="c.updateInsight" class="container-version-query">
            <div class="container-version-flow">
              <span class="inline-flex items-center gap-1 min-w-0">
                <AppIcon
                  v-if="c.tagPinGated"
                  name="pin"
                  :size="12"
                  class="dd-text-muted shrink-0"
                  data-test="container-tag-pinned-glyph"
                  :aria-label="t('containerComponents.groupedViews.ariaPinnedTag')"
                  v-tooltip.top="tt(t('containerComponents.groupedViews.pinnedTagTooltip'))"
                />
                <span class="container-version-tag text-2xs-plus dd-text-secondary" v-tooltip.top="c.currentTag">{{ c.currentTag }}</span>
              </span>
              <AppIcon name="arrow-right" :size="8" class="container-version-arrow dd-text-muted shrink-0" />
              <CopyableTag
                :tag="c.updateInsight.tag"
                class="container-version-tag container-version-tag-target text-2xs-plus font-semibold"
                :style="{ color: updateInsightColor().text }"
                :idle-tooltip="tt(updateInsightTooltip(c.updateInsight))"
                @click.stop
              >{{ c.updateInsight.tag }}</CopyableTag>
              <NoUpdateReasonBadge v-if="c.noUpdateReason" :reason="c.noUpdateReason" />
            </div>
          </div>
          <div v-else class="text-center">
            <div v-if="c.registryError" class="inline-flex items-center justify-center gap-1 px-1.5 py-0.5 dd-rounded" style="background-color: var(--dd-danger-muted);" v-tooltip.top="tt(registryErrorTooltip(c))">
              <AppIcon name="warning" :size="10" style="color: var(--dd-danger);" class="shrink-0" />
              <span class="text-2xs-plus font-medium" style="color: var(--dd-danger);">{{ registryErrorPillLabel(c) }}</span>
            </div>
            <template v-else>
              <div class="inline-flex items-center justify-center gap-1">
                <AppIcon
                  v-if="c.tagPinGated"
                  name="pin"
                  :size="12"
                  class="dd-text-muted shrink-0"
                  data-test="container-tag-pinned-glyph"
                  :aria-label="t('containerComponents.groupedViews.ariaPinnedTag')"
                  v-tooltip.top="tt(t('containerComponents.groupedViews.pinnedTagTooltip'))"
                />
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
            </template>
          </div>
          </div>
        </template>
        <!-- Software version (OCI org.opencontainers.image.version or dd.inspect.tag.path value; falls back to image tag) -->
        <template #cell-softwareVersion="{ row: c }">
          <div class="text-center">
            <span class="text-2xs-plus dd-text-secondary truncate max-w-[140px]"
                  v-tooltip.top="c.softwareVersion ?? c.currentTag"
                  data-test="container-software-version-col">
              {{ c.softwareVersion ?? c.currentTag }}
            </span>
          </div>
        </template>
        <!-- Update state -->
        <template #cell-kind="{ row: c }">
          <div
            data-test="container-update-state"
            class="flex min-w-0 flex-col items-center justify-center gap-0.5 text-2xs-plus"
          >
            <span
              class="inline-flex min-w-0 items-center gap-1.5 font-semibold"
              :style="{ color: getContainerUpdateStateColor(c) }"
              v-tooltip.top="tt(getContainerUpdateStateTooltip(c))"
            >
              <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: getContainerUpdateStateColor(c) }"></span>
              <span class="truncate">{{ getContainerUpdateStateLabel(c) }}</span>
            </span>
            <span
              v-if="c.newTag && c.bouncer === 'blocked'"
              class="inline-flex items-center gap-1 text-2xs dd-text-danger"
              v-tooltip.top="tt(blockedUpdateTooltip(c))"
            >
              <AppIcon name="lock" :size="11" />
              {{ t('containerComponents.groupedViews.blockedByBouncer') }}
            </span>
            <SuggestedTagBadge :tag="c.suggestedTag" :current-tag="c.currentTag" />
          </div>
        </template>
        <!-- Status -->
        <template #cell-status="{ row: c }">
          <div class="flex items-center justify-center">
            <span
              data-test="container-runtime-status"
              class="inline-flex items-center gap-1.5 text-2xs-plus font-medium"
              :style="{ color: getContainerStatusColor(c) }"
              v-tooltip.top="tt(getContainerStatusLabel(c))"
            >
              <AppIcon
                v-if="isContainerUpdating(c) || isContainerScanning(c) || isContainerQueued(c)"
                :name="getContainerStatusIcon(c)"
                :size="12"
                :class="isContainerUpdating(c) || isContainerScanning(c) ? 'dd-spin' : ''"
              />
              <span v-else class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: getContainerStatusColor(c) }"></span>
              <span class="dd-cell-show-80">{{ getContainerStatusLabel(c) }}</span>
            </span>
          </div>
        </template>
        <!-- Bouncer column removed — blocked state integrated into update button -->
        <!-- Server -->
        <template #cell-server="{ row: c }">
          <span
            data-test="container-server-text"
            class="block max-w-[140px] truncate text-2xs-plus dd-text-secondary"
            v-tooltip.top="tt(c.server)"
          >
            {{ parseServer(c.server).name }}
          </span>
        </template>
        <!-- Registry -->
        <template #cell-registry="{ row: c }">
          <div class="inline-flex items-center justify-center gap-1.5">
            <span
              data-test="container-registry-text"
              class="block max-w-[140px] truncate text-2xs-plus dd-text-secondary"
              v-tooltip.top="tt(registryLabel(c.registry, c.registryUrl, c.registryName))"
            >
              {{ registryLabel(c.registry, c.registryUrl, c.registryName) }}
            </span>
            <span v-if="hasRegistryError(c)"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-danger);"
                  :aria-label="t('containerComponents.groupedViews.ariaRegistryError')"
                  v-tooltip.top="tt(registryErrorTooltip(c))">
              <AppIcon name="warning" :size="12" />
            </span>
          </div>
        </template>
        <!-- Resource links stay separate from lifecycle actions so every row keeps a stable
             Source → Release notes → Registry order without shifting Update/Stop/More. -->
        <template #cell-links="{ row: c }">
          <div class="flex items-center justify-center">
            <ContainerLinkActions
              :source-repo="c.sourceRepo"
              :release-notes="c.releaseNotes"
              :current-release-notes="c.currentReleaseNotes"
              :release-link="c.releaseLink"
              :container-id="c.id"
              :from-tag="c.currentTag"
              :to-tag="c.newTag"
              :registry="c.registry"
              :registry-name="c.registryName"
              :registry-url="c.registryUrl"
              icon-size="sm"
            />
          </div>
        </template>
        <!-- Uptime -->
        <template #cell-uptime="{ row: c }">
          <span class="text-2xs-plus dd-text-secondary font-mono">
            {{ formatUptimeFromIso(c.details?.startedAt, nowMs) }}
          </span>
        </template>
        <!-- Actions -->
        <template #actions="{ row: c, cardMode }">
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
          <!-- Icon-style actions (compact). In table mode each AppIconButton is `toolbar`
               size (w-8=32px) so all icons share the same fixed width and
               justify-end pins them to consistent X positions across rows,
               while still fitting the 180px actions column. In card mode (cardMode=true)
               they size up to `sm` (44px) touch targets — same buttons, same handlers. -->
          <template v-else-if="tableActionStyle === 'icons'">
            <div class="flex items-center justify-end gap-0.5">
              <AppIconButton v-if="updateBtnState(c) === 'hard'" icon="lock" :size="cardMode ? 'sm' : 'toolbar'" variant="muted"
                      class="cursor-not-allowed opacity-50"
                      :disabled="true"
                      :tooltip="tt(updateBtnTooltip(c))" @click.stop />
              <AppIconButton v-else-if="updateBtnState(c) === 'soft'" icon="cloud-download" :size="cardMode ? 'sm' : 'toolbar'" variant="warning"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt(updateBtnTooltip(c))" @click.stop="confirmUpdate(c)" />
              <AppIconButton v-else-if="updateBtnState(c) === 'ready'" icon="cloud-download" :size="cardMode ? 'sm' : 'toolbar'" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt(updateBtnTooltip(c))" @click.stop="confirmUpdate(c)" />
              <AppIconButton v-else-if="c.status === 'running'" icon="stop" :size="cardMode ? 'sm' : 'toolbar'" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-danger hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt(t('containerComponents.groupedViews.stopAction'))" @click.stop="confirmStop(c)" />
              <AppIconButton v-else icon="play" :size="cardMode ? 'sm' : 'toolbar'" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt(t('containerComponents.groupedViews.startAction'))" @click.stop="startContainer(c)" />
              <AppIconButton v-if="canCancelUpdate(c)" icon="x" :size="cardMode ? 'sm' : 'toolbar'" variant="danger"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow] hover:dd-bg-hover hover:scale-110 active:scale-95"
                      :tooltip="tt(t('containerComponents.groupedViews.cancelUpdateTooltip'))" @click.stop="cancelUpdate(c)" />
              <AppIconButton icon="more" :size="cardMode ? 'sm' : 'toolbar'" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="[
                        isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text hover:dd-bg-hover hover:scale-110 active:scale-95',
                        openActionsMenu === c.id && !isRowLocked(c) ? 'dd-bg-elevated dd-text' : '',
                      ]"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt(t('containerComponents.groupedViews.moreButton'))" @click.stop="toggleActionsMenu(c.id, $event)" />
            </div>
          </template>
          <!-- Button-style actions (full) -->
          <template v-else>
            <div class="flex items-center justify-end gap-1">
              <AppButton
                      v-if="canCancelUpdate(c)"
                      size="md"
                      variant="danger"
                      weight="bold"
                      class="inline-flex items-center justify-center whitespace-nowrap"
                      @click.stop="cancelUpdate(c)">
                <AppIcon name="x" :size="12" class="mr-1" /> {{ t('containerComponents.groupedViews.cancelButton') }}
              </AppButton>
            <div v-if="hasRawUpdateCandidate(c) && updateBtnState(c) !== 'none'" class="inline-flex items-center gap-1">
              <!-- Blocked: muted split button (any hard eligibility blocker) -->
              <div v-if="updateBtnState(c) === 'hard'" class="inline-flex min-w-[110px] dd-rounded overflow-hidden border dd-border-strong"
                   v-tooltip.top="tt(updateBtnTooltip(c))">
                <AppButton
                        size="md"
                        variant="muted-subtle"
                        weight="bold"
                        class="inline-flex items-center justify-center flex-1 whitespace-nowrap cursor-not-allowed"
                        disabled>
                  <AppIcon name="lock" :size="14" class="mr-1" /> {{ t('containerComponents.groupedViews.blockedButton') }}
                </AppButton>
                <AppIconButton icon="chevron-down" size="toolbar" variant="muted-subtle"
                        class="transition-colors border-l dd-border-strong"
                        :class="openActionsMenu === c.id ? 'dd-bg-elevated dd-text' : ''"
                        :aria-label="t('containerComponents.groupedViews.openActionsMenu')"
                        @click.stop="toggleActionsMenu(c.id, $event)" />
              </div>
              <!-- Soft-blocked: amber split button (manual update still works, warn-and-confirm on click) -->
              <div v-else-if="updateBtnState(c) === 'soft'" class="inline-flex dd-rounded overflow-hidden border dd-border-warning"
                   :class="isRowLocked(c) ? 'opacity-50' : ''"
                   v-tooltip.top="tt(updateBtnTooltip(c))">
                <AppButton
                        size="md"
                        variant="warning-subtle"
                        weight="bold"
                        class="inline-flex items-center justify-center whitespace-nowrap transition-colors"
                        :class="isRowLocked(c) ? 'cursor-not-allowed' : ''"
                        :disabled="isRowLocked(c)"
                        @click.stop="confirmUpdate(c)">
                  <AppIcon name="cloud-download" :size="14" class="mr-1" /> {{ t('containerComponents.groupedViews.updateButton') }}
                </AppButton>
                <AppIconButton icon="chevron-down" size="toolbar" variant="warning-subtle"
                        class="transition-colors border-l dd-border-warning"
                        :class="isRowLocked(c) ? 'cursor-not-allowed' : openActionsMenu === c.id ? 'brightness-125' : ''"
                        :disabled="isRowLocked(c)"
                        :aria-label="t('containerComponents.groupedViews.openUpdateActionsMenu')"
                        @click.stop="toggleActionsMenu(c.id, $event)" />
              </div>
              <!-- Ready: green split button -->
              <div v-else class="inline-flex dd-rounded overflow-hidden border dd-border-success"
                   :class="isRowLocked(c) ? 'opacity-50' : ''">
                <AppButton
                        size="md"
                        variant="success-subtle"
                        weight="bold"
                        class="inline-flex items-center justify-center whitespace-nowrap transition-colors"
                        :class="isRowLocked(c) ? 'cursor-not-allowed' : ''"
                        :disabled="isRowLocked(c)"
                        @click.stop="confirmUpdate(c)">
                  <AppIcon name="cloud-download" :size="14" class="mr-1" /> {{ t('containerComponents.groupedViews.updateButton') }}
                </AppButton>
                <AppIconButton icon="chevron-down" size="toolbar" variant="success-subtle"
                        class="transition-colors border-l dd-border-success"
                        :class="isRowLocked(c) ? 'cursor-not-allowed' : openActionsMenu === c.id ? 'brightness-125' : ''"
                        :disabled="isRowLocked(c)"
                        :aria-label="t('containerComponents.groupedViews.openUpdateActionsMenu')"
                        @click.stop="toggleActionsMenu(c.id, $event)" />
              </div>
            </div>
            <div v-else class="flex items-center justify-end gap-1">
              <AppIconButton v-if="c.status === 'running'"
                      icon="stop" size="toolbar" variant="danger"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt(t('containerComponents.groupedViews.stopAction'))" @click.stop="confirmStop(c)" />
              <AppIconButton v-else
                      icon="play" size="toolbar" variant="success"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt(t('containerComponents.groupedViews.startAction'))" @click.stop="startContainer(c)" />
              <AppIconButton icon="restart" size="toolbar" variant="muted"
                      :disabled="isRowLocked(c)"
                      :tooltip="tt(t('containerComponents.groupedViews.restartAction'))" @click.stop="confirmRestart(c)" />
            </div>
            </div>
          </template>
        </template>

        <!-- Card view -->
        <template #card="{ row: c, selected }">
          <!-- `selected` (the outer DataTable wrapper already draws the selection border/ring
               via its own scoped `.dd-data-table-card-selected` class) is intentionally unused
               here — this slot's content only owns the interior, never the card's own chrome. -->
          <div
            class="relative flex flex-col flex-1 transition-opacity"
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
                  {{ c.image }}:{{ c.currentTag }} <span class="dd-text-secondary">&middot;</span>
                  <span data-test="container-card-server-text">{{ parseServer(c.server).name }}</span><template v-if="parseServer(c.server).env"> <span class="dd-text-secondary">({{ parseServer(c.server).env }})</span></template>
                  <span class="dd-text-secondary">&middot;</span>
                  <span data-test="container-card-registry-text">{{ registryLabel(c.registry, c.registryUrl, c.registryName) }}</span>
                </div>
              </div>
            </div>
            <!-- Update-state badge (the card's primary at-a-glance signal) + policy-state icons.
                 Registry moved down to the subtitle line — it's secondary metadata, not the
                 headline. The badge is suppressed on a registry error so the red error icon
                 below isn't contradicted by a green "Current". -->
            <div class="flex items-center gap-1.5 shrink-0 ml-2">
              <span
                v-if="!hasRegistryError(c)"
                data-test="container-card-update-state"
                class="inline-flex items-center gap-1.5 shrink-0 text-2xs-plus font-semibold"
                :style="{ color: getContainerUpdateStateColor(c) }"
                v-tooltip.top="tt(getContainerUpdateStateTooltip(c))"
              >
                <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: getContainerUpdateStateColor(c) }"></span>
                {{ getContainerUpdateStateLabel(c) }}
              </span>
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

          <!-- Card body -- inline Current / Latest. Structured per branch (rather than one
               shared "Current" tag reused across branches) so the #356/#370 guard branch can
               match the table's #cell-version cell EXACTLY: non-digest-pinned containers show
               the tag ONLY, with the digest delta folded into the tag's own :idle-tooltip —
               never a visible sha256 pair. Do NOT collapse this back into a single shared
               "Current" tag with a tooltip on the state badge; that regressed twice (#356, #370). -->
          <div class="px-4 py-3 min-w-0">
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <AppIcon
                v-if="c.tagPinGated"
                name="pin"
                :size="12"
                class="dd-text-muted shrink-0"
                data-test="container-tag-pinned-glyph"
                :aria-label="t('containerComponents.groupedViews.ariaPinnedTag')"
                v-tooltip.top="tt(t('containerComponents.groupedViews.pinnedTagTooltip'))"
              />
              <template v-if="c.isDigestPinned && c.updateKind === 'digest' && c.newDigest && c.currentDigest">
                <CopyableTag :tag="c.currentDigest" class="text-xs font-bold dd-text truncate max-w-[120px]" @click.stop>
                  {{ formatShortDigest(c.currentDigest) }}
                </CopyableTag>
                <span class="text-2xs-plus mx-0.5 dd-text-muted shrink-0" aria-hidden="true">&rarr;</span>
                <CopyableTag :tag="c.newDigest" class="text-xs font-bold truncate max-w-[140px]"
                      :style="{ color: updateKindColor(c.updateKind).text }" @click.stop>
                  {{ formatShortDigest(c.newDigest) }}
                </CopyableTag>
              </template>
              <!-- #356 / #370 regression guard — mirrors the table's #cell-version guard branch
                   exactly: TAG ONLY, digest delta in the CopyableTag's :idle-tooltip. -->
              <template v-else-if="c.updateKind === 'digest' && c.newDigest && c.currentDigest">
                <template v-if="c.updateInsight">
                  <CopyableTag
                    :tag="c.currentTag"
                    class="text-xs font-bold dd-text truncate max-w-[120px]"
                    :idle-tooltip="tt(`${c.currentTag} — ${formatShortDigest(c.currentDigest)} → ${formatShortDigest(c.newDigest)}`)"
                    @click.stop
                  >{{ c.currentTag }}</CopyableTag>
                  <span class="text-2xs-plus mx-0.5 dd-text-muted shrink-0" aria-hidden="true">&rarr;</span>
                  <CopyableTag
                    :tag="c.updateInsight.tag"
                    class="text-xs font-bold truncate max-w-[140px]"
                    :style="{ color: updateInsightColor().text }"
                    :idle-tooltip="tt(updateInsightTooltip(c.updateInsight))"
                    @click.stop
                  >{{ c.updateInsight.tag }}</CopyableTag>
                  <NoUpdateReasonBadge v-if="c.noUpdateReason" :reason="c.noUpdateReason" class="ml-1" />
                </template>
                <CopyableTag
                  v-else
                  :tag="c.currentTag"
                  class="text-xs font-bold truncate max-w-[140px]"
                  :style="{ color: updateKindColor(c.updateKind).text }"
                  :idle-tooltip="tt(`${c.currentTag} — ${formatShortDigest(c.currentDigest)} → ${formatShortDigest(c.newDigest)}`)"
                  @click.stop
                >{{ c.currentTag }}</CopyableTag>
              </template>
              <template v-else-if="c.newTag">
                <CopyableTag :tag="c.currentTag" class="text-xs font-bold dd-text truncate max-w-[120px]" @click.stop>
                  {{ c.currentTag }}
                </CopyableTag>
                <span class="text-2xs-plus mx-0.5 dd-text-muted shrink-0" aria-hidden="true">&rarr;</span>
                <CopyableTag :tag="c.newTag" class="text-xs font-bold truncate max-w-[140px]"
                      :style="{ color: updateKindColor(c.updateKind).text }" @click.stop>
                  {{ c.newTag }}
                </CopyableTag>
              </template>
              <template v-else-if="c.updateInsight">
                <CopyableTag :tag="c.currentTag" class="text-xs font-bold dd-text truncate max-w-[120px]" @click.stop>
                  {{ c.currentTag }}
                </CopyableTag>
                <span class="text-2xs-plus mx-0.5 dd-text-muted shrink-0" aria-hidden="true">&rarr;</span>
                <CopyableTag
                  :tag="c.updateInsight.tag"
                  class="text-xs font-bold truncate max-w-[140px]"
                  :style="{ color: updateInsightColor().text }"
                  :idle-tooltip="tt(updateInsightTooltip(c.updateInsight))"
                  @click.stop
                >
                  {{ c.updateInsight.tag }}
                </CopyableTag>
                <NoUpdateReasonBadge v-if="c.noUpdateReason" :reason="c.noUpdateReason" class="ml-1" />
              </template>
              <template v-else>
                <CopyableTag :tag="c.currentTag" class="text-xs font-bold dd-text truncate max-w-[120px]" @click.stop>
                  {{ c.currentTag }}
                </CopyableTag>
                <span v-if="c.registryError" class="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 dd-rounded" style="background-color: var(--dd-danger-muted);" v-tooltip.top="tt(registryErrorTooltip(c))">
                  <AppIcon name="warning" :size="10" style="color: var(--dd-danger);" class="shrink-0" />
                  <span class="text-2xs-plus font-medium" style="color: var(--dd-danger);">{{ registryErrorPillLabel(c) }}</span>
                </span>
                <NoUpdateReasonBadge v-else-if="c.noUpdateReason" :reason="c.noUpdateReason" class="ml-1" />
              </template>
            </div>
            <!-- Resource links live in the footer's shared icon group. Keeping release notes in
                 popover mode prevents the intermediate-release tree from inflating card height. -->
            <div v-if="c.suggestedTag" class="flex items-center gap-2 flex-wrap mt-2">
              <SuggestedTagBadge :tag="c.suggestedTag" :current-tag="c.currentTag" />
            </div>
          </div>

          <div
            class="px-4 pt-2.5 flex flex-wrap w-full justify-end mt-auto"
            :style="{ backgroundColor: 'var(--dd-bg-elevated)' }"
            data-test="container-card-resource-actions"
          >
            <ContainerLinkActions
              :source-repo="c.sourceRepo"
              :release-notes="c.releaseNotes"
              :current-release-notes="c.currentReleaseNotes"
              :release-link="c.releaseLink"
              :container-id="c.id"
              :from-tag="c.currentTag"
              :to-tag="c.newTag"
              :registry="c.registry"
              :registry-name="c.registryName"
              :registry-url="c.registryUrl"
              icon-size="sm"
            />
          </div>

          <!-- Card footer -->
          <div class="px-4 pb-2.5 pt-1 flex items-center justify-between gap-2"
               :style="{
                 backgroundColor: 'var(--dd-bg-elevated)',
               }">
            <span
              data-test="container-card-runtime-status"
              class="inline-flex items-center gap-1.5 text-2xs-plus font-semibold"
              :style="{ color: getContainerStatusColor(c) }"
              v-tooltip.top="tt(getContainerStatusLabel(c))"
            >
              <AppIcon
                v-if="isContainerUpdating(c) || isContainerScanning(c) || isContainerQueued(c)"
                :name="getContainerStatusIcon(c)"
                :size="12"
                :class="isContainerUpdating(c) || isContainerScanning(c) ? 'dd-spin' : ''"
              />
              <span v-else class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: getContainerStatusColor(c) }"></span>
              {{ getContainerStatusLabel(c) }}
            </span>

            <!-- Card actions: the same icon-style action row as the table's #actions slot
                 above (same buttons/handlers/conditions — stop/start/restart/scan/update/
                 more-kebab, recheck reachable via the kebab's toggleActionsMenu), reused here
                 rather than a separate hand-rolled footer button set. DataTable's own #card
                 slot fully replaces its generic composition (which is where #actions would
                 otherwise be invoked in card mode), so this row is written out again with
                 sizes fixed at the card's `sm` (44px) touch target instead of table's
                 `toolbar` (32px). -->
            <div class="flex items-center gap-1.5">
              <template v-if="!containerActionsEnabled">
                <span class="text-2xs dd-text-muted">{{ t('containerComponents.groupedViews.actionsDisabled') }}</span>
                <AppIconButton icon="lock" size="sm" variant="muted"
                  class="cursor-not-allowed opacity-60"
                  :disabled="true"
                  :tooltip="tt(containerActionsDisabledReason)"
                  @click.stop />
              </template>
              <template v-else>
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
                        :tooltip="tt(t('containerComponents.groupedViews.stopAction'))" @click.stop="confirmStop(c)" />
                <AppIconButton v-else icon="play" size="sm" variant="muted"
                        class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                        :class="isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95'"
                        :disabled="isRowLocked(c)"
                        :tooltip="tt(t('containerComponents.groupedViews.startAction'))" @click.stop="startContainer(c)" />
                <AppIconButton v-if="canCancelUpdate(c)" icon="x" size="sm" variant="danger"
                        class="transition-[color,background-color,border-color,opacity,transform,box-shadow] hover:dd-bg-hover hover:scale-110 active:scale-95"
                        :tooltip="tt(t('containerComponents.groupedViews.cancelUpdateTooltip'))" @click.stop="cancelUpdate(c)" />
                <AppIconButton icon="more" size="sm" variant="muted"
                        class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                        :class="[
                          isRowLocked(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text hover:dd-bg-hover hover:scale-110 active:scale-95',
                          openActionsMenu === c.id && !isRowLocked(c) ? 'dd-bg-elevated dd-text' : '',
                        ]"
                        :disabled="isRowLocked(c)"
                        :tooltip="tt(t('containerComponents.groupedViews.moreButton'))" @click.stop="toggleActionsMenu(c.id, $event)" />
              </template>
            </div>
          </div>

          <!-- In-progress overlay -->
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
          </div>
        </template>
      </DataTable>

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
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="recheckContainer(openActionsContainer); closeActionsMenu()">
            <AppIcon name="restart" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
            {{ t('containerComponents.groupedViews.recheckAction') }}
          </AppButton>
          <!-- Force update for blocked containers (even without newTag) -->
          <template v-if="updateMode !== 'notify' && openActionsContainer.bouncer === 'blocked' && !openActionsContainer.newTag">
            <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="confirmForceUpdate(openActionsContainer); closeActionsMenu()">
              <AppIcon name="bolt" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-warning)' }" />
              {{ t('containerComponents.groupedViews.forceUpdateAction') }}
            </AppButton>
          </template>
          <template v-if="hasRawUpdateCandidate(openActionsContainer) && updateBtnState(openActionsContainer) !== 'none'">
            <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
            <AppButton
                    v-if="isUpdateHardBlocked(openActionsContainer)"
                    size="md" variant="plain" weight="medium"
                    class="w-full text-left flex items-center gap-2 dd-text opacity-60 cursor-not-allowed"
                    :disabled="true"
                    v-tooltip.top="tt(getUpdateHardBlockerMessage(openActionsContainer))">
              <AppIcon name="lock" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-danger)' }" />
              {{ t('containerComponents.fullPageDetail.blockedButton') }}
            </AppButton>
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" v-else-if="openActionsContainer.bouncer === 'blocked'"
                    @click="confirmForceUpdate(openActionsContainer); closeActionsMenu()">
              <AppIcon name="bolt" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-warning)' }" />
              {{ t('containerComponents.groupedViews.forceUpdateAction') }}
            </AppButton>
            <AppButton v-else size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text"
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
          <AppButton size="md" variant="text-danger" weight="medium" class="w-full text-left flex items-center gap-2"
                  @click="confirmDelete(openActionsContainer); closeActionsMenu()">
            <AppIcon name="trash" :size="12" class="w-3 text-center inline-flex justify-center" />
            {{ t('containerComponents.groupedViews.deleteAction') }}
          </AppButton>
        </div>
      </Teleport>

      <!-- EMPTY STATE -->
      <EmptyState v-if="filteredContainers.length === 0"
                  icon="filter"
                  :message="t('containerComponents.groupedViews.emptyState')"
                  :show-clear="activeFilterCount > 0 || !!filterSearch"
                  @clear="clearFilters" />
  </div>
</template>

<style scoped>
.container-version-query {
  container-type: inline-size;
  min-width: 0;
  width: 100%;
}

.container-version-flow {
  align-items: center;
  display: flex;
  gap: 0.375rem;
  justify-content: center;
  min-width: 0;
  width: 100%;
}

.container-version-tag {
  display: inline-block;
  max-width: min(8.75rem, 48cqw);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.container-version-flow .container-version-tag:first-child {
  max-width: min(6.25rem, 44cqw);
}

@container (max-width: 15rem) {
  .container-version-flow {
    flex-direction: column;
    gap: 0.125rem;
    line-height: 1.15;
  }

  .container-version-arrow {
    transform: rotate(90deg);
  }

  .container-version-tag,
  .container-version-flow .container-version-tag:first-child {
    max-width: 100%;
  }
}
</style>
