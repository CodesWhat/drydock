import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import KeyboardShortcutsOverlay from '@/components/KeyboardShortcutsOverlay.vue';

const visible = ref(false);
const close = vi.fn();

vi.mock('@/composables/useShortcutsOverlay', () => ({
  useShortcutsOverlay: () => ({
    visible,
    close,
  }),
}));

describe('KeyboardShortcutsOverlay', () => {
  beforeEach(() => {
    visible.value = false;
    close.mockClear();
  });

  it('is hidden by default', () => {
    const wrapper = mount(KeyboardShortcutsOverlay);

    expect(document.body.querySelector('[data-test="keyboard-shortcuts-overlay"]')).toBeNull();

    wrapper.unmount();
  });

  it('becomes visible when the overlay state is opened', async () => {
    const wrapper = mount(KeyboardShortcutsOverlay);
    visible.value = true;
    await nextTick();

    const dialog = document.body.querySelector('[data-test="keyboard-shortcuts-overlay"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');

    wrapper.unmount();
  });

  it('closes on close-button click', async () => {
    const wrapper = mount(KeyboardShortcutsOverlay);
    visible.value = true;
    await nextTick();

    const closeButton = document.body.querySelector(
      '[data-test="keyboard-shortcuts-close"]',
    ) as HTMLElement | null;
    expect(closeButton).toBeTruthy();
    closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(close).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('closes on backdrop pointerdown', async () => {
    const wrapper = mount(KeyboardShortcutsOverlay);
    visible.value = true;
    await nextTick();

    const dialog = document.body.querySelector(
      '[data-test="keyboard-shortcuts-overlay"]',
    ) as HTMLElement;
    const backdrop = dialog.parentElement as HTMLElement;
    backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(close).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  describe('focus management', () => {
    it('carries tabindex="-1" so the dialog can receive programmatic focus', async () => {
      const wrapper = mount(KeyboardShortcutsOverlay);
      visible.value = true;
      await nextTick();

      const dialog = document.body.querySelector('[data-test="keyboard-shortcuts-overlay"]');
      expect(dialog?.getAttribute('tabindex')).toBe('-1');

      wrapper.unmount();
    });

    it('moves focus into the dialog when the overlay opens', async () => {
      const wrapper = mount(KeyboardShortcutsOverlay);
      visible.value = true;
      await nextTick();

      const dialog = document.body.querySelector('[data-test="keyboard-shortcuts-overlay"]');
      expect(document.activeElement).toBe(dialog);

      wrapper.unmount();
    });

    it('traps Tab within the dialog, wrapping around the single focusable close button', async () => {
      const wrapper = mount(KeyboardShortcutsOverlay);
      visible.value = true;
      await nextTick();

      const closeButton = document.body.querySelector(
        '[data-test="keyboard-shortcuts-close"]',
      ) as HTMLElement;
      closeButton.focus();
      expect(document.activeElement).toBe(closeButton);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(closeButton);

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      );
      expect(document.activeElement).toBe(closeButton);

      wrapper.unmount();
    });

    it('restores focus to the previously focused element when the overlay closes', async () => {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const wrapper = mount(KeyboardShortcutsOverlay);
      visible.value = true;
      await nextTick();

      const dialog = document.body.querySelector('[data-test="keyboard-shortcuts-overlay"]');
      expect(document.activeElement).toBe(dialog);

      visible.value = false;
      await nextTick();

      expect(document.activeElement).toBe(trigger);

      trigger.remove();
      wrapper.unmount();
    });

    it('skips restore when the triggering element was removed from the DOM while open', async () => {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();

      const wrapper = mount(KeyboardShortcutsOverlay);
      visible.value = true;
      await nextTick();

      trigger.remove();
      expect(trigger.isConnected).toBe(false);

      visible.value = false;
      await nextTick();

      expect(document.activeElement).not.toBe(trigger);

      wrapper.unmount();
    });
  });

  it('renders all shortcut rows with their kbd text', async () => {
    const wrapper = mount(KeyboardShortcutsOverlay);
    visible.value = true;
    await nextTick();

    const dialog = document.body.querySelector(
      '[data-test="keyboard-shortcuts-overlay"]',
    ) as HTMLElement;
    const kbdTexts = Array.from(dialog.querySelectorAll('kbd')).map((el) => el.textContent?.trim());

    expect(kbdTexts).toContain('/');
    expect(kbdTexts).toContain('Esc');
    expect(kbdTexts).toContain('?');
    expect(kbdTexts.some((text) => text?.includes('K'))).toBe(true);
    expect(dialog.textContent).toContain('Focus search');
    expect(dialog.textContent).toContain('Close search or dismiss dialogs');
    expect(dialog.textContent).toContain('Show this help');
    expect(dialog.textContent).toContain('Toggle search');

    wrapper.unmount();
  });
});
