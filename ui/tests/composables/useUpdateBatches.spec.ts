import { useUpdateBatches } from '@/composables/useUpdateBatches';

describe('useUpdateBatches', () => {
  beforeEach(() => {
    useUpdateBatches().batches.value = new Map();
  });

  it('captures and reads frozen totals by group key', () => {
    const store = useUpdateBatches();

    store.captureBatch('stack-a', 3);

    expect(store.getBatch('stack-a')).toEqual({
      frozenTotal: 3,
      startedAt: expect.any(Number),
      succeededCount: 0,
      failedCount: 0,
    });
  });

  it('initialises succeededCount and failedCount to 0 on capture', () => {
    const store = useUpdateBatches();
    store.captureBatch('stack-b', 4);

    const batch = store.getBatch('stack-b');
    expect(batch?.succeededCount).toBe(0);
    expect(batch?.failedCount).toBe(0);
  });

  it('increments succeededCount without touching failedCount', () => {
    const store = useUpdateBatches();
    store.captureBatch('stack-a', 2);

    store.incrementSucceeded('stack-a');

    expect(store.getBatch('stack-a')?.succeededCount).toBe(1);
    expect(store.getBatch('stack-a')?.failedCount).toBe(0);
  });

  it('increments succeededCount multiple times', () => {
    const store = useUpdateBatches();
    store.captureBatch('stack-a', 3);

    store.incrementSucceeded('stack-a');
    store.incrementSucceeded('stack-a');

    expect(store.getBatch('stack-a')?.succeededCount).toBe(2);
  });

  it('increments failedCount without touching succeededCount', () => {
    const store = useUpdateBatches();
    store.captureBatch('stack-a', 2);

    store.incrementFailed('stack-a');

    expect(store.getBatch('stack-a')?.failedCount).toBe(1);
    expect(store.getBatch('stack-a')?.succeededCount).toBe(0);
  });

  it('increments both counters independently', () => {
    const store = useUpdateBatches();
    store.captureBatch('stack-a', 3);

    store.incrementSucceeded('stack-a');
    store.incrementFailed('stack-a');

    expect(store.getBatch('stack-a')?.succeededCount).toBe(1);
    expect(store.getBatch('stack-a')?.failedCount).toBe(1);
  });

  it('ignores incrementSucceeded for unknown group key', () => {
    const store = useUpdateBatches();
    // Should not throw
    store.incrementSucceeded('no-such-group');
    expect(store.getBatch('no-such-group')).toBeUndefined();
  });

  it('ignores incrementFailed for unknown group key', () => {
    const store = useUpdateBatches();
    // Should not throw
    store.incrementFailed('no-such-group');
    expect(store.getBatch('no-such-group')).toBeUndefined();
  });

  it('clears stored batches', () => {
    const store = useUpdateBatches();
    store.captureBatch('stack-a', 3);

    store.clearBatch('stack-a');

    expect(store.getBatch('stack-a')).toBeUndefined();
  });

  it('clearBatch is a no-op when batch does not exist', () => {
    const store = useUpdateBatches();
    // Should not throw
    store.clearBatch('no-such-group');
    expect(store.getBatch('no-such-group')).toBeUndefined();
  });

  it('resets counters when a new batch is captured for the same key', () => {
    const store = useUpdateBatches();
    store.captureBatch('stack-a', 2);
    store.incrementSucceeded('stack-a');
    store.incrementFailed('stack-a');

    // Re-capture resets counters
    store.captureBatch('stack-a', 3);

    expect(store.getBatch('stack-a')?.succeededCount).toBe(0);
    expect(store.getBatch('stack-a')?.failedCount).toBe(0);
    expect(store.getBatch('stack-a')?.frozenTotal).toBe(3);
  });

  it('behaves as a module-scope singleton across callers', () => {
    const first = useUpdateBatches();
    const second = useUpdateBatches();

    first.captureBatch('stack-a', 2);

    expect(second.batches).toBe(first.batches);
    expect(second.getBatch('stack-a')?.frozenTotal).toBe(2);
  });

  it('propagates incrementSucceeded changes to a second caller', () => {
    const first = useUpdateBatches();
    const second = useUpdateBatches();

    first.captureBatch('stack-a', 2);
    first.incrementSucceeded('stack-a');

    expect(second.getBatch('stack-a')?.succeededCount).toBe(1);
  });
});
