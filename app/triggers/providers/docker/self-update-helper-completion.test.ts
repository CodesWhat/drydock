import {
  clearSelfUpdateHelperCompletion,
  notifySelfUpdateHelperCompletion,
  waitForSelfUpdateHelperCompletion,
} from './self-update-helper-completion.js';

describe('self-update helper completion', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('delivers a durably finalized completion to an active observer', async () => {
    const completion = waitForSelfUpdateHelperCompletion('active-op', 1_000);

    notifySelfUpdateHelperCompletion('active-op', { status: 'succeeded' });

    await expect(completion).resolves.toEqual({ status: 'succeeded' });
  });

  test('remembers completion when the authenticated callback arrives first', async () => {
    notifySelfUpdateHelperCompletion('early-op', {
      status: 'rolled-back',
      lastError: 'rollback complete',
    });

    await expect(waitForSelfUpdateHelperCompletion('early-op', 1_000)).resolves.toEqual({
      status: 'rolled-back',
      lastError: 'rollback complete',
    });
  });

  test('times out a helper that never reports completion', async () => {
    vi.useFakeTimers();
    const completion = waitForSelfUpdateHelperCompletion('stalled-op', 25);
    const rejection = expect(completion).rejects.toThrow(
      'Observed self-update helper completion timed out after 25ms',
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });

  test('cancels an active observer and clears an early completion', async () => {
    const active = waitForSelfUpdateHelperCompletion('cancelled-op', 1_000);
    clearSelfUpdateHelperCompletion('cancelled-op');
    await expect(active).rejects.toThrow(
      'Observed self-update helper completion cancelled for cancelled-op',
    );

    notifySelfUpdateHelperCompletion('cleared-early-op', { status: 'succeeded' });
    clearSelfUpdateHelperCompletion('cleared-early-op');
    vi.useFakeTimers();
    const cleared = waitForSelfUpdateHelperCompletion('cleared-early-op', 10);
    const rejection = expect(cleared).rejects.toThrow('timed out after 10ms');
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
  });
});
