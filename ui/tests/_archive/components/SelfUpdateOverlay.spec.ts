import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import SelfUpdateOverlay from '@/components/SelfUpdateOverlay.vue';

const UINT32_MAX_PLUS_ONE = 0x1_0000_0000;

// Mock vuetify useDisplay — default to desktop (smAndDown = false)
const mockSmAndDown = ref(false);
vi.mock('vuetify', async () => {
  const actual = await vi.importActual('vuetify');
  return {
    ...actual,
    useDisplay: vi.fn(() => ({
      smAndDown: mockSmAndDown,
    })),
  };
});

// Mock window.location.reload
const reloadMock = vi.fn();
Object.defineProperty(window, 'location', {
  value: { reload: reloadMock },
  writable: true,
});

describe('SelfUpdateOverlay', () => {
  type EventHandler = (...args: unknown[]) => unknown;
  let wrapper: any;
  let mockEventBus: any;
  let eventHandlers: Record<string, EventHandler>;
  let rafMock: ReturnType<typeof vi.fn>;
  let cafMock: ReturnType<typeof vi.fn>;
  let rafId: number;
  let cryptoRandomSpy: ReturnType<typeof vi.spyOn> | null;

  function queueSecureRandomValues(values: number[]) {
    let callIdx = 0;
    cryptoRandomSpy?.mockImplementation(((typedArray: Uint32Array) => {
      const next = values[callIdx++] ?? 0.5;
      typedArray[0] = Math.min(0xffff_ffff, Math.floor(next * UINT32_MAX_PLUS_ONE));
      return typedArray;
    }) as any);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
    reloadMock.mockClear();
    mockSmAndDown.value = false;
    rafId = 0;
    rafMock = vi.fn((_cb: FrameRequestCallback) => ++rafId);
    cafMock = vi.fn();
    window.requestAnimationFrame = rafMock as any;
    window.cancelAnimationFrame = cafMock as any;
    cryptoRandomSpy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((
      typedArray: Uint32Array,
    ) => {
      typedArray[0] = 0x8000_0000;
      return typedArray;
    }) as any);

    eventHandlers = {};
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: EventHandler) => {
        eventHandlers[event] = handler;
      }),
      off: vi.fn(),
    };

    wrapper = mount(SelfUpdateOverlay, {
      global: {
        provide: {
          eventBus: mockEventBus,
        },
        stubs: {
          'v-overlay': {
            template:
              '<div class="v-overlay" :class="{ active: modelValue }" @click="$emit(\'update:modelValue\', false)"><slot v-if="modelValue" /></div>',
            props: ['modelValue', 'persistent', 'scrim', 'opacity', 'zIndex'],
          },
          'v-progress-linear': {
            template: '<div class="v-progress-linear" />',
            props: ['indeterminate', 'color'],
          },
          'v-icon': {
            template: '<i class="v-icon"><slot /></i>',
            props: ['color', 'size'],
          },
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    cryptoRandomSpy?.mockRestore();
    cryptoRandomSpy = null;
    vi.useRealTimers();
  });

  it('is not visible by default', () => {
    expect(wrapper.vm.active).toBe(false);
    expect(wrapper.find('.v-overlay').classes()).not.toContain('active');
  });

  it('registers self-update and connection-lost listeners on mount', () => {
    expect(mockEventBus.on).toHaveBeenCalledWith('self-update', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('connection-lost', expect.any(Function));
  });

  it('becomes visible when self-update event fires', async () => {
    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.active).toBe(true);
    expect(wrapper.find('.v-overlay').classes()).toContain('active');
  });

  it('shows "Updating drydock..." text initially', async () => {
    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.statusText).toBe('Updating drydock...');
    expect(wrapper.text()).toContain('Updating drydock...');
  });

  it('activates desktop update mode when self-update starts', async () => {
    mockSmAndDown.value = false;
    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.active).toBe(true);
    expect(wrapper.vm.smAndDown).toBe(false);
    expect(wrapper.find('.bouncing-logo').exists()).toBe(true);
    expect(wrapper.find('.bouncing-logo').isVisible()).toBe(true);
    expect(wrapper.find('.mobile-logo').exists()).toBe(true);
    expect(wrapper.find('.mobile-logo').isVisible()).toBe(false);
  });

  it('shows "Restarting..." text after connection-lost', async () => {
    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();
    eventHandlers['connection-lost']();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.statusText).toBe("Restarting... we'll be right back");
    expect(wrapper.vm.phase).toBe('disconnected');
  });

  it('does not react to connection-lost when not active', async () => {
    eventHandlers['connection-lost']();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.active).toBe(false);
    expect(wrapper.vm.phase).toBe('updating');
  });

  it('shows progress bar during updating phase', async () => {
    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.v-progress-linear').exists()).toBe(true);
  });

  it('shows progress bar during disconnected phase', async () => {
    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();
    eventHandlers['connection-lost']();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.v-progress-linear').exists()).toBe(true);
  });

  it('transitions to ready phase when health check succeeds', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true } as Response);

    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();
    eventHandlers['connection-lost']();
    await wrapper.vm.$nextTick();

    await vi.advanceTimersByTimeAsync(3000);

    expect(wrapper.vm.phase).toBe('ready');
    expect(wrapper.vm.statusText).toBe('Ready!');
  });

  it('hides progress bar and shows check icon when ready', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true } as Response);

    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();
    eventHandlers['connection-lost']();
    await wrapper.vm.$nextTick();

    await vi.advanceTimersByTimeAsync(3000);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.v-progress-linear').exists()).toBe(false);
    expect(wrapper.find('.v-icon').exists()).toBe(true);
  });

  it('reloads page after ready phase', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true } as Response);

    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();
    eventHandlers['connection-lost']();
    await wrapper.vm.$nextTick();

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(1500);

    expect(reloadMock).toHaveBeenCalled();
  });

  it('keeps polling when health check fails', async () => {
    (global.fetch as any).mockRejectedValue(new Error('Network error'));

    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();
    eventHandlers['connection-lost']();
    await wrapper.vm.$nextTick();

    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.vm.phase).toBe('disconnected');

    (global.fetch as any).mockResolvedValue({ ok: true } as Response);
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.vm.phase).toBe('ready');
  });

  it('handles successful health response after timer is cleared mid-request', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    (global.fetch as any).mockReturnValue(fetchPromise);

    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();
    eventHandlers['connection-lost']();
    await wrapper.vm.$nextTick();

    await vi.advanceTimersByTimeAsync(3000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    resolveFetch?.({ ok: true } as Response);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1500);

    expect(reloadMock).toHaveBeenCalled();
  });

  it('starts bounce animation on self-update', async () => {
    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();

    expect(rafMock).toHaveBeenCalled();
  });

  it('deactivates when overlay emits model update', async () => {
    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();

    await wrapper.find('.v-overlay').trigger('click');

    expect(wrapper.vm.active).toBe(false);
  });

  it('uses deterministic fallback when secure crypto is unavailable', async () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
    });

    try {
      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      const maxX = window.innerWidth - wrapper.vm.logoSize;
      const maxY = window.innerHeight - wrapper.vm.logoSize;

      expect(wrapper.vm.x).toBe(maxX * 0.5);
      expect(wrapper.vm.y).toBe(maxY * 0.5);
      expect(wrapper.vm.hue).toBe(180);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
      });
    }
  });

  it('cleans up on unmount', () => {
    eventHandlers['self-update']();
    wrapper.unmount();

    expect(cafMock).toHaveBeenCalled();
    expect(mockEventBus.off).toHaveBeenCalledWith('self-update', expect.any(Function));
    expect(mockEventBus.off).toHaveBeenCalledWith('connection-lost', expect.any(Function));
  });

  describe('animate bounce logic', () => {
    let capturedCallbacks: FrameRequestCallback[];

    beforeEach(() => {
      capturedCallbacks = [];
      rafMock.mockImplementation((cb: FrameRequestCallback) => {
        capturedCallbacks.push(cb);
        return ++rafId;
      });
    });

    function runAnimateFrame() {
      const cb = capturedCallbacks.pop();
      if (cb) cb(performance.now());
    }

    it('bounces off right/bottom edges when starting near them', async () => {
      // Mock Math.random to position logo near right+bottom edges
      // startBounce: x = random * maxX, y = random * maxY
      // speed = 1.5 + random, angle = random * 2PI
      // We want x near maxX, y near maxY, with positive dx/dy
      const maxX = window.innerWidth - 120; // 904
      const randomValues = [
        0.999, // x = 0.999 * maxX ~ maxX
        0.999, // y = 0.999 * maxY ~ maxY
        0.5, // speed = 2.0
        0.0, // angle = 0 -> dx=2, dy=0... we need positive dy too
        0.5, // hue = 180
      ];
      queueSecureRandomValues(randomValues);

      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      const hueBefore = wrapper.vm.hue;

      // Run enough frames so logo reaches and bounces off the right edge
      // x starts near maxX with positive dx, so first frame should hit
      runAnimateFrame();

      // x should be clamped and hue shifted
      expect(wrapper.vm.x).toBeLessThanOrEqual(maxX);
      expect(wrapper.vm.hue).not.toBe(hueBefore);
    });

    it('bounces off left edge when moving left', async () => {
      // angle = PI -> dx = -speed, dy ~ 0
      const randomValues = [
        0.001, // x near 0
        0.5, // y in middle
        0.5, // speed = 2.0
        0.5, // angle = PI -> dx = cos(PI)*2 = -2, dy = sin(PI)*2 ~ 0
        0.5, // hue
      ];
      queueSecureRandomValues(randomValues);

      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      const hueBefore = wrapper.vm.hue;
      runAnimateFrame();

      // x was near 0 and dx was negative, should bounce
      expect(wrapper.vm.x).toBeGreaterThanOrEqual(0);
      expect(wrapper.vm.hue).not.toBe(hueBefore);
    });

    it('bounces off top edge when moving upward', async () => {
      // angle = 3*PI/2 -> dx ~ 0, dy = -speed
      const randomValues = [
        0.5, // x in middle
        0.001, // y near 0
        0.5, // speed = 2.0
        0.75, // angle = 0.75 * 2PI = 1.5PI -> dx ~ 0, dy = -2
        0.5, // hue
      ];
      queueSecureRandomValues(randomValues);

      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      const hueBefore = wrapper.vm.hue;
      runAnimateFrame();

      // y was near 0 with negative dy, should bounce
      expect(wrapper.vm.y).toBeGreaterThanOrEqual(0);
      expect(wrapper.vm.hue).not.toBe(hueBefore);
    });

    it('bounces off bottom edge when moving downward', async () => {
      // angle = PI/2 -> dx ~ 0, dy = +speed
      const maxY = window.innerHeight - 120;
      const randomValues = [
        0.5, // x in middle
        0.999, // y near maxY
        0.5, // speed = 2.0
        0.25, // angle = 0.25 * 2PI = PI/2 -> dx ~ 0, dy = +2
        0.5, // hue
      ];
      queueSecureRandomValues(randomValues);

      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      const hueBefore = wrapper.vm.hue;
      runAnimateFrame();

      expect(wrapper.vm.y).toBeLessThanOrEqual(maxY);
      expect(wrapper.vm.hue).not.toBe(hueBefore);
    });

    it('does not animate when active is false', async () => {
      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      // Deactivate
      wrapper.vm.active = false;
      await wrapper.vm.$nextTick();

      const xBefore = wrapper.vm.x;
      runAnimateFrame();

      // Position should not change because animate() returns early
      expect(wrapper.vm.x).toBe(xBefore);
    });

    it('does not start duplicate health poll timers', async () => {
      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();
      eventHandlers['connection-lost']();
      await wrapper.vm.$nextTick();

      // Call connection-lost again -- should not create a second interval
      eventHandlers['connection-lost']();
      await wrapper.vm.$nextTick();

      // Only one poll cycle should fire per 3s
      (global.fetch as any).mockResolvedValue({ ok: true } as Response);
      await vi.advanceTimersByTimeAsync(3000);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('updates position each frame without edge hit in the middle', async () => {
      // Place logo in center with small velocity
      const randomValues = [
        0.5, // x in middle
        0.5, // y in middle
        0.0, // speed = 1.5 (minimum)
        0.125, // angle = PI/4 -> dx = ~1.06, dy = ~1.06
        0.0, // hue = 0
      ];
      queueSecureRandomValues(randomValues);

      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      const xBefore = wrapper.vm.x;
      const yBefore = wrapper.vm.y;
      const hueBefore = wrapper.vm.hue;

      runAnimateFrame();

      // Position should have moved but hue should not change (no edge hit)
      expect(wrapper.vm.x).not.toBe(xBefore);
      expect(wrapper.vm.y).not.toBe(yBefore);
      expect(wrapper.vm.hue).toBe(hueBefore);
    });
  });

  it('handles non-ok health response by continuing to poll', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false } as Response);

    eventHandlers['self-update']();
    await wrapper.vm.$nextTick();
    eventHandlers['connection-lost']();
    await wrapper.vm.$nextTick();

    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.vm.phase).toBe('disconnected');

    // Still polling, next attempt succeeds
    (global.fetch as any).mockResolvedValue({ ok: true } as Response);
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.vm.phase).toBe('ready');
  });

  describe('mobile behavior (smAndDown)', () => {
    beforeEach(() => {
      mockSmAndDown.value = true;
    });

    it('does not start bounce animation on mobile', async () => {
      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      // On mobile, requestAnimationFrame should NOT be called (no bounce)
      expect(rafMock).not.toHaveBeenCalled();
    });

    it('starts mobile hue cycling on self-update', async () => {
      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      const hueBefore = wrapper.vm.hue;
      await vi.advanceTimersByTimeAsync(200);
      expect(wrapper.vm.hue).not.toBe(hueBefore);
    });

    it('shows mobile-logo element instead of bouncing-logo', async () => {
      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.mobile-logo').exists()).toBe(true);
      expect(wrapper.find('.mobile-logo').isVisible()).toBe(true);
      expect(wrapper.find('.bouncing-logo').exists()).toBe(true);
      expect(wrapper.find('.bouncing-logo').isVisible()).toBe(false);
    });

    it('cleans up mobile hue timer on unmount', async () => {
      eventHandlers['self-update']();
      await wrapper.vm.$nextTick();

      wrapper.unmount();

      // Advancing timers should not cause errors after cleanup
      await vi.advanceTimersByTimeAsync(1000);
    });
  });
});
