import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { loadServerConfig, setupAuthStateManagement, setupEventBusListeners } from '@/App';
import App from '@/App.vue';
import { getServer } from '@/services/server';

// Mock services
vi.mock('@/services/server', () => ({
  getServer: vi.fn(() => Promise.resolve({ configuration: { feature: { delete: true } } })),
  getServerIcon: vi.fn(() => 'fas fa-server'),
}));

vi.mock('@/services/sse', () => ({
  default: { connect: vi.fn(), disconnect: vi.fn() },
}));

const routeState = reactive({
  fullPath: '/containers',
  name: 'containers',
  path: '/containers',
  query: {},
  params: {},
});

vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => routeState),
}));

// Mock fetch
global.fetch = vi.fn();

describe('App.vue', () => {
  let wrapper;
  const mockEventBus = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(fetch).mockClear();
    vi.mocked(getServer).mockClear();
    mockEventBus.emit.mockClear();
    mockEventBus.on.mockClear();
    routeState.fullPath = '/containers';
    routeState.name = 'containers';
    routeState.path = '/containers';
    routeState.query = {};
    routeState.params = {};

    wrapper = mount(App, {
      global: {
        provide: {
          eventBus: mockEventBus,
        },
        stubs: {
          'navigation-drawer': { template: '<div class="nav-drawer" />' },
          'app-bar': { template: '<div class="app-bar" />' },
          'snack-bar': {
            template:
              '<div class="snack-bar" :data-message="message" :data-show="show" :data-level="level" />',
            props: ['message', 'show', 'level'],
          },
          'self-update-overlay': { template: '<div class="self-update-overlay" />' },
          'router-view': { template: '<div class="router-view" />' },
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders the app', () => {
    expect(wrapper.exists()).toBe(true);
  });

  it('starts unauthenticated', () => {
    expect(wrapper.vm.authenticated).toBe(false);
    expect(wrapper.vm.user).toBeUndefined();
  });

  it('registers event bus listeners on mount', () => {
    expect(mockEventBus.on).toHaveBeenCalledWith('authenticated', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('notify', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('notify:close', expect.any(Function));
  });

  it('computes breadcrumb items from route', () => {
    expect(wrapper.vm.items).toEqual([{ text: 'containers', disabled: false, href: '' }]);
  });

  it('computes Home breadcrumb item for root route', async () => {
    routeState.fullPath = '/';
    routeState.name = 'home';
    routeState.path = '/';
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.items).toEqual([{ text: 'Home', disabled: false, href: '' }]);
  });

  it('does not render nav/bar/footer when unauthenticated', () => {
    expect(wrapper.find('.nav-drawer').exists()).toBe(false);
    expect(wrapper.find('.app-bar').exists()).toBe(false);
  });

  it('shows snackbar when notify is called', async () => {
    // Trigger the notify listener
    const notifyCall = mockEventBus.on.mock.calls.find((c) => c[0] === 'notify');
    const notifyFn = notifyCall[1];
    notifyFn('Test message', 'error');

    await wrapper.vm.$nextTick();

    expect(wrapper.vm.snackbarMessage).toBe('Test message');
    expect(wrapper.vm.snackbarShow).toBe(true);
    expect(wrapper.vm.snackbarLevel).toBe('error');
  });

  it('uses default level "info" for notify', async () => {
    const notifyCall = mockEventBus.on.mock.calls.find((c) => c[0] === 'notify');
    const notifyFn = notifyCall[1];
    notifyFn('Info message');

    await wrapper.vm.$nextTick();

    expect(wrapper.vm.snackbarLevel).toBe('info');
  });

  it('closes snackbar on notify:close', async () => {
    // First show it
    const notifyCall = mockEventBus.on.mock.calls.find((c) => c[0] === 'notify');
    notifyCall[1]('Test message');

    await wrapper.vm.$nextTick();
    expect(wrapper.vm.snackbarShow).toBe(true);

    // Now close
    const closeCall = mockEventBus.on.mock.calls.find((c) => c[0] === 'notify:close');
    closeCall[1]();

    await wrapper.vm.$nextTick();
    expect(wrapper.vm.snackbarShow).toBe(false);
    expect(wrapper.vm.snackbarMessage).toBe('');
  });

  it('becomes authenticated when event bus emits authenticated', async () => {
    const authCall = mockEventBus.on.mock.calls.find((c) => c[0] === 'authenticated');
    const authFn = authCall[1];
    authFn({ username: 'testuser' });

    await wrapper.vm.$nextTick();

    expect(wrapper.vm.authenticated).toBe(true);
    expect(wrapper.vm.user).toEqual({ username: 'testuser' });
  });

  it('renders nav/bar/footer when authenticated', async () => {
    const authCall = mockEventBus.on.mock.calls.find((c) => c[0] === 'authenticated');
    authCall[1]({ username: 'testuser' });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.nav-drawer').exists()).toBe(true);
    expect(wrapper.find('.app-bar').exists()).toBe(true);
  });

  it('loads server config after becoming authenticated', async () => {
    expect(getServer).not.toHaveBeenCalled();

    const authCall = mockEventBus.on.mock.calls.find((c) => c[0] === 'authenticated');
    authCall[1]({ username: 'testuser' });

    await wrapper.vm.$nextTick();
    wrapper.vm.$forceUpdate();
    await wrapper.vm.$nextTick();

    expect(getServer).toHaveBeenCalled();
  });

  it('toggles drawer visibility', () => {
    expect(wrapper.vm.drawerVisible).toBe(false);
    wrapper.vm.toggleDrawer();
    expect(wrapper.vm.drawerVisible).toBe(true);
  });

  it('updates drawerVisible from navigation-drawer v-model events', async () => {
    const eventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const navWrapper = mount(App, {
      global: {
        provide: {
          eventBus,
        },
        stubs: {
          'navigation-drawer': {
            template: '<div class="nav-drawer" @click="$emit(\'update:modelValue\', false)"></div>',
            props: ['modelValue'],
            emits: ['update:modelValue'],
          },
          'app-bar': { template: '<div class="app-bar" />' },
          'snack-bar': {
            template:
              '<div class="snack-bar" :data-message="message" :data-show="show" :data-level="level" />',
            props: ['message', 'show', 'level'],
          },
          'self-update-overlay': { template: '<div class="self-update-overlay" />' },
          'router-view': { template: '<div class="router-view" />' },
        },
      },
    });

    try {
      const authCall = eventBus.on.mock.calls.find((c) => c[0] === 'authenticated');
      authCall?.[1]({ username: 'testuser' });
      await navWrapper.vm.$nextTick();

      navWrapper.vm.drawerVisible = true;
      await navWrapper.vm.$nextTick();
      await navWrapper.find('.nav-drawer').trigger('click');

      expect(navWrapper.vm.drawerVisible).toBe(false);
    } finally {
      navWrapper.unmount();
    }
  });
});

describe('App helper functions', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
    vi.mocked(getServer).mockReset();
    vi.mocked(getServer).mockResolvedValue({ configuration: { feature: { delete: true } } } as any);
  });

  it('setupEventBusListeners wires all expected listeners', () => {
    const eventBus = { on: vi.fn() };
    const onAuthenticated = vi.fn();
    const notify = vi.fn();
    const notifyClose = vi.fn();

    setupEventBusListeners(eventBus, onAuthenticated, notify, notifyClose);

    expect(eventBus.on).toHaveBeenCalledWith('authenticated', onAuthenticated);
    expect(eventBus.on).toHaveBeenCalledWith('notify', notify);
    expect(eventBus.on).toHaveBeenCalledWith('notify:close', notifyClose);
  });

  it('setupAuthStateManagement clears user when navigating to login', async () => {
    const user = { value: { username: 'existing' } };
    const onAuthenticated = vi.fn();
    const handler = setupAuthStateManagement(user, onAuthenticated);

    await handler({ name: 'login' });

    expect(user.value).toBeUndefined();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('setupAuthStateManagement fetches and authenticates user when missing', async () => {
    const user = { value: undefined };
    const onAuthenticated = vi.fn();
    const handler = setupAuthStateManagement(user, onAuthenticated);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ username: 'fetched-user' }),
    } as any);

    await handler({ name: 'containers' });

    expect(fetch).toHaveBeenCalledWith('/auth/user', {
      credentials: 'include',
    });
    expect(onAuthenticated).toHaveBeenCalledWith({ username: 'fetched-user' });
  });

  it('setupAuthStateManagement does not fetch when user already exists', async () => {
    const user = { value: { username: 'existing-user' } };
    const onAuthenticated = vi.fn();
    const handler = setupAuthStateManagement(user, onAuthenticated);

    await handler({ name: 'containers' });

    expect(fetch).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('setupAuthStateManagement ignores non-ok user responses', async () => {
    const user = { value: undefined };
    const onAuthenticated = vi.fn();
    const handler = setupAuthStateManagement(user, onAuthenticated);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ username: 'ignored' }),
    } as any);

    await handler({ name: 'containers' });

    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('setupAuthStateManagement ignores fetch results without username', async () => {
    const user = { value: undefined };
    const onAuthenticated = vi.fn();
    const handler = setupAuthStateManagement(user, onAuthenticated);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'anonymous' }),
    } as any);

    await handler({ name: 'containers' });

    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('setupAuthStateManagement handles fetch errors', async () => {
    const user = { value: undefined };
    const onAuthenticated = vi.fn();
    const handler = setupAuthStateManagement(user, onAuthenticated);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await handler({ name: 'containers' });
      expect(onAuthenticated).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('loadServerConfig fetches and stores server config when authenticated', async () => {
    const authenticated = { value: true };
    const instance: any = {
      appContext: {
        config: {
          globalProperties: {},
        },
      },
    };
    vi.mocked(getServer).mockResolvedValueOnce({
      configuration: { feature: { delete: true } },
    } as any);

    await loadServerConfig(authenticated, instance);

    expect(getServer).toHaveBeenCalled();
    expect(instance.appContext.config.globalProperties.$serverConfig).toEqual({
      feature: { delete: true },
    });
  });

  it('loadServerConfig is a no-op when already configured or unauthenticated', async () => {
    const instance: any = {
      appContext: {
        config: {
          globalProperties: {
            $serverConfig: { existing: true },
          },
        },
      },
    };

    await loadServerConfig({ value: false }, instance);
    await loadServerConfig({ value: true }, instance);

    expect(getServer).not.toHaveBeenCalled();
  });
});
