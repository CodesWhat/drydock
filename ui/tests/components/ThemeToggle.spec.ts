import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { i18n, SUPPORTED_LOCALES, setI18nLocale } from '@/boot/i18n';
import ThemeToggle from '@/components/ThemeToggle.vue';

const mockThemeVariant = ref<'light' | 'system' | 'dark'>('dark');
const mockIsDark = ref(true);
const mockWindowNarrow = ref(false);
const mockSetThemeVariant = vi.fn();
const mockTransitionTheme = vi.fn((cb: () => void) => cb());

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({ windowNarrow: mockWindowNarrow }),
}));

vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    themeVariant: mockThemeVariant,
    isDark: mockIsDark,
    setThemeVariant: mockSetThemeVariant,
    transitionTheme: mockTransitionTheme,
  }),
}));

const iconStub = { template: '<span />', props: ['name', 'size'] };

describe('ThemeToggle', () => {
  beforeEach(() => {
    setI18nLocale('en');
    mockWindowNarrow.value = false;
    mockThemeVariant.value = 'dark';
    mockIsDark.value = true;
    mockSetThemeVariant.mockClear();
    mockTransitionTheme.mockClear();
    mockTransitionTheme.mockImplementation((cb: () => void) => cb());
  });

  function factory(props: Record<string, any> = {}) {
    return mount(ThemeToggle, {
      props,
      global: { stubs: { AppIcon: iconStub } },
    });
  }

  it.each(SUPPORTED_LOCALES)(
    'localizes desktop accessible names in %s without changing mode IDs',
    async (locale) => {
      setI18nLocale(locale);
      const wrapper = factory();
      try {
        const buttons = wrapper.findAll('button');
        expect(buttons.map((button) => button.attributes('aria-label'))).toEqual(
          ['light', 'system', 'dark'].map((id) =>
            i18n.global.t('appShell.themeToggle.switchTo', {
              id: i18n.global.t(`appShell.themeToggle.variant.${id}`),
            }),
          ),
        );
        await buttons[0].trigger('click');
        expect(mockSetThemeVariant).toHaveBeenCalledWith('light');
      } finally {
        wrapper.unmount();
        setI18nLocale('en');
      }
    },
  );

  it.each(SUPPORTED_LOCALES)(
    'localizes the compact accessible name and keeps cycling in %s',
    async (locale) => {
      setI18nLocale(locale);
      mockWindowNarrow.value = true;
      mockThemeVariant.value = 'light';
      const wrapper = factory();
      try {
        const button = wrapper.find('button');
        expect(button.attributes('aria-label')).toBe(
          i18n.global.t('appShell.themeToggle.mobileLabel', {
            id: i18n.global.t('appShell.themeToggle.variant.light'),
          }),
        );
        await button.trigger('click');
        expect(mockSetThemeVariant).toHaveBeenCalledWith('system');
        setI18nLocale(locale === 'ar' ? 'fr' : 'ar');
        await wrapper.vm.$nextTick();
        expect(button.attributes('aria-label')).toBe(
          i18n.global.t('appShell.themeToggle.mobileLabel', {
            id: i18n.global.t('appShell.themeToggle.variant.light'),
          }),
        );
      } finally {
        wrapper.unmount();
        setI18nLocale('en');
      }
    },
  );

  it('always renders 3 buttons in fixed order: light, system, dark', () => {
    const wrapper = factory();
    const labels = wrapper.findAll('button').map((b) => b.attributes('aria-label'));
    expect(labels).toEqual([
      'Switch to Light theme',
      'Switch to System theme',
      'Switch to Dark theme',
    ]);
  });

  it('renders icons in fixed order: sun, monitor, moon', () => {
    const wrapper = factory();
    const icons = wrapper.findAllComponents(iconStub);
    expect(icons.map((i) => i.props('name'))).toEqual(['sun', 'monitor', 'moon']);
  });

  it('keeps the same order regardless of active variant', () => {
    mockThemeVariant.value = 'light';
    const wrapper = factory();
    const labels = wrapper.findAll('button').map((b) => b.attributes('aria-label'));
    expect(labels).toEqual([
      'Switch to Light theme',
      'Switch to System theme',
      'Switch to Dark theme',
    ]);
  });

  it('is collapsed by default showing only the active icon width', () => {
    const wrapper = factory();
    const toggle = wrapper.find('.theme-toggle');
    // Collapsed to one shared sm icon-button cell width (44px)
    expect(toggle.attributes('style')).toContain('width: 44px');
  });

  it('translates to show the active icon when collapsed', () => {
    mockThemeVariant.value = 'dark'; // index 2
    const wrapper = factory();
    const inner = wrapper.find('.theme-toggle-track');
    expect(inner.attributes('style')).toContain('translateX(-88px)');
  });

  it('translates to index 0 when light is active', () => {
    mockThemeVariant.value = 'light';
    const wrapper = factory();
    const inner = wrapper.find('.theme-toggle-track');
    expect(inner.attributes('style')).toContain('translateX(-0px)');
  });

  it('expands on mouseenter', async () => {
    const wrapper = factory();
    await wrapper.find('.theme-toggle').trigger('mouseenter');
    // Expanded to full width (3 * 44 = 132px)
    expect(wrapper.find('.theme-toggle').attributes('style')).toContain('width: 132px');
  });

  it('resets translation on expand', async () => {
    mockThemeVariant.value = 'dark';
    const wrapper = factory();
    await wrapper.find('.theme-toggle').trigger('mouseenter');
    const inner = wrapper.find('.theme-toggle-track');
    expect(inner.attributes('style')).toContain('translateX(0)');
  });

  it('collapses on mouseleave', async () => {
    const wrapper = factory();
    await wrapper.find('.theme-toggle').trigger('mouseenter');
    await wrapper.find('.theme-toggle').trigger('mouseleave');
    expect(wrapper.find('.theme-toggle').attributes('style')).toContain('width: 44px');
  });

  it('calls transitionTheme when clicking an inactive variant', async () => {
    mockThemeVariant.value = 'dark';
    const wrapper = factory();
    await wrapper.find('.theme-toggle').trigger('mouseenter');
    await wrapper.findAll('button')[0].trigger('click'); // Light
    expect(mockTransitionTheme).toHaveBeenCalled();
  });

  it('collapses after selecting a variant', async () => {
    const wrapper = factory();
    await wrapper.find('.theme-toggle').trigger('mouseenter');
    await wrapper.findAll('button')[0].trigger('click');
    expect(wrapper.find('.theme-toggle').attributes('style')).toContain('width: 44px');
  });

  it('toggles expanded when clicking the active icon', async () => {
    mockThemeVariant.value = 'dark';
    const wrapper = factory();
    await wrapper.findAll('button')[2].trigger('click'); // Dark (active)
    expect(wrapper.find('.theme-toggle').attributes('style')).toContain('width: 132px');
  });

  it('uses sm dimensions by default', () => {
    const wrapper = factory();
    const icons = wrapper.findAllComponents(iconStub);
    expect(icons[0].props('size')).toBe(18);
  });

  it('uses md dimensions when size is md', () => {
    const wrapper = factory({ size: 'md' });
    const icons = wrapper.findAllComponents(iconStub);
    expect(icons[0].props('size')).toBe(20);
  });

  it('uses sm cell size on buttons', () => {
    const wrapper = factory();
    const btn = wrapper.find('button');
    expect(btn.attributes('style')).toContain('width: 44px');
    expect(btn.attributes('style')).toContain('height: 44px');
  });

  it('uses md cell size on buttons', () => {
    const wrapper = factory({ size: 'md' });
    const btn = wrapper.find('button');
    expect(btn.attributes('style')).toContain('width: 48px');
    expect(btn.attributes('style')).toContain('height: 48px');
  });

  it('exposes aria labels and pressed state on variant buttons', () => {
    mockThemeVariant.value = 'system';
    const wrapper = factory();
    const buttons = wrapper.findAll('button');
    expect(buttons[0].attributes('aria-label')).toBe('Switch to Light theme');
    expect(buttons[1].attributes('aria-label')).toBe('Switch to System theme');
    expect(buttons[2].attributes('aria-label')).toBe('Switch to Dark theme');
    expect(buttons[0].attributes('aria-pressed')).toBe('false');
    expect(buttons[1].attributes('aria-pressed')).toBe('true');
    expect(buttons[2].attributes('aria-pressed')).toBe('false');
  });
});
