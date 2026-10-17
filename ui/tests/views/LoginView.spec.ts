import fs from 'node:fs';
import path from 'node:path';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';
import { setI18nLocale } from '@/boot/i18n';
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
  completeLoginChallenge: vi.fn(),
  cancelLoginChallenge: vi.fn(),
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

import {
  cancelLoginChallenge,
  completeLoginChallenge,
  getOidcRedirection,
  getStrategies,
  loginBasic,
  setRememberMe,
} from '@/services/auth';

const mockGetStrategies = getStrategies as ReturnType<typeof vi.fn>;
const mockLoginBasic = loginBasic as ReturnType<typeof vi.fn>;
const mockComplete = completeLoginChallenge as ReturnType<typeof vi.fn>;
const mockCancel = cancelLoginChallenge as ReturnType<typeof vi.fn>;
const mockSetRememberMe = setRememberMe as ReturnType<typeof vi.fn>;
const mockGetOidcRedirection = getOidcRedirection as ReturnType<typeof vi.fn>;
const mountedWrappers: VueWrapper[] = [];

function trackWrapper(wrapper: VueWrapper) {
  mountedWrappers.push(wrapper);
  return wrapper;
}

async function mountLogin(providers: any[] = [], errors: any[] = []) {
  mockGetStrategies.mockResolvedValue({ providers, errors });
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

    it('displays auth provider errors when no auth methods are available', async () => {
      const wrapper = await mountLogin([], [{ provider: 'basic:ANDI', error: 'hash is required' }]);
      expect(wrapper.text()).not.toContain('No authentication methods configured');
      expect(wrapper.text()).toContain("Basic auth 'ANDI': hash is required");
    });

    it('does not display auth provider errors when methods exist', async () => {
      const wrapper = await mountLogin(
        [{ type: 'basic', name: 'basic' }],
        [{ provider: 'basic:ANDI', error: 'hash is required' }],
      );
      expect(wrapper.text()).not.toContain("Basic auth 'ANDI': hash is required");
    });
  });

  describe('basic auth form', () => {
    it('shows basic auth form when basic strategy exists', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      expect(wrapper.find('form').exists()).toBe(true);
      expect(wrapper.find('input[type="text"]').exists()).toBe(true);
      expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    });

    it('has password-manager autofill attributes on username and password inputs', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      expect(
        wrapper
          .find('input#username[name="username"][type="text"][autocomplete="username"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('input#password[name="password"][type="password"][autocomplete="current-password"]')
          .exists(),
      ).toBe(true);
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
      mockLoginBasic.mockRejectedValue(new Error('Username or password error'));
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);

      await wrapper.find('input[type="text"]').setValue('admin');
      await wrapper.find('input[type="password"]').setValue('wrong');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('Invalid username or password');
    });

    it('shows server-provided auth error when available', async () => {
      mockLoginBasic.mockRejectedValue(new Error("Basic auth 'ANDI': hash is required"));
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);

      await wrapper.find('input[type="text"]').setValue('admin');
      await wrapper.find('input[type="password"]').setValue('wrong');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain("Basic auth 'ANDI': hash is required");
      expect(wrapper.text()).not.toContain('Invalid username or password');
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

  describe('password reveal toggle', () => {
    afterEach(() => setI18nLocale('en'));

    it.each([
      ['en', 'Show password', 'Hide password'],
      ['ar', 'إظهار كلمة المرور', 'إخفاء كلمة المرور'],
      ['de', 'Passwort anzeigen', 'Passwort ausblenden'],
      ['es', 'Mostrar contraseña', 'Ocultar contraseña'],
      ['fr', 'Afficher le mot de passe', 'Masquer le mot de passe'],
      ['it', 'Mostra password', 'Nascondi password'],
      ['ja', 'パスワードを表示', 'パスワードを非表示'],
      ['ko', '비밀번호 표시', '비밀번호 숨기기'],
      ['nl', 'Wachtwoord tonen', 'Wachtwoord verbergen'],
      ['pl', 'Pokaż hasło', 'Ukryj hasło'],
      ['pt-BR', 'Mostrar senha', 'Ocultar senha'],
      ['ru', 'Показать пароль', 'Скрыть пароль'],
      ['tr', 'Şifreyi göster', 'Şifreyi gizle'],
      ['uk', 'Показати пароль', 'Приховати пароль'],
      ['vi', 'Hiện mật khẩu', 'Ẩn mật khẩu'],
      ['zh-CN', '显示密码', '隐藏密码'],
      ['zh-TW', '顯示密碼', '隱藏密碼'],
    ] as const)(
      'localizes the open %s reveal control without submitting or clearing input',
      async (locale, show, hide) => {
        setI18nLocale('en');
        const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
        const field = wrapper.get<HTMLInputElement>('input#password');
        await field.setValue('test input retained');
        const button = wrapper.get('button[aria-label="Show password"]');
        setI18nLocale(locale);
        await flushPromises();
        expect(button.attributes('aria-label')).toBe(show);
        expect(field.attributes('type')).toBe('password');

        await button.trigger('click');
        expect(button.attributes('aria-label')).toBe(hide);
        expect(field.attributes('type')).toBe('text');
        expect(field.element.value).toBe('test input retained');

        setI18nLocale('en');
        await flushPromises();
        expect(button.attributes('aria-label')).toBe('Hide password');
        await button.trigger('click');
        expect(field.attributes('type')).toBe('password');
        expect(field.element.value).toBe('test input retained');
        expect(mockGetStrategies).toHaveBeenCalledTimes(1);
        expect(mockLoginBasic).not.toHaveBeenCalled();
      },
    );

    it('password input defaults to type="password" and toggle button exists', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      expect(wrapper.find('input#password').attributes('type')).toBe('password');
      const toggleBtn = wrapper.find('button[type="button"][aria-label="Show password"]');
      expect(toggleBtn.exists()).toBe(true);
    });

    it('toggle button has type="button" so it cannot submit the form', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      const toggleBtn = wrapper.find('button[aria-label="Show password"]');
      expect(toggleBtn.attributes('type')).toBe('button');
    });

    it('clicking toggle reveals password and updates icon and aria-label', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      const toggleBtn = wrapper.find('button[type="button"][aria-label="Show password"]');
      await toggleBtn.trigger('click');

      expect(wrapper.find('input#password').attributes('type')).toBe('text');
      expect(wrapper.find('button[type="button"][aria-label="Hide password"]').exists()).toBe(true);
      expect(wrapper.find('.app-icon-stub[data-icon="eye-slash"]').exists()).toBe(true);
    });

    it('clicking toggle again hides password and restores icon and aria-label', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      const toggleBtn = wrapper.find('button[type="button"][aria-label="Show password"]');
      await toggleBtn.trigger('click');
      await wrapper.find('button[type="button"][aria-label="Hide password"]').trigger('click');

      expect(wrapper.find('input#password').attributes('type')).toBe('password');
      expect(wrapper.find('button[type="button"][aria-label="Show password"]').exists()).toBe(true);
      expect(wrapper.find('.app-icon-stub[data-icon="eye"]').exists()).toBe(true);
    });

    it('shows eye icon when password is hidden', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      expect(wrapper.find('.app-icon-stub[data-icon="eye"]').exists()).toBe(true);
      expect(wrapper.find('.app-icon-stub[data-icon="eye-slash"]').exists()).toBe(false);
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
      mockGetOidcRedirection.mockResolvedValue({
        redirect: redirectUrl,
        strictEndpoints: [`${window.location.origin}/auth/oidc/GitHub/cb`],
        allowedOrigins: [window.location.origin],
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

      expect(assignSpy).toHaveBeenCalledWith(redirectUrl);
      expect(wrapper.text()).not.toContain('Failed to connect to GitHub');
    });

    it('redirects to same-origin OIDC URL from url payload field', async () => {
      mockSetRememberMe.mockResolvedValue(undefined);
      const redirectUrl = `${window.location.origin}/auth/oidc/GitHub/cb?code=abc`;
      mockGetOidcRedirection.mockResolvedValue({
        url: redirectUrl,
        strictEndpoints: [`${window.location.origin}/auth/oidc/GitHub/cb`],
        allowedOrigins: [window.location.origin],
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

      expect(assignSpy).toHaveBeenCalledWith(redirectUrl);
      expect(wrapper.text()).not.toContain('Failed to connect to GitHub');
    });

    it('allows cross-origin OIDC redirect URLs when they match the backend allowlist', async () => {
      mockSetRememberMe.mockResolvedValue(undefined);
      mockGetOidcRedirection.mockResolvedValue({
        redirect: 'https://idp.example.com/authorize?client_id=abc',
        strictEndpoints: ['https://idp.example.com/authorize'],
        allowedOrigins: ['https://idp.example.com'],
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

    it('shows error when OIDC redirect does not match backend allowlist', async () => {
      mockSetRememberMe.mockResolvedValue(undefined);
      mockGetOidcRedirection.mockResolvedValue({
        redirect: 'https://evil.example.com/authorize?client_id=abc',
        strictEndpoints: ['https://idp.example.com/authorize'],
        allowedOrigins: ['https://idp.example.com'],
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

      expect(assignSpy).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('Failed to connect to GitHub');
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
        .mockResolvedValueOnce({ providers: [{ type: 'basic', name: 'basic' }], errors: [] });

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
  describe('second-factor challenge', () => {
    const CHALLENGE_ID = 'zZ9-challenge-id-should-never-leak-0123456789';
    const futureIso = (ms = 300_000) => new Date(Date.now() + ms).toISOString();
    const challengeResult = (methods = ['totp', 'recovery'], expiresAt = futureIso()) => ({
      challenge: { id: CHALLENGE_ID, expiresAt, methods },
    });

    async function toCodeStep(methods = ['totp', 'recovery'], expiresAt = futureIso()) {
      mockLoginBasic.mockResolvedValue(challengeResult(methods, expiresAt));
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      await wrapper.find('input#username').setValue('admin');
      await wrapper.find('input#password').setValue('secret');
      await wrapper.find('form').trigger('submit');
      await flushPromises();
      return wrapper;
    }

    async function enterCode(wrapper: VueWrapper, value: string) {
      await wrapper.get('input#totp-code').setValue(value);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
    }

    function authError(status: number, retryAfterSeconds?: number) {
      return Object.assign(new Error(`Login challenge failed (${status})`), {
        name: 'AuthRequestError',
        status,
        retryAfterSeconds,
      });
    }

    beforeEach(() => {
      mockCancel.mockResolvedValue(undefined);
      sessionStorage.clear();
      localStorage.clear();
    });

    it('shows the code step on a 202 instead of navigating', async () => {
      const wrapper = await toCodeStep();
      expect(mockPush).not.toHaveBeenCalled();
      expect(wrapper.find('input#password').exists()).toBe(false);
      const input = wrapper.get('input#totp-code');
      expect(input.attributes('inputmode')).toBe('numeric');
      expect(input.attributes('autocomplete')).toBe('one-time-code');
      expect(wrapper.text()).toContain('Two-step verification');
    });

    it('labels the code input and moves focus to it', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      mockLoginBasic.mockResolvedValue(challengeResult());
      mockGetStrategies.mockResolvedValue({
        providers: [{ type: 'basic', name: 'basic' }],
        errors: [],
      });
      const wrapper = trackWrapper(mountWithPlugins(LoginView, { attachTo: host }));
      await flushPromises();
      await wrapper.find('input#username').setValue('admin');
      await wrapper.find('input#password').setValue('secret');
      await wrapper.find('form').trigger('submit');
      await flushPromises();
      const input = wrapper.get('input#totp-code');
      expect(wrapper.get('label[for="totp-code"]').text()).toBe('Authentication code');
      expect(document.activeElement).toBe(input.element);
      wrapper.unmount();
      mountedWrappers.pop();
      host.remove();
    });

    it('clears the password after a 202 and keeps the username', async () => {
      const wrapper = await toCodeStep();
      await wrapper.get('button[data-testid="login-challenge-cancel"]').trigger('click');
      await flushPromises();
      expect(wrapper.get<HTMLInputElement>('input#username').element.value).toBe('admin');
      expect(wrapper.get<HTMLInputElement>('input#password').element.value).toBe('');
    });

    it('completes with the code, carries remember, and navigates', async () => {
      mockComplete.mockResolvedValue({ username: 'admin' });
      mockLoginBasic.mockResolvedValue(challengeResult());
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      await wrapper.find('input#username').setValue('admin');
      await wrapper.find('input#password').setValue('secret');
      await wrapper.find('input[type="checkbox"]').setValue(true);
      await wrapper.find('form').trigger('submit');
      await flushPromises();
      await enterCode(wrapper, '123456');
      expect(mockLoginBasic).toHaveBeenCalledWith('admin', 'secret', true);
      expect(mockComplete).toHaveBeenCalledWith(CHALLENGE_ID, { code: '123456' }, true);
      expect(mockPush).toHaveBeenCalledWith('/');
      expect(mockCancel).not.toHaveBeenCalled();
    });

    it('strips spaces from a pasted code and needs six digits to submit', async () => {
      mockComplete.mockResolvedValue({ username: 'admin' });
      const wrapper = await toCodeStep();
      const input = wrapper.get<HTMLInputElement>('input#totp-code');
      await input.setValue('12');
      expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
      await wrapper.get('form').trigger('submit');
      expect(mockComplete).not.toHaveBeenCalled();
      await input.setValue('123 456');
      expect(input.element.value).toBe('123456');
      expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    });

    it('keeps the step and shows an alert on a wrong code', async () => {
      mockComplete.mockRejectedValue(authError(401));
      const wrapper = await toCodeStep();
      await enterCode(wrapper, '000000');
      expect(wrapper.find('input#totp-code').exists()).toBe(true);
      const alert = wrapper.get('[role="alert"]');
      expect(alert.text()).toContain('That code didn');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('returns to the password step after five wrong codes, as the server expires it', async () => {
      mockComplete.mockRejectedValue(authError(401));
      const wrapper = await toCodeStep();
      for (let i = 0; i < 5; i += 1) {
        await enterCode(wrapper, '000000');
      }
      expect(wrapper.find('input#password').exists()).toBe(true);
      expect(wrapper.get('[role="alert"]').text()).toContain('expired');
    });

    it('treats a 400 as a malformed code', async () => {
      mockComplete.mockRejectedValue(authError(400));
      const wrapper = await toCodeStep();
      await enterCode(wrapper, '123456');
      expect(wrapper.get('[role="alert"]').text()).toContain('valid code');
      expect(wrapper.find('input#totp-code').exists()).toBe(true);
    });

    it('offers the recovery switch only when methods includes recovery', async () => {
      const withoutRecovery = await toCodeStep(['totp']);
      expect(withoutRecovery.find('button[data-testid="login-challenge-recovery"]').exists()).toBe(
        false,
      );
    });

    it('switches to a recovery code, submits it, and can switch back', async () => {
      mockComplete.mockResolvedValue({ username: 'admin' });
      const wrapper = await toCodeStep();
      await wrapper.get('button[data-testid="login-challenge-recovery"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('input#totp-code').exists()).toBe(false);
      const input = wrapper.get('input#recovery-code');
      expect(input.attributes('inputmode')).toBeUndefined();
      await input.setValue('  abcd-efgh-ijkl ');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(mockComplete).toHaveBeenCalledWith(
        CHALLENGE_ID,
        { recoveryCode: 'abcd-efgh-ijkl' },
        false,
      );
      expect(mockPush).toHaveBeenCalledWith('/');
    });

    it('switches back to the authenticator code', async () => {
      const wrapper = await toCodeStep();
      await wrapper.get('button[data-testid="login-challenge-recovery"]').trigger('click');
      await wrapper.get('input#recovery-code').setValue('abc');
      await wrapper.get('button[data-testid="login-challenge-recovery"]').trigger('click');
      expect(wrapper.get<HTMLInputElement>('input#totp-code').element.value).toBe('');
    });

    it('does not submit an empty recovery code', async () => {
      const wrapper = await toCodeStep();
      await wrapper.get('button[data-testid="login-challenge-recovery"]').trigger('click');
      await wrapper.get('form').trigger('submit');
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('cancel calls DELETE and returns to the password step', async () => {
      const wrapper = await toCodeStep();
      await wrapper.get('button[data-testid="login-challenge-cancel"]').trigger('click');
      await flushPromises();
      expect(mockCancel).toHaveBeenCalledWith(CHALLENGE_ID);
      expect(wrapper.find('input#password').exists()).toBe(true);
      expect(wrapper.find('input#totp-code').exists()).toBe(false);
    });

    it('cancels a live challenge when the view is left', async () => {
      const wrapper = await toCodeStep();
      wrapper.unmount();
      mountedWrappers.pop();
      expect(mockCancel).toHaveBeenCalledWith(CHALLENGE_ID);
    });

    it('does not cancel on unmount when there is no challenge', async () => {
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      wrapper.unmount();
      mountedWrappers.pop();
      expect(mockCancel).not.toHaveBeenCalled();
    });

    it('does not cancel a challenge it has already completed', async () => {
      mockComplete.mockResolvedValue({ username: 'admin' });
      const wrapper = await toCodeStep();
      await enterCode(wrapper, '123456');
      wrapper.unmount();
      mountedWrappers.pop();
      expect(mockCancel).not.toHaveBeenCalled();
    });

    it('ignores a late result for a challenge that was cancelled meanwhile', async () => {
      let resolveComplete: (v: unknown) => void = () => {};
      mockComplete.mockReturnValue(new Promise((r) => (resolveComplete = r)));
      const wrapper = await toCodeStep();
      await wrapper.get('input#totp-code').setValue('123456');
      await wrapper.get('form').trigger('submit');
      await wrapper.get('button[data-testid="login-challenge-cancel"]').trigger('click');
      resolveComplete({ username: 'admin' });
      await flushPromises();
      expect(mockPush).not.toHaveBeenCalled();
      expect(wrapper.find('input#password').exists()).toBe(true);
    });

    describe('expiry', () => {
      afterEach(() => vi.useRealTimers());

      it('expires on its own deadline', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        mockGetStrategies.mockResolvedValue({
          providers: [{ type: 'basic', name: 'basic' }],
          errors: [],
        });
        mockLoginBasic.mockResolvedValue(challengeResult(['totp'], futureIso(60_000)));
        const wrapper = trackWrapper(mountWithPlugins(LoginView));
        await vi.advanceTimersByTimeAsync(0);
        await wrapper.find('input#username').setValue('admin');
        await wrapper.find('input#password').setValue('secret');
        await wrapper.find('form').trigger('submit');
        await vi.advanceTimersByTimeAsync(0);
        expect(wrapper.find('input#totp-code').exists()).toBe(true);
        await vi.advanceTimersByTimeAsync(59_999);
        expect(wrapper.find('input#totp-code').exists()).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        expect(wrapper.find('input#password').exists()).toBe(true);
        expect(wrapper.get('[role="alert"]').text()).toContain('expired');
        expect(mockCancel).not.toHaveBeenCalled();
      });

      it('treats an already-past or unparseable expiry as expired right away', async () => {
        const past = await toCodeStep(['totp'], new Date(Date.now() - 1000).toISOString());
        await flushPromises();
        expect(past.find('input#password').exists()).toBe(true);
        expect(past.get('[role="alert"]').text()).toContain('expired');
        const bad = await toCodeStep(['totp'], 'not-a-date');
        await flushPromises();
        expect(bad.find('input#password').exists()).toBe(true);
      });
    });

    it('shows the lockout with the retry time on 429 and 423', async () => {
      for (const [status, seconds, expected] of [
        [429, 90, '2 minutes'],
        [423, 45, '45 seconds'],
      ] as const) {
        mockComplete.mockRejectedValueOnce(authError(status, seconds));
        const wrapper = await toCodeStep();
        await enterCode(wrapper, '123456');
        expect(wrapper.get('[role="alert"]').text()).toContain('Too many attempts');
        expect(wrapper.get('[role="alert"]').text()).toContain(expected);
        expect(wrapper.find('input#totp-code').exists()).toBe(true);
      }
    });

    it('shows a lockout without a time when Retry-After is absent', async () => {
      mockComplete.mockRejectedValue(authError(429));
      const wrapper = await toCodeStep();
      await enterCode(wrapper, '123456');
      expect(wrapper.get('[role="alert"]').text()).toBe('Too many attempts. Try again later.');
    });

    it('shows a service fault on 503 and keeps the step', async () => {
      mockComplete.mockRejectedValue(authError(503));
      const wrapper = await toCodeStep();
      await enterCode(wrapper, '123456');
      expect(wrapper.get('[role="alert"]').text()).toContain('unavailable');
      expect(wrapper.find('input#totp-code').exists()).toBe(true);
    });

    it('shows a service fault for a network failure', async () => {
      mockComplete.mockRejectedValue(new TypeError('Failed to fetch'));
      const wrapper = await toCodeStep();
      await enterCode(wrapper, '123456');
      expect(wrapper.get('[role="alert"]').text()).toContain('unavailable');
    });

    it('never submits twice while a request is in flight', async () => {
      let resolveComplete: (v: unknown) => void = () => {};
      mockComplete.mockReturnValue(new Promise((r) => (resolveComplete = r)));
      const wrapper = await toCodeStep();
      await wrapper.get('input#totp-code').setValue('123456');
      await wrapper.get('form').trigger('submit');
      await wrapper.get('form').trigger('submit');
      expect(mockComplete).toHaveBeenCalledTimes(1);
      expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
      resolveComplete({ username: 'admin' });
      await flushPromises();
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it('never submits the password twice while the first is in flight', async () => {
      let resolveLogin: (v: unknown) => void = () => {};
      mockLoginBasic.mockReturnValue(new Promise((r) => (resolveLogin = r)));
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      await wrapper.find('input#username').setValue('admin');
      await wrapper.find('input#password').setValue('secret');
      await wrapper.find('form').trigger('submit');
      await wrapper.find('form').trigger('submit');
      expect(mockLoginBasic).toHaveBeenCalledTimes(1);
      resolveLogin({ username: 'admin' });
      await flushPromises();
    });

    it('lets the user retry after a failure', async () => {
      mockComplete
        .mockRejectedValueOnce(authError(401))
        .mockResolvedValueOnce({ username: 'admin' });
      const wrapper = await toCodeStep();
      await enterCode(wrapper, '000000');
      await enterCode(wrapper, '123456');
      expect(mockComplete).toHaveBeenCalledTimes(2);
      expect(mockPush).toHaveBeenCalledWith('/');
    });

    it('never writes the challenge id to storage, the URL or the console', async () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const logs = [
        vi.spyOn(console, 'log'),
        vi.spyOn(console, 'debug'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'error'),
      ];
      mockComplete.mockRejectedValue(authError(401));
      const wrapper = await toCodeStep();
      await enterCode(wrapper, '000000');
      await wrapper.get('button[data-testid="login-challenge-cancel"]').trigger('click');
      await flushPromises();
      expect(setItem).not.toHaveBeenCalled();
      expect(JSON.stringify({ ...sessionStorage })).not.toContain(CHALLENGE_ID);
      expect(JSON.stringify({ ...localStorage })).not.toContain(CHALLENGE_ID);
      expect(globalThis.location.href).not.toContain(CHALLENGE_ID);
      expect(wrapper.html()).not.toContain(CHALLENGE_ID);
      for (const spy of logs) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(CHALLENGE_ID);
      }
    });

    it('preserves the entered code and the error across a language switch', async () => {
      mockComplete.mockRejectedValue(authError(401));
      const wrapper = await toCodeStep();
      await enterCode(wrapper, '000000');
      const input = wrapper.get<HTMLInputElement>('input#totp-code');
      await input.setValue('123 4');
      expect(wrapper.get('label[for="totp-code"]').text()).toBe('Authentication code');
      setI18nLocale('de');
      await flushPromises();
      expect(wrapper.get('input#totp-code').element).toBe(input.element);
      expect(input.element.value).toBe('1234');
      expect(wrapper.get('label[for="totp-code"]').text()).not.toBe('Authentication code');
      expect(wrapper.get('[role="alert"]').text()).not.toContain('That code didn');
      setI18nLocale('en');
      await flushPromises();
      expect(input.element.value).toBe('1234');
      expect(wrapper.get('[role="alert"]').text()).toContain('That code didn');
      expect(mockComplete).toHaveBeenCalledTimes(1);
      expect(mockLoginBasic).toHaveBeenCalledTimes(1);
    });

    it('leaves a 200 login exactly as it was', async () => {
      mockLoginBasic.mockResolvedValue({ username: 'admin' });
      const wrapper = await mountLogin([{ type: 'basic', name: 'basic' }]);
      await wrapper.find('input#username').setValue('admin');
      await wrapper.find('input#password').setValue('secret');
      await wrapper.find('form').trigger('submit');
      await flushPromises();
      expect(mockPush).toHaveBeenCalledWith('/');
      expect(wrapper.find('input#totp-code').exists()).toBe(false);
      expect(mockComplete).not.toHaveBeenCalled();
    });
  });
});
