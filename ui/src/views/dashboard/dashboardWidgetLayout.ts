import type { Breakpoints } from 'grid-layout-plus';
import type { DashboardLayoutBreakpoint } from '../../preferences/schema';
import type { DashboardWidgetId } from './dashboardTypes';

export interface WidgetLayoutItem {
  i: DashboardWidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

/**
 * Responsive breakpoints for the dashboard grid (pixel widths).
 * Measured against the grid CONTAINER width (not viewport) by grid-layout-plus.
 *
 * Widget default widths (w:3 stat cards, w:4 big widgets) only tile cleanly
 * into 12 columns (3*4=12, 4*3=12). Any other column count (6, 8, etc.)
 * creates gaps because grid-layout-plus responsive mode clamps positions
 * instead of reflowing. So we keep 12 columns all the way down to phone
 * width, then drop to 1 column where everything stacks full-width.
 */
export const GRID_BREAKPOINTS: Breakpoints = {
  xxs: 0,
  xs: 480,
  sm: 639,
  md: 640,
  lg: 1024,
};

/** Column counts per responsive breakpoint. */
export const GRID_COLS: Breakpoints = {
  xxs: 1,
  xs: 1,
  sm: 1,
  md: 12,
  lg: 12,
};

interface WidgetLayoutConstraints {
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  defaultW: number;
  defaultH: number;
}

export interface WidgetGridBounds {
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
}

export const WIDGET_CONSTRAINTS: Record<DashboardWidgetId, WidgetLayoutConstraints> = {
  'stat-containers': { minW: 2, minH: 3, maxW: 6, maxH: 6, defaultW: 3, defaultH: 3 },
  'stat-updates': { minW: 2, minH: 3, maxW: 6, maxH: 6, defaultW: 3, defaultH: 3 },
  'stat-security': { minW: 2, minH: 3, maxW: 6, maxH: 6, defaultW: 3, defaultH: 3 },
  'stat-registries': { minW: 2, minH: 3, maxW: 6, maxH: 6, defaultW: 3, defaultH: 3 },
  'recent-updates': { minW: 4, minH: 3, maxW: 12, maxH: 16, defaultW: 8, defaultH: 10 },
  'security-overview': { minW: 3, minH: 3, maxW: 6, maxH: 16, defaultW: 4, defaultH: 10 },
  'resource-usage': { minW: 3, minH: 3, maxW: 12, maxH: 20, defaultW: 4, defaultH: 14 },
  'host-status': { minW: 3, minH: 3, maxW: 12, maxH: 20, defaultW: 4, defaultH: 6 },
  'update-breakdown': { minW: 3, minH: 3, maxW: 12, maxH: 8, defaultW: 4, defaultH: 6 },
};

const DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { i: 'stat-containers', x: 0, y: 0, w: 3, h: 3 },
  { i: 'stat-security', x: 3, y: 0, w: 3, h: 3 },
  { i: 'stat-registries', x: 6, y: 0, w: 3, h: 3 },
  { i: 'stat-updates', x: 9, y: 0, w: 3, h: 3 },
  { i: 'resource-usage', x: 0, y: 3, w: 4, h: 12 },
  { i: 'security-overview', x: 4, y: 3, w: 4, h: 12 },
  { i: 'host-status', x: 8, y: 3, w: 4, h: 6 },
  { i: 'update-breakdown', x: 8, y: 9, w: 4, h: 6 },
  { i: 'recent-updates', x: 0, y: 15, w: 12, h: 10 },
];

const DEFAULT_LAYOUT_BY_ID = new Map(DEFAULT_LAYOUT.map((item) => [item.i, item] as const));

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isSingleColumnBreakpoint(breakpoint: DashboardLayoutBreakpoint): boolean {
  return GRID_COLS[breakpoint] === 1;
}

export function getWidgetBoundsForBreakpoint(
  widgetId: DashboardWidgetId,
  breakpoint: DashboardLayoutBreakpoint,
): WidgetGridBounds {
  const constraints = WIDGET_CONSTRAINTS[widgetId];
  if (!constraints) {
    return {
      minW: 1,
      minH: 1,
      maxW: GRID_COLS[breakpoint],
      maxH: Number.POSITIVE_INFINITY,
    };
  }

  if (isSingleColumnBreakpoint(breakpoint)) {
    return {
      minW: 1,
      minH: constraints.minH,
      maxW: 1,
      maxH: constraints.maxH,
    };
  }

  const maxCols = GRID_COLS[breakpoint];
  return {
    minW: Math.min(constraints.minW, maxCols),
    minH: constraints.minH,
    maxW: Math.min(constraints.maxW, maxCols),
    maxH: constraints.maxH,
  };
}

export function applyConstraints(
  layout: WidgetLayoutItem[],
  breakpoint: DashboardLayoutBreakpoint = 'lg',
): WidgetLayoutItem[] {
  const singleColumn = isSingleColumnBreakpoint(breakpoint);
  const maxCols = GRID_COLS[breakpoint];

  return layout.map((item) => {
    const bounds = getWidgetBoundsForBreakpoint(item.i, breakpoint);
    const width = singleColumn ? 1 : clamp(item.w, bounds.minW, bounds.maxW);
    return {
      ...item,
      x: singleColumn ? 0 : clamp(item.x, 0, Math.max(0, maxCols - width)),
      w: width,
      h: clamp(item.h, bounds.minH, bounds.maxH),
      minW: bounds.minW,
      minH: bounds.minH,
      maxW: bounds.maxW,
      maxH: bounds.maxH,
    };
  });
}

export function createDefaultLayout(): WidgetLayoutItem[] {
  return applyConstraints(DEFAULT_LAYOUT.map((item) => ({ ...item })));
}

export function createDefaultLayoutForBreakpoint(
  order: readonly DashboardWidgetId[],
  breakpoint: DashboardLayoutBreakpoint,
): WidgetLayoutItem[] {
  if (!isSingleColumnBreakpoint(breakpoint)) {
    return applyConstraints(
      order.map((id) => ({ ...DEFAULT_LAYOUT_BY_ID.get(id)! })),
      breakpoint,
    );
  }

  let nextY = 0;
  return applyConstraints(
    order.map((id) => {
      const fallback = DEFAULT_LAYOUT_BY_ID.get(id)!;
      const item: WidgetLayoutItem = { i: id, x: 0, y: nextY, w: 1, h: fallback.h };
      nextY += item.h;
      return item;
    }),
    breakpoint,
  );
}
