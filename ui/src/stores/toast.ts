import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type ToastTone = 'error' | 'success' | 'warning' | 'info';

export interface ToastRecord {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
  dismissed: boolean;
  createdAt: number;
  expiresAt?: number;
}

export interface AddToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 6_000;

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Record<number, ToastRecord>>({});
  const nextId = ref(0);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  const visibleToasts = computed(() =>
    Object.values(toasts.value)
      .filter((toast) => !toast.dismissed)
      .sort((a, b) => a.createdAt - b.createdAt),
  );

  function add(input: AddToastInput): number {
    const id = nextId.value++;
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    const createdAt = Date.now();
    toasts.value = {
      ...toasts.value,
      [id]: {
        id,
        title: input.title,
        body: input.body,
        tone: input.tone ?? 'info',
        dismissed: false,
        createdAt,
        expiresAt: ttlMs > 0 ? createdAt + ttlMs : undefined,
      },
    };
    if (ttlMs > 0) {
      timers.set(
        id,
        setTimeout(() => {
          dismiss(id);
          timers.delete(id);
        }, ttlMs),
      );
    }
    return id;
  }

  function dismiss(id: number): void {
    const existing = toasts.value[id];
    if (!existing) {
      return;
    }
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    toasts.value = {
      ...toasts.value,
      [id]: {
        ...existing,
        dismissed: true,
      },
    };
  }

  function prune(now = Date.now()): void {
    const retained = Object.fromEntries(
      Object.entries(toasts.value).filter(([, toast]) => {
        if (!toast.dismissed) {
          return true;
        }
        return typeof toast.expiresAt === 'number' && toast.expiresAt > now;
      }),
    );
    toasts.value = retained;
  }

  function clear(): void {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    toasts.value = {};
  }

  return {
    toasts,
    visibleToasts,
    add,
    dismiss,
    prune,
    clear,
  };
});
