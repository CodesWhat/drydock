import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { preferences } from '@/preferences/store';
import { DASHBOARD_WIDGET_IDS } from '@/views/dashboard/dashboardTypes';
import { useDashboardWidgetOrder } from '@/views/dashboard/useDashboardWidgetOrder';

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
        getData: () => 'not-a-dashboard-widget',
      },
    } as unknown as DragEvent);
    expect(state.draggedWidgetId.value).toBeNull();

    state.onWidgetDragEnd();
    expect(state.draggedWidgetId.value).toBeNull();

    state.resetWidgetOrder();
    expect(state.widgetOrder.value).toEqual(DASHBOARD_WIDGET_IDS);
  });
});
