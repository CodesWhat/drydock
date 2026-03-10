import { ref } from 'vue';

interface ConfirmOptions {
  header: string;
  message: string;
  acceptLabel?: string;
  rejectLabel?: string;
  severity?: 'danger' | 'warn';
  accept?: () => void | Promise<void>;
  reject?: () => void;
}

const visible = ref(false);
const current = ref<ConfirmOptions | null>(null);

export function useConfirmDialog() {
  function require(opts: ConfirmOptions) {
    current.value = opts;
    visible.value = true;
  }

  async function accept() {
    const callback = current.value?.accept;
    visible.value = false;
    current.value = null;
    if (!callback) {
      return;
    }
    try {
      await callback();
    } catch {
      // Callback is responsible for its own error handling.
    }
  }

  function reject() {
    current.value?.reject?.();
    visible.value = false;
    current.value = null;
  }

  function dismiss() {
    visible.value = false;
    current.value = null;
  }

  return { visible, current, require, accept, reject, dismiss };
}
