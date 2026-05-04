import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/stores/toast';

describe('useToastStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
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
