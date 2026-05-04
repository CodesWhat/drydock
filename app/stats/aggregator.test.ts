import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Container } from '../model/container.js';
import { createContainerStatsAggregator } from './aggregator.js';

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    }),
  },
}));

type FakeContainer = Pick<Container, 'id' | 'name' | 'watcher'>;

function makePayload(cpuTotal: number, systemTotal: number, memUsage = 256, memLimit = 1024) {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: cpuTotal },
      system_cpu_usage: systemTotal,
      online_cpus: 2,
    },
    memory_stats: { usage: memUsage, limit: memLimit },
    networks: {},
    blkio_stats: { io_service_bytes_recursive: [] },
  };
}

function drainMicrotasks(times = 10): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i++) {
    p = p.then(() => Promise.resolve());
  }
  return p;
}

interface HarnessOptions {
  containers?: FakeContainer[];
  topN?: number;
  intervalSeconds?: number;
}

function createHarness(options: HarnessOptions = {}) {
  const containerList: FakeContainer[] = options.containers ?? [
    { id: 'c1', name: 'web', watcher: 'local' },
    { id: 'c2', name: 'api', watcher: 'local' },
  ];

  let nowMs = Date.parse('2026-03-14T12:00:00.000Z');

  const fetchSnapshot = vi.fn<[unknown, string], Promise<ReturnType<typeof makePayload> | null>>();
  fetchSnapshot.mockResolvedValue(null);

  let tickCallback: (() => void) | undefined;
  let timerHandle: unknown;
  let handleCounter = 0;

  const setIntervalFn = vi.fn((cb: () => void) => {
    tickCallback = cb;
    timerHandle = ++handleCounter;
    return timerHandle as ReturnType<typeof globalThis.setInterval>;
  });

  const clearIntervalFn = vi.fn(() => {
    tickCallback = undefined;
    timerHandle = undefined;
  });

  const aggregator = createContainerStatsAggregator({
    getContainers: () => containerList as Container[],
    getWatchers: () => ({
      'docker.local': {
        dockerApi: {
          getContainer: () => ({ stats: async () => null }),
        },
      },
    }),
    topN: options.topN ?? 5,
    intervalSeconds: options.intervalSeconds ?? 10,
    now: () => nowMs,
    setIntervalFn: setIntervalFn as unknown as typeof globalThis.setInterval,
    clearIntervalFn: clearIntervalFn as unknown as typeof globalThis.clearInterval,
    fetchSnapshot: fetchSnapshot as unknown as (
      w: unknown,
      name: string,
    ) => Promise<ReturnType<typeof makePayload> | null>,
  });

  async function tick() {
    tickCallback?.();
    await drainMicrotasks();
  }

  function fireTick() {
    tickCallback?.();
  }

  return {
    aggregator,
    containerList,
    fetchSnapshot,
    setIntervalFn,
    clearIntervalFn,
    tick,
    fireTick,
    advanceNowByMs: (delta: number) => {
      nowMs += delta;
    },
    getNowMs: () => nowMs,
  };
}

describe('stats/aggregator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('getCurrent() returns empty summary before first tick', () => {
    const { aggregator } = createHarness();
    const current = aggregator.getCurrent();
    expect(current.watchedCount).toBe(0);
    expect(current.avgCpuPercent).toBe(0);
    expect(current.totalMemoryUsageBytes).toBe(0);
    expect(current.totalMemoryLimitBytes).toBe(0);
    expect(current.totalMemoryPercent).toBe(0);
    expect(current.topCpu).toEqual([]);
    expect(current.topMemory).toEqual([]);
    expect(current.timestamp).toBeDefined();
  });

  test('empty summary timestamp reflects aggregator construction time', () => {
    const fixedMs = Date.parse('2026-03-14T12:00:00.000Z');
    const aggregator = createContainerStatsAggregator({
      getContainers: () => [],
      getWatchers: () => ({}),
      now: () => fixedMs,
      setIntervalFn: vi.fn() as unknown as typeof globalThis.setInterval,
      clearIntervalFn: vi.fn() as unknown as typeof globalThis.clearInterval,
    });
    expect(aggregator.getCurrent().timestamp).toBe('2026-03-14T12:00:00.000Z');
  });

  test('getCurrent() never throws', () => {
    const { aggregator } = createHarness();
    expect(() => aggregator.getCurrent()).not.toThrow();
  });

  test('start() schedules a periodic tick at the configured interval', () => {
    const { aggregator, setIntervalFn } = createHarness();
    aggregator.start();
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 10_000);
    aggregator.stop();
  });

  test('start() is idempotent — calling twice does not stack timers', () => {
    const { aggregator, setIntervalFn } = createHarness();
    aggregator.start();
    aggregator.start();
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    aggregator.stop();
  });

  test('stop() clears the timer', () => {
    const { aggregator, clearIntervalFn } = createHarness();
    aggregator.start();
    aggregator.stop();
    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
  });

  test('stop() is idempotent — calling twice does not double-clear', () => {
    const { aggregator, clearIntervalFn } = createHarness();
    aggregator.start();
    aggregator.stop();
    aggregator.stop();
    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
  });

  test('stop() releases subscribed listeners before a later restart', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
    });
    fetchSnapshot.mockResolvedValue(makePayload(100, 1000));
    const listener = vi.fn();

    aggregator.start();
    aggregator.subscribe(listener);
    aggregator.stop();
    aggregator.start();

    await tick();

    expect(listener).not.toHaveBeenCalled();
    aggregator.stop();
  });

  test('stop() clears previous payload baselines before a later restart', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
    });

    fetchSnapshot.mockResolvedValueOnce(makePayload(1000, 10000));
    aggregator.start();
    await tick();

    aggregator.stop();
    aggregator.start();

    fetchSnapshot.mockResolvedValueOnce(makePayload(1100, 11000));
    await tick();

    expect(aggregator.getCurrent().avgCpuPercent).toBe(0);
    expect(aggregator.getCurrent().topCpu[0].cpuPercent).toBe(0);
    aggregator.stop();
  });

  test('stop() prevents further ticks from updating the summary', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
    });
    fetchSnapshot.mockResolvedValue(makePayload(100, 1000));

    aggregator.start();
    aggregator.stop();
    await tick();

    expect(aggregator.getCurrent().watchedCount).toBe(0);
  });

  test('single-container tick: watchedCount=1, memory totals correct, CPU=0 on first tick', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
    });

    fetchSnapshot.mockResolvedValueOnce(makePayload(100, 1000, 256, 1024));
    aggregator.start();
    await tick();

    const current = aggregator.getCurrent();
    expect(current.watchedCount).toBe(1);
    expect(current.avgCpuPercent).toBe(0); // no previous → cpu=0
    expect(current.totalMemoryUsageBytes).toBe(256);
    expect(current.totalMemoryLimitBytes).toBe(1024);
    expect(current.totalMemoryPercent).toBeCloseTo(25, 1);
    expect(current.topCpu).toHaveLength(1);
    expect(current.topMemory).toHaveLength(1);
    expect(current.topCpu[0]).toMatchObject({ id: 'c1', name: 'web', memoryUsageBytes: 256 });

    aggregator.stop();
  });

  test('tick 2 yields delta-based CPU%', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
    });

    // Tick 1: establish baseline
    fetchSnapshot.mockResolvedValueOnce(makePayload(1000, 10000));
    aggregator.start();
    await tick();

    // Tick 2: cpuDelta=100, sysDelta=1000, online_cpus=2 → (100/1000)*2*100 = 20%
    fetchSnapshot.mockResolvedValueOnce(makePayload(1100, 11000));
    await tick();

    const current = aggregator.getCurrent();
    expect(current.avgCpuPercent).toBeCloseTo(20, 1);
    expect(current.topCpu[0].cpuPercent).toBeCloseTo(20, 1);

    aggregator.stop();
  });

  test('overlapping ticks are skipped while a stats tick is already in flight', async () => {
    const { aggregator, fetchSnapshot, fireTick, tick } = createHarness({
      containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
    });

    let resolveFirstFetch: (payload: ReturnType<typeof makePayload>) => void = () => {};
    fetchSnapshot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstFetch = resolve;
        }),
    );

    aggregator.start();
    fireTick();

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    fetchSnapshot.mockResolvedValueOnce(makePayload(1100, 11000));
    fireTick();
    await drainMicrotasks();

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    resolveFirstFetch(makePayload(1000, 10000));
    await drainMicrotasks();

    await tick();

    expect(fetchSnapshot).toHaveBeenCalledTimes(2);

    aggregator.stop();
  });

  test('multi-container tick: topCpu sorted descending by cpuPercent', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [
        { id: 'c1', name: 'web', watcher: 'local' },
        { id: 'c2', name: 'api', watcher: 'local' },
      ],
    });

    // Tick 1: establish baselines
    fetchSnapshot
      .mockResolvedValueOnce(makePayload(1000, 10000))
      .mockResolvedValueOnce(makePayload(1000, 10000));
    aggregator.start();
    await tick();

    // Tick 2: c1 cpuDelta=150 → 30%, c2 cpuDelta=50 → 10%
    fetchSnapshot
      .mockResolvedValueOnce(makePayload(1150, 11000))
      .mockResolvedValueOnce(makePayload(1050, 11000));
    await tick();

    const current = aggregator.getCurrent();
    expect(current.topCpu[0].name).toBe('web');
    expect(current.topCpu[1].name).toBe('api');
    expect(current.topCpu[0].cpuPercent).toBeGreaterThan(current.topCpu[1].cpuPercent);

    aggregator.stop();
  });

  test('topCpu tiebreak by name.localeCompare when cpuPercent equal', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [
        { id: 'c1', name: 'zoo', watcher: 'local' },
        { id: 'c2', name: 'alpha', watcher: 'local' },
      ],
    });

    // Tick 1: establish baselines
    fetchSnapshot
      .mockResolvedValueOnce(makePayload(1000, 10000))
      .mockResolvedValueOnce(makePayload(1000, 10000));
    aggregator.start();
    await tick();

    // Tick 2: identical CPU deltas for both
    fetchSnapshot
      .mockResolvedValueOnce(makePayload(1100, 11000))
      .mockResolvedValueOnce(makePayload(1100, 11000));
    await tick();

    const current = aggregator.getCurrent();
    // tiebreak: 'alpha' < 'zoo' alphabetically
    expect(current.topCpu[0].name).toBe('alpha');
    expect(current.topCpu[1].name).toBe('zoo');

    aggregator.stop();
  });

  test('top-N capping: more containers than topN are sliced', async () => {
    const containers: FakeContainer[] = [
      { id: 'c1', name: 'a', watcher: 'local' },
      { id: 'c2', name: 'b', watcher: 'local' },
      { id: 'c3', name: 'c', watcher: 'local' },
      { id: 'c4', name: 'd', watcher: 'local' },
    ];
    const { aggregator, fetchSnapshot, tick } = createHarness({ containers, topN: 2 });

    fetchSnapshot
      .mockResolvedValueOnce(makePayload(100, 1000))
      .mockResolvedValueOnce(makePayload(100, 1000))
      .mockResolvedValueOnce(makePayload(100, 1000))
      .mockResolvedValueOnce(makePayload(100, 1000));

    aggregator.start();
    await tick();

    const current = aggregator.getCurrent();
    expect(current.watchedCount).toBe(4);
    expect(current.topCpu).toHaveLength(2);
    expect(current.topMemory).toHaveLength(2);

    aggregator.stop();
  });

  test('container removed between ticks: excluded from summary and payload map cleaned up', async () => {
    const containers: FakeContainer[] = [
      { id: 'c1', name: 'web', watcher: 'local' },
      { id: 'c2', name: 'api', watcher: 'local' },
    ];
    const { aggregator, fetchSnapshot, tick } = createHarness({ containers });

    fetchSnapshot
      .mockResolvedValueOnce(makePayload(100, 1000))
      .mockResolvedValueOnce(makePayload(100, 1000));
    aggregator.start();
    await tick();

    // Remove c2 from container list
    containers.splice(1, 1);
    fetchSnapshot.mockResolvedValueOnce(makePayload(200, 2000));
    await tick();

    const current = aggregator.getCurrent();
    expect(current.watchedCount).toBe(1);
    expect(current.topCpu.every((r) => r.id !== 'c2')).toBe(true);

    aggregator.stop();
  });

  test('per-container fetch failure: skipped; others contribute to summary', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [
        { id: 'c1', name: 'web', watcher: 'local' },
        { id: 'c2', name: 'api', watcher: 'local' },
      ],
    });

    // c1 returns null (failure), c2 returns valid payload
    fetchSnapshot
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makePayload(100, 1000, 512, 2048));

    aggregator.start();
    await tick();

    const current = aggregator.getCurrent();
    expect(current.watchedCount).toBe(1);
    expect(current.topCpu[0].name).toBe('api');

    aggregator.stop();
  });

  test('all fetches fail: watchedCount=0, zero totals, timestamp still updates', async () => {
    const { aggregator, fetchSnapshot, tick, advanceNowByMs } = createHarness({
      containers: [
        { id: 'c1', name: 'web', watcher: 'local' },
        { id: 'c2', name: 'api', watcher: 'local' },
      ],
    });

    fetchSnapshot.mockResolvedValue(null);

    aggregator.start();
    advanceNowByMs(5000);
    await tick();

    const current = aggregator.getCurrent();
    expect(current.watchedCount).toBe(0);
    expect(current.avgCpuPercent).toBe(0);
    expect(current.totalMemoryUsageBytes).toBe(0);
    expect(current.totalMemoryLimitBytes).toBe(0);
    expect(current.totalMemoryPercent).toBe(0);
    expect(current.timestamp).toBe('2026-03-14T12:00:05.000Z');

    aggregator.stop();
  });

  test('listener receives summary on each tick', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
    });

    fetchSnapshot.mockResolvedValue(makePayload(100, 1000));
    const listener = vi.fn();

    aggregator.start();
    aggregator.subscribe(listener);

    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ watchedCount: 1 }));

    fetchSnapshot.mockResolvedValue(makePayload(100, 1000));
    await tick();
    expect(listener).toHaveBeenCalledTimes(2);

    aggregator.stop();
  });

  test('listener throws: other listeners still fire; aggregator continues on next tick', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
    });

    fetchSnapshot.mockResolvedValue(makePayload(100, 1000));

    const throwingListener = vi.fn(() => {
      throw new Error('listener-boom');
    });
    const goodListener = vi.fn();

    aggregator.start();
    aggregator.subscribe(throwingListener);
    aggregator.subscribe(goodListener);

    await tick();
    expect(throwingListener).toHaveBeenCalledTimes(1);
    expect(goodListener).toHaveBeenCalledTimes(1);

    fetchSnapshot.mockResolvedValue(makePayload(100, 1000));
    await tick();
    expect(goodListener).toHaveBeenCalledTimes(2);

    aggregator.stop();
  });

  test('subscribe / unsubscribe: unsubscribed listener does not receive subsequent events', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
    });

    fetchSnapshot.mockResolvedValue(makePayload(100, 1000));
    const listener = vi.fn();

    aggregator.start();
    const unsubscribe = aggregator.subscribe(listener);

    await tick();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();

    fetchSnapshot.mockResolvedValue(makePayload(100, 1000));
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);

    aggregator.stop();
  });

  test('non-Docker watcher: container is skipped, no fetch attempted', async () => {
    const containers: FakeContainer[] = [{ id: 'c1', name: 'web', watcher: 'local' }];
    const fetchSnapshot = vi.fn();

    let tickCallback: (() => void) | undefined;
    const setIntervalFn = vi.fn((cb: () => void) => {
      tickCallback = cb;
      return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
    });
    const clearIntervalFn = vi.fn();

    const aggregator = createContainerStatsAggregator({
      getContainers: () => containers as Container[],
      getWatchers: () => ({
        'docker.local': { notDockerApi: true },
      }),
      intervalSeconds: 10,
      now: () => Date.now(),
      setIntervalFn: setIntervalFn as unknown as typeof globalThis.setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof globalThis.clearInterval,
      fetchSnapshot,
    });

    aggregator.start();
    tickCallback?.();
    await drainMicrotasks();

    expect(fetchSnapshot).not.toHaveBeenCalled();
    expect(aggregator.getCurrent().watchedCount).toBe(0);

    aggregator.stop();
  });

  test('memory percentages are 0 when Docker reports memory_stats.limit as 0', async () => {
    const { aggregator, fetchSnapshot, tick } = createHarness({
      containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
    });

    fetchSnapshot.mockResolvedValueOnce(makePayload(100, 1000, 256, 0));
    aggregator.start();
    await tick();

    const current = aggregator.getCurrent();
    expect(current.totalMemoryLimitBytes).toBe(0);
    expect(current.totalMemoryPercent).toBe(0);
    expect(current.topMemory[0]).toMatchObject({
      id: 'c1',
      name: 'web',
      memoryUsageBytes: 256,
      memoryLimitBytes: 0,
      memoryPercent: 0,
    });

    aggregator.stop();
  });

  test('topMemory sorted desc by memoryPercent with tiebreak by name', async () => {
    const containers: FakeContainer[] = [
      { id: 'c1', name: 'zoo', watcher: 'local' },
      { id: 'c2', name: 'alpha', watcher: 'local' },
      { id: 'c3', name: 'beta', watcher: 'local' },
    ];
    const { aggregator, fetchSnapshot, tick } = createHarness({ containers, topN: 3 });

    // zoo: 25% mem, alpha: 50% mem, beta: 25% mem
    fetchSnapshot
      .mockResolvedValueOnce(makePayload(100, 1000, 256, 1024)) // zoo: 25%
      .mockResolvedValueOnce(makePayload(100, 1000, 512, 1024)) // alpha: 50%
      .mockResolvedValueOnce(makePayload(100, 1000, 256, 1024)); // beta: 25%

    aggregator.start();
    await tick();

    const current = aggregator.getCurrent();
    expect(current.topMemory[0].name).toBe('alpha');
    // tiebreak between zoo(25%) and beta(25%): beta < zoo alphabetically
    expect(current.topMemory[1].name).toBe('beta');
    expect(current.topMemory[2].name).toBe('zoo');

    aggregator.stop();
  });

  test('uses default intervalSeconds from getStatsIntervalSeconds() when not provided', () => {
    const prev = process.env.DD_STATS_INTERVAL;
    process.env.DD_STATS_INTERVAL = '30';

    try {
      const setIntervalFn = vi.fn(() => 1 as unknown as ReturnType<typeof globalThis.setInterval>);
      const aggregator = createContainerStatsAggregator({
        getContainers: () => [],
        getWatchers: () => ({}),
        setIntervalFn: setIntervalFn as unknown as typeof globalThis.setInterval,
        clearIntervalFn: vi.fn() as unknown as typeof globalThis.clearInterval,
      });
      aggregator.start();
      expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 30_000);
      aggregator.stop();
    } finally {
      if (prev === undefined) {
        delete process.env.DD_STATS_INTERVAL;
      } else {
        process.env.DD_STATS_INTERVAL = prev;
      }
    }
  });

  test('default fetchSnapshot calls watcher.dockerApi.getContainer(name).stats({ stream: false })', async () => {
    const statsResult = makePayload(100, 1000);
    const statsFn = vi.fn().mockResolvedValue(statsResult);
    const getContainerFn = vi.fn(() => ({ stats: statsFn }));

    const watcher = {
      dockerApi: {
        getContainer: getContainerFn,
      },
    };

    let tickCallback: (() => void) | undefined;
    const setIntervalFn = vi.fn((cb: () => void) => {
      tickCallback = cb;
      return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
    });
    const clearIntervalFn = vi.fn();

    const aggregator = createContainerStatsAggregator({
      getContainers: () => [{ id: 'c1', name: 'web', watcher: 'local' }] as Container[],
      getWatchers: () => ({ 'docker.local': watcher }),
      intervalSeconds: 10,
      now: () => Date.now(),
      setIntervalFn: setIntervalFn as unknown as typeof globalThis.setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof globalThis.clearInterval,
      // No fetchSnapshot override — uses default
    });

    aggregator.start();
    tickCallback?.();
    await drainMicrotasks();

    expect(getContainerFn).toHaveBeenCalledWith('web');
    expect(statsFn).toHaveBeenCalledWith({ stream: false });

    aggregator.stop();
  });

  test('default fetchSnapshot returns null when stats() throws', async () => {
    const statsFn = vi.fn().mockRejectedValue(new Error('docker-unavailable'));
    const watcher = {
      dockerApi: {
        getContainer: vi.fn(() => ({ stats: statsFn })),
      },
    };

    let tickCallback: (() => void) | undefined;
    const setIntervalFn = vi.fn((cb: () => void) => {
      tickCallback = cb;
      return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
    });
    const clearIntervalFn = vi.fn();

    const aggregator = createContainerStatsAggregator({
      getContainers: () => [{ id: 'c1', name: 'web', watcher: 'local' }] as Container[],
      getWatchers: () => ({ 'docker.local': watcher }),
      intervalSeconds: 10,
      now: () => Date.now(),
      setIntervalFn: setIntervalFn as unknown as typeof globalThis.setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof globalThis.clearInterval,
    });

    aggregator.start();
    tickCallback?.();
    await drainMicrotasks();

    // Container skipped silently — watchedCount stays 0
    expect(aggregator.getCurrent().watchedCount).toBe(0);

    aggregator.stop();
  });

  test('watcher is null: container skipped (isDockerStatsWatcherApi returns false for null)', async () => {
    const containers: FakeContainer[] = [{ id: 'c1', name: 'web', watcher: 'local' }];
    const fetchSnapshot = vi.fn();

    let tickCallback: (() => void) | undefined;
    const setIntervalFn = vi.fn((cb: () => void) => {
      tickCallback = cb;
      return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
    });
    const clearIntervalFn = vi.fn();

    const aggregator = createContainerStatsAggregator({
      getContainers: () => containers as Container[],
      getWatchers: () => ({
        'docker.local': null,
      }),
      intervalSeconds: 10,
      now: () => Date.now(),
      setIntervalFn: setIntervalFn as unknown as typeof globalThis.setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof globalThis.clearInterval,
      fetchSnapshot,
    });

    aggregator.start();
    tickCallback?.();
    await drainMicrotasks();

    expect(fetchSnapshot).not.toHaveBeenCalled();
    expect(aggregator.getCurrent().watchedCount).toBe(0);

    aggregator.stop();
  });

  test('watcher is a primitive: container skipped (isDockerStatsWatcherApi returns false)', async () => {
    const containers: FakeContainer[] = [{ id: 'c1', name: 'web', watcher: 'local' }];
    const fetchSnapshot = vi.fn();

    let tickCallback: (() => void) | undefined;
    const setIntervalFn = vi.fn((cb: () => void) => {
      tickCallback = cb;
      return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
    });
    const clearIntervalFn = vi.fn();

    const aggregator = createContainerStatsAggregator({
      getContainers: () => containers as Container[],
      getWatchers: () => ({
        'docker.local': 42 as unknown as Record<string, unknown>,
      }),
      intervalSeconds: 10,
      now: () => Date.now(),
      setIntervalFn: setIntervalFn as unknown as typeof globalThis.setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof globalThis.clearInterval,
      fetchSnapshot,
    });

    aggregator.start();
    tickCallback?.();
    await drainMicrotasks();

    expect(fetchSnapshot).not.toHaveBeenCalled();
    expect(aggregator.getCurrent().watchedCount).toBe(0);

    aggregator.stop();
  });

  test('stop during in-flight tick: summary is not updated after stop', async () => {
    const containers: FakeContainer[] = [{ id: 'c1', name: 'web', watcher: 'local' }];

    let resolveFetch!: (v: ReturnType<typeof makePayload>) => void;
    const fetchSnapshot = vi.fn(
      () =>
        new Promise<ReturnType<typeof makePayload>>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    let tickCallback: (() => void) | undefined;
    const setIntervalFn = vi.fn((cb: () => void) => {
      tickCallback = cb;
      return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
    });
    const clearIntervalFn = vi.fn();

    const aggregator = createContainerStatsAggregator({
      getContainers: () => containers as Container[],
      getWatchers: () => ({
        'docker.local': {
          dockerApi: { getContainer: () => ({ stats: async () => null }) },
        },
      }),
      intervalSeconds: 10,
      now: () => Date.now(),
      setIntervalFn: setIntervalFn as unknown as typeof globalThis.setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof globalThis.clearInterval,
      fetchSnapshot,
    });

    aggregator.start();
    tickCallback?.();

    // Stop while fetch is in-flight
    aggregator.stop();

    // Now resolve the fetch
    resolveFetch(makePayload(100, 1000));
    await drainMicrotasks();

    // Summary should remain empty since stopped = true
    expect(aggregator.getCurrent().watchedCount).toBe(0);
  });

  test('stop during in-flight tick does not retain payload baselines after restart', async () => {
    const containers: FakeContainer[] = [{ id: 'c1', name: 'web', watcher: 'local' }];

    let resolveFetch!: (v: ReturnType<typeof makePayload>) => void;
    const fetchSnapshot = vi.fn(
      () =>
        new Promise<ReturnType<typeof makePayload>>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    let tickCallback: (() => void) | undefined;
    const setIntervalFn = vi.fn((cb: () => void) => {
      tickCallback = cb;
      return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
    });
    const clearIntervalFn = vi.fn(() => {
      tickCallback = undefined;
    });

    const aggregator = createContainerStatsAggregator({
      getContainers: () => containers as Container[],
      getWatchers: () => ({
        'docker.local': {
          dockerApi: { getContainer: () => ({ stats: async () => null }) },
        },
      }),
      intervalSeconds: 10,
      now: () => Date.parse('2026-03-14T12:00:00.000Z'),
      setIntervalFn: setIntervalFn as unknown as typeof globalThis.setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof globalThis.clearInterval,
      fetchSnapshot,
    });

    aggregator.start();
    tickCallback?.();
    aggregator.stop();

    resolveFetch(makePayload(1000, 10000));
    await drainMicrotasks();

    fetchSnapshot.mockResolvedValueOnce(makePayload(1100, 11000));
    aggregator.start();
    tickCallback?.();
    await drainMicrotasks();

    expect(aggregator.getCurrent().avgCpuPercent).toBe(0);
    expect(aggregator.getCurrent().topCpu[0].cpuPercent).toBe(0);
    aggregator.stop();
  });

  test('uses globalThis.setInterval and clearInterval when not injected', () => {
    // Exercises the ?? globalThis.setInterval / ?? globalThis.clearInterval branches
    const aggregator = createContainerStatsAggregator({
      getContainers: () => [],
      getWatchers: () => ({}),
      now: () => Date.now(),
      // No setIntervalFn / clearIntervalFn — falls back to globals
    });

    // start/stop without any assertions on the injected fns; just ensure no crash
    expect(() => {
      aggregator.start();
      aggregator.stop();
    }).not.toThrow();
  });

  test('runTick handles rejection from getContainers gracefully via tick error path', async () => {
    let tickCallback: (() => void) | undefined;
    const setIntervalFn = vi.fn((cb: () => void) => {
      tickCallback = cb;
      return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
    });
    const clearIntervalFn = vi.fn();

    const aggregator = createContainerStatsAggregator({
      getContainers: () => {
        throw new Error('store-unavailable');
      },
      getWatchers: () => ({}),
      intervalSeconds: 10,
      now: () => Date.now(),
      setIntervalFn: setIntervalFn as unknown as typeof globalThis.setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof globalThis.clearInterval,
    });

    aggregator.start();
    // tick fires; runTick throws synchronously from getContainers; .catch logs warn
    tickCallback?.();
    await drainMicrotasks();

    // aggregator doesn't crash
    expect(aggregator.getCurrent().watchedCount).toBe(0);

    aggregator.stop();
  });
});
