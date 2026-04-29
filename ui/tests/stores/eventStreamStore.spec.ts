import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventStreamStore } from '@/stores/eventStream';

describe('useEventStreamStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps subscriber sets until the last callback unsubscribes', () => {
    const store = useEventStreamStore();
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = store.subscribe('update-applied', first);
    const unsubscribeSecond = store.subscribe('update-applied', second);

    unsubscribeFirst();
    store.publish('update-applied', { operationId: 'op-1' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(
      { operationId: 'op-1' },
      expect.objectContaining({ event: 'update-applied' }),
    );

    unsubscribeSecond();
    second.mockClear();
    store.publish('update-applied', { operationId: 'op-2' });

    expect(second).not.toHaveBeenCalled();
  });
});
