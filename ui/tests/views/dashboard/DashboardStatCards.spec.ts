import { enableAutoUnmount, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import * as draggable from 'vue-draggable-plus';
import DashboardStatCards from '@/views/dashboard/components/DashboardStatCards.vue';
import type { DashboardStatCard, WidgetOrderItem } from '@/views/dashboard/dashboardTypes';

vi.mock('vue-draggable-plus', { spy: true });

enableAutoUnmount(afterEach);

const stats: DashboardStatCard[] = [
  {
    id: 'stat-containers',
    label: 'Containers',
    value: '2',
    icon: 'docker',
    color: 'blue',
    colorMuted: 'gray',
    route: '/containers',
  },
  {
    id: 'stat-updates',
    label: 'Updates',
    value: '1',
    icon: 'update',
    color: 'green',
    colorMuted: 'gray',
  },
];

function mountCards(editMode = true) {
  const adapter = vi.mocked(draggable.useDraggable);
  const order: WidgetOrderItem[] = [{ id: 'stat-containers' }, { id: 'stat-updates' }];
  const wrapper = mount(DashboardStatCards, {
    props: { editMode, isWidgetVisible: () => true, statOrder: order, stats },
    global: { stubs: { AppIcon: true } },
  });
  const instance = adapter.mock.results.at(-1)?.value;
  if (!instance) throw new Error('The real drag adapter did not initialize');
  return { wrapper, order, instance };
}

afterEach(() => vi.restoreAllMocks());

describe('DashboardStatCards', () => {
  it('emits a reordered list through the real drag adapter without mutating its prop', async () => {
    const { wrapper, order, instance } = mountCards();
    await nextTick();
    const grid = wrapper.element;
    const item = wrapper.findAll('.stat-card')[0].element;
    grid.appendChild(item);
    const update = instance.option('onUpdate');
    expect(() =>
      update({
        from: grid,
        to: grid,
        item,
        oldIndex: 0,
        oldDraggableIndex: 0,
        newIndex: 1,
        newDraggableIndex: 1,
      }),
    ).not.toThrow();
    expect(wrapper.emitted('update:statOrder')).toEqual([
      [[{ id: 'stat-updates' }, { id: 'stat-containers' }]],
    ]);
    expect(order).toEqual([{ id: 'stat-containers' }, { id: 'stat-updates' }]);
  });

  it('uses refreshed parent order for the next drag', async () => {
    const { wrapper, instance } = mountCards();
    const refreshed: WidgetOrderItem[] = [{ id: 'stat-updates' }, { id: 'stat-containers' }];
    await wrapper.setProps({ statOrder: refreshed });
    expect(wrapper.findAll('.stat-card').map((card) => card.attributes('aria-label'))).toEqual([
      'Updates: 1',
      'Containers: 2',
    ]);
    const grid = wrapper.element;
    const item = wrapper.findAll('.stat-card')[0].element;
    grid.appendChild(item);
    const update = instance.option('onUpdate');
    expect(() =>
      update({
        from: grid,
        to: grid,
        item,
        oldIndex: 0,
        oldDraggableIndex: 0,
        newIndex: 1,
        newDraggableIndex: 1,
      }),
    ).not.toThrow();
    expect(wrapper.emitted('update:statOrder')).toEqual([
      [[{ id: 'stat-containers' }, { id: 'stat-updates' }]],
    ]);
    expect(refreshed).toEqual([{ id: 'stat-updates' }, { id: 'stat-containers' }]);
  });

  it('reactively disables dragging outside edit mode and retains the drag handle restriction', async () => {
    const { wrapper, instance } = mountCards(false);
    await nextTick();
    expect(instance.option('disabled')).toBe(true);
    expect(instance.option('handle')).toBe('.drag-handle');
    expect(wrapper.find('.drag-handle').exists()).toBe(false);
    await wrapper.setProps({ editMode: true });
    expect(instance.option('disabled')).toBe(false);
    expect(wrapper.findAll('.drag-handle')).toHaveLength(2);
    await wrapper.setProps({ editMode: false });
    expect(instance.option('disabled')).toBe(true);
  });

  it('navigates only routed cards outside edit mode', async () => {
    const { wrapper } = mountCards(false);
    await wrapper.findAll('.stat-card')[0].trigger('click');
    expect(wrapper.emitted('navigate')).toEqual([['/containers']]);
    await wrapper.findAll('.stat-card')[1].trigger('click');
    await wrapper.setProps({ editMode: true });
    await wrapper.findAll('.stat-card')[0].trigger('click');
    expect(wrapper.emitted('navigate')).toHaveLength(1);
  });
});
