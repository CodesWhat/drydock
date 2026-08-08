import { onMounted, onUnmounted, type Ref, ref } from 'vue';

/**
 * The non-standard `beforeinstallprompt` event fired by installable-app-capable
 * browsers (Chromium-based). Not yet part of `lib.dom.d.ts`.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface InstallPrompt {
  /** Whether the browser has signaled the app is installable right now. */
  available: Ref<boolean>;
  /** Show the native install prompt. Resolves with the user's choice. */
  promptInstall: () => Promise<InstallOutcome>;
}

/**
 * Captures the browser's `beforeinstallprompt` event so it can be replayed
 * later from a UI action (browsers require the prompt to be deferred and
 * triggered by an explicit user gesture rather than shown automatically).
 */
export function useInstallPrompt(): InstallPrompt {
  const available = ref(false);
  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  function handleBeforeInstallPrompt(event: Event) {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    available.value = true;
  }

  function handleAppInstalled() {
    deferredPrompt = null;
    available.value = false;
  }

  onMounted(() => {
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
  });

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.removeEventListener('appinstalled', handleAppInstalled);
  });

  async function promptInstall(): Promise<InstallOutcome> {
    if (!deferredPrompt) {
      return 'unavailable';
    }
    const prompt = deferredPrompt;
    deferredPrompt = null;
    available.value = false;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice.outcome;
  }

  return { available, promptInstall };
}
