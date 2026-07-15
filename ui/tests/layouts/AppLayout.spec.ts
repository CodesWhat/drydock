import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { setI18nLocale } from '@/boot/i18n';
import AppLayout from '@/layouts/AppLayout.vue';
import { mountWithPlugins } from '../helpers/mount';

const {
  mockRouterPush,
  mockRouterReplace,
  mockGetAgents,
  mockGetUser,
  mockLogout,
  mockGetAllAuthentications,
  mockGetAllContainers,
  mockGetEffectiveDisplayIcon,
  mockGetAllNotificationRules,
  mockGetAllRegistries,
  mockGetServer,
  mockGetAllTriggers,
  mockGetAllWatchers,
  mockSseConnect,
  mockSseDisconnect,
  mockLoadRecentItems,
  mockSaveRecentItems,
} = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockRouterReplace: vi.fn(),
  mockGetAgents: vi.fn(),
  mockGetUser: vi.fn(),
  mockLogout: vi.fn(),
  mockGetAllAuthentications: vi.fn(),
  mockGetAllContainers: vi.fn(),
  mockGetEffectiveDisplayIcon: vi.fn(),
  mockGetAllNotificationRules: vi.fn(),
  mockGetAllRegistries: vi.fn(),
  mockGetServer: vi.fn(),
  mockGetAllTriggers: vi.fn(),
  mockGetAllWatchers: vi.fn(),
  mockSseConnect: vi.fn(),
  mockSseDisconnect: vi.fn(),
  mockLoadRecentItems: vi.fn(),
  mockSaveRecentItems: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
  useRoute: () => ({ path: '/', query: {}, params: {} }),
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isMobile: { __v_isRef: true, value: false },
    windowNarrow: { __v_isRef: true, value: false },
  }),
}));

vi.mock('@/composables/useIcons', () => ({
  useIcons: () => ({
    icon: vi.fn(() => ''),
  }),
}));

vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    isDark: { value: false },
  }),
}));

vi.mock('@/layouts/recentStorage', () => ({
  loadRecentItems: (...args: unknown[]) => mockLoadRecentItems(...args),
  saveRecentItems: (...args: unknown[]) => mockSaveRecentItems(...args),
}));

vi.mock('@/services/agent', () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
}));

vi.mock('@/services/auth', () => ({
  getUser: (...args: unknown[]) => mockGetUser(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
}));

vi.mock('@/services/authentication', () => ({
  getAllAuthentications: (...args: unknown[]) => mockGetAllAuthentications(...args),
}));

vi.mock('@/services/container', () => ({
  getAllContainers: (...args: unknown[]) => mockGetAllContainers(...args),
}));

vi.mock('@/services/image-icon', () => ({
  getEffectiveDisplayIcon: (...args: unknown[]) => mockGetEffectiveDisplayIcon(...args),
}));

vi.mock('@/services/notification', () => ({
  getAllNotificationRules: (...args: unknown[]) => mockGetAllNotificationRules(...args),
}));

vi.mock('@/services/registry', () => ({
  getAllRegistries: (...args: unknown[]) => mockGetAllRegistries(...args),
}));

vi.mock('@/services/server', () => ({
  getServer: (...args: unknown[]) => mockGetServer(...args),
}));

vi.mock('@/services/trigger', () => ({
  getAllTriggers: (...args: unknown[]) => mockGetAllTriggers(...args),
}));

vi.mock('@/services/watcher', () => ({
  getAllWatchers: (...args: unknown[]) => mockGetAllWatchers(...args),
}));

vi.mock('@/services/sse', () => ({
  default: {
    connect: (...args: unknown[]) => mockSseConnect(...args),
    disconnect: (...args: unknown[]) => mockSseDisconnect(...args),
  },
}));

function mountLayout(stubs: Record<string, unknown> = {}) {
  return mountWithPlugins(AppLayout, {
    shallow: true,
    global: {
      stubs: {
        RouterLink: true,
        RouterView: true,
        NotificationBell: true,
        ThemeToggle: true,
        AnnouncementBanner: false,
        'i18n-t': false,
        ...stubs,
      },
    },
  });
}

describe('AppLayout', () => {
  const mountedWrappers: VueWrapper[] = [];
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setI18nLocale('en');
    localStorage.clear();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    mockGetAllContainers.mockResolvedValue([]);
    mockGetAgents.mockResolvedValue([]);
    mockGetAllTriggers.mockResolvedValue([]);
    mockGetAllWatchers.mockResolvedValue([]);
    mockGetAllRegistries.mockResolvedValue([]);
    mockGetServer.mockResolvedValue({
      compatibility: {
        legacyInputs: {
          total: 0,
          env: { total: 0, keys: [] },
          label: { total: 0, keys: [] },
        },
        curlHealthcheckOverride: {
          detected: false,
        },
      },
    });
    mockGetAllAuthentications.mockResolvedValue([]);
    mockGetAllNotificationRules.mockResolvedValue([]);
    mockGetEffectiveDisplayIcon.mockReturnValue('docker');
    mockGetUser.mockResolvedValue(null);
    mockLoadRecentItems.mockReturnValue([]);
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('layout spacing', () => {
    it('labels the notification delivery queue as Outbox with an outbox icon', async () => {
      const wrapper = mountLayout();
      mountedWrappers.push(wrapper);
      await flushPromises();

      const navItem = wrapper
        .findAll('.nav-item-wrapper')
        .find((candidate) => candidate.text().includes('Outbox'));

      expect(navItem).toBeDefined();
      expect(navItem?.text()).not.toContain('Notification outbox');
      expect(navItem?.find('.app-icon-stub').attributes('data-icon')).toBe('outbox');
    });

    it('applies asymmetric horizontal padding on main: pl-6 left, pr-[9px] right', async () => {
      const wrapper = mountLayout();
      mountedWrappers.push(wrapper);
      await flushPromises();

      const main = wrapper.find('main');
      expect(main.exists()).toBe(true);
      expect(main.classes()).toContain('sm:pl-6');
      expect(main.classes()).toContain('sm:pr-[9px]');
    });

    it('does not use symmetric horizontal padding on main', async () => {
      const wrapper = mountLayout();
      mountedWrappers.push(wrapper);
      await flushPromises();

      const main = wrapper.find('main');
      expect(main.classes()).not.toContain('sm:px-6');
    });

    it('truncates long usernames in the user menu header', async () => {
      const longUsername = 'avery-long-username-that-should-not-expand-the-menu';
      mockGetUser.mockResolvedValue({ username: longUsername });

      const wrapper = mountLayout({
        AppButton: {
          inheritAttrs: false,
          template: '<button v-bind="$attrs"><slot /></button>',
        },
      });
      mountedWrappers.push(wrapper);
      await flushPromises();

      const userMenuButton = wrapper.find('button[aria-label="User menu"]');
      expect(userMenuButton.exists()).toBe(true);
      await userMenuButton.trigger('click');
      await flushPromises();

      const header = wrapper
        .findAll('div')
        .find((candidate) => candidate.text().trim() === longUsername);

      expect(header).toBeDefined();
      expect(header?.classes()).toContain('max-w-[220px]');
      expect(header?.classes()).toContain('truncate');
    });
  });

  it('starts connectivity polling only after a disconnect event', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    try {
      const wrapper = mountLayout();
      mountedWrappers.push(wrapper);
      await flushPromises();

      expect(setIntervalSpy).not.toHaveBeenCalled();

      const emit = mockSseConnect.mock.calls[0]?.[0]?.emit as
        | ((event: string, payload?: unknown) => void)
        | undefined;
      expect(emit).toBeTypeOf('function');

      emit?.('connection-lost');
      await flushPromises();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);
    } finally {
      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('forwards preference update bus events to a window CustomEvent', async () => {
    const listener = vi.fn();
    window.addEventListener('dd:sse-preferences-updated', listener);
    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();
    const emit = mockSseConnect.mock.calls[0]?.[0]?.emit as (
      event: string,
      payload: unknown,
    ) => void;
    emit('preferences-updated', { username: 'alice' });
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ username: 'alice' });
    window.removeEventListener('dd:sse-preferences-updated', listener);
  });

  it('stops connectivity polling when SSE reconnects', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    try {
      const wrapper = mountLayout();
      mountedWrappers.push(wrapper);
      await flushPromises();

      const emit = mockSseConnect.mock.calls[0]?.[0]?.emit as
        | ((event: string, payload?: unknown) => void)
        | undefined;
      expect(emit).toBeTypeOf('function');

      emit?.('connection-lost');
      await flushPromises();

      const pollTimer = setIntervalSpy.mock.results[0]?.value;
      emit?.('sse:connected');
      await flushPromises();

      expect(clearIntervalSpy).toHaveBeenCalledWith(pollTimer);
    } finally {
      clearIntervalSpy.mockRestore();
      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('stops connectivity polling when connectivity check succeeds', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

    try {
      const wrapper = mountLayout();
      mountedWrappers.push(wrapper);
      await flushPromises();

      const emit = mockSseConnect.mock.calls[0]?.[0]?.emit as
        | ((event: string, payload?: unknown) => void)
        | undefined;
      expect(emit).toBeTypeOf('function');

      emit?.('connection-lost');
      await flushPromises();

      const pollTimer = setIntervalSpy.mock.results[0]?.value;

      vi.advanceTimersByTime(5_000);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledWith('/auth/user', {
        credentials: 'include',
        redirect: 'manual',
      });
      expect(mockSseDisconnect).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).toHaveBeenCalledWith(pollTimer);
    } finally {
      clearIntervalSpy.mockRestore();
      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('debounces burst scan/container SSE events into one sidebar refresh', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountLayout();
      mountedWrappers.push(wrapper);
      await flushPromises();

      const emit = mockSseConnect.mock.calls[0]?.[0]?.emit as
        | ((event: string, payload?: unknown) => void)
        | undefined;
      expect(emit).toBeTypeOf('function');

      const baselineCalls = mockGetAllContainers.mock.calls.length;

      emit?.('container-changed');
      emit?.('scan-completed');
      emit?.('container-changed');
      await flushPromises();

      expect(mockGetAllContainers).toHaveBeenCalledTimes(baselineCalls);

      vi.advanceTimersByTime(799);
      await flushPromises();
      expect(mockGetAllContainers).toHaveBeenCalledTimes(baselineCalls);

      vi.advanceTimersByTime(1);
      await flushPromises();
      expect(mockGetAllContainers).toHaveBeenCalledTimes(baselineCalls + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears pending SSE sidebar refresh on unmount', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountLayout();
      mountedWrappers.push(wrapper);
      await flushPromises();

      const emit = mockSseConnect.mock.calls[0]?.[0]?.emit as
        | ((event: string, payload?: unknown) => void)
        | undefined;
      expect(emit).toBeTypeOf('function');

      const baselineCalls = mockGetAllContainers.mock.calls.length;

      emit?.('scan-completed');
      await flushPromises();
      wrapper.unmount();

      vi.advanceTimersByTime(800);
      await flushPromises();
      expect(mockGetAllContainers).toHaveBeenCalledTimes(baselineCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not render retired OIDC or password-hash banners from stale metadata', async () => {
    mockGetAllAuthentications.mockResolvedValue([
      {
        id: 'oidc.legacy',
        type: 'oidc',
        configuration: { discovery: 'http://legacy.example.com' },
      },
      {
        id: 'basic.legacy',
        type: 'basic',
        metadata: { usesLegacyHash: true },
      },
    ]);

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    expect(wrapper.find('[data-testid="oidc-http-compat-banner"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="sha-hash-deprecation-banner"]').exists()).toBe(false);
  });

  it('shows a legacy trigger env banner with truncated key preview', async () => {
    mockGetServer.mockResolvedValue({
      compatibility: {
        legacyInputs: {
          total: 20,
          env: {
            total: 20,
            keys: [
              'DD_TRIGGER_DOCKER_LOCAL_AUTO',
              'DD_TRIGGER_DOCKER_LOCAL_PRUNE',
              'DD_TRIGGER_DOCKER_LOCAL_INCLUDE',
              'DD_TRIGGER_DOCKER_LOCAL_EXCLUDE',
              'DD_TRIGGER_DOCKER_LOCAL_NOTIFY',
              'DD_TRIGGER_DOCKER_LOCAL_INTERVAL',
              'DD_TRIGGER_DOCKER_LOCAL_TIMEOUT',
              'DD_TRIGGER_DOCKER_LOCAL_MODE',
            ],
          },
          label: { total: 0, keys: [] },
        },
      },
    });

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    const banner = wrapper.find('[data-testid="legacy-config-deprecation-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('20 legacy trigger inputs detected');
    expect(banner.text()).toContain('Env keys (20):');
    expect(banner.text()).toContain('DD_TRIGGER_DOCKER_LOCAL_AUTO');
    expect(banner.text()).toContain('(+2 more)');
    expect(banner.text()).toContain('DD_ACTION_*');
    expect(banner.text()).toContain('DD_NOTIFICATION_*');
    expect(banner.text()).toContain('View migration guide');

    const link = wrapper.find('[data-testid="legacy-config-deprecation-banner-link"]');
    expect(link.attributes('href')).toBe(
      'https://getdrydock.com/docs/deprecations#legacy-trigger-prefix',
    );
  });

  it('renders the legacy trigger banner title in the active non-English locale', async () => {
    setI18nLocale('de');
    mockGetServer.mockResolvedValue({
      compatibility: {
        legacyInputs: {
          total: 2,
          env: { total: 2, keys: ['DD_TRIGGER_DOCKER_LOCAL_AUTO'] },
          label: { total: 0, keys: [] },
        },
      },
    });

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    const banner = wrapper.find('[data-testid="legacy-config-deprecation-banner"]');
    expect(banner.text()).toContain('2 Legacy-Konfigurationsaliasse erkannt');
    expect(banner.text()).not.toContain('2 legacy trigger inputs detected');
  });

  it('shows consolidated legacy config banner when only labels are detected', async () => {
    mockGetServer.mockResolvedValue({
      compatibility: {
        legacyInputs: {
          total: 3,
          env: { total: 0, keys: [] },
          label: {
            total: 3,
            keys: ['dd.trigger.include', 'dd.trigger.exclude'],
          },
        },
      },
    });

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    const banner = wrapper.find('[data-testid="legacy-config-deprecation-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('3 legacy trigger inputs detected');
    expect(banner.text()).toContain('Label keys (3):');
    expect(banner.text()).toContain('dd.trigger.include');
  });

  it('shows a legacy API path deprecation banner when server reports API path usage', async () => {
    mockGetServer.mockResolvedValue({
      compatibility: {
        legacyInputs: {
          total: 7,
          env: { total: 0, keys: [] },
          label: { total: 0, keys: [] },
          api: {
            total: 7,
            keys: ['/api/containers', '/api/settings'],
          },
        },
      },
    });

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    const banner = wrapper.find('[data-testid="legacy-api-path-deprecation-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('7 requests to the removed API path detected');
    expect(banner.text()).toContain('/api/containers');
    expect(banner.text()).toContain('/api/*');
    expect(banner.text()).toContain('410');
    expect(banner.text()).toContain('/api/v1/*');
    expect(banner.text()).toContain('DD_COMPAT_WUDCARD=true');
    expect(banner.text()).toContain('View migration guide');

    const link = wrapper.find('[data-testid="legacy-api-path-deprecation-banner-link"]');
    expect(link.attributes('href')).toBe(
      'https://getdrydock.com/docs/deprecations#unversioned-api-paths',
    );
  });

  it('shows a curl healthcheck deprecation banner when server reports a custom override', async () => {
    mockGetServer.mockResolvedValue({
      compatibility: {
        legacyInputs: {
          total: 0,
          env: { total: 0, keys: [] },
          label: { total: 0, keys: [] },
        },
        curlHealthcheckOverride: {
          detected: true,
          commandPreview: 'CMD-SHELL curl --fail http://localhost:3000/health || exit 1',
        },
      },
    });

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    const banner = wrapper.find('[data-testid="curl-healthcheck-deprecation-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('custom curl-based healthcheck override');
    expect(banner.text()).toContain('v1.7.0');
    expect(banner.text()).toContain('/bin/healthcheck');
    expect(banner.text()).toContain('View migration guide');

    const link = wrapper.find('[data-testid="curl-healthcheck-deprecation-banner-link"]');
    expect(link.attributes('href')).toBe(
      'https://getdrydock.com/docs/deprecations#curl-healthcheck-override',
    );
  });

  it('dismisses consolidated legacy config banner', async () => {
    mockGetServer.mockResolvedValue({
      compatibility: {
        legacyInputs: {
          total: 2,
          env: { total: 1, keys: ['DD_TRIGGER_DOCKER_LOCAL_AUTO'] },
          label: { total: 1, keys: ['wud.watch'] },
        },
      },
    });

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    expect(wrapper.find('[data-testid="legacy-config-deprecation-banner"]').exists()).toBe(true);

    await wrapper
      .find(
        '[data-testid="legacy-config-deprecation-banner-dismiss-forever"] input[type="checkbox"]',
      )
      .setValue(true);
    await wrapper
      .find('[data-testid="legacy-config-deprecation-banner-dismiss-session"]')
      .trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="legacy-config-deprecation-banner"]').exists()).toBe(false);
    expect(localStorage.getItem('dd-banner-legacy-config-v1')).toBe('true');
  });

  describe('self-update connectivity polling', () => {
    function setupSelfUpdateTest() {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      return { setIntervalSpy, clearIntervalSpy };
    }

    function getEmit(wrapper: VueWrapper) {
      void wrapper;
      return mockSseConnect.mock.calls[0]?.[0]?.emit as
        | ((event: string, payload?: unknown) => void)
        | undefined;
    }

    it('polls status endpoint (not /auth/user) when self-update mode is active with opId', async () => {
      const { setIntervalSpy, clearIntervalSpy } = setupSelfUpdateTest();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'in-progress' }),
      } as unknown as Response);

      try {
        const wrapper = mountLayout();
        mountedWrappers.push(wrapper);
        await flushPromises();

        const emit = getEmit(wrapper);
        expect(emit).toBeTypeOf('function');

        emit?.('self-update', { opId: 'abc-123' });
        await flushPromises();

        vi.advanceTimersByTime(5_000);
        await flushPromises();

        expect(mockFetch).toHaveBeenCalledWith('/api/v1/self-update/abc-123/status', {
          credentials: 'include',
          redirect: 'manual',
        });
        expect(mockFetch).not.toHaveBeenCalledWith('/auth/user', expect.anything());
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('does not recover when status is in-progress — keeps polling', async () => {
      const { setIntervalSpy, clearIntervalSpy } = setupSelfUpdateTest();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'in-progress' }),
      } as unknown as Response);

      try {
        const wrapper = mountLayout();
        mountedWrappers.push(wrapper);
        await flushPromises();

        const emit = getEmit(wrapper);
        emit?.('self-update', { opId: 'abc-123' });
        await flushPromises();

        const pollTimer = setIntervalSpy.mock.results[0]?.value;
        const fetchCallsBefore = mockFetch.mock.calls.length;

        vi.advanceTimersByTime(5_000);
        await flushPromises();

        expect(mockSseDisconnect).not.toHaveBeenCalled();
        expect(clearIntervalSpy).not.toHaveBeenCalledWith(pollTimer);

        // A second poll tick still fires.
        vi.advanceTimersByTime(5_000);
        await flushPromises();

        expect(mockFetch.mock.calls.length - fetchCallsBefore).toBe(2);
        expect(mockSseDisconnect).not.toHaveBeenCalled();
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it.each([
      ['succeeded'],
      ['rolled-back'],
      ['expired'],
    ])('recovers when status is %s', async (terminalStatus) => {
      const { setIntervalSpy, clearIntervalSpy } = setupSelfUpdateTest();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: terminalStatus }),
      } as unknown as Response);

      try {
        const wrapper = mountLayout();
        mountedWrappers.push(wrapper);
        await flushPromises();

        const emit = getEmit(wrapper);
        emit?.('self-update', { opId: 'abc-123' });
        await flushPromises();

        const pollTimer = setIntervalSpy.mock.results[0]?.value;

        vi.advanceTimersByTime(5_000);
        await flushPromises();

        expect(mockSseDisconnect).toHaveBeenCalledTimes(1);
        expect(clearIntervalSpy).toHaveBeenCalledWith(pollTimer);
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('recovers on 404 (operation unknown)', async () => {
      const { setIntervalSpy, clearIntervalSpy } = setupSelfUpdateTest();
      mockFetch.mockResolvedValue({ ok: false, status: 404 } as Response);

      try {
        const wrapper = mountLayout();
        mountedWrappers.push(wrapper);
        await flushPromises();

        const emit = getEmit(wrapper);
        emit?.('self-update', { opId: 'abc-123' });
        await flushPromises();

        const pollTimer = setIntervalSpy.mock.results[0]?.value;

        vi.advanceTimersByTime(5_000);
        await flushPromises();

        expect(mockSseDisconnect).toHaveBeenCalledTimes(1);
        expect(clearIntervalSpy).toHaveBeenCalledWith(pollTimer);
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('does not recover on 500 — keeps polling', async () => {
      const { setIntervalSpy, clearIntervalSpy } = setupSelfUpdateTest();
      mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);

      try {
        const wrapper = mountLayout();
        mountedWrappers.push(wrapper);
        await flushPromises();

        const emit = getEmit(wrapper);
        emit?.('self-update', { opId: 'abc-123' });
        await flushPromises();

        const pollTimer = setIntervalSpy.mock.results[0]?.value;

        vi.advanceTimersByTime(5_000);
        await flushPromises();

        expect(mockSseDisconnect).not.toHaveBeenCalled();
        expect(clearIntervalSpy).not.toHaveBeenCalledWith(pollTimer);
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('does not recover on fetch rejection (mid-restart network error)', async () => {
      const { setIntervalSpy, clearIntervalSpy } = setupSelfUpdateTest();
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      try {
        const wrapper = mountLayout();
        mountedWrappers.push(wrapper);
        await flushPromises();

        const emit = getEmit(wrapper);
        emit?.('self-update', { opId: 'abc-123' });
        await flushPromises();

        const pollTimer = setIntervalSpy.mock.results[0]?.value;

        vi.advanceTimersByTime(5_000);
        await flushPromises();

        expect(mockSseDisconnect).not.toHaveBeenCalled();
        expect(clearIntervalSpy).not.toHaveBeenCalledWith(pollTimer);
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('does not recover when response body is unparseable', async () => {
      const { setIntervalSpy, clearIntervalSpy } = setupSelfUpdateTest();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response);

      try {
        const wrapper = mountLayout();
        mountedWrappers.push(wrapper);
        await flushPromises();

        const emit = getEmit(wrapper);
        emit?.('self-update', { opId: 'abc-123' });
        await flushPromises();

        const pollTimer = setIntervalSpy.mock.results[0]?.value;

        vi.advanceTimersByTime(5_000);
        await flushPromises();

        expect(mockSseDisconnect).not.toHaveBeenCalled();
        expect(clearIntervalSpy).not.toHaveBeenCalledWith(pollTimer);
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('falls back to /auth/user when self-update event has no opId, and recovers on 200', async () => {
      const { setIntervalSpy, clearIntervalSpy } = setupSelfUpdateTest();
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

      try {
        const wrapper = mountLayout();
        mountedWrappers.push(wrapper);
        await flushPromises();

        const emit = getEmit(wrapper);
        // Emit self-update without opId
        emit?.('self-update', {});
        await flushPromises();

        const pollTimer = setIntervalSpy.mock.results[0]?.value;

        vi.advanceTimersByTime(5_000);
        await flushPromises();

        expect(mockFetch).toHaveBeenCalledWith('/auth/user', {
          credentials: 'include',
          redirect: 'manual',
        });
        expect(mockFetch).not.toHaveBeenCalledWith(
          expect.stringContaining('/api/v1/self-update'),
          expect.anything(),
        );
        expect(mockSseDisconnect).toHaveBeenCalledTimes(1);
        expect(clearIntervalSpy).toHaveBeenCalledWith(pollTimer);
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  it('renders search hint footer connector text through i18n keys', async () => {
    // Un-stub Teleport so the search overlay (teleported to body) actually renders its content.
    const wrapper = mountLayout({ teleport: false });
    mountedWrappers.push(wrapper);
    await flushPromises();

    // Open the search overlay by setting the reactive state directly (deterministic in shallow mount).
    (wrapper.vm as unknown as { showSearch: boolean }).showSearch = true;
    await flushPromises();

    // With no scope prefix the v-else branch renders the connector fragments via i18n keys
    // (slashComma / atOrConnector / hashSemicolon).
    const rendered = `${document.body.textContent ?? ''}${wrapper.html()}`;
    expect(rendered).toContain(', or');
    expect(rendered).toContain('; use');
  });
});
