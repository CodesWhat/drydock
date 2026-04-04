import { onMounted, onUnmounted, type Ref, ref, watch } from 'vue';
import { clampDashboardScroll, computeDashboardDragScrollDelta } from './dashboardDragAutoScroll';

interface UseDashboardDragAutoScrollOptions {
  editMode: Ref<boolean>;
  dashboardScrollEl: Ref<HTMLElement | null>;
}

export function useDashboardDragAutoScroll({
  editMode,
  dashboardScrollEl,
}: UseDashboardDragAutoScrollOptions) {
  const activeDashboardDragPointerId = ref<number | null>(null);
  const dashboardDragPointerEngaged = ref(false);
  const dashboardDragPointerMoved = ref(false);
  const dashboardDragPointerY = ref<number | null>(null);
  let dashboardDragAutoScrollFrame: number | null = null;
  let dashboardDragAutoScrollActive = false;

  function resolveDashboardScrollEl(): HTMLElement | null {
    if (dashboardScrollEl.value) {
      return dashboardScrollEl.value;
    }
    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
  }

  function stopDashboardDragAutoScroll() {
    dashboardDragAutoScrollActive = false;
    dashboardDragPointerEngaged.value = false;
    dashboardDragPointerMoved.value = false;
    dashboardDragPointerY.value = null;
    activeDashboardDragPointerId.value = null;
    if (dashboardDragAutoScrollFrame !== null) {
      cancelAnimationFrame(dashboardDragAutoScrollFrame);
      dashboardDragAutoScrollFrame = null;
    }
  }

  function tickDashboardDragAutoScroll() {
    if (!dashboardDragAutoScrollActive || !editMode.value || !dashboardDragPointerEngaged.value) {
      dashboardDragAutoScrollFrame = null;
      return;
    }

    const scrollEl = resolveDashboardScrollEl();
    const pointerY = dashboardDragPointerY.value;
    if (scrollEl && dashboardDragPointerMoved.value && pointerY !== null) {
      const delta = computeDashboardDragScrollDelta(pointerY, scrollEl.getBoundingClientRect());
      if (delta !== 0) {
        const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
        if (maxScrollTop > 0) {
          scrollEl.scrollTop = clampDashboardScroll(scrollEl.scrollTop + delta, 0, maxScrollTop);
        }
      }
    }

    if (!dashboardDragAutoScrollActive || !editMode.value || !dashboardDragPointerEngaged.value) {
      dashboardDragAutoScrollFrame = null;
      return;
    }
    dashboardDragAutoScrollFrame = requestAnimationFrame(tickDashboardDragAutoScroll);
  }

  function ensureDashboardDragAutoScrollLoop() {
    if (dashboardDragAutoScrollFrame === null) {
      dashboardDragAutoScrollActive = true;
      dashboardDragAutoScrollFrame = requestAnimationFrame(tickDashboardDragAutoScroll);
    }
  }

  function handleDashboardGridPointerDown(event: PointerEvent) {
    if (!editMode.value || !(event.target instanceof Element)) {
      return;
    }
    if (!event.target.closest('.drag-handle')) {
      return;
    }

    dashboardDragPointerEngaged.value = true;
    dashboardDragPointerMoved.value = false;
    dashboardDragPointerY.value = event.clientY;
    activeDashboardDragPointerId.value =
      typeof event.pointerId === 'number' ? event.pointerId : null;
    ensureDashboardDragAutoScrollLoop();
  }

  function handleDashboardPointerMove(event: PointerEvent) {
    if (!dashboardDragPointerEngaged.value) {
      return;
    }
    if (
      activeDashboardDragPointerId.value !== null &&
      event.pointerId !== activeDashboardDragPointerId.value
    ) {
      return;
    }

    dashboardDragPointerMoved.value = true;
    dashboardDragPointerY.value = event.clientY;
  }

  function handleDashboardPointerEnd(event: PointerEvent) {
    if (!dashboardDragPointerEngaged.value) {
      return;
    }
    if (
      activeDashboardDragPointerId.value !== null &&
      event.pointerId !== activeDashboardDragPointerId.value
    ) {
      return;
    }

    stopDashboardDragAutoScroll();
  }

  watch(editMode, (isEditing) => {
    if (!isEditing) {
      stopDashboardDragAutoScroll();
    }
  });

  onMounted(() => {
    window.addEventListener('pointermove', handleDashboardPointerMove, { passive: true });
    window.addEventListener('pointerup', handleDashboardPointerEnd, { passive: true });
    window.addEventListener('pointercancel', handleDashboardPointerEnd, { passive: true });
    window.addEventListener('blur', stopDashboardDragAutoScroll);
  });

  onUnmounted(() => {
    window.removeEventListener('pointermove', handleDashboardPointerMove);
    window.removeEventListener('pointerup', handleDashboardPointerEnd);
    window.removeEventListener('pointercancel', handleDashboardPointerEnd);
    window.removeEventListener('blur', stopDashboardDragAutoScroll);
    stopDashboardDragAutoScroll();
  });

  return {
    handleDashboardGridPointerDown,
    stopDashboardDragAutoScroll,
  };
}
