import {
  layoutsOverlap,
  packDashboardLayout,
  reorderDashboardLayout,
  resizeDashboardLayout,
} from '@/views/dashboard/dashboardGridLayout';
import type { WidgetLayoutItem } from '@/views/dashboard/dashboardWidgetLayout';

const row: WidgetLayoutItem[] = [
  { i: 'stat-containers', x: 0, y: 0, w: 3, h: 3 },
  { i: 'stat-security', x: 3, y: 0, w: 3, h: 3 },
  { i: 'stat-registries', x: 6, y: 0, w: 3, h: 3 },
  { i: 'stat-updates', x: 9, y: 0, w: 3, h: 3 },
];

describe('dashboardGridLayout', () => {
  it('packs items deterministically without collisions', () => {
    const packed = packDashboardLayout(
      [
        row[0],
        { i: 'recent-updates', x: 0, y: 0, w: 8, h: 10 },
        { i: 'security-overview', x: 0, y: 0, w: 4, h: 10 },
      ],
      12,
    );

    expect(packed.map(({ i, x, y }) => ({ i, x, y }))).toEqual([
      { i: 'stat-containers', x: 0, y: 0 },
      { i: 'recent-updates', x: 3, y: 0 },
      { i: 'security-overview', x: 0, y: 10 },
    ]);
    expect(layoutsOverlap(packed)).toBe(false);
  });

  it('reorders widgets across the same row instead of snapping back (#281)', () => {
    const reordered = reorderDashboardLayout(row, 'stat-containers', 'stat-registries', 12);

    expect(reordered.map((item) => item.i)).toEqual([
      'stat-security',
      'stat-registries',
      'stat-containers',
      'stat-updates',
    ]);
    expect(reordered.map((item) => item.x)).toEqual([0, 3, 6, 9]);
    expect(layoutsOverlap(reordered)).toBe(false);
  });

  it('returns an isolated copy when a reorder target is invalid or unchanged', () => {
    const unchanged = reorderDashboardLayout(row, 'stat-containers', 'stat-containers', 12);
    const invalid = reorderDashboardLayout(row, 'stat-containers', 'recent-updates', 12);

    expect(unchanged).toEqual(row);
    expect(unchanged).not.toBe(row);
    expect(invalid).toEqual(row);
  });

  it('clamps resize dimensions and repacks displaced widgets', () => {
    const resized = resizeDashboardLayout(row, 'stat-containers', 20, 1, 12, {
      minW: 2,
      minH: 3,
      maxW: 6,
      maxH: 6,
    });

    expect(resized[0]).toMatchObject({ w: 6, h: 3 });
    expect(layoutsOverlap(resized)).toBe(false);
  });
});
