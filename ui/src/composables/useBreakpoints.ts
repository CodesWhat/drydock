import { onMounted, onUnmounted, ref } from 'vue';

const windowWidth = ref(globalThis.innerWidth);
const isMobile = ref(globalThis.innerWidth < 768);
const windowNarrow = ref(globalThis.innerWidth < 1024);
let resizeFrameScheduled = false;

function syncBreakpoints() {
  windowWidth.value = globalThis.innerWidth;
  isMobile.value = globalThis.innerWidth < 768;
  windowNarrow.value = globalThis.innerWidth < 1024;
}

function handleResize() {
  if (resizeFrameScheduled) {
    return;
  }
  resizeFrameScheduled = true;
  globalThis.requestAnimationFrame(() => {
    resizeFrameScheduled = false;
    syncBreakpoints();
  });
}

export function useBreakpoints() {
  onMounted(() => globalThis.addEventListener('resize', handleResize));
  onUnmounted(() => globalThis.removeEventListener('resize', handleResize));
  return { isMobile, windowNarrow, windowWidth };
}
