import { describe, expect, it, vi } from 'vitest';
import { createRealtimeRefreshScheduler } from '@/views/dashboard/useDashboardData.helpers';

describe('createRealtimeRefreshScheduler', () => {
  it('coalesces queued summary and full refresh requests into one full refresh', () => {
    vi.useFakeTimers();
    const refreshSummary = vi.fn();
    const refreshFull = vi.fn();
    const scheduler = createRealtimeRefreshScheduler({
      debounceMs: 1_000,
      refreshSummary,
      refreshFull,
    });

    scheduler.schedule('summary');
    scheduler.schedule('full');

    vi.advanceTimersByTime(999);
    expect(refreshSummary).not.toHaveBeenCalled();
    expect(refreshFull).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refreshSummary).not.toHaveBeenCalled();
    expect(refreshFull).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });
});
