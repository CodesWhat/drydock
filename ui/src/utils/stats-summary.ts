import type { ContainerStatsSummaryItem } from '../services/stats';

export interface ResourceUsageRow {
  id: string;
  name: string;
  status: string | undefined;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
}

export interface ResourceUsageSummary {
  topCpu: ResourceUsageRow[];
  topMemory: ResourceUsageRow[];
  totalCpuPercent: number;
  totalMemoryPercent: number;
  totalMemoryUsageBytes: number;
  totalMemoryLimitBytes: number;
  watchedContainers: number;
}

function toFiniteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function roundMetric(value: number): number {
  return Number.parseFloat(value.toFixed(2));
}

function normalizeUsageRow(item: ContainerStatsSummaryItem): ResourceUsageRow | undefined {
  if (!item.stats) {
    return undefined;
  }

  return {
    id: item.id,
    name: item.name,
    status: item.status,
    cpuPercent: toFiniteNumber(item.stats.cpuPercent),
    memoryPercent: toFiniteNumber(item.stats.memoryPercent),
    memoryUsageBytes: toFiniteNumber(item.stats.memoryUsageBytes),
    memoryLimitBytes: toFiniteNumber(item.stats.memoryLimitBytes),
  };
}

function sortByMetric(
  rows: ResourceUsageRow[],
  metric: 'cpuPercent' | 'memoryPercent',
): ResourceUsageRow[] {
  return [...rows].sort((left, right) => {
    if (right[metric] !== left[metric]) {
      return right[metric] - left[metric];
    }
    return left.name.localeCompare(right.name);
  });
}

export function summarizeContainerResourceUsage(
  items: ContainerStatsSummaryItem[],
  limit = 5,
): ResourceUsageSummary {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const rows: ResourceUsageRow[] = [];

  for (const item of items) {
    const row = normalizeUsageRow(item);
    if (row) {
      rows.push(row);
    }
  }

  const totalMemoryUsageBytes = rows.reduce((sum, row) => sum + row.memoryUsageBytes, 0);
  const totalMemoryLimitBytes = rows.reduce((sum, row) => sum + row.memoryLimitBytes, 0);
  const totalCpuRaw = rows.reduce((sum, row) => sum + row.cpuPercent, 0);

  const totalCpuPercent =
    rows.length > 0 ? roundMetric(Math.min(100, totalCpuRaw / rows.length)) : 0;
  const totalMemoryPercent =
    totalMemoryLimitBytes > 0
      ? roundMetric(Math.min(100, (totalMemoryUsageBytes / totalMemoryLimitBytes) * 100))
      : 0;

  return {
    topCpu: sortByMetric(rows, 'cpuPercent').slice(0, normalizedLimit),
    topMemory: sortByMetric(rows, 'memoryPercent').slice(0, normalizedLimit),
    totalCpuPercent,
    totalMemoryPercent,
    totalMemoryUsageBytes,
    totalMemoryLimitBytes,
    watchedContainers: rows.length,
  };
}
