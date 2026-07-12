import type { DashboardWidgetId } from './dashboardTypes';
import type { WidgetGridBounds, WidgetLayoutItem } from './dashboardWidgetLayout';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function itemsOverlap(left: WidgetLayoutItem, right: WidgetLayoutItem): boolean {
  return !(
    left.x + left.w <= right.x ||
    right.x + right.w <= left.x ||
    left.y + left.h <= right.y ||
    right.y + right.h <= left.y
  );
}

export function layoutsOverlap(layout: readonly WidgetLayoutItem[]): boolean {
  return layout.some((item, index) =>
    layout.slice(index + 1).some((candidate) => itemsOverlap(item, candidate)),
  );
}

export function packDashboardLayout(
  layout: readonly WidgetLayoutItem[],
  columns: number,
): WidgetLayoutItem[] {
  const columnCount = Math.max(1, Math.floor(columns));
  const packed: WidgetLayoutItem[] = [];

  for (const source of layout) {
    const item = {
      ...source,
      w: clamp(Math.round(source.w), 1, columnCount),
      h: Math.max(1, Math.round(source.h)),
    };
    let placed = false;
    for (let y = 0; !placed; y += 1) {
      for (let x = 0; x <= columnCount - item.w; x += 1) {
        const candidate = { ...item, x, y };
        if (!packed.some((existing) => itemsOverlap(existing, candidate))) {
          packed.push(candidate);
          placed = true;
          break;
        }
      }
    }
  }

  return packed;
}

export function reorderDashboardLayout(
  layout: readonly WidgetLayoutItem[],
  sourceId: DashboardWidgetId,
  targetId: DashboardWidgetId,
  columns: number,
): WidgetLayoutItem[] {
  const sourceIndex = layout.findIndex((item) => item.i === sourceId);
  const targetIndex = layout.findIndex((item) => item.i === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return layout.map((item) => ({ ...item }));
  }

  const reordered = layout.map((item) => ({ ...item }));
  const [source] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, source!);
  return packDashboardLayout(reordered, columns);
}

export function resizeDashboardLayout(
  layout: readonly WidgetLayoutItem[],
  widgetId: DashboardWidgetId,
  width: number,
  height: number,
  columns: number,
  bounds: WidgetGridBounds,
): WidgetLayoutItem[] {
  const resized = layout.map((item) =>
    item.i === widgetId
      ? {
          ...item,
          w: clamp(Math.round(width), bounds.minW, Math.min(bounds.maxW, columns)),
          h: clamp(Math.round(height), bounds.minH, bounds.maxH),
        }
      : { ...item },
  );
  return packDashboardLayout(resized, columns);
}
