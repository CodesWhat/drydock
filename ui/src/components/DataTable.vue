<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';

export interface DataTableColumn {
  key: string;
  label: string;
  align?: string;
  sortable?: boolean;
  width?: string;
  /** Narrow icon-only column — no header text, tight padding, vertically centered */
  icon?: boolean;
}

const props = withDefaults(
  defineProps<{
    columns: DataTableColumn[];
    rows: Record<string, unknown>[];
    rowKey: string | ((row: Record<string, unknown>) => string);
    sortKey?: string;
    sortAsc?: boolean;
    selectedKey?: string | null;
    showActions?: boolean;
    compact?: boolean;
    fixedLayout?: boolean;
    virtualScroll?: boolean;
    virtualRowHeight?: number;
    virtualOverscan?: number;
    virtualMaxHeight?: string;
    /** Optional max-height for scroll area when virtualScroll is false (e.g., '340px') */
    maxHeight?: string;
    /** Optional function returning extra CSS classes for a row (e.g. dim during actions) */
    rowClass?: (row: Record<string, unknown>) => string;
  }>(),
  {
    showActions: false,
    compact: false,
    fixedLayout: false,
    virtualScroll: false,
    virtualRowHeight: 56,
    virtualOverscan: 6,
    virtualMaxHeight: '70vh',
  },
);

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
const scrollViewportRef = ref<HTMLDivElement | null>(null);
const colWidths = reactive<Record<string, number>>({});
const resizing = ref(false);
const virtualScrollTop = ref(0);
const virtualViewportHeight = ref(0);
const BODY_RESIZE_CLASS = 'dd-col-resizing';
let activeResizeCleanup: (() => void) | null = null;
const lastResizableColumnKey = computed(() => {
  for (let i = props.columns.length - 1; i >= 0; i -= 1) {
    if (!props.columns[i].icon) {
      return props.columns[i].key;
    }
  }
  return null;
});

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

function getHeaderEl(colKey: string): HTMLElement | null {
  if (!tableRef.value) return null;
  const headers = tableRef.value.querySelectorAll<HTMLElement>('thead th[data-col-key]');
  for (const header of headers) {
    if (header.dataset.colKey === colKey) {
      return header;
    }
  }
  return null;
}

function parsePixelHeight(value: string): number | null {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)px$/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const totalColumnCount = computed(() => props.columns.length + (props.showActions ? 1 : 0));
const normalizedRowHeight = computed(() => Math.max(24, props.virtualRowHeight));
const normalizedOverscan = computed(() => Math.max(0, props.virtualOverscan));
const virtualizationEnabled = computed(() => props.virtualScroll && props.rows.length > 0);
const useFixedLayout = computed(() => props.fixedLayout || Object.keys(colWidths).length > 0);

function fallbackViewportHeight(): number {
  const explicitMaxHeight = parsePixelHeight(props.virtualMaxHeight);
  if (explicitMaxHeight !== null) {
    return explicitMaxHeight;
  }
  return normalizedRowHeight.value * 10;
}

function syncViewportHeight() {
  if (!props.virtualScroll) {
    virtualViewportHeight.value = 0;
    return;
  }
  const measured = scrollViewportRef.value?.clientHeight ?? 0;
  virtualViewportHeight.value = measured > 0 ? measured : fallbackViewportHeight();
}

function clampScrollTop() {
  if (!props.virtualScroll) {
    return;
  }
  const maxScrollTop = Math.max(
    props.rows.length * normalizedRowHeight.value - virtualViewportHeight.value,
    0,
  );
  if (virtualScrollTop.value <= maxScrollTop) {
    return;
  }
  virtualScrollTop.value = maxScrollTop;
  if (scrollViewportRef.value) {
    scrollViewportRef.value.scrollTop = maxScrollTop;
  }
}

watch(
  () => props.virtualScroll,
  (enabled) => {
    if (!enabled) {
      virtualScrollTop.value = 0;
      if (scrollViewportRef.value) {
        scrollViewportRef.value.scrollTop = 0;
      }
      return;
    }
    void nextTick(syncViewportHeight);
  },
  { immediate: true },
);

watch(() => props.rows.length, clampScrollTop);
watch(() => props.virtualMaxHeight, syncViewportHeight);
watch(normalizedRowHeight, () => {
  syncViewportHeight();
  clampScrollTop();
});

onMounted(() => {
  syncViewportHeight();
  globalThis.addEventListener('resize', syncViewportHeight);
});

onUnmounted(() => {
  if (activeResizeCleanup) {
    activeResizeCleanup();
    activeResizeCleanup = null;
  }
  document.body.classList.remove(BODY_RESIZE_CLASS);
  resizing.value = false;
  globalThis.removeEventListener('resize', syncViewportHeight);
});

function handleVirtualScroll(event: Event) {
  if (!props.virtualScroll) {
    return;
  }
  const target = event.target as HTMLElement;
  virtualScrollTop.value = target.scrollTop;
}

const visibleRangeStart = computed(() => {
  if (!virtualizationEnabled.value) {
    return 0;
  }
  const candidate =
    Math.floor(virtualScrollTop.value / normalizedRowHeight.value) - normalizedOverscan.value;
  return Math.max(0, candidate);
});

const visibleRangeEnd = computed(() => {
  if (!virtualizationEnabled.value) {
    return props.rows.length;
  }
  const viewport =
    virtualViewportHeight.value > 0 ? virtualViewportHeight.value : fallbackViewportHeight();
  const visibleRows = Math.max(
    1,
    Math.ceil(viewport / normalizedRowHeight.value) + normalizedOverscan.value * 2,
  );
  return Math.min(props.rows.length, visibleRangeStart.value + visibleRows);
});

const visibleRows = computed(() => {
  if (!virtualizationEnabled.value) {
    return props.rows;
  }
  return props.rows.slice(visibleRangeStart.value, visibleRangeEnd.value);
});

const topSpacerHeight = computed(() =>
  virtualizationEnabled.value ? visibleRangeStart.value * normalizedRowHeight.value : 0,
);

const bottomSpacerHeight = computed(() =>
  virtualizationEnabled.value
    ? (props.rows.length - visibleRangeEnd.value) * normalizedRowHeight.value
    : 0,
);

function rowAbsoluteIndex(localIndex: number): number {
  if (!virtualizationEnabled.value) {
    return localIndex;
  }
  return visibleRangeStart.value + localIndex;
}

function applyLiveWidth(colKey: string, width: number) {
  const header = getHeaderEl(colKey);
  if (!header) return;
  header.setAttribute('width', String(Math.round(width)));
}

function onResizeStart(colKey: string, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (activeResizeCleanup) {
    activeResizeCleanup();
    activeResizeCleanup = null;
  }
  resizing.value = true;

  // Initialize widths from DOM if not yet done
  initWidths();

  const startX = event.clientX;
  const headerWidth = getHeaderEl(colKey)?.getBoundingClientRect().width;
  const startWidth = (headerWidth && headerWidth > 0 ? headerWidth : colWidths[colKey]) ?? 100;
  let liveWidth = Math.max(40, startWidth);

  function onMove(e: MouseEvent) {
    const delta = e.clientX - startX;
    liveWidth = Math.max(40, startWidth + delta);
    applyLiveWidth(colKey, liveWidth);
  }

  function onUp() {
    activeResizeCleanup?.();
    activeResizeCleanup = null;
    colWidths[colKey] = liveWidth;
    // Delay clearing resizing flag to prevent click-through to sort
    setTimeout(() => {
      resizing.value = false;
    }, 50);
  }

  document.body.classList.add(BODY_RESIZE_CLASS);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  activeResizeCleanup = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove(BODY_RESIZE_CLASS);
  };
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
       :style="{ backgroundColor: 'var(--dd-bg-card)' }">
    <div
      ref="scrollViewportRef"
      class="overflow-x-auto"
      :class="virtualScroll || maxHeight ? 'overflow-y-auto' : 'overflow-y-visible'"
      :data-test="virtualScroll ? 'data-table-scroll' : undefined"
      :style="virtualScroll ? { maxHeight: virtualMaxHeight } : maxHeight ? { maxHeight } : {}"
      @scroll="handleVirtualScroll">
      <table
        ref="tableRef"
        class="w-full text-xs isolate"
        :style="{ borderCollapse: 'separate', borderSpacing: '0', ...(useFixedLayout ? { tableLayout: 'fixed' } : {}) }">
        <thead>
          <tr :style="{ backgroundColor: 'var(--dd-bg-inset)', borderBottom: 'none' }">
            <th v-for="(col, colIdx) in columns" :key="col.key"
                :data-col-key="col.key"
                :class="[
                  col.icon ? 'text-center pl-5 pr-0' : [col.align ?? 'text-center', 'px-5'],
                  'whitespace-nowrap py-2.5 font-semibold uppercase tracking-wider text-2xs select-none transition-colors relative',
                  isSortableColumn(col) ? 'cursor-pointer' : '',
                  sortKey === col.key ? 'dd-text-secondary' : 'dd-text-muted hover:dd-text-secondary',
                ]"
                :style="colStyle(col)"
                :tabindex="isSortableColumn(col) ? 0 : undefined"
                :aria-sort="ariaSort(col)"
                @keydown="handleHeaderKeydown($event, col)"
                @click="!resizing && isSortableColumn(col) && toggleSort(col.key, sortKey, sortAsc)">
              {{ col.label }}
              <span v-if="sortKey === col.key" class="inline-block ml-0.5 text-4xs">{{ sortAsc ? '\u25B2' : '\u25BC' }}</span>
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
            <th v-if="showActions" class="text-center px-4 py-2.5 font-semibold uppercase tracking-wider text-2xs whitespace-nowrap dd-text-muted relative">
              Actions
              <div v-if="lastResizableColumnKey"
                   role="separator"
                   aria-label="Resize column"
                   class="absolute top-0 left-0 w-2 h-full cursor-col-resize z-10 flex items-center justify-center transition-colors hover:bg-drydock-secondary/20"
                   @mousedown="onResizeStart(lastResizableColumnKey, $event)">
                <div class="w-px h-3/5 rounded-full opacity-25 hover:opacity-60 transition-opacity"
                     style="background: var(--dd-text-muted)" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-if="topSpacerHeight > 0"
            aria-hidden="true"
            class="pointer-events-none">
            <td :colspan="totalColumnCount" class="p-0 border-0" :style="{ height: `${topSpacerHeight}px` }" />
          </tr>
          <tr v-for="(row, i) in visibleRows" :key="getRowKey(row, rowKey)"
              class="cursor-pointer transition-colors hover:dd-bg-hover"
              :class="[
                selectedKey != null && getRowKey(row, rowKey) === selectedKey ? 'ring-1 ring-inset ring-drydock-secondary' : '',
                rowClass?.(row) ?? '',
              ]"
              :style="{
                backgroundColor: selectedKey != null && getRowKey(row, rowKey) === selectedKey
                  ? 'var(--dd-bg-elevated)'
                  : (rowAbsoluteIndex(i) % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-bg-inset)'),
                borderBottom: 'none',
              }"
              tabindex="0"
              @keydown="handleRowKeydown($event, row)"
              @click="emit('row-click', row)">
            <td v-for="col in columns" :key="col.key"
                class="py-3 align-middle"
                :class="col.icon ? 'text-center pl-5 pr-0' : ['overflow-hidden text-ellipsis', col.align ?? 'text-center', 'px-5']">
              <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]">
                {{ row[col.key] }}
              </slot>
            </td>
            <td v-if="showActions" class="px-3 py-3 text-right whitespace-nowrap relative">
              <slot name="actions" :row="row" />
            </td>
          </tr>
          <tr
            v-if="bottomSpacerHeight > 0"
            aria-hidden="true"
            class="pointer-events-none">
            <td :colspan="totalColumnCount" class="p-0 border-0" :style="{ height: `${bottomSpacerHeight}px` }" />
          </tr>
        </tbody>
      </table>
    </div>
    <!-- Empty state -->
    <slot v-if="rows.length === 0" name="empty" />
  </div>
</template>
