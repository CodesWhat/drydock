import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { computed } from 'vue';
import { type ToastTone, useToastStore } from '@/stores/toast';

export type { ToastTone };

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
}

let fallbackPinia: ReturnType<typeof createPinia> | undefined;

function getToastStore() {
  if (!getActivePinia()) {
    fallbackPinia ||= createPinia();
    setActivePinia(fallbackPinia);
  }
  return useToastStore();
}

export function useToast() {
  const store = getToastStore();
  const toasts = computed<Toast[]>({
    get: () =>
      store.visibleToasts.map((toast) => ({
        id: toast.id,
        title: toast.title,
        body: toast.body,
        tone: toast.tone,
      })),
    set: (nextToasts) => {
      store.clear();
      for (const toast of nextToasts) {
        store.add({
          title: toast.title,
          body: toast.body,
          tone: toast.tone,
          ttlMs: 0,
        });
      }
    },
  });

  function addToast(
    title: string,
    options?: { body?: string; tone?: ToastTone; duration?: number },
  ) {
    return store.add({
      title,
      body: options?.body,
      tone: options?.tone,
      ttlMs: options?.duration,
    });
  }

  return {
    toasts,
    addToast,
    dismissToast: store.dismiss,
    error: (title: string, body?: string) => addToast(title, { tone: 'error', body }),
    success: (title: string, body?: string) => addToast(title, { tone: 'success', body }),
    warning: (title: string, body?: string) => addToast(title, { tone: 'warning', body }),
    info: (title: string, body?: string) => addToast(title, { tone: 'info', body }),
  };
}
