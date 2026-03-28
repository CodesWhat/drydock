import { onScopeDispose, ref, watch } from 'vue';
import { preferences } from '../../preferences/store';
import { DASHBOARD_WIDGET_IDS, type DashboardWidgetId } from './dashboardTypes';
import {
  applyConstraints,
  createDefaultLayout,
  type WidgetLayoutItem,
} from './dashboardWidgetLayout';

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value);
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function sanitizeHiddenWidgets(rawHidden: unknown): DashboardWidgetId[] {
  if (!Array.isArray(rawHidden)) {
    return [];
  }
  return rawHidden.filter(isDashboardWidgetId);
}

function sanitizeWidgetOrder(rawOrder: unknown): DashboardWidgetId[] {
  if (!Array.isArray(rawOrder)) {
    return [...DASHBOARD_WIDGET_IDS];
  }

  const seen = new Set<DashboardWidgetId>();
  const sanitized: DashboardWidgetId[] = [];

  for (const value of rawOrder) {
    if (isDashboardWidgetId(value) && !seen.has(value)) {
      seen.add(value);
      sanitized.push(value);
    }
  }

  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!seen.has(id)) {
      sanitized.push(id);
    }
  }

  return sanitized;
}

const defaultLayout = createDefaultLayout();
const defaultLayoutById = new Map(defaultLayout.map((item) => [item.i, item] as const));

function isValidLayoutItem(value: unknown): value is WidgetLayoutItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    isDashboardWidgetId(item.i) &&
    typeof item.x === 'number' &&
    typeof item.y === 'number' &&
    typeof item.w === 'number' &&
    typeof item.h === 'number'
  );
}

function loadPersistedLayout(order: readonly DashboardWidgetId[]): WidgetLayoutItem[] {
  const rawLayout = preferences.dashboard.gridLayout;
  if (!Array.isArray(rawLayout)) {
    return createLayoutFromOrder(order);
  }

  const persisted = new Map<string, WidgetLayoutItem>();
  for (const item of rawLayout) {
    if (isValidLayoutItem(item)) {
      persisted.set(item.i, { i: item.i, x: item.x, y: item.y, w: item.w, h: item.h });
    }
  }

  // Use persisted positions if available, fall back to defaults
  const result = order.map((id) => {
    const saved = persisted.get(id);
    if (saved) return saved;
    const fallback = defaultLayoutById.get(id);
    return { ...fallback! };
  });

  return applyConstraints(result);
}

function createLayoutFromOrder(order: readonly DashboardWidgetId[]): WidgetLayoutItem[] {
  return order.map((id) => {
    const item = defaultLayoutById.get(id);
    return { ...item! };
  });
}

function getDragSource(event: DragEvent): DashboardWidgetId | null {
  const rawSource = event.dataTransfer?.getData('text/plain');
  return isDashboardWidgetId(rawSource) ? rawSource : null;
}

export function moveWidget(
  order: DashboardWidgetId[],
  sourceId: DashboardWidgetId,
  targetId: DashboardWidgetId,
) {
  const sourceIndex = order.indexOf(sourceId);
  const targetIndex = order.indexOf(targetId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return order;
  }

  const next = [...order];
  next.splice(sourceIndex, 1);
  const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  next.splice(insertionIndex, 0, sourceId);
  return next;
}

export function useDashboardWidgetOrder() {
  const widgetOrder = ref<DashboardWidgetId[]>(
    sanitizeWidgetOrder(preferences.dashboard.widgetOrder),
  );
  const layout = ref<WidgetLayoutItem[]>(loadPersistedLayout(widgetOrder.value));
  const hiddenWidgets = ref<DashboardWidgetId[]>(
    sanitizeHiddenWidgets(preferences.dashboard.hiddenWidgets),
  );
  const editMode = ref(false);
  const draggedWidgetId = ref<DashboardWidgetId | null>(null);

  let syncing = false;

  function persistWidgetOrder() {
    preferences.dashboard.widgetOrder = [...widgetOrder.value];
    // Persist full grid layout (x, y, w, h) so positions and sizes survive reload
    preferences.dashboard.gridLayout = layout.value.map((item) => ({
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    }));
  }

  function persistHiddenWidgets() {
    preferences.dashboard.hiddenWidgets = [...hiddenWidgets.value];
  }

  function applyWidgetOrder(nextOrder: readonly DashboardWidgetId[]) {
    syncing = true;
    widgetOrder.value = [...nextOrder];
    layout.value = loadPersistedLayout(widgetOrder.value);
    persistWidgetOrder();
    queueMicrotask(() => {
      syncing = false;
    });
  }

  watch(
    widgetOrder,
    (nextOrder) => {
      if (syncing) {
        return;
      }
      syncing = true;
      layout.value = loadPersistedLayout(nextOrder);
      persistWidgetOrder();
      queueMicrotask(() => {
        syncing = false;
      });
    },
    { deep: true },
  );

  // Debounced persist for layout changes (grid-layout-plus fires many updates during drag/resize)
  let layoutPersistTimer: ReturnType<typeof setTimeout> | undefined;

  watch(
    layout,
    (nextLayout) => {
      if (syncing) {
        return;
      }

      // Sync order if it changed
      const nextOrder = nextLayout.map((item) => item.i);
      if (!arraysEqual(nextOrder, widgetOrder.value)) {
        syncing = true;
        widgetOrder.value = nextOrder;
        persistWidgetOrder();
        queueMicrotask(() => {
          syncing = false;
        });
        return;
      }

      // Debounce position/size persistence (x, y, w, h changes from drag/resize)
      clearTimeout(layoutPersistTimer);
      layoutPersistTimer = setTimeout(persistWidgetOrder, 300);
    },
    { deep: true },
  );

  watch(hiddenWidgets, persistHiddenWidgets, { deep: true });

  onScopeDispose(() => {
    clearTimeout(layoutPersistTimer);
  });

  function isWidgetVisible(widgetId: DashboardWidgetId): boolean {
    return !hiddenWidgets.value.includes(widgetId);
  }

  function widgetOrderIndex(widgetId: DashboardWidgetId): number {
    const currentIndex = widgetOrder.value.indexOf(widgetId);
    return currentIndex >= 0 ? currentIndex : DASHBOARD_WIDGET_IDS.indexOf(widgetId);
  }

  function widgetOrderStyle(widgetId: DashboardWidgetId) {
    return { order: widgetOrderIndex(widgetId) };
  }

  function onWidgetDragStart(widgetId: DashboardWidgetId, event: DragEvent) {
    draggedWidgetId.value = widgetId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', widgetId);
    }
  }

  function onWidgetDragOver(targetId: DashboardWidgetId, event: DragEvent) {
    const sourceId = draggedWidgetId.value || getDragSource(event);
    if (!sourceId || sourceId === targetId) {
      return;
    }
    if (!widgetOrder.value.includes(sourceId) || !widgetOrder.value.includes(targetId)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function onWidgetDrop(targetId: DashboardWidgetId, event: DragEvent) {
    event.preventDefault();
    const sourceId = draggedWidgetId.value || getDragSource(event);

    if (!sourceId || sourceId === targetId) {
      draggedWidgetId.value = null;
      return;
    }
    if (!widgetOrder.value.includes(sourceId) || !widgetOrder.value.includes(targetId)) {
      draggedWidgetId.value = null;
      return;
    }

    const nextOrder = moveWidget(widgetOrder.value, sourceId, targetId);
    applyWidgetOrder(nextOrder);
    draggedWidgetId.value = null;
  }

  function onWidgetDragEnd() {
    draggedWidgetId.value = null;
  }

  function toggleWidgetVisibility(widgetId: DashboardWidgetId) {
    const index = hiddenWidgets.value.indexOf(widgetId);
    if (index >= 0) {
      hiddenWidgets.value = hiddenWidgets.value.filter((id) => id !== widgetId);
      if (!layout.value.some((item) => item.i === widgetId)) {
        const defaultItem = defaultLayoutById.get(widgetId);
        layout.value = [...layout.value, { ...defaultItem! }];
      }
      return;
    }

    hiddenWidgets.value = [...hiddenWidgets.value, widgetId];
  }

  function resetWidgetOrder() {
    applyWidgetOrder([...DASHBOARD_WIDGET_IDS]);
  }

  function resetAll() {
    hiddenWidgets.value = [];
    resetWidgetOrder();
  }

  function toggleEditMode() {
    editMode.value = !editMode.value;
  }

  return {
    draggedWidgetId,
    editMode,
    hiddenWidgets,
    isWidgetVisible,
    layout,
    onWidgetDragEnd,
    onWidgetDragOver,
    onWidgetDragStart,
    onWidgetDrop,
    resetAll,
    resetWidgetOrder,
    toggleEditMode,
    toggleWidgetVisibility,
    widgetOrder,
    widgetOrderIndex,
    widgetOrderStyle,
  };
}
