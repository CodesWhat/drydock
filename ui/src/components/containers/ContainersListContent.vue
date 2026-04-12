<script setup lang="ts">
import { computed } from 'vue';
import AppIconButton from '../AppIconButton.vue';
import ContainersGroupedViews from './ContainersGroupedViews.vue';
import {
  type ContainersViewTemplateContext,
  useContainersViewTemplateContext,
} from './containersViewTemplateContext';

const templateContext: ContainersViewTemplateContext = useContainersViewTemplateContext();

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
} = templateContext;

const FILTER_STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  stopped: 'Stopped',
};

const FILTER_BOUNCER_LABELS: Record<string, string> = {
  safe: 'Safe',
  unsafe: 'Unsafe',
  blocked: 'Blocked',
};

const FILTER_REGISTRY_LABELS: Record<string, string> = {
  dockerhub: 'Docker Hub',
  ghcr: 'GHCR',
  custom: 'Custom',
};

const FILTER_KIND_LABELS: Record<string, string> = {
  any: 'Has Update',
  major: 'Major',
  minor: 'Minor',
  patch: 'Patch',
  digest: 'Digest',
};

const activeFilterChips = computed(() => {
  const chips: string[] = [];
  const searchValue = filterSearch.value.trim();

  if (searchValue !== '') {
    chips.push(`Search: ${searchValue}`);
  }
  if (filterStatus.value !== 'all') {
    chips.push(`Status: ${FILTER_STATUS_LABELS[filterStatus.value] ?? filterStatus.value}`);
  }
  if (filterBouncer.value !== 'all') {
    chips.push(`Bouncer: ${FILTER_BOUNCER_LABELS[filterBouncer.value] ?? filterBouncer.value}`);
  }
  if (filterRegistry.value !== 'all') {
    chips.push(`Registry: ${FILTER_REGISTRY_LABELS[filterRegistry.value] ?? filterRegistry.value}`);
  }
  if (filterServer.value !== 'all') {
    chips.push(`Host: ${filterServer.value}`);
  }
  if (filterKind.value !== 'all') {
    chips.push(`Kind: ${FILTER_KIND_LABELS[filterKind.value] ?? filterKind.value}`);
  }
  if (filterHidePinned.value) {
    chips.push('Hidden: Pinned');
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

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">Loading containers...</div>

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
          placeholder="Search name or image..."
          class="flex-1 min-w-[140px] max-w-[260px] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
        <select
          v-model="filterStatus"
          class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">All Statuses</option>
          <option value="running">Running</option>
          <option value="stopped">Stopped</option>
        </select>
        <select
          v-model="filterBouncer"
          class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">All Bouncer</option>
          <option value="safe">Safe</option>
          <option value="unsafe">Unsafe</option>
          <option value="blocked">Blocked</option>
        </select>
        <select
          v-model="filterRegistry"
          class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">All Registries</option>
          <option value="dockerhub">Docker Hub</option>
          <option value="ghcr">GHCR</option>
          <option value="custom">Custom</option>
        </select>
        <select
          v-model="filterServer"
          class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">All Hosts</option>
          <option v-for="serverName in serverNames" :key="serverName" :value="serverName">
            {{ serverName }}
          </option>
        </select>
        <select
          v-model="filterKind"
          class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">All Containers</option>
          <option value="any">Has Update</option>
          <option value="major">Major</option>
          <option value="minor">Minor</option>
          <option value="patch">Patch</option>
          <option value="digest">Digest</option>
        </select>
        <label
          class="flex items-center gap-1.5 px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide cursor-pointer dd-bg dd-text select-none"
          v-tooltip="'Hide containers pinned to specific versions'"
        >
          <input
            type="checkbox"
            v-model="filterHidePinned"
            class="accent-[var(--dd-secondary)]"
          />
          Hide Pinned
        </label>
        <AppButton size="none" variant="plain" weight="none"
          v-if="activeFilterCount > 0 || filterSearch"
          class="text-2xs font-medium px-2 py-1 dd-rounded transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
          @click="clearFilters">
          Clear all
        </AppButton>
      </template>
      <template #extra-buttons>
        <div v-if="containerViewMode === 'table'">
          <AppIconButton icon="config" size="toolbar" variant="secondary"
            :class="showColumnPicker ? 'dd-text dd-bg-elevated' : ''"
            :tooltip="tt('Toggle columns')"
            @click.stop="toggleColumnPicker($event)" />
        </div>
      </template>
      <template #left>
        <AppIconButton icon="stack" size="toolbar" variant="secondary"
          :class="groupByStack ? 'dd-text dd-bg-elevated' : ''"
          :tooltip="tt('Group by stack')"
          @click="groupByStack = !groupByStack" />
        <AppIconButton icon="restart" size="toolbar" variant="secondary"
          :class="rechecking ? 'dd-text-muted cursor-wait' : ''"
          :disabled="rechecking"
          :loading="rechecking"
          :tooltip="tt('Recheck for updates')"
          @click="recheckAll" />
      </template>
      <template #center>
        <div
          v-if="!showFilters && activeFilterChips.length > 0"
          class="flex flex-wrap items-center gap-1.5 min-w-0"
        >
          <span
            class="text-3xs font-bold uppercase tracking-[0.22em] dd-text-muted"
          >
            Filters
          </span>
          <span
            v-for="chip in activeFilterChips"
            :key="chip"
            class="px-2 py-1 dd-rounded text-2xs font-medium whitespace-nowrap dd-bg-elevated dd-text"
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
      <div class="px-3 py-1 text-3xs font-bold uppercase tracking-wider dd-text-muted">Columns</div>
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
