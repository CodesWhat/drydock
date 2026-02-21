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

  it('renders 3 theme buttons', () => {
    const wrapper = factory();
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(3);
  });

  it('renders buttons with correct titles', () => {
    const wrapper = factory();
    const titles = wrapper.findAll('button').map((b) => b.attributes('title'));
    expect(titles).toEqual(['Light', 'System', 'Dark']);
  });

  it('renders AppIcon for each variant with correct names', () => {
    const wrapper = factory();
    const icons = wrapper.findAllComponents(iconStub);
    expect(icons).toHaveLength(3);
    expect(icons[0].props('name')).toBe('sun');
    expect(icons[1].props('name')).toBe('monitor');
    expect(icons[2].props('name')).toBe('moon');
  });

  it('calls transitionTheme when clicking a different variant', async () => {
    const wrapper = factory();
    await wrapper.findAll('button')[0].trigger('click');
    expect(mockTransitionTheme).toHaveBeenCalled();
  });

  it('does not call transitionTheme when clicking the active variant', async () => {
    mockThemeVariant.value = 'dark';
    const wrapper = factory();
    await wrapper.findAll('button')[2].trigger('click');
    expect(mockTransitionTheme).not.toHaveBeenCalled();
  });

  it('has a sliding indicator element', () => {
    const wrapper = factory();
    const indicator = wrapper.find('.theme-toggle-indicator');
    expect(indicator.exists()).toBe(true);
  });

  it('positions the indicator based on active variant', async () => {
    mockThemeVariant.value = 'system';
    const wrapper = factory();
    const indicator = wrapper.find('.theme-toggle-indicator');
    expect(indicator.attributes('style')).toContain('translateX(24px)');
  });

  it('uses sm dimensions by default', () => {
    const wrapper = factory();
    const icons = wrapper.findAllComponents(iconStub);
    expect(icons[0].props('size')).toBe(11);
  });

  it('uses md dimensions when size is md', () => {
    const wrapper = factory({ size: 'md' });
    const icons = wrapper.findAllComponents(iconStub);
    expect(icons[0].props('size')).toBe(14);
  });

  it('applies sm cell size to buttons', () => {
    const wrapper = factory();
    const btn = wrapper.find('button');
    expect(btn.attributes('style')).toContain('width: 24px');
    expect(btn.attributes('style')).toContain('height: 24px');
  });

  it('applies md cell size to buttons', () => {
    const wrapper = factory({ size: 'md' });
    const btn = wrapper.find('button');
    expect(btn.attributes('style')).toContain('width: 32px');
    expect(btn.attributes('style')).toContain('height: 32px');
  });
});
