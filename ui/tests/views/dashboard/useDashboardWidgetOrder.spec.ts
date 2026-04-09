import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { preferences } from '@/preferences/store';
import { DASHBOARD_WIDGET_IDS, type DashboardWidgetId } from '@/views/dashboard/dashboardTypes';
import { applyConstraints } from '@/views/dashboard/dashboardWidgetLayout';
import {
  _rebuildLayoutsForOrderForTests,
  createResponsiveLayoutsMemo,
  moveWidget,
  useDashboardWidgetOrder,
} from '@/views/dashboard/useDashboardWidgetOrder';

async function mountWidgetOrderComposable() {
  let state: ReturnType<typeof useDashboardWidgetOrder> | undefined;
  const Harness = defineComponent({
    setup() {
      state = useDashboardWidgetOrder();
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  await nextTick();

  if (!state) {
    throw new Error('Dashboard widget order composable did not initialize');
  }

  return { state, wrapper };
}

describe('createResponsiveLayoutsMemo', () => {
  const item = (id: string, overrides: Record<string, unknown> = {}): any => ({
    i: id,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    minW: undefined,
    minH: undefined,
    maxW: undefined,
    maxH: undefined,
    ...overrides,
  });

  it('returns the same object when the same layout reference is passed twice', () => {
    const memo = createResponsiveLayoutsMemo();
    const layouts = { lg: [item('a')] };
    const first = memo(layouts);
    const second = memo(layouts);
    expect(second).toBe(first);
  });

  it('detects changes in each layout property independently', () => {
    const properties = ['y', 'w', 'h', 'minW', 'minH', 'maxW', 'maxH'] as const;
    for (const prop of properties) {
      const memo = createResponsiveLayoutsMemo();
      memo({ lg: [item('a')] });
      const changed = memo({ lg: [item('a', { [prop]: 999 })] });
      expect(changed.lg).toBeDefined();
    }
  });

  it('detects removal of a previously-present breakpoint', () => {
    const memo = createResponsiveLayoutsMemo();
    const withSm = memo({ lg: [item('a')], sm: [item('b')] });
    expect(withSm.sm).toBeDefined();

    const withoutSm = memo({ lg: [item('a')] });
    expect(withoutSm).not.toBe(withSm);
    expect(withoutSm.sm).toBeUndefined();
  });
});

describe('useDashboardWidgetOrder', () => {
  beforeEach(() => {
    localStorage.clear();
    preferences.dashboard.widgetOrder = [...DASHBOARD_WIDGET_IDS];
    preferences.dashboard.hiddenWidgets = [];
    preferences.dashboard.gridLayout = [];
    preferences.dashboard.gridLayouts = {
      xxs: undefined,
      xs: undefined,
      sm: undefined,
      md: undefined,
      lg: undefined,
    };
  });

  it('hydrates from preferences and falls back to defaults for non-array values', async () => {
    preferences.dashboard.widgetOrder = 'invalid-order' as unknown as string[];

    const { state } = await mountWidgetOrderComposable();

    expect(state.widgetOrder.value).toEqual(DASHBOARD_WIDGET_IDS);
  });

  it('sanitizes duplicates and invalid ids while preserving known order', async () => {
    preferences.dashboard.widgetOrder = [
      'recent-updates',
      'invalid-widget-id',
      'stat-containers',
      'recent-updates',
    ];

    const { state } = await mountWidgetOrderComposable();

    expect(state.widgetOrder.value).toEqual([
      'recent-updates',
      'stat-containers',
      ...DASHBOARD_WIDGET_IDS.filter((id) => id !== 'recent-updates' && id !== 'stat-containers'),
    ]);
  });

  it('sanitizes invalid hidden widget values', async () => {
    preferences.dashboard.hiddenWidgets = 'invalid-hidden' as unknown as string[];

    const { state } = await mountWidgetOrderComposable();

    expect(state.hiddenWidgets.value).toEqual([]);
  });

  it('falls back to default layout when gridLayout is not an array', async () => {
    preferences.dashboard.gridLayout =
      'not-an-array' as unknown as typeof preferences.dashboard.gridLayout;

    const { state } = await mountWidgetOrderComposable();

    expect(state.layout.value).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(state.layout.value.map((item) => item.i)).toEqual(DASHBOARD_WIDGET_IDS);
  });

  it('hydrates persisted grid layouts and skips invalid entries', async () => {
    preferences.dashboard.gridLayout = [
      { i: 'host-status', x: 10, y: 11, w: 4, h: 6 },
      null,
      'not-a-layout-item',
      { i: 'recent-updates', x: 1, y: 2, w: 6, h: 5 },
    ] as unknown as typeof preferences.dashboard.gridLayout;

    const { state } = await mountWidgetOrderComposable();

    expect(state.layout.value).toHaveLength(DASHBOARD_WIDGET_IDS.length);
    expect(state.layout.value.map((item) => item.i)).toEqual(DASHBOARD_WIDGET_IDS);
    expect(state.layout.value.find((item) => item.i === 'host-status')).toMatchObject({
      x: 10,
      y: 11,
      w: 4,
      h: 6,
    });
    expect(state.layout.value.find((item) => item.i === 'recent-updates')).toMatchObject({
      x: 1,
      y: 2,
      w: 6,
      h: 5,
    });
  });

  it('preserves valid single-column layouts for the mobile breakpoint', async () => {
    const mobileLayout = DASHBOARD_WIDGET_IDS.map((id, index) => ({
      i: id,
      x: 0,
      y: index,
      w: 1,
      h: 1,
    }));
    preferences.dashboard.gridLayouts.sm = mobileLayout;

    const { state } = await mountWidgetOrderComposable();
    state.onBreakpointChanged('sm', mobileLayout as any);
    state.layout.value = mobileLayout as any;
    await nextTick();

    expect(state.currentBreakpoint.value).toBe('sm');
    expect(state.layout.value.every((item) => item.x === 0)).toBe(true);
    expect(state.layout.value.every((item) => item.w === 1)).toBe(true);
  });

  it('returns explicit style ordering and uses canonical fallback index for missing ids', async () => {
    const { state } = await mountWidgetOrderComposable();
    state.widgetOrder.value = DASHBOARD_WIDGET_IDS.filter((id) => id !== 'host-status');
    await nextTick();

    expect(state.widgetOrderIndex('host-status')).toBe(DASHBOARD_WIDGET_IDS.indexOf('host-status'));
    expect(state.widgetOrderStyle('stat-containers')).toEqual({ order: 0 });
  });

  it('moves widgets via drag events and persists the new order', async () => {
    const { state } = await mountWidgetOrderComposable();

    const transfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      getData: vi.fn(() => 'update-breakdown'),
      setData: vi.fn(),
    };

    state.onWidgetDragStart('update-breakdown', { dataTransfer: transfer } as unknown as DragEvent);
    expect(state.draggedWidgetId.value).toBe('update-breakdown');
    expect(transfer.effectAllowed).toBe('move');
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'update-breakdown');

    const preventDefault = vi.fn();
    state.onWidgetDragOver('recent-updates', {
      preventDefault,
      dataTransfer: transfer,
    } as unknown as DragEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(transfer.dropEffect).toBe('move');

    state.onWidgetDrop('recent-updates', {
      preventDefault,
      dataTransfer: transfer,
    } as unknown as DragEvent);
    await nextTick();

    expect(state.widgetOrder.value).toEqual([
      'stat-containers',
      'stat-updates',
      'stat-security',
      'stat-registries',
      'update-breakdown',
      'recent-updates',
      'security-overview',
      'resource-usage',
      'host-status',
    ]);
    expect(state.draggedWidgetId.value).toBeNull();
    expect(preferences.dashboard.widgetOrder).toEqual(state.widgetOrder.value);
  });

  it('handles drag/drop no-op branches and supports reset', async () => {
    const { state } = await mountWidgetOrderComposable();
    const preventDefault = vi.fn();

    state.onWidgetDragOver('stat-containers', {
      preventDefault,
    } as unknown as DragEvent);
    expect(preventDefault).not.toHaveBeenCalled();

    state.onWidgetDragStart('stat-updates', {} as DragEvent);
    state.onWidgetDragOver('stat-updates', {
      preventDefault,
    } as unknown as DragEvent);
    expect(preventDefault).not.toHaveBeenCalled();

    state.onWidgetDragOver(
      'not-a-dashboard-widget' as any,
      {
        preventDefault,
      } as unknown as DragEvent,
    );
    expect(preventDefault).not.toHaveBeenCalled();

    state.onWidgetDragOver('recent-updates', {
      preventDefault,
    } as unknown as DragEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);

    state.widgetOrder.value = DASHBOARD_WIDGET_IDS.filter((id) => id !== 'stat-security');
    await nextTick();
    state.onWidgetDrop('stat-security', {
      preventDefault,
      dataTransfer: {
        getData: () => 'stat-updates',
      },
    } as unknown as DragEvent);
    expect(state.widgetOrder.value).not.toContain('stat-security');

    state.onWidgetDrop('stat-updates', {
      preventDefault,
      dataTransfer: {
        getData: () => 'stat-updates',
      },
    } as unknown as DragEvent);

    state.onWidgetDrop(
      'not-a-dashboard-widget' as any,
      {
        preventDefault,
        dataTransfer: {
          getData: () => 'stat-updates',
        },
      } as unknown as DragEvent,
    );

    state.onWidgetDrop('stat-updates', {
      preventDefault,
      dataTransfer: {
        getData: () => 'not-a-dashboard-widget',
      },
    } as unknown as DragEvent);
    expect(state.draggedWidgetId.value).toBeNull();

    state.onWidgetDragEnd();
    expect(state.draggedWidgetId.value).toBeNull();

    state.resetWidgetOrder();
    expect(state.widgetOrder.value).toEqual(DASHBOARD_WIDGET_IDS);
  });

  it('keeps layout, visibility, edit mode, and reset state in sync', async () => {
    const { state } = await mountWidgetOrderComposable();

    expect(state.isWidgetVisible('host-status')).toBe(true);
    state.toggleWidgetVisibility('host-status');
    await nextTick();
    expect(state.hiddenWidgets.value).toContain('host-status');
    expect(state.isWidgetVisible('host-status')).toBe(false);
    expect(preferences.dashboard.hiddenWidgets).toContain('host-status');

    state.hiddenWidgets.value = ['host-status'];
    state.layout.value = state.layout.value.filter((item) => item.i !== 'host-status');
    await nextTick();
    state.toggleWidgetVisibility('host-status');
    await nextTick();
    expect(state.isWidgetVisible('host-status')).toBe(true);
    expect(state.layout.value.some((item) => item.i === 'host-status')).toBe(true);

    state.hiddenWidgets.value = ['host-status'];
    const layoutBeforeRestore = [...state.layout.value];
    await nextTick();
    state.toggleWidgetVisibility('host-status');
    await nextTick();
    expect(state.isWidgetVisible('host-status')).toBe(true);
    expect(state.layout.value).toEqual(layoutBeforeRestore);

    const reversed: DashboardWidgetId[] = [...DASHBOARD_WIDGET_IDS].reverse();
    state.widgetOrder.value = [...reversed];
    await nextTick();
    expect(state.layout.value.map((item) => item.i)).toEqual(reversed);
    expect(preferences.dashboard.widgetOrder).toEqual(reversed);

    state.layout.value = [...state.layout.value].reverse();
    await nextTick();
    expect(state.widgetOrder.value).toEqual([...DASHBOARD_WIDGET_IDS]);

    state.toggleEditMode();
    expect(state.editMode.value).toBe(true);

    state.resetAll();
    await nextTick();
    expect(state.hiddenWidgets.value).toEqual([]);
    expect(state.widgetOrder.value).toEqual(DASHBOARD_WIDGET_IDS);
    expect(state.editMode.value).toBe(true);
  });

  it('ignores invalid breakpoints and falls back to default layouts for invalid breakpoint payloads', async () => {
    const { state } = await mountWidgetOrderComposable();

    state.onBreakpointChanged('invalid-breakpoint' as any);
    expect(state.currentBreakpoint.value).toBe('lg');

    state.onBreakpointChanged('md', 'invalid-layout' as any);
    await nextTick();

    expect(state.currentBreakpoint.value).toBe('md');
    expect(state.responsiveLayouts.value.md?.map((item) => item.i)).toEqual(DASHBOARD_WIDGET_IDS);
  });

  it('resetAll rebuilds the current non-desktop breakpoint layout', async () => {
    const mobileLayout = DASHBOARD_WIDGET_IDS.map((id, index) => ({
      i: id,
      x: 0,
      y: index * 2,
      w: 1,
      h: 2,
    }));
    const { state } = await mountWidgetOrderComposable();

    state.onBreakpointChanged('sm', mobileLayout as any);
    state.layout.value = mobileLayout as any;
    await nextTick();

    state.resetAll();
    await nextTick();

    expect(state.currentBreakpoint.value).toBe('sm');
    expect(state.responsiveLayouts.value.sm?.every((item) => item.w === 1)).toBe(true);
  });

  it('debounces position/size persistence when layout changes without order change', async () => {
    vi.useFakeTimers();
    const { state } = await mountWidgetOrderComposable();

    // Mutate a position without changing order
    const updated = state.layout.value.map((item) => ({ ...item }));
    updated[0] = { ...updated[0], x: 99 };
    state.layout.value = updated;
    await nextTick();

    // Before debounce fires, gridLayout should not yet be updated
    vi.advanceTimersByTime(300);
    expect(preferences.dashboard.gridLayouts.lg).toEqual(
      expect.arrayContaining([expect.objectContaining({ i: updated[0].i, x: 99 })]),
    );
    expect(preferences.dashboard.gridLayout).toEqual(
      expect.arrayContaining([expect.objectContaining({ i: updated[0].i, x: 99 })]),
    );

    vi.useRealTimers();
  });

  it('reuses unchanged breakpoint layouts in responsiveLayouts when persisting current breakpoint changes', async () => {
    vi.useFakeTimers();
    const mobileLayout = DASHBOARD_WIDGET_IDS.map((id, index) => ({
      i: id,
      x: 0,
      y: index,
      w: 1,
      h: 1,
    }));
    preferences.dashboard.gridLayouts.sm = mobileLayout;

    const { state } = await mountWidgetOrderComposable();
    const beforeSm = state.responsiveLayouts.value.sm;
    const beforeLg = state.responsiveLayouts.value.lg;

    const updated = state.layout.value.map((item) => ({ ...item }));
    updated[0] = { ...updated[0], x: 99 };
    state.layout.value = updated;
    await nextTick();

    vi.advanceTimersByTime(300);
    await nextTick();

    expect(state.responsiveLayouts.value.sm).toBe(beforeSm);
    expect(state.responsiveLayouts.value.lg).not.toBe(beforeLg);
    expect(state.responsiveLayouts.value.lg?.[0].x).toBe(99);

    vi.useRealTimers();
  });

  it('flushes pending layout persistence when the composable is disposed before debounce fires', async () => {
    vi.useFakeTimers();
    const { state, wrapper } = await mountWidgetOrderComposable();

    const updated = state.layout.value.map((item) => ({ ...item }));
    updated[0] = { ...updated[0], x: 99 };
    state.layout.value = updated;
    await nextTick();

    wrapper.unmount();

    expect(preferences.dashboard.gridLayouts.lg).toEqual(
      expect.arrayContaining([expect.objectContaining({ i: updated[0].i, x: 99 })]),
    );

    vi.useRealTimers();
  });

  it('flushes pending layout persistence when the page becomes hidden before debounce fires', async () => {
    vi.useFakeTimers();
    const { state } = await mountWidgetOrderComposable();
    const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    try {
      const updated = state.layout.value.map((item) => ({ ...item }));
      updated[0] = { ...updated[0], x: 99 };
      state.layout.value = updated;
      await nextTick();

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(preferences.dashboard.gridLayouts.lg).toEqual(
        expect.arrayContaining([expect.objectContaining({ i: updated[0].i, x: 99 })]),
      );
    } finally {
      if (originalVisibilityState) {
        Object.defineProperty(document, 'visibilityState', originalVisibilityState);
      } else {
        Reflect.deleteProperty(document, 'visibilityState');
      }
      vi.useRealTimers();
    }
  });

  it('flushes pending layout persistence on pagehide before debounce fires', async () => {
    vi.useFakeTimers();
    const { state } = await mountWidgetOrderComposable();

    try {
      const updated = state.layout.value.map((item) => ({ ...item }));
      updated[0] = { ...updated[0], x: 99 };
      state.layout.value = updated;
      await nextTick();

      globalThis.dispatchEvent(new Event('pagehide'));

      expect(preferences.dashboard.gridLayouts.lg).toEqual(
        expect.arrayContaining([expect.objectContaining({ i: updated[0].i, x: 99 })]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the original order when asked to move invalid or no-op widget pairs', () => {
    const original = [...DASHBOARD_WIDGET_IDS];
    expect(moveWidget(original, 'stat-containers', 'stat-containers')).toEqual(original);
    expect(moveWidget(original, 'missing-widget' as DashboardWidgetId, 'stat-containers')).toEqual(
      original,
    );
    expect(moveWidget(original, 'stat-containers', 'missing-widget' as DashboardWidgetId)).toEqual(
      original,
    );
  });

  it('moves widgets from an earlier slot ahead of later targets', () => {
    const moved = moveWidget([...DASHBOARD_WIDGET_IDS], 'stat-containers', 'resource-usage');

    expect(moved).toEqual([
      'stat-updates',
      'stat-security',
      'stat-registries',
      'recent-updates',
      'security-overview',
      'stat-containers',
      'resource-usage',
      'host-status',
      'update-breakdown',
    ]);
  });

  it('preserves custom positions when widget order changes (#223)', async () => {
    const customLayout = DASHBOARD_WIDGET_IDS.map((id, index) => ({
      i: id,
      x: index * 2,
      y: index * 3,
      w: 4,
      h: 5,
    }));
    preferences.dashboard.gridLayout = customLayout;

    const { state } = await mountWidgetOrderComposable();

    // Verify custom positions loaded
    const hostBefore = state.layout.value.find((item) => item.i === 'host-status');
    expect(hostBefore?.x).toBe(customLayout.find((l) => l.i === 'host-status')!.x);

    // Reorder via drag-drop
    const reversed: DashboardWidgetId[] = [...DASHBOARD_WIDGET_IDS].reverse();
    state.widgetOrder.value = [...reversed];
    await nextTick();

    // Custom positions should be preserved for each widget
    for (const id of DASHBOARD_WIDGET_IDS) {
      const layoutItem = state.layout.value.find((item) => item.i === id);
      const original = customLayout.find((item) => item.i === id)!;
      expect(layoutItem?.x).toBe(original.x);
      expect(layoutItem?.y).toBe(original.y);
    }
  });

  it('leaves unknown layout items untouched when applying constraints', () => {
    const item = { i: 'unknown-widget', x: 1, y: 2, w: 3, h: 4 } as never;
    expect(applyConstraints([item])).toEqual([item]);
  });

  it('rebuilds a desktop layout when responsive layouts omit the lg breakpoint', () => {
    const mobileLayout = DASHBOARD_WIDGET_IDS.map((id, index) => ({
      i: id,
      x: 0,
      y: index,
      w: 1,
      h: 1,
    }));

    const rebuilt = _rebuildLayoutsForOrderForTests(DASHBOARD_WIDGET_IDS, {
      sm: mobileLayout,
    });

    expect(rebuilt.lg?.map((item) => item.i)).toEqual(DASHBOARD_WIDGET_IDS);
  });

  it('delegates responsive layout state to useDashboardResponsiveLayouts', async () => {
    const specDir = dirname(fileURLToPath(import.meta.url));
    const source = await readFile(
      resolve(specDir, '../../../src/views/dashboard/useDashboardWidgetOrder.ts'),
      'utf8',
    );

    expect(source).toContain("from './useDashboardResponsiveLayouts'");
  });

  describe('swap-on-drop (onGridItemMove / onGridItemMoved)', () => {
    it('swaps widget positions when a same-sized widget is dragged onto another', async () => {
      const { state } = await mountWidgetOrderComposable();
      state.editMode.value = true;
      await nextTick();

      // Default layout puts stat cards on the same row:
      //   stat-containers (0,0,3,3)  stat-security (3,0,3,3)
      const containers = state.layout.value.find((i) => i.i === 'stat-containers')!;
      const security = state.layout.value.find((i) => i.i === 'stat-security')!;
      const origContainersPos = { x: containers.x, y: containers.y };
      const origSecurityPos = { x: security.x, y: security.y };

      // 1. First `move` event captures the pre-drag snapshot
      state.onGridItemMove('stat-containers');

      // 2. Simulate grid-layout-plus push: dragged item takes the target's
      //    cell and the target is shoved down.
      containers.x = origSecurityPos.x;
      containers.y = origSecurityPos.y;
      security.y = 3; // pushed down by the library

      // 3. `moved` fires when drag ends – triggers swap via nextTick
      state.onGridItemMoved('stat-containers');
      await nextTick();
      await nextTick();

      // security should have been moved to containers' original position
      const updated = state.layout.value.find((i) => i.i === 'stat-security')!;
      expect(updated.x).toBe(origContainersPos.x);
      expect(updated.y).toBe(origContainersPos.y);
    });

    it('does nothing when the dragged item returns to its original position', async () => {
      const { state } = await mountWidgetOrderComposable();
      state.editMode.value = true;
      await nextTick();

      const containers = state.layout.value.find((i) => i.i === 'stat-containers')!;
      const origX = containers.x;
      const origY = containers.y;

      state.onGridItemMove('stat-containers');

      // Item didn't actually move
      state.onGridItemMoved('stat-containers');
      await nextTick();
      await nextTick();

      expect(containers.x).toBe(origX);
      expect(containers.y).toBe(origY);
    });

    it('does nothing when the dragged item lands on empty space (no swap target)', async () => {
      const { state } = await mountWidgetOrderComposable();
      state.editMode.value = true;
      await nextTick();

      const containers = state.layout.value.find((i) => i.i === 'stat-containers')!;
      const snapshotBefore = state.layout.value.map((i) => ({ i: i.i, x: i.x, y: i.y }));

      state.onGridItemMove('stat-containers');

      // Move to a position that doesn't overlap with any widget's original position
      containers.x = 0;
      containers.y = 50;

      state.onGridItemMoved('stat-containers');
      await nextTick();
      await nextTick();

      // No other item should have moved
      for (const before of snapshotBefore) {
        if (before.i === 'stat-containers') continue;
        const after = state.layout.value.find((i) => i.i === before.i)!;
        expect(after.x).toBe(before.x);
        expect(after.y).toBe(before.y);
      }
    });

    it('ignores subsequent move events after the first (only one snapshot per drag)', async () => {
      const { state } = await mountWidgetOrderComposable();
      state.editMode.value = true;
      await nextTick();

      const containers = state.layout.value.find((i) => i.i === 'stat-containers')!;
      const security = state.layout.value.find((i) => i.i === 'stat-security')!;
      const origContainersPos = { x: containers.x, y: containers.y };

      // First move captures snapshot
      state.onGridItemMove('stat-containers');

      // Simulate library modifying layout during drag
      containers.x = 3;
      security.y = 3;

      // Second move should be ignored (snapshot already captured)
      state.onGridItemMove('stat-containers');

      // The swap should still use the original positions from the first snapshot
      state.onGridItemMoved('stat-containers');
      await nextTick();
      await nextTick();

      const updated = state.layout.value.find((i) => i.i === 'stat-security')!;
      expect(updated.x).toBe(origContainersPos.x);
      expect(updated.y).toBe(origContainersPos.y);
    });

    it('does not swap when edit mode is off', async () => {
      const { state } = await mountWidgetOrderComposable();
      // editMode is false by default

      const containers = state.layout.value.find((i) => i.i === 'stat-containers')!;
      const security = state.layout.value.find((i) => i.i === 'stat-security')!;
      const origSecurityY = security.y;

      state.onGridItemMove('stat-containers');
      containers.x = 3;
      security.y = 3;
      state.onGridItemMoved('stat-containers');
      await nextTick();
      await nextTick();

      // security should NOT have been swapped (edit mode was off, so no snapshot)
      expect(security.y).toBe(3);
    });

    it('prevents swap when the displaced widget would overlap a third widget at the target position', async () => {
      const { state } = await mountWidgetOrderComposable();
      state.editMode.value = true;
      await nextTick();

      // Create a scenario where swap would cause overlap:
      // Widget A at (0,0,3,3), Widget B at (3,0,6,3), Widget C (blocker) at (0,3,3,3)
      const widgetA = state.layout.value.find((i) => i.i === 'stat-containers')!;
      const widgetB = state.layout.value.find((i) => i.i === 'recent-updates')!;
      const blocker = state.layout.value.find((i) => i.i === 'stat-security')!;

      widgetA.x = 0;
      widgetA.y = 0;
      widgetA.w = 3;
      widgetA.h = 3;

      widgetB.x = 3;
      widgetB.y = 0;
      widgetB.w = 6;
      widgetB.h = 3;

      blocker.x = 0;
      blocker.y = 0;
      blocker.w = 3;
      blocker.h = 3;

      // Move all other widgets far away so they don't interfere
      for (const item of state.layout.value) {
        if (!['stat-containers', 'recent-updates', 'stat-security'].includes(item.i)) {
          item.y = 100;
        }
      }

      await nextTick();

      state.onGridItemMove('stat-containers');

      // Simulate drag: widgetA moves to widgetB's position
      widgetA.x = 3;
      widgetA.y = 0;
      widgetB.y = 10; // pushed down by library

      // Swap would put widgetB at (0,0,6,3) which overlaps with blocker at (0,0,3,3)
      state.onGridItemMoved('stat-containers');
      await nextTick();
      await nextTick();

      // widgetB should NOT have been swapped (would overlap blocker)
      expect(widgetB.y).toBe(10); // stays where the library pushed it
    });

    it('does not swap with hidden widgets', async () => {
      const { state } = await mountWidgetOrderComposable();
      state.editMode.value = true;
      state.toggleWidgetVisibility('stat-security'); // hide it
      await nextTick();

      const containers = state.layout.value.find((i) => i.i === 'stat-containers')!;
      const security = state.layout.value.find((i) => i.i === 'stat-security')!;

      state.onGridItemMove('stat-containers');

      // Drag containers to security's original position
      containers.x = security.x;
      containers.y = security.y;
      security.y = 3; // pushed

      state.onGridItemMoved('stat-containers');
      await nextTick();
      await nextTick();

      // security is hidden, so it should NOT be swapped
      expect(security.y).toBe(3);
    });
  });
});
