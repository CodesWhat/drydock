import { mount } from '@vue/test-utils';
import ConfigurationLogsView from '@/views/ConfigurationLogsView';

vi.mock('@/services/log', () => ({
  getLog: vi.fn(() => Promise.resolve({ level: 'info' })),
}));

describe('ConfigurationLogsView', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mount(ConfigurationLogsView);
    await wrapper.setData({ log: { level: 'info' } });
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
    expect(item.type).toBe('logs');
    expect(item.name).toBe('configuration');
    expect(item.icon).toBe('fas fa-terminal');
    expect(item.configuration.level).toBe('info');
  });

  it('updates configurationItem when log data changes', async () => {
    await wrapper.setData({ log: { level: 'debug' } });
    expect(wrapper.vm.configurationItem.configuration.level).toBe('debug');
  });
});

describe('ConfigurationLogsView Route Hook', () => {
  it('fetches log config on beforeRouteEnter', async () => {
    const next = vi.fn();
    await ConfigurationLogsView.beforeRouteEnter.call(ConfigurationLogsView, {}, {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(Function));

    const vm = { log: {} };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.log).toEqual({ level: 'info' });
  });

  it('emits error notification on failure', async () => {
    const { getLog } = await import('@/services/log');
    (getLog as any).mockRejectedValueOnce(new Error('Log error'));

    const next = vi.fn();
    await ConfigurationLogsView.beforeRouteEnter.call(ConfigurationLogsView, {}, {}, next);

    const vm = { $eventBus: { emit: vi.fn() } };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      expect.stringContaining('Log error'),
      'error',
    );
  });
});
