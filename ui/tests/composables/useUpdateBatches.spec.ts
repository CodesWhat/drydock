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
    });
  });

  it('clears stored batches', () => {
    const store = useUpdateBatches();
    store.captureBatch('stack-a', 3);

    store.clearBatch('stack-a');

    expect(store.getBatch('stack-a')).toBeUndefined();
  });

  it('behaves as a module-scope singleton across callers', () => {
    const first = useUpdateBatches();
    const second = useUpdateBatches();

    first.captureBatch('stack-a', 2);

    expect(second.batches).toBe(first.batches);
    expect(second.getBatch('stack-a')?.frozenTotal).toBe(2);
  });
});
