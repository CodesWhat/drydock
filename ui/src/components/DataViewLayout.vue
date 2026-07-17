<script setup lang="ts">
/**
 * DataViewLayout — Shared page-level layout for all data-driven views.
 *
 * Provides the standard flex structure:
 *   outer flex-col (full height) → inner flex row (gap-4) → left column + optional DetailPanel
 *
 * Scrolling is handled by the main content column in this component.
 * The outer wrapper escapes AppLayout padding so the scroll surface reaches
 * the viewport edge without dead zones on touch devices.
 *
 * Usage:
 *   <DataViewLayout>
 *     <DataFilterBar ... />
 *     <DataTable ... />
 *   </DataViewLayout>
 *
 * With a detail panel:
 *   <DataViewLayout>
 *     <DataFilterBar ... />
 *     <DataTable ... />
 *     <template #panel> <DetailPanel ... /> </template>
 *   </DataViewLayout>
 *
 * Content-width measurement: also measures the real content-box width of the main content
 * column (the flex-1 div below, excluding its own left/right padding) via ResizeObserver and
 * emits it as `content-width`. Views that need to know how much horizontal room is available
 * for responsive behavior (e.g. DataTable's column auto-hide, driven by useColumnVisibility /
 * table-sizing.ts) should consume this event instead of hand-deriving an estimate from window
 * width minus sidebar/panel pixel constants. A hand-rolled estimate can't see the flexbox `gap-2`
 * between this column and the `#panel` slot, or the panel's own margins — real geometry that
 * this measurement picks up for free because it reads the box the browser already laid out.
 */
import { onMounted, onUnmounted, ref } from 'vue';

const emit = defineEmits<{
  'content-width': [width: number];
}>();

const contentRef = ref<HTMLDivElement | null>(null);
let contentResizeObserver: ResizeObserver | null = null;
let lastEmittedContentWidth = -1;

// Content-box width: clientWidth (padding box) minus this element's own computed left/right
// padding. Reading the real computed padding — rather than hardcoding the `pl-*`/`pr-*` Tailwind
// values — keeps this correct across the `sm:` breakpoint (and any future padding tweaks)
// without reintroducing the kind of hand-rolled arithmetic this measurement replaces.
function measureContentWidth(): number {
  const el = contentRef.value;
  if (!el) {
    return 0;
  }
  const style = globalThis.getComputedStyle(el);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  return Math.max(0, el.clientWidth - paddingLeft - paddingRight);
}

// Epsilon-guarded: the ResizeObserver fires on sub-pixel jitter (fractional layout rounding,
// scrollbar show/hide, etc.) with no useful change in the actual measured width. Emitting on
// every such tick forces consumers (e.g. ContainersView's useColumnVisibility auto-hide) to
// recompute on noise — skip the emit when the delta from the last emitted value is sub-pixel,
// mirroring the same guard on DataTable's own viewport-width sync (DataTable.vue,
// syncTableViewportWidth).
function syncContentWidth() {
  const width = measureContentWidth();
  if (width <= 0) {
    return;
  }
  if (Math.abs(width - lastEmittedContentWidth) < 1) {
    return;
  }
  lastEmittedContentWidth = width;
  emit('content-width', width);
}

onMounted(() => {
  syncContentWidth();
  if (contentRef.value && typeof ResizeObserver !== 'undefined') {
    contentResizeObserver = new ResizeObserver(syncContentWidth);
    contentResizeObserver.observe(contentRef.value);
  }
});

onUnmounted(() => {
  contentResizeObserver?.disconnect();
  contentResizeObserver = null;
});
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 -ml-4 -mr-2 -my-4 sm:-ml-6 sm:-mr-[9px] sm:-my-6">
    <div class="flex gap-2 min-w-0 flex-1 min-h-0">
      <div
        ref="contentRef"
        class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain pl-4 pr-4 py-4 sm:pl-6 sm:pr-[24px] sm:py-6 dd-touch-scroll dd-scroll-stable">
        <slot />
      </div>
      <slot name="panel" />
    </div>
  </div>
</template>
