import { defineComponent, nextTick } from 'vue';

const mockGetServer = vi.fn();
const mockGetStore = vi.fn();
const mockGetAppInfos = vi.fn();
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockClearIconCache = vi.fn();
const mockDownloadDebugDump = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/services/app', () => ({
  getAppInfos: (...args: any[]) => mockGetAppInfos(...args),
}));

vi.mock('@/services/server', () => ({
  getServer: (...args: any[]) => mockGetServer(...args),
}));

vi.mock('@/services/store', () => ({
  getStore: (...args: any[]) => mockGetStore(...args),
}));

vi.mock('@/services/settings', () => ({
  getSettings: (...args: any[]) => mockGetSettings(...args),
  updateSettings: (...args: any[]) => mockUpdateSettings(...args),
  clearIconCache: (...args: any[]) => mockClearIconCache(...args),
}));

vi.mock('@/services/debug', () => ({
  downloadDebugDump: (...args: any[]) => mockDownloadDebugDump(...args),
}));

vi.mock('@/services/auth', () => ({
  getUser: (...args: any[]) => mockGetUser(...args),
}));

const mockDisableIconifyApi = vi.fn();
vi.mock('@/boot/icons', () => ({
  disableIconifyApi: (...args: any[]) => mockDisableIconifyApi(...args),
}));

const mockRouteQuery = vi.hoisted(() => ({ value: {} as Record<string, string | string[]> }));

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
  const fontClassPrefix = 'dd-font-';
  const fontClassNames = mockFontOptions.map((font) => `${fontClassPrefix}${font.id}`);

  const applyMockFontClass = (fontId: string) => {
    for (const className of fontClassNames) {
      document.documentElement.classList.remove(className);
    }
    document.documentElement.classList.add(`${fontClassPrefix}${fontId}`);
  };

  const mockSetFont = vi.fn(async (id: string) => {
    const selected = mockFontOptions.find((font) => font.id === id);
    if (!selected) {
      return;
    }
    mockActiveFont.value = selected.id;
    localStorage.setItem('drydock-font-family-v1', selected.id);
    applyMockFontClass(selected.id);
  });
  const mockIsFontLoaded = vi.fn(() => true);

  const resetMockFontState = () => {
    mockActiveFont.value = 'ibm-plex-mono';
    mockFontLoading.value = false;
    mockSetFont.mockClear();
    mockIsFontLoaded.mockClear();
    localStorage.removeItem('drydock-font-family-v1');
    applyMockFontClass('ibm-plex-mono');
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

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  const routeState = reactive({ query: {} as Record<string, string | string[]> });
  return {
    useRoute: () => {
      // Sync reactive state from hoisted ref (clear stale keys first)
      for (const key of Object.keys(routeState.query)) delete routeState.query[key];
      Object.assign(routeState.query, mockRouteQuery.value);
      return routeState;
    },
    useRouter: () => ({
      replace: (to: { query?: Record<string, string | string[]> }) => {
        if (to.query) {
          for (const key of Object.keys(routeState.query)) delete routeState.query[key];
          Object.assign(routeState.query, to.query);
          mockRouteQuery.value = { ...to.query };
        }
      },
    }),
  };
});

vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    themeFamily: { value: 'one-dark', __v_isRef: true },
    themeVariant: { value: 'dark', __v_isRef: true },
    isDark: { value: true, __v_isRef: true },
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
    iconLibrary: { value: 'ph-duotone', __v_isRef: true },
    setIconLibrary: vi.fn(),
    iconScale: { value: 1, __v_isRef: true },
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
      id: 'one-dark',
      label: 'One Dark',
      description: 'Clean and balanced',
      swatchDark: '#282c34',
      swatchLight: '#fafafa',
      accent: '#528bff',
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
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import ConfigView from '@/views/ConfigView.vue';

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
    resetMockFontState();
    mockGetUser.mockResolvedValue({
      username: 'admin',
      email: 'admin@test.com',
      role: 'admin',
      lastLogin: '2026-01-01',
      sessions: 2,
    });
    mockGetAppInfos.mockResolvedValue({ version: '1.4.0' });
    mockGetStore.mockResolvedValue({ configuration: { path: '/store', file: 'dd.json' } });
    mockDownloadDebugDump.mockResolvedValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      filename: 'drydock-debug-dump.json',
    });
  });

  describe('on mount', () => {
    it('fetches server info, store info, and settings', async () => {
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
        expect(mockGetStore).toHaveBeenCalledOnce();
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
          metrics: { auth: false },
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
      expect(text).toContain('Metrics Auth');
    });

    it('shows webhook API details when webhook is enabled', async () => {
      mockGetServer.mockResolvedValue({
        configuration: {
          port: 3000,
          feature: { containeractions: true, delete: false },
          webhook: { enabled: true },
          trustproxy: false,
        },
      });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => {
        expect(w.text()).not.toContain('Loading');
      });

      const text = w.text();
      expect(text).toContain('Webhook API');
      expect(text).toContain('POST /api/webhook/watch');
      expect(text).toContain('POST /api/webhook/watch/:name');
      expect(text).toContain('POST /api/webhook/update/:name');
      expect(text).toContain('curl -X POST');
      expect(text).toContain('/api/webhook/watch');
      expect(text).toContain('Authorization: Bearer YOUR_TOKEN');
    });

    it('keeps webhook API endpoints and curl example visible when webhook is disabled', async () => {
      mockGetServer.mockResolvedValue({
        configuration: {
          port: 3000,
          feature: { containeractions: true, delete: false },
          webhook: { enabled: false },
          trustproxy: false,
        },
      });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => {
        expect(w.text()).not.toContain('Loading');
      });

      const text = w.text();
      expect(text).toContain('Webhook API is disabled');
      expect(text).toContain('POST /api/webhook/watch');
      expect(text).toContain('POST /api/webhook/watch/:name');
      expect(text).toContain('POST /api/webhook/update/:name');
      expect(text).toContain('curl -X POST');
      expect(text).toContain('/api/webhook/watch');
      expect(text).toContain('Authorization: Bearer YOUR_TOKEN');
    });

    it('displays store fields after loading', async () => {
      mockGetServer.mockResolvedValue({
        configuration: {
          port: 3000,
          feature: { containeractions: true, delete: false },
          webhook: { enabled: true },
          trustproxy: false,
        },
      });
      mockGetStore.mockResolvedValue({
        configuration: { path: '/var/drydock', file: 'prod.json' },
      });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => {
        expect(w.text()).not.toContain('Loading');
      });

      const text = w.text();
      expect(text).toContain('Store');
      expect(text).toContain('/var/drydock');
      expect(text).toContain('prod.json');
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

    it('shows legacy compatibility warning banner with migration guidance', async () => {
      mockGetServer.mockResolvedValue({
        configuration: {
          port: 3000,
          feature: { containeractions: true, delete: false },
          webhook: { enabled: true },
          trustproxy: false,
        },
        compatibility: {
          legacyInputs: {
            total: 4,
            env: { total: 1, keys: ['WUD_SERVER_PORT'] },
            label: { total: 3, keys: ['wud.watch', 'wud.tag.include'] },
          },
        },
      });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => {
        expect(w.text()).not.toContain('Loading');
      });

      const text = w.text();
      expect(text).toContain('Legacy compatibility inputs detected');
      expect(text).toContain('WUD_SERVER_PORT');
      expect(text).toContain('wud.watch');
      expect(text).toContain('node dist/index.js config migrate --dry-run');
      expect(w.find('a[href="https://getdrydock.com/docs/quickstart"]').exists()).toBe(true);
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

    it('disables Iconify API when internetless mode is enabled', async () => {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });
      mockUpdateSettings.mockResolvedValue({ internetlessMode: true });

      const w = factory();
      await vi.waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
      await nextTick();
      await nextTick();

      const allButtons = w.findAll('button');
      const toggleBtn = allButtons.find((b) => b.classes().some((c) => c.includes('w-10')));
      await toggleBtn?.trigger('click');

      await vi.waitFor(() => {
        expect(mockDisableIconifyApi).toHaveBeenCalled();
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

  describe('debug dump download', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    let createObjectUrlSpy: ReturnType<typeof vi.fn>;
    let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      createObjectUrlSpy = vi.fn(() => 'blob:debug-dump');
      revokeObjectUrlSpy = vi.fn();
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: createObjectUrlSpy,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: revokeObjectUrlSpy,
      });
    });

    afterEach(() => {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL,
      });
    });

    it('downloads a debug dump from settings', async () => {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });

      const w = factory();
      await vi.waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
      await nextTick();

      const downloadButton = w.find('[data-test="download-debug-dump"]');
      expect(downloadButton.exists()).toBe(true);
      await downloadButton.trigger('click');

      await vi.waitFor(() => {
        expect(mockDownloadDebugDump).toHaveBeenCalledOnce();
      });
      expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:debug-dump');
    });

    it('shows debug dump download error', async () => {
      mockGetServer.mockResolvedValue({ configuration: {} });
      mockGetSettings.mockResolvedValue({ internetlessMode: false });
      mockDownloadDebugDump.mockRejectedValue(new Error('debug dump unavailable'));

      const w = factory();
      await vi.waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
      await nextTick();

      const downloadButton = w.find('[data-test="download-debug-dump"]');
      await downloadButton.trigger('click');

      await vi.waitFor(() => {
        expect(w.text()).toContain('debug dump unavailable');
      });
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

    it('does not emit invalid prop warnings when opening appearance tab', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        await mountAppearanceTab();

        const invalidPropWarnings = warnSpy.mock.calls.filter(([firstArg]) =>
          String(firstArg).includes('Invalid prop'),
        );
        expect(invalidPropWarnings).toHaveLength(0);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('renders theme family selection buttons', async () => {
      const w = await mountAppearanceTab();
      expect(w.text()).toContain('One Dark');
      expect(w.text()).toContain('GitHub');
    });

    it('renders font options', async () => {
      const w = await mountAppearanceTab();
      expect(w.text()).toContain('IBM Plex Mono');
      expect(w.text()).toContain('JetBrains Mono');
    });

    it('updates root font classes when each font is selected', async () => {
      const w = await mountAppearanceTab();

      for (const font of mockFontOptions) {
        const fontButton = w.findAll('button').find((btn) => btn.text().includes(font.label));
        expect(fontButton).toBeDefined();

        await fontButton?.trigger('click');
        await nextTick();

        await vi.waitFor(() => {
          expect(mockSetFont).toHaveBeenCalledWith(font.id);
          expect(mockActiveFont.value).toBe(font.id);
        });

        expect(document.documentElement.classList.contains(`dd-font-${font.id}`)).toBe(true);
        expect(localStorage.getItem('drydock-font-family-v1')).toBe(font.id);
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
});
