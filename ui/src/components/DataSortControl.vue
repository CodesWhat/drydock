<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppIconButton from './AppIconButton.vue';

const props = defineProps<{
  /** Sortable columns to choose from ({ key, display label }). */
  columns: Array<{ key: string; label: string }>;
  sortKey?: string;
  sortAsc?: boolean;
}>();

const emit = defineEmits<{
  'update:sortKey': [key: string];
  'update:sortAsc': [asc: boolean];
}>();

const { t } = useI18n();

// Picking a different field always resets to ascending; re-picking the current field is a
// no-op (direction is owned by the dedicated toggle, matching the table-header behaviour).
function onFieldChange(event: Event): void {
  const key = (event.target as HTMLSelectElement).value;
  if (!key || key === props.sortKey) {
    return;
  }
  emit('update:sortKey', key);
  emit('update:sortAsc', true);
}

function toggleDirection(): void {
  if (props.sortKey) {
    emit('update:sortAsc', props.sortAsc === false);
  }
}
</script>

<template>
  <div class="flex items-center gap-1" role="group" :aria-label="t('sharedComponents.dataTable.sortBy')">
    <select
      data-test="dd-toolbar-sort-select"
      class="h-8 min-w-0 max-w-[9rem] px-2 dd-rounded dd-bg-elevated dd-text text-2xs font-medium outline-none cursor-pointer"
      :aria-label="t('sharedComponents.dataTable.sortBy')"
      :value="sortKey ?? ''"
      @change="onFieldChange">
      <option value="" disabled hidden>{{ t('sharedComponents.dataTable.sortBy') }}</option>
      <option v-for="col in columns" :key="col.key" :value="col.key">{{ col.label }}</option>
    </select>
    <AppIconButton
      data-test="dd-toolbar-sort-direction"
      :icon="sortAsc === false ? 'sort-desc' : 'sort-asc'"
      size="toolbar"
      variant="plain"
      :disabled="!sortKey"
      class="dd-text-secondary hover:dd-text hover:dd-bg-elevated"
      :aria-pressed="String(!!sortKey && sortAsc !== false)"
      :tooltip="sortAsc === false
        ? t('sharedComponents.dataTable.sortDirectionDescending')
        : t('sharedComponents.dataTable.sortDirectionAscending')"
      :aria-label="sortAsc === false
        ? t('sharedComponents.dataTable.sortDirectionDescending')
        : t('sharedComponents.dataTable.sortDirectionAscending')"
      @click="toggleDirection" />
  </div>
</template>
