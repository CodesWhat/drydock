import { mount } from '@vue/test-utils';
import ConfigurationRegistriesView from '@/views/ConfigurationRegistriesView';

vi.mock('@/services/registry', () => ({
  getAllRegistries: vi.fn(() => Promise.resolve([
    { id: 'registry-b', type: 'hub', name: 'Docker Hub' },
    { id: 'registry-a', type: 'ghcr', name: 'GitHub' },
  ])),
  getRegistryProviderIcon: vi.fn((type) => {
    const icons = { hub: 'si-docker', ghcr: 'si-github' };
    return icons[type] || 'si-linuxcontainers';
  }),
}));

describe('ConfigurationRegistriesView', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mount(ConfigurationRegistriesView);
    await wrapper.setData({
      registries: [
        { id: 'registry-a', type: 'ghcr', name: 'GitHub', icon: 'si-github' },
        { id: 'registry-b', type: 'hub', name: 'Docker Hub', icon: 'si-docker' },
      ],
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders a row for each registry', () => {
    const rows = wrapper.findAll('.v-row');
    expect(rows).toHaveLength(2);
  });

  it('displays empty message when no registries', async () => {
    await wrapper.setData({ registries: [] });
    expect(wrapper.text()).toContain('No registries configured');
  });
});

describe('ConfigurationRegistriesView Route Hook', () => {
  it('fetches registries and sorts by id on beforeRouteEnter', async () => {
    const next = vi.fn();
    await ConfigurationRegistriesView.beforeRouteEnter.call(
      ConfigurationRegistriesView, {}, {}, next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(Function));

    const vm = { registries: [] };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.registries).toHaveLength(2);
    // Should be sorted by id
    expect(vm.registries[0].id).toBe('registry-a');
    expect(vm.registries[1].id).toBe('registry-b');
    // Should have icons
    expect(vm.registries[0].icon).toBe('si-github');
    expect(vm.registries[1].icon).toBe('si-docker');
  });

  it('emits error notification on failure', async () => {
    const { getAllRegistries } = await import('@/services/registry');
    (getAllRegistries as any).mockRejectedValueOnce(new Error('Registry error'));

    const next = vi.fn();
    await ConfigurationRegistriesView.beforeRouteEnter.call(
      ConfigurationRegistriesView, {}, {}, next,
    );

    const vm = { $eventBus: { emit: vi.fn() } };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      expect.stringContaining('Registry error'),
      'error',
    );
  });
});
