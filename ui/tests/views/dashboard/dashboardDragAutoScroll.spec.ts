import {
  clampDashboardScroll,
  computeDashboardDragScrollDelta,
  DASHBOARD_DRAG_EDGE_THRESHOLD_PX,
  DASHBOARD_DRAG_MAX_SCROLL_STEP_PX,
} from '@/views/dashboard/dashboardDragAutoScroll';

describe('dashboardDragAutoScroll', () => {
  describe('clampDashboardScroll', () => {
    it('clamps values below the minimum bound', () => {
      expect(clampDashboardScroll(-25, 0, 100)).toBe(0);
    });

    it('clamps values above the maximum bound', () => {
      expect(clampDashboardScroll(125, 0, 100)).toBe(100);
    });

    it('preserves values already inside the range', () => {
      expect(clampDashboardScroll(42, 0, 100)).toBe(42);
    });
  });

  describe('computeDashboardDragScrollDelta', () => {
    const rect = { top: 100, bottom: 500 } as DOMRect;

    it('applies the minimum upward scroll step exactly on the top threshold', () => {
      expect(
        computeDashboardDragScrollDelta(rect.top + DASHBOARD_DRAG_EDGE_THRESHOLD_PX, rect),
      ).toBe(-1);
    });

    it('applies the maximum upward scroll step when the pointer is beyond the top edge', () => {
      expect(computeDashboardDragScrollDelta(rect.top - 20, rect)).toBe(
        -DASHBOARD_DRAG_MAX_SCROLL_STEP_PX,
      );
    });

    it('applies the minimum downward scroll step exactly on the bottom threshold', () => {
      expect(
        computeDashboardDragScrollDelta(rect.bottom - DASHBOARD_DRAG_EDGE_THRESHOLD_PX, rect),
      ).toBe(1);
    });

    it('applies the maximum downward scroll step when the pointer is beyond the bottom edge', () => {
      expect(computeDashboardDragScrollDelta(rect.bottom + 20, rect)).toBe(
        DASHBOARD_DRAG_MAX_SCROLL_STEP_PX,
      );
    });

    it('returns zero just inside the safe middle zone', () => {
      expect(
        computeDashboardDragScrollDelta(rect.top + DASHBOARD_DRAG_EDGE_THRESHOLD_PX + 1, rect),
      ).toBe(0);
      expect(
        computeDashboardDragScrollDelta(rect.bottom - DASHBOARD_DRAG_EDGE_THRESHOLD_PX - 1, rect),
      ).toBe(0);
    });
  });
});
