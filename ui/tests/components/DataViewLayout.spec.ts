import { mount } from '@vue/test-utils';
import DataViewLayout from '@/components/DataViewLayout.vue';

describe('DataViewLayout', () => {
  it('renders default slot content', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Main content</p>' },
    });
    expect(wrapper.text()).toContain('Main content');
  });

  it('renders panel slot content', () => {
    const wrapper = mount(DataViewLayout, {
      slots: {
        default: '<p>Main</p>',
        panel: '<aside>Panel content</aside>',
      },
    });
    expect(wrapper.text()).toContain('Panel content');
  });

  it('renders without panel slot', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Only main</p>' },
    });
    expect(wrapper.text()).toContain('Only main');
    expect(wrapper.find('aside').exists()).toBe(false);
  });

  it('has a flex-col root container', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
    });
    const root = wrapper.find('div');
    expect(root.classes()).toContain('flex');
    expect(root.classes()).toContain('flex-col');
  });

  it('uses flex-1 to fill available viewport height', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
    });
    const root = wrapper.find('div');
    expect(root.classes()).toContain('flex-1');
    expect(root.classes()).toContain('min-h-0');
  });

  it('has a flex row inside for main + panel layout', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
    });
    const row = wrapper.find('.flex.gap-4');
    expect(row.exists()).toBe(true);
  });

  it('has a scroll container on the main content area', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Scrollable</p>' },
    });
    const scrollArea = wrapper.find('.overflow-auto');
    expect(scrollArea.exists()).toBe(true);
    expect(scrollArea.text()).toContain('Scrollable');
  });

  it('renders multiple default slot children', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>First</p><p>Second</p>' },
    });
    expect(wrapper.text()).toContain('First');
    expect(wrapper.text()).toContain('Second');
  });
});

describe('useFont coverage guard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    document.querySelectorAll('link[data-font]').forEach((el) => el.remove());
    document.documentElement.style.removeProperty('--drydock-font');
  });

  it('loads a lazy font with setFont and marks it as loaded', async () => {
    const mod = await import('@/composables/useFont');
    const { setFont, isFontLoaded, activeFont } = mod.useFont();

    const pending = setFont('jetbrains-mono');

    const links = Array.from(
      document.querySelectorAll('link[data-font="jetbrains-mono"]'),
    ) as HTMLLinkElement[];
    expect(links.length).toBeGreaterThan(0);

    links.forEach((link) => link.dispatchEvent(new Event('load')));
    await pending;

    expect(activeFont.value).toBe('jetbrains-mono');
    expect(isFontLoaded('jetbrains-mono')).toBe(true);
  });

  it('returns immediately when the font is already bundled', async () => {
    const mod = await import('@/composables/useFont');
    const { loadFont } = mod.useFont();

    await expect(loadFont('ibm-plex-mono')).resolves.toBeUndefined();
  });

  it('deduplicates in-flight lazy font loads', async () => {
    const mod = await import('@/composables/useFont');
    const { loadFont } = mod.useFont();

    const first = loadFont('source-code-pro');
    const second = loadFont('source-code-pro');
    expect(second).toBeDefined();

    const links = Array.from(
      document.querySelectorAll('link[data-font="source-code-pro"]'),
    ) as HTMLLinkElement[];
    expect(links.length).toBe(5);

    links.forEach((link) => link.dispatchEvent(new Event('load')));
    await Promise.all([first, second]);
  });

  it('ignores invalid runtime font ids', async () => {
    const mod = await import('@/composables/useFont');
    const { setFont } = mod.useFont();

    await expect(setFont('not-a-real-font' as any)).resolves.toBeUndefined();
    expect(document.querySelector('link[data-font="not-a-real-font"]')).toBeNull();
  });

  it('rejects when a lazy font stylesheet fails to load', async () => {
    const mod = await import('@/composables/useFont');
    const { loadFont } = mod.useFont();

    const pending = loadFont('commit-mono');
    const links = Array.from(
      document.querySelectorAll('link[data-font="commit-mono"]'),
    ) as HTMLLinkElement[];
    expect(links.length).toBe(1);

    links[0].dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow('Failed to load font commit-mono weight 400');
  });
});
