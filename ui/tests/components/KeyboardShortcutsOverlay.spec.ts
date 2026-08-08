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
