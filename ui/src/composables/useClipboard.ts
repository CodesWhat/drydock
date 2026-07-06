import { readonly, ref } from 'vue';

const FEEDBACK_DURATION_MS = 1500;

const copiedKey = ref<string | null>(null);
const failedKey = ref<string | null>(null);
let resetTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReset() {
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    copiedKey.value = null;
    failedKey.value = null;
    resetTimer = null;
  }, FEEDBACK_DURATION_MS);
}

/**
 * Legacy fallback for contexts where the async Clipboard API is unavailable:
 * plain http (insecure context — the primary self-hosted LAN deployment
 * mode), older browsers, and some cross-origin iframes. Copies via a
 * hidden, off-screen textarea and the deprecated but still universally
 * supported document.execCommand('copy').
 */
function copyWithExecCommand(text: string): boolean {
  if (typeof document.execCommand !== 'function') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';

  const previouslyFocused = document.activeElement;
  let succeeded = false;

  try {
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    succeeded = document.execCommand('copy');
  } catch {
    succeeded = false;
  } finally {
    // appendChild/select can throw (e.g. a sandboxed iframe denying the
    // operation) before the textarea ever attaches — guard removeChild so
    // cleanup itself can't throw and leak the element or the focus restore.
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
    if (previouslyFocused instanceof HTMLElement) {
      previouslyFocused.focus();
    }
  }

  return succeeded;
}

/**
 * Tries the modern, permission-aware async Clipboard API first, then falls
 * back to the legacy execCommand technique both when the API is absent
 * (insecure http contexts, older browsers) and when it rejects (e.g. a
 * cross-origin iframe without the clipboard-write permission).
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Rejected (permission denied, insecure-context inconsistency, iframe
      // restrictions) — fall through to the legacy path below.
    }
  }

  return copyWithExecCommand(text);
}

export function useClipboard() {
  async function copyToClipboard(text: string, key?: string): Promise<boolean> {
    const resolvedKey = key ?? text;
    const succeeded = await writeToClipboard(text);

    if (succeeded) {
      copiedKey.value = resolvedKey;
      failedKey.value = null;
    } else {
      failedKey.value = resolvedKey;
      copiedKey.value = null;
    }
    scheduleReset();

    return succeeded;
  }

  function isCopied(key: string): boolean {
    return copiedKey.value === key;
  }

  function isFailed(key: string): boolean {
    return failedKey.value === key;
  }

  return {
    copyToClipboard,
    isCopied,
    isFailed,
    copiedKey: readonly(copiedKey),
    failedKey: readonly(failedKey),
  };
}
