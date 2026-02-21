import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { useDisplay } from 'vuetify';
import NavigationDrawer from '@/components/NavigationDrawer.vue';
import { getAppInfos } from '@/services/app';

// Mock all icon services
vi.mock('@/services/container', () => ({ getContainerIcon: vi.fn(() => 'fab fa-docker') }));
vi.mock('@/services/registry', () => ({ getRegistryIcon: vi.fn(() => 'fas fa-database') }));
vi.mock('@/services/trigger', () => ({ getTriggerIcon: vi.fn(() => 'fas fa-bell') }));
vi.mock('@/services/server', () => ({ getServerIcon: vi.fn(() => 'fas fa-server') }));
vi.mock('@/services/watcher', () => ({ getWatcherIcon: vi.fn(() => 'fas fa-arrows-rotate') }));
vi.mock('@/services/authentication', () => ({ getAuthenticationIcon: vi.fn(() => 'fas fa-lock') }));
vi.mock('@/services/agent', () => ({ getAgentIcon: vi.fn(() => 'fas fa-network-wired') }));
vi.mock('@/services/log', () => ({ getLogIcon: vi.fn(() => 'fas fa-terminal') }));
vi.mock('@/services/app', () => ({
  getAppInfos: vi.fn(() => Promise.resolve({ version: '1.2.3' })),
}));

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
  'v-list-group': {
    template: '<div class="v-list-group"><slot /><slot name="activator" :props="{}" /></div>',
  },
  'v-navigation-drawer': {
    template: '<div class="v-navigation-drawer"><slot /><slot name="append" /></div>',
    props: ['modelValue'],
  },
  'router-link': { template: '<a><slot /></a>' },
};

describe('NavigationDrawer', () => {
  let wrapper;

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useDisplay as any).mockReturnValue({
      smAndDown: ref(false),
    } as any);
    vi.mocked(getAppInfos).mockClear();
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
    const names = sorted.map((i) => i.name);
    expect(names).toEqual(['agents', 'auth', 'registries', 'servers', 'triggers', 'watchers']);
  });

  it('has correct container icon', () => {
    expect(wrapper.vm.containerIcon).toBe('fab fa-docker');
  });

  it('contains configuration items with correct routes', () => {
    const items = wrapper.vm.configurationItems;
    const routes = items.map((i) => i.to);
    expect(routes).toContain('/configuration/agents');
    expect(routes).toContain('/configuration/registries');
    expect(routes).toContain('/configuration/triggers');
    expect(routes).toContain('/configuration/watchers');
    expect(routes).toContain('/configuration/server');
    expect(routes).toContain('/configuration/authentications');
  });

  it('has monitoring items with correct routes', () => {
    const items = wrapper.vm.monitoringItems;
    const routes = items.map((i) => i.to);
    expect(routes).toContain('/monitoring/history');
    expect(routes).toContain('/configuration/logs');
  });

  it('loads app version on mount', async () => {
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    expect(getAppInfos).toHaveBeenCalled();
    expect(wrapper.vm.version).toBe('1.2.3');
  });

  it('falls back to unknown version when API returns no version field', async () => {
    if (wrapper) wrapper.unmount();
    vi.mocked(getAppInfos).mockResolvedValueOnce({} as any);

    wrapper = mount(NavigationDrawer, {
      global: { stubs },
    });
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.version).toBe('unknown');
  });

  it('falls back to unknown version when app info call fails', async () => {
    if (wrapper) wrapper.unmount();
    vi.mocked(getAppInfos).mockRejectedValueOnce(new Error('fetch failed'));

    wrapper = mount(NavigationDrawer, {
      global: { stubs },
    });
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.version).toBe('unknown');
  });

  it('toggleDrawer toggles mini mode on desktop', async () => {
    expect(wrapper.vm.mini).toBe(false);
    wrapper.vm.toggleDrawer();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.mini).toBe(true);
  });

  it('toggleDrawer emits model update on mobile', async () => {
    if (wrapper) wrapper.unmount();
    vi.mocked(useDisplay as any).mockReturnValue({
      smAndDown: ref(true),
    } as any);

    wrapper = mount(NavigationDrawer, {
      props: {
        modelValue: true,
      },
      global: { stubs },
    });

    wrapper.vm.toggleDrawer();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
  });

  it('drawerModel getter follows modelValue on mobile and forces open on desktop', async () => {
    if (wrapper) wrapper.unmount();
    vi.mocked(useDisplay as any).mockReturnValue({
      smAndDown: ref(true),
    } as any);
    wrapper = mount(NavigationDrawer, {
      props: {
        modelValue: false,
      },
      global: { stubs },
    });
    expect(wrapper.vm.drawerModel).toBe(false);

    if (wrapper) wrapper.unmount();
    vi.mocked(useDisplay as any).mockReturnValue({
      smAndDown: ref(false),
    } as any);
    wrapper = mount(NavigationDrawer, {
      props: {
        modelValue: false,
      },
      global: { stubs },
    });
    expect(wrapper.vm.drawerModel).toBe(true);
  });

  it('drawerModel setter emits update:modelValue', () => {
    wrapper.vm.drawerModel = false;
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
  });

  it('updates drawerModel from template v-model event on v-navigation-drawer', async () => {
    if (wrapper) wrapper.unmount();
    vi.mocked(useDisplay as any).mockReturnValue({
      smAndDown: ref(true),
    } as any);

    wrapper = mount(NavigationDrawer, {
      props: {
        modelValue: true,
      },
      global: {
        stubs: {
          ...stubs,
          'v-navigation-drawer': {
            template:
              '<div class="v-navigation-drawer" @click="$emit(\'update:modelValue\', false)"><slot /><slot name="append" /></div>',
            props: ['modelValue'],
            emits: ['update:modelValue'],
          },
        },
      },
    });

    await wrapper.find('.v-navigation-drawer').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });

  it('hides brand text and version in desktop rail mode', async () => {
    wrapper.vm.mini = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.drawer-brand').classes()).toContain('drawer-brand--rail');
    expect(wrapper.find('.drawer-brand-text').exists()).toBe(false);
    expect(wrapper.find('.drawer-version').exists()).toBe(false);
  });

  it('shows brand text on mobile and hides collapse button', async () => {
    if (wrapper) wrapper.unmount();
    vi.mocked(useDisplay as any).mockReturnValue({
      smAndDown: ref(true),
    } as any);

    wrapper = mount(NavigationDrawer, {
      props: {
        modelValue: true,
      },
      global: { stubs },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.drawer-brand-text').exists()).toBe(true);
    expect(wrapper.find('.drawer-collapse-btn').exists()).toBe(false);
  });
});
