import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/stores/toast';

describe('useToastStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    useToastStore().clear();
    vi.useRealTimers();
  });

  it('shows at most three toasts and promotes same-time additions in FIFO order', () => {
    const store = useToastStore();
    const ids = ['first', 'second', 'third', 'fourth', 'fifth'].map((title) =>
      store.add({ title, ttlMs: 0 }),
    );

    expect(store.visibleToasts.map((toast) => toast.id)).toEqual(ids.slice(0, 3));
    expect(Object.keys(store.toasts)).toHaveLength(5);
    store.dismiss(ids[1]);
    expect(store.visibleToasts.map((toast) => toast.id)).toEqual([ids[0], ids[2], ids[3]]);
    store.dismiss(ids[0]);
    expect(store.visibleToasts.map((toast) => toast.id)).toEqual(ids.slice(2));
  });

  it('starts the queued duration only when a visible slot opens', () => {
    const store = useToastStore();
    const first = store.add({ title: 'first', ttlMs: 0 });
    store.add({ title: 'second', ttlMs: 0 });
    store.add({ title: 'third', ttlMs: 0 });
    const queued = store.add({ title: 'queued', body: 'details', tone: 'warning', ttlMs: 1000 });

    expect(store.toasts[queued].expiresAt).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    store.dismiss(first);
    expect(store.visibleToasts[2]).toMatchObject({
      id: queued,
      title: 'queued',
      body: 'details',
      tone: 'warning',
      createdAt: 0,
      expiresAt: 11_000,
      dismissed: false,
    });
    vi.advanceTimersByTime(999);
    expect(store.visibleToasts).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(store.visibleToasts).toHaveLength(2);
    expect(store.toasts[queued].dismissed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('promotes a queued default-duration toast on expiry without shortening its duration', () => {
    const store = useToastStore();
    store.add({ title: 'first', ttlMs: 1000 });
    store.add({ title: 'second', ttlMs: 0 });
    store.add({ title: 'third', ttlMs: 0 });
    const queued = store.add({ title: 'queued' });

    vi.advanceTimersByTime(1000);
    expect(store.visibleToasts[2]).toMatchObject({ id: queued, tone: 'info', expiresAt: 7000 });
    vi.advanceTimersByTime(5999);
    expect(store.visibleToasts).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(store.visibleToasts).toHaveLength(2);
  });

  it('can dismiss a queued toast without showing it or disturbing visible timers', () => {
    const store = useToastStore();
    const ids = ['first', 'second', 'third', 'discard', 'keep'].map((title) =>
      store.add({ title }),
    );
    store.dismiss(ids[3]);
    store.dismiss(ids[3]);
    store.dismiss(999);
    expect(vi.getTimerCount()).toBe(3);
    store.dismiss(ids[0]);
    expect(store.visibleToasts.map((toast) => toast.id)).toEqual([ids[1], ids[2], ids[4]]);
    expect(store.toasts[ids[3]].dismissed).toBe(true);
  });

  it('keeps a queued persistent toast until explicitly dismissed', () => {
    const store = useToastStore();
    const first = store.add({ title: 'first', ttlMs: 0 });
    store.add({ title: 'second', ttlMs: 0 });
    store.add({ title: 'third', ttlMs: 0 });
    const queued = store.add({ title: 'persistent', ttlMs: 0 });
    expect(store.visibleToasts.map((toast) => toast.id)).not.toContain(queued);
    store.dismiss(first);
    vi.advanceTimersByTime(60_000);
    expect(store.visibleToasts[2]).toMatchObject({ id: queued, expiresAt: undefined });
    store.dismiss(queued);
    expect(store.visibleToasts).toHaveLength(2);
  });

  it('prunes only dismissed records while retaining live and queued records', () => {
    const store = useToastStore();
    const first = store.add({ title: 'first', ttlMs: 1000 });
    store.add({ title: 'second', ttlMs: 0 });
    store.add({ title: 'third', ttlMs: 0 });
    const discarded = store.add({ title: 'discarded' });
    const queued = store.add({ title: 'queued', ttlMs: 2000 });
    store.dismiss(discarded);
    store.prune();
    expect(store.toasts[discarded]).toBeUndefined();
    expect(store.toasts[queued].dismissed).toBe(false);
    store.dismiss(first);
    store.prune(999);
    expect(store.toasts[first]).toBeDefined();
    store.prune(1000);
    expect(store.toasts[first]).toBeUndefined();
    expect(store.visibleToasts[2].id).toBe(queued);
    vi.advanceTimersByTime(2000);
    store.prune();
    expect(store.toasts[queued]).toBeUndefined();
  });

  it('clears visible timers and the queue without later promotion', () => {
    const store = useToastStore();
    for (let index = 0; index < 5; index += 1) store.add({ title: String(index) });
    expect(vi.getTimerCount()).toBe(3);
    store.clear();
    expect(store.toasts).toEqual({});
    expect(store.visibleToasts).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    const fresh = store.add({ title: 'fresh', ttlMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(store.visibleToasts.map((toast) => toast.id)).toEqual([fresh]);
    expect(fresh).toBe(5);
  });

  it('adds, dismisses, and prunes toast records declaratively', () => {
    vi.useFakeTimers();
    try {
      const store = useToastStore();

      store.dismiss(999);

      const id = store.add({ title: 'Updated web', tone: 'success', ttlMs: 1000 });

      expect(store.visibleToasts).toEqual([
        expect.objectContaining({ id, title: 'Updated web', tone: 'success', dismissed: false }),
      ]);

      store.dismiss(id);
      expect(store.visibleToasts).toEqual([]);

      const persistentId = store.add({ title: 'Persistent', tone: 'info', ttlMs: 0 });
      vi.advanceTimersByTime(10_000);
      store.prune();
      expect(store.toasts[persistentId]).toEqual(
        expect.objectContaining({ title: 'Persistent', dismissed: false }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
