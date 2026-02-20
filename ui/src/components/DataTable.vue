<script setup lang="ts">
export interface DataTableColumn {
  key: string
  label: string
  align?: string
  sortable?: boolean
  width?: string
}

defineProps<{
  columns: DataTableColumn[]
  rows: any[]
  rowKey: string | ((row: any) => string)
  sortKey?: string
  sortAsc?: boolean
  selectedKey?: string | null
  showActions?: boolean
  compact?: boolean
}>();

defineEmits<{
  'update:sortKey': [key: string]
  'update:sortAsc': [asc: boolean]
  'row-click': [row: any]
}>();

function getRowKey(row: any, rowKeyProp: string | ((row: any) => string)): string {
  return typeof rowKeyProp === 'function' ? rowKeyProp(row) : row[rowKeyProp];
}

function toggleSort(key: string, currentSortKey: string | undefined, currentSortAsc: boolean | undefined, emit: any) {
  if (currentSortKey === key) {
    emit('update:sortAsc', !currentSortAsc);
  } else {
    emit('update:sortKey', key);
    emit('update:sortAsc', true);
  }
}
</script>

<template>
  <div class="dd-rounded overflow-hidden"
       :style="{ border: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-card)' }">
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
            <th v-for="col in columns" :key="col.key"
                :class="[
                  col.align ?? 'text-left',
                  'px-5 whitespace-nowrap py-2.5 font-semibold uppercase tracking-wider text-[10px] select-none transition-colors',
                  (col.sortable !== false) ? 'cursor-pointer' : '',
                  sortKey === col.key ? 'dd-text-secondary' : 'dd-text-muted hover:dd-text-secondary',
                ]"
                :style="col.width ? { width: col.width } : {}"
                @click="(col.sortable !== false) && toggleSort(col.key, sortKey, sortAsc, $emit)">
              {{ col.label }}
              <span v-if="sortKey === col.key" class="inline-block ml-0.5 text-[8px]">{{ sortAsc ? '\u25B2' : '\u25BC' }}</span>
            </th>
            <th v-if="showActions" class="text-right px-4 py-2.5 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap dd-text-muted">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="getRowKey(row, rowKey)"
              class="cursor-pointer transition-colors hover:dd-bg-elevated"
              :class="selectedKey != null && getRowKey(row, rowKey) === selectedKey ? 'ring-1 ring-inset ring-drydock-secondary' : ''"
              :style="{
                backgroundColor: selectedKey != null && getRowKey(row, rowKey) === selectedKey
                  ? 'var(--dd-bg-elevated)'
                  : (i % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-bg-inset)'),
                borderBottom: i < rows.length - 1 ? '1px solid var(--dd-border-strong)' : 'none',
              }"
              @click="$emit('row-click', row)">
            <td v-for="col in columns" :key="col.key"
                :class="[col.align ?? 'text-left', 'px-5 py-3']">
              <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]">
                {{ row[col.key] }}
              </slot>
            </td>
            <td v-if="showActions" class="px-3 py-3 text-right whitespace-nowrap relative">
              <slot name="actions" :row="row" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- Empty state -->
    <slot v-if="rows.length === 0" name="empty" />
  </div>
</template>
