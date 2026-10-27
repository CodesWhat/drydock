import { HttpResponse, http } from 'msw';
import { containers } from '../data/containers';
import { buildStatsSnapshot } from './containers';

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildSummary() {
  const rows = containers
    .filter((container) => container.status === 'running')
    .map((container) => {
      const snapshot = buildStatsSnapshot(container.id, 0);
      return {
        id: container.id,
        name: container.name,
        cpuPercent: snapshot.cpuPercent,
        memoryUsageBytes: snapshot.memoryUsageBytes,
        memoryLimitBytes: snapshot.memoryLimitBytes,
        memoryPercent: snapshot.memoryPercent,
      };
    });
  const totalMemoryUsageBytes = rows.reduce((sum, row) => sum + row.memoryUsageBytes, 0);
  const totalMemoryLimitBytes = rows.reduce((sum, row) => sum + row.memoryLimitBytes, 0);
  return {
    timestamp: new Date().toISOString(),
    watchedCount: rows.length,
    avgCpuPercent: rows.length
      ? round(rows.reduce((sum, row) => sum + row.cpuPercent, 0) / rows.length)
      : 0,
    totalMemoryUsageBytes,
    totalMemoryLimitBytes,
    totalMemoryPercent: totalMemoryLimitBytes
      ? round((totalMemoryUsageBytes / totalMemoryLimitBytes) * 100)
      : 0,
    topCpu: [...rows].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 5),
    topMemory: [...rows].sort((a, b) => b.memoryUsageBytes - a.memoryUsageBytes).slice(0, 5),
  };
}

// The live /stats/summary/stream feed is served by FakeEventSource in the browser; only the
// snapshot endpoint needs an HTTP handler.
export const statsHandlers = [
  http.get('/api/v1/stats/summary', () => HttpResponse.json({ data: buildSummary() })),
];
