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
const loading = ref(false);

export function useConfirmDialog() {
  function require(opts: ConfirmOptions) {
    current.value = opts;
    visible.value = true;
    loading.value = false;
  }

  async function accept() {
    if (loading.value) {
      return;
    }
    const callback = current.value?.accept;
    if (!callback) {
      visible.value = false;
      current.value = null;
      return;
    }
    // Close dialog immediately — the action buttons show disabled/spinner
    // state via actionInProgress while the operation runs in the background.
    visible.value = false;
    current.value = null;
    try {
      await callback();
    } catch {
      // Callback is responsible for its own error handling.
    }
  }

  function reject() {
    if (loading.value) {
      return;
    }
    current.value?.reject?.();
    visible.value = false;
    current.value = null;
  }

  function dismiss() {
    if (loading.value) {
      return;
    }
    visible.value = false;
    current.value = null;
  }

  return { visible, current, loading, require, accept, reject, dismiss };
}
