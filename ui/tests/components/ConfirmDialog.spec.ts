import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

const visible = ref(false);
const current = ref<any>(null);
const accept = vi.fn();
const reject = vi.fn();
const dismiss = vi.fn();

vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    visible,
    current,
    accept,
    reject,
    dismiss,
  }),
}));

function showDialog() {
  visible.value = true;
  current.value = {
    header: 'Confirm action',
    message: 'Proceed?',
    acceptLabel: 'Confirm',
    rejectLabel: 'Cancel',
  };
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    visible.value = false;
    current.value = null;
    accept.mockClear();
    reject.mockClear();
    dismiss.mockClear();
  });

  it('dismisses the dialog on Escape', async () => {
    const wrapper = mount(ConfirmDialog);
    showDialog();
    await nextTick();

    globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismiss).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('accepts the dialog on Enter', async () => {
    const wrapper = mount(ConfirmDialog);
    showDialog();
    await nextTick();

    globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(accept).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('does not accept on Enter when typing in a text input', async () => {
    const wrapper = mount(ConfirmDialog);
    showDialog();
    await nextTick();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(accept).not.toHaveBeenCalled();

    input.remove();
    wrapper.unmount();
  });

  it('renders dialog semantics when visible', async () => {
    const wrapper = mount(ConfirmDialog);
    showDialog();
    await nextTick();

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');

    const labelledBy = dialog?.getAttribute('aria-labelledby');
    const describedBy = dialog?.getAttribute('aria-describedby');
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toBeTruthy();

    wrapper.unmount();
  });

  it('does not render a link when none is provided', async () => {
    const wrapper = mount(ConfirmDialog);
    showDialog();
    await nextTick();

    expect(document.body.querySelector('[data-test="confirm-dialog-link"]')).toBeNull();

    wrapper.unmount();
  });

  it('renders a docs link below the message when provided', async () => {
    const wrapper = mount(ConfirmDialog);
    visible.value = true;
    current.value = {
      header: 'Update Container',
      message: 'This update is currently policy-blocked.',
      acceptLabel: 'Update anyway',
      rejectLabel: 'Cancel',
      link: {
        href: 'https://getdrydock.com/docs/configuration/actions/update-eligibility#reasons-reference',
        label: 'Learn more',
      },
    };
    await nextTick();

    const link = document.body.querySelector(
      '[data-test="confirm-dialog-link"]',
    ) as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe(
      'https://getdrydock.com/docs/configuration/actions/update-eligibility#reasons-reference',
    );
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.textContent?.trim()).toBe('Learn more');

    wrapper.unmount();
  });
});
