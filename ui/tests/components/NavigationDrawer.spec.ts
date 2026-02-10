import { mount } from '@vue/test-utils';
import NavigationDrawer from '@/components/NavigationDrawer';

// Mock all icon services
vi.mock('@/services/container', () => ({ getContainerIcon: vi.fn(() => 'mdi-docker') }));
vi.mock('@/services/registry', () => ({ getRegistryIcon: vi.fn(() => 'mdi-database-search') }));
vi.mock('@/services/trigger', () => ({ getTriggerIcon: vi.fn(() => 'mdi-bell-ring') }));
vi.mock('@/services/server', () => ({ getServerIcon: vi.fn(() => 'mdi-connection') }));
vi.mock('@/services/watcher', () => ({ getWatcherIcon: vi.fn(() => 'mdi-update') }));
vi.mock('@/services/authentication', () => ({ getAuthenticationIcon: vi.fn(() => 'mdi-lock') }));
vi.mock('@/services/agent', () => ({ getAgentIcon: vi.fn(() => 'mdi-lan') }));

// Mock vuetify useTheme
vi.mock('vuetify', async () => {
  const actual = await vi.importActual('vuetify');
  return {
    ...actual,
    useTheme: vi.fn(() => ({
      global: { name: { value: 'light' } },
    })),
  };
});

describe('NavigationDrawer', () => {
  let wrapper;

  beforeEach(() => {
    localStorage.clear();
    wrapper = mount(NavigationDrawer, {
      global: {
        stubs: {
          'v-fade-transition': { template: '<div><slot /></div>' },
          'v-list-group': { template: '<div class="v-list-group"><slot /><slot name="activator" :props="{}" /></div>' },
          'router-link': { template: '<a><slot /></a>' },
          'img': true,
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders navigation drawer', () => {
    expect(wrapper.exists()).toBe(true);
  });

  it('starts with mini mode enabled', () => {
    expect(wrapper.vm.mini).toBe(true);
  });

  it('has configuration items sorted alphabetically', () => {
    const sorted = wrapper.vm.configurationItemsSorted;
    const names = sorted.map(i => i.name);
    expect(names).toEqual(['agents', 'auth', 'registries', 'server', 'triggers', 'watchers']);
  });

  it('has correct container icon', () => {
    expect(wrapper.vm.containerIcon).toBe('mdi-docker');
  });

  it('contains configuration items with correct routes', () => {
    const items = wrapper.vm.configurationItems;
    const routes = items.map(i => i.to);
    expect(routes).toContain('/configuration/agents');
    expect(routes).toContain('/configuration/registries');
    expect(routes).toContain('/configuration/triggers');
    expect(routes).toContain('/configuration/watchers');
    expect(routes).toContain('/configuration/server');
    expect(routes).toContain('/configuration/authentications');
  });

  it('starts with darkMode false by default', () => {
    expect(wrapper.vm.darkMode).toBe(false);
  });

  it('reads darkMode from localStorage', () => {
    localStorage.darkMode = 'true';
    const w = mount(NavigationDrawer, {
      global: {
        stubs: {
          'v-fade-transition': { template: '<div><slot /></div>' },
          'v-list-group': { template: '<div class="v-list-group"><slot /><slot name="activator" :props="{}" /></div>' },
          'img': true,
        },
      },
    });
    expect(w.vm.darkMode).toBe(true);
    w.unmount();
  });

  it('toggleDarkMode updates darkMode and localStorage', () => {
    wrapper.vm.toggleDarkMode(true);
    expect(wrapper.vm.darkMode).toBe(true);
    expect(localStorage.darkMode).toBe('true');

    wrapper.vm.toggleDarkMode(false);
    expect(wrapper.vm.darkMode).toBe(false);
    expect(localStorage.darkMode).toBe('false');
  });
});
