import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, type Ref, ref } from 'vue';
import { useDashboardDragAutoScroll } from '@/views/dashboard/useDashboardDragAutoScroll';

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

function dispatchPointerEvent(
  target: EventTarget,
  type: string,
  init: { clientY: number; pointerId: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    clientY: { value: init.clientY },
  });
  target.dispatchEvent(event);
}

function mountDragAutoScrollHarness() {
  let editMode!: Ref<boolean>;

  const Harness = defineComponent({
    setup() {
      const dashboardScrollEl = ref<HTMLElement | null>(null);
      editMode = ref(true);
      const dragAutoScroll = useDashboardDragAutoScroll({
        editMode,
        dashboardScrollEl,
      });
      return {
        dashboardScrollEl,
        ...dragAutoScroll,
      };
    },
    template: `
      <div ref="dashboardScrollEl" @pointerdown.capture="handleDashboardGridPointerDown">
        <button type="button" class="drag-handle">Drag</button>
        <button type="button" class="other-target">Other</button>
      </div>
    `,
  });

  const wrapper = mount(Harness, { attachTo: document.body });
  const scrollEl = wrapper.element as HTMLElement;
  Object.defineProperty(scrollEl, 'clientHeight', {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(scrollEl, 'scrollHeight', {
    configurable: true,
    value: 1_200,
  });
  scrollEl.scrollTop = 100;

  return {
    editMode,
    scrollEl,
    wrapper,
  };
}

describe('useDashboardDragAutoScroll', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: originalRequestAnimationFrame,
      writable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: originalCancelAnimationFrame,
      writable: true,
    });
  });

  it('only starts drag auto-scroll from drag handles and scrolls while dragging', async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const cancelAnimationFrameMock = vi.fn();
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: requestAnimationFrameMock,
      writable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: cancelAnimationFrameMock,
      writable: true,
    });

    const { wrapper, scrollEl } = mountDragAutoScrollHarness();
    const getBoundingClientRectSpy = vi
      .spyOn(scrollEl, 'getBoundingClientRect')
      .mockReturnValue({ top: 0, bottom: 400 } as DOMRect);

    try {
      dispatchPointerEvent(wrapper.find('.other-target').element, 'pointerdown', {
        pointerId: 1,
        clientY: 390,
      });
      expect(frameCallbacks).toHaveLength(0);

      dispatchPointerEvent(wrapper.find('.drag-handle').element, 'pointerdown', {
        pointerId: 1,
        clientY: 390,
      });
      dispatchPointerEvent(window, 'pointermove', {
        pointerId: 1,
        clientY: 395,
      });

      expect(frameCallbacks).toHaveLength(1);

      frameCallbacks[0](0);
      await nextTick();

      expect(scrollEl.scrollTop).toBeGreaterThan(100);
      expect(frameCallbacks).toHaveLength(2);

      dispatchPointerEvent(window, 'pointerup', {
        pointerId: 1,
        clientY: 395,
      });

      expect(cancelAnimationFrameMock).toHaveBeenCalledWith(2);
    } finally {
      getBoundingClientRectSpy.mockRestore();
      wrapper.unmount();
    }
  });

  it('cancels the queued frame when edit mode turns off mid-drag', async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const cancelAnimationFrameMock = vi.fn();
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: requestAnimationFrameMock,
      writable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: cancelAnimationFrameMock,
      writable: true,
    });

    const { wrapper, scrollEl, editMode } = mountDragAutoScrollHarness();
    const getBoundingClientRectSpy = vi
      .spyOn(scrollEl, 'getBoundingClientRect')
      .mockReturnValue({ top: 0, bottom: 400 } as DOMRect);

    try {
      dispatchPointerEvent(wrapper.find('.drag-handle').element, 'pointerdown', {
        pointerId: 1,
        clientY: 390,
      });
      dispatchPointerEvent(window, 'pointermove', {
        pointerId: 1,
        clientY: 395,
      });

      expect(frameCallbacks).toHaveLength(1);

      editMode.value = false;
      await nextTick();

      expect(cancelAnimationFrameMock).toHaveBeenCalledWith(1);

      frameCallbacks[0](0);
      await nextTick();

      expect(frameCallbacks).toHaveLength(1);
    } finally {
      getBoundingClientRectSpy.mockRestore();
      wrapper.unmount();
    }
  });
});
