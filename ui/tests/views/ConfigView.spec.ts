import { defineComponent, nextTick } from 'vue';

const mockGetServer = vi.fn();
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockClearIconCache = vi.fn();
const mockGetUser = vi.fn();

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

const mockRouteQuery = vi.hoisted(() => ({ value: {} as Record<string, string> }));

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
    activeFont: { value: 'ibm-plex-mono' },
    setFont: vi.fn(),
    fontLoading: { value: false },
    isFontLoaded: vi.fn(() => true),
  }),
  fontOptions: [
    {
      id: 'ibm-plex-mono',
      label: 'IBM Plex Mono',
      family: '"IBM Plex Mono"',
      weights: [400],
      bundled: true,
    },
    {
      id: 'jetbrains-mono',
      label: 'JetBrains Mono',
      family: '"JetBrains Mono"',
      weights: [400],
      bundled: false,
    },
  ],
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

// Mock global fetch for /api/app
const originalFetch = globalThis.fetch;

const stubs: Record<string, any> = {
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
  return mount(ConfigView, { global: { stubs }, shallow: false });
}

describe('ConfigView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteQuery.value = {};
    mockGetUser.mockResolvedValue({ username: 'admin', email: 'admin@test.com', role: 'admin', lastLogin: '2026-01-01', sessions: 2 });
    globalThis.fetch = vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/api/app')) {
        return Promise.resolve({ json: () => Promise.resolve({ version: '1.4.0' }) } as Response);
      }
      return originalFetch(url);
    }) as any;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
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
      mockGetSettings.mockRejectedValue(new Error('fail'));
      globalThis.fetch = vi.fn(() => Promise.reject(new Error('fail'))) as any;

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
