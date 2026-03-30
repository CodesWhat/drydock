import {
  calculateContainerStatsSnapshot,
  calculateCpuPercent,
  type DockerContainerStats,
} from './calculation.js';

function createStats(overrides: Partial<DockerContainerStats> = {}): DockerContainerStats {
  return {
    cpu_stats: {
      cpu_usage: {
        total_usage: 400,
        percpu_usage: [200, 200],
      },
      system_cpu_usage: 1000,
      online_cpus: 2,
    },
    precpu_stats: {
      cpu_usage: {
        total_usage: 200,
      },
      system_cpu_usage: 800,
    },
    memory_stats: {
      usage: 256,
      limit: 1024,
    },
    networks: {
      eth0: {
        rx_bytes: 1000,
        tx_bytes: 2000,
      },
      eth1: {
        rx_bytes: 100,
        tx_bytes: 200,
      },
    },
    blkio_stats: {
      io_service_bytes_recursive: [
        { op: 'Read', value: 10 },
        { op: 'Write', value: 20 },
        { op: 'READ', value: 5 },
        { op: 'WRITE', value: 7 },
        { value: 999 },
      ],
    },
    ...overrides,
  } as DockerContainerStats;
}

describe('stats/calculation', () => {
  test('calculates cpu percent from docker deltas', () => {
    const previous = createStats({
      cpu_stats: {
        cpu_usage: { total_usage: 200, percpu_usage: [100, 100] },
        system_cpu_usage: 800,
        online_cpus: 2,
      },
    });
    const current = createStats({
      cpu_stats: {
        cpu_usage: { total_usage: 400, percpu_usage: [200, 200] },
        system_cpu_usage: 1000,
        online_cpus: 2,
      },
    });

    expect(calculateCpuPercent(current, previous)).toBe(200);
  });

  test('returns zero cpu percent when previous stats are missing or deltas are invalid', () => {
    const current = createStats();
    expect(calculateCpuPercent(current, undefined)).toBe(0);

    const nonIncreasingSystem = createStats({
      cpu_stats: {
        cpu_usage: { total_usage: 500, percpu_usage: [250, 250] },
        system_cpu_usage: 1000,
        online_cpus: 2,
      },
    });
    const previous = createStats({
      cpu_stats: {
        cpu_usage: { total_usage: 400, percpu_usage: [200, 200] },
        system_cpu_usage: 1000,
        online_cpus: 2,
      },
    });
    expect(calculateCpuPercent(nonIncreasingSystem, previous)).toBe(0);
  });

  test('falls back to percpu usage length and single cpu when online cpu count is missing', () => {
    const previousPerCpu = createStats({
      cpu_stats: {
        cpu_usage: { total_usage: 100, percpu_usage: [50, 50, 0] },
        system_cpu_usage: 900,
      },
    });
    const currentPerCpu = createStats({
      cpu_stats: {
        cpu_usage: { total_usage: 200, percpu_usage: [100, 100, 0] },
        system_cpu_usage: 1000,
      },
    });
    expect(calculateCpuPercent(currentPerCpu, previousPerCpu)).toBe(300);

    const previousSingle = createStats({
      cpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 900,
      },
    });
    const currentSingle = createStats({
      cpu_stats: {
        cpu_usage: { total_usage: 200 },
        system_cpu_usage: 1000,
      },
    });
    expect(calculateCpuPercent(currentSingle, previousSingle)).toBe(100);
  });

  test('builds normalized snapshot with memory, network, and block io totals', () => {
    const snapshot = calculateContainerStatsSnapshot(
      'container-1',
      createStats(),
      createStats({
        cpu_stats: {
          cpu_usage: { total_usage: 200, percpu_usage: [100, 100] },
          system_cpu_usage: 800,
          online_cpus: 2,
        },
      }),
      Date.parse('2026-03-14T12:00:00.000Z'),
    );

    expect(snapshot).toEqual({
      containerId: 'container-1',
      cpuPercent: 200,
      memoryUsageBytes: 256,
      memoryLimitBytes: 1024,
      memoryPercent: 25,
      networkRxBytes: 1100,
      networkTxBytes: 2200,
      blockReadBytes: 15,
      blockWriteBytes: 27,
      timestamp: '2026-03-14T12:00:00.000Z',
    });
  });

  test('returns zeroed network and block io totals when stats sections are missing', () => {
    const snapshot = calculateContainerStatsSnapshot(
      'container-2',
      createStats({
        networks: undefined,
        blkio_stats: undefined,
        memory_stats: {
          usage: 100,
          limit: 0,
        },
      }),
      undefined,
      Date.parse('2026-03-14T12:05:00.000Z'),
    );

    expect(snapshot).toEqual({
      containerId: 'container-2',
      cpuPercent: 0,
      memoryUsageBytes: 100,
      memoryLimitBytes: 0,
      memoryPercent: 0,
      networkRxBytes: 0,
      networkTxBytes: 0,
      blockReadBytes: 0,
      blockWriteBytes: 0,
      timestamp: '2026-03-14T12:05:00.000Z',
    });
  });
});
