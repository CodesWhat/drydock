import { mount } from '@vue/test-utils';
import App from '@/App';

// Mock services
vi.mock('@/services/server', () => ({
  getServer: vi.fn(() => Promise.resolve({ configuration: { feature: { delete: true } } })),
  getServerIcon: vi.fn(() => 'mdi-connection'),
}));

vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({
    fullPath: '/containers',
    name: 'containers',
    path: '/containers',
    query: {},
    params: {},
  })),
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
    mockEventBus.emit.mockClear();
    mockEventBus.on.mockClear();

    wrapper = mount(App, {
      global: {
        provide: {
          eventBus: mockEventBus,
        },
        stubs: {
          'navigation-drawer': { template: '<div class="nav-drawer" />' },
          'app-bar': { template: '<div class="app-bar" />' },
          'snack-bar': {
            template: '<div class="snack-bar" :data-message="message" :data-show="show" :data-level="level" />',
            props: ['message', 'show', 'level'],
          },
          'app-footer': { template: '<div class="app-footer" />' },
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
    expect(wrapper.vm.items).toEqual([
      { text: 'containers', disabled: false, href: '' },
    ]);
  });

  it('does not render nav/bar/footer when unauthenticated', () => {
    expect(wrapper.find('.nav-drawer').exists()).toBe(false);
    expect(wrapper.find('.app-bar').exists()).toBe(false);
    expect(wrapper.find('.app-footer').exists()).toBe(false);
  });

  it('shows snackbar when notify is called', async () => {
    // Trigger the notify listener
    const notifyCall = mockEventBus.on.mock.calls.find(c => c[0] === 'notify');
    const notifyFn = notifyCall[1];
    notifyFn('Test message', 'error');

    await wrapper.vm.$nextTick();

    expect(wrapper.vm.snackbarMessage).toBe('Test message');
    expect(wrapper.vm.snackbarShow).toBe(true);
    expect(wrapper.vm.snackbarLevel).toBe('error');
  });

  it('uses default level "info" for notify', async () => {
    const notifyCall = mockEventBus.on.mock.calls.find(c => c[0] === 'notify');
    const notifyFn = notifyCall[1];
    notifyFn('Info message');

    await wrapper.vm.$nextTick();

    expect(wrapper.vm.snackbarLevel).toBe('info');
  });

  it('closes snackbar on notify:close', async () => {
    // First show it
    const notifyCall = mockEventBus.on.mock.calls.find(c => c[0] === 'notify');
    notifyCall[1]('Test message');

    await wrapper.vm.$nextTick();
    expect(wrapper.vm.snackbarShow).toBe(true);

    // Now close
    const closeCall = mockEventBus.on.mock.calls.find(c => c[0] === 'notify:close');
    closeCall[1]();

    await wrapper.vm.$nextTick();
    expect(wrapper.vm.snackbarShow).toBe(false);
    expect(wrapper.vm.snackbarMessage).toBe('');
  });

  it('becomes authenticated when event bus emits authenticated', async () => {
    const authCall = mockEventBus.on.mock.calls.find(c => c[0] === 'authenticated');
    const authFn = authCall[1];
    authFn({ username: 'testuser' });

    await wrapper.vm.$nextTick();

    expect(wrapper.vm.authenticated).toBe(true);
    expect(wrapper.vm.user).toEqual({ username: 'testuser' });
  });

  it('renders nav/bar/footer when authenticated', async () => {
    const authCall = mockEventBus.on.mock.calls.find(c => c[0] === 'authenticated');
    authCall[1]({ username: 'testuser' });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.nav-drawer').exists()).toBe(true);
    expect(wrapper.find('.app-bar').exists()).toBe(true);
    expect(wrapper.find('.app-footer').exists()).toBe(true);
  });
});
