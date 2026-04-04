import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { preferences } from '@/preferences/store';
import { DASHBOARD_WIDGET_IDS, type DashboardWidgetId } from '@/views/dashboard/dashboardTypes';
import { applyConstraints } from '@/views/dashboard/dashboardWidgetLayout';
import {
  _rebuildLayoutsForOrderForTests,
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
});
