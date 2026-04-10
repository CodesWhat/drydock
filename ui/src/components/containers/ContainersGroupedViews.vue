<script setup lang="ts">
import { computed } from 'vue';
import AppBadge from '../AppBadge.vue';
import AppIconButton from '../AppIconButton.vue';
import type { ContainersViewRenderGroup } from './containersViewTemplateContext';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';
import { getContainerViewKey } from '../../utils/container-view-key';
import { imageAge } from '../../utils/audit-helpers';
import UpdateMaturityBadge from './UpdateMaturityBadge.vue';
import SuggestedTagBadge from './SuggestedTagBadge.vue';
import ReleaseNotesLink from './ReleaseNotesLink.vue';
import ContainersGroupHeader from './ContainersGroupHeader.vue';

const {
  filteredContainers,
  renderGroups,
  groupByStack,
  toggleGroupCollapse,
  collapsedGroups,
  groupUpdateInProgress,
  containerActionsEnabled,
  containerActionsDisabledReason,
  isContainerUpdateInProgress,
  isContainerUpdateQueued,
  getContainerUpdateSequenceLabel,
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

function makeContainerTableRow(container: DisplayContainer, groupKey: string): ContainerTableRow {
  return {
    ...container,
    __rowType: 'container',
    __rowKey: getContainerViewKey(container),
    __groupKey: groupKey,
    __source: container,
  };
}

const tableRows = computed<GroupedTableRow[]>(() => {
  if (!groupByStack.value) {
    return displayContainers.value.map((container) => makeContainerTableRow(container, '__flat__'));
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

function formatContainerUpdateLabel(
  container: { id?: unknown; name?: unknown },
  baseLabel: 'Updating' | 'Queued',
) {
  const sequence = getContainerUpdateSequenceLabel(container);
  return sequence ? `${baseLabel} ${sequence}` : baseLabel;
}

function getContainerStatusLabel(container: { id?: unknown; name?: unknown; status?: string }) {
  if (isContainerUpdating(container)) {
    return formatContainerUpdateLabel(container, 'Updating');
  }
  if (isContainerQueued(container)) {
    return formatContainerUpdateLabel(container, 'Queued');
  }
  return container.status ?? 'unknown';
}

function getContainerStatusTone(container: { id?: unknown; name?: unknown; status?: string }) {
  if (isContainerUpdating(container)) {
    return 'warning';
  }
  if (isContainerQueued(container)) {
    return 'neutral';
  }
  return container.status === 'running' ? 'success' : 'danger';
}

function getContainerStatusIcon(container: { id?: unknown; name?: unknown; status?: string }) {
  if (isContainerUpdating(container)) {
    return 'spinner';
  }
  if (isContainerQueued(container)) {
    return 'clock';
  }
  return container.status === 'running' ? 'play' : 'stop';
}

function getContainerStatusIconStyle(container: { id?: unknown; name?: unknown; status?: string }) {
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
  return isContainerUpdating(typedRow) ||
    isContainerQueued(typedRow) ||
    groupUpdateInProgress.value.has(typedRow.__groupKey)
    ? 'opacity-50 pointer-events-none transition-opacity duration-300'
    : '';
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
</script>

<template>
  <div data-test="containers-grouped-views">
    <!-- GROUPED / FLAT CONTAINER VIEWS -->
    <template v-if="filteredContainers.length > 0">
      <DataTable
        v-if="containerViewMode === 'table'"
        :columns="tableColumns"
        :rows="tableRows"
        :row-key="getTableRowKey"
        :sort-key="containerSortKey"
        :sort-asc="containerSortAsc"
        :selected-key="selectedContainerKey"
        :show-actions="true"
        :virtual-scroll="true"
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
            :in-progress="groupUpdateInProgress.has(row.group.key)"
            :tt="tt"
            @toggle="toggleGroupCollapse"
            @update-all="updateAllInGroup($event)"
          />
        </template>
        <!-- Container icon (own column) -->
        <template #cell-icon="{ row: c }">
          <AppIcon v-if="isContainerUpdating(c)" name="spinner" :size="14" class="dd-spin dd-text-muted" v-tooltip.top="tt(getContainerStatusLabel(c))" />
          <AppIcon v-else-if="isContainerQueued(c)" name="clock" :size="14" class="dd-text-muted" v-tooltip.top="tt(getContainerStatusLabel(c))" />
          <ContainerIcon v-else :icon="c.icon" :size="20" />
        </template>

        <!-- Container name + image (+ compact actions & badges) -->
        <template #cell-name="{ row: c }">
          <div class="min-w-0" :class="{ 'opacity-50': isContainerUpdating(c) || isContainerQueued(c) }">
              <div class="flex items-center gap-2">
                <div class="font-medium truncate dd-text flex-1">{{ c.name }}</div>
              </div>
              <div class="text-2xs mt-0.5 truncate dd-text-muted">{{ c.image }}</div>
              <!-- Compact mode: folded badge row -->
              <div v-if="isCompact" class="flex items-center gap-1.5 mt-1.5 min-w-0 overflow-hidden">
                <span v-if="c.newTag" class="inline-flex items-center gap-0.5 text-3xs font-semibold dd-text-secondary min-w-0">
                  <span class="truncate max-w-[80px]">{{ c.currentTag }}</span>
                  <AppIcon name="arrow-right" :size="14" class="dd-text-muted mx-0.5 shrink-0" />
                  <CopyableTag :tag="c.newTag" class="truncate max-w-[100px]" style="color: var(--dd-primary);" @click.stop>{{ c.newTag }}</CopyableTag>
                </span>
                <span
                  v-else-if="c.noUpdateReason"
                  class="inline-flex items-center gap-1 text-3xs min-w-0"
                  style="color: var(--dd-warning);"
                  v-tooltip.top="c.noUpdateReason"
                >
                  <AppIcon name="warning" :size="10" class="shrink-0" />
                  <span class="truncate max-w-[130px]">{{ c.noUpdateReason }}</span>
                </span>
                <div class="flex items-center gap-1.5 ml-auto shrink-0">
                <AppBadge v-if="c.updateKind" size="xs" :custom="{ bg: updateKindColor(c.updateKind).bg, text: updateKindColor(c.updateKind).text }"
                      class="px-1.5 py-0"
                      v-tooltip.top="tt(c.updateKind)">
                  <AppIcon :name="c.updateKind === 'major' ? 'chevrons-up' : c.updateKind === 'minor' ? 'chevron-up' : c.updateKind === 'patch' ? 'hashtag' : 'fingerprint'" :size="12" />
                </AppBadge>
                <UpdateMaturityBadge :maturity="c.updateMaturity" :tooltip="c.updateMaturityTooltip" size="sm" />
                <SuggestedTagBadge :tag="c.suggestedTag" :current-tag="c.currentTag" />
                <AppBadge v-if="c.bouncer === 'blocked'" tone="danger" size="xs" class="px-1.5 py-0"
                      v-tooltip.top="tt('Blocked')">
                  <AppIcon name="blocked" :size="12" />
                </AppBadge>
                <AppBadge v-else-if="c.bouncer !== 'safe'" tone="warning" size="xs" class="px-1.5 py-0"
                      v-tooltip.top="tt(c.bouncer)">
                  <AppIcon name="warning" :size="12" />
                </AppBadge>
                <AppBadge v-if="hasRegistryError(c)" tone="danger" size="xs" class="px-1.5 py-0"
                      aria-label="Registry error"
                      v-tooltip.top="tt(registryErrorTooltip(c))">
                  <AppIcon name="warning" :size="12" />
                </AppBadge>
                <AppBadge v-if="getContainerListPolicyState(c).snoozed"
                      tone="info" size="xs" class="px-1.5 py-0"
                      aria-label="Snoozed updates"
                      v-tooltip.top="tt(containerPolicyTooltip(c, 'snoozed'))">
                  <AppIcon name="pause" :size="12" />
                </AppBadge>
                <AppBadge v-if="getContainerListPolicyState(c).skipped"
                      tone="warning" size="xs" class="px-1.5 py-0"
                      aria-label="Skipped updates"
                      v-tooltip.top="tt(containerPolicyTooltip(c, 'skipped'))">
                  <AppIcon name="skip-forward" :size="12" />
                </AppBadge>
                <AppBadge v-if="getContainerListPolicyState(c).maturityBlocked"
                      tone="primary" size="xs" class="px-1.5 py-0"
                      aria-label="Maturity-blocked updates"
                      v-tooltip.top="tt(containerPolicyTooltip(c, 'maturity'))">
                  <AppIcon name="clock" :size="12" />
                </AppBadge>
                <AppBadge size="xs" class="px-1.5 py-0"
                      :tone="c.status === 'running' ? 'success' : 'danger'"
                      v-tooltip.top="tt(c.status)">
                  <AppIcon :name="c.status === 'running' ? 'play' : 'stop'" :size="12" />
                </AppBadge>
                <AppBadge size="xs" class="px-1.5 py-0"
                      :custom="{ bg: serverBadgeColor(c.server).bg, text: serverBadgeColor(c.server).text }"
                      v-tooltip.top="tt(c.server)">
                  <AppIcon :name="parseServer(c.server).name === 'Local' ? 'home' : 'remote'" :size="12" />
                </AppBadge>
                </div>
              </div>
          </div>
        </template>
        <!-- Version comparison -->
        <template #cell-version="{ row: c }">
          <div v-if="c.newTag" class="flex items-center justify-center gap-1.5 min-w-0 max-w-[260px]">
            <span class="text-2xs-plus dd-text-secondary truncate shrink-0 max-w-[100px]" v-tooltip.top="c.currentTag">{{ c.currentTag }}</span>
            <AppIcon name="arrow-right" :size="8" class="dd-text-muted shrink-0" />
            <CopyableTag :tag="c.newTag" class="text-2xs-plus font-semibold truncate max-w-[140px]" style="color: var(--dd-primary);" @click.stop>{{ c.newTag }}</CopyableTag>
          </div>
          <div v-else class="text-center">
            <span class="text-2xs-plus dd-text-secondary truncate block max-w-[140px] mx-auto" v-tooltip.top="c.currentTag">{{ c.currentTag }}</span>
            <div v-if="getContainerListPolicyState(c).snoozed || getContainerListPolicyState(c).skipped || getContainerListPolicyState(c).maturityBlocked"
                 class="mt-1 inline-flex items-center justify-center gap-1">
              <span v-if="getContainerListPolicyState(c).snoozed"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-info);"
                    aria-label="Snoozed updates"
                    v-tooltip.top="tt(containerPolicyTooltip(c, 'snoozed'))">
                <AppIcon name="pause" :size="14" />
              </span>
              <span v-if="getContainerListPolicyState(c).skipped"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-warning);"
                    aria-label="Skipped updates"
                    v-tooltip.top="tt(containerPolicyTooltip(c, 'skipped'))">
                <AppIcon name="skip-forward" :size="14" />
              </span>
              <span v-if="getContainerListPolicyState(c).maturityBlocked"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-primary);"
                    aria-label="Maturity-blocked updates"
                    v-tooltip.top="tt(containerPolicyTooltip(c, 'maturity'))">
                <AppIcon name="clock" :size="14" />
              </span>
            </div>
            <div
              v-if="c.noUpdateReason"
              class="mt-1 inline-flex items-center gap-1 text-2xs max-w-[220px] justify-center"
              style="color: var(--dd-warning);"
              v-tooltip.top="c.noUpdateReason"
            >
              <AppIcon name="warning" :size="10" class="shrink-0" />
              <span class="truncate">{{ c.noUpdateReason }}</span>
            </div>
          </div>
        </template>
        <!-- Kind badge -->
        <template #cell-kind="{ row: c }">
          <div class="inline-flex items-center gap-1">
          <AppBadge v-if="c.updateKind" size="xs" :custom="{ bg: updateKindColor(c.updateKind).bg, text: updateKindColor(c.updateKind).text }">
            {{ c.updateKind }}
          </AppBadge>
          <AppBadge v-else-if="getContainerListPolicyState(c).skipped" size="xs" v-tooltip.top="'Pinned'" :custom="{ bg: 'var(--dd-success-muted)', text: 'var(--dd-success)' }">
            <AppIcon name="pin" :size="12" />
          </AppBadge>
          <AppBadge v-else-if="!c.updateKind && !c.updateMaturity && !c.suggestedTag" size="xs" v-tooltip.top="'Up to date'" :custom="{ bg: 'var(--dd-success-muted)', text: 'var(--dd-success)' }">
            <AppIcon name="up-to-date" :size="12" />
          </AppBadge>
          <UpdateMaturityBadge :maturity="c.updateMaturity" :tooltip="c.updateMaturityTooltip" />
          <SuggestedTagBadge :tag="c.suggestedTag" :current-tag="c.currentTag" />
          </div>
        </template>
        <!-- Status -->
        <template #cell-status="{ row: c }">
          <AppIcon :name="getContainerStatusIcon(c)" :size="13" class="shrink-0 md:!hidden"
                   :class="isContainerUpdating(c) ? 'dd-spin' : ''"
                   :style="getContainerStatusIconStyle(c)"
                   v-tooltip.top="tt(getContainerStatusLabel(c))" />
          <AppBadge class="max-md:!hidden" size="xs" :tone="getContainerStatusTone(c)">
            <AppIcon v-if="isContainerUpdating(c)" name="spinner" :size="12" class="mr-1 dd-spin" />
            <AppIcon v-else-if="isContainerQueued(c)" name="clock" :size="12" class="mr-1" />
            {{ getContainerStatusLabel(c) }}
          </AppBadge>
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
          <AppBadge size="xs" :custom="{ bg: serverBadgeColor(c.server).bg, text: serverBadgeColor(c.server).text }">
            {{ c.server }}
          </AppBadge>
        </template>
        <!-- Registry badge -->
        <template #cell-registry="{ row: c }">
          <div class="inline-flex items-center justify-center gap-1.5">
            <AppBadge size="xs" :custom="{ bg: registryColorBg(c.registry), text: registryColorText(c.registry) }">
              {{ registryLabel(c.registry, c.registryUrl, c.registryName) }}
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
              <span class="text-2xs dd-text-muted">Actions disabled</span>
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
              <AppIconButton v-if="c.newTag && c.bouncer === 'blocked'" icon="lock" size="sm" variant="muted"
                      class="cursor-not-allowed opacity-50"
                      :disabled="true"
                      :tooltip="tt('Blocked by Bouncer')" @click.stop />
              <AppIconButton v-else-if="c.newTag" icon="cloud-download" size="sm" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isContainerUpdating(c) || isContainerQueued(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                      :tooltip="tt('Update')" @click.stop="confirmUpdate(c)" />
              <AppIconButton v-else-if="c.status === 'running'" icon="stop" size="sm" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isContainerUpdating(c) || isContainerQueued(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-danger hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                      :tooltip="tt('Stop')" @click.stop="confirmStop(c)" />
              <AppIconButton v-else icon="play" size="sm" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="isContainerUpdating(c) || isContainerQueued(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                      :tooltip="tt('Start')" @click.stop="startContainer(c)" />
              <AppIconButton icon="more" size="sm" variant="muted"
                      class="transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="[
                        isContainerUpdating(c) || isContainerQueued(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text hover:dd-bg-hover hover:scale-110 active:scale-95',
                        openActionsMenu === c.id && !isContainerUpdating(c) && !isContainerQueued(c) ? 'dd-bg-elevated dd-text' : '',
                      ]"
                      :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                      :tooltip="tt('More')" @click.stop="toggleActionsMenu(c.id, $event)" />
            </div>
          </template>
          <!-- Button-style actions (full) -->
          <template v-else>
            <div v-if="c.newTag" class="inline-flex items-center gap-1">
              <!-- Blocked: muted split button -->
              <div v-if="c.bouncer === 'blocked'" class="inline-flex dd-rounded overflow-hidden" style="min-width: 110px;"
>
                <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center flex-1 whitespace-nowrap px-3 py-1.5 text-2xs-plus font-bold tracking-wide cursor-not-allowed"
                        :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-text-muted)' }">
                  <AppIcon name="lock" :size="14" class="mr-1" /> Blocked
                </AppButton>
                <AppIconButton icon="chevron-down" size="toolbar" variant="plain"
                        class="transition-colors dd-text-muted hover:dd-text hover:dd-bg-hover"
                        :style="{ backgroundColor: 'var(--dd-bg)' }"
                        :class="openActionsMenu === c.id ? 'dd-bg-elevated dd-text' : ''"
                        aria-label="Open actions menu"
                        @click.stop="toggleActionsMenu(c.id, $event)" />
              </div>
              <!-- Updatable: split button -->
              <div v-else class="inline-flex dd-rounded overflow-hidden"
                   :class="isContainerUpdating(c) || isContainerQueued(c) ? 'opacity-50' : ''"
                   :style="{ border: '1px solid var(--dd-success)' }">
                <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-2xs-plus font-bold tracking-wide transition-colors"
                        :class="isContainerUpdating(c) || isContainerQueued(c) ? 'cursor-not-allowed' : ''"
                        :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }"
                        :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                        @click.stop="confirmUpdate(c)">
                  <AppIcon name="cloud-download" :size="14" class="mr-1" /> Update
                </AppButton>
                <AppIconButton icon="chevron-down" size="toolbar" variant="plain"
                        class="transition-colors"
                        :class="isContainerUpdating(c) || isContainerQueued(c) ? 'cursor-not-allowed' : openActionsMenu === c.id ? 'brightness-125' : ''"
                        :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', borderLeft: '1px solid var(--dd-success)' }"
                        :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                        aria-label="Open update actions menu"
                        @click.stop="toggleActionsMenu(c.id, $event)" />
              </div>
            </div>
            <div v-else class="flex items-center justify-end gap-1">
              <AppIconButton v-if="c.status === 'running'"
                      icon="stop" size="toolbar" variant="danger"
                      :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                      :tooltip="tt('Stop')" @click.stop="confirmStop(c)" />
              <AppIconButton v-else
                      icon="play" size="toolbar" variant="success"
                      :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                      :tooltip="tt('Start')" @click.stop="startContainer(c)" />
              <AppIconButton icon="restart" size="toolbar" variant="muted"
                      :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                      :tooltip="tt('Restart')" @click.stop="confirmRestart(c)" />
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
            :in-progress="groupUpdateInProgress.has(group.key)"
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
          <!-- Card header -->
          <div class="px-4 pt-4 pb-2 flex items-start justify-between" :class="{ 'opacity-50': isContainerUpdating(c) || isContainerQueued(c) || groupUpdateInProgress.has(group.key) }">
            <div class="flex items-center gap-2.5 min-w-0">
              <AppIcon v-if="isContainerUpdating(c)" name="spinner" :size="16" class="dd-spin dd-text-muted shrink-0" />
              <AppIcon v-else-if="isContainerQueued(c)" name="clock" :size="16" class="dd-text-muted shrink-0" />
              <ContainerIcon v-else :icon="c.icon" :size="24" class="shrink-0" />
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
              <AppBadge size="xs" :custom="{ bg: registryColorBg(c.registry), text: registryColorText(c.registry) }">
                {{ registryLabel(c.registry, c.registryUrl, c.registryName) }}
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
            </div>
          </div>

          <!-- Card body -- inline Current / Latest -->
          <div class="px-4 py-3 min-w-0" :class="{ 'opacity-50': isContainerUpdating(c) || isContainerQueued(c) || groupUpdateInProgress.has(group.key) }">
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <span class="text-2xs-plus dd-text-muted shrink-0">Current</span>
              <CopyableTag :tag="c.currentTag" class="text-xs font-bold dd-text truncate max-w-[120px]" @click.stop>
                {{ c.currentTag }}
              </CopyableTag>
              <template v-if="c.newTag">
                <span class="text-2xs-plus ml-1 dd-text-muted shrink-0">Latest</span>
                <CopyableTag :tag="c.newTag" class="text-xs font-bold truncate max-w-[140px]"
                      :style="{ color: updateKindColor(c.updateKind).text }" @click.stop>
                  {{ c.newTag }}
                </CopyableTag>
                <span class="ml-1 shrink-0"><UpdateMaturityBadge :maturity="c.updateMaturity" :tooltip="c.updateMaturityTooltip" /></span>
              </template>
              <template v-else>
                <span
                  v-if="c.noUpdateReason"
                  class="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 dd-rounded-sm text-2xs max-w-[220px]"
                  :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }"
                  v-tooltip.top="c.noUpdateReason"
                >
                  <AppIcon name="warning" :size="14" class="shrink-0" />
                  <span class="truncate">{{ c.noUpdateReason }}</span>
                </span>
                <template v-else-if="getContainerListPolicyState(c).snoozed || getContainerListPolicyState(c).skipped || getContainerListPolicyState(c).maturityBlocked">
                  <span v-if="getContainerListPolicyState(c).snoozed"
                        class="inline-flex items-center justify-center ml-1"
                        style="color: var(--dd-info);"
                        aria-label="Snoozed updates"
                        v-tooltip.top="tt(containerPolicyTooltip(c, 'snoozed'))">
                    <AppIcon name="pause" :size="13" />
                  </span>
                  <span v-if="getContainerListPolicyState(c).skipped"
                        class="inline-flex items-center justify-center"
                        style="color: var(--dd-warning);"
                        aria-label="Skipped updates"
                        v-tooltip.top="tt(containerPolicyTooltip(c, 'skipped'))">
                    <AppIcon name="skip-forward" :size="13" />
                  </span>
                  <span v-if="getContainerListPolicyState(c).maturityBlocked"
                        class="inline-flex items-center justify-center"
                        style="color: var(--dd-primary);"
                        aria-label="Maturity-blocked updates"
                        v-tooltip.top="tt(containerPolicyTooltip(c, 'maturity'))">
                    <AppIcon name="clock" :size="13" />
                  </span>
                </template>
                <AppIcon v-else name="check" :size="14" class="ml-1" style="color: var(--dd-success);" v-tooltip.top="tt('Up to date')" />
              </template>
            </div>
            <div
              v-if="isContainerUpdating(c)"
              class="mt-2 inline-flex items-center gap-1 text-2xs"
              style="color: var(--dd-warning);">
              <AppIcon name="spinner" :size="12" class="dd-spin shrink-0" />
              {{ formatContainerUpdateLabel(c, 'Updating') }}
            </div>
            <div
              v-else-if="isContainerQueued(c)"
              class="mt-2 inline-flex items-center gap-1 text-2xs dd-text-muted">
              <AppIcon name="clock" :size="12" class="shrink-0" />
              {{ formatContainerUpdateLabel(c, 'Queued') }}
            </div>
            <div v-if="c.suggestedTag || c.releaseNotes || c.releaseLink" class="flex items-center gap-2 flex-wrap mt-2">
              <SuggestedTagBadge :tag="c.suggestedTag" :current-tag="c.currentTag" />
              <ReleaseNotesLink :release-notes="c.releaseNotes" :release-link="c.releaseLink" />
            </div>
          </div>

          <!-- Card footer -->
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{
                 borderTop: '1px solid var(--dd-border)',
                 backgroundColor: 'var(--dd-bg-elevated)',
               }">
            <AppBadge class="px-1.5 py-0 md:!hidden" size="xs" :tone="getContainerStatusTone(c)" v-tooltip.top="tt(getContainerStatusLabel(c))">
              <AppIcon :name="getContainerStatusIcon(c)" :size="12" :class="isContainerUpdating(c) ? 'dd-spin' : ''" />
            </AppBadge>
            <AppBadge class="max-md:!hidden" size="xs" :tone="getContainerStatusTone(c)">
              <AppIcon v-if="isContainerUpdating(c)" name="spinner" :size="12" class="mr-1 dd-spin" />
              <AppIcon v-else-if="isContainerQueued(c)" name="clock" :size="12" class="mr-1" />
              {{ getContainerStatusLabel(c) }}
            </AppBadge>
            <div class="flex items-center gap-1.5">
              <template v-if="containerActionsEnabled">
                <AppIconButton v-if="c.status === 'running'" icon="stop" size="xs" variant="muted"
                        :class="isContainerUpdating(c) || isContainerQueued(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-danger hover:dd-bg-elevated'"
                        :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                      :tooltip="tt('Stop')" @click.stop="confirmStop(c)" />
                <AppIconButton v-else icon="play" size="xs" variant="muted"
                        :class="isContainerUpdating(c) || isContainerQueued(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-elevated'"
                        :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                        :tooltip="tt('Start')" @click.stop="startContainer(c)" />
                <AppIconButton icon="restart" size="xs" variant="muted"
                        :class="isContainerUpdating(c) || isContainerQueued(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text hover:dd-bg-elevated'"
                        :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                        :tooltip="tt('Restart')" @click.stop="confirmRestart(c)" />
                <AppIconButton icon="security" size="xs" variant="muted"
                        :class="isContainerUpdating(c) || isContainerQueued(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-secondary hover:dd-bg-elevated'"
                        :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                        :tooltip="tt('Scan')" @click.stop="scanContainer(c)" />
                <AppIconButton v-if="c.newTag && c.bouncer === 'blocked'" icon="lock" size="xs" variant="muted"
                        class="opacity-60 cursor-not-allowed"
                        :disabled="true"
                        :tooltip="tt('Security blocked')" />
                <AppIconButton v-else-if="c.newTag" icon="cloud-download" size="xs" variant="muted"
                        :class="isContainerUpdating(c) || isContainerQueued(c) ? 'opacity-50 cursor-not-allowed' : 'hover:dd-text-success hover:dd-bg-elevated'"
                        :disabled="isContainerUpdating(c) || isContainerQueued(c)"
                        :tooltip="tt('Update')" @click.stop="confirmUpdate(c)" />
              </template>
              <template v-else>
                <span class="text-2xs dd-text-muted">Actions disabled</span>
                <AppIconButton icon="lock" size="xs" variant="muted"
                  class="cursor-not-allowed opacity-60"
                  :disabled="true"
                  :tooltip="tt(containerActionsDisabledReason)"
                  @click.stop />
              </template>
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
          <AppIcon v-if="isContainerUpdating(c)" name="spinner" :size="14" class="dd-spin dd-text-muted shrink-0" />
          <AppIcon v-else-if="isContainerQueued(c)" name="clock" :size="14" class="dd-text-muted shrink-0" />
          <ContainerIcon v-else :icon="c.icon" :size="18" class="shrink-0" />
          <div class="min-w-0 flex-1" :class="{ 'opacity-50': isContainerUpdating(c) || isContainerQueued(c) }">
            <div class="text-sm font-semibold truncate dd-text">{{ c.name }}</div>
            <div class="text-2xs mt-0.5 truncate dd-text-muted" v-tooltip.top="`${c.image}:${c.currentTag}`">{{ c.image }}:{{ c.currentTag }}</div>
            <div
              v-if="isContainerUpdating(c)"
              class="text-2xs mt-0.5 inline-flex items-center gap-1"
              style="color: var(--dd-warning);">
              <AppIcon name="spinner" :size="10" class="dd-spin shrink-0" />
              {{ formatContainerUpdateLabel(c, 'Updating') }}
            </div>
            <div
              v-else-if="isContainerQueued(c)"
              class="text-2xs mt-0.5 inline-flex items-center gap-1 dd-text-muted">
              <AppIcon name="clock" :size="10" class="shrink-0" />
              {{ formatContainerUpdateLabel(c, 'Queued') }}
            </div>
            <div
              v-else-if="!c.newTag && c.noUpdateReason"
              class="text-2xs mt-0.5 truncate"
              style="color: var(--dd-warning);"
              v-tooltip.top="c.noUpdateReason"
            >
              {{ c.noUpdateReason }}
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
                     :class="isContainerUpdating(c) ? 'dd-spin' : ''"
                     v-tooltip.top="tt(getContainerStatusLabel(c))"
                     :style="getContainerStatusIconStyle(c)" />
            <AppBadge class="max-md:!hidden" size="xs" :tone="getContainerStatusTone(c)">
              <AppIcon v-if="isContainerUpdating(c)" name="spinner" :size="12" class="mr-1 dd-spin" />
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
            <AppBadge v-if="c.bouncer === 'blocked'" tone="danger" size="xs" class="px-1.5 py-0" v-tooltip.top="tt('Blocked by Bouncer')">
              <AppIcon name="blocked" :size="12" />
            </AppBadge>
            <!-- Server: icon on mobile, badge on desktop -->
            <AppIcon :name="parseServer(c.server).name === 'Local' ? 'home' : 'remote'" :size="12" class="shrink-0 dd-text-muted md:!hidden" v-tooltip.top="tt(parseServer(c.server).name)" />
            <AppBadge class="max-md:!hidden" size="xs" :custom="{ bg: serverBadgeColor(c.server).bg, text: serverBadgeColor(c.server).text }">
              {{ parseServer(c.server).name }}
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
            Stop
          </AppButton>
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" v-else
                  @click="startContainer(openActionsContainer); closeActionsMenu()">
            <AppIcon name="play" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-success)' }" />
            Start
          </AppButton>
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="confirmRestart(openActionsContainer); closeActionsMenu()">
            <AppIcon name="restart" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
            Restart
          </AppButton>
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="scanContainer(openActionsContainer); closeActionsMenu()">
            <AppIcon name="security" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-secondary)' }" />
            Scan
          </AppButton>
          <!-- Force update for blocked containers (even without newTag) -->
          <template v-if="openActionsContainer.bouncer === 'blocked' && !openActionsContainer.newTag">
            <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="confirmForceUpdate(openActionsContainer); closeActionsMenu()">
              <AppIcon name="bolt" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-warning)' }" />
              Force update
            </AppButton>
          </template>
          <template v-if="openActionsContainer.newTag">
            <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" v-if="openActionsContainer.bouncer === 'blocked'"
                    @click="confirmForceUpdate(openActionsContainer); closeActionsMenu()">
              <AppIcon name="bolt" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-warning)' }" />
              Force update
            </AppButton>
            <AppButton v-if="openActionsContainer.bouncer !== 'blocked'" size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text"
                    @click="confirmUpdate(openActionsContainer); closeActionsMenu()">
              <AppIcon name="cloud-download" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-success)' }" />
              Update
            </AppButton>
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="skipUpdate(openActionsContainer); closeActionsMenu()">
              <AppIcon name="skip-forward" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
              Skip this update
            </AppButton>
          </template>
          <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text"
                  @click="selectContainer(openActionsContainer!); activeDetailTab = 'actions'; closeActionsMenu()">
            <AppIcon name="recent-updates" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
            Rollback
          </AppButton>
          <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
          <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2" style="color: var(--dd-danger);"
                  @click="confirmDelete(openActionsContainer); closeActionsMenu()">
            <AppIcon name="trash" :size="12" class="w-3 text-center inline-flex justify-center" />
            Delete
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
