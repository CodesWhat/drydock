export const DASHBOARD_DRAG_EDGE_THRESHOLD_PX = 72;
export const DASHBOARD_DRAG_MAX_SCROLL_STEP_PX = 24;

export function clampDashboardScroll(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeDashboardDragScrollDelta(
  clientY: number,
  rect: Pick<DOMRect, 'bottom' | 'top'>,
): number {
  const topEdge = rect.top + DASHBOARD_DRAG_EDGE_THRESHOLD_PX;
  if (clientY <= topEdge) {
    const ratio = Math.min(1, (topEdge - clientY) / DASHBOARD_DRAG_EDGE_THRESHOLD_PX);
    return -Math.max(1, Math.round(ratio * DASHBOARD_DRAG_MAX_SCROLL_STEP_PX));
  }

  const bottomEdge = rect.bottom - DASHBOARD_DRAG_EDGE_THRESHOLD_PX;
  if (clientY >= bottomEdge) {
    const ratio = Math.min(1, (clientY - bottomEdge) / DASHBOARD_DRAG_EDGE_THRESHOLD_PX);
    return Math.max(1, Math.round(ratio * DASHBOARD_DRAG_MAX_SCROLL_STEP_PX));
  }

  return 0;
}
