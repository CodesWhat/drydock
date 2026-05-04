import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixedRingBuffer, useEventStreamStore } from '@/stores/eventStream';

describe('createFixedRingBuffer', () => {
  it('rejects non-positive and unsafe capacities', () => {
    expect(() => createFixedRingBuffer<number>(0)).toThrow(
      'Ring buffer capacity must be a positive safe integer',
    );
    expect(() => createFixedRingBuffer<number>(1.5)).toThrow(
      'Ring buffer capacity must be a positive safe integer',
    );
  });

  it('retains entries in chronological order up to its fixed capacity', () => {
    const buffer = createFixedRingBuffer<number>(3);

    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);

    expect(buffer.size).toBe(3);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
  });

  it('can be cleared and reused', () => {
    const buffer = createFixedRingBuffer<string>(2);

    buffer.push('first');
    buffer.push('second');
    buffer.clear();
    buffer.push('third');

    expect(buffer.size).toBe(1);
    expect(buffer.toArray()).toEqual(['third']);
  });
});

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

  it('keeps a bounded recent event history in chronological order', () => {
    const store = useEventStreamStore();

    for (let index = 0; index < 505; index += 1) {
      store.publish('container-updated', { index }, `event-${index}`);
    }

    expect(store.recentEvents).toHaveLength(500);
    expect(store.recentEvents[0]).toMatchObject({
      id: 'event-5',
      event: 'container-updated',
      payload: { index: 5 },
    });
    expect(store.recentEvents.at(-1)).toMatchObject({
      id: 'event-504',
      event: 'container-updated',
      payload: { index: 504 },
    });
  });
});
