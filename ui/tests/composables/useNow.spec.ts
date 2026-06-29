import { effectScope, ref } from 'vue';
import { useNow } from '@/composables/useNow';

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with Date.now() at creation time', () => {
    vi.setSystemTime(5_000);
    const scope = effectScope();
    let now: ReturnType<typeof useNow> | undefined;
    scope.run(() => {
      now = useNow();
    });
    expect(now!.value).toBe(5_000);
    scope.stop();
  });

  it('updates at the default 1000 ms interval', () => {
    vi.setSystemTime(1_000);
    const scope = effectScope();
    let now: ReturnType<typeof useNow> | undefined;
    scope.run(() => {
      now = useNow();
    });

    expect(now!.value).toBe(1_000);

    vi.advanceTimersByTime(1_000);
    expect(now!.value).toBe(2_000);

    vi.advanceTimersByTime(1_000);
    expect(now!.value).toBe(3_000);

    scope.stop();
  });

  it('accepts a custom interval', () => {
    vi.setSystemTime(0);
    const scope = effectScope();
    let now: ReturnType<typeof useNow> | undefined;
    scope.run(() => {
      now = useNow(500);
    });

    expect(now!.value).toBe(0);

    vi.advanceTimersByTime(500);
    expect(now!.value).toBe(500);

    scope.stop();
  });

  it('does not update before the interval elapses', () => {
    vi.setSystemTime(1_000);
    const scope = effectScope();
    let now: ReturnType<typeof useNow> | undefined;
    scope.run(() => {
      now = useNow();
    });

    vi.setSystemTime(1_500);
    vi.advanceTimersByTime(500);
    // Only 500 ms elapsed — interval is 1000 ms, so no tick yet
    expect(now!.value).toBe(1_000);

    scope.stop();
  });

  it('clears the interval when the scope is disposed', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const scope = effectScope();
    scope.run(() => {
      useNow();
    });
    scope.stop();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    clearIntervalSpy.mockRestore();
  });

  it('does not tick after scope is disposed', () => {
    vi.setSystemTime(1_000);
    const scope = effectScope();
    let now: ReturnType<typeof useNow> | undefined;
    scope.run(() => {
      now = useNow();
    });

    scope.stop();

    // Advance time — interval should already be cleared
    vi.setSystemTime(5_000);
    vi.advanceTimersByTime(4_000);
    expect(now!.value).toBe(1_000);
  });

  describe('enabled parameter', () => {
    it('never starts an interval when disabled (getter)', () => {
      vi.setSystemTime(1_000);
      const scope = effectScope();
      let now: ReturnType<typeof useNow> | undefined;
      scope.run(() => {
        now = useNow(1_000, () => false);
      });

      expect(now!.value).toBe(1_000);

      vi.setSystemTime(3_000);
      vi.advanceTimersByTime(2_000);
      // No ticks — value stays at creation time
      expect(now!.value).toBe(1_000);

      scope.stop();
    });

    it('does not call clearInterval on dispose when timer was never started', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const scope = effectScope();
      scope.run(() => {
        useNow(1_000, () => false);
      });
      scope.stop();
      expect(clearIntervalSpy).not.toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('never starts an interval when disabled (ref)', () => {
      vi.setSystemTime(2_000);
      const scope = effectScope();
      let now: ReturnType<typeof useNow> | undefined;
      const enabled = ref(false);
      scope.run(() => {
        now = useNow(1_000, enabled);
      });

      vi.advanceTimersByTime(1_000);
      expect(now!.value).toBe(2_000);

      scope.stop();
    });

    it('starts ticking when enabled switches from false to true', () => {
      vi.setSystemTime(0);
      const scope = effectScope();
      let now: ReturnType<typeof useNow> | undefined;
      const enabled = ref(false);
      scope.run(() => {
        now = useNow(1_000, enabled);
      });

      // Advance while disabled — no tick, no interval
      vi.advanceTimersByTime(500);
      expect(now!.value).toBe(0);

      // Enable — start() snapshots Date.now() and starts the interval
      // Clock is now at 500 after the advance above
      enabled.value = true;
      expect(now!.value).toBe(500); // immediate snapshot on enable

      // One full interval elapsed
      vi.advanceTimersByTime(1_000);
      expect(now!.value).toBe(1_500);

      scope.stop();
    });

    it('stops ticking when enabled switches from true to false', () => {
      vi.setSystemTime(0);
      const scope = effectScope();
      let now: ReturnType<typeof useNow> | undefined;
      const enabled = ref(true);
      scope.run(() => {
        now = useNow(1_000, enabled);
      });

      // One tick
      vi.advanceTimersByTime(1_000);
      expect(now!.value).toBe(1_000);

      // Disable — interval stops
      enabled.value = false;
      vi.advanceTimersByTime(4_000);
      expect(now!.value).toBe(1_000);

      scope.stop();
    });

    it('clears the interval on dispose when enabled was true', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const scope = effectScope();
      scope.run(() => {
        useNow(1_000, true);
      });
      scope.stop();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
      clearIntervalSpy.mockRestore();
    });
  });
});
