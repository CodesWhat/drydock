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
});
