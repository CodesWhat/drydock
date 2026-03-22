import { flushPromises, type VueWrapper } from '@vue/test-utils';
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

function mountLayout() {
  return mountWithPlugins(AppLayout, {
    shallow: true,
    global: {
      stubs: {
        RouterLink: true,
        RouterView: true,
        NotificationBell: true,
        ThemeToggle: true,
        AnnouncementBanner: false,
      },
    },
  });
}

describe('AppLayout', () => {
  const mountedWrappers: VueWrapper[] = [];
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('shows an OIDC HTTP compatibility banner when an OIDC provider uses HTTP discovery', async () => {
    mockGetAllAuthentications.mockResolvedValue([
      {
        id: 'oidc.local-idp',
        type: 'oidc',
        name: 'local-idp',
        configuration: {
          discovery: 'http://dex:5556/.well-known/openid-configuration',
        },
      },
    ]);

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    const banner = wrapper.find('[data-testid="oidc-http-compat-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('Migrate your IdP to HTTPS');
  });

  it('supports dismissing OIDC HTTP compatibility banner for current session', async () => {
    mockGetAllAuthentications.mockResolvedValue([
      {
        id: 'oidc.local-idp',
        type: 'oidc',
        name: 'local-idp',
        configuration: {
          discovery: 'http://dex:5556/.well-known/openid-configuration',
        },
      },
    ]);

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    expect(wrapper.find('[data-testid="oidc-http-compat-banner"]').exists()).toBe(true);

    await wrapper.find('[data-testid="oidc-http-compat-banner-dismiss-session"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="oidc-http-compat-banner"]').exists()).toBe(false);
  });

  it('supports permanently dismissing OIDC HTTP compatibility banner', async () => {
    mockGetAllAuthentications.mockResolvedValue([
      {
        id: 'oidc.local-idp',
        type: 'oidc',
        name: 'local-idp',
        configuration: {
          discovery: 'http://dex:5556/.well-known/openid-configuration',
        },
      },
    ]);

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    expect(wrapper.find('[data-testid="oidc-http-compat-banner"]').exists()).toBe(true);

    await wrapper.find('[data-testid="oidc-http-compat-banner-dismiss-forever"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="oidc-http-compat-banner"]').exists()).toBe(false);
    expect(localStorage.getItem('dd-banner-oidc-http-discovery-v1')).toBe('true');
  });

  it('does not show OIDC HTTP compatibility banner after permanent dismissal is persisted', async () => {
    localStorage.setItem('dd-banner-oidc-http-discovery-v1', 'true');
    mockGetAllAuthentications.mockResolvedValue([
      {
        id: 'oidc.local-idp',
        type: 'oidc',
        name: 'local-idp',
        configuration: {
          discovery: 'http://dex:5556/.well-known/openid-configuration',
        },
      },
    ]);

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    expect(wrapper.find('[data-testid="oidc-http-compat-banner"]').exists()).toBe(false);
  });

  it('shows a legacy hash deprecation banner when basic auth uses non-argon hash', async () => {
    mockGetAllAuthentications.mockResolvedValue([
      {
        id: 'basic.admin',
        type: 'basic',
        name: 'admin',
        configuration: { user: 'admin', hash: '[REDACTED]' },
        metadata: { usesLegacyHash: true },
      },
    ]);

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    const banner = wrapper.find('[data-testid="sha-hash-deprecation-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('legacy password hash format');
  });

  it('supports dismissing legacy hash deprecation banner for current session', async () => {
    mockGetAllAuthentications.mockResolvedValue([
      {
        id: 'basic.admin',
        type: 'basic',
        name: 'admin',
        configuration: { user: 'admin', hash: '[REDACTED]' },
        metadata: { usesLegacyHash: true },
      },
    ]);

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    expect(wrapper.find('[data-testid="sha-hash-deprecation-banner"]').exists()).toBe(true);

    await wrapper
      .find('[data-testid="sha-hash-deprecation-banner-dismiss-session"]')
      .trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="sha-hash-deprecation-banner"]').exists()).toBe(false);
  });

  it('supports permanently dismissing legacy hash deprecation banner', async () => {
    mockGetAllAuthentications.mockResolvedValue([
      {
        id: 'basic.admin',
        type: 'basic',
        name: 'admin',
        configuration: { user: 'admin', hash: '[REDACTED]' },
        metadata: { usesLegacyHash: true },
      },
    ]);

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    expect(wrapper.find('[data-testid="sha-hash-deprecation-banner"]').exists()).toBe(true);

    await wrapper
      .find('[data-testid="sha-hash-deprecation-banner-dismiss-forever"]')
      .trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="sha-hash-deprecation-banner"]').exists()).toBe(false);
    expect(localStorage.getItem('dd-banner-sha-hash-v1')).toBe('true');
  });

  it('does not show legacy hash deprecation banner after permanent dismissal is persisted', async () => {
    localStorage.setItem('dd-banner-sha-hash-v1', 'true');
    mockGetAllAuthentications.mockResolvedValue([
      {
        id: 'basic.admin',
        type: 'basic',
        name: 'admin',
        configuration: { user: 'admin', hash: '[REDACTED]' },
        metadata: { usesLegacyHash: true },
      },
    ]);

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    expect(wrapper.find('[data-testid="sha-hash-deprecation-banner"]').exists()).toBe(false);
  });

  it('does not show legacy hash deprecation banner when basic auth uses argon2id hash', async () => {
    mockGetAllAuthentications.mockResolvedValue([
      {
        id: 'basic.admin',
        type: 'basic',
        name: 'admin',
        configuration: { user: 'admin', hash: '[REDACTED]' },
        metadata: { usesLegacyHash: false },
      },
    ]);

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    expect(wrapper.find('[data-testid="sha-hash-deprecation-banner"]').exists()).toBe(false);
  });

  it('shows a legacy env deprecation banner with truncated key preview', async () => {
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
              'WUD_SERVER_PORT',
              'WUD_WATCHER_LOCAL_WATCHBYDEFAULT',
            ],
          },
          label: { total: 0, keys: [] },
        },
      },
    });

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    const banner = wrapper.find('[data-testid="legacy-env-deprecation-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('20 legacy environment variables detected');
    expect(banner.text()).toContain('Env keys (20):');
    expect(banner.text()).toContain('DD_TRIGGER_DOCKER_LOCAL_AUTO');
    expect(banner.text()).toContain('(+2 more)');
  });

  it('shows a legacy label deprecation banner when legacy labels are detected', async () => {
    mockGetServer.mockResolvedValue({
      compatibility: {
        legacyInputs: {
          total: 3,
          env: { total: 0, keys: [] },
          label: {
            total: 3,
            keys: ['wud.tag.include', 'wud.tag.exclude', 'wud.watch'],
          },
        },
      },
    });

    const wrapper = mountLayout();
    mountedWrappers.push(wrapper);
    await flushPromises();

    const banner = wrapper.find('[data-testid="legacy-label-deprecation-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('3 legacy container labels detected');
    expect(banner.text()).toContain('Label keys (3):');
    expect(banner.text()).toContain('wud.watch');
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
    expect(banner.text()).toContain('7 legacy API paths detected');
    expect(banner.text()).toContain('/api/containers');
  });

  it('dismisses each legacy category banner independently', async () => {
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

    expect(wrapper.find('[data-testid="legacy-env-deprecation-banner"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="legacy-label-deprecation-banner"]').exists()).toBe(true);

    await wrapper
      .find('[data-testid="legacy-env-deprecation-banner-dismiss-forever"]')
      .trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="legacy-env-deprecation-banner"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="legacy-label-deprecation-banner"]').exists()).toBe(true);
    expect(localStorage.getItem('dd-banner-legacy-env-v1')).toBe('true');
    expect(localStorage.getItem('dd-banner-legacy-labels-v1')).toBeNull();
  });
});
