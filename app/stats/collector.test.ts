import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createContainerStatsCollector } from './collector.js';

const { mockCollectorLogger } = vi.hoisted(() => ({
  mockCollectorLogger: {
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => mockCollectorLogger),
  },
}));

type StreamListener = (payload?: unknown) => void;

function createMockStatsStream() {
  const listeners = new Map<string, StreamListener[]>();
  const stream = {
    on: vi.fn((event: string, handler: StreamListener) => {
      const handlers = listeners.get(event) ?? [];
      handlers.push(handler);
      listeners.set(event, handlers);
      return stream;
    }),
    removeAllListeners: vi.fn(() => {
      listeners.clear();
    }),
    destroy: vi.fn(),
    emit(event: string, payload?: unknown) {
      for (const handler of listeners.get(event) ?? []) {
        handler(payload);
      }
    },
  };
  return stream;
}

function createStreamWithoutCleanupHooks() {
  const listeners = new Map<string, StreamListener[]>();
  const stream = {
    on: vi.fn((event: string, handler: StreamListener) => {
      const handlers = listeners.get(event) ?? [];
      handlers.push(handler);
      listeners.set(event, handlers);
      return stream;
    }),
    emit(event: string, payload?: unknown) {
      for (const handler of listeners.get(event) ?? []) {
        handler(payload);
      }
    },
  };
  return stream;
}

function createHarness() {
  let nowMs = Date.parse('2026-03-14T12:00:00.000Z');
  const containersById = new Map<string, { id: string; name: string; watcher: string }>([
    [
      'c1',
      {
        id: 'c1',
        name: 'web',
        watcher: 'local',
      },
    ],
    [
      'c2',
      {
        id: 'c2',
        name: 'api',
        watcher: 'local',
      },
    ],
  ]);
  const stream = createMockStatsStream();
  const stats = vi.fn(async () => stream);
  const getContainer = vi.fn((containerId: string) => containersById.get(containerId));
  const getContainerApi = vi.fn(() => ({ stats }));
  const getWatchers = vi.fn(() => ({
    'docker.local': {
      dockerApi: {
        getContainer: getContainerApi,
      },
    },
  }));
  const collector = createContainerStatsCollector({
    getContainerById: getContainer,
    getWatchers,
    intervalSeconds: 10,
    historySize: 3,
    now: () => nowMs,
  });

  const emitStats = (cpuTotal: number, systemTotal: number) => {
    stream.emit('data', {
      cpu_stats: {
        cpu_usage: {
          total_usage: cpuTotal,
          percpu_usage: [cpuTotal / 2, cpuTotal / 2],
        },
        system_cpu_usage: systemTotal,
        online_cpus: 2,
      },
      memory_stats: {
        usage: 256,
        limit: 1024,
      },
      networks: {
        eth0: {
          rx_bytes: 100,
          tx_bytes: 200,
        },
      },
      blkio_stats: {
        io_service_bytes_recursive: [
          { op: 'Read', value: 10 },
          { op: 'Write', value: 20 },
        ],
      },
    });
  };

  return {
    collector,
    stream,
    stats,
    getContainer,
    getContainerApi,
    getWatchers,
    emitStats,
    setContainer: (
      containerId: string,
      nextContainer?: { id: string; name: string; watcher: string },
    ) => {
      if (nextContainer) {
        containersById.set(containerId, nextContainer);
        return;
      }
      containersById.delete(containerId);
    },
    advanceNowByMs: (deltaMs: number) => {
      nowMs += deltaMs;
    },
  };
}

describe('stats/collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  test('starts docker stats stream on watch and stops when released', async () => {
    const harness = createHarness();

    const release = harness.collector.watch('c1');
    await Promise.resolve();

    expect(harness.getContainer).toHaveBeenCalledWith('c1');
    expect(harness.getContainerApi).toHaveBeenCalledWith('web');
    expect(harness.stats).toHaveBeenCalledWith({ stream: true });

    release();

    expect(harness.stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('release callback is idempotent', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await Promise.resolve();

    release();
    release();

    expect(harness.stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('duplicate release does not tear down another active watch', async () => {
    const harness = createHarness();
    const releaseOne = harness.collector.watch('c1');
    await Promise.resolve();

    const releaseTwo = harness.collector.watch('c1');
    await Promise.resolve();

    releaseOne();
    expect(harness.stream.destroy).not.toHaveBeenCalled();

    releaseOne();
    expect(harness.stream.destroy).not.toHaveBeenCalled();

    releaseTwo();
    expect(harness.stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('keeps the active stream running until the last watcher releases', async () => {
    const harness = createHarness();
    const releaseOne = harness.collector.watch('c1');
    await Promise.resolve();

    const releaseTwo = harness.collector.watch('c1');
    await Promise.resolve();

    expect(harness.stats).toHaveBeenCalledTimes(1);

    releaseOne();
    expect(harness.stream.destroy).not.toHaveBeenCalled();

    releaseTwo();
    expect(harness.stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('does not attach listeners when watch is released before async start resolves', async () => {
    const stream = createMockStatsStream();
    let resolveStats: ((value: typeof stream) => void) | undefined;
    const stats = vi.fn(
      () =>
        new Promise<typeof stream>((resolve) => {
          resolveStats = resolve;
        }),
    );
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('c1');
    expect(stats).toHaveBeenCalledTimes(1);

    release();
    resolveStats?.(stream);
    await Promise.resolve();

    expect(stream.on).not.toHaveBeenCalled();
    expect(stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('does not throw when async startup resolves to a stream without cleanup hooks after release', async () => {
    const stream = {
      on: vi.fn(() => stream),
    };
    let resolveStats: ((value: typeof stream) => void) | undefined;
    const stats = vi.fn(
      () =>
        new Promise<typeof stream>((resolve) => {
          resolveStats = resolve;
        }),
    );
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('c1');
    release();

    expect(() => resolveStats?.(stream)).not.toThrow();
    await Promise.resolve();
  });

  test('does not require cleanup hooks when a released watch resolves late', async () => {
    const stream = createStreamWithoutCleanupHooks();
    let resolveStats: ((value: typeof stream) => void) | undefined;
    const stats = vi.fn(
      () =>
        new Promise<typeof stream>((resolve) => {
          resolveStats = resolve;
        }),
    );
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('c1');
    expect(stats).toHaveBeenCalledTimes(1);

    release();
    resolveStats?.(stream);
    await Promise.resolve();

    expect(stream.on).not.toHaveBeenCalled();
  });

  test('does not throw when release cleanup hooks are absent on the stream', async () => {
    const stream = {
      on: vi.fn(() => stream),
    };
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats: vi.fn(async () => stream) }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('c1');
    await Promise.resolve();

    expect(() => release()).not.toThrow();
  });

  test('reuses the pending stream start when a watch is reacquired before startup resolves', async () => {
    const stream = createMockStatsStream();
    let resolveStats: ((value: typeof stream) => void) | undefined;
    const stats = vi.fn(
      () =>
        new Promise<typeof stream>((resolve) => {
          resolveStats = resolve;
        }),
    );
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const releaseFirstWatch = collector.watch('c1');
    expect(stats).toHaveBeenCalledTimes(1);

    releaseFirstWatch();

    const releaseSecondWatch = collector.watch('c1');
    expect(stats).toHaveBeenCalledTimes(1);

    resolveStats?.(stream);
    await Promise.resolve();

    expect(stream.on).toHaveBeenCalledTimes(4);
    expect(stream.destroy).not.toHaveBeenCalled();

    releaseSecondWatch();
    expect(stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('does not start a second stream while one is already active', async () => {
    const harness = createHarness();

    const releaseFirstWatch = harness.collector.watch('c1');
    await Promise.resolve();

    const releaseSecondWatch = harness.collector.watch('c1');
    await Promise.resolve();

    expect(harness.stats).toHaveBeenCalledTimes(1);

    releaseSecondWatch();
    releaseFirstWatch();

    expect(harness.stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('destroys the resolved stream when all concurrent watches release before startup resolves', async () => {
    const stream = createMockStatsStream();
    let resolveStats: ((value: typeof stream) => void) | undefined;
    const stats = vi.fn(
      () =>
        new Promise<typeof stream>((resolve) => {
          resolveStats = resolve;
        }),
    );
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const releaseFirstWatch = collector.watch('c1');
    const releaseSecondWatch = collector.watch('c1');
    expect(stats).toHaveBeenCalledTimes(1);

    releaseFirstWatch();
    releaseSecondWatch();

    resolveStats?.(stream);
    await Promise.resolve();

    expect(stream.on).not.toHaveBeenCalled();
    expect(stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('returns early when no stats target can be resolved', async () => {
    const getWatchers = vi.fn(() => ({
      'docker.local': {
        dockerApi: {
          getContainer: vi.fn(),
        },
      },
    }));
    const collector = createContainerStatsCollector({
      getContainerById: vi.fn(() => undefined),
      getWatchers,
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('missing');
    await Promise.resolve();

    expect(getWatchers).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
  });

  test('returns early when docker stats API resolves to a non-stream value', async () => {
    const stats = vi.fn(async () => ({ not: 'a-stream' }));
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('c1');
    await Promise.resolve();

    expect(stats).toHaveBeenCalledTimes(1);
    expect(mockCollectorLogger.warn).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
  });

  test('collects snapshots, throttles by interval, and notifies subscribers', async () => {
    const harness = createHarness();
    const onSnapshot = vi.fn();
    const release = harness.collector.watch('c1');
    const unsubscribe = harness.collector.subscribe('c1', onSnapshot);
    await Promise.resolve();

    harness.emitStats(100, 1000);
    harness.advanceNowByMs(1_000);
    harness.emitStats(200, 1100);
    harness.advanceNowByMs(10_000);
    harness.emitStats(400, 1300);

    const latest = harness.collector.getLatest('c1');
    const history = harness.collector.getHistory('c1');
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(latest).toEqual(
      expect.objectContaining({
        containerId: 'c1',
        cpuPercent: 200,
        memoryPercent: 25,
        networkRxBytes: 100,
        networkTxBytes: 200,
        blockReadBytes: 10,
        blockWriteBytes: 20,
      }),
    );
    expect(history).toHaveLength(2);

    unsubscribe();
    release();
  });

  test('unsubscribe stops future listener notifications', async () => {
    const harness = createHarness();
    const onSnapshot = vi.fn();
    const release = harness.collector.watch('c1');
    const unsubscribe = harness.collector.subscribe('c1', onSnapshot);
    await Promise.resolve();

    harness.emitStats(100, 1000);
    unsubscribe();
    harness.advanceNowByMs(10_000);
    harness.emitStats(200, 1100);

    expect(onSnapshot).toHaveBeenCalledTimes(1);

    release();
  });

  test('logs trace when dropping a throttled stats sample', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await Promise.resolve();

    harness.emitStats(100, 1000);
    harness.advanceNowByMs(1_000);
    harness.emitStats(200, 1100);

    expect(mockCollectorLogger.trace).toHaveBeenCalledWith(
      expect.objectContaining({
        containerId: 'c1',
        elapsedMs: 1_000,
        intervalMs: 10_000,
      }),
      'Dropping throttled container stats sample',
    );

    release();
  });

  test('logs and detaches the stream when listener attachment throws', async () => {
    const stream = {
      on: vi.fn(() => {
        throw new Error('attach-failed');
      }),
      removeAllListeners: vi.fn(),
      destroy: vi.fn(),
    };
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats: vi.fn(async () => stream) }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    collector.watch('c1');
    await Promise.resolve();

    expect(mockCollectorLogger.warn).toHaveBeenCalledWith(
      'Failed to attach stats stream listeners for c1 (attach-failed)',
    );
    expect(stream.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('logs when starting the docker stats stream throws', async () => {
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({
              stats: vi.fn(() => {
                throw new Error('start-failed');
              }),
            }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    collector.watch('c1');
    await Promise.resolve();

    expect(mockCollectorLogger.warn).toHaveBeenCalledWith(
      'Failed to start Docker stats stream for c1 (start-failed)',
    );
  });

  test('accepts a stats sample exactly at the throttling interval boundary', async () => {
    const harness = createHarness();
    const onSnapshot = vi.fn();
    const release = harness.collector.watch('c1');
    const unsubscribe = harness.collector.subscribe('c1', onSnapshot);
    await Promise.resolve();

    harness.emitStats(100, 1000);
    harness.advanceNowByMs(10_000);
    harness.emitStats(200, 1100);

    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.collector.getLatest('c1')).toEqual(
      expect.objectContaining({
        containerId: 'c1',
        cpuPercent: 200,
      }),
    );

    unsubscribe();
    release();
  });

  test('supports JSON string payload chunks', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await Promise.resolve();

    harness.stream.emit(
      'data',
      JSON.stringify({
        cpu_stats: {
          cpu_usage: {
            total_usage: 100,
            percpu_usage: [50, 50],
          },
          system_cpu_usage: 1000,
          online_cpus: 2,
        },
        memory_stats: {
          usage: 512,
          limit: 1024,
        },
        networks: {},
        blkio_stats: {
          io_service_bytes_recursive: [],
        },
      }),
    );

    expect(harness.collector.getLatest('c1')).toEqual(
      expect.objectContaining({
        memoryUsageBytes: 512,
        memoryPercent: 50,
      }),
    );

    release();
  });

  test('supports Buffer payload chunks', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await Promise.resolve();

    harness.stream.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          cpu_stats: {
            cpu_usage: {
              total_usage: 100,
              percpu_usage: [50, 50],
            },
            system_cpu_usage: 1000,
            online_cpus: 2,
          },
          memory_stats: {
            usage: 128,
            limit: 256,
          },
          networks: {},
          blkio_stats: {
            io_service_bytes_recursive: [],
          },
        }),
      ),
    );

    expect(harness.collector.getLatest('c1')).toEqual(
      expect.objectContaining({
        memoryUsageBytes: 128,
        memoryLimitBytes: 256,
      }),
    );

    release();
  });

  test('ignores empty and malformed chunk payloads', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await Promise.resolve();

    harness.stream.emit('data', undefined);
    harness.stream.emit('data', '\n');
    harness.stream.emit('data', 'not-json');

    expect(harness.collector.getLatest('c1')).toBeUndefined();
    release();
  });

  test('touch starts temporary watch and auto-releases after ttl', async () => {
    const harness = createHarness();

    harness.collector.touch('c1');
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(35_000);
    expect(harness.stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('touch refresh clears previous timeout and delays release', async () => {
    const harness = createHarness();
    harness.collector.touch('c1');
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(10_000);
    harness.collector.touch('c1');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.stream.destroy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25_000);
    expect(harness.stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('touch clears the previous timeout handle before scheduling a new one', async () => {
    const firstTimeout = { id: 'first-timeout' };
    const secondTimeout = { id: 'second-timeout' };
    const setTimeoutFn = vi
      .fn()
      .mockReturnValueOnce(firstTimeout as any)
      .mockReturnValueOnce(secondTimeout as any);
    const clearTimeoutFn = vi.fn();
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats: vi.fn(async () => createMockStatsStream()) }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
      setTimeoutFn: setTimeoutFn as any,
      clearTimeoutFn: clearTimeoutFn as any,
    });

    collector.touch('c1');
    collector.touch('c1');

    expect(setTimeoutFn).toHaveBeenCalledTimes(2);
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(clearTimeoutFn).toHaveBeenCalledWith(firstTimeout);
  });

  test('touch honors the minimum rest-touch ttl floor for short scan intervals', async () => {
    const stream = createMockStatsStream();
    const stats = vi.fn(async () => stream);
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats }),
          },
        },
      }),
      intervalSeconds: 2,
      historySize: 3,
      now: () => Date.now(),
    });

    collector.touch('c1');
    await Promise.resolve();

    expect(stats).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(stream.destroy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('reuses one deleted-state sweep interval and keeps it running while other states remain', async () => {
    const intervalHandle = { id: 'deleted-state-sweep' };
    let runDeletedStateSweep: (() => void) | undefined;
    const setIntervalFn = vi.fn((callback: () => void) => {
      runDeletedStateSweep = callback;
      return intervalHandle as any;
    });
    const clearIntervalFn = vi.fn();
    const containersById = new Map<string, { id: string; name: string; watcher: string }>([
      ['c1', { id: 'c1', name: 'web', watcher: 'local' }],
      ['c2', { id: 'c2', name: 'api', watcher: 'local' }],
    ]);
    const collector = createContainerStatsCollector({
      getContainerById: (containerId: string) => containersById.get(containerId) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({
              stats: vi.fn(async () => createMockStatsStream()),
            }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
      setIntervalFn,
      clearIntervalFn,
    });

    const releaseFirst = collector.watch('c1');
    const releaseSecond = collector.watch('c2');
    await Promise.resolve();

    expect(setIntervalFn).toHaveBeenCalledTimes(1);

    releaseFirst();
    containersById.delete('c1');
    runDeletedStateSweep?.();

    expect(clearIntervalFn).not.toHaveBeenCalled();
    containersById.set('c1', { id: 'c1', name: 'web', watcher: 'local' });
    const reusedRelease = collector.watch('c1');
    await Promise.resolve();
    expect(collector.getHistory('c1')).toEqual([]);
    reusedRelease();

    releaseSecond();
    containersById.delete('c2');
    runDeletedStateSweep?.();
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
  });

  test('stops the deleted-state sweep once the last inactive state is pruned', async () => {
    const intervalHandle = { id: 'deleted-state-sweep' };
    let runDeletedStateSweep: (() => void) | undefined;
    const setIntervalFn = vi.fn((callback: () => void) => {
      runDeletedStateSweep = callback;
      return intervalHandle as any;
    });
    const clearIntervalFn = vi.fn();
    const containersById = new Map<string, { id: string; name: string; watcher: string }>([
      ['c1', { id: 'c1', name: 'web', watcher: 'local' }],
    ]);
    const collector = createContainerStatsCollector({
      getContainerById: (containerId: string) => containersById.get(containerId) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({
              stats: vi.fn(async () => createMockStatsStream()),
            }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
      setIntervalFn,
      clearIntervalFn,
    });

    const release = collector.watch('c1');
    await Promise.resolve();

    release();
    containersById.delete('c1');
    runDeletedStateSweep?.();
    await Promise.resolve();

    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
  });

  test('handles error/close/end stream lifecycle events', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.stats).toHaveBeenCalledTimes(1);

    // Error triggers cleanup + schedules restart after base delay (1000ms)
    harness.stream.emit('error', new Error('stream-error'));
    expect(mockCollectorLogger.warn).toHaveBeenCalledWith(
      'Docker stats stream error for c1 (stream-error)',
    );
    expect(harness.stream.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(harness.stream.destroy).toHaveBeenCalledTimes(1);

    // Reconnect fires after the 1000ms base delay
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(2);

    // close triggers another restart; delay now doubled to 2000ms
    harness.stream.emit('close');
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(3);

    // end triggers another restart; delay now doubled to 4000ms
    harness.stream.emit('end');
    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(4);

    release();
  });

  test('reconnect does not fire before base delay and does fire at base delay', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.stats).toHaveBeenCalledTimes(1);

    harness.stream.emit('close');

    // 999ms — reconnect should NOT have fired yet
    await vi.advanceTimersByTimeAsync(999);
    expect(harness.stats).toHaveBeenCalledTimes(1);

    // Final 1ms to reach base delay — reconnect should fire now
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(2);

    release();
  });

  test('consecutive failures back off exponentially and cap at 60000ms', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.stats).toHaveBeenCalledTimes(1);

    // 1st failure: delay = 1000ms (base)
    harness.stream.emit('close');
    await vi.advanceTimersByTimeAsync(999);
    expect(harness.stats).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(2);

    // 2nd failure: delay should be 2000ms
    harness.stream.emit('close');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(harness.stats).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(3);

    // 3rd failure: delay should be 4000ms
    harness.stream.emit('close');
    await vi.advanceTimersByTimeAsync(3_999);
    expect(harness.stats).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(4);

    // Drive failures until cap (1s→2s→4s→8s→16s→32s→60s cap)
    // Current delay after 3 failures = 8000ms (next doubling from 4000)
    // Advance through enough cycles to hit the 60s cap
    for (const expectedDelay of [8_000, 16_000, 32_000]) {
      harness.stream.emit('close');
      await vi.advanceTimersByTimeAsync(expectedDelay - 1);
      const countBefore = harness.stats.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(harness.stats.mock.calls.length).toBe(countBefore + 1);
    }

    // After the 32s failure (retryDelayMs was set to min(32000*2,60000)=60000)
    // Next reconnect must fire at 60s, not at 64s
    harness.stream.emit('close');
    const countAt59 = harness.stats.mock.calls.length;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(harness.stats.mock.calls.length).toBe(countAt59); // not yet
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(harness.stats.mock.calls.length).toBe(countAt59 + 1); // fires at cap

    // One more failure — still capped at 60s
    harness.stream.emit('close');
    const countAt60Cap = harness.stats.mock.calls.length;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(harness.stats.mock.calls.length).toBe(countAt60Cap);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(harness.stats.mock.calls.length).toBe(countAt60Cap + 1);

    release();
  });

  test('backoff resets to base delay after stream delivers healthy data', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.stats).toHaveBeenCalledTimes(1);

    // 1st failure: delay = 1000ms → retryDelayMs is now set to 2000ms
    harness.stream.emit('close');
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(2);

    // Stream delivers data — this should reset retryDelayMs
    harness.emitStats(100, 1000);

    // 2nd failure after healthy data: delay should be 1000ms again (reset), not 2000ms
    harness.stream.emit('close');
    // Confirm it does NOT fire at 999ms
    await vi.advanceTimersByTimeAsync(999);
    expect(harness.stats).toHaveBeenCalledTimes(2);
    // Fires at 1000ms (base, not doubled 2000ms)
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(3);

    release();
  });

  test('burst of close/error/end on dead stream results in exactly one reconnect', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.stats).toHaveBeenCalledTimes(1);

    // Emit three lifecycle events in rapid succession before timer fires
    harness.stream.emit('close');
    harness.stream.emit('error', new Error('burst-error'));
    harness.stream.emit('end');

    // Exactly one timer should be pending — firing it opens exactly one new stream
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(2);

    release();
  });

  test('stopCollection clears pending retry so no reconnect fires after last watcher releases', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.stats).toHaveBeenCalledTimes(1);

    // Trigger failure — schedules reconnect after 1000ms
    harness.stream.emit('close');
    expect(harness.stats).toHaveBeenCalledTimes(1);

    // Release the watcher before the timer fires — stopCollection should cancel it
    release();

    // Advance well past the base delay — no new stream should open
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(1);
  });

  test('watch while retry is pending does not open a second stream immediately', async () => {
    const harness = createHarness();
    const release1 = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.stats).toHaveBeenCalledTimes(1);

    // Stream fails — retry timer scheduled
    harness.stream.emit('close');
    expect(harness.stats).toHaveBeenCalledTimes(1);

    // A second watch() while retry is pending should NOT open a new stream yet
    const release2 = harness.collector.watch('c1');
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(1);

    // Only after the timer fires does the stream re-open
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(2);

    release1();
    release2();
  });

  test('removes listeners from old stream before restarting on error', async () => {
    const harness = createHarness();
    harness.collector.watch('c1');
    await Promise.resolve();

    expect(harness.stream.removeAllListeners).not.toHaveBeenCalled();

    harness.stream.emit('error', new Error('disconnect'));
    await Promise.resolve();

    expect(harness.stream.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(harness.stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('removes listeners from stream on release', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await Promise.resolve();

    release();

    expect(harness.stream.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(harness.stream.destroy).toHaveBeenCalledTimes(1);
  });

  test('drops collected state after container deletion once watch is released', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await Promise.resolve();

    harness.emitStats(100, 1000);
    expect(harness.collector.getLatest('c1')).toEqual(
      expect.objectContaining({
        containerId: 'c1',
      }),
    );
    expect(harness.collector.getHistory('c1')).toHaveLength(1);

    harness.getContainer.mockReturnValue(undefined);
    release();
    await Promise.resolve();

    expect(harness.collector.getLatest('c1')).toBeUndefined();
    expect(harness.collector.getHistory('c1')).toEqual([]);
  });

  test('getLatest prunes inactive state when the requested container has been deleted', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);

    // Emit at least one snapshot so getLatest returns data while container exists
    harness.emitStats(100, 1000);
    expect(harness.collector.getLatest('c1')).toBeDefined();

    // Release while container still exists — state goes inactive but stays in the map
    release();

    // Container is now deleted
    harness.getContainer.mockReturnValue(undefined);

    // Advancing the injected clock should not matter here because getLatest performs
    // same-container pruning after it resolves the cached state.
    harness.advanceNowByMs(31_000);

    expect(harness.collector.getLatest('c1')).toBeUndefined();
  });

  test('does not sweep unrelated inactive deleted states during request reads before the timer fires', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);

    harness.emitStats(100, 1000);
    expect(harness.collector.getHistory('c1')).toHaveLength(1);

    release();
    harness.setContainer('c1');
    harness.advanceNowByMs(31_000);

    expect(harness.collector.getLatest('c2')).toBeUndefined();

    const reuseRelease = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.collector.getHistory('c1')).toHaveLength(1);

    reuseRelease();
    await vi.advanceTimersByTimeAsync(30_000);

    const postSweepRelease = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.collector.getHistory('c1')).toEqual([]);

    postSweepRelease();
  });

  test('getHistory returns empty array when state is pruned during the call', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await vi.advanceTimersByTimeAsync(0);

    harness.emitStats(100, 1000);
    expect(harness.collector.getHistory('c1')).toHaveLength(1);

    // Release while container still exists — state inactive but not pruned
    release();

    // Container deleted — next getHistory prunes state mid-call
    harness.getContainer.mockReturnValue(undefined);

    expect(harness.collector.getHistory('c1')).toEqual([]);
  });

  test('returns empty history for unknown containers', () => {
    const harness = createHarness();
    expect(harness.collector.getHistory('missing')).toEqual([]);
  });

  test('does not throw when container is missing or watcher cannot provide docker api', async () => {
    const harness = createHarness();
    harness.getContainer.mockReturnValueOnce(undefined);
    harness.getWatchers.mockReturnValueOnce({});

    const releaseMissing = harness.collector.watch('missing');
    await Promise.resolve();
    expect(harness.collector.getLatest('missing')).toBeUndefined();
    releaseMissing();

    const releaseUnsupported = harness.collector.watch('c1');
    await Promise.resolve();
    expect(harness.collector.getLatest('c1')).toBeUndefined();
    releaseUnsupported();
  });

  test('does not call stats when watcher api is missing', async () => {
    const stats = vi.fn(async () => createMockStatsStream());
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {},
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('c1');
    await Promise.resolve();

    expect(stats).not.toHaveBeenCalled();
    release();
  });

  test('does not call stats when watcher api is a primitive value', async () => {
    const stats = vi.fn(async () => createMockStatsStream());
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': 123 as any,
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('c1');
    await Promise.resolve();

    expect(stats).not.toHaveBeenCalled();
    release();
  });

  test('gracefully handles invalid stream results and stream startup errors', async () => {
    const getContainer = vi.fn(() => ({ id: 'c1', name: 'web', watcher: 'local' }));
    const getWatchersNull = vi.fn(() => ({
      'docker.local': {
        dockerApi: {
          getContainer: vi.fn(() => ({ stats: vi.fn(async () => null) })),
        },
      },
    }));
    const collectorNull = createContainerStatsCollector({
      getContainerById: getContainer,
      getWatchers: getWatchersNull,
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });
    const releaseNull = collectorNull.watch('c1');
    await Promise.resolve();
    releaseNull();

    const getWatchersPrimitive = vi.fn(() => ({
      'docker.local': {
        dockerApi: {
          getContainer: vi.fn(() => ({ stats: vi.fn(async () => 'not-a-stream') })),
        },
      },
    }));
    const collectorPrimitive = createContainerStatsCollector({
      getContainerById: getContainer,
      getWatchers: getWatchersPrimitive,
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });
    const releasePrimitive = collectorPrimitive.watch('c1');
    await Promise.resolve();
    releasePrimitive();

    const getWatchersInvalid = vi.fn(() => ({
      'docker.local': {
        dockerApi: {
          getContainer: vi.fn(() => ({ stats: vi.fn(async () => ({})) })),
        },
      },
    }));
    const collectorInvalid = createContainerStatsCollector({
      getContainerById: getContainer,
      getWatchers: getWatchersInvalid,
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });
    const releaseInvalid = collectorInvalid.watch('c1');
    await Promise.resolve();
    releaseInvalid();

    const getWatchersThrow = vi.fn(() => ({
      'docker.local': {
        dockerApi: {
          getContainer: vi.fn(() => ({
            stats: vi.fn(async () => {
              throw new Error('failed');
            }),
          })),
        },
      },
    }));
    const collectorThrow = createContainerStatsCollector({
      getContainerById: getContainer,
      getWatchers: getWatchersThrow,
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });
    const releaseThrow = collectorThrow.watch('c1');
    await Promise.resolve();
    releaseThrow();

    expect(mockCollectorLogger.warn).toHaveBeenCalledWith(
      'Failed to start Docker stats stream for c1 (failed)',
    );
  });

  test('touch schedules rest touch timeout at three times the scan interval', async () => {
    const stream = createMockStatsStream();
    const setTimeoutFn = vi.fn(() => ({ id: 'rest-touch-timeout' }) as any);
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats: vi.fn(async () => stream) }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
      setTimeoutFn,
    });

    collector.touch('c1');
    await Promise.resolve();

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  test('detaches stream when listener attachment throws mid-way', async () => {
    let callCount = 0;
    const stream = {
      on: vi.fn(() => {
        callCount += 1;
        if (callCount === 2) {
          throw new Error('stream destroyed');
        }
        return stream;
      }),
      removeAllListeners: vi.fn(),
      destroy: vi.fn(),
    };
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats: vi.fn(async () => stream) }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('c1');
    await Promise.resolve();

    // First .on() succeeded, second threw — stream should be cleaned up
    expect(mockCollectorLogger.warn).toHaveBeenCalledWith(
      'Failed to attach stats stream listeners for c1 (stream destroyed)',
    );
    expect(stream.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(stream.destroy).toHaveBeenCalledTimes(1);

    release();
  });

  test('unsubscribe stops later snapshots from reaching the removed listener', async () => {
    const harness = createHarness();
    const onSnapshot = vi.fn();
    const release = harness.collector.watch('c1');
    const unsubscribe = harness.collector.subscribe('c1', onSnapshot);
    await Promise.resolve();

    harness.emitStats(100, 1000);
    unsubscribe();
    harness.advanceNowByMs(10_000);
    harness.emitStats(200, 1100);

    expect(onSnapshot).toHaveBeenCalledTimes(1);

    release();
  });

  test('unsubscribe prunes deleted listener-only state', () => {
    const harness = createHarness();
    const listener = vi.fn();

    const unsubscribe = harness.collector.subscribe('c1', listener);
    harness.getContainer.mockReturnValue(undefined);

    unsubscribe();

    expect(harness.collector.getLatest('c1')).toBeUndefined();
    expect(harness.collector.getHistory('c1')).toEqual([]);
  });

  test('uses default configuration fallbacks and avoids duplicate start while pending', async () => {
    const previousInterval = process.env.DD_STATS_INTERVAL;
    const previousHistory = process.env.DD_STATS_HISTORY_SIZE;
    process.env.DD_STATS_INTERVAL = '2';
    process.env.DD_STATS_HISTORY_SIZE = '4';

    try {
      const stream = createMockStatsStream();
      const stats = vi.fn(async () => stream);
      const collector = createContainerStatsCollector({
        getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
        getWatchers: () => ({
          'docker.local': {
            dockerApi: {
              getContainer: () => ({ stats }),
            },
          },
        }),
      });

      const releaseOne = collector.watch('c1');
      const releaseTwo = collector.watch('c1');
      await Promise.resolve();

      expect(stats).toHaveBeenCalledTimes(1);
      stream.emit('data', {
        cpu_stats: {
          cpu_usage: { total_usage: 100, percpu_usage: [50, 50] },
          system_cpu_usage: 200,
          online_cpus: 2,
        },
        memory_stats: {
          usage: 100,
          limit: 200,
        },
        networks: {},
        blkio_stats: {
          io_service_bytes_recursive: [],
        },
      });
      expect(collector.getLatest('c1')).toEqual(
        expect.objectContaining({
          containerId: 'c1',
          memoryPercent: 50,
        }),
      );
      releaseOne();
      releaseTwo();
    } finally {
      if (previousInterval === undefined) {
        delete process.env.DD_STATS_INTERVAL;
      } else {
        process.env.DD_STATS_INTERVAL = previousInterval;
      }
      if (previousHistory === undefined) {
        delete process.env.DD_STATS_HISTORY_SIZE;
      } else {
        process.env.DD_STATS_HISTORY_SIZE = previousHistory;
      }
    }
  });

  test('does not start a duplicate stream once one is already active', async () => {
    const harness = createHarness();
    const releaseOne = harness.collector.watch('c1');
    await Promise.resolve();

    const releaseTwo = harness.collector.watch('c1');
    await Promise.resolve();

    expect(harness.stats).toHaveBeenCalledTimes(1);

    releaseOne();
    releaseTwo();
  });

  test('restartCollection skips reconnect when watchCount is zero (stream lacking cleanup hooks)', async () => {
    // Use a stream without removeAllListeners so detachStream cannot silence
    // the stream's listeners. If the stream fires a lifecycle event after the
    // last watcher has released, restartCollection must bail out at the
    // watchCount === 0 guard rather than scheduling a reconnect.
    const stream = createStreamWithoutCleanupHooks();
    const stats = vi.fn(async () => stream);
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('c1');
    await Promise.resolve();
    expect(stats).toHaveBeenCalledTimes(1);

    // Release the watcher — watchCount drops to 0. Because the stream has no
    // removeAllListeners, the close listener is still registered on the stream.
    release();

    // Stream fires close after the watcher has gone — restartCollection is
    // called but watchCount === 0 so it must return without scheduling a retry.
    stream.emit('close');

    // Advance well past any reconnect delay — no new stream should be opened.
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    expect(stats).toHaveBeenCalledTimes(1);
  });

  test('restartCollection skips stacked timer when retryTimer is already set (stream lacking cleanup hooks)', async () => {
    // Use a stream without removeAllListeners so that after the first lifecycle
    // event detaches state.stream (but cannot silence the JS emitter), a second
    // event still reaches the registered listener and must hit the retryTimer
    // guard at line 349 rather than scheduling a second concurrent timer.
    const stream = createStreamWithoutCleanupHooks();
    const stats = vi.fn(async () => stream);
    const collector = createContainerStatsCollector({
      getContainerById: () => ({ id: 'c1', name: 'web', watcher: 'local' }) as any,
      getWatchers: () => ({
        'docker.local': {
          dockerApi: {
            getContainer: () => ({ stats }),
          },
        },
      }),
      intervalSeconds: 10,
      historySize: 3,
      now: () => Date.now(),
    });

    const release = collector.watch('c1');
    await Promise.resolve();
    expect(stats).toHaveBeenCalledTimes(1);

    // First close: detaches state.stream and schedules a retry timer.
    stream.emit('close');

    // Second close: detachStream is a no-op (state.stream already undefined);
    // watchCount is still 1; retryTimer is now set — must hit guard and return.
    stream.emit('close');

    // Only ONE timer should be pending, so exactly one reconnect fires.
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(stats).toHaveBeenCalledTimes(2);

    release();
  });
});
