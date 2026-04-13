import { onScopeDispose, ref, watch } from 'vue';
import { preferences } from '../../preferences/store';
import { DASHBOARD_WIDGET_IDS, type DashboardWidgetId } from './dashboardTypes';
import {
  _rebuildLayoutsForOrderForTests,
  createResponsiveLayoutsMemo,
  useDashboardResponsiveLayouts,
} from './useDashboardResponsiveLayouts';

export { _rebuildLayoutsForOrderForTests, createResponsiveLayoutsMemo };

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
  const {
    currentBreakpoint,
    layout,
    onBreakpointChanged,
    persistDashboardLayouts,
    rebuildLayoutsForCurrentOrder,
    resetLayoutsToDefaults,
    responsiveLayouts,
    syncCurrentLayoutFromResponsiveLayouts,
  } = useDashboardResponsiveLayouts({ widgetOrder });
  const gridInstanceKey = ref(0);
  const hiddenWidgets = ref<DashboardWidgetId[]>(
    sanitizeHiddenWidgets(preferences.dashboard.hiddenWidgets),
  );
  const editMode = ref(false);
  const draggedWidgetId = ref<DashboardWidgetId | null>(null);

  let syncing = false;

  function refreshGridInstance() {
    gridInstanceKey.value += 1;
  }

  function persistHiddenWidgets() {
    preferences.dashboard.hiddenWidgets = [...hiddenWidgets.value];
  }

  function applyWidgetOrder(nextOrder: readonly DashboardWidgetId[]) {
    syncing = true;
    widgetOrder.value = [...nextOrder];
    rebuildLayoutsForCurrentOrder();
    syncCurrentLayoutFromResponsiveLayouts();
    persistDashboardLayouts(layout.value);
    refreshGridInstance();
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
      rebuildLayoutsForCurrentOrder();
      syncCurrentLayoutFromResponsiveLayouts();
      persistDashboardLayouts(layout.value);
      refreshGridInstance();
      queueMicrotask(() => {
        syncing = false;
      });
    },
    { deep: true },
  );

  let layoutPersistTimer: ReturnType<typeof setTimeout> | undefined;

  function flushPendingLayoutPersist() {
    if (layoutPersistTimer === undefined) {
      return;
    }
    clearTimeout(layoutPersistTimer);
    layoutPersistTimer = undefined;
    persistDashboardLayouts(layout.value);
  }

  const visibilitychangeListener = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      flushPendingLayoutPersist();
    }
  };
  const pagehideListener = () => {
    flushPendingLayoutPersist();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', visibilitychangeListener);
  }
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('pagehide', pagehideListener);
  }

  watch(
    layout,
    (nextLayout) => {
      if (syncing) {
        return;
      }

      const nextOrder = nextLayout.map((item) => item.i);
      if (!arraysEqual(nextOrder, widgetOrder.value)) {
        syncing = true;
        widgetOrder.value = nextOrder;
        persistDashboardLayouts(nextLayout);
        queueMicrotask(() => {
          syncing = false;
        });
        return;
      }

      clearTimeout(layoutPersistTimer);
      layoutPersistTimer = setTimeout(() => {
        layoutPersistTimer = undefined;
        persistDashboardLayouts(nextLayout);
      }, 300);
    },
    { deep: true },
  );

  watch(hiddenWidgets, persistHiddenWidgets, { deep: true });

  onScopeDispose(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilitychangeListener);
    }
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('pagehide', pagehideListener);
    }
    flushPendingLayoutPersist();
    persistHiddenWidgets();
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
      syncing = true;
      hiddenWidgets.value = hiddenWidgets.value.filter((id) => id !== widgetId);
      widgetOrder.value = sanitizeWidgetOrder([...widgetOrder.value, widgetId]);
      rebuildLayoutsForCurrentOrder();
      syncCurrentLayoutFromResponsiveLayouts();
      persistDashboardLayouts(layout.value);
      refreshGridInstance();
      queueMicrotask(() => {
        syncing = false;
      });
      return;
    }

    hiddenWidgets.value = [...hiddenWidgets.value, widgetId];
  }

  function resetWidgetOrder() {
    applyWidgetOrder([...DASHBOARD_WIDGET_IDS]);
  }

  function resetAll() {
    syncing = true;
    hiddenWidgets.value = [];
    widgetOrder.value = [...DASHBOARD_WIDGET_IDS];
    resetLayoutsToDefaults();
    persistHiddenWidgets();
    persistDashboardLayouts(layout.value);
    refreshGridInstance();
    queueMicrotask(() => {
      syncing = false;
    });
  }

  function toggleEditMode() {
    editMode.value = !editMode.value;
  }

  return {
    currentBreakpoint,
    draggedWidgetId,
    editMode,
    gridInstanceKey,
    hiddenWidgets,
    isWidgetVisible,
    layout,
    onBreakpointChanged,
    onWidgetDragEnd,
    onWidgetDragOver,
    onWidgetDragStart,
    onWidgetDrop,
    resetAll,
    resetWidgetOrder,
    responsiveLayouts,
    toggleEditMode,
    toggleWidgetVisibility,
    widgetOrder,
    widgetOrderIndex,
    widgetOrderStyle,
  };
}
