export interface DockerCpuUsage {
  total_usage?: number;
  percpu_usage?: number[];
}

export interface DockerCpuStats {
  cpu_usage?: DockerCpuUsage;
  system_cpu_usage?: number;
  online_cpus?: number;
}

export interface DockerMemoryStats {
  usage?: number;
  limit?: number;
}

export interface DockerNetworkStats {
  rx_bytes?: number;
  tx_bytes?: number;
}

export interface DockerBlockIoEntry {
  op?: string;
  value?: number;
}

export interface DockerContainerStats {
  cpu_stats?: DockerCpuStats;
  memory_stats?: DockerMemoryStats;
  networks?: Record<string, DockerNetworkStats | undefined>;
  blkio_stats?: {
    io_service_bytes_recursive?: DockerBlockIoEntry[];
  };
}

export interface ContainerStatsSnapshot {
  containerId: string;
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  timestamp: string;
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function resolveOnlineCpuCount(stats: DockerContainerStats): number {
  const onlineCpus = Math.trunc(toFiniteNumber(stats.cpu_stats?.online_cpus));
  if (onlineCpus > 0) {
    return onlineCpus;
  }
  const perCpuUsage = stats.cpu_stats?.cpu_usage?.percpu_usage;
  if (Array.isArray(perCpuUsage) && perCpuUsage.length > 0) {
    return perCpuUsage.length;
  }
  return 1;
}

function roundMetric(value: number): number {
  return Number.parseFloat(value.toFixed(2));
}

export function calculateCpuPercent(
  currentStats: DockerContainerStats,
  previousStats?: DockerContainerStats,
): number {
  if (!previousStats) {
    return 0;
  }

  const cpuDelta =
    toFiniteNumber(currentStats.cpu_stats?.cpu_usage?.total_usage) -
    toFiniteNumber(previousStats.cpu_stats?.cpu_usage?.total_usage);
  const systemDelta =
    toFiniteNumber(currentStats.cpu_stats?.system_cpu_usage) -
    toFiniteNumber(previousStats.cpu_stats?.system_cpu_usage);

  if (cpuDelta <= 0 || systemDelta <= 0) {
    return 0;
  }

  const cpuPercent = (cpuDelta / systemDelta) * resolveOnlineCpuCount(currentStats) * 100;
  return roundMetric(cpuPercent);
}

function sumNetworkBytes(stats: DockerContainerStats, key: 'rx_bytes' | 'tx_bytes'): number {
  const networks = stats.networks;
  if (!networks || typeof networks !== 'object') {
    return 0;
  }

  let totalBytes = 0;
  for (const networkStats of Object.values(networks)) {
    totalBytes += toFiniteNumber(networkStats?.[key]);
  }
  return totalBytes;
}

function sumBlockIoByOperation(stats: DockerContainerStats, operation: 'read' | 'write'): number {
  const entries = stats.blkio_stats?.io_service_bytes_recursive;
  if (!Array.isArray(entries)) {
    return 0;
  }

  let totalBytes = 0;
  for (const entry of entries) {
    if ((entry.op ?? '').toLowerCase() === operation) {
      totalBytes += toFiniteNumber(entry.value);
    }
  }
  return totalBytes;
}

export function calculateContainerStatsSnapshot(
  containerId: string,
  currentStats: DockerContainerStats,
  previousStats?: DockerContainerStats,
  nowMs = Date.now(),
): ContainerStatsSnapshot {
  const memoryUsageBytes = toFiniteNumber(currentStats.memory_stats?.usage);
  const memoryLimitBytes = toFiniteNumber(currentStats.memory_stats?.limit);
  const memoryPercent =
    memoryLimitBytes > 0 ? roundMetric((memoryUsageBytes / memoryLimitBytes) * 100) : 0;

  return {
    containerId,
    cpuPercent: calculateCpuPercent(currentStats, previousStats),
    memoryUsageBytes,
    memoryLimitBytes,
    memoryPercent,
    networkRxBytes: sumNetworkBytes(currentStats, 'rx_bytes'),
    networkTxBytes: sumNetworkBytes(currentStats, 'tx_bytes'),
    blockReadBytes: sumBlockIoByOperation(currentStats, 'read'),
    blockWriteBytes: sumBlockIoByOperation(currentStats, 'write'),
    timestamp: new Date(nowMs).toISOString(),
  };
}
