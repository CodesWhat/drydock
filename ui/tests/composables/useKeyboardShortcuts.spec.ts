import { defineComponent, h } from 'vue';
import { isTextEntryTarget, useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import { useShortcutsOverlay } from '@/composables/useShortcutsOverlay';
import { mountWithPlugins } from '../helpers/mount';

function mountHost(handlers: Parameters<typeof useKeyboardShortcuts>[0] = {}) {
  const Host = defineComponent({
    setup() {
      useKeyboardShortcuts(handlers);
      return () => h('div');
    },
  });
  return mountWithPlugins(Host);
}

describe('isTextEntryTarget', () => {
  it('returns false for a non-HTMLElement target', () => {
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget({} as EventTarget)).toBe(false);
  });

  it('returns true for a textarea', () => {
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true);
  });

  it('returns true for a select', () => {
    expect(isTextEntryTarget(document.createElement('select'))).toBe(true);
  });

  it('returns true for a text input', () => {
    const input = document.createElement('input');
    input.type = 'text';
    expect(isTextEntryTarget(input)).toBe(true);
  });

  it('returns false for a checkbox input', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    expect(isTextEntryTarget(input)).toBe(false);
  });

  it('returns false for a radio input', () => {
    const input = document.createElement('input');
    input.type = 'radio';
    expect(isTextEntryTarget(input)).toBe(false);
  });

  it('returns false for a button input', () => {
    const input = document.createElement('input');
    input.type = 'button';
    expect(isTextEntryTarget(input)).toBe(false);
  });

  it('returns true for a contenteditable element', () => {
    // jsdom doesn't implement the contentEditable attribute/property wiring,
    // so simulate the browser's computed `isContentEditable` directly.
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTextEntryTarget(div)).toBe(true);
  });

  it('returns false for a plain div', () => {
    expect(isTextEntryTarget(document.createElement('div'))).toBe(false);
  });
});

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    useShortcutsOverlay().close();
  });

  it('calls onFocusSearch and prevents default when "/" is pressed outside a text input', () => {
    const onFocusSearch = vi.fn();
    const wrapper = mountHost({ onFocusSearch });

    const event = new KeyboardEvent('keydown', { key: '/', cancelable: true });
    globalThis.dispatchEvent(event);

    expect(onFocusSearch).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    wrapper.unmount();
  });

  it('does not call onFocusSearch when "/" is pressed inside a text input', () => {
    const onFocusSearch = vi.fn();
    const wrapper = mountHost({ onFocusSearch });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));

    expect(onFocusSearch).not.toHaveBeenCalled();

    input.remove();
    wrapper.unmount();
  });

  it('opens the shortcuts overlay and prevents default when "?" is pressed outside a text input', () => {
    const wrapper = mountHost();
    const overlay = useShortcutsOverlay();

    const event = new KeyboardEvent('keydown', { key: '?', cancelable: true });
    globalThis.dispatchEvent(event);

    expect(overlay.visible.value).toBe(true);
    expect(event.defaultPrevented).toBe(true);

    wrapper.unmount();
  });

  it('does not open the shortcuts overlay when "?" is pressed inside a text input', () => {
    const wrapper = mountHost();
    const overlay = useShortcutsOverlay();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));

    expect(overlay.visible.value).toBe(false);

    input.remove();
    wrapper.unmount();
  });

  it('calls onEscapeSearch on Escape when the overlay is not open', () => {
    const onEscapeSearch = vi.fn();
    const wrapper = mountHost({ onEscapeSearch });
    const overlay = useShortcutsOverlay();

    globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(overlay.visible.value).toBe(false);
    expect(onEscapeSearch).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('closes the shortcuts overlay and calls onEscapeSearch on Escape when the overlay is open', () => {
    const onEscapeSearch = vi.fn();
    const wrapper = mountHost({ onEscapeSearch });
    const overlay = useShortcutsOverlay();
    overlay.open();

    globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(overlay.visible.value).toBe(false);
    expect(onEscapeSearch).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('is safe to call without any handlers provided', () => {
    const wrapper = mountHost();

    expect(() => {
      globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
      globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }).not.toThrow();

    wrapper.unmount();
  });

  it('removes the keydown listener on unmount', () => {
    const onFocusSearch = vi.fn();
    const wrapper = mountHost({ onFocusSearch });

    wrapper.unmount();
    globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));

    expect(onFocusSearch).not.toHaveBeenCalled();
  });
});
