import { defineComponent, nextTick } from 'vue';

const mockGetServer = vi.fn();
const mockGetAppInfos = vi.fn();
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockClearIconCache = vi.fn();
const mockGetUser = vi.fn();
const mockGetLog = vi.fn();
const mockGetLogEntries = vi.fn();

vi.mock('@/services/app', () => ({
  getAppInfos: (...args: any[]) => mockGetAppInfos(...args),
}));

vi.mock('@/services/server', () => ({
  getServer: (...args: any[]) => mockGetServer(...args),
}));

vi.mock('@/services/settings', () => ({
  getSettings: (...args: any[]) => mockGetSettings(...args),
  updateSettings: (...args: any[]) => mockUpdateSettings(...args),
  clearIconCache: (...args: any[]) => mockClearIconCache(...args),
}));

vi.mock('@/services/auth', () => ({
  getUser: (...args: any[]) => mockGetUser(...args),
}));

vi.mock('@/services/log', () => ({
  getLog: (...args: any[]) => mockGetLog(...args),
  getLogEntries: (...args: any[]) => mockGetLogEntries(...args),
}));

const { mockScrollBlocked, mockAutoFetchInterval } = vi.hoisted(() => {
  // Create minimal ref-like objects with __v_isRef so Vue's template compiler unwraps them
  function fakeRef<T>(val: T) {
    return { value: val, __v_isRef: true as const };
  }
  return { mockScrollBlocked: fakeRef(false), mockAutoFetchInterval: fakeRef(0) };
});

vi.mock('@/composables/useLogViewerBehavior', () => ({
  useLogViewport: () => ({
    logContainer: { value: null, __v_isRef: true },
    scrollBlocked: mockScrollBlocked,
    scrollToBottom: vi.fn(),
    handleLogScroll: vi.fn(),
    resumeAutoScroll: vi.fn(),
  }),
  useAutoFetchLogs: () => ({ autoFetchInterval: mockAutoFetchInterval }),
  LOG_AUTO_FETCH_INTERVALS: [
    { label: 'Off', value: 0 },
    { label: '2s', value: 2000 },
    { label: '5s', value: 5000 },
    { label: '10s', value: 10000 },
    { label: '30s', value: 30000 },
  ],
}));

const mockRouteQuery = vi.hoisted(() => ({ value: {} as Record<string, string> }));

const {
  mockFontOptions,
  mockActiveFont,
  mockFontLoading,
  mockSetFont,
  mockIsFontLoaded,
  resetMockFontState,
} = vi.hoisted(() => {
  const mockFontOptions = [
    {
      id: 'ibm-plex-mono',
      label: 'IBM Plex Mono',
      family: '"IBM Plex Mono", monospace',
      weights: [300, 400, 500, 600, 700],
      bundled: true,
    },
    {
      id: 'jetbrains-mono',
      label: 'JetBrains Mono',
      family: '"JetBrains Mono", monospace',
      weights: [300, 400, 500, 600, 700],
      bundled: false,
    },
    {
      id: 'source-code-pro',
      label: 'Source Code Pro',
      family: '"Source Code Pro", monospace',
      weights: [300, 400, 500, 600, 700],
      bundled: false,
    },
    {
      id: 'inconsolata',
      label: 'Inconsolata',
      family: '"Inconsolata", monospace',
      weights: [300, 400, 500, 600, 700],
      bundled: false,
    },
    {
      id: 'commit-mono',
      label: 'Commit Mono',
      family: '"Commit Mono", monospace',
      weights: [400],
      bundled: false,
    },
    {
      id: 'comic-mono',
      label: 'Comic Mono',
      family: '"Comic Mono", monospace',
      weights: [400],
      bundled: false,
    },
  ] as const;

  const mockActiveFont = { value: 'ibm-plex-mono', __v_isRef: true as const };
  const mockFontLoading = { value: false, __v_isRef: true as const };
  const mockSetFont = vi.fn(async (id: string) => {
    const selected = mockFontOptions.find((font) => font.id === id);
    if (!selected) {
      return;
    }
    mockActiveFont.value = selected.id;
    localStorage.setItem('drydock-font-family', selected.id);
    document.documentElement.style.setProperty('--drydock-font', selected.family);
    document.documentElement.style.setProperty('--font-mono', selected.family);
  });
  const mockIsFontLoaded = vi.fn(() => true);

  const resetMockFontState = () => {
    mockActiveFont.value = 'ibm-plex-mono';
    mockFontLoading.value = false;
    mockSetFont.mockClear();
    mockIsFontLoaded.mockClear();
    localStorage.removeItem('drydock-font-family');
    document.documentElement.style.setProperty('--drydock-font', '"IBM Plex Mono", monospace');
    document.documentElement.style.setProperty('--font-mono', '"IBM Plex Mono", monospace');
  };

  return {
    mockFontOptions,
    mockActiveFont,
    mockFontLoading,
    mockSetFont,
    mockIsFontLoaded,
    resetMockFontState,
  };
});

vi.mock('vue-router', () => ({
  useRoute: () => ({
    query: mockRouteQuery.value,
  }),
}));

vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    themeFamily: { value: 'drydock' },
    themeVariant: { value: 'dark' },
    isDark: { value: true },
    setThemeFamily: vi.fn(),
    transitionTheme: vi.fn((cb: () => void) => cb()),
  }),
}));

vi.mock('@/composables/useFont', () => ({
  useFont: () => ({
    activeFont: mockActiveFont,
    setFont: mockSetFont,
    fontLoading: mockFontLoading,
    isFontLoaded: mockIsFontLoaded,
  }),
  fontOptions: mockFontOptions,
}));

vi.mock('@/composables/useIcons', () => ({
  useIcons: () => ({
    iconLibrary: { value: 'ph-duotone' },
    setIconLibrary: vi.fn(),
    iconScale: { value: 1 },
    setIconScale: vi.fn(),
  }),
}));

vi.mock('@/icons', () => ({
  libraryLabels: { 'ph-duotone': 'Phosphor Duotone', lucide: 'Lucide' },
  iconMap: {
    dashboard: { 'ph-duotone': 'ph:squares-four-duotone', lucide: 'lucide:layout-dashboard' },
  },
}));

vi.mock('@/theme/palettes', () => ({
  themeFamilies: [
    {
      id: 'drydock',
      label: 'Drydock',
      description: 'Navy tones',
      swatchDark: '#0f172a',
      swatchLight: '#f8fafc',
      accent: '#0096C7',
    },
    {
      id: 'github',
      label: 'GitHub',
      description: 'Clean',
      swatchDark: '#0d1117',
      swatchLight: '#fff',
      accent: '#58a6ff',
    },
  ],
}));

import { mount } from '@vue/test-utils';
import ConfigView from '@/views/ConfigView.vue';
import ToggleSwitch from '@/components/ToggleSwitch.vue';

const stubs: Record<string, any> = {
  DataViewLayout: defineComponent({
    template: '<div class="data-view-layout-stub"><slot /></div>',
  }),
  AppIcon: defineComponent({
    props: ['name', 'size'],
    template: '<span class="app-icon-stub" :data-icon="name" />',
  }),
  ThemeToggle: defineComponent({
    props: ['size'],
    template: '<div class="theme-toggle-stub" />',
  }),
  'iconify-icon': defineComponent({
    props: ['icon', 'width', 'height'],
    template: '<span class="iconify-stub" />',
  }),
};

function factory() {
  return mount(ConfigView, { global: { stubs, components: { ToggleSwitch } }, shallow: false });
}

describe('ConfigView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteQuery.value = {};
    mockScrollBlocked.value = false;
    mockAutoFetchInterval.value = 0;
    resetMockFontState();
    mockGetUser.mockResolvedValue({
      username: 'admin',
      email: 'admin@test.com',
      role: 'admin',
      lastLogin: '2026-01-01',
      sessions: 2,
    });
    mockGetAppInfos.mockResolvedValue({ version: '1.4.0' });
    mockGetLog.mockResolvedValue({ level: 'info' });
    mockGetLogEntries.mockResolvedValue([]);
  });

  describe('on mount', () => {
    it('fetches server info and settings', async () => {
      mockGetServer.mockResolvedValue({
        configuration: {
          port: 3000,
          feature: { containeractions: true, delete: false },
          webhook: { enabled: true },
          trustproxy: false,
        },
      });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      factory();
      await vi.waitFor(() => {
        expect(mockGetServer).toHaveBeenCalledOnce();
        expect(mockGetAppInfos).toHaveBeenCalledOnce();
        expect(mockGetSettings).toHaveBeenCalledOnce();
      });
    });

    it('displays server fields after loading', async () => {
      mockGetServer.mockResolvedValue({
        configuration: {
          port: 8080,
          feature: { containeractions: false, delete: true },
          webhook: { enabled: false },
          trustproxy: true,
        },
      });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => {
        expect(w.text()).not.toContain('Loading');
      });

      const text = w.text();
      expect(text).toContain('1.4.0');
      expect(text).toContain('8080');
      expect(text).toContain('Enabled'); // trustproxy
    });

    it('shows default values when server fetch fails', async () => {
      mockGetServer.mockRejectedValue(new Error('fail'));
      mockGetAppInfos.mockRejectedValue(new Error('fail'));
      mockGetSettings.mockRejectedValue(new Error('fail'));

      const w = factory();
      await vi.waitFor(() => {
        expect(w.text()).not.toContain('Loading');
      });

      const text = w.text();
      // Falls back to defaults when all fetches fail (each is .catch(() => null))
      expect(text).toContain('unknown');
      expect(text).toContain('3000');
    });
  });

  describe('tab switching', () => {
    it('shows general tab by default', async () => {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => expect(mockGetServer).toHaveBeenCalled());
      await nextTick();

      expect(w.text()).toContain('Application');
      expect(w.text()).toContain('Network');
    });

    it('switches to appearance tab on click', async () => {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => expect(mockGetServer).toHaveBeenCalled());
      await nextTick();

      const tabs = w.findAll('button');
      const appearanceTab = tabs.find((t) => t.text().includes('Appearance'));
      expect(appearanceTab).toBeDefined();
      await appearanceTab?.trigger('click');
      await nextTick();

      expect(w.text()).toContain('Color Theme');
      expect(w.text()).toContain('Font Family');
      expect(w.text()).toContain('Icon Library');
    });
  });

  describe('internetless mode toggle', () => {
    it('calls updateSettings when toggled', async () => {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });
      mockUpdateSettings.mockResolvedValue({ internetlessMode: true });

      const w = factory();
      await vi.waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
      await nextTick();
      await nextTick();

      // Find the toggle button (the one inside the Network section)
      const allButtons = w.findAll('button');
      const toggleBtn = allButtons.find((b) => b.classes().some((c) => c.includes('w-10')));
      expect(toggleBtn).toBeDefined();
      await toggleBtn?.trigger('click');

      await vi.waitFor(() => {
        expect(mockUpdateSettings).toHaveBeenCalledWith({ internetlessMode: true });
      });
    });
  });

  describe('cache clear', () => {
    it('calls clearIconCache and shows result', async () => {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });
      mockClearIconCache.mockResolvedValue({ cleared: 42 });

      const w = factory();
      await vi.waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
      await nextTick();
      await nextTick();

      const allButtons = w.findAll('button');
      const clearBtn = allButtons.find((b) => b.text().includes('Clear Cache'));
      expect(clearBtn).toBeDefined();
      await clearBtn?.trigger('click');

      await vi.waitFor(() => {
        expect(mockClearIconCache).toHaveBeenCalledOnce();
      });
      await nextTick();

      expect(w.text()).toContain('42 cleared');
    });
  });

  describe('appearance tab', () => {
    async function mountAppearanceTab() {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => expect(mockGetServer).toHaveBeenCalled());
      await nextTick();

      const tabs = w.findAll('button');
      const appearanceTab = tabs.find((t) => t.text().includes('Appearance'));
      await appearanceTab?.trigger('click');
      await nextTick();
      return w;
    }

    it('renders theme family selection buttons', async () => {
      const w = await mountAppearanceTab();
      expect(w.text()).toContain('Drydock');
      expect(w.text()).toContain('GitHub');
    });

    it('renders font options', async () => {
      const w = await mountAppearanceTab();
      expect(w.text()).toContain('IBM Plex Mono');
      expect(w.text()).toContain('JetBrains Mono');
    });

    it('updates global app shell font tokens when each font is selected', async () => {
      const w = await mountAppearanceTab();
      const appShellProbe = document.createElement('div');
      appShellProbe.className = 'font-mono';
      appShellProbe.style.fontFamily = 'var(--font-mono)';
      document.body.appendChild(appShellProbe);

      try {
        for (const font of mockFontOptions) {
          const fontButton = w.findAll('button').find((btn) => btn.text().includes(font.label));
          expect(fontButton).toBeDefined();

          await fontButton?.trigger('click');
          await nextTick();

          await vi.waitFor(() => {
            expect(mockSetFont).toHaveBeenCalledWith(font.id);
            expect(mockActiveFont.value).toBe(font.id);
          });

          const rootStyles = getComputedStyle(document.documentElement);
          expect(rootStyles.getPropertyValue('--drydock-font').trim()).toBe(font.family);
          expect(rootStyles.getPropertyValue('--font-mono').trim()).toBe(font.family);
          expect(localStorage.getItem('drydock-font-family')).toBe(font.id);
          // App shell text uses Tailwind's `font-mono`, which resolves from --font-mono.
          expect(appShellProbe.style.fontFamily).toBe('var(--font-mono)');
        }
      } finally {
        appShellProbe.remove();
      }
    });

    it('renders icon library options', async () => {
      const w = await mountAppearanceTab();
      expect(w.text()).toContain('Phosphor Duotone');
      expect(w.text()).toContain('Lucide');
    });

    it('shows icon size slider', async () => {
      const w = await mountAppearanceTab();
      const slider = w.find('input[type="range"]');
      expect(slider.exists()).toBe(true);
    });
  });

  describe('profile tab', () => {
    async function mountProfileTab() {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => expect(mockGetServer).toHaveBeenCalled());
      await nextTick();

      const tabs = w.findAll('button');
      const profileTab = tabs.find((t) => t.text().includes('Profile'));
      await profileTab?.trigger('click');
      await nextTick();
      return w;
    }

    it('renders profile tab button', async () => {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => expect(mockGetServer).toHaveBeenCalled());
      await nextTick();

      const tabs = w.findAll('button');
      const profileTab = tabs.find((t) => t.text().includes('Profile'));
      expect(profileTab).toBeDefined();
    });

    it('shows profile data after loading', async () => {
      const w = await mountProfileTab();
      await vi.waitFor(() => expect(mockGetUser).toHaveBeenCalled());
      await nextTick();

      const text = w.text();
      expect(text).toContain('admin');
      expect(text).toContain('admin@test.com');
    });

    it('shows profile error state when user fetch fails', async () => {
      mockGetUser.mockRejectedValueOnce(new Error('profile boom'));
      const w = await mountProfileTab();
      await vi.waitFor(() => expect(mockGetUser).toHaveBeenCalled());
      await nextTick();

      expect(w.text()).toContain('profile boom');
    });

    it('retries profile fetch from refresh button', async () => {
      mockGetUser.mockRejectedValueOnce(new Error('first failure')).mockResolvedValueOnce({
        username: 'admin',
        displayName: 'Admin User',
        email: 'admin@test.com',
        role: 'admin',
        provider: 'basic',
        sessions: 2,
      });

      const w = await mountProfileTab();
      await vi.waitFor(() => expect(mockGetUser).toHaveBeenCalledTimes(1));
      expect(w.text()).toContain('first failure');

      const refreshButton = w.find('[data-testid="profile-refresh"]');
      expect(refreshButton.exists()).toBe(true);
      await refreshButton.trigger('click');

      await vi.waitFor(() => expect(mockGetUser).toHaveBeenCalledTimes(2));
      expect(w.text()).toContain('Admin User');
      expect(w.text()).toContain('basic');
    });

    it('selects profile tab from query param', async () => {
      mockRouteQuery.value = { tab: 'profile' };
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => expect(mockGetUser).toHaveBeenCalled());
      await nextTick();
      await nextTick();

      const text = w.text();
      expect(text).toContain('Username');
      expect(text).toContain('Active Sessions');
    });
  });

  describe('logs tab', () => {
    async function mountLogsTab() {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => expect(mockGetServer).toHaveBeenCalled());
      await nextTick();

      const tabs = w.findAll('button');
      const logsTab = tabs.find((t) => t.text().includes('Logs'));
      await logsTab?.trigger('click');
      await vi.waitFor(() => expect(mockGetLogEntries).toHaveBeenCalled());
      await nextTick();
      return w;
    }

    it('fetches and displays application logs', async () => {
      mockGetLog.mockResolvedValue({ level: 'debug' });
      mockGetLogEntries.mockResolvedValue([
        {
          timestamp: '2026-02-23T10:15:00.000Z',
          level: 'error',
          component: 'watcher',
          msg: 'something failed',
        },
      ]);

      const w = await mountLogsTab();

      expect(mockGetLog).toHaveBeenCalled();
      expect(mockGetLogEntries).toHaveBeenLastCalledWith({
        level: 'all',
        component: undefined,
        tail: 100,
      });
      expect(w.text()).toContain('Application Logs');
      expect(w.text()).toContain('Server Level');
      expect(w.text()).toContain('something failed');
    });

    it('applies log filters when clicking Apply', async () => {
      const w = await mountLogsTab();

      const selects = w.findAll('select');
      expect(selects.length).toBeGreaterThanOrEqual(2);
      await selects[0].setValue('error');
      await selects[1].setValue('500');

      const componentInput = w.find('input[placeholder="Filter by component..."]');
      expect(componentInput.exists()).toBe(true);
      await componentInput.setValue('api');

      const applyButton = w.findAll('button').find((b) => b.text().includes('Apply'));
      expect(applyButton).toBeDefined();
      await applyButton?.trigger('click');

      await vi.waitFor(() => {
        expect(mockGetLogEntries).toHaveBeenLastCalledWith({
          level: 'error',
          component: 'api',
          tail: 500,
        });
      });
    });

    it('renders auto-fetch interval selector', async () => {
      const w = await mountLogsTab();
      const selects = w.findAll('select');
      const autoFetchSelect = selects.find((s) => s.text().includes('Off'));
      expect(autoFetchSelect).toBeDefined();
      expect(autoFetchSelect?.text()).toContain('2s');
      expect(autoFetchSelect?.text()).toContain('5s');
    });

    it('renders refresh button', async () => {
      const w = await mountLogsTab();
      const refreshBtn = w
        .findAll('.app-icon-stub')
        .find((el) => el.attributes('data-icon') === 'refresh');
      expect(refreshBtn).toBeDefined();
    });

    it('shows scroll-paused indicator when scrollBlocked and auto-fetch active', async () => {
      mockScrollBlocked.value = true;
      mockAutoFetchInterval.value = 2000;
      const w = await mountLogsTab();
      expect(w.text()).toContain('Auto-scroll paused');
      const resumeBtn = w.findAll('button').find((b) => b.text().includes('Resume'));
      expect(resumeBtn).toBeDefined();
    });

    it('hides scroll-paused indicator when auto-fetch is off', async () => {
      mockScrollBlocked.value = true;
      mockAutoFetchInterval.value = 0;
      const w = await mountLogsTab();
      expect(w.text()).not.toContain('Auto-scroll paused');
    });
  });
});
