import { mount } from '@vue/test-utils';
import App from '@/App.vue';

const mockUseGlobalUpdateToast = vi.hoisted(() => vi.fn());

vi.mock('@/composables/useGlobalUpdateToast', () => ({
  useGlobalUpdateToast: mockUseGlobalUpdateToast,
}));

function mountApp() {
  return mount(App, {
    global: {
      stubs: {
        'router-view': { template: '<main data-test="router-view" />' },
        ConfirmDialog: { template: '<div data-test="confirm-dialog" />' },
        KeyboardShortcutsOverlay: { template: '<div data-test="shortcuts-overlay" />' },
        AppToast: { template: '<div data-test="app-toast" />' },
      },
    },
  });
}

describe('App', () => {
  beforeEach(() => {
    mockUseGlobalUpdateToast.mockClear();
  });

  it('installs the global update toast watcher once on setup', () => {
    mountApp();

    expect(mockUseGlobalUpdateToast).toHaveBeenCalledOnce();
  });

  it('renders the routed view with the app-wide confirm dialog, shortcuts overlay and toast host', () => {
    const wrapper = mountApp();

    expect(wrapper.find('[data-test="router-view"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="confirm-dialog"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="shortcuts-overlay"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="app-toast"]').exists()).toBe(true);
  });
});
