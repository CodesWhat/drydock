<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppButton from '../../../components/AppButton.vue';
import type { DashboardLayoutBreakpoint } from '../../../preferences/schema';
import type { DashboardWidgetId } from '../dashboardTypes';
import { reorderDashboardLayout, resizeDashboardLayout } from '../dashboardGridLayout';
import type { WidgetGridBounds, WidgetLayoutItem } from '../dashboardWidgetLayout';

interface DashboardGridItem extends WidgetLayoutItem {
  breakpointBounds?: WidgetGridBounds;
}

const props = defineProps<{
  layout: DashboardGridItem[];
  columns: number;
  rowHeight: number;
  margin: [number, number];
  editable: boolean;
  hiddenItems: DashboardWidgetId[];
  currentBreakpoint: DashboardLayoutBreakpoint;
  breakpoints: Record<string, number>;
  responsiveLayouts: Partial<Record<DashboardLayoutBreakpoint, WidgetLayoutItem[]>>;
  resizeLabel: string;
}>();

const emit = defineEmits<{
  'update:layout': [layout: WidgetLayoutItem[]];
  'breakpoint-changed': [breakpoint: DashboardLayoutBreakpoint, layout?: WidgetLayoutItem[]];
}>();

const gridEl = ref<HTMLElement | null>(null);
const dragCandidate = ref<DashboardWidgetId | null>(null);
const dragging = ref<DashboardWidgetId | null>(null);
const dropTarget = ref<DashboardWidgetId | null>(null);
const activeBreakpoint = ref(props.currentBreakpoint);
let resizeObserver: ResizeObserver | undefined;

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${Math.max(1, props.columns)}, minmax(0, 1fr))`,
  gridAutoRows: `${props.rowHeight}px`,
  columnGap: `${props.margin[0]}px`,
  rowGap: `${props.margin[1]}px`,
}));

function itemStyle(item: DashboardGridItem) {
  return {
    gridColumn: `${item.x + 1} / span ${item.w}`,
    gridRow: `${item.y + 1} / span ${item.h}`,
    touchAction: props.editable ? 'pan-y' : undefined,
  };
}

function stripGridMetadata(item: DashboardGridItem): WidgetLayoutItem {
  const { breakpointBounds: _breakpointBounds, ...layoutItem } = item;
  return layoutItem;
}

function currentLayout(): WidgetLayoutItem[] {
  return props.layout.map(stripGridMetadata);
}

function handlePointerDown(item: DashboardGridItem, event: PointerEvent) {
  if (!props.editable) return;
  dragCandidate.value = (event.target as Element).closest('.drag-handle') ? item.i : null;
  if (dragCandidate.value && event.pointerType !== 'mouse') {
    startTouchDrag(item.i, event);
  }
}

interface TouchDragState {
  sourceId: DashboardWidgetId;
  pointerId: number;
  startX: number;
  startY: number;
}

let touchDragState: TouchDragState | undefined;

function handleTouchDragMove(event: PointerEvent) {
  if (!touchDragState || event.pointerId !== touchDragState.pointerId) return;
  const moved =
    Math.abs(event.clientX - touchDragState.startX) > 6 ||
    Math.abs(event.clientY - touchDragState.startY) > 6;
  if (!moved) return;
  dragging.value = touchDragState.sourceId;
  const elementAtPointer = document.elementFromPoint?.(event.clientX, event.clientY);
  const targetId = elementAtPointer?.closest<HTMLElement>('[data-widget-id]')?.dataset.widgetId as
    | DashboardWidgetId
    | undefined;
  dropTarget.value = targetId && targetId !== touchDragState.sourceId ? targetId : null;
}

function stopTouchDrag(event?: PointerEvent) {
  if (touchDragState && event && event.pointerId !== touchDragState.pointerId) return;
  if (touchDragState && dropTarget.value) {
    emit(
      'update:layout',
      reorderDashboardLayout(
        currentLayout(),
        touchDragState.sourceId,
        dropTarget.value,
        props.columns,
      ),
    );
  }
  touchDragState = undefined;
  window.removeEventListener('pointermove', handleTouchDragMove);
  window.removeEventListener('pointerup', stopTouchDrag);
  window.removeEventListener('pointercancel', stopTouchDrag);
  finishDrag();
}

function startTouchDrag(sourceId: DashboardWidgetId, event: PointerEvent) {
  if (touchDragState) return;
  touchDragState = {
    sourceId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
  };
  window.addEventListener('pointermove', handleTouchDragMove);
  window.addEventListener('pointerup', stopTouchDrag);
  window.addEventListener('pointercancel', stopTouchDrag);
}

function handleDragStart(item: DashboardGridItem, event: DragEvent) {
  if (!props.editable || dragCandidate.value !== item.i) {
    event.preventDefault();
    return;
  }
  dragging.value = item.i;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.i);
  }
}

function handleDragOver(item: DashboardGridItem, event: DragEvent) {
  if (!dragging.value || dragging.value === item.i) return;
  event.preventDefault();
  dropTarget.value = item.i;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function finishDrag() {
  dragCandidate.value = null;
  dragging.value = null;
  dropTarget.value = null;
}

function handleDrop(item: DashboardGridItem, event: DragEvent) {
  event.preventDefault();
  const sourceId =
    dragging.value ?? (event.dataTransfer?.getData('text/plain') as DashboardWidgetId);
  if (sourceId && sourceId !== item.i) {
    emit('update:layout', reorderDashboardLayout(currentLayout(), sourceId, item.i, props.columns));
  }
  finishDrag();
}

interface ResizeState {
  item: DashboardGridItem;
  layout: WidgetLayoutItem[];
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  columnWidth: number;
}

let resizeState: ResizeState | undefined;

function handleResizeMove(event: PointerEvent) {
  const state = resizeState!;
  const deltaColumns = Math.round((event.clientX - state.startX) / state.columnWidth);
  const deltaRows = Math.round(
    (event.clientY - state.startY) / (props.rowHeight + props.margin[1]),
  );
  const bounds = state.item.breakpointBounds ?? {
    minW: 1,
    minH: 1,
    maxW: props.columns,
    maxH: Number.POSITIVE_INFINITY,
  };
  emit(
    'update:layout',
    resizeDashboardLayout(
      state.layout,
      state.item.i,
      state.startWidth + deltaColumns,
      state.startHeight + deltaRows,
      props.columns,
      bounds,
    ),
  );
}

function stopResize() {
  resizeState = undefined;
  window.removeEventListener('pointermove', handleResizeMove);
  window.removeEventListener('pointerup', stopResize);
  window.removeEventListener('pointercancel', stopResize);
}

function startResize(item: DashboardGridItem, event: PointerEvent) {
  event.preventDefault();
  event.stopPropagation();
  const gridWidth = gridEl.value!.getBoundingClientRect().width;
  const gapsWidth = props.margin[0] * Math.max(0, props.columns - 1);
  const columnWidth = Math.max(1, (gridWidth - gapsWidth) / Math.max(1, props.columns));
  resizeState = {
    item,
    layout: currentLayout(),
    startX: event.clientX,
    startY: event.clientY,
    startWidth: item.w,
    startHeight: item.h,
    columnWidth: columnWidth + props.margin[0],
  };
  window.addEventListener('pointermove', handleResizeMove);
  window.addEventListener('pointerup', stopResize, { once: true });
  window.addEventListener('pointercancel', stopResize, { once: true });
}

function updateBreakpoint(width: number) {
  const nextBreakpoint = Object.entries(props.breakpoints)
    .sort(([, widthA], [, widthB]) => widthB - widthA)
    .find(([, minimumWidth]) => width >= minimumWidth)?.[0] as
    | DashboardLayoutBreakpoint
    | undefined;
  if (!nextBreakpoint || nextBreakpoint === activeBreakpoint.value) return;
  activeBreakpoint.value = nextBreakpoint;
  emit('breakpoint-changed', nextBreakpoint, props.responsiveLayouts[nextBreakpoint]);
}

watch(
  () => props.currentBreakpoint,
  (breakpoint) => {
    activeBreakpoint.value = breakpoint;
  },
);

onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) updateBreakpoint(entry.contentRect.width);
  });
  resizeObserver.observe(gridEl.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  stopTouchDrag();
  stopResize();
});
</script>

<template>
  <div ref="gridEl" class="dd-dashboard-grid" :style="gridStyle">
    <div
      v-for="item in layout"
      v-show="!hiddenItems.includes(item.i)"
      :key="item.i"
      class="dd-grid-item"
      :class="{
        'dd-grid-edit': editable,
        'dd-grid-dragging': dragging === item.i,
        'dd-grid-drop-target': dropTarget === item.i,
      }"
      :data-widget-id="item.i"
      :data-widget-order="layout.findIndex((candidate) => candidate.i === item.i)"
      :draggable="editable && dragCandidate === item.i"
      :style="itemStyle(item)"
      @pointerdown.capture="handlePointerDown(item, $event)"
      @dragstart="handleDragStart(item, $event)"
      @dragover="handleDragOver(item, $event)"
      @dragleave="dropTarget === item.i && (dropTarget = null)"
      @drop="handleDrop(item, $event)"
      @dragend="finishDrag"
    >
      <slot name="item" :item="item" />
      <AppButton
        v-if="editable"
        size="none"
        variant="plain"
        weight="none"
        class="dd-grid-resizer no-drag"
        :aria-label="resizeLabel"
        @pointerdown="startResize(item, $event)"
      />
    </div>
  </div>
</template>
