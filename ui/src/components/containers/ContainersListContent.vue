<script setup lang="ts">
import ContainersGroupedViews from './ContainersGroupedViews.vue';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

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
} = useContainersViewTemplateContext();
</script>

<template>
  <div class="contents" data-test="containers-list-content">
    <div
      v-if="error"
      class="mb-3 px-3 py-2 text-[0.6875rem] dd-rounded"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="loading" class="text-[0.6875rem] dd-text-muted py-3 px-1">Loading containers...</div>

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
          class="flex-1 min-w-[140px] max-w-[260px] px-2.5 py-1.5 dd-rounded text-[0.6875rem] font-medium outline-none dd-bg dd-text dd-placeholder" />
        <select
          v-model="filterStatus"
          class="px-2 py-1.5 dd-rounded text-[0.6875rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">Status</option>
          <option value="running">Running</option>
          <option value="stopped">Stopped</option>
        </select>
        <select
          v-model="filterBouncer"
          class="px-2 py-1.5 dd-rounded text-[0.6875rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">Bouncer</option>
          <option value="safe">Safe</option>
          <option value="unsafe">Unsafe</option>
          <option value="blocked">Blocked</option>
        </select>
        <select
          v-model="filterRegistry"
          class="px-2 py-1.5 dd-rounded text-[0.6875rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">Registry</option>
          <option value="dockerhub">Docker Hub</option>
          <option value="ghcr">GHCR</option>
          <option value="custom">Custom</option>
        </select>
        <select
          v-model="filterServer"
          class="px-2 py-1.5 dd-rounded text-[0.6875rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">Host</option>
          <option v-for="serverName in serverNames" :key="serverName" :value="serverName">
            {{ serverName }}
          </option>
        </select>
        <select
          v-model="filterKind"
          class="px-2 py-1.5 dd-rounded text-[0.6875rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="all">Update</option>
          <option value="any">Has Update</option>
          <option value="major">Major</option>
          <option value="minor">Minor</option>
          <option value="patch">Patch</option>
          <option value="digest">Digest</option>
        </select>
        <button
          v-if="activeFilterCount > 0 || filterSearch"
          class="text-[0.625rem] font-medium px-2 py-1 dd-rounded transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
          @click="clearFilters">
          Clear all
        </button>
      </template>
      <template #extra-buttons>
        <div v-if="containerViewMode === 'table'">
          <button
            class="w-7 h-7 dd-rounded flex items-center justify-center text-[0.6875rem] transition-colors"
            :class="showColumnPicker ? 'dd-text dd-bg-elevated' : 'dd-text-secondary hover:dd-text hover:dd-bg-elevated'"
            v-tooltip.top="tt('Toggle columns')"
            @click.stop="toggleColumnPicker($event)">
            <AppIcon name="config" :size="12" />
          </button>
        </div>
      </template>
      <template #left>
        <button
          class="w-7 h-7 dd-rounded flex items-center justify-center text-[0.6875rem] transition-colors"
          :class="groupByStack ? 'dd-text dd-bg-elevated' : 'dd-text-secondary hover:dd-text hover:dd-bg-elevated'"
          v-tooltip.top="tt('Group by stack')"
          @click="groupByStack = !groupByStack">
          <AppIcon name="stack" :size="13" />
        </button>
        <button
          class="w-7 h-7 dd-rounded flex items-center justify-center text-[0.6875rem] transition-colors"
          :class="rechecking ? 'dd-text-muted cursor-wait' : 'dd-text-secondary hover:dd-text hover:dd-bg-elevated'"
          :disabled="rechecking"
          v-tooltip.top="tt('Recheck for updates')"
          @click="recheckAll">
          <AppIcon name="restart" :size="13" :class="{ 'animate-spin': rechecking }" />
        </button>
      </template>
    </DataFilterBar>

    <div
      v-if="showColumnPicker"
      class="z-50 min-w-[160px] py-1.5 dd-rounded shadow-lg"
      :style="{
        ...columnPickerStyle,
        backgroundColor: 'var(--dd-bg-card)',
        border: '1px solid var(--dd-border-strong)',
        boxShadow: 'var(--dd-shadow-lg)',
      }"
      @click.stop>
      <div class="px-3 py-1 text-[0.5625rem] font-bold uppercase tracking-wider dd-text-muted">Columns</div>
      <button
        v-for="column in allColumns.filter((columnItem) => columnItem.label)"
        :key="column.key"
        class="w-full text-left px-3 py-1.5 text-[0.6875rem] font-medium transition-colors flex items-center gap-2 hover:dd-bg-elevated"
        :class="column.required ? 'dd-text-muted cursor-not-allowed' : 'dd-text'"
        @click="toggleColumn(column.key)">
        <AppIcon
          :name="visibleColumns.has(column.key) ? 'check' : 'square'"
          :size="10"
          :style="visibleColumns.has(column.key) ? { color: 'var(--dd-primary)' } : {}" />
        {{ column.label }}
      </button>
    </div>

    <ContainersGroupedViews />
  </div>
</template>
