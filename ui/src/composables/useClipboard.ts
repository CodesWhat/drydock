import { readonly, ref } from 'vue';

const FEEDBACK_DURATION_MS = 1500;

const copiedKey = ref<string | null>(null);
let resetTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReset() {
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    copiedKey.value = null;
    resetTimer = null;
  }, FEEDBACK_DURATION_MS);
}

export function useClipboard() {
  async function copyToClipboard(text: string, key?: string) {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key ?? text;
    scheduleReset();
  }

  function isCopied(key: string): boolean {
    return copiedKey.value === key;
  }

  return {
    copyToClipboard,
    isCopied,
    copiedKey: readonly(copiedKey),
  };
}
