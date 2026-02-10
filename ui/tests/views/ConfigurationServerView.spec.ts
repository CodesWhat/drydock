import { mount } from '@vue/test-utils';
import ConfigurationServerView from '@/views/ConfigurationServerView';

vi.mock('@/services/server', () => ({
  getServer: vi.fn(() => Promise.resolve({
    configuration: { port: 3000, host: '0.0.0.0' },
  })),
}));

vi.mock('@/services/log', () => ({
  getLog: vi.fn(() => Promise.resolve({ level: 'info' })),
}));

vi.mock('@/services/store', () => ({
  getStore: vi.fn(() => Promise.resolve({
    configuration: { path: '/store' },
  })),
}));

describe('ConfigurationServerView', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mount(ConfigurationServerView);
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
    const rows = wrapper.findAll('.v-row');
    expect(rows).toHaveLength(3);
  });

  it('computes serverConfiguration correctly', () => {
    const config = wrapper.vm.serverConfiguration;
    expect(config.type).toBe('server');
    expect(config.name).toBe('configuration');
    expect(config.icon).toBe('mdi-connection');
    expect(config.configuration).toEqual({ port: 3000, host: '0.0.0.0' });
  });

  it('computes logConfiguration correctly', () => {
    const config = wrapper.vm.logConfiguration;
    expect(config.type).toBe('logs');
    expect(config.name).toBe('configuration');
    expect(config.icon).toBe('mdi-bug');
    expect(config.configuration).toEqual({ level: 'info' });
  });

  it('computes storeConfiguration correctly', () => {
    const config = wrapper.vm.storeConfiguration;
    expect(config.type).toBe('store');
    expect(config.name).toBe('configuration');
    expect(config.icon).toBe('mdi-file-multiple');
    expect(config.configuration).toEqual({ path: '/store' });
  });
});

describe('ConfigurationServerView Route Hook', () => {
  it('fetches server, store, and log on beforeRouteEnter', async () => {
    const next = vi.fn();
    await ConfigurationServerView.beforeRouteEnter.call(
      ConfigurationServerView, {}, {}, next,
    );
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
    await ConfigurationServerView.beforeRouteEnter.call(
      ConfigurationServerView, {}, {}, next,
    );

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
