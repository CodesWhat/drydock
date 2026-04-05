import { computed, onScopeDispose, ref, watch } from 'vue';
import {
  DASHBOARD_LAYOUT_BREAKPOINTS,
  type DashboardLayoutBreakpoint,
  type PersistedLayoutItem,
  type PersistedResponsiveLayoutMap,
} from '../../preferences/schema';
import { preferences } from '../../preferences/store';
import { DASHBOARD_WIDGET_IDS, type DashboardWidgetId } from './dashboardTypes';
import {
  applyConstraints,
  createDefaultLayoutForBreakpoint,
  type WidgetLayoutItem,
} from './dashboardWidgetLayout';

type ResponsiveWidgetLayouts = Partial<Record<DashboardLayoutBreakpoint, WidgetLayoutItem[]>>;

const RESPONSIVE_BREAKPOINTS = DASHBOARD_LAYOUT_BREAKPOINTS as readonly DashboardLayoutBreakpoint[];
const DEFAULT_BREAKPOINT: DashboardLayoutBreakpoint = 'lg';

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value);
}

function isDashboardLayoutBreakpoint(value: unknown): value is DashboardLayoutBreakpoint {
  return typeof value === 'string' && (RESPONSIVE_BREAKPOINTS as readonly string[]).includes(value);
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

function cloneLayoutItem(item: WidgetLayoutItem): WidgetLayoutItem {
  return {
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW,
    minH: item.minH,
    maxW: item.maxW,
    maxH: item.maxH,
  };
}

function cloneLayout(layout: readonly WidgetLayoutItem[]): WidgetLayoutItem[] {
  return layout.map(cloneLayoutItem);
}

function layoutItemsEqual(left: WidgetLayoutItem, right: WidgetLayoutItem): boolean {
  return (
    left.i === right.i &&
    left.x === right.x &&
    left.y === right.y &&
    left.w === right.w &&
    left.h === right.h &&
    left.minW === right.minW &&
    left.minH === right.minH &&
    left.maxW === right.maxW &&
    left.maxH === right.maxH
  );
}

function layoutsShallowEqual(
  left: readonly WidgetLayoutItem[] | undefined,
  right: readonly WidgetLayoutItem[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => layoutItemsEqual(item, right[index]!));
}

function createResponsiveLayoutsMemo() {
  let previousResult: ResponsiveWidgetLayouts = {};

  return (layouts: ResponsiveWidgetLayouts): ResponsiveWidgetLayouts => {
    let changed = false;
    const nextResult: ResponsiveWidgetLayouts = {};

    for (const breakpoint of RESPONSIVE_BREAKPOINTS) {
      const source = layouts[breakpoint];
      const previous = previousResult[breakpoint];

      if (!source?.length) {
        if (previous?.length) {
          changed = true;
        }
        continue;
      }

      if (layoutsShallowEqual(source, previous)) {
        nextResult[breakpoint] = previous;
        continue;
      }

      nextResult[breakpoint] = cloneLayout(source);
      changed = true;
    }

    if (!changed) {
      return previousResult;
    }

    previousResult = nextResult;
    return previousResult;
  };
}

function stripLayout(layout: readonly WidgetLayoutItem[]): PersistedLayoutItem[] {
  return layout.map((item) => ({
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
  }));
}

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

function isLegacySingleColumnLayout(rawLayout: unknown): boolean {
  return (
    Array.isArray(rawLayout) &&
    rawLayout.length > 0 &&
    rawLayout.every((item) => isValidLayoutItem(item) && item.x === 0 && item.w === 1)
  );
}

function createLayoutFromOrder(
  order: readonly DashboardWidgetId[],
  breakpoint: DashboardLayoutBreakpoint = DEFAULT_BREAKPOINT,
): WidgetLayoutItem[] {
  return createDefaultLayoutForBreakpoint(order, breakpoint);
}

function hydrateLayout(
  order: readonly DashboardWidgetId[],
  breakpoint: DashboardLayoutBreakpoint,
  rawLayout: unknown,
): WidgetLayoutItem[] {
  const baseLayout = createLayoutFromOrder(order, breakpoint);
  if (!Array.isArray(rawLayout)) {
    return baseLayout;
  }

  const persisted = new Map<DashboardWidgetId, WidgetLayoutItem>();
  for (const item of rawLayout) {
    if (isValidLayoutItem(item)) {
      persisted.set(item.i, { i: item.i, x: item.x, y: item.y, w: item.w, h: item.h });
    }
  }

  return applyConstraints(
    baseLayout.map((item) => {
      const saved = persisted.get(item.i);
      return saved ? { ...item, ...saved } : item;
    }),
    breakpoint,
  );
}

function loadPersistedLayouts(order: readonly DashboardWidgetId[]): ResponsiveWidgetLayouts {
  const layouts: ResponsiveWidgetLayouts = {};
  const rawResponsiveLayouts = preferences.dashboard.gridLayouts;

  if (rawResponsiveLayouts && typeof rawResponsiveLayouts === 'object') {
    for (const breakpoint of RESPONSIVE_BREAKPOINTS) {
      const candidate = (rawResponsiveLayouts as Record<string, unknown>)[breakpoint];
      if (Array.isArray(candidate)) {
        layouts[breakpoint] = hydrateLayout(order, breakpoint, candidate);
      }
    }
  }

  if (
    Object.keys(layouts).length === 0 &&
    Array.isArray(preferences.dashboard.gridLayout) &&
    preferences.dashboard.gridLayout.length > 0
  ) {
    const legacyBreakpoint = isLegacySingleColumnLayout(preferences.dashboard.gridLayout)
      ? 'sm'
      : 'lg';
    layouts[legacyBreakpoint] = hydrateLayout(
      order,
      legacyBreakpoint,
      preferences.dashboard.gridLayout,
    );
  }

  if (!layouts.lg) {
    layouts.lg = createLayoutFromOrder(order, 'lg');
  }

  return layouts;
}

function serializeResponsiveLayouts(
  layouts: ResponsiveWidgetLayouts,
): PersistedResponsiveLayoutMap {
  const result: PersistedResponsiveLayoutMap = {};
  for (const breakpoint of RESPONSIVE_BREAKPOINTS) {
    if (layouts[breakpoint]?.length) {
      result[breakpoint] = stripLayout(layouts[breakpoint]!);
    }
  }
  return result;
}

function rebuildLayoutsForOrder(
  order: readonly DashboardWidgetId[],
  layouts: ResponsiveWidgetLayouts,
): ResponsiveWidgetLayouts {
  const nextLayouts: ResponsiveWidgetLayouts = {};

  for (const breakpoint of RESPONSIVE_BREAKPOINTS) {
    if (layouts[breakpoint]?.length) {
      nextLayouts[breakpoint] = hydrateLayout(order, breakpoint, layouts[breakpoint]);
    }
  }

  if (!nextLayouts.lg) {
    nextLayouts.lg = createLayoutFromOrder(order, 'lg');
  }

  return nextLayouts;
}

export const _rebuildLayoutsForOrderForTests = rebuildLayoutsForOrder;

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
  const getResponsiveLayouts = createResponsiveLayoutsMemo();
  const widgetOrder = ref<DashboardWidgetId[]>(
    sanitizeWidgetOrder(preferences.dashboard.widgetOrder),
  );
  const currentBreakpoint = ref<DashboardLayoutBreakpoint>(DEFAULT_BREAKPOINT);
  const layoutsByBreakpoint = ref<ResponsiveWidgetLayouts>(loadPersistedLayouts(widgetOrder.value));
  const layout = ref<WidgetLayoutItem[]>(
    cloneLayout(
      layoutsByBreakpoint.value[currentBreakpoint.value] ??
        createLayoutFromOrder(widgetOrder.value, currentBreakpoint.value),
    ),
  );
  const responsiveLayouts = computed(() => getResponsiveLayouts(layoutsByBreakpoint.value));
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

  function syncCurrentLayoutIntoResponsiveLayouts(nextLayout: readonly WidgetLayoutItem[]) {
    const normalized = hydrateLayout(widgetOrder.value, currentBreakpoint.value, nextLayout);
    layoutsByBreakpoint.value = {
      ...layoutsByBreakpoint.value,
      [currentBreakpoint.value]: cloneLayout(normalized),
    };
    return normalized;
  }

  function persistDashboardLayouts(nextLayout: readonly WidgetLayoutItem[] = layout.value) {
    const normalized = syncCurrentLayoutIntoResponsiveLayouts(nextLayout);
    preferences.dashboard.widgetOrder = [...widgetOrder.value];
    preferences.dashboard.gridLayouts = serializeResponsiveLayouts(layoutsByBreakpoint.value);
    preferences.dashboard.gridLayout = [...(preferences.dashboard.gridLayouts.lg ?? [])];
    return normalized;
  }

  function persistHiddenWidgets() {
    preferences.dashboard.hiddenWidgets = [...hiddenWidgets.value];
  }

  function syncCurrentLayoutFromResponsiveLayouts() {
    layout.value = cloneLayout(
      layoutsByBreakpoint.value[currentBreakpoint.value] ??
        createLayoutFromOrder(widgetOrder.value, currentBreakpoint.value),
    );
  }

  function applyWidgetOrder(nextOrder: readonly DashboardWidgetId[]) {
    syncing = true;
    widgetOrder.value = [...nextOrder];
    layoutsByBreakpoint.value = rebuildLayoutsForOrder(
      widgetOrder.value,
      layoutsByBreakpoint.value,
    );
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
      layoutsByBreakpoint.value = rebuildLayoutsForOrder(nextOrder, layoutsByBreakpoint.value);
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

  function onBreakpointChanged(
    breakpoint: DashboardLayoutBreakpoint,
    nextLayout?: readonly WidgetLayoutItem[],
  ) {
    if (!isDashboardLayoutBreakpoint(breakpoint)) {
      return;
    }

    currentBreakpoint.value = breakpoint;
    const normalized = hydrateLayout(
      widgetOrder.value,
      breakpoint,
      nextLayout ?? layoutsByBreakpoint.value[breakpoint],
    );
    layoutsByBreakpoint.value = {
      ...layoutsByBreakpoint.value,
      [breakpoint]: cloneLayout(normalized),
    };
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
      layoutsByBreakpoint.value = rebuildLayoutsForOrder(
        widgetOrder.value,
        layoutsByBreakpoint.value,
      );
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
    const nextLayouts: ResponsiveWidgetLayouts = {
      lg: createLayoutFromOrder(widgetOrder.value, 'lg'),
    };
    if (currentBreakpoint.value !== 'lg') {
      nextLayouts[currentBreakpoint.value] = createLayoutFromOrder(
        widgetOrder.value,
        currentBreakpoint.value,
      );
    }
    layoutsByBreakpoint.value = nextLayouts;
    syncCurrentLayoutFromResponsiveLayouts();
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
