import { ref } from 'vue';

export interface ConfirmOptions {
  header: string;
  message: string;
  acceptLabel?: string;
  rejectLabel?: string;
  severity?: 'danger' | 'warn';
  accept?: () => void;
  reject?: () => void;
}

const visible = ref(false);
const current = ref<ConfirmOptions | null>(null);

export function useConfirmDialog() {
  function require(opts: ConfirmOptions) {
    current.value = opts;
    visible.value = true;
  }

  function accept() {
    current.value?.accept?.();
    visible.value = false;
    current.value = null;
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
