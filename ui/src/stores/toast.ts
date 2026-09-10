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
const MAX_VISIBLE_TOASTS = 3;

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Record<number, ToastRecord>>({});
  const nextId = ref(0);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const visibleIds = ref<number[]>([]);
  const queuedDurations = new Map<number, number>();

  const visibleToasts = computed(() => visibleIds.value.map((id) => toasts.value[id]));

  function promoteQueued(): void {
    while (visibleIds.value.length < MAX_VISIBLE_TOASTS) {
      const next = queuedDurations.entries().next().value;
      if (!next) return;
      const [id, ttlMs] = next;
      queuedDurations.delete(id);
      visibleIds.value.push(id);
      if (ttlMs > 0) {
        toasts.value[id].expiresAt = Date.now() + ttlMs;
        timers.set(
          id,
          setTimeout(() => dismiss(id), ttlMs),
        );
      }
    }
  }

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
        expiresAt: undefined,
      },
    };
    queuedDurations.set(id, ttlMs);
    promoteQueued();
    return id;
  }

  function dismiss(id: number): void {
    const existing = toasts.value[id];
    if (!existing || existing.dismissed) {
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
    queuedDurations.delete(id);
    visibleIds.value = visibleIds.value.filter((visibleId) => visibleId !== id);
    promoteQueued();
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
    queuedDurations.clear();
    visibleIds.value = [];
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
