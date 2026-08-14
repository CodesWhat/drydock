import { onMounted, onUnmounted } from 'vue';
import { useShortcutsOverlay } from './useShortcutsOverlay';

export interface KeyboardShortcutHandlers {
  /** Called when `/` is pressed outside a text-entry target. Typically opens/focuses search. */
  onFocusSearch?: () => void;
  /** Called on Escape (in addition to the shortcuts overlay closing itself if open). Typically blurs/closes search. */
  onEscapeSearch?: () => void;
}

/** True when the keydown target is already accepting text input — `/` and `?` must not
 * hijack normal typing (e.g. a user typing a literal "/" or "?" into a text field). */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') {
    return true;
  }
  if (tag !== 'input') {
    return false;
  }
  const input = target as HTMLInputElement;
  return input.type !== 'checkbox' && input.type !== 'radio' && input.type !== 'button';
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers = {}) {
  const shortcutsOverlay = useShortcutsOverlay();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === '?' && !isTextEntryTarget(e.target)) {
      e.preventDefault();
      shortcutsOverlay.open();
      return;
    }
    if (e.key === 'Escape') {
      if (shortcutsOverlay.visible.value) {
        shortcutsOverlay.close();
      }
      handlers.onEscapeSearch?.();
      return;
    }
    if (e.key === '/' && !isTextEntryTarget(e.target)) {
      e.preventDefault();
      handlers.onFocusSearch?.();
    }
  }

  onMounted(() => globalThis.addEventListener('keydown', handleKeydown));
  onUnmounted(() => globalThis.removeEventListener('keydown', handleKeydown));

  return { shortcutsOverlay };
}
