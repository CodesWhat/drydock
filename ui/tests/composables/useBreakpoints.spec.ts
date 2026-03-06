import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';

describe('useBreakpoints', () => {
  const originalInnerWidth = globalThis.innerWidth;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const mountedWrappers: Array<{ unmount: () => void }> = [];

  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'innerWidth', {
      value: 1200,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    while (mountedWrappers.length > 0) {
      mountedWrappers.pop()?.unmount();
    }
    Object.defineProperty(globalThis, 'innerWidth', {
      value: originalInnerWidth,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      value: originalRequestAnimationFrame,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      value: originalCancelAnimationFrame,
      writable: true,
      configurable: true,
    });
  });

  async function loadBreakpoints() {
    const mod = await import('@/composables/useBreakpoints');
    return mod.useBreakpoints;
  }

  function mountWithBreakpoints(
    composableFn: ReturnType<typeof loadBreakpoints> extends Promise<infer T> ? T : never,
  ) {
    const result = {} as ReturnType<typeof composableFn>;
    const wrapper = mount(
      defineComponent({
        setup() {
          Object.assign(result, composableFn());
          return {};
        },
        template: '<div />',
      }),
    );
    mountedWrappers.push(wrapper);
    return { wrapper, result };
  }

  async function waitForAnimationFrame() {
    await new Promise<void>((resolve) => {
      globalThis.requestAnimationFrame(() => resolve());
    });
  }

  it('should report desktop values when width is 1200', async () => {
    const useBreakpoints = await loadBreakpoints();
    const { result } = mountWithBreakpoints(useBreakpoints);
    expect(result.isMobile.value).toBe(false);
    expect(result.windowNarrow.value).toBe(false);
  });

  it('should report mobile when width < 768', async () => {
    Object.defineProperty(globalThis, 'innerWidth', {
      value: 500,
      writable: true,
      configurable: true,
    });
    const useBreakpoints = await loadBreakpoints();
    const { result } = mountWithBreakpoints(useBreakpoints);
    expect(result.isMobile.value).toBe(true);
    expect(result.windowNarrow.value).toBe(true);
  });

  it('should report narrow but not mobile when 768 <= width < 1024', async () => {
    Object.defineProperty(globalThis, 'innerWidth', {
      value: 900,
      writable: true,
      configurable: true,
    });
    const useBreakpoints = await loadBreakpoints();
    const { result } = mountWithBreakpoints(useBreakpoints);
    expect(result.isMobile.value).toBe(false);
    expect(result.windowNarrow.value).toBe(true);
  });

  it('should treat 768 as not mobile (boundary)', async () => {
    Object.defineProperty(globalThis, 'innerWidth', {
      value: 768,
      writable: true,
      configurable: true,
    });
    const useBreakpoints = await loadBreakpoints();
    const { result } = mountWithBreakpoints(useBreakpoints);
    expect(result.isMobile.value).toBe(false);
  });

  it('should treat 767 as mobile (boundary)', async () => {
    Object.defineProperty(globalThis, 'innerWidth', {
      value: 767,
      writable: true,
      configurable: true,
    });
    const useBreakpoints = await loadBreakpoints();
    const { result } = mountWithBreakpoints(useBreakpoints);
    expect(result.isMobile.value).toBe(true);
  });

  it('should treat 1024 as not narrow (boundary)', async () => {
    Object.defineProperty(globalThis, 'innerWidth', {
      value: 1024,
      writable: true,
      configurable: true,
    });
    const useBreakpoints = await loadBreakpoints();
    const { result } = mountWithBreakpoints(useBreakpoints);
    expect(result.windowNarrow.value).toBe(false);
  });

  it('should treat 1023 as narrow (boundary)', async () => {
    Object.defineProperty(globalThis, 'innerWidth', {
      value: 1023,
      writable: true,
      configurable: true,
    });
    const useBreakpoints = await loadBreakpoints();
    const { result } = mountWithBreakpoints(useBreakpoints);
    expect(result.windowNarrow.value).toBe(true);
  });

  it('should update on resize event', async () => {
    const useBreakpoints = await loadBreakpoints();
    const { result } = mountWithBreakpoints(useBreakpoints);
    expect(result.isMobile.value).toBe(false);

    Object.defineProperty(globalThis, 'innerWidth', {
      value: 500,
      writable: true,
      configurable: true,
    });
    globalThis.dispatchEvent(new Event('resize'));
    await waitForAnimationFrame();
    await nextTick();

    expect(result.isMobile.value).toBe(true);
    expect(result.windowNarrow.value).toBe(true);
  });

  it('should coalesce resize updates into a single animation frame', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      value: requestAnimationFrameMock,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });

    const useBreakpoints = await loadBreakpoints();
    const { result } = mountWithBreakpoints(useBreakpoints);
    expect(result.isMobile.value).toBe(false);
    const callsBeforeResize = requestAnimationFrameMock.mock.calls.length;
    const callbacksBeforeResize = callbacks.length;

    Object.defineProperty(globalThis, 'innerWidth', {
      value: 500,
      writable: true,
      configurable: true,
    });
    globalThis.dispatchEvent(new Event('resize'));
    globalThis.dispatchEvent(new Event('resize'));

    expect(requestAnimationFrameMock.mock.calls.length - callsBeforeResize).toBe(1);
    expect(callbacks.length - callbacksBeforeResize).toBe(1);
    expect(result.isMobile.value).toBe(false);

    callbacks[callbacks.length - 1](0);
    await nextTick();

    expect(result.isMobile.value).toBe(true);
    expect(result.windowNarrow.value).toBe(true);
  });

  it('should clean up resize listener on unmount', async () => {
    const useBreakpoints = await loadBreakpoints();
    const { wrapper, result } = mountWithBreakpoints(useBreakpoints);
    wrapper.unmount();

    Object.defineProperty(globalThis, 'innerWidth', {
      value: 500,
      writable: true,
      configurable: true,
    });
    globalThis.dispatchEvent(new Event('resize'));
    await nextTick();

    // Values should NOT have updated since listener was removed
    // Module-level refs retain their last value (1200 > 768 = false)
    expect(result.isMobile.value).toBe(false);
  });
});
