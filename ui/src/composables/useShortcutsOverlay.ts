import { ref } from 'vue';

const visible = ref(false);

export function useShortcutsOverlay() {
  function open() {
    visible.value = true;
  }
  function close() {
    visible.value = false;
  }
  return { visible, open, close };
}
