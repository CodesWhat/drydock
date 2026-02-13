import { mount } from '@vue/test-utils';
import LoginBasic from '@/components/LoginBasic.vue';
import LoginOidc from '@/components/LoginOidc.vue';
import { getOidcRedirection, getStrategies } from '@/services/auth';
import LoginView from '@/views/LoginView';

// Mock services
vi.mock('@/services/auth', () => ({
  getStrategies: vi.fn(),
  getOidcRedirection: vi.fn(),
}));

// Mock matchMedia for theme detection
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
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

// Mock router
const mockRouter = {
  push: vi.fn(),
};
const mockRoute = {
  query: {},
};

describe('LoginView', () => {
  let wrapper;

  beforeEach(() => {
    (getStrategies as any).mockReset();
    (getOidcRedirection as any).mockReset();
    mockRouter.push.mockReset();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const mountComponent = (strategies = []) => {
    wrapper = mount(LoginView, {
      global: {
        mocks: {
          $router: mockRouter,
          $route: mockRoute,
        },
        provide: {
          eventBus: {
            emit: vi.fn(),
          },
        },
      },
      data() {
        return {
          strategies: strategies,
        };
      },
    });
  };

  it('renders login dialog with basic strategy', () => {
    mountComponent([{ type: 'basic', name: 'local' }]);
    expect(wrapper.findComponent(LoginBasic).exists()).toBe(true);
    expect(wrapper.findComponent(LoginOidc).exists()).toBe(false);
  });

  it('renders login dialog with oidc strategy', () => {
    mountComponent([{ type: 'oidc', name: 'google' }]);
    expect(wrapper.findComponent(LoginBasic).exists()).toBe(false);
    expect(wrapper.findComponent(LoginOidc).exists()).toBe(true);
  });

  it('redirects to home on authentication success', () => {
    mountComponent([{ type: 'basic' }]);
    wrapper.vm.onAuthenticationSuccess();
    expect(mockRouter.push).toHaveBeenCalledWith('/');
  });

  it('redirects to next url on authentication success if provided', () => {
    mockRoute.query.next = '/foo';
    mountComponent([{ type: 'basic' }]);
    wrapper.vm.onAuthenticationSuccess();
    expect(mockRouter.push).toHaveBeenCalledWith('/foo');
    mockRoute.query.next = undefined; // reset
  });

  describe('Route Hook (beforeRouteEnter)', () => {
    it('redirects to home if anonymous auth is enabled', async () => {
      (getStrategies as any).mockResolvedValue([{ type: 'anonymous' }]);
      const next = vi.fn();

      await LoginView.beforeRouteEnter.call(LoginView, {}, {}, next);

      expect(next).toHaveBeenCalledWith('/');
    });

    it('redirects to OIDC url if OIDC redirect is enabled', async () => {
      (getStrategies as any).mockResolvedValue([{ type: 'oidc', redirect: true, name: 'google' }]);
      (getOidcRedirection as any).mockResolvedValue({ url: 'http://google.com' });

      // Mock window.location
      const originalLocation = window.location;
      delete window.location;
      window.location = { href: '' };

      const next = vi.fn();
      await LoginView.beforeRouteEnter.call(LoginView, {}, {}, next);

      expect(window.location.href).toBe('http://google.com');
      expect(next).not.toHaveBeenCalled();

      window.location = originalLocation;
    });

    it('filters supported strategies and populates vm', async () => {
      (getStrategies as any).mockResolvedValue([
        { type: 'basic' },
        { type: 'oidc' },
        { type: 'unsupported' },
      ]);
      const next = vi.fn();

      await LoginView.beforeRouteEnter.call(LoginView, {}, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(Function));
      const vm = { strategies: [], isSupportedStrategy: LoginView.methods.isSupportedStrategy };
      const callback = next.mock.calls[0][0];
      await callback(vm);

      expect(vm.strategies).toHaveLength(2);
      expect(vm.strategies[0].type).toBe('basic');
      expect(vm.strategies[1].type).toBe('oidc');
    });

    it('emits notify through event bus when strategy fetch fails', async () => {
      (getStrategies as any).mockRejectedValue(new Error('fetch failed'));
      const next = vi.fn();

      await LoginView.beforeRouteEnter.call(LoginView, {}, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(Function));
      const emit = vi.fn();
      const callback = next.mock.calls[0][0];
      callback({ eventBus: { emit } });

      expect(emit).toHaveBeenCalledWith(
        'notify',
        'Error when trying to get the authentication strategies (fetch failed)',
        'error',
      );
    });

    it('logs to console when strategy fetch fails without injected event bus', async () => {
      (getStrategies as any).mockRejectedValue(new Error('fetch failed'));
      const next = vi.fn();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await LoginView.beforeRouteEnter.call(LoginView, {}, {}, next);
        const callback = next.mock.calls[0][0];
        callback({});

        expect(consoleSpy).toHaveBeenCalledWith(
          'Error when trying to get the authentication strategies (fetch failed)',
        );
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });
});
