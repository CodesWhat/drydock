<script setup lang="ts">
defineProps<{
  modelValue: string;
  filteredCount: number;
  totalCount: number;
  countLabel?: string;
  showFilters: boolean;
  activeFilterCount?: number;
  viewModes?: Array<{ id: string; icon: string }>;
  showColumnPicker?: boolean;
  hideFilter?: boolean;
}>();

defineEmits<{
  'update:modelValue': [mode: string];
  'update:showFilters': [val: boolean];
}>();

const defaultViewModes = [
  { id: 'table', icon: 'table' },
  { id: 'cards', icon: 'grid' },
  { id: 'list', icon: 'list' },
] as const;
</script>

<template>
  <div class="shrink-0 mb-4">
    <div class="px-3 py-2 dd-rounded relative z-[1]"
         :style="{
           backgroundColor: 'var(--dd-bg-card)',
           border: '1px solid var(--dd-border-strong)',
         }">
      <div class="flex items-center gap-2.5">
        <!-- Filter toggle button -->
        <div v-if="!hideFilter" class="relative">
          <button class="w-7 h-7 dd-rounded flex items-center justify-center text-[11px] transition-colors border"
                  :class="showFilters || (activeFilterCount ?? 0) > 0 ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                  :style="{ borderColor: (activeFilterCount ?? 0) > 0 ? 'var(--dd-primary)' : 'var(--dd-border-strong)' }"
                  title="Filters"
                  @click.stop="$emit('update:showFilters', !showFilters)">
            <AppIcon name="filter" :size="11" />
          </button>
          <span v-if="(activeFilterCount ?? 0) > 0"
                class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white"
                style="background: var(--dd-primary);">
            {{ activeFilterCount }}
          </span>
        </div>

        <!-- Extra buttons (column picker, settings — left side) -->
        <slot name="extra-buttons" />

        <!-- Left slot (extra controls) -->
        <slot name="left" />

        <!-- Right side: count + view mode switcher -->
        <div class="flex items-center gap-2 ml-auto">
          <span class="text-[10px] font-semibold tabular-nums shrink-0 px-2 py-1 dd-rounded dd-text-muted dd-bg-card">
            {{ filteredCount }}/{{ totalCount }}<template v-if="countLabel"> {{ countLabel }}</template>
          </span>
          <div class="flex items-center dd-rounded overflow-hidden border"
               :style="{ borderColor: 'var(--dd-border-strong)' }">
            <button v-for="vm in (viewModes ?? defaultViewModes)" :key="vm.id"
                    class="w-7 h-7 flex items-center justify-center text-[11px] transition-colors"
                    :class="modelValue === vm.id ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                    :style="vm.id !== (viewModes ?? defaultViewModes)[0]?.id ? { borderLeft: '1px solid var(--dd-border-strong)' } : {}"
                    :title="vm.id.charAt(0).toUpperCase() + vm.id.slice(1) + ' view'"
                    @click="$emit('update:modelValue', vm.id)">
              <AppIcon :name="vm.icon" :size="11" />
            </button>
          </div>
        </div>
      </div>
      <!-- Collapsible filter panel -->
      <div v-if="showFilters && !hideFilter" @click.stop
           class="flex flex-wrap items-center gap-2 mt-2 pt-2"
           :style="{ borderTop: '1px solid var(--dd-border)' }">
        <slot name="filters" />
      </div>
    </div>
  </div>
</template>
