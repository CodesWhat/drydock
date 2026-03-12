/**
 * Drydock Demo — entry point
 *
 * 1. Patch EventSource with FakeEventSource (before any UI code loads)
 * 2. Start MSW service worker to intercept all fetch() calls
 * 3. Boot the real Vue UI (imported from ../../ui/src via Vite alias)
 */

import { DEFAULTS } from '@/preferences/schema';
import { FakeEventSource } from './mocks/sse';

// Patch EventSource BEFORE any UI code loads — the SSE service
// creates an EventSource in AppLayout, so this must happen first.
(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;

function getParentOrigin(): string | null {
  if (!document.referrer) {
    return null;
  }

  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}

async function boot() {
  // Start MSW — must be running before the UI makes any fetch() calls
  const { worker } = await import('./mocks/browser');
  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
  });

  // Import demo CSS for Tailwind @source directive
  await import('./demo.css');

  // Default demo theme to 'system' variant so it follows the user's OS
  // light/dark preference, matching the surrounding website.
  if (!localStorage.getItem('dd-preferences')) {
    localStorage.setItem(
      'dd-preferences',
      JSON.stringify({
        ...structuredClone(DEFAULTS),
        theme: { family: 'one-dark', variant: 'system' },
      }),
    );
  }

  // Now boot the real UI
  await import('@/main');

  // Tell the parent frame (website) we loaded successfully
  if (window.parent !== window) {
    const parentOrigin = getParentOrigin();

    if (parentOrigin) {
      window.parent.postMessage({ type: 'drydock-demo-ready' }, parentOrigin);
    }
  }

  // Auto-fill login credentials so demo visitors just click "Sign in".
  // Uses MutationObserver to catch the login form whenever it appears.
  autofillLoginForm();
}

/**
 * Watch for the login form and pre-fill demo credentials.
 * Vue renders asynchronously, so we observe DOM mutations until the
 * username input appears, fill both fields, then keep watching in case
 * the user logs out and the form re-renders.
 */
function autofillLoginForm() {
  const fill = () => {
    const usernameInput = document.querySelector<HTMLInputElement>(
      'input[autocomplete="username"]',
    );
    const passwordInput = document.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    );
    if (usernameInput && passwordInput) {
      if (!usernameInput.value) {
        setNativeValue(usernameInput, 'demo');
      }
      if (!passwordInput.value) {
        setNativeValue(passwordInput, 'demo');
      }
    }
  };

  // Trigger Vue reactivity by dispatching an input event after setting value
  // via the native setter — v-model listens on 'input' events.
  const setNativeValue = (el: HTMLInputElement, value: string) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  const observer = new MutationObserver(() => fill());
  observer.observe(document.body, { childList: true, subtree: true });

  // Also try immediately in case the form is already rendered
  fill();
}

boot();
