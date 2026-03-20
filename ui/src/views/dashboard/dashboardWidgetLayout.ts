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

interface WidgetLayoutConstraints {
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  defaultW: number;
  defaultH: number;
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
  // Row 0: stat cards (h:4 = 120px + margins)
  { i: 'stat-containers', x: 0, y: 0, w: 3, h: 3 },
  { i: 'stat-security', x: 3, y: 0, w: 3, h: 3 },
  { i: 'stat-registries', x: 6, y: 0, w: 3, h: 3 },
  { i: 'stat-updates', x: 9, y: 0, w: 3, h: 3 },
  // Row 3: three-column layout
  { i: 'resource-usage', x: 0, y: 3, w: 4, h: 12 },
  { i: 'security-overview', x: 4, y: 3, w: 4, h: 12 },
  { i: 'host-status', x: 8, y: 3, w: 4, h: 6 },
  { i: 'update-breakdown', x: 8, y: 9, w: 4, h: 6 },
  // Row 15: updates table full width
  { i: 'recent-updates', x: 0, y: 15, w: 12, h: 10 },
];

export function applyConstraints(layout: WidgetLayoutItem[]): WidgetLayoutItem[] {
  return layout.map((item) => {
    const constraints = WIDGET_CONSTRAINTS[item.i];
    if (!constraints) return item;
    return {
      ...item,
      w: Math.max(constraints.minW, Math.min(constraints.maxW, item.w)),
      h: Math.max(constraints.minH, Math.min(constraints.maxH, item.h)),
      minW: constraints.minW,
      minH: constraints.minH,
      maxW: constraints.maxW,
      maxH: constraints.maxH,
    };
  });
}

export function createDefaultLayout(): WidgetLayoutItem[] {
  return applyConstraints(DEFAULT_LAYOUT.map((item) => ({ ...item })));
}
