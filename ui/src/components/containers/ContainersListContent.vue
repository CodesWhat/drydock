<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIconButton from '../AppIconButton.vue';
import ContainersGroupedViews from './ContainersGroupedViews.vue';
import {
  type ContainersViewTemplateContext,
  useContainersViewTemplateContext,
} from './containersViewTemplateContext';

const templateContext: ContainersViewTemplateContext = useContainersViewTemplateContext();
const { t } = useI18n();

const {
  error,
  loading,
  containerViewMode,
  showFilters,
  filteredContainers,
  containers,
  activeFilterCount,
  filterSearch,
  filterStatus,
  filterBouncer,
  filterRegistry,
  filterServer,
  serverNames,
  filterKind,
  filterHidePinned,
  clearFilters,
  showColumnPicker,
  toggleColumnPicker,
  columnPickerStyle,
  allColumns,
  toggleColumn,
  visibleColumns,
  tt,
  groupByStack,
  rechecking,
  recheckAll,
  expandAllGroups,
  collapseAllGroups,
  allGroupsCollapsed,
  filterContainerIds,
  clearContainerIdsFilter,
} = templateContext;

const activeFilterChips = computed(() => {
  const chips: string[] = [];
  const searchValue = filterSearch.value.trim();

  if (searchValue !== '') {
    chips.push(t('containerComponents.listContent.filterSearch', { value: searchValue }));
  }
  if (filterStatus.value !== 'all') {
    const statusLabel =
      t(`containerComponents.listContent.${filterStatus.value}`) || filterStatus.value;
    chips.push(t('containerComponents.listContent.filterStatus', { value: statusLabel }));
  }
  if (filterBouncer.value !== 'all') {
    const bouncerLabel =
      t(`containerComponents.listContent.${filterBouncer.value}`) || filterBouncer.value;
    chips.push(t('containerComponents.listContent.filterBouncer', { value: bouncerLabel }));
  }
  if (filterRegistry.value !== 'all') {
    const registryKey =
      filterRegistry.value === 'dockerhub'
        ? 'dockerHub'
        : filterRegistry.value === 'ghcr'
          ? 'ghcr'
          : 'custom';
    const registryLabel =
      t(`containerComponents.listContent.${registryKey}`) || filterRegistry.value;
    chips.push(t('containerComponents.listContent.filterRegistry', { value: registryLabel }));
  }
  if (filterServer.value !== 'all') {
    chips.push(t('containerComponents.listContent.filterHost', { value: filterServer.value }));
  }
  if (filterKind.value !== 'all') {
    const kindKeyMap: Record<string, string> = {
      any: 'hasUpdate',
      major: 'major',
      minor: 'minor',
      patch: 'patch',
      digest: 'digest',
      blocked: 'blocked',
    };
    const kindLabel =
      t(`containerComponents.listContent.${kindKeyMap[filterKind.value] ?? filterKind.value}`) ||
      filterKind.value;
    chips.push(t('containerComponents.listContent.filterKind', { value: kindLabel }));
  }
  if (filterHidePinned.value) {
    chips.push(t('containerComponents.listContent.filterHiddenPinned'));
  }

  return chips;
});
</script>

<template>
  <div class="contents" data-test="containers-list-content">
    <div
      v-if="error"
      class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">{{ t('containerComponents.listContent.loadingContainers') }}</div>

    <DataFilterBar
      v-model="containerViewMode"
      v-model:showFilters="showFilters"
      :filtered-count="filteredContainers.length"
      :total-count="containers.length"
      :active-filter-count="activeFilterCount">
      <template #filters>
        <input
          v-model="filterSearch"
          type="text"
          :placeholder="t('containerComponents.listContent.searchPlaceholder')"
          class="flex-1 min-w-[140px] max-w-[260px] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
        <select
          v-model="filterStatus"
          class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">{{ t('containerComponents.listContent.allStatuses') }}</option>
          <option value="running">{{ t('containerComponents.listContent.running') }}</option>
          <option value="stopped">{{ t('containerComponents.listContent.stopped') }}</option>
        </select>
        <select
          v-model="filterBouncer"
          class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">{{ t('containerComponents.listContent.allBouncer') }}</option>
          <option value="safe">{{ t('containerComponents.listContent.safe') }}</option>
          <option value="unsafe">{{ t('containerComponents.listContent.unsafe') }}</option>
          <option value="blocked">{{ t('containerComponents.listContent.blocked') }}</option>
        </select>
        <select
          v-model="filterRegistry"
          class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">{{ t('containerComponents.listContent.allRegistries') }}</option>
          <option value="dockerhub">{{ t('containerComponents.listContent.dockerHub') }}</option>
          <option value="ghcr">{{ t('containerComponents.listContent.ghcr') }}</option>
          <option value="custom">{{ t('containerComponents.listContent.custom') }}</option>
        </select>
        <select
          v-model="filterServer"
          class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">{{ t('containerComponents.listContent.allHosts') }}</option>
          <option v-for="serverName in serverNames" :key="serverName" :value="serverName">
            {{ serverName }}
          </option>
        </select>
        <select
          v-model="filterKind"
          class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">{{ t('containerComponents.listContent.allContainers') }}</option>
          <option value="any">{{ t('containerComponents.listContent.hasUpdate') }}</option>
          <option value="major">{{ t('containerComponents.listContent.major') }}</option>
          <option value="minor">{{ t('containerComponents.listContent.minor') }}</option>
          <option value="patch">{{ t('containerComponents.listContent.patch') }}</option>
          <option value="digest">{{ t('containerComponents.listContent.digest') }}</option>
          <option value="blocked">{{ t('containerComponents.listContent.blocked') }}</option>
        </select>
        <label
          class="flex items-center gap-1.5 px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide cursor-pointer dd-bg dd-text select-none"
          v-tooltip="t('containerComponents.listContent.hidePinnedTooltip')"
        >
          <input
            type="checkbox"
            v-model="filterHidePinned"
            class="accent-[var(--dd-secondary)]"
          />
          {{ t('containerComponents.listContent.hidePinned') }}
        </label>
        <AppButton size="none" variant="plain" weight="none"
          v-if="activeFilterCount > 0 || filterSearch"
          class="text-2xs font-medium px-2 py-1 dd-rounded transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
          @click="clearFilters">
          {{ t('containerComponents.listContent.clearAll') }}
        </AppButton>
      </template>
      <template #extra-buttons>
        <div v-if="containerViewMode === 'table'">
          <AppIconButton icon="config" size="toolbar" variant="secondary"
            :class="showColumnPicker ? 'dd-text dd-bg-elevated' : ''"
            :tooltip="tt(t('containerComponents.listContent.toggleColumnsTooltip'))"
            @click.stop="toggleColumnPicker($event)" />
        </div>
      </template>
      <template #left>
        <AppIconButton icon="stack" size="toolbar" variant="secondary"
          :class="groupByStack ? 'dd-text dd-bg-elevated' : ''"
          :tooltip="tt(t('containerComponents.listContent.groupByStackTooltip'))"
          @click="groupByStack = !groupByStack" />
        <AppButton
          v-if="groupByStack"
          size="sm"
          variant="secondary"
          weight="semibold"
          class="uppercase tracking-wide"
          :data-test="allGroupsCollapsed ? 'expand-all-groups' : 'collapse-all-groups'"
          @click="allGroupsCollapsed ? expandAllGroups() : collapseAllGroups()">
          {{ allGroupsCollapsed ? t('containerComponents.listContent.expandAll') : t('containerComponents.listContent.collapseAll') }}
        </AppButton>
        <AppIconButton icon="restart" size="toolbar" variant="secondary"
          :class="rechecking ? 'dd-text-muted cursor-wait' : ''"
          :disabled="rechecking"
          :loading="rechecking"
          :tooltip="tt(t('containerComponents.listContent.recheckTooltip'))"
          @click="recheckAll" />
      </template>
      <template #center>
        <div
          v-if="filterContainerIds.size > 0"
          class="inline-flex items-center gap-1.5 px-2 py-1 dd-rounded text-2xs font-medium"
          :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
          <span>{{ t('containerComponents.listContent.filteredContainers', { count: filterContainerIds.size }) }}</span>
          <AppButton
            size="none"
            variant="plain"
            weight="none"
            class="ml-1 font-semibold hover:opacity-70 transition-opacity"
            aria-label="Clear container ID filter"
            @click="clearContainerIdsFilter">
            &times;
          </AppButton>
        </div>
        <div
          v-else-if="!showFilters && activeFilterChips.length > 0"
          class="flex flex-wrap items-center gap-1.5 min-w-0"
        >
          <span
            class="text-3xs font-bold uppercase tracking-[0.22em] dd-text-muted"
          >
            {{ t('containerComponents.listContent.filtersLabel') }}
          </span>
          <span
            v-for="chip in activeFilterChips"
            :key="chip"
            class="px-2 py-1 dd-rounded text-2xs font-medium whitespace-nowrap dd-bg-elevated dd-text max-w-[240px] truncate"
            v-tooltip.top="chip"
          >
            {{ chip }}
          </span>
        </div>
      </template>
    </DataFilterBar>

    <div
      v-if="showColumnPicker"
      class="min-w-[160px] py-1.5 dd-rounded shadow-lg"
      :style="{
        ...columnPickerStyle,
        zIndex: 'var(--z-popover)',
        backgroundColor: 'var(--dd-bg-card)',
        border: '1px solid var(--dd-border-strong)',
        boxShadow: 'var(--dd-shadow-tooltip)',
      }"
      @click.stop>
      <div class="px-3 py-1 text-3xs font-bold uppercase tracking-wider dd-text-muted">{{ t('containerComponents.listContent.columnsHeader') }}</div>
      <AppButton size="none" variant="plain" weight="none"
        v-for="column in allColumns.filter((columnItem) => columnItem.label)"
        :key="column.key"
        class="w-full text-left px-3 py-1.5 text-2xs-plus font-medium transition-colors flex items-center gap-2 hover:dd-bg-elevated"
        :class="column.required ? 'dd-text-muted cursor-not-allowed' : 'dd-text'"
        @click="toggleColumn(column.key)">
        <AppIcon
          :name="visibleColumns.has(column.key) ? 'check' : 'square'"
          :size="13"
          :style="visibleColumns.has(column.key) ? { color: 'var(--dd-primary)' } : {}" />
        {{ column.label }}
      </AppButton>
    </div>

    <ContainersGroupedViews />
  </div>
</template>
