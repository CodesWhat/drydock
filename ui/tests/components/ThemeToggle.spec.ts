import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ThemeToggle from '@/components/ThemeToggle.vue';

const mockThemeVariant = ref<'light' | 'system' | 'dark'>('dark');
const mockIsDark = ref(true);
const mockSetThemeVariant = vi.fn();
const mockTransitionTheme = vi.fn((cb: () => void) => cb());

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

  it('always renders 3 buttons in fixed order: light, system, dark', () => {
    const wrapper = factory();
    const labels = wrapper.findAll('button').map((b) => b.attributes('aria-label'));
    expect(labels).toEqual([
      'Switch to light theme',
      'Switch to system theme',
      'Switch to dark theme',
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
      'Switch to light theme',
      'Switch to system theme',
      'Switch to dark theme',
    ]);
  });

  it('is collapsed by default showing only the active icon width', () => {
    const wrapper = factory();
    const toggle = wrapper.find('.theme-toggle');
    // Collapsed to one cell width (36px for sm default)
    expect(toggle.attributes('style')).toContain('width: 36px');
  });

  it('translates to show the active icon when collapsed', () => {
    mockThemeVariant.value = 'dark'; // index 2
    const wrapper = factory();
    const inner = wrapper.find('.theme-toggle-track');
    expect(inner.attributes('style')).toContain('translateX(-72px)');
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
    // Expanded to full width (3 * 36 = 108px)
    expect(wrapper.find('.theme-toggle').attributes('style')).toContain('width: 108px');
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
    expect(wrapper.find('.theme-toggle').attributes('style')).toContain('width: 36px');
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
    expect(wrapper.find('.theme-toggle').attributes('style')).toContain('width: 36px');
  });

  it('toggles expanded when clicking the active icon', async () => {
    mockThemeVariant.value = 'dark';
    const wrapper = factory();
    await wrapper.findAll('button')[2].trigger('click'); // Dark (active)
    expect(wrapper.find('.theme-toggle').attributes('style')).toContain('width: 108px');
  });

  it('uses sm dimensions by default', () => {
    const wrapper = factory();
    const icons = wrapper.findAllComponents(iconStub);
    expect(icons[0].props('size')).toBe(15);
  });

  it('uses md dimensions when size is md', () => {
    const wrapper = factory({ size: 'md' });
    const icons = wrapper.findAllComponents(iconStub);
    expect(icons[0].props('size')).toBe(14);
  });

  it('uses sm cell size on buttons', () => {
    const wrapper = factory();
    const btn = wrapper.find('button');
    expect(btn.attributes('style')).toContain('width: 36px');
    expect(btn.attributes('style')).toContain('height: 36px');
  });

  it('uses md cell size on buttons', () => {
    const wrapper = factory({ size: 'md' });
    const btn = wrapper.find('button');
    expect(btn.attributes('style')).toContain('width: 40px');
    expect(btn.attributes('style')).toContain('height: 40px');
  });

  it('exposes aria labels and pressed state on variant buttons', () => {
    mockThemeVariant.value = 'system';
    const wrapper = factory();
    const buttons = wrapper.findAll('button');
    expect(buttons[0].attributes('aria-label')).toBe('Switch to light theme');
    expect(buttons[1].attributes('aria-label')).toBe('Switch to system theme');
    expect(buttons[2].attributes('aria-label')).toBe('Switch to dark theme');
    expect(buttons[0].attributes('aria-pressed')).toBe('false');
    expect(buttons[1].attributes('aria-pressed')).toBe('true');
    expect(buttons[2].attributes('aria-pressed')).toBe('false');
  });
});
