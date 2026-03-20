import { describe, expect, test } from 'vitest';
import { DASHBOARD_WIDGET_IDS } from '@/views/dashboard/dashboardTypes';
import {
  applyConstraints,
  createDefaultLayout,
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
        expect(card.h).toBe(4);
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
