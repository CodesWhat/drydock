import type { ContainerReport } from '../../../model/container.js';
import type { CronWatchOrchestrationWatcher } from './docker-cron-watch.js';
import {
  getCronIntervalMs,
  resetCronWatchState,
  watchFromCronOrchestration,
} from './docker-cron-watch.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createWatcher(
  overrides: Partial<CronWatchOrchestrationWatcher> = {},
): CronWatchOrchestrationWatcher {
  return {
    type: 'docker',
    name: 'test',
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    configuration: {
      cron: '0 * * * *',
    },
    isCronWatchInProgress: false,
    isWatcherDeregistered: false,
    cronWatchInFlight: undefined,
    cronWatchRescanRequested: false,
    cronWatchRescanReason: undefined,
    cronWatchRescanIgnoreMaintenanceWindow: false,
    ensureLogger: vi.fn(),
    isMaintenanceWindowOpen: vi.fn().mockReturnValue(true),
    queueMaintenanceWindowWatch: vi.fn(),
    clearMaintenanceWindowQueue: vi.fn(),
    watch: vi.fn().mockResolvedValue([]),
    getNextScheduledRunDate: vi.fn().mockReturnValue(undefined),
    ...overrides,
  };
}

describe('watchFromCronOrchestration', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('runs a scan and reports stats', async () => {
    const watcher = createWatcher({
      watch: vi
        .fn()
        .mockResolvedValue([
          { container: { updateAvailable: true, error: undefined } },
          { container: { updateAvailable: false, error: { message: 'x' } } },
        ] as unknown as ContainerReport[]),
    });

    const result = await watchFromCronOrchestration(watcher, { reason: 'schedule' });

    expect(result).toHaveLength(2);
    expect(watcher.log?.info).toHaveBeenCalledWith(
      expect.stringContaining('Cron started (0 * * * *, reason: schedule)'),
    );
    expect(watcher.log?.info).toHaveBeenCalledWith(
      expect.stringContaining('2 containers watched, 1 errors, 1 available updates'),
    );
  });

  test('returns an empty result and skips watch() when the logger is unavailable', async () => {
    const watcher = createWatcher({ log: {} });

    const result = await watchFromCronOrchestration(watcher);

    expect(result).toEqual([]);
    expect(watcher.watch).not.toHaveBeenCalled();
  });

  test('skips the scan and queues a watch when outside the maintenance window', async () => {
    const watcher = createWatcher({
      configuration: { cron: '0 * * * *', maintenancewindow: '0 2 * * *' },
      isMaintenanceWindowOpen: vi.fn().mockReturnValue(false),
    });

    const result = await watchFromCronOrchestration(watcher);

    expect(result).toEqual([]);
    expect(watcher.queueMaintenanceWindowWatch).toHaveBeenCalled();
    expect(watcher.watch).not.toHaveBeenCalled();
  });

  test('ignoreMaintenanceWindow bypasses a closed maintenance window', async () => {
    const watcher = createWatcher({
      configuration: { cron: '0 * * * *', maintenancewindow: '0 2 * * *' },
      isMaintenanceWindowOpen: vi.fn().mockReturnValue(false),
    });

    await watchFromCronOrchestration(watcher, { ignoreMaintenanceWindow: true });

    expect(watcher.watch).toHaveBeenCalled();
    expect(watcher.clearMaintenanceWindowQueue).toHaveBeenCalled();
  });

  test('coalesces a request while a scan is running and logs the reason', async () => {
    const deferred = createDeferred<ContainerReport[]>();
    const watcher = createWatcher({ watch: vi.fn().mockReturnValue(deferred.promise) });

    const call1 = watchFromCronOrchestration(watcher, { reason: 'schedule' });
    await Promise.resolve();
    const call2 = watchFromCronOrchestration(watcher, { reason: 'docker-event' });

    expect(watcher.cronWatchRescanRequested).toBe(true);
    expect(watcher.cronWatchRescanReason).toBe('docker-event');
    expect(watcher.cronWatchRescanIgnoreMaintenanceWindow).toBe(false);
    expect(watcher.log?.info).toHaveBeenCalledWith(
      expect.stringContaining('Cron scan requested (docker-event) while one is already running'),
    );

    deferred.resolve([]);
    const [result1, result2] = await Promise.all([call1, call2]);
    expect(result1).toBe(result2);
  });

  test('coalesces silently when no logger is available', async () => {
    const deferred = createDeferred<ContainerReport[]>();
    const watcher = createWatcher({ log: {}, watch: vi.fn().mockReturnValue(deferred.promise) });

    const call1 = watchFromCronOrchestration(watcher);
    await Promise.resolve();
    const call2 = watchFromCronOrchestration(watcher);

    deferred.resolve([]);
    await expect(Promise.all([call1, call2])).resolves.toBeDefined();
  });

  test('runs exactly one coalesced follow-up scan after the running scan settles', async () => {
    const deferred = createDeferred<ContainerReport[]>();
    const watchMock = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue([]);
    const watcher = createWatcher({ watch: watchMock });

    const call1 = watchFromCronOrchestration(watcher, { reason: 'schedule' });
    await Promise.resolve();
    const call2 = watchFromCronOrchestration(watcher, { reason: 'docker-event' });
    const call3 = watchFromCronOrchestration(watcher, { reason: 'startup' });

    deferred.resolve([]);
    await Promise.all([call1, call2, call3]);

    await vi.waitFor(() => expect(watchMock).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(watchMock).toHaveBeenCalledTimes(2);
  });

  test('carries ignoreMaintenanceWindow into the follow-up when a coalesced request set it', async () => {
    const deferred = createDeferred<ContainerReport[]>();
    const isMaintenanceWindowOpen = vi.fn().mockReturnValue(true);
    const watchMock = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue([]);
    const watcher = createWatcher({
      configuration: { cron: '0 * * * *', maintenancewindow: '0 2 * * *' },
      isMaintenanceWindowOpen,
      watch: watchMock,
    });

    const call1 = watchFromCronOrchestration(watcher, { reason: 'schedule' });
    await Promise.resolve();

    // The window closes while call1 is still running; the maintenance-window
    // catch-up coalesces into call1's follow-up.
    isMaintenanceWindowOpen.mockReturnValue(false);
    const call2 = watchFromCronOrchestration(watcher, {
      reason: 'maintenance-window',
      ignoreMaintenanceWindow: true,
    });
    expect(watcher.cronWatchRescanIgnoreMaintenanceWindow).toBe(true);

    deferred.resolve([]);
    await Promise.all([call1, call2]);

    // The follow-up bypasses the still-closed window instead of queuing yet
    // another maintenance-window watch.
    await vi.waitFor(() => expect(watchMock).toHaveBeenCalledTimes(2));
    expect(watcher.queueMaintenanceWindowWatch).not.toHaveBeenCalled();
  });

  test.each([
    {
      label: 'no interval is available',
      intervalMs: undefined,
      expectedDeadlineMs: 10 * 60 * 1000,
    },
    {
      label: 'the interval is non-positive',
      intervalMs: -100,
      expectedDeadlineMs: 10 * 60 * 1000,
    },
    {
      label: "the interval's multiple is below the floor",
      intervalMs: 60 * 1000,
      expectedDeadlineMs: 10 * 60 * 1000,
    },
    {
      label: "the interval's multiple exceeds the floor",
      intervalMs: 20 * 60 * 1000,
      expectedDeadlineMs: 40 * 60 * 1000,
    },
  ])('sizes the in-flight deadline when $label', async ({ intervalMs, expectedDeadlineMs }) => {
    vi.useFakeTimers();
    try {
      const stallingWatch = vi.fn().mockReturnValue(new Promise<ContainerReport[]>(() => {}));
      const firstRun = new Date('2026-01-01T00:00:00.000Z');
      const watcher = createWatcher({
        watch: stallingWatch,
        getNextScheduledRunDate:
          intervalMs === undefined
            ? vi.fn().mockReturnValue(undefined)
            : vi
                .fn()
                .mockImplementation((fromDate?: Date) =>
                  fromDate === undefined ? firstRun : new Date(firstRun.getTime() + intervalMs),
                ),
      });

      const call = watchFromCronOrchestration(watcher, { reason: 'schedule' });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(expectedDeadlineMs - 1);
      expect(watcher.log?.warn).not.toHaveBeenCalled();
      expect(watcher.cronWatchInFlight).toBeDefined();

      await vi.advanceTimersByTimeAsync(1);
      await expect(call).resolves.toEqual([]);
      expect(watcher.log?.warn).toHaveBeenCalledWith(
        expect.stringContaining(`exceeded its ${expectedDeadlineMs}ms deadline`),
      );
      expect(watcher.cronWatchInFlight).toBeUndefined();
      expect(watcher.cronWatchRescanRequested).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('starts a fresh scan on the next tick once a stalled scan crosses its deadline', async () => {
    vi.useFakeTimers();
    try {
      const stallingWatch = vi.fn().mockReturnValue(new Promise<ContainerReport[]>(() => {}));
      const watcher = createWatcher({ watch: stallingWatch });

      void watchFromCronOrchestration(watcher, { reason: 'schedule' });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(stallingWatch).toHaveBeenCalledTimes(1);

      void watchFromCronOrchestration(watcher, { reason: 'schedule' });
      await Promise.resolve();
      expect(stallingWatch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('clears the deadline state without throwing when warn logging is unavailable', async () => {
    vi.useFakeTimers();
    try {
      const stallingWatch = vi.fn().mockReturnValue(new Promise<ContainerReport[]>(() => {}));
      const watcher = createWatcher({ watch: stallingWatch, log: { info: vi.fn() } });

      const call = watchFromCronOrchestration(watcher, { reason: 'schedule' });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      await expect(call).resolves.toEqual([]);
      expect(watcher.cronWatchInFlight).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('resolves every coalesced caller with the deadline result, not just the initiator', async () => {
    vi.useFakeTimers();
    try {
      const stallingWatch = vi.fn().mockReturnValue(new Promise<ContainerReport[]>(() => {}));
      const watcher = createWatcher({ watch: stallingWatch });

      const initiator = watchFromCronOrchestration(watcher, { reason: 'schedule' });
      await Promise.resolve();

      // Arrives while the scan above is in flight, so it coalesces into it
      // instead of starting a second scan.
      const coalesced = watchFromCronOrchestration(watcher, { reason: 'docker-event' });
      expect(watcher.cronWatchRescanRequested).toBe(true);

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

      // Before the fix, the coalesced caller held the raw (unbounded) scan
      // promise, so it never observed the deadline and stayed pending
      // forever, only the initiator resolved.
      await expect(initiator).resolves.toEqual([]);
      await expect(coalesced).resolves.toEqual([]);
      expect(stallingWatch).toHaveBeenCalledTimes(1);
      expect(watcher.cronWatchInFlight).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('a stale scan settling after its deadline does not clobber a newer in-flight scan', async () => {
    vi.useFakeTimers();
    try {
      const staleDeferred = createDeferred<ContainerReport[]>();
      const freshDeferred = createDeferred<ContainerReport[]>();
      const watchMock = vi
        .fn()
        .mockReturnValueOnce(staleDeferred.promise)
        .mockReturnValueOnce(freshDeferred.promise)
        .mockResolvedValue([]);
      const watcher = createWatcher({ watch: watchMock });

      const staleCall = watchFromCronOrchestration(watcher, { reason: 'schedule' });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      await expect(staleCall).resolves.toEqual([]);
      expect(watcher.cronWatchInFlight).toBeUndefined();
      expect(watchMock).toHaveBeenCalledTimes(1);

      const freshCall = watchFromCronOrchestration(watcher, { reason: 'schedule' });
      await Promise.resolve();
      expect(watchMock).toHaveBeenCalledTimes(2);
      const freshInFlight = watcher.cronWatchInFlight;
      expect(freshInFlight).toBeDefined();

      // A caller coalesces into the fresh scan, requesting a follow-up.
      const coalesced = watchFromCronOrchestration(watcher, { reason: 'docker-event' });
      expect(watcher.cronWatchRescanRequested).toBe(true);

      // The stale scan's watch() call finally settles. Its settlement must
      // not clear the fresh scan's single-flight state or drop its rescan
      // request.
      staleDeferred.resolve([]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(watcher.cronWatchInFlight).toBe(freshInFlight);
      expect(watcher.cronWatchRescanRequested).toBe(true);

      freshDeferred.resolve([]);
      // Both the initiating and the coalesced caller share the fresh scan's
      // result - the stale scan's late settlement must not have redirected
      // either of them.
      await expect(freshCall).resolves.toEqual([]);
      await expect(coalesced).resolves.toEqual([]);
      await vi.waitFor(() => expect(watchMock).toHaveBeenCalledTimes(3));
    } finally {
      vi.useRealTimers();
    }
  });

  test('drops the coalesced follow-up and logs a debug line when the watcher was deregistered while the scan ran', async () => {
    const deferred = createDeferred<ContainerReport[]>();
    const watchMock = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue([]);
    const watcher = createWatcher({ watch: watchMock });

    const call1 = watchFromCronOrchestration(watcher, { reason: 'schedule' });
    await Promise.resolve();
    const call2 = watchFromCronOrchestration(watcher, { reason: 'docker-event' });
    expect(watcher.cronWatchRescanRequested).toBe(true);

    watcher.isWatcherDeregistered = true;
    deferred.resolve([]);
    await Promise.all([call1, call2]);
    await Promise.resolve();
    await Promise.resolve();

    expect(watchMock).toHaveBeenCalledTimes(1);
    expect(watcher.cronWatchRescanRequested).toBe(false);
    expect(watcher.log?.debug).toHaveBeenCalledWith(
      expect.stringContaining('Dropping the coalesced follow-up scan (docker-event)'),
    );
  });

  test('drops the coalesced follow-up and falls back to "manual" in the debug line when no reason was given', async () => {
    const deferred = createDeferred<ContainerReport[]>();
    const watchMock = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue([]);
    const watcher = createWatcher({ watch: watchMock });

    const call1 = watchFromCronOrchestration(watcher, { reason: 'schedule' });
    await Promise.resolve();
    const call2 = watchFromCronOrchestration(watcher);
    expect(watcher.cronWatchRescanRequested).toBe(true);

    watcher.isWatcherDeregistered = true;
    deferred.resolve([]);
    await Promise.all([call1, call2]);
    await Promise.resolve();
    await Promise.resolve();

    expect(watchMock).toHaveBeenCalledTimes(1);
    expect(watcher.log?.debug).toHaveBeenCalledWith(
      expect.stringContaining('Dropping the coalesced follow-up scan (manual)'),
    );
  });

  test('drops the coalesced follow-up silently when the logger has no debug method', async () => {
    const deferred = createDeferred<ContainerReport[]>();
    const watchMock = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue([]);
    const watcher = createWatcher({ watch: watchMock, log: { info: vi.fn() } });

    const call1 = watchFromCronOrchestration(watcher, { reason: 'schedule' });
    await Promise.resolve();
    const call2 = watchFromCronOrchestration(watcher, { reason: 'docker-event' });

    watcher.isWatcherDeregistered = true;
    deferred.resolve([]);
    await Promise.all([call1, call2]);
    await Promise.resolve();
    await Promise.resolve();

    expect(watchMock).toHaveBeenCalledTimes(1);
  });

  test('drops the coalesced follow-up without throwing when the logger disappears entirely', async () => {
    const deferred = createDeferred<ContainerReport[]>();
    const watchMock = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue([]);
    const watcher = createWatcher({ watch: watchMock });

    // Scan starts with a logger present (runCronWatch requires one), then
    // the logger is cleared before the coalesced request and the settlement
    // that follows, exercising the falsy-logger branch of the drop guard.
    const call1 = watchFromCronOrchestration(watcher, { reason: 'schedule' });
    await Promise.resolve();
    watcher.log = undefined;
    const call2 = watchFromCronOrchestration(watcher, { reason: 'docker-event' });

    watcher.isWatcherDeregistered = true;
    deferred.resolve([]);
    await Promise.all([call1, call2]);
    await Promise.resolve();
    await Promise.resolve();

    expect(watchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getCronIntervalMs', () => {
  test('returns undefined when no scheduled run can be computed', () => {
    const watcher = { getNextScheduledRunDate: vi.fn().mockReturnValue(undefined) };

    expect(getCronIntervalMs(watcher)).toBeUndefined();
  });

  test('returns undefined when a second scheduled run cannot be computed', () => {
    const firstRun = new Date('2026-04-09T12:05:00.000Z');
    const watcher = {
      getNextScheduledRunDate: vi
        .fn()
        .mockImplementation((fromDate?: Date) => (fromDate === undefined ? firstRun : undefined)),
    };

    expect(getCronIntervalMs(watcher)).toBeUndefined();
  });

  test('returns the interval between two consecutive scheduled runs', () => {
    const firstRun = new Date('2026-04-09T12:00:00.000Z');
    const secondRun = new Date('2026-04-09T13:00:00.000Z');
    const watcher = {
      getNextScheduledRunDate: vi
        .fn()
        .mockImplementation((fromDate?: Date) => (fromDate === undefined ? firstRun : secondRun)),
    };

    expect(getCronIntervalMs(watcher)).toBe(60 * 60 * 1000);
  });
});

describe('resetCronWatchState', () => {
  test('clears the single-flight state', () => {
    const watcher = createWatcher({
      cronWatchInFlight: Promise.resolve([]),
      cronWatchRescanRequested: true,
      cronWatchRescanReason: 'docker-event',
      cronWatchRescanIgnoreMaintenanceWindow: true,
    });

    resetCronWatchState(watcher);

    expect(watcher.cronWatchInFlight).toBeUndefined();
    expect(watcher.cronWatchRescanRequested).toBe(false);
    expect(watcher.cronWatchRescanReason).toBeUndefined();
    expect(watcher.cronWatchRescanIgnoreMaintenanceWindow).toBe(false);
  });
});
