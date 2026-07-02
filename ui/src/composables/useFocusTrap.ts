import { type ComputedRef, onScopeDispose, type Ref, watchEffect } from 'vue';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Focus trap for a genuinely modal container.
 *
 * On activation (`active` transitions to `true`): remembers the currently
 * focused element and moves focus onto the container (which must carry
 * `tabindex="-1"` so it can receive focus directly). While active,
 * Tab/Shift+Tab cycle within the container's focusable descendants instead
 * of escaping it. On deactivation (`active` transitions to `false`, or the
 * enclosing effect scope is disposed while still active), the keydown
 * listener is removed and focus is restored to the previously focused
 * element — but only if it is still attached to the document.
 *
 * Do not use this for non-modal UI (e.g. a sticky sidebar the user keeps
 * open while clicking through rows) — stealing focus on every activation
 * would break keyboard browsing of the underlying content.
 *
 * Uses `watchEffect` with `flush: 'post'` rather than `watch(..., {
 * immediate: true, flush: 'post' })`: Vue only defers a `watch`'s
 * *immediate* invocation to the scheduler when there's no `flush: 'post'`
 * involved for `watchEffect`-style sources — a `watch()`'s immediate call
 * always runs synchronously at setup time, before the container's template
 * ref is bound. `watchEffect` defers its first run consistently with later
 * reruns, so `containerRef` is guaranteed to be populated by the time
 * activation logic executes, even when `active` is already `true` on the
 * very first render.
 *
 * @param containerRef Ref to the trap's root element.
 * @param active Reactive boolean controlling whether the trap is engaged.
 */
export function useFocusTrap(
  containerRef: Ref<HTMLElement | null>,
  active: Ref<boolean> | ComputedRef<boolean>,
) {
  let previouslyFocused: HTMLElement | null = null;
  let trapEngaged = false;

  function getFocusableElements(): HTMLElement[] {
    return Array.from(containerRef.value?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') {
      return;
    }

    const focusable = getFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      containerRef.value?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function activate() {
    previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    containerRef.value?.focus();
    document.addEventListener('keydown', handleKeydown);
  }

  function deactivate() {
    document.removeEventListener('keydown', handleKeydown);
    if (previouslyFocused?.isConnected) {
      previouslyFocused.focus();
    }
    previouslyFocused = null;
  }

  watchEffect(
    () => {
      const isActive = active.value;
      if (isActive && !trapEngaged) {
        trapEngaged = true;
        activate();
      } else if (!isActive && trapEngaged) {
        trapEngaged = false;
        deactivate();
      }
    },
    { flush: 'post' },
  );

  onScopeDispose(() => {
    if (trapEngaged) {
      trapEngaged = false;
      deactivate();
    }
  });
}
