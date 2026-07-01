<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { preferences } from '../preferences/store';
import {
  ACTIONS_COLUMN_KEY,
  clampColumnSize,
  normalizeTableColumnSizing,
  parsePixelSize,
  type NormalizedTableColumnSizing,
  type TableColumnAutoSize,
  type TableColumnOverflow,
} from '../utils/table-sizing';

const { t } = useI18n();

export interface DataTableColumn {
  key: string;
  label: string;
  align?: string;
  sortable?: boolean;
  size?: number;
  minSize?: number;
  maxSize?: number;
  flex?: number;
  priority?: number;
  overflow?: TableColumnOverflow;
  autoSize?: TableColumnAutoSize;
  /** Legacy compatibility. First-party callers should use numeric sizing fields. */
  width?: string;
  /** Tailwind horizontal padding class (e.g. 'px-3', 'px-5'). Defaults to px-5. */
  px?: string;
  /** Narrow icon-only column — no header text, tight padding, vertically centered */
  icon?: boolean;
  /** Optional tooltip shown on the column header label */
  headerTooltip?: string;
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
    /** Stable per-view key used for persisted column widths. */
    storageKey?: string;
    /** Optional width (e.g. '160px') for the trailing actions column. Defaults to 80px. */
    actionsWidth?: string;
    compact?: boolean;
    fixedLayout?: boolean;
    virtualScroll?: boolean;
    virtualRowHeight?: number;
    virtualOverscan?: number;
    virtualMaxHeight?: string;
    rowHeight?: (row: Record<string, unknown>) => number;
    /** Optional max-height for scroll area when virtualScroll is false (e.g., '340px') */
    maxHeight?: string;
    /** Optional function returning extra CSS classes for a row (e.g. dim during actions) */
    rowClass?: (row: Record<string, unknown>) => string;
    /** Optional function marking rows that should render a single full-width cell */
    fullWidthRow?: (row: Record<string, unknown>) => boolean;
    /** Optional function controlling whether a row should behave like a clickable/selectable data row */
    rowInteractive?: (row: Record<string, unknown>) => boolean;
    /** When true, hides column resize handles for touch-only interaction */
    isMobile?: boolean;
  }>(),
  {
    showActions: false,
    actionsWidth: '80px',
    compact: false,
    fixedLayout: false,
    virtualScroll: false,
    virtualRowHeight: 56,
    virtualOverscan: 6,
    virtualMaxHeight: '70vh',
    isMobile: false,
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
const liveColumnWidths = reactive<Record<string, number>>({});
const viewportWidth = ref(0);
const resizing = ref(false);
const virtualScrollTop = ref(0);
const virtualViewportHeight = ref(0);
const BODY_RESIZE_CLASS = 'dd-col-resizing';
let activeResizeCleanup: (() => void) | null = null;
let tableResizeObserver: ResizeObserver | null = null;

interface ResolvedDataTableColumn extends DataTableColumn {
  resolvedWidth: number;
  sizing: NormalizedTableColumnSizing;
}

function ensureTableWidthPreferences(): Record<string, Record<string, number>> {
  preferences.tables ??= { columnWidths: {} };
  preferences.tables.columnWidths ??= {};
  return preferences.tables.columnWidths;
}

function getPersistedColumnWidth(colKey: string): number | undefined {
  if (!props.storageKey) {
    return undefined;
  }
  const width = ensureTableWidthPreferences()[props.storageKey]?.[colKey];
  return typeof width === 'number' && Number.isFinite(width) ? width : undefined;
}

function persistColumnWidth(colKey: string, width: number): void {
  if (!props.storageKey) {
    return;
  }
  const tables = ensureTableWidthPreferences();
  tables[props.storageKey] ??= {};
  tables[props.storageKey][colKey] = Math.round(width);
}

function clearPersistedColumnWidth(colKey: string): void {
  delete liveColumnWidths[colKey];
  if (!props.storageKey) {
    return;
  }
  const bucket = ensureTableWidthPreferences()[props.storageKey];
  if (!bucket) {
    return;
  }
  delete bucket[colKey];
  if (Object.keys(bucket).length === 0) {
    delete ensureTableWidthPreferences()[props.storageKey];
  }
}

function actionColumnSize(): number {
  return parsePixelSize(props.actionsWidth) ?? 80;
}

const actionsColumn = computed<ResolvedDataTableColumn>(() => {
  const size = actionColumnSize();
  const sizing = normalizeTableColumnSizing({
    key: ACTIONS_COLUMN_KEY,
    size,
    minSize: Math.max(80, size),
    maxSize: Math.max(80, size),
    autoSize: 'fixed',
  });
  return {
    key: ACTIONS_COLUMN_KEY,
    label: t('sharedComponents.dataTable.actions'),
    sortable: false,
    align: 'text-right',
    size,
    minSize: sizing.minSize,
    maxSize: sizing.maxSize,
    autoSize: 'fixed',
    overflow: 'truncate',
    resolvedWidth: sizing.size,
    sizing,
  };
});

const normalizedColumns = computed(() =>
  props.columns.map((column) => ({
    column,
    sizing: normalizeTableColumnSizing(column),
  })),
);

function resolveColumnWidths(): Record<string, number> {
  const base = normalizedColumns.value.map(({ column, sizing }) => {
    const manual = liveColumnWidths[column.key];
    const persisted = getPersistedColumnWidth(column.key);
    const width = manual ?? persisted ?? sizing.size;
    return {
      key: column.key,
      width: clampColumnSize(width, sizing.minSize, sizing.maxSize),
      sizing,
    };
  });

  const widthMap = Object.fromEntries(base.map((entry) => [entry.key, entry.width]));
  const available = viewportWidth.value;
  const flexColumns = base.filter((entry) => entry.sizing.flex > 0);
  if (available <= 0 || flexColumns.length === 0) {
    return widthMap;
  }

  const actionsWidth = props.showActions ? actionsColumn.value.resolvedWidth : 0;
  const totalBaseWidth = base.reduce((acc, entry) => acc + entry.width, 0) + actionsWidth;
  const extra = available - totalBaseWidth;
  if (extra <= 0) {
    return widthMap;
  }

  const totalFlex = flexColumns.reduce((acc, entry) => acc + entry.sizing.flex, 0);
  if (totalFlex <= 0) {
    return widthMap;
  }

  let remainingExtra = extra;
  let remainingFlex = totalFlex;
  for (const entry of flexColumns) {
    const share = remainingExtra * (entry.sizing.flex / remainingFlex);
    const nextWidth = clampColumnSize(
      entry.width + share,
      entry.sizing.minSize,
      entry.sizing.maxSize,
    );
    widthMap[entry.key] = nextWidth;
    remainingExtra -= nextWidth - entry.width;
    remainingFlex -= entry.sizing.flex;
  }

  return widthMap;
}

const resolvedColumnWidths = computed(resolveColumnWidths);

const resolvedColumns = computed<ResolvedDataTableColumn[]>(() =>
  normalizedColumns.value.map(({ column, sizing }) => ({
    ...column,
    resolvedWidth: resolvedColumnWidths.value[column.key] ?? sizing.size,
    sizing,
  })),
);

const allResolvedColumns = computed(() =>
  props.showActions ? [...resolvedColumns.value, actionsColumn.value] : resolvedColumns.value,
);

/** Key of the first non-icon column — this column is pinned sticky-left for mobile scroll. */
const firstNonIconColKey = computed<string | null>(
  () => resolvedColumns.value.find((col) => !col.icon)?.key ?? null,
);

const rowOverlayWidth = computed(() =>
  viewportWidth.value > 0 ? `${Math.round(viewportWidth.value)}px` : '100%',
);

function resolvedColumn(colKey: string): ResolvedDataTableColumn | undefined {
  return allResolvedColumns.value.find((column) => column.key === colKey);
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
const useFixedLayout = computed(() => props.fixedLayout || allResolvedColumns.value.length > 0);

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

function syncTableViewportWidth() {
  viewportWidth.value = scrollViewportRef.value?.clientWidth ?? 0;
}

// Prefix sums over caller-estimated row heights so the visible window and spacers can be
// resolved with binary search when rows have a few discrete heights (group headers,
// policy-indicator rows, etc.).
function estimateRowHeight(row: Record<string, unknown>): number {
  const estimator = props.rowHeight;
  if (typeof estimator === 'function') {
    const candidate = estimator(row);
    if (Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return normalizedRowHeight.value;
}

const rowOffsets = computed<number[]>(() => {
  const rows = props.rows;
  const offsets = new Array<number>(rows.length + 1);
  offsets[0] = 0;
  let acc = 0;
  for (let i = 0; i < rows.length; i += 1) {
    acc += Math.max(1, estimateRowHeight(rows[i]));
    offsets[i + 1] = acc;
  }
  return offsets;
});

const totalContentHeight = computed(() => {
  const offsets = rowOffsets.value;
  return offsets[offsets.length - 1] ?? 0;
});

function findFirstVisibleIndex(scrollTop: number): number {
  const offsets = rowOffsets.value;
  const last = offsets.length - 1;
  if (last <= 0) {
    return 0;
  }
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (offsets[mid] <= scrollTop) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

function findLastVisibleIndex(scrollBottom: number, start: number): number {
  const offsets = rowOffsets.value;
  const n = offsets.length - 1;
  let lo = Math.max(start, 0);
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] >= scrollBottom) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

function clampScrollTop() {
  if (!props.virtualScroll) {
    return;
  }
  const maxScrollTop = Math.max(totalContentHeight.value - virtualViewportHeight.value, 0);
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
  syncTableViewportWidth();
  if (scrollViewportRef.value && typeof ResizeObserver !== 'undefined') {
    tableResizeObserver = new ResizeObserver(syncTableViewportWidth);
    tableResizeObserver.observe(scrollViewportRef.value);
  }
  globalThis.addEventListener('resize', syncViewportHeight);
  globalThis.addEventListener('resize', syncTableViewportWidth);
});

onUnmounted(() => {
  if (activeResizeCleanup) {
    activeResizeCleanup();
    activeResizeCleanup = null;
  }
  document.body.classList.remove(BODY_RESIZE_CLASS);
  resizing.value = false;
  tableResizeObserver?.disconnect();
  tableResizeObserver = null;
  globalThis.removeEventListener('resize', syncViewportHeight);
  globalThis.removeEventListener('resize', syncTableViewportWidth);
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
  const candidate = findFirstVisibleIndex(virtualScrollTop.value) - normalizedOverscan.value;
  return Math.max(0, candidate);
});

const visibleRangeEnd = computed(() => {
  if (!virtualizationEnabled.value) {
    return props.rows.length;
  }
  const viewport =
    virtualViewportHeight.value > 0 ? virtualViewportHeight.value : fallbackViewportHeight();
  const scrollBottom = virtualScrollTop.value + viewport;
  const endInclusive = findLastVisibleIndex(scrollBottom, visibleRangeStart.value);
  return Math.min(props.rows.length, endInclusive + 1 + normalizedOverscan.value);
});

const visibleRows = computed(() => {
  if (!virtualizationEnabled.value) {
    return props.rows;
  }
  return props.rows.slice(visibleRangeStart.value, visibleRangeEnd.value);
});

const topSpacerHeight = computed(() => {
  if (!virtualizationEnabled.value) {
    return 0;
  }
  return rowOffsets.value[visibleRangeStart.value] ?? 0;
});

const bottomSpacerHeight = computed(() => {
  if (!virtualizationEnabled.value) {
    return 0;
  }
  const total = totalContentHeight.value;
  const offset = rowOffsets.value[visibleRangeEnd.value] ?? total;
  return Math.max(0, total - offset);
});

function rowAbsoluteIndex(localIndex: number): number {
  if (!virtualizationEnabled.value) {
    return localIndex;
  }
  return visibleRangeStart.value + localIndex;
}

function setColumnWidth(colKey: string, width: number, persist = true): void {
  const column = resolvedColumn(colKey);
  if (!column) {
    return;
  }
  const nextWidth = clampColumnSize(width, column.sizing.minSize, column.sizing.maxSize);
  liveColumnWidths[colKey] = nextWidth;
  if (persist) {
    persistColumnWidth(colKey, nextWidth);
  }
}

function measureColumnContentWidth(colKey: string): number {
  const table = tableRef.value;
  if (!table) {
    return resolvedColumn(colKey)?.resolvedWidth ?? 0;
  }

  const candidates = [
    ...Array.from(table.querySelectorAll<HTMLElement>('thead th[data-col-key]')),
    ...Array.from(table.querySelectorAll<HTMLElement>('tbody td[data-col-key]')),
  ].filter((element) => element.dataset.colKey === colKey);

  const measured = candidates.reduce((maxWidth, element) => {
    const scrollWidth = element.scrollWidth;
    const rectWidth = element.getBoundingClientRect().width;
    return Math.max(maxWidth, scrollWidth, rectWidth);
  }, 0);

  return measured + 24;
}

function autosizeColumn(colKey: string): void {
  const column = resolvedColumn(colKey);
  if (!column) {
    return;
  }
  setColumnWidth(colKey, measureColumnContentWidth(colKey));
}

function resetColumnWidth(colKey: string): void {
  clearPersistedColumnWidth(colKey);
}

function onResizeStart(colKey: string, event: PointerEvent) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const column = resolvedColumn(colKey);
  if (!column || column.icon) {
    return;
  }
  if (activeResizeCleanup) {
    activeResizeCleanup();
    activeResizeCleanup = null;
  }
  resizing.value = true;

  const startX = event.clientX;
  const startWidth = column.resolvedWidth;
  const pointerId = event.pointerId;
  const target = event.currentTarget as HTMLElement | null;
  target?.setPointerCapture?.(pointerId);
  let liveWidth = startWidth;

  function onMove(e: PointerEvent) {
    if (pointerId !== undefined && e.pointerId !== pointerId) {
      return;
    }
    const delta = e.clientX - startX;
    liveWidth = clampColumnSize(startWidth + delta, column.sizing.minSize, column.sizing.maxSize);
    setColumnWidth(colKey, liveWidth, false);
  }

  function onUp(e: PointerEvent) {
    if (pointerId !== undefined && e.pointerId !== pointerId) {
      return;
    }
    activeResizeCleanup?.();
    activeResizeCleanup = null;
    target?.releasePointerCapture?.(pointerId);
    setColumnWidth(colKey, liveWidth, true);
    resizing.value = false;
  }

  document.body.classList.add(BODY_RESIZE_CLASS);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  activeResizeCleanup = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    document.body.classList.remove(BODY_RESIZE_CLASS);
  };
}

function handleResizeKeydown(colKey: string, event: KeyboardEvent): void {
  const column = resolvedColumn(colKey);
  if (!column) {
    return;
  }
  const step = event.shiftKey ? 50 : 10;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    event.stopPropagation();
    setColumnWidth(colKey, column.resolvedWidth - step);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    event.stopPropagation();
    setColumnWidth(colKey, column.resolvedWidth + step);
  } else if (event.key === 'Home') {
    event.preventDefault();
    event.stopPropagation();
    setColumnWidth(colKey, column.sizing.minSize);
  } else if (event.key === 'End') {
    event.preventDefault();
    event.stopPropagation();
    setColumnWidth(colKey, column.sizing.maxSize);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    autosizeColumn(colKey);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    resetColumnWidth(colKey);
  }
}

function resizeHandleAriaValue(colKey: string, field: 'min' | 'max' | 'now'): number {
  const column = resolvedColumn(colKey);
  if (!column) {
    return 0;
  }
  if (field === 'min') return Math.round(column.sizing.minSize);
  if (field === 'max') return Math.round(column.sizing.maxSize);
  return Math.round(column.resolvedWidth);
}

function cellContentClass(col: ResolvedDataTableColumn): string[] {
  if (col.sizing.overflow === 'wrap') {
    return ['@container', 'dd-cell', 'min-w-0', 'whitespace-normal', 'break-words'];
  }
  if (col.sizing.overflow === 'clamp-2') {
    return ['@container', 'dd-cell', 'min-w-0', 'line-clamp-2', 'whitespace-normal'];
  }
  return ['@container', 'dd-cell', 'min-w-0', 'truncate'];
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

function isFullWidthRow(row: Record<string, unknown>): boolean {
  return props.fullWidthRow?.(row) ?? false;
}

function isInteractiveRow(row: Record<string, unknown>): boolean {
  if (props.rowInteractive) {
    return props.rowInteractive(row);
  }
  return !isFullWidthRow(row);
}

function isSelectedRow(row: Record<string, unknown>): boolean {
  return props.selectedKey != null && getRowKey(row, props.rowKey) === props.selectedKey;
}

function rowBackgroundColor(row: Record<string, unknown>, localIndex: number): string {
  if (isFullWidthRow(row)) {
    return 'transparent';
  }
  if (isSelectedRow(row)) {
    return 'var(--dd-bg-elevated)';
  }
  return rowAbsoluteIndex(localIndex) % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-bg-inset)';
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
      class="overflow-x-auto overscroll-x-contain"
      :class="virtualScroll || maxHeight ? 'overflow-y-auto' : 'overflow-y-visible'"
      :data-test="virtualScroll ? 'data-table-scroll' : undefined"
      :style="virtualScroll ? { maxHeight: virtualMaxHeight } : maxHeight ? { maxHeight } : {}"
      @scroll="handleVirtualScroll">
      <table
        ref="tableRef"
        class="w-full text-xs isolate"
        :style="{ '--dd-data-table-row-overlay-width': rowOverlayWidth, borderCollapse: 'separate', borderSpacing: '0', ...(useFixedLayout ? { tableLayout: 'fixed' } : {}) }">
        <colgroup>
          <col
            v-for="col in resolvedColumns"
            :key="col.key"
            :data-col-key="col.key"
            :style="{ width: `${Math.round(col.resolvedWidth)}px` }"
          />
          <col
            v-if="showActions"
            :data-col-key="ACTIONS_COLUMN_KEY"
            :style="{ width: `${Math.round(actionsColumn.resolvedWidth)}px` }"
          />
        </colgroup>
        <thead>
          <tr :style="{ backgroundColor: 'var(--dd-bg-inset)', borderBottom: 'none' }">
            <th v-for="col in resolvedColumns" :key="col.key"
                :data-col-key="col.key"
                scope="col"
                :class="[
                  col.icon ? 'text-center pl-5 pr-0' : [col.align ?? 'text-center', col.px ?? 'px-5'],
                  'whitespace-nowrap py-2.5 font-semibold uppercase tracking-wider text-2xs select-none transition-colors relative',
                  isSortableColumn(col) ? 'cursor-pointer' : '',
                  sortKey === col.key ? 'dd-text-secondary' : 'dd-text-muted hover:dd-text-secondary',
                  col.key === firstNonIconColKey ? ['sticky', 'start-0', 'z-20', 'dd-sticky-col-left'] : '',
                ]"
                :style="col.key === firstNonIconColKey ? { backgroundColor: 'var(--dd-bg-inset)' } : undefined"
                :tabindex="isSortableColumn(col) ? 0 : undefined"
                :aria-sort="ariaSort(col)"
                @keydown="handleHeaderKeydown($event, col)"
                @click="!resizing && isSortableColumn(col) && toggleSort(col.key, sortKey, sortAsc)">
              <span v-tooltip="col.headerTooltip">{{ col.label }}</span>
              <span v-if="sortKey === col.key" class="inline-block ml-0.5 text-4xs">{{ sortAsc ? '\u25B2' : '\u25BC' }}</span>
              <!-- Resize handle -->
              <div v-if="!col.icon && !isMobile"
                   role="separator"
                   :aria-label="t('sharedComponents.dataTable.resizeColumn')"
                   aria-orientation="vertical"
                   :aria-valuemin="resizeHandleAriaValue(col.key, 'min')"
                   :aria-valuemax="resizeHandleAriaValue(col.key, 'max')"
                   :aria-valuenow="resizeHandleAriaValue(col.key, 'now')"
                   tabindex="0"
                   class="absolute top-0 right-0 w-2 h-full cursor-col-resize z-10 flex items-center justify-center transition-colors hover:bg-drydock-secondary/20"
                   @pointerdown="onResizeStart(col.key, $event)"
                   @keydown="handleResizeKeydown(col.key, $event)"
                   @dblclick.stop.prevent="autosizeColumn(col.key)"
                   @click.stop>
                <div class="w-px h-3/5 rounded-full opacity-25 hover:opacity-60 transition-opacity"
                     style="background: var(--dd-text-muted)" />
              </div>
            </th>
            <th v-if="showActions"
                :data-col-key="ACTIONS_COLUMN_KEY"
                scope="col"
                class="sticky end-0 z-20 text-right px-3 py-2.5 font-semibold uppercase tracking-wider text-2xs whitespace-nowrap dd-text-muted relative"
                :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              {{ t('sharedComponents.dataTable.actions') }}
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
              :class="[
                'dd-data-table-row',
                isInteractiveRow(row) ? 'cursor-pointer transition-colors dd-data-table-row-hoverable min-h-[48px]' : '',
                isInteractiveRow(row) && isSelectedRow(row)
                  ? 'dd-data-table-row-selected'
                  : '',
                rowClass?.(row) ?? '',
              ]"
              :style="{
                '--dd-data-table-row-bg': rowBackgroundColor(row, i),
                backgroundColor: rowBackgroundColor(row, i),
                borderBottom: 'none',
              }"
              :tabindex="isInteractiveRow(row) ? 0 : undefined"
              @keydown="isInteractiveRow(row) && handleRowKeydown($event, row)"
              @click="isInteractiveRow(row) && emit('row-click', row)">
            <template v-if="isFullWidthRow(row)">
              <td :colspan="totalColumnCount" class="dd-data-table-cell p-0 border-0">
                <slot name="full-row" :row="row" :index="rowAbsoluteIndex(i)" />
              </td>
            </template>
            <template v-else>
              <td v-for="(col, colIndex) in resolvedColumns" :key="col.key"
                  :data-col-key="col.key"
                  class="dd-data-table-cell py-3 align-middle"
                  :class="[
                    colIndex === 0 ? 'dd-data-table-row-overlay-host' : '',
                    col.icon ? 'text-center pl-5 pr-0' : ['overflow-hidden', col.align ?? 'text-center', col.px ?? 'px-5'],
                    col.key === firstNonIconColKey ? ['sticky', 'start-0', 'z-10', 'dd-sticky-col-left'] : '',
                  ]">
                <div v-if="!col.icon" :class="cellContentClass(col)">
                  <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]">
                    {{ row[col.key] }}
                  </slot>
                </div>
                <template v-else>
                  <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]">
                    {{ row[col.key] }}
                  </slot>
                </template>
              </td>
              <td
                v-if="showActions"
                :data-col-key="ACTIONS_COLUMN_KEY"
                class="dd-data-table-cell dd-data-table-actions-cell sticky end-0 z-10 px-3 py-3 text-right whitespace-nowrap relative"
              >
                <slot name="actions" :row="row" />
              </td>
            </template>
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

<style scoped>
tbody tr.dd-data-table-row > td.dd-data-table-cell {
  background-color: var(--dd-data-table-row-bg);
  transition:
    background-color var(--dd-duration-enter),
    box-shadow var(--dd-duration-enter);
}

tbody
  tr.dd-data-table-row-hoverable:not(.dd-data-table-row-selected):hover
  > td.dd-data-table-cell {
  background-color: var(--dd-hover-overlay);
}

tbody tr.dd-data-table-row-selected > td.dd-data-table-cell {
  box-shadow:
    inset 0 1px 0 var(--dd-primary),
    inset 0 -1px 0 var(--dd-primary);
}

tbody tr.dd-data-table-row-selected > td.dd-data-table-cell:first-child {
  box-shadow:
    inset 1px 0 0 var(--dd-primary),
    inset 0 1px 0 var(--dd-primary),
    inset 0 -1px 0 var(--dd-primary);
}

tbody tr.dd-data-table-row-selected > td.dd-data-table-cell:last-child {
  box-shadow:
    inset -1px 0 0 var(--dd-primary),
    inset 0 1px 0 var(--dd-primary),
    inset 0 -1px 0 var(--dd-primary);
}

th.dd-sticky-col-left,
td.dd-sticky-col-left {
  border-inline-end: 1px solid var(--dd-sticky-separator);
}
</style>
