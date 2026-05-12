import { BatchDispatcher } from './trigger-batch-dispatcher.js';

describe('BatchDispatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('coalesces entries by key and flushes after the delay', async () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new BatchDispatcher<string, { key: string; value: number }>({
      dispatches: new Map(),
      flushDelayMs: 10,
      getKey: (entry) => entry.key,
      flush,
      onUnexpectedError: vi.fn(),
    });

    dispatcher.queue('update-applied', { key: 'web', value: 1 });
    dispatcher.queue('update-applied', { key: 'web', value: 2 });

    vi.advanceTimersByTime(10);
    await Promise.resolve();

    expect(flush).toHaveBeenCalledWith('update-applied', [{ key: 'web', value: 2 }]);
  });

  test('clears timers and buffered entries', () => {
    vi.useFakeTimers();
    const dispatches = new Map();
    const dispatcher = new BatchDispatcher<string, { key: string }>({
      dispatches,
      flushDelayMs: 10,
      getKey: (entry) => entry.key,
      flush: vi.fn().mockResolvedValue(undefined),
      onUnexpectedError: vi.fn(),
    });

    dispatcher.queue('update-applied', { key: 'web' });
    dispatcher.clear();
    vi.advanceTimersByTime(10);

    expect(dispatches.size).toBe(0);
  });

  test('routes unexpected flush rejections to the error handler', async () => {
    vi.useFakeTimers();
    const onUnexpectedError = vi.fn();
    const dispatcher = new BatchDispatcher<string, { key: string }>({
      dispatches: new Map(),
      flushDelayMs: 10,
      getKey: (entry) => entry.key,
      flush: vi.fn().mockRejectedValue(new Error('flush failed')),
      onUnexpectedError,
    });

    dispatcher.queue('update-applied', { key: 'web' });

    vi.advanceTimersByTime(10);
    await Promise.resolve();
    await Promise.resolve();

    expect(onUnexpectedError).toHaveBeenCalledWith('update-applied', expect.any(Error));
  });
});
