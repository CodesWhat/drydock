import { mount } from '@vue/test-utils';
import ConfigurationAuthenticationsView from '@/views/ConfigurationAuthenticationsView';

vi.mock('@/services/authentication', () => ({
  getAllAuthentications: vi.fn(() =>
    Promise.resolve([
      { id: 'auth1', type: 'basic', name: 'Docker Hub' },
      { id: 'auth2', type: 'token', name: 'GHCR' },
    ]),
  ),
  getAuthProviderIcon: vi.fn((type) => {
    switch (type) {
      case 'basic':
        return 'fas fa-key';
      default:
        return 'fas fa-lock';
    }
  }),
  getAuthProviderColor: vi.fn(() => '#6B7280'),
}));

describe('ConfigurationAuthenticationsView', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mount(ConfigurationAuthenticationsView);
    await wrapper.setData({
      authentications: [
        { id: 'auth1', type: 'basic', name: 'Docker Hub' },
        { id: 'auth2', type: 'token', name: 'GHCR' },
      ],
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders a row for each authentication', () => {
    const rows = wrapper.findAll('.mb-3');
    expect(rows).toHaveLength(2);
  });

  it('displays empty message when no authentications', async () => {
    await wrapper.setData({ authentications: [] });
    expect(wrapper.text()).toContain('No authentication configured');
  });
});

describe('ConfigurationAuthenticationsView Route Hook', () => {
  it('fetches authentications on beforeRouteEnter', async () => {
    const next = vi.fn();
    await ConfigurationAuthenticationsView.beforeRouteEnter.call(
      ConfigurationAuthenticationsView,
      {},
      {},
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(Function));

    const vm = { authentications: [] };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.authentications).toHaveLength(2);
    expect(vm.authentications[0].id).toBe('auth1');
  });

  it('emits error notification on failure', async () => {
    const { getAllAuthentications } = await import('@/services/authentication');
    (getAllAuthentications as any).mockRejectedValueOnce(new Error('Auth error'));

    const next = vi.fn();
    await ConfigurationAuthenticationsView.beforeRouteEnter.call(
      ConfigurationAuthenticationsView,
      {},
      {},
      next,
    );

    const vm = { $eventBus: { emit: vi.fn() } };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      expect.stringContaining('Auth error'),
      'error',
    );
  });
});
