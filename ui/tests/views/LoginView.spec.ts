import fs from 'node:fs';
import path from 'node:path';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
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
const mountedWrappers: VueWrapper[] = [];

function trackWrapper(wrapper: VueWrapper) {
  mountedWrappers.push(wrapper);
  return wrapper;
}

async function mountLogin(strategies: any[] = [], warnings: string[] = []) {
  mockGetStrategies.mockResolvedValue({ strategies, warnings });
  const wrapper = trackWrapper(mountWithPlugins(LoginView));
  await flushPromises();
  return wrapper;
}

describe('LoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('loading state', () => {
    it('does not show login card before strategies resolve', () => {
      mockGetStrategies.mockReturnValue(new Promise(() => {}));
      const wrapper = trackWrapper(mountWithPlugins(LoginView));
      expect(wrapper.find('form').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('Sign in to Drydock');
    });

    it('shows login card after strategies resolve', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      expect(wrapper.text()).toContain('Sign in to Drydock');
    });
  });

  describe('strategy fetching', () => {
    it('calls getStrategies on mount', async () => {
      await mountLogin([]);
      expect(mockGetStrategies).toHaveBeenCalledOnce();
    });

    it('shows error when getStrategies fails', async () => {
      mockGetStrategies.mockRejectedValue(new Error('fail'));
      const wrapper = trackWrapper(mountWithPlugins(LoginView));
      await flushPromises();
      expect(wrapper.text()).toContain('Failed to load authentication methods');
    });

    it('shows no-methods message when no strategies are returned', async () => {
      const wrapper = await mountLogin([]);
      expect(wrapper.text()).toContain('No authentication methods configured');
    });

    it('displays registration warnings when no strategies and warnings exist', async () => {
      const wrapper = await mountLogin(
        [],
        ['Some authentications failed to register ("hash" is required)'],
      );
      expect(wrapper.text()).toContain('No authentication methods configured');
      expect(wrapper.text()).toContain('Some authentications failed to register');
    });

    it('does not display warnings when strategies exist', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }], ['Some warning']);
      expect(wrapper.text()).not.toContain('Some warning');
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

    it('redirects to same-origin OIDC URL', async () => {
      mockSetRememberMe.mockResolvedValue(undefined);
      const redirectUrl = `${window.location.origin}/auth/oidc/GitHub/cb?code=abc`;
      mockGetOidcRedirection.mockResolvedValue({ redirect: redirectUrl });
      const assignSpy = vi.fn();
      vi.stubGlobal('location', {
        ...window.location,
        origin: window.location.origin,
        href: window.location.href,
        assign: assignSpy,
      });
      const wrapper = await mountLogin([{ type: 'oidc', name: 'GitHub' }]);

      const oidcBtn = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('GitHub'));
      await oidcBtn?.trigger('click');
      await flushPromises();

      expect(assignSpy).toHaveBeenCalledWith(redirectUrl);
      expect(wrapper.text()).not.toContain('Failed to connect to GitHub');
    });

    it('redirects to same-origin OIDC URL from url payload field', async () => {
      mockSetRememberMe.mockResolvedValue(undefined);
      const redirectUrl = `${window.location.origin}/auth/oidc/GitHub/cb?code=abc`;
      mockGetOidcRedirection.mockResolvedValue({ url: redirectUrl });
      const assignSpy = vi.fn();
      vi.stubGlobal('location', {
        ...window.location,
        origin: window.location.origin,
        href: window.location.href,
        assign: assignSpy,
      });
      const wrapper = await mountLogin([{ type: 'oidc', name: 'GitHub' }]);

      const oidcBtn = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('GitHub'));
      await oidcBtn?.trigger('click');
      await flushPromises();

      expect(assignSpy).toHaveBeenCalledWith(redirectUrl);
      expect(wrapper.text()).not.toContain('Failed to connect to GitHub');
    });

    it('allows cross-origin OIDC redirect URLs from the backend', async () => {
      mockSetRememberMe.mockResolvedValue(undefined);
      mockGetOidcRedirection.mockResolvedValue({
        redirect: 'https://idp.example.com/authorize?client_id=abc',
      });
      const assignSpy = vi.fn();
      vi.stubGlobal('location', {
        ...window.location,
        origin: window.location.origin,
        href: window.location.href,
        assign: assignSpy,
      });
      const wrapper = await mountLogin([{ type: 'oidc', name: 'GitHub' }]);

      const oidcBtn = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('GitHub'));
      await oidcBtn?.trigger('click');
      await flushPromises();

      expect(assignSpy).toHaveBeenCalledWith('https://idp.example.com/authorize?client_id=abc');
      expect(wrapper.text()).not.toContain('Failed to connect to GitHub');
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

    it('uses static Tailwind classes for OIDC button layout', () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, '../../src/views/LoginView.vue'),
        'utf8',
      );
      expect(source).not.toContain('grid-cols-${');
      expect(source).toContain('grid grid-cols-1 gap-3');
      expect(source).toContain('grid grid-cols-2 gap-3');
      expect(source).toContain('grid grid-cols-3 gap-3');
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

  describe('connectivity monitor', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not show connection lost overlay initially', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      expect(wrapper.text()).not.toContain('Connection Lost');
    });

    it('does not poll when initial strategy fetch succeeds', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      await vi.advanceTimersByTimeAsync(60_000);
      await flushPromises();

      expect(mockGetStrategies).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('polls with backoff only after initial failure and stops after success', async () => {
      mockGetStrategies
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new Error('still offline'))
        .mockResolvedValueOnce({ strategies: [{ type: 'basic', name: 'basic' }], warnings: [] });

      const wrapper = trackWrapper(mountWithPlugins(LoginView));
      await flushPromises();
      expect(mockGetStrategies).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).toContain('Connection Lost');

      await vi.advanceTimersByTimeAsync(4_999);
      await flushPromises();
      expect(mockGetStrategies).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();
      expect(mockGetStrategies).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).toContain('Connection Lost');

      await vi.advanceTimersByTimeAsync(9_999);
      await flushPromises();
      expect(mockGetStrategies).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();
      expect(mockGetStrategies).toHaveBeenCalledTimes(3);
      expect(wrapper.text()).not.toContain('Connection Lost');

      await vi.advanceTimersByTimeAsync(30_000);
      await flushPromises();
      expect(mockGetStrategies).toHaveBeenCalledTimes(3);
      wrapper.unmount();
    });

    it('clears retry polling timer on unmount', async () => {
      mockGetStrategies.mockRejectedValue(new Error('offline'));

      const wrapper = trackWrapper(mountWithPlugins(LoginView));
      await flushPromises();
      expect(mockGetStrategies).toHaveBeenCalledTimes(1);

      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(60_000);
      await flushPromises();

      expect(mockGetStrategies).toHaveBeenCalledTimes(1);
    });

    it('shows belly-up whale logo and reconnecting text in overlay', async () => {
      mockGetStrategies.mockRejectedValue(new Error('offline'));
      const wrapper = trackWrapper(mountWithPlugins(LoginView));
      await flushPromises();

      const whaleImg = wrapper.find('img[alt=""]');
      expect(whaleImg.exists()).toBe(true);
      expect(whaleImg.attributes('style')).toContain('rotate(180deg)');
      expect(wrapper.text()).toContain('Reconnecting');
      wrapper.unmount();
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
