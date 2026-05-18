import { BatchDispatcher } from './trigger-batch-dispatcher.js';

describe('BatchDispatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('coalesces entries by key and flushes after the delay', async () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new BatchDispatcher<string, { key: string; value: number }>({
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
    const flush = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new BatchDispatcher<string, { key: string }>({
      flushDelayMs: 10,
      getKey: (entry) => entry.key,
      flush,
      onUnexpectedError: vi.fn(),
    });

    dispatcher.queue('update-applied', { key: 'web' });
    dispatcher.clear();
    vi.advanceTimersByTime(10);

    expect(flush).not.toHaveBeenCalled();
  });

  test('routes unexpected flush rejections to the error handler', async () => {
    vi.useFakeTimers();
    const onUnexpectedError = vi.fn();
    const dispatcher = new BatchDispatcher<string, { key: string }>({
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

  // Kills line 43 mutants: `if (dispatch.timer)` ConditionalExpression true/false
  // and BlockStatement {}
  test('resets debounce timer when queueing a second entry before the delay fires', async () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new BatchDispatcher<string, { key: string }>({
      flushDelayMs: 100,
      getKey: (entry) => entry.key,
      flush,
      onUnexpectedError: vi.fn(),
    });

    dispatcher.queue('r1', { key: 'a' });
    vi.advanceTimersByTime(90);
    // Timer reset — should not flush yet
    dispatcher.queue('r1', { key: 'b' });
    vi.advanceTimersByTime(90);
    // Still within new debounce window
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    await Promise.resolve();
    // Now it should have flushed both entries
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith('r1', expect.arrayContaining([{ key: 'a' }, { key: 'b' }]));
  });

  // Kills line 59 mutant: `if (dispatch.timer)` ConditionalExpression true in clear()
  test('clear() is a no-op when no entries are queued (no timer to cancel)', () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new BatchDispatcher<string, { key: string }>({
      flushDelayMs: 10,
      getKey: (entry) => entry.key,
      flush,
      onUnexpectedError: vi.fn(),
    });

    // clear() before any queue() call should not throw and flush should not be called
    expect(() => dispatcher.clear()).not.toThrow();
    vi.advanceTimersByTime(20);
    expect(flush).not.toHaveBeenCalled();
  });

  test('clear() cancels timers for multiple ruleIds', async () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new BatchDispatcher<string, { key: string }>({
      flushDelayMs: 10,
      getKey: (entry) => entry.key,
      flush,
      onUnexpectedError: vi.fn(),
    });

    dispatcher.queue('rule-a', { key: 'x' });
    dispatcher.queue('rule-b', { key: 'y' });
    dispatcher.clear();
    vi.advanceTimersByTime(20);
    await Promise.resolve();

    expect(flush).not.toHaveBeenCalled();
  });

  test('entries are stored by key and flushed as a list', async () => {
    vi.useFakeTimers();
    const flush = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new BatchDispatcher<string, { key: string; v: number }>({
      flushDelayMs: 10,
      getKey: (entry) => entry.key,
      flush,
      onUnexpectedError: vi.fn(),
    });

    dispatcher.queue('r1', { key: 'a', v: 1 });
    dispatcher.queue('r1', { key: 'b', v: 2 });

    vi.advanceTimersByTime(10);
    await Promise.resolve();

    expect(flush).toHaveBeenCalledWith(
      'r1',
      expect.arrayContaining([
        { key: 'a', v: 1 },
        { key: 'b', v: 2 },
      ]),
    );
    expect(flush.mock.calls[0][1]).toHaveLength(2);
  });
});
