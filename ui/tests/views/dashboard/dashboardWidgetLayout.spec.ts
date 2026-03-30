import { describe, expect, test } from 'vitest';
import { DASHBOARD_WIDGET_IDS } from '@/views/dashboard/dashboardTypes';
import {
  applyConstraints,
  createDefaultLayout,
  GRID_BREAKPOINTS,
  GRID_COLS,
  WIDGET_CONSTRAINTS,
} from '@/views/dashboard/dashboardWidgetLayout';

describe('dashboardWidgetLayout', () => {
  describe('createDefaultLayout', () => {
    const layout = createDefaultLayout();

    test('includes every widget exactly once', () => {
      const ids = layout.map((item) => item.i).sort();
      const expected = [...DASHBOARD_WIDGET_IDS].sort();
      expect(ids).toEqual(expected);
    });

    test('stat cards fill the first row as 4 equal columns', () => {
      const statCards = layout.filter((item) => item.i.startsWith('stat-'));
      expect(statCards).toHaveLength(4);
      for (const card of statCards) {
        expect(card.y).toBe(0);
        expect(card.w).toBe(3);
        expect(card.h).toBe(3);
      }
      const xPositions = statCards.map((c) => c.x).sort((a, b) => a - b);
      expect(xPositions).toEqual([0, 3, 6, 9]);
    });

    test('resource-usage and security-overview have equal height', () => {
      const resource = layout.find((item) => item.i === 'resource-usage');
      const security = layout.find((item) => item.i === 'security-overview');
      expect(resource?.h).toBe(security?.h);
    });

    test('host-status and update-breakdown stack in the right column', () => {
      const host = layout.find((item) => item.i === 'host-status');
      const breakdown = layout.find((item) => item.i === 'update-breakdown');
      expect(host?.x).toBe(8);
      expect(breakdown?.x).toBe(8);
      expect(host?.w).toBe(4);
      expect(breakdown?.w).toBe(4);
    });

    test('recent-updates spans full width at the bottom', () => {
      const updates = layout.find((item) => item.i === 'recent-updates');
      expect(updates?.x).toBe(0);
      expect(updates?.w).toBe(12);
      const maxY = Math.max(
        ...layout.filter((i) => i.i !== 'recent-updates').map((i) => i.y + i.h),
      );
      expect(updates?.y).toBeGreaterThanOrEqual(maxY);
    });

    test('all items have constraints applied', () => {
      for (const item of layout) {
        const c = WIDGET_CONSTRAINTS[item.i];
        expect(item.w).toBeGreaterThanOrEqual(c.minW);
        expect(item.w).toBeLessThanOrEqual(c.maxW);
        expect(item.h).toBeGreaterThanOrEqual(c.minH);
        expect(item.h).toBeLessThanOrEqual(c.maxH);
        expect(item.minW).toBe(c.minW);
        expect(item.minH).toBe(c.minH);
        expect(item.maxW).toBe(c.maxW);
        expect(item.maxH).toBe(c.maxH);
      }
    });

    test('no items overlap', () => {
      for (let i = 0; i < layout.length; i++) {
        for (let j = i + 1; j < layout.length; j++) {
          const a = layout[i];
          const b = layout[j];
          const overlapsX = a.x < b.x + b.w && a.x + a.w > b.x;
          const overlapsY = a.y < b.y + b.h && a.y + a.h > b.y;
          expect(overlapsX && overlapsY, `${a.i} overlaps ${b.i}`).toBe(false);
        }
      }
    });
  });

  describe('responsive grid constants', () => {
    test('GRID_BREAKPOINTS and GRID_COLS have matching keys', () => {
      const bpKeys = Object.keys(GRID_BREAKPOINTS).sort();
      const colKeys = Object.keys(GRID_COLS).sort();
      expect(bpKeys).toEqual(colKeys);
      for (const key of bpKeys) {
        expect(typeof GRID_BREAKPOINTS[key]).toBe('number');
        expect(typeof GRID_COLS[key]).toBe('number');
        expect(GRID_COLS[key]).toBeGreaterThanOrEqual(1);
      }
    });

    test('breakpoints are ordered ascending', () => {
      const entries = Object.entries(GRID_BREAKPOINTS).sort(([, a], [, b]) => a - b);
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i][1]).toBeGreaterThan(entries[i - 1][1]);
      }
    });

    test('smallest breakpoint uses 1 column for stacking', () => {
      const smallest = Object.entries(GRID_BREAKPOINTS).sort(([, a], [, b]) => a - b)[0][0];
      expect(GRID_COLS[smallest]).toBe(1);
    });

    test('desktop breakpoint (lg) uses 12 columns matching colNum', () => {
      expect(GRID_COLS.lg).toBe(12);
    });

    test('column counts increase with breakpoint size', () => {
      const entries = Object.entries(GRID_BREAKPOINTS).sort(([, a], [, b]) => a - b);
      for (let i = 1; i < entries.length; i++) {
        expect(GRID_COLS[entries[i][0]]).toBeGreaterThanOrEqual(GRID_COLS[entries[i - 1][0]]);
      }
    });
  });

  describe('applyConstraints', () => {
    test('clamps oversized items to max', () => {
      const result = applyConstraints([{ i: 'stat-containers', x: 0, y: 0, w: 20, h: 20 }]);
      const c = WIDGET_CONSTRAINTS['stat-containers'];
      expect(result[0].w).toBe(c.maxW);
      expect(result[0].h).toBe(c.maxH);
    });

    test('clamps undersized items to min', () => {
      const result = applyConstraints([{ i: 'resource-usage', x: 0, y: 0, w: 1, h: 1 }]);
      const c = WIDGET_CONSTRAINTS['resource-usage'];
      expect(result[0].w).toBe(c.minW);
      expect(result[0].h).toBe(c.minH);
    });
  });
});
