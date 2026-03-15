import { summarizeContainerResourceUsage } from '@/utils/stats-summary';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'web',
    status: 'running',
    watcher: 'local',
    agent: undefined,
    stats: {
      containerId: 'c1',
      cpuPercent: 10,
      memoryUsageBytes: 100,
      memoryLimitBytes: 200,
      memoryPercent: 50,
      networkRxBytes: 1,
      networkTxBytes: 2,
      blockReadBytes: 3,
      blockWriteBytes: 4,
      timestamp: '2026-03-14T10:00:00.000Z',
    },
    ...overrides,
  };
}

describe('stats-summary', () => {
  it('returns top CPU and memory lists limited to five rows', () => {
    const summary = summarizeContainerResourceUsage([
      makeRow({ id: 'c1', name: 'a', stats: makeRow().stats }),
      makeRow({
        id: 'c2',
        name: 'b',
        stats: { ...makeRow().stats, cpuPercent: 90, memoryPercent: 20 },
      }),
      makeRow({
        id: 'c3',
        name: 'c',
        stats: { ...makeRow().stats, cpuPercent: 30, memoryPercent: 95 },
      }),
      makeRow({
        id: 'c4',
        name: 'd',
        stats: { ...makeRow().stats, cpuPercent: 60, memoryPercent: 40 },
      }),
      makeRow({
        id: 'c5',
        name: 'e',
        stats: { ...makeRow().stats, cpuPercent: 70, memoryPercent: 70 },
      }),
      makeRow({
        id: 'c6',
        name: 'f',
        stats: { ...makeRow().stats, cpuPercent: 20, memoryPercent: 80 },
      }),
    ]);

    expect(summary.topCpu).toHaveLength(5);
    expect(summary.topMemory).toHaveLength(5);
    expect(summary.topCpu.map((row) => row.name)).toEqual(['b', 'e', 'd', 'c', 'f']);
    expect(summary.topMemory.map((row) => row.name)).toEqual(['c', 'f', 'e', 'a', 'd']);
  });

  it('computes aggregate cpu and memory usage values', () => {
    const summary = summarizeContainerResourceUsage([
      makeRow({
        id: 'c1',
        name: 'web',
        stats: { ...makeRow().stats, cpuPercent: 50, memoryUsageBytes: 300, memoryLimitBytes: 600 },
      }),
      makeRow({
        id: 'c2',
        name: 'db',
        stats: {
          ...makeRow().stats,
          cpuPercent: 100,
          memoryUsageBytes: 100,
          memoryLimitBytes: 200,
        },
      }),
    ]);

    expect(summary.watchedContainers).toBe(2);
    expect(summary.totalCpuPercent).toBe(75);
    expect(summary.totalMemoryPercent).toBe(50);
    expect(summary.totalMemoryUsageBytes).toBe(400);
    expect(summary.totalMemoryLimitBytes).toBe(800);
  });

  it('ignores rows without stats and handles zero memory limits', () => {
    const summary = summarizeContainerResourceUsage([
      makeRow({ id: 'c1', name: 'web', stats: null }),
      makeRow({
        id: 'c2',
        name: 'db',
        stats: {
          ...makeRow().stats,
          cpuPercent: Number.NaN,
          memoryUsageBytes: 100,
          memoryLimitBytes: 0,
        },
      }),
    ]);

    expect(summary.watchedContainers).toBe(1);
    expect(summary.totalCpuPercent).toBe(0);
    expect(summary.totalMemoryPercent).toBe(0);
  });
});
