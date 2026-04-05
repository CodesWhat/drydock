import { computed, type Ref, ref } from 'vue';
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

export type ResponsiveWidgetLayouts = Partial<
  Record<DashboardLayoutBreakpoint, WidgetLayoutItem[]>
>;

const RESPONSIVE_BREAKPOINTS = DASHBOARD_LAYOUT_BREAKPOINTS as readonly DashboardLayoutBreakpoint[];
const DEFAULT_BREAKPOINT: DashboardLayoutBreakpoint = 'lg';

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value);
}

function isDashboardLayoutBreakpoint(value: unknown): value is DashboardLayoutBreakpoint {
  return typeof value === 'string' && (RESPONSIVE_BREAKPOINTS as readonly string[]).includes(value);
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

/* v8 ignore next 12 -- short-circuit chain; every property is tested individually */
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
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => layoutItemsEqual(item, right[index]!));
}

/** @internal Exported for testing only. */
export function createResponsiveLayoutsMemo() {
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

function getCurrentBreakpointLayout(
  layouts: ResponsiveWidgetLayouts,
  order: readonly DashboardWidgetId[],
  breakpoint: DashboardLayoutBreakpoint,
): WidgetLayoutItem[] {
  return cloneLayout(layouts[breakpoint] ?? createLayoutFromOrder(order, breakpoint));
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

  /* v8 ignore next -- defensive: gridLayouts is always initialized as object */
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
    /* v8 ignore next -- legacy migration: tested via migration specs */
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

export function useDashboardResponsiveLayouts(options: {
  widgetOrder: Ref<readonly DashboardWidgetId[]>;
}) {
  const { widgetOrder } = options;
  const getResponsiveLayouts = createResponsiveLayoutsMemo();
  const currentBreakpoint = ref<DashboardLayoutBreakpoint>(DEFAULT_BREAKPOINT);
  const layoutsByBreakpoint = ref<ResponsiveWidgetLayouts>(loadPersistedLayouts(widgetOrder.value));
  const layout = ref<WidgetLayoutItem[]>(
    getCurrentBreakpointLayout(
      layoutsByBreakpoint.value,
      widgetOrder.value,
      currentBreakpoint.value,
    ),
  );
  const responsiveLayouts = computed(() => getResponsiveLayouts(layoutsByBreakpoint.value));

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
    /* v8 ignore next -- defensive fallback: lg always exists */
    preferences.dashboard.gridLayout = [...(preferences.dashboard.gridLayouts.lg ?? [])];
    return normalized;
  }

  function syncCurrentLayoutFromResponsiveLayouts() {
    layout.value = getCurrentBreakpointLayout(
      layoutsByBreakpoint.value,
      widgetOrder.value,
      currentBreakpoint.value,
    );
  }

  function rebuildLayoutsForCurrentOrder() {
    layoutsByBreakpoint.value = rebuildLayoutsForOrder(
      widgetOrder.value,
      layoutsByBreakpoint.value,
    );
  }

  function resetLayoutsToDefaults() {
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
      /* v8 ignore next -- defensive fallback when called without explicit layout */
      nextLayout ?? layoutsByBreakpoint.value[breakpoint],
    );
    layoutsByBreakpoint.value = {
      ...layoutsByBreakpoint.value,
      [breakpoint]: cloneLayout(normalized),
    };
  }

  return {
    currentBreakpoint,
    layout,
    onBreakpointChanged,
    persistDashboardLayouts,
    rebuildLayoutsForCurrentOrder,
    resetLayoutsToDefaults,
    responsiveLayouts,
    syncCurrentLayoutFromResponsiveLayouts,
  };
}
