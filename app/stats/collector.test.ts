import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createContainerStatsCollector } from './collector.js';

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
    destroy: vi.fn(),
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
  const stream = createMockStatsStream();
  const stats = vi.fn(async () => stream);
  const getContainer = vi.fn(() => ({
    id: 'c1',
    name: 'web',
    watcher: 'local',
  }));
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
    advanceNowByMs: (deltaMs: number) => {
      nowMs += deltaMs;
    },
  };
}

describe('stats/collector', () => {
  beforeEach(() => {
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

  test('handles error/close/end stream lifecycle events', async () => {
    const harness = createHarness();
    const release = harness.collector.watch('c1');
    await Promise.resolve();
    expect(harness.stats).toHaveBeenCalledTimes(1);

    harness.stream.emit('error', new Error('stream-error'));
    await Promise.resolve();
    await Promise.resolve();

    harness.stream.emit('close');
    await Promise.resolve();
    await Promise.resolve();

    harness.stream.emit('end');
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.stats.mock.calls.length).toBeGreaterThanOrEqual(2);

    release();
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
});
