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
  /**
   * Card mode (< 640px): force this column to be the card title, overriding the
   * first-non-icon-column fallback. Table mode is unaffected — the sticky identity column
   * always uses the first-non-icon-column rule regardless of `cardTitle`.
   */
  cardTitle?: boolean;
  /**
   * Card mode (< 640px): controls subtitle selection and body inclusion. Distinct from
   * `priority` (used by auto-hide/responsive column sizing, where higher = dropped first) —
   * do not reuse that field for cards. Positive values compete for the card subtitle slot
   * (highest wins, ties broken by declared order). Negative values demote the column out of
   * the card entirely (it's still reachable via the DetailPanel tap-through) and can never be
   * chosen as the subtitle fallback. Zero/unset is a neutral body column and is eligible for
   * the default subtitle fallback (first candidate by declared order).
   */
  cardPriority?: number;
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
    /**
     * Column keys hidden by a user-driven column picker — TABLE MODE ONLY. Card mode
     * (< 640px) deliberately ignores this: mobile has no picker to un-hide a column, so
     * every non-demoted column must stay reachable there. Orthogonal to `cardPriority`
     * (static per-column card demotion, applies in card mode) and to the responsive
     * auto-hide driven by `priority`/viewport width (a distinct, automatic mechanism).
     */
    hiddenColumnKeys?: string[];
    /**
     * Desktop view-mode toggle: force card rendering at >=640px container width. The
     * automatic <640px reflow (`CARD_MODE_MAX_WIDTH`) always wins regardless of this prop —
     * it only ever forces cards on at wider widths, never forces the table on below 640px.
     */
    preferCards?: boolean;
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
    hiddenColumnKeys: () => [],
    preferCards: false,
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

/** Table-mode-only hide set, sourced from `hiddenColumnKeys`. Card mode never consults this. */
const hiddenColumnKeySet = computed(() => new Set(props.hiddenColumnKeys));

const normalizedColumns = computed(() =>
  props.columns
    .filter((column) => !hiddenColumnKeySet.value.has(column.key))
    .map((column) => ({
      column,
      sizing: normalizeTableColumnSizing(column),
    })),
);

interface ColumnWidthEntry {
  key: string;
  width: number;
  sizing: NormalizedTableColumnSizing;
}

// Shrinks columns proportionally toward (never below) their minSize using water-filling: on
// each pass, the deficit is distributed across still-shrinkable columns weighted by remaining
// headroom (width - minSize). Columns whose proportional share would take them past their floor
// are clamped to minSize and dropped from the pool; whatever they couldn't absorb is
// redistributed among the columns that still have headroom left. This guarantees resolved
// widths never fall below minSize while eliminating the overflow whenever total headroom covers
// the deficit (see #467 — rendered widths must agree with the auto-hide budget's minSize-based
// "fits" decision). When total headroom is smaller than the deficit, every shrinkable column
// bottoms out at minSize and the remaining overflow is left for auto-hide to resolve. Operates
// only on the `hiddenColumnKeys`-filtered (table-mode) column set passed in via `base` — hidden
// columns never reach this function, and card mode never calls resolveColumnWidths() at all.
function shrinkColumnWidthsToFit(
  base: ColumnWidthEntry[],
  widthMap: Record<string, number>,
  deficit: number,
): void {
  const widths = new Map(base.map((entry) => [entry.key, entry.width]));
  let shrinkable = base.filter((entry) => entry.width > entry.sizing.minSize);
  let remainingDeficit = deficit;

  while (remainingDeficit > 0.5 && shrinkable.length > 0) {
    const totalHeadroom = shrinkable.reduce(
      (acc, entry) => acc + ((widths.get(entry.key) ?? 0) - entry.sizing.minSize),
      0,
    );
    if (totalHeadroom <= 0) {
      break;
    }

    let absorbed = 0;
    const stillShrinkable: ColumnWidthEntry[] = [];
    for (const entry of shrinkable) {
      const width = widths.get(entry.key) ?? 0;
      const headroom = width - entry.sizing.minSize;
      const shrinkBy = Math.min(remainingDeficit * (headroom / totalHeadroom), headroom);
      const nextWidth = width - shrinkBy;
      widths.set(entry.key, nextWidth);
      absorbed += shrinkBy;
      if (nextWidth - entry.sizing.minSize > 0.5) {
        stillShrinkable.push(entry);
      }
    }
    remainingDeficit -= absorbed;
    shrinkable = stillShrinkable;
  }

  for (const entry of base) {
    const width = widths.get(entry.key) ?? entry.width;
    widthMap[entry.key] = Math.max(entry.sizing.minSize, Math.floor(width));
  }
}

function resolveColumnWidths(): Record<string, number> {
  const base: ColumnWidthEntry[] = normalizedColumns.value.map(({ column, sizing }) => {
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
  if (available <= 0) {
    return widthMap;
  }

  const actionsWidth = props.showActions ? actionsColumn.value.resolvedWidth : 0;
  const totalBaseWidth = base.reduce((acc, entry) => acc + entry.width, 0) + actionsWidth;
  const extra = available - totalBaseWidth;

  if (extra < 0) {
    shrinkColumnWidthsToFit(base, widthMap, -extra);
    return widthMap;
  }

  const flexColumns = base.filter((entry) => entry.sizing.flex > 0);
  if (extra <= 0 || flexColumns.length === 0) {
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

/**
 * Key of the first non-icon column in the FILTERED (table-visible, `hiddenColumnKeys`-aware)
 * column set — this column is pinned sticky-left for mobile scroll. TABLE MODE ONLY: card mode
 * uses the separate `cardFirstNonIconColKey` (declared below, over the unfiltered column set)
 * for its title fallback.
 */
const firstNonIconColKey = computed<string | null>(
  () => resolvedColumns.value.find((col) => !col.icon)?.key ?? null,
);

/**
 * Cumulative `insetInlineStart` offset (px) for every column in the leading identity cluster:
 * the icon column(s) immediately preceding `firstNonIconColKey`, plus `firstNonIconColKey`
 * itself. Because `firstNonIconColKey` is by definition the FIRST non-icon column, every
 * `resolvedColumns` entry before it is guaranteed to be an icon column — so a single
 * left-to-right walk up to (and including) the target key both identifies the pinned cluster
 * and accumulates each member's offset. Columns are pinned as a whole cluster so an icon column
 * can never scroll out from under its opaque sticky neighbor (icon logos clipping/overlapping
 * mid-scroll) — only `firstNonIconColKey` keeps the `dd-sticky-col-left` separator class.
 */
const pinnedColumnOffsets = computed<Map<string, number>>(() => {
  const map = new Map<string, number>();
  const targetKey = firstNonIconColKey.value;
  if (targetKey === null) {
    return map;
  }
  let offset = 0;
  for (const col of resolvedColumns.value) {
    map.set(col.key, offset);
    if (col.key === targetKey) {
      break;
    }
    offset += col.resolvedWidth;
  }
  return map;
});

function pinnedInsetStyle(colKey: string): Record<string, string> | undefined {
  const offset = pinnedColumnOffsets.value.get(colKey);
  return offset === undefined ? undefined : { insetInlineStart: `${Math.round(offset)}px` };
}

const rowOverlayWidth = computed(() =>
  viewportWidth.value > 0 ? `${Math.round(viewportWidth.value)}px` : '100%',
);

// Two uses, both gated on genuine horizontal overflow:
//  1. The `dd-sticky-col-left` separator border (see <style> below) — the border only makes
//     sense when there's real horizontal overflow to scroll through. With columns picker-hidden
//     or auto-hidden down to a near-empty layout, the identity cluster's border otherwise floats
//     as a stray full-height line over columns that never actually scroll underneath it.
//  2. The sticky-right ACTIONS column (below): when the auto-hide budget disagrees with the
//     real container width, or a live/persisted column drag-width is invisible to that budget,
//     total resolved width can exceed the viewport even though DataTable itself renders fine.
//     `position: sticky; end-0` at scrollLeft 0 then pulls the actions column left of its natural
//     grid position by the overflow amount, painting it on top of the last data column. Dropping
//     sticky/end-0/z-index in that case falls the actions column back to normal in-flow
//     position — reachable by horizontal scroll, never overlapping.
const hasHorizontalOverflow = computed(
  () =>
    viewportWidth.value > 0 &&
    allResolvedColumns.value.reduce((acc, col) => acc + col.resolvedWidth, 0) > viewportWidth.value,
);

// -- Card mode (container width < 640px, or `preferCards` toggle at wider widths) --
// This is a CONTAINER-width breakpoint (measured off scrollViewportRef via ResizeObserver),
// deliberately separate from `props.isMobile` (a caller-supplied WINDOW-width (768px) signal
// that only controls whether column-resize handles are shown). A narrow container can appear
// inside a wide window (e.g. a split DetailPanel), and vice versa — do not merge these two
// switches. While viewportWidth is 0 (pre-measurement) isCardMode stays false so the table
// renders first, then self-corrects once onMounted's syncTableViewportWidth() measures it.
// `preferCards` (desktop table/cards toggle) only ever forces cards ON at >=640px — the
// automatic <640px reflow always wins regardless of the toggle's value.
const CARD_MODE_MAX_WIDTH = 640;
const isCardMode = computed(
  () => viewportWidth.value > 0 && (viewportWidth.value < CARD_MODE_MAX_WIDTH || props.preferCards),
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

const totalColumnCount = computed(() => resolvedColumns.value.length + (props.showActions ? 1 : 0));
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

// Epsilon-guarded: the ResizeObserver fires on sub-pixel jitter (fractional layout rounding,
// scrollbar show/hide, etc.) with no useful change in the actual measured width. Writing
// `viewportWidth` unconditionally forces a full column-width recompute + row re-render (and
// re-runs every per-cell v-tooltip directive's `updated()` hook) on every such tick — skip the
// write when the delta is sub-pixel, mirroring the rAF-gating spirit of useBreakpoints.ts.
function syncTableViewportWidth() {
  const next = scrollViewportRef.value?.clientWidth ?? 0;
  if (Math.abs(next - viewportWidth.value) < 1) {
    return;
  }
  viewportWidth.value = next;
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
  // No separate window resize listener for width: the ResizeObserver above already fires on
  // every layout change that affects scrollViewportRef's box (including window resizes), so a
  // second unthrottled listener driving the same sync function was pure redundant overhead.
  globalThis.addEventListener('resize', syncViewportHeight);
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
  // Card mode never zebra-stripes or elevates on selection — cards are flat
  // `var(--dd-bg-card)`, selection is communicated purely via the border (see
  // `.dd-data-table-card-selected` below). Table mode keeps zebra + elevated-on-select.
  if (isCardMode.value) {
    return 'var(--dd-bg-card)';
  }
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

// -- Card mode layout helpers --
// Card mode deliberately reads from the UNFILTERED column set (props.columns), not the
// table's `hiddenColumnKeys`-filtered `resolvedColumns` — mobile has no column picker to
// un-hide a column, so every non-`cardPriority`-demoted column must still surface here.
// Resolved *widths* are meaningless off the table grid, so this just carries `sizing` through
// (for `cellContentClass()`'s `sizing.overflow` read) without running flex redistribution.
const cardResolvedColumns = computed<ResolvedDataTableColumn[]>(() =>
  props.columns.map((column) => {
    const sizing = normalizeTableColumnSizing(column);
    return {
      ...column,
      resolvedWidth: sizing.size,
      sizing,
    };
  }),
);

/** Card-mode counterpart to `firstNonIconColKey`, over the unfiltered column set. */
const cardFirstNonIconColKey = computed<string | null>(
  () => cardResolvedColumns.value.find((col) => !col.icon)?.key ?? null,
);

// Icon columns (e.g. status dot) render inline beside the title — there can be more than one.
const cardIconColumns = computed(() => cardResolvedColumns.value.filter((col) => col.icon));

// Card title key: the first non-icon column explicitly flagged `cardTitle`, else the same
// "first non-icon column" identity used for the table's sticky column (but over the unfiltered
// set — see `cardFirstNonIconColKey`). Table mode is always unaffected by `cardTitle` — it
// keeps using `firstNonIconColKey` directly.
const cardTitleColumnKey = computed<string | null>(() => {
  const flagged = cardResolvedColumns.value.find((col) => !col.icon && col.cardTitle === true);
  return flagged?.key ?? cardFirstNonIconColKey.value;
});

const cardTitleColumn = computed<ResolvedDataTableColumn | null>(
  () => cardResolvedColumns.value.find((col) => col.key === cardTitleColumnKey.value) ?? null,
);

// Subtitle/body candidates: every non-icon column except the title.
const cardBodyCandidates = computed(() =>
  cardResolvedColumns.value.filter((col) => !col.icon && col.key !== cardTitleColumnKey.value),
);

// Card subtitle: highest `cardPriority` (> 0) among candidates, ties broken by declared order.
// Falls back to the first candidate by order whose `cardPriority` is not negative — a negative
// `cardPriority` (demoted out of the card body) can never become the subtitle via fallback
// either. `priority` (auto-hide/responsive column sizing) is a distinct field and has no
// bearing on card composition.
const cardSubtitleColumn = computed<ResolvedDataTableColumn | null>(() => {
  const candidates = cardBodyCandidates.value;
  if (candidates.length === 0) {
    return null;
  }
  const prioritized = candidates.filter((col) => (col.cardPriority ?? 0) > 0);
  if (prioritized.length > 0) {
    return prioritized.reduce((best, col) =>
      (col.cardPriority as number) > (best.cardPriority as number) ? col : best,
    );
  }
  return candidates.find((col) => (col.cardPriority ?? 0) >= 0) ?? null;
});

// Everything else (not title, not subtitle, not icon, not demoted) renders as a dt/dd field in
// column order. A negative `cardPriority` removes a column from the card entirely — the data
// remains reachable via the DetailPanel tap-through.
const cardBodyColumns = computed(() =>
  cardBodyCandidates.value.filter(
    (col) => col.key !== cardSubtitleColumn.value?.key && (col.cardPriority ?? 0) >= 0,
  ),
);

const sortableCardColumns = computed(() => props.columns.filter(isSortableColumn));

// Selecting a *different* key always resets to ascending. Re-selecting the current key is a
// no-op here — direction changes go through the dedicated toggle button, not this handler.
function handleCardSortChange(event: Event): void {
  const key = (event.target as HTMLSelectElement).value;
  if (!key || key === props.sortKey) {
    return;
  }
  emit('update:sortKey', key);
  emit('update:sortAsc', true);
}
</script>

<template>
  <div class="dd-rounded overflow-hidden"
       :style="{ backgroundColor: 'var(--dd-bg-card)' }">
    <div
      ref="scrollViewportRef"
      class="overflow-x-auto overscroll-x-contain dd-data-table-scroll"
      :class="[
        virtualScroll || maxHeight ? 'overflow-y-auto' : 'overflow-y-visible',
        hasHorizontalOverflow ? 'dd-table-has-overflow' : '',
      ]"
      :data-test="virtualScroll ? 'data-table-scroll' : undefined"
      :style="virtualScroll ? { maxHeight: virtualMaxHeight } : maxHeight ? { maxHeight } : {}"
      @scroll="handleVirtualScroll">
      <template v-if="isCardMode">
        <div v-if="rows.length > 0 && sortableCardColumns.length > 0"
             class="dd-data-table-card-sort-bar flex items-center gap-2 px-3 pt-3 pb-2">
          <select
            data-test="dd-card-sort-select"
            class="flex-1 min-h-[44px] min-w-0 px-3 py-2 dd-rounded dd-bg-inset dd-text border dd-border-strong outline-none cursor-pointer text-2xs-plus"
            :aria-label="t('sharedComponents.dataTable.sortBy')"
            :value="sortKey ?? ''"
            @change="handleCardSortChange">
            <option value="" disabled hidden>{{ t('sharedComponents.dataTable.sortBy') }}</option>
            <option v-for="col in sortableCardColumns" :key="col.key" :value="col.key">{{ col.label }}</option>
          </select>
          <AppButton
            data-test="dd-card-sort-direction"
            type="button"
            size="icon-md"
            variant="outlined"
            :disabled="!sortKey"
            :aria-pressed="!!sortKey && sortAsc !== false"
            :aria-label="sortAsc === false
              ? t('sharedComponents.dataTable.sortDirectionDescending')
              : t('sharedComponents.dataTable.sortDirectionAscending')"
            @click="sortKey && toggleSort(sortKey, sortKey, sortAsc)">
            <span aria-hidden="true">{{ sortAsc === false ? '▼' : '▲' }}</span>
          </AppButton>
        </div>
        <ul role="list" class="flex flex-col gap-2 px-3 pb-3">
          <li
            v-if="topSpacerHeight > 0"
            aria-hidden="true"
            data-test="dd-card-top-spacer"
            :style="{ height: `${topSpacerHeight}px` }" />
          <li v-for="(row, i) in visibleRows" :key="getRowKey(row, rowKey)">
            <template v-if="isFullWidthRow(row)">
              <slot name="full-row" :row="row" :index="rowAbsoluteIndex(i)" :card-mode="true" />
            </template>
            <div v-else
                 data-test="dd-card"
                 class="dd-data-table-card dd-rounded flex flex-col transition-colors"
                 :class="[
                   isInteractiveRow(row) ? 'cursor-pointer min-h-[48px] dd-data-table-card-hoverable' : '',
                   isInteractiveRow(row) && isSelectedRow(row) ? 'dd-data-table-card-selected' : '',
                   rowClass?.(row) ?? '',
                   $slots.card ? 'overflow-hidden' : 'p-4 gap-3',
                 ]"
                 :style="{ '--dd-data-table-row-bg': rowBackgroundColor(row, i) }"
                 :tabindex="isInteractiveRow(row) ? 0 : undefined"
                 @keydown="isInteractiveRow(row) && handleRowKeydown($event, row)"
                 @click="isInteractiveRow(row) && emit('row-click', row)">
              <template v-if="$slots.card">
                <slot
                  name="card"
                  :row="row"
                  :index="rowAbsoluteIndex(i)"
                  :selected="isInteractiveRow(row) && isSelectedRow(row)" />
              </template>
              <template v-else>
                <div class="flex items-center gap-2 min-w-0" data-test="dd-card-title-row">
                  <template v-for="iconCol in cardIconColumns" :key="iconCol.key">
                    <slot :name="'cell-' + iconCol.key" :row="row" :value="row[iconCol.key]" :card-mode="true">
                      {{ row[iconCol.key] }}
                    </slot>
                  </template>
                  <div v-if="cardTitleColumn" data-test="dd-card-title" class="text-sm font-semibold dd-text truncate min-w-0 flex-1">
                    <slot :name="'cell-' + cardTitleColumn.key" :row="row" :value="row[cardTitleColumn.key]" :card-mode="true">
                      {{ row[cardTitleColumn.key] }}
                    </slot>
                  </div>
                </div>
                <div v-if="cardSubtitleColumn" data-test="dd-card-subtitle" class="text-2xs-plus dd-text-muted -mt-2">
                  <slot :name="'cell-' + cardSubtitleColumn.key" :row="row" :value="row[cardSubtitleColumn.key]" :card-mode="true">
                    {{ row[cardSubtitleColumn.key] }}
                  </slot>
                </div>
                <dl v-if="cardBodyColumns.length > 0" data-test="dd-card-body" class="flex flex-col gap-2">
                  <div v-for="col in cardBodyColumns" :key="col.key"
                       class="field flex items-baseline justify-between gap-3">
                    <dt class="dd-text-label dd-text-muted shrink-0">{{ col.label }}</dt>
                    <dd class="text-2xs-plus dd-text" :class="cellContentClass(col)">
                      <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]" :card-mode="true">
                        {{ row[col.key] }}
                      </slot>
                    </dd>
                  </div>
                </dl>
                <div v-if="showActions"
                     data-test="dd-card-actions"
                     class="flex items-center justify-end gap-2 pt-2 mt-1 border-t dd-border min-h-[44px]">
                  <slot name="actions" :row="row" :card-mode="true" />
                </div>
              </template>
            </div>
          </li>
          <li
            v-if="bottomSpacerHeight > 0"
            aria-hidden="true"
            data-test="dd-card-bottom-spacer"
            :style="{ height: `${bottomSpacerHeight}px` }" />
        </ul>
      </template>
      <template v-else>
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
                  col.icon ? 'text-center pl-5 pr-0 overflow-hidden' : [col.align ?? 'text-center', col.px ?? 'px-5'],
                  'whitespace-nowrap py-2.5 font-semibold uppercase tracking-wider text-2xs select-none transition-colors relative',
                  isSortableColumn(col) ? 'cursor-pointer' : '',
                  sortKey === col.key ? 'dd-text-secondary' : 'dd-text-muted hover:dd-text-secondary',
                  pinnedColumnOffsets.has(col.key) ? ['sticky', 'z-20'] : '',
                  col.key === firstNonIconColKey ? 'dd-sticky-col-left' : '',
                ]"
                :style="pinnedColumnOffsets.has(col.key) ? { backgroundColor: 'var(--dd-bg-inset)', ...pinnedInsetStyle(col.key) } : undefined"
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
                :class="[
                  'text-right px-3 py-2.5 font-semibold uppercase tracking-wider text-2xs whitespace-nowrap dd-text-muted relative',
                  hasHorizontalOverflow ? '' : ['sticky', 'end-0', 'z-20'],
                ]"
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
                <slot name="full-row" :row="row" :index="rowAbsoluteIndex(i)" :card-mode="false" />
              </td>
            </template>
            <template v-else>
              <td v-for="(col, colIndex) in resolvedColumns" :key="col.key"
                  :data-col-key="col.key"
                  class="dd-data-table-cell py-3 align-middle"
                  :class="[
                    colIndex === 0 ? 'dd-data-table-row-overlay-host' : '',
                    col.icon ? 'text-center pl-5 pr-0 overflow-hidden' : ['overflow-hidden', col.align ?? 'text-center', col.px ?? 'px-5'],
                    pinnedColumnOffsets.has(col.key) ? ['sticky', 'z-10'] : '',
                    col.key === firstNonIconColKey ? 'dd-sticky-col-left' : '',
                  ]"
                  :style="pinnedInsetStyle(col.key)">
                <div v-if="!col.icon" :class="cellContentClass(col)">
                  <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]" :card-mode="false">
                    {{ row[col.key] }}
                  </slot>
                </div>
                <template v-else>
                  <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]" :card-mode="false">
                    {{ row[col.key] }}
                  </slot>
                </template>
              </td>
              <td
                v-if="showActions"
                :data-col-key="ACTIONS_COLUMN_KEY"
                class="dd-data-table-cell dd-data-table-actions-cell px-3 py-3 text-right whitespace-nowrap relative"
                :class="hasHorizontalOverflow ? '' : ['sticky', 'end-0', 'z-10']"
              >
                <slot name="actions" :row="row" :card-mode="false" />
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
      </template>
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

/* Only draw the separator when the table actually has horizontal overflow to scroll through
   (see `hasHorizontalOverflow` in <script>) — otherwise it's a stray full-height line floating
   over a near-empty layout with nothing left to separate. */
.dd-table-has-overflow th.dd-sticky-col-left,
.dd-table-has-overflow td.dd-sticky-col-left {
  border-inline-end: 1px solid var(--dd-sticky-separator);
}

/* Card mode (< 640px container width) — same custom-property indirection as the table rows
   above, so :hover can override the inline zebra/selected background. */
.dd-data-table-card {
  background-color: var(--dd-data-table-row-bg);
  border: 1.5px solid transparent;
  transition:
    background-color var(--dd-duration-enter),
    box-shadow var(--dd-duration-enter),
    border-color var(--dd-duration-enter);
}

.dd-data-table-card-hoverable:not(.dd-data-table-card-selected):hover {
  background-color: var(--dd-hover-overlay);
}

.dd-data-table-card-selected {
  border-color: var(--dd-primary);
  box-shadow: 0 0 0 1px var(--dd-primary);
}

/* Print: keep cards intact across page breaks, drop interactive sort chrome that means
   nothing on paper, and un-clip the table's horizontal scroll container so every column
   prints instead of being cut off at the viewport edge. */
@media print {
  .dd-data-table-card {
    break-inside: avoid;
  }

  .dd-data-table-card-sort-bar {
    display: none;
  }

  .dd-data-table-scroll {
    overflow: visible;
  }
}
</style>
