import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import LoginView from '@/views/LoginView.vue';
import { mountWithPlugins } from '../helpers/mount';

const mockPush = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ query: {} }),
}));

vi.mock('@/services/auth', () => ({
  getStrategies: vi.fn(),
  loginBasic: vi.fn(),
  setRememberMe: vi.fn(),
  getOidcRedirection: vi.fn(),
}));

vi.mock('@/theme/useTheme', () => ({
  useTheme: vi.fn(() => ({
    isDark: ref(false),
    themeFamily: ref('drydock'),
    themeVariant: ref('dark'),
    resolvedVariant: ref('dark'),
    setThemeFamily: vi.fn(),
    setThemeVariant: vi.fn(),
    toggleVariant: vi.fn(),
    transitionTheme: vi.fn(),
  })),
}));

import { getOidcRedirection, getStrategies, loginBasic, setRememberMe } from '@/services/auth';

const mockGetStrategies = getStrategies as ReturnType<typeof vi.fn>;
const mockLoginBasic = loginBasic as ReturnType<typeof vi.fn>;
const mockSetRememberMe = setRememberMe as ReturnType<typeof vi.fn>;
const mockGetOidcRedirection = getOidcRedirection as ReturnType<typeof vi.fn>;

async function mountLogin(strategies: any[] = []) {
  mockGetStrategies.mockResolvedValue(strategies);
  const wrapper = mountWithPlugins(LoginView);
  await flushPromises();
  return wrapper;
}

describe('LoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
  });

  describe('loading state', () => {
    it('shows loading spinner before strategies resolve', () => {
      mockGetStrategies.mockReturnValue(new Promise(() => {}));
      const wrapper = mountWithPlugins(LoginView);
      expect(wrapper.text()).toContain('Loading...');
    });

    it('hides loading after strategies resolve', async () => {
      const wrapper = await mountLogin([]);
      expect(wrapper.text()).not.toContain('Loading...');
    });
  });

  describe('strategy fetching', () => {
    it('calls getStrategies on mount', async () => {
      await mountLogin([]);
      expect(mockGetStrategies).toHaveBeenCalledOnce();
    });

    it('shows error when getStrategies fails', async () => {
      mockGetStrategies.mockRejectedValue(new Error('fail'));
      const wrapper = mountWithPlugins(LoginView);
      await flushPromises();
      expect(wrapper.text()).toContain('Failed to load authentication methods');
    });

    it('shows no-methods message when no strategies are returned', async () => {
      const wrapper = await mountLogin([]);
      expect(wrapper.text()).toContain('No authentication methods configured');
    });
  });

  describe('basic auth form', () => {
    it('shows basic auth form when basic strategy exists', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      expect(wrapper.find('form').exists()).toBe(true);
      expect(wrapper.find('input[type="text"]').exists()).toBe(true);
      expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    });

    it('hides basic auth form when no basic strategy exists', async () => {
      const wrapper = await mountLogin([{ type: 'oidc', name: 'github' }]);
      expect(wrapper.find('form').exists()).toBe(false);
    });

    it('shows Sign in button', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      const btn = wrapper.find('button[type="submit"]');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe('Sign in');
    });

    it('calls loginBasic on form submit', async () => {
      mockLoginBasic.mockResolvedValue({ name: 'admin' });
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);

      await wrapper.find('input[type="text"]').setValue('admin');
      await wrapper.find('input[type="password"]').setValue('secret');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockLoginBasic).toHaveBeenCalledWith('admin', 'secret', false);
    });

    it('shows error on login failure', async () => {
      mockLoginBasic.mockRejectedValue(new Error('bad creds'));
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);

      await wrapper.find('input[type="text"]').setValue('admin');
      await wrapper.find('input[type="password"]').setValue('wrong');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('Invalid username or password');
    });

    it('shows Signing in... text while submitting', async () => {
      let resolveLogin: (v: any) => void;
      mockLoginBasic.mockReturnValue(
        new Promise((r) => {
          resolveLogin = r;
        }),
      );
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);

      await wrapper.find('input[type="text"]').setValue('admin');
      await wrapper.find('input[type="password"]').setValue('secret');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('Signing in...');

      resolveLogin?.({ name: 'admin' });
      await flushPromises();

      expect(wrapper.text()).not.toContain('Signing in...');
    });

    it('navigates to / after successful login', async () => {
      mockLoginBasic.mockResolvedValue({ name: 'admin' });
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);

      await wrapper.find('input[type="text"]').setValue('admin');
      await wrapper.find('input[type="password"]').setValue('secret');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  describe('OIDC strategies', () => {
    it('shows OIDC buttons when OIDC strategies exist', async () => {
      const wrapper = await mountLogin([
        { type: 'oidc', name: 'GitHub' },
        { type: 'oidc', name: 'Google' },
      ]);
      const buttons = wrapper.findAll('button[type="button"]');
      const oidcButtons = buttons.filter(
        (b) => b.text().includes('GitHub') || b.text().includes('Google'),
      );
      expect(oidcButtons.length).toBe(2);
    });

    it('shows separator when both basic and OIDC strategies exist', async () => {
      const wrapper = await mountLogin([
        { type: 'basic', name: 'basic' },
        { type: 'oidc', name: 'GitHub' },
      ]);
      expect(wrapper.text()).toContain('or continue with');
    });

    it('does not show separator when only OIDC exists', async () => {
      const wrapper = await mountLogin([{ type: 'oidc', name: 'GitHub' }]);
      expect(wrapper.text()).not.toContain('or continue with');
    });

    it('calls setRememberMe and getOidcRedirection on OIDC click', async () => {
      mockSetRememberMe.mockResolvedValue(undefined);
      mockGetOidcRedirection.mockResolvedValue({ redirect: undefined });
      const wrapper = await mountLogin([{ type: 'oidc', name: 'GitHub' }]);

      const oidcBtn = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('GitHub'));
      await oidcBtn?.trigger('click');
      await flushPromises();

      expect(mockSetRememberMe).toHaveBeenCalledWith(false);
      expect(mockGetOidcRedirection).toHaveBeenCalledWith('GitHub');
    });

    it('shows error on OIDC failure', async () => {
      mockSetRememberMe.mockResolvedValue(undefined);
      mockGetOidcRedirection.mockRejectedValue(new Error('fail'));
      const wrapper = await mountLogin([{ type: 'oidc', name: 'GitHub' }]);

      const oidcBtn = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('GitHub'));
      await oidcBtn?.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Failed to connect to GitHub');
    });
  });

  describe('remember me', () => {
    it('renders remember me checkbox for basic auth', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      const checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.exists()).toBe(true);
      expect(wrapper.text()).toContain('Remember me');
    });

    it('passes rememberMe=true to loginBasic when checked', async () => {
      mockLoginBasic.mockResolvedValue({ name: 'admin' });
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);

      await wrapper.find('input[type="checkbox"]').setValue(true);
      await wrapper.find('input[type="text"]').setValue('admin');
      await wrapper.find('input[type="password"]').setValue('secret');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockLoginBasic).toHaveBeenCalledWith('admin', 'secret', true);
    });
  });

  describe('anonymous strategy', () => {
    it('navigates away immediately for anonymous strategy', async () => {
      await mountLogin([{ type: 'anonymous', name: 'anon' }]);
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  describe('OIDC icon selection', () => {
    it('renders github icon for GitHub provider', async () => {
      const wrapper = await mountLogin([{ type: 'oidc', name: 'GitHub' }]);
      expect(wrapper.find('.app-icon-stub[data-icon="github"]').exists()).toBe(true);
    });

    it('renders google icon for Google provider', async () => {
      const wrapper = await mountLogin([{ type: 'oidc', name: 'Google' }]);
      expect(wrapper.find('.app-icon-stub[data-icon="google"]').exists()).toBe(true);
    });

    it('renders generic icon for unknown provider', async () => {
      const wrapper = await mountLogin([{ type: 'oidc', name: 'CustomSSO' }]);
      expect(wrapper.find('.app-icon-stub[data-icon="sign-in"]').exists()).toBe(true);
    });
  });
});
