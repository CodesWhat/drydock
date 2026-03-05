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
      },
    },
  });
}

describe('AppLayout', () => {
  const mountedWrappers: VueWrapper[] = [];
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    mockGetAllContainers.mockResolvedValue([]);
    mockGetAgents.mockResolvedValue([]);
    mockGetAllTriggers.mockResolvedValue([]);
    mockGetAllWatchers.mockResolvedValue([]);
    mockGetAllRegistries.mockResolvedValue([]);
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
});
