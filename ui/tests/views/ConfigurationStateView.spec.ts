import { mount } from '@vue/test-utils';
import ConfigurationStateView from '@/views/ConfigurationStateView';

vi.mock('@/services/store', () => ({
  getStore: vi.fn(() => Promise.resolve({
    configuration: { path: '/data/store.json' },
  })),
}));

describe('ConfigurationStateView', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mount(ConfigurationStateView);
    await wrapper.setData({
      state: { configuration: { path: '/data/store.json' } },
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders the configuration item', () => {
    const container = wrapper.find('.v-container');
    expect(container.exists()).toBe(true);
  });

  it('computes configurationItem correctly', () => {
    const item = wrapper.vm.configurationItem;
    expect(item.name).toBe('state');
    expect(item.icon).toBe('mdi-content-save');
    expect(item.configuration).toEqual({ path: '/data/store.json' });
  });

  it('updates configurationItem when state changes', async () => {
    await wrapper.setData({
      state: { configuration: { path: '/new/path.json' } },
    });
    expect(wrapper.vm.configurationItem.configuration).toEqual({ path: '/new/path.json' });
  });
});

describe('ConfigurationStateView Route Hook', () => {
  it('fetches store on beforeRouteEnter', async () => {
    const next = vi.fn();
    await ConfigurationStateView.beforeRouteEnter.call(
      ConfigurationStateView, {}, {}, next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(Function));

    const vm = { state: {} };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.state).toEqual({ configuration: { path: '/data/store.json' } });
  });

  it('emits error notification on failure', async () => {
    const { getStore } = await import('@/services/store');
    (getStore as any).mockRejectedValueOnce(new Error('Store error'));

    const next = vi.fn();
    await ConfigurationStateView.beforeRouteEnter.call(
      ConfigurationStateView, {}, {}, next,
    );

    const vm = { $eventBus: { emit: vi.fn() } };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      expect.stringContaining('Store error'),
      'error',
    );
  });
});
