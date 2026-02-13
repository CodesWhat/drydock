import { mount } from '@vue/test-utils';
import ConfigurationWatchersView from '@/views/ConfigurationWatchersView';

vi.mock('@/services/watcher', () => ({
  getAllWatchers: vi.fn(() =>
    Promise.resolve([
      { name: 'watcher1', type: 'docker', cron: '0 * * * *' },
      { name: 'watcher2', type: 'docker', cron: '0 0 * * *' },
    ]),
  ),
  getWatcherProviderIcon: vi.fn((type) => {
    switch (type) {
      case 'docker':
        return 'fab fa-docker';
      default:
        return 'fas fa-eye';
    }
  }),
  getWatcherProviderColor: vi.fn(() => '#6B7280'),
}));

describe('ConfigurationWatchersView', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mount(ConfigurationWatchersView);
    await wrapper.setData({
      watchers: [
        { name: 'watcher1', type: 'docker', cron: '0 * * * *' },
        { name: 'watcher2', type: 'docker', cron: '0 0 * * *' },
      ],
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders a row for each watcher', () => {
    const rows = wrapper.findAll('.mb-3');
    expect(rows).toHaveLength(2);
  });

  it('displays empty message when no watchers', async () => {
    await wrapper.setData({ watchers: [] });
    expect(wrapper.text()).toContain('No watchers configured');
  });
});

describe('ConfigurationWatchersView Route Hook', () => {
  it('fetches watchers on beforeRouteEnter', async () => {
    const next = vi.fn();
    await ConfigurationWatchersView.beforeRouteEnter.call(ConfigurationWatchersView, {}, {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(Function));

    const vm = { watchers: [] };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.watchers).toHaveLength(2);
    expect(vm.watchers[0].name).toBe('watcher1');
  });

  it('emits error notification on failure', async () => {
    const { getAllWatchers } = await import('@/services/watcher');
    (getAllWatchers as any).mockRejectedValueOnce(new Error('Watcher error'));

    const next = vi.fn();
    await ConfigurationWatchersView.beforeRouteEnter.call(ConfigurationWatchersView, {}, {}, next);

    const vm = { $eventBus: { emit: vi.fn() } };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      expect.stringContaining('Watcher error'),
      'error',
    );
  });
});
