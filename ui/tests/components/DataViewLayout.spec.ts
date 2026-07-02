import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
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

  it('escapes the clipped AppLayout padding so the scroll area reaches the viewport edge', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
    });
    const root = wrapper.find('div');
    expect(root.classes()).toContain('-ml-4');
    expect(root.classes()).toContain('-mr-2');
    expect(root.classes()).toContain('-my-4');
    expect(root.classes()).toContain('sm:-ml-6');
    expect(root.classes()).toContain('sm:-mr-[9px]');
    expect(root.classes()).toContain('sm:-my-6');
  });

  it('has a flex row inside for main + panel layout with gap-2', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
    });
    const row = wrapper.find('.flex.gap-2');
    expect(row.exists()).toBe(true);
    expect(row.classes()).toContain('gap-2');
  });

  it('does not use gap-4 between content and panel', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
    });
    const row = wrapper
      .findAll('div')
      .find(
        (d) =>
          d.classes().includes('flex') &&
          d.classes().includes('min-w-0') &&
          d.classes().includes('flex-1') &&
          d.classes().includes('min-h-0') &&
          !d.classes().includes('flex-col'),
      );
    expect(row).toBeDefined();
    expect(row!.classes()).not.toContain('gap-4');
  });

  it('has a scroll container on the main content area', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Scrollable</p>' },
    });
    const scrollArea = wrapper.find('.overflow-y-auto');
    expect(scrollArea.exists()).toBe(true);
    expect(scrollArea.text()).toContain('Scrollable');
  });

  it('uses the shared mobile touch-scroll behavior on the main content area', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Scrollable</p>' },
    });
    const scrollArea = wrapper.find('.overflow-y-auto');
    expect(scrollArea.classes()).toContain('dd-touch-scroll');
    expect(scrollArea.classes()).toContain('overflow-x-hidden');
    expect(scrollArea.classes()).toContain('overscroll-contain');
    expect(scrollArea.classes()).toContain('dd-scroll-stable');
  });

  it('restores internal page padding inside the scrollable content area', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
    });
    const scrollArea = wrapper.find('.overflow-y-auto');
    expect(scrollArea.classes()).toContain('pl-4');
    expect(scrollArea.classes()).toContain('pr-4');
    expect(scrollArea.classes()).toContain('py-4');
    expect(scrollArea.classes()).toContain('sm:pl-6');
    expect(scrollArea.classes()).toContain('sm:pr-[24px]');
    expect(scrollArea.classes()).toContain('sm:py-6');
  });

  it('renders multiple default slot children', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>First</p><p>Second</p>' },
    });
    expect(wrapper.text()).toContain('First');
    expect(wrapper.text()).toContain('Second');
  });
});

describe('DataViewLayout content-width measurement', () => {
  let originalClientWidthDescriptor: PropertyDescriptor | undefined;
  let mockedClientWidth = 0;
  let capturedResizeCallback: ResizeObserverCallback | undefined;
  const originalResizeObserver = globalThis.ResizeObserver;

  class CapturingResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      capturedResizeCallback = callback;
    }
    observe() {
      // No-op — tests fire the captured callback directly.
    }
    unobserve() {
      // No-op for tests.
    }
    disconnect() {
      // No-op for tests.
    }
  }

  beforeEach(() => {
    mockedClientWidth = 0;
    capturedResizeCallback = undefined;
    originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    );
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return mockedClientWidth;
      },
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: CapturingResizeObserver,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalClientWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor);
    } else {
      delete (HTMLElement.prototype as any).clientWidth;
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: originalResizeObserver,
      configurable: true,
      writable: true,
    });
  });

  it('emits content-width with the measured clientWidth on mount', async () => {
    mockedClientWidth = 900;
    const wrapper = mount(DataViewLayout, { slots: { default: '<p>Content</p>' } });
    await nextTick();

    const emitted = wrapper.emitted('content-width');
    expect(emitted).toBeTruthy();
    expect(emitted?.at(-1)).toEqual([900]);
  });

  it('subtracts the content div own left/right padding from clientWidth (real content-box width)', async () => {
    mockedClientWidth = 900;
    // getComputedStyle only resolves inline styles for elements connected to the document, so
    // this test needs a real attachTo target (unlike the other tests here, which only assert on
    // the emitted number and don't care about actual computed padding).
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
      attachTo: document.body,
    });
    await nextTick();

    // The measured div is the flex-1 content column — apply real padding the way the browser
    // would from the sm:pl-6/sm:pr-[24px] Tailwind classes, and confirm the emitted width
    // reflects the content-box (padding excluded), not the raw padding-box clientWidth.
    const contentDiv = wrapper.findAll('div').find((d) => d.classes().includes('overflow-y-auto'));
    expect(contentDiv).toBeDefined();
    contentDiv!.element.style.paddingLeft = '24px';
    contentDiv!.element.style.paddingRight = '24px';

    mockedClientWidth = 900; // unchanged — only padding changed
    capturedResizeCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
    await nextTick();

    const emitted = wrapper.emitted('content-width');
    expect(emitted?.at(-1)).toEqual([852]);

    wrapper.unmount();
  });

  it('does not emit content-width while nothing is measured yet (clientWidth 0)', async () => {
    mockedClientWidth = 0;
    const wrapper = mount(DataViewLayout, { slots: { default: '<p>Content</p>' } });
    await nextTick();

    expect(wrapper.emitted('content-width')).toBeUndefined();
  });

  it('re-emits content-width when the ResizeObserver reports a new measurement', async () => {
    mockedClientWidth = 900;
    const wrapper = mount(DataViewLayout, { slots: { default: '<p>Content</p>' } });
    await nextTick();
    expect(wrapper.emitted('content-width')?.at(-1)).toEqual([900]);

    mockedClientWidth = 640;
    capturedResizeCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
    await nextTick();

    expect(wrapper.emitted('content-width')?.at(-1)).toEqual([640]);
  });

  it('disconnects the ResizeObserver on unmount', async () => {
    const disconnectSpy = vi.spyOn(CapturingResizeObserver.prototype, 'disconnect');
    mockedClientWidth = 900;
    const wrapper = mount(DataViewLayout, { slots: { default: '<p>Content</p>' } });
    await nextTick();

    wrapper.unmount();
    expect(disconnectSpy).toHaveBeenCalled();
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
