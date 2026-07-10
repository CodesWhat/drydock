<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppIconButton from './AppIconButton.vue';

const { t } = useI18n();

defineProps<{
  /**
   * Current view mode ('table' | 'cards'). Optional — the switcher only renders when a
   * caller binds this (`v-model`). Views without a v-model (audit/watchers/servers/
   * registries/auth) stay table-only and must not grow a dead toggle.
   */
  modelValue?: string;
  filteredCount: number;
  totalCount: number;
  countLabel?: string;
  showFilters: boolean;
  activeFilterCount?: number;
  viewModes?: Array<{ id: string; icon: string }>;
  showColumnPicker?: boolean;
  hideFilter?: boolean;
  /**
   * Hide the table/cards switcher even when `modelValue` is bound. Used when the width forces
   * cards (mobile reflow): the switcher would be a dead control there, so it's just cards.
   */
  hideViewToggle?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [mode: string];
  'update:showFilters': [val: boolean];
}>();

const defaultViewModes = [
  { id: 'table', icon: 'table' },
  { id: 'cards', icon: 'grid' },
] as const;

const filterPanelId = `filter-panel-${Math.random().toString(36).slice(2, 10)}`;

function viewModeName(id: string): string {
  const key = `sharedComponents.dataFilterBar.viewModes.${id}`;
  const translated = t(key);
  return translated !== key ? translated : `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

function viewModeLabel(id: string): string {
  return t('sharedComponents.dataFilterBar.viewModeLabel', { label: viewModeName(id) });
}
</script>

<template>
  <div class="shrink-0 mb-4">
    <div class="px-3 py-2 dd-rounded relative z-20"
         :style="{
           backgroundColor: 'var(--dd-bg-card)',
         }">
      <div class="flex items-center gap-2.5 relative">
        <!-- Filter toggle button -->
        <div v-if="!hideFilter" class="relative" v-tooltip.top="t('sharedComponents.dataFilterBar.filters')">
          <AppIconButton icon="filter" size="toolbar" variant="plain" class="text-2xs-plus"
                  :class="showFilters || (activeFilterCount ?? 0) > 0 ? 'dd-text dd-bg-elevated' : 'dd-text-secondary hover:dd-text hover:dd-bg-elevated'"
                  :aria-label="t('sharedComponents.dataFilterBar.toggleFilters')"
                  :aria-expanded="String(showFilters)"
                  :aria-controls="filterPanelId"
                  @click.stop="emit('update:showFilters', !showFilters)" />
          <span v-if="(activeFilterCount ?? 0) > 0"
                class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-4xs font-bold flex items-center justify-center text-white pointer-events-none"
                style="background: var(--dd-primary);">
            {{ activeFilterCount }}
          </span>
        </div>

        <!-- Extra buttons (column picker, settings — left side) -->
        <slot name="extra-buttons" />

        <!-- Left slot (extra controls, after extra-buttons) -->
        <slot name="left" />

        <!-- Center slot (primary actions like Scan Now) -->
        <slot name="center" />

        <!-- Right side: count + view mode switcher -->
        <div class="flex items-center gap-2 ml-auto">
          <span class="text-2xs font-semibold tabular-nums shrink-0 px-2 py-1 dd-rounded dd-text-muted dd-bg-card">
            {{ filteredCount }}/{{ totalCount }}<template v-if="countLabel"> {{ countLabel }}</template>
          </span>
          <!-- Sort control (card mode only — table mode sorts via column headers) -->
          <slot name="sort" />
          <div v-if="modelValue !== undefined && !hideViewToggle"
               class="flex items-center dd-rounded overflow-hidden"
               role="group"
               :aria-label="t('sharedComponents.dataFilterBar.viewMode')">
            <AppIconButton v-for="vm in (viewModes ?? defaultViewModes)" :key="vm.id"
                    :icon="vm.icon" size="toolbar" variant="plain"
                    :class="modelValue === vm.id ? 'dd-text dd-bg-elevated' : 'dd-text-secondary hover:dd-text hover:dd-bg-elevated'"
                    :tooltip="viewModeLabel(vm.id)"
                    :aria-label="viewModeLabel(vm.id)"
                    :aria-pressed="String(modelValue === vm.id)"
                    @click="emit('update:modelValue', vm.id)" />
          </div>
        </div>
      </div>
      <!-- Collapsible filter panel -->
      <div v-if="showFilters && !hideFilter" :id="filterPanelId" @click.stop
           class="flex flex-wrap items-center gap-2 mt-2 pt-2"
           :style="{ borderTop: '1px solid var(--dd-border)' }">
        <slot name="filters" />
      </div>
    </div>
  </div>
</template>
