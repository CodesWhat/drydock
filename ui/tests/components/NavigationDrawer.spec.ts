import { mount } from '@vue/test-utils';
import NavigationDrawer from '@/components/NavigationDrawer';

// Mock all icon services
vi.mock('@/services/container', () => ({ getContainerIcon: vi.fn(() => 'fab fa-docker') }));
vi.mock('@/services/registry', () => ({ getRegistryIcon: vi.fn(() => 'fas fa-database') }));
vi.mock('@/services/trigger', () => ({ getTriggerIcon: vi.fn(() => 'fas fa-bell') }));
vi.mock('@/services/server', () => ({ getServerIcon: vi.fn(() => 'fas fa-server') }));
vi.mock('@/services/watcher', () => ({ getWatcherIcon: vi.fn(() => 'fas fa-arrows-rotate') }));
vi.mock('@/services/authentication', () => ({ getAuthenticationIcon: vi.fn(() => 'fas fa-lock') }));
vi.mock('@/services/agent', () => ({ getAgentIcon: vi.fn(() => 'fas fa-network-wired') }));
vi.mock('@/services/log', () => ({ getLogIcon: vi.fn(() => 'fas fa-terminal') }));

// Mock vuetify useTheme and useDisplay
vi.mock('vuetify', async () => {
  const actual = await vi.importActual('vuetify');
  return {
    ...actual,
    useTheme: vi.fn(() => ({
      global: { name: { value: 'light' } },
    })),
    useDisplay: vi.fn(() => ({
      smAndDown: { value: false },
    })),
  };
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const stubs = {
  'v-fade-transition': { template: '<div><slot /></div>' },
  'v-list-group': { template: '<div class="v-list-group"><slot /><slot name="activator" :props="{}" /></div>' },
  'router-link': { template: '<a><slot /></a>' },
  'img': true,
};

describe('NavigationDrawer', () => {
  let wrapper;

  beforeEach(() => {
    localStorage.clear();
    wrapper = mount(NavigationDrawer, {
      global: { stubs },
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders navigation drawer', () => {
    expect(wrapper.exists()).toBe(true);
  });

  it('starts with mini mode disabled', () => {
    expect(wrapper.vm.mini).toBe(false);
  });

  it('has configuration items sorted alphabetically', () => {
    const sorted = wrapper.vm.configurationItemsSorted;
    const names = sorted.map(i => i.name);
    expect(names).toEqual(['agents', 'auth', 'registries', 'server', 'triggers', 'watchers']);
  });

  it('has correct container icon', () => {
    expect(wrapper.vm.containerIcon).toBe('fab fa-docker');
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

  it('has monitoring items with correct routes', () => {
    const items = wrapper.vm.monitoringItems;
    const routes = items.map(i => i.to);
    expect(routes).toContain('/monitoring/history');
    expect(routes).toContain('/configuration/logs');
  });

  it('defaults to system theme mode', () => {
    expect(wrapper.vm.themeMode).toBe('system');
  });

  it('starts with darkMode false when system prefers light', () => {
    expect(wrapper.vm.darkMode).toBe(false);
  });

  it('migrates legacy darkMode to themeMode', () => {
    localStorage.darkMode = 'true';
    const w = mount(NavigationDrawer, {
      global: { stubs },
    });
    expect(w.vm.themeMode).toBe('dark');
    expect(localStorage.themeMode).toBe('dark');
    expect(localStorage.darkMode).toBeUndefined();
    w.unmount();
  });

  it('onThemeModeChange updates themeMode and localStorage', () => {
    wrapper.vm.onThemeModeChange('dark');
    expect(wrapper.vm.themeMode).toBe('dark');
    expect(localStorage.themeMode).toBe('dark');
    expect(wrapper.vm.darkMode).toBe(true);

    wrapper.vm.onThemeModeChange('light');
    expect(wrapper.vm.themeMode).toBe('light');
    expect(localStorage.themeMode).toBe('light');
    expect(wrapper.vm.darkMode).toBe(false);

    wrapper.vm.onThemeModeChange('system');
    expect(wrapper.vm.themeMode).toBe('system');
    expect(localStorage.themeMode).toBe('system');
  });
});
