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

  it('runs a summary refresh when no full refresh supersedes it', () => {
    vi.useFakeTimers();
    const refreshSummary = vi.fn();
    const refreshFull = vi.fn();
    const scheduler = createRealtimeRefreshScheduler({
      debounceMs: 1_000,
      refreshSummary,
      refreshFull,
    });

    scheduler.schedule('summary');

    vi.advanceTimersByTime(1_000);
    expect(refreshSummary).toHaveBeenCalledTimes(1);
    expect(refreshFull).not.toHaveBeenCalled();

    scheduler.dispose();
  });

  it('ignores summary refreshes when no summary handler is configured', () => {
    vi.useFakeTimers();
    const refreshFull = vi.fn();
    const scheduler = createRealtimeRefreshScheduler({
      debounceMs: 1_000,
      refreshFull,
    });

    scheduler.schedule('summary');

    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    expect(refreshFull).not.toHaveBeenCalled();

    scheduler.dispose();
  });
});
