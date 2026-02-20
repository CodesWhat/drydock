import { mount } from '@vue/test-utils';
import ConfigurationServerView from '@/views/ConfigurationServerView';

vi.mock('@/services/server', () => ({
  getServer: vi.fn(() =>
    Promise.resolve({
      configuration: { port: 3000, host: '0.0.0.0' },
    }),
  ),
}));

vi.mock('@/services/log', () => ({
  getLog: vi.fn(() => Promise.resolve({ level: 'info' })),
}));

vi.mock('@/services/store', () => ({
  getStore: vi.fn(() =>
    Promise.resolve({
      configuration: { path: '/store' },
    }),
  ),
}));

describe('ConfigurationServerView', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mount(ConfigurationServerView, {
      global: {
        stubs: {
          'webhook-info': {
            template: '<div class="webhook-info"></div>',
            props: ['enabled', 'baseUrl'],
          },
        },
      },
    });
    await wrapper.setData({
      server: { configuration: { port: 3000, host: '0.0.0.0' } },
      log: { level: 'info' },
      store: { configuration: { path: '/store' } },
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders three configuration items', () => {
    const rows = wrapper.findAll('.mb-3');
    expect(rows).toHaveLength(3);
  });

  it('computes serverConfiguration correctly', () => {
    const config = wrapper.vm.serverConfiguration;
    expect(config.type).toBe('server');
    expect(config.name).toBe('configuration');
    expect(config.icon).toBe('fas fa-gear');
    expect(config.configuration).toEqual({ port: 3000, host: '0.0.0.0' });
  });

  it('computes logConfiguration correctly', () => {
    const config = wrapper.vm.logConfiguration;
    expect(config.type).toBe('logs');
    expect(config.name).toBe('configuration');
    expect(config.icon).toBe('fas fa-file-lines');
    expect(config.configuration).toEqual({ level: 'info' });
  });

  it('computes storeConfiguration correctly', () => {
    const config = wrapper.vm.storeConfiguration;
    expect(config.type).toBe('store');
    expect(config.name).toBe('configuration');
    expect(config.icon).toBe('fas fa-copy');
    expect(config.configuration).toEqual({ path: '/store' });
  });

  it('renders webhook-info component', () => {
    expect(wrapper.find('.webhook-info').exists()).toBe(true);
  });

  it('computes webhookEnabled as false when webhook config is missing', () => {
    expect(wrapper.vm.webhookEnabled).toBe(false);
  });

  it('computes webhookEnabled as true when webhook is enabled', async () => {
    await wrapper.setData({
      server: { configuration: { port: 3000, webhook: { enabled: true } } },
    });
    expect(wrapper.vm.webhookEnabled).toBe(true);
  });

  it('computes webhookEnabled as false when webhook is explicitly disabled', async () => {
    await wrapper.setData({
      server: { configuration: { port: 3000, webhook: { enabled: false } } },
    });
    expect(wrapper.vm.webhookEnabled).toBe(false);
  });

  it('computes webhookBaseUrl from window.location.origin', () => {
    expect(wrapper.vm.webhookBaseUrl).toBe(window.location.origin);
  });
});

describe('ConfigurationServerView Route Hook', () => {
  it('fetches server, store, and log on beforeRouteEnter', async () => {
    const next = vi.fn();
    await ConfigurationServerView.beforeRouteEnter.call(ConfigurationServerView, {}, {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(Function));

    const vm = { server: {}, store: {}, log: {} };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.server).toEqual({ configuration: { port: 3000, host: '0.0.0.0' } });
    expect(vm.store).toEqual({ configuration: { path: '/store' } });
    expect(vm.log).toEqual({ level: 'info' });
  });

  it('emits error notification on failure', async () => {
    const { getServer } = await import('@/services/server');
    (getServer as any).mockRejectedValueOnce(new Error('Server error'));

    const next = vi.fn();
    await ConfigurationServerView.beforeRouteEnter.call(ConfigurationServerView, {}, {}, next);

    const vm = { $eventBus: { emit: vi.fn() } };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      expect.stringContaining('Server error'),
      'error',
    );
  });
});
