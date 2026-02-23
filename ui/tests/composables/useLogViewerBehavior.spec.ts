import { effectScope, nextTick, ref } from 'vue';
import {
  LOG_AUTO_FETCH_INTERVALS,
  useAutoFetchLogs,
  useLogViewport,
} from '@/composables/useLogViewerBehavior';

describe('useLogViewport', () => {
  describe('initial state', () => {
    it('should have scrollBlocked as false initially', () => {
      const { scrollBlocked } = useLogViewport();
      expect(scrollBlocked.value).toBe(false);
    });

    it('should have logContainer as null initially', () => {
      const { logContainer } = useLogViewport();
      expect(logContainer.value).toBeNull();
    });
  });

  describe('scrollToBottom', () => {
    it('should scroll container to bottom', () => {
      const { logContainer, scrollToBottom } = useLogViewport();
      const el = { scrollTop: 0, scrollHeight: 500, clientHeight: 200 } as unknown as HTMLElement;
      logContainer.value = el;

      scrollToBottom();

      expect(el.scrollTop).toBe(500);
    });

    it('should do nothing when logContainer is null', () => {
      const { scrollToBottom } = useLogViewport();
      expect(() => scrollToBottom()).not.toThrow();
    });
  });

  describe('handleLogScroll', () => {
    it('should set scrollBlocked true when scrolled up', () => {
      const { logContainer, scrollBlocked, handleLogScroll } = useLogViewport();
      const el = { scrollTop: 100, scrollHeight: 500, clientHeight: 200 } as unknown as HTMLElement;
      logContainer.value = el;

      handleLogScroll();

      expect(scrollBlocked.value).toBe(true);
    });

    it('should set scrollBlocked false when at bottom', () => {
      const { logContainer, scrollBlocked, handleLogScroll } = useLogViewport();
      const el = { scrollTop: 280, scrollHeight: 500, clientHeight: 200 } as unknown as HTMLElement;
      logContainer.value = el;

      handleLogScroll();

      expect(scrollBlocked.value).toBe(false);
    });

    it('should set scrollBlocked false when within threshold', () => {
      const { logContainer, scrollBlocked, handleLogScroll } = useLogViewport();
      // scrollHeight - scrollTop - clientHeight = 500 - 275 - 200 = 25 < 30
      const el = { scrollTop: 275, scrollHeight: 500, clientHeight: 200 } as unknown as HTMLElement;
      logContainer.value = el;

      handleLogScroll();

      expect(scrollBlocked.value).toBe(false);
    });

    it('should not error when logContainer is null', () => {
      const { handleLogScroll } = useLogViewport();
      expect(() => handleLogScroll()).not.toThrow();
    });
  });

  describe('resumeAutoScroll', () => {
    it('should reset scrollBlocked and scroll to bottom', () => {
      const { logContainer, scrollBlocked, handleLogScroll, resumeAutoScroll } = useLogViewport();
      const el = { scrollTop: 100, scrollHeight: 500, clientHeight: 200 } as unknown as HTMLElement;
      logContainer.value = el;

      // First block scrolling
      handleLogScroll();
      expect(scrollBlocked.value).toBe(true);

      // Then resume
      resumeAutoScroll();

      expect(scrollBlocked.value).toBe(false);
      expect(el.scrollTop).toBe(500);
    });
  });
});

describe('useAutoFetchLogs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should have autoFetchInterval as 0 initially', () => {
    const scope = effectScope();
    scope.run(() => {
      const { autoFetchInterval } = useAutoFetchLogs({
        fetchFn: vi.fn(),
        scrollToBottom: vi.fn(),
        scrollBlocked: ref(false),
      });
      expect(autoFetchInterval.value).toBe(0);
    });
    scope.stop();
  });

  it('should start periodic fetching when interval set > 0', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    const scope = effectScope();
    scope.run(() => {
      const { autoFetchInterval } = useAutoFetchLogs({
        fetchFn,
        scrollToBottom: vi.fn(),
        scrollBlocked: ref(false),
      });
      autoFetchInterval.value = 2000;
    });

    await nextTick();
    vi.advanceTimersByTime(2000);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    scope.stop();
  });

  it('should stop fetching when interval set to 0', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    const scope = effectScope();
    let interval = ref(0);
    scope.run(() => {
      const result = useAutoFetchLogs({
        fetchFn,
        scrollToBottom: vi.fn(),
        scrollBlocked: ref(false),
      });
      interval = result.autoFetchInterval;
      interval.value = 2000;
    });

    await nextTick();
    vi.advanceTimersByTime(2000);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    interval.value = 0;
    await nextTick();

    vi.advanceTimersByTime(2000);
    // Should still be 1 — no additional calls after stopping
    expect(fetchFn).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it('should call scrollToBottom after fetch when not scroll-blocked', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    const scrollToBottom = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      const { autoFetchInterval } = useAutoFetchLogs({
        fetchFn,
        scrollToBottom,
        scrollBlocked: ref(false),
      });
      autoFetchInterval.value = 2000;
    });

    await nextTick();
    vi.advanceTimersByTime(2000);
    await vi.waitFor(() => expect(scrollToBottom).toHaveBeenCalled());

    scope.stop();
  });

  it('should not call scrollToBottom after fetch when scroll-blocked', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    const scrollToBottom = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      const { autoFetchInterval } = useAutoFetchLogs({
        fetchFn,
        scrollToBottom,
        scrollBlocked: ref(true),
      });
      autoFetchInterval.value = 2000;
    });

    await nextTick();
    vi.advanceTimersByTime(2000);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    expect(scrollToBottom).not.toHaveBeenCalled();

    scope.stop();
  });

  it('should restart timer when interval changes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    const scope = effectScope();
    let interval = ref(0);
    scope.run(() => {
      const result = useAutoFetchLogs({
        fetchFn,
        scrollToBottom: vi.fn(),
        scrollBlocked: ref(false),
      });
      interval = result.autoFetchInterval;
      interval.value = 2000;
    });

    await nextTick();

    // Advance 1000ms (half of 2000) — should not fire yet
    vi.advanceTimersByTime(1000);
    expect(fetchFn).not.toHaveBeenCalled();

    // Change interval to 5000 — restarts the timer
    interval.value = 5000;
    await nextTick();

    // Advance 2000ms from new start — should not fire (need 5000)
    vi.advanceTimersByTime(2000);
    expect(fetchFn).not.toHaveBeenCalled();

    // Advance 3000 more (total 5000 from restart) — should fire
    vi.advanceTimersByTime(3000);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    scope.stop();
  });
});

describe('LOG_AUTO_FETCH_INTERVALS', () => {
  it('should have 5 entries', () => {
    expect(LOG_AUTO_FETCH_INTERVALS).toHaveLength(5);
  });

  it('should start with Off/0', () => {
    expect(LOG_AUTO_FETCH_INTERVALS[0]).toEqual({ label: 'Off', value: 0 });
  });

  it('should have correct values', () => {
    expect(LOG_AUTO_FETCH_INTERVALS).toEqual([
      { label: 'Off', value: 0 },
      { label: '2s', value: 2000 },
      { label: '5s', value: 5000 },
      { label: '10s', value: 10000 },
      { label: '30s', value: 30000 },
    ]);
  });
});
