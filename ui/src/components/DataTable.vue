<script setup lang="ts">
import { reactive, ref } from 'vue';

export interface DataTableColumn {
  key: string;
  label: string;
  align?: string;
  sortable?: boolean;
  width?: string;
  /** Narrow icon-only column — no header text, tight padding, vertically centered */
  icon?: boolean;
}

const props = defineProps<{
  columns: DataTableColumn[];
  rows: Record<string, unknown>[];
  rowKey: string | ((row: Record<string, unknown>) => string);
  sortKey?: string;
  sortAsc?: boolean;
  selectedKey?: string | null;
  showActions?: boolean;
  compact?: boolean;
}>();

const emit = defineEmits<{
  'update:sortKey': [key: string];
  'update:sortAsc': [asc: boolean];
  'row-click': [row: Record<string, unknown>];
}>();

function getRowKey(
  row: Record<string, unknown>,
  rowKeyProp: string | ((row: Record<string, unknown>) => string),
): string {
  return typeof rowKeyProp === 'function' ? rowKeyProp(row) : row[rowKeyProp];
}

function toggleSort(
  key: string,
  currentSortKey: string | undefined,
  currentSortAsc: boolean | undefined,
) {
  if (currentSortKey === key) {
    emit('update:sortAsc', !currentSortAsc);
  } else {
    emit('update:sortKey', key);
    emit('update:sortAsc', true);
  }
}

// -- Column resizing --
const tableRef = ref<HTMLTableElement | null>(null);
const colWidths = reactive<Record<string, number>>({});
const resizing = ref(false);

function initWidths() {
  if (!tableRef.value) return;
  const ths = tableRef.value.querySelectorAll('thead th[data-col-key]');
  for (const th of ths) {
    const key = (th as HTMLElement).dataset.colKey;
    if (key && !(key in colWidths)) {
      colWidths[key] = (th as HTMLElement).getBoundingClientRect().width;
    }
  }
}

function onResizeStart(colKey: string, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  resizing.value = true;

  // Initialize widths from DOM if not yet done
  initWidths();

  const startX = event.clientX;
  const startWidth = colWidths[colKey] ?? 100;

  function onMove(e: MouseEvent) {
    const delta = e.clientX - startX;
    colWidths[colKey] = Math.max(40, startWidth + delta);
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Delay clearing resizing flag to prevent click-through to sort
    setTimeout(() => {
      resizing.value = false;
    }, 50);
  }

  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function colStyle(col: DataTableColumn): Record<string, string> {
  if (col.key in colWidths) {
    return { width: `${colWidths[col.key]}px`, minWidth: `${Math.min(colWidths[col.key], 40)}px` };
  }
  return col.width ? { width: col.width } : {};
}

function isSortableColumn(col: DataTableColumn): boolean {
  return col.sortable !== false && !col.icon;
}

function ariaSort(col: DataTableColumn): 'ascending' | 'descending' | 'none' | undefined {
  if (!isSortableColumn(col)) {
    return undefined;
  }
  if (props.sortKey !== col.key) {
    return 'none';
  }
  return props.sortAsc === false ? 'descending' : 'ascending';
}

function handleRowKeydown(event: KeyboardEvent, row: Record<string, unknown>) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('row-click', row);
  }
}

function handleHeaderKeydown(event: KeyboardEvent, col: DataTableColumn) {
  if (resizing.value || !isSortableColumn(col)) {
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleSort(col.key, props.sortKey, props.sortAsc);
  }
}
</script>

<template>
  <div class="dd-rounded overflow-hidden"
       :style="{ border: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-card)' }">
    <div class="overflow-hidden">
      <table ref="tableRef" class="w-full text-xs" :style="Object.keys(colWidths).length > 0 ? { tableLayout: 'fixed' } : {}">
        <thead>
          <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
            <th v-for="(col, colIdx) in columns" :key="col.key"
                :data-col-key="col.key"
                :class="[
                  col.icon ? 'text-center pl-5 pr-0' : ['text-center', 'px-5'],
                  'whitespace-nowrap py-2.5 font-semibold uppercase tracking-wider text-[10px] select-none transition-colors relative',
                  isSortableColumn(col) ? 'cursor-pointer' : '',
                  sortKey === col.key ? 'dd-text-secondary' : 'dd-text-muted hover:dd-text-secondary',
                ]"
                :style="colStyle(col)"
                :tabindex="isSortableColumn(col) ? 0 : undefined"
                :aria-sort="ariaSort(col)"
                @keydown="handleHeaderKeydown($event, col)"
                @click="!resizing && isSortableColumn(col) && toggleSort(col.key, sortKey, sortAsc)">
              {{ col.label }}
              <span v-if="sortKey === col.key" class="inline-block ml-0.5 text-[8px]">{{ sortAsc ? '\u25B2' : '\u25BC' }}</span>
              <!-- Resize handle -->
              <div v-if="!col.icon && colIdx < columns.length - 1"
                   role="separator"
                   aria-label="Resize column"
                   class="absolute top-0 right-0 w-2 h-full cursor-col-resize z-10 flex items-center justify-center transition-colors hover:bg-drydock-secondary/20"
                   @mousedown="onResizeStart(col.key, $event)">
                <div class="w-px h-3/5 rounded-full opacity-25 hover:opacity-60 transition-opacity"
                     style="background: var(--dd-text-muted)" />
              </div>
            </th>
            <th v-if="showActions" class="text-right px-4 py-2.5 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap dd-text-muted">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="getRowKey(row, rowKey)"
              class="cursor-pointer transition-colors hover:dd-bg-hover"
              :class="selectedKey != null && getRowKey(row, rowKey) === selectedKey ? 'ring-1 ring-inset ring-drydock-secondary' : ''"
              :style="{
                backgroundColor: selectedKey != null && getRowKey(row, rowKey) === selectedKey
                  ? 'var(--dd-bg-elevated)'
                  : (i % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-bg-inset)'),
                borderBottom: i < rows.length - 1 ? '1px solid var(--dd-border-strong)' : 'none',
              }"
              tabindex="0"
              @keydown="handleRowKeydown($event, row)"
              @click="emit('row-click', row)">
            <td v-for="col in columns" :key="col.key"
                class="py-3 align-middle overflow-hidden text-ellipsis"
                :class="col.icon ? 'text-center pl-5 pr-0' : [col.align ?? 'text-left', 'px-5']">
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
