import { mount } from '@vue/test-utils';
import { useRoute, useRouter } from 'vue-router';
import AppBar from '@/components/AppBar.vue';
import { logout } from '@/services/auth';

const mockThemeName = { value: 'light' };
let mediaQueryMatches = false;
let mediaChangeHandler: ((event?: unknown) => void) | undefined;

vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({ name: 'home' })),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('@/services/auth', () => ({
  logout: vi.fn(() => Promise.resolve({})),
}));

vi.mock('vuetify', async () => {
  const actual = await vi.importActual('vuetify');
  return {
    ...actual,
    useTheme: vi.fn(() => ({
      global: { name: mockThemeName },
    })),
  };
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: mediaQueryMatches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (event?: unknown) => void) => {
      if (event === 'change') mediaChangeHandler = handler;
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mountComponent = (props: Record<string, any> = {}) =>
  mount(AppBar, {
    props: {
      user: { username: 'testuser' },
      showMenuToggle: true,
      ...props,
    },
    global: {
      provide: {
        eventBus: { emit: vi.fn() },
      },
    },
  });

describe('AppBar', () => {
  beforeEach(() => {
    localStorage.clear();
    mockThemeName.value = 'light';
    mediaQueryMatches = false;
    mediaChangeHandler = undefined;
    vi.mocked(logout).mockReset();
    vi.mocked(logout).mockResolvedValue({});
    vi.mocked(useRoute).mockReturnValue({ name: 'home' } as any);
    vi.mocked(useRouter).mockReturnValue({ push: vi.fn() } as any);
  });

  it('renders current user and exposes route view name', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('testuser');
    expect(wrapper.vm.viewName).toBe('home');
  });

  it('emits toggle-drawer when nav icon is clicked', async () => {
    const wrapper = mountComponent({ showMenuToggle: true });
    await wrapper.find('.v-app-bar-nav-icon').trigger('click');
    expect(wrapper.emitted('toggle-drawer')).toBeTruthy();
  });

  it('hides menu toggle controls when showMenuToggle is false and renders non-home title', () => {
    vi.mocked(useRoute).mockReturnValue({ name: 'containers' } as any);
    const wrapper = mountComponent({ showMenuToggle: false });

    expect(wrapper.find('.v-app-bar-nav-icon').exists()).toBe(false);
    expect(wrapper.find('.appbar-logo').exists()).toBe(false);
    expect(wrapper.text()).toContain('containers');
  });

  it('hides user menu for anonymous users', () => {
    const wrapper = mountComponent({ user: { username: 'anonymous' } });
    expect(wrapper.text()).not.toContain('Log out');
  });

  it('migrates legacy darkMode localStorage key', () => {
    localStorage.darkMode = 'true';
    const wrapper = mountComponent();

    expect(wrapper.vm.themeMode).toBe('dark');
    expect(localStorage.themeMode).toBe('dark');
    expect(localStorage.darkMode).toBeUndefined();
  });

  it('migrates legacy darkMode=false localStorage key to light mode', () => {
    localStorage.darkMode = 'false';
    const wrapper = mountComponent();

    expect(wrapper.vm.themeMode).toBe('light');
    expect(localStorage.themeMode).toBe('light');
    expect(localStorage.darkMode).toBeUndefined();
  });

  it('applies theme mode changes and computed labels/icons', async () => {
    const wrapper = mountComponent();

    wrapper.vm.onThemeModeChange('light');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.themeIcon).toBe('fas fa-sun');
    expect(wrapper.vm.themeLabel).toBe('Light');
    expect(wrapper.vm.themeIconColor).toBe('#F59E0B');
    expect(mockThemeName.value).toBe('light');

    wrapper.vm.onThemeModeChange('dark');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.themeIcon).toBe('fas fa-moon');
    expect(wrapper.vm.themeLabel).toBe('Dark');
    expect(wrapper.vm.themeIconColor).toBe('#60A5FA');
    expect(mockThemeName.value).toBe('dark');

    wrapper.vm.onThemeModeChange('system');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.themeIcon).toBe('fas fa-circle-half-stroke');
    expect(wrapper.vm.themeLabel).toBe('System');
    expect(wrapper.vm.themeIconColor).toBeUndefined();
  });

  it('uses system theme preference and reacts to media change events', async () => {
    mediaQueryMatches = true;
    const wrapper = mountComponent();

    // Mounted hook applies system theme.
    expect(mockThemeName.value).toBe('dark');
    expect(mediaChangeHandler).toBeTypeOf('function');

    mediaQueryMatches = false;
    mediaChangeHandler?.();
    await wrapper.vm.$nextTick();
    expect(mockThemeName.value).toBe('light');
  });

  it('ignores media change events when theme mode is not system', async () => {
    mediaQueryMatches = false;
    const wrapper = mountComponent();
    wrapper.vm.onThemeModeChange('dark');
    await wrapper.vm.$nextTick();

    mediaQueryMatches = true;
    mediaChangeHandler?.();
    await wrapper.vm.$nextTick();

    expect(mockThemeName.value).toBe('dark');
  });

  it('cycles theme modes in expected order', async () => {
    const wrapper = mountComponent();

    wrapper.vm.cycleTheme();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.themeMode).toBe('dark');

    wrapper.vm.cycleTheme();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.themeMode).toBe('light');

    wrapper.vm.cycleTheme();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.themeMode).toBe('system');
  });

  it('navigates to login when logout succeeds without external logout url', async () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push } as any);
    vi.mocked(logout).mockResolvedValueOnce({});
    const wrapper = mountComponent();

    await wrapper.vm.logout();

    expect(logout).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith({ name: 'login' });
  });

  it('redirects browser when logout response contains logoutUrl', async () => {
    const originalLocation = window.location;
    delete (window as any).location;
    (window as any).location = 'about:blank';
    vi.mocked(logout).mockResolvedValueOnce({ logoutUrl: 'https://idp.example.com/logout' });
    const wrapper = mountComponent();

    await wrapper.vm.logout();

    expect(window.location).toBe('https://idp.example.com/logout');
    (window as any).location = originalLocation;
  });

  it('emits notify error when logout throws', async () => {
    const eventBus = { emit: vi.fn() };
    vi.mocked(logout).mockRejectedValueOnce(new Error('logout failed'));
    const wrapper = mount(AppBar, {
      props: {
        user: { username: 'testuser' },
      },
      global: {
        provide: {
          eventBus,
        },
      },
    });

    await wrapper.vm.logout();

    expect(eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Error when trying to logout (logout failed)',
      'error',
    );
  });
});
