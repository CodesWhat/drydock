import { ref, onMounted, onUnmounted } from 'vue';

const isMobile = ref(globalThis.innerWidth < 768);
const windowNarrow = ref(globalThis.innerWidth < 1024);

function handleResize() {
  isMobile.value = globalThis.innerWidth < 768;
  windowNarrow.value = globalThis.innerWidth < 1024;
}

export function useBreakpoints() {
  onMounted(() => globalThis.addEventListener('resize', handleResize));
  onUnmounted(() => globalThis.removeEventListener('resize', handleResize));
  return { isMobile, windowNarrow };
}
