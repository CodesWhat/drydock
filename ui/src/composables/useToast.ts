import { ref } from 'vue';

export type ToastTone = 'error' | 'success' | 'warning' | 'info';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
}

const AUTO_DISMISS_MS = 6_000;

let nextId = 0;
const toasts = ref<Toast[]>([]);

function addToast(title: string, options?: { body?: string; tone?: ToastTone; duration?: number }) {
  const id = nextId++;
  const tone = options?.tone ?? 'info';
  const duration = options?.duration ?? AUTO_DISMISS_MS;
  toasts.value = [...toasts.value, { id, title, body: options?.body, tone }];
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
}

function dismissToast(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function useToast() {
  return {
    toasts,
    addToast,
    dismissToast,
    error: (title: string, body?: string) => addToast(title, { tone: 'error', body }),
    success: (title: string, body?: string) => addToast(title, { tone: 'success', body }),
    warning: (title: string, body?: string) => addToast(title, { tone: 'warning', body }),
    info: (title: string, body?: string) => addToast(title, { tone: 'info', body }),
  };
}
