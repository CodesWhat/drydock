import logger from '../log/index.js';
import type { Container } from '../model/container.js';
import type { DockerContainerStats } from './calculation.js';
import { calculateContainerStatsSnapshot } from './calculation.js';
import { getStatsIntervalSeconds } from './config.js';

const log = logger.child({ component: 'stats.aggregator' });

const DEFAULT_TOP_N = 5;

export interface ContainerStatsSummaryRow {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
}

export interface ContainerStatsSummary {
  timestamp: string;
  watchedCount: number;
  avgCpuPercent: number;
  totalMemoryUsageBytes: number;
  totalMemoryLimitBytes: number;
  totalMemoryPercent: number;
  topCpu: ContainerStatsSummaryRow[];
  topMemory: ContainerStatsSummaryRow[];
}

export type SummaryListener = (summary: ContainerStatsSummary) => void;

export interface ContainerStatsAggregator {
  start(): void;
  stop(): void;
  getCurrent(): ContainerStatsSummary;
  subscribe(listener: SummaryListener): () => void;
}

interface DockerStatsSingleContainerApi {
  stats: (options: { stream: false }) => Promise<DockerContainerStats>;
}

interface DockerStatsWatcherApi {
  dockerApi: {
    getContainer: (containerName: string) => DockerStatsSingleContainerApi;
  };
}

function isDockerStatsWatcherApi(watcher: unknown): watcher is DockerStatsWatcherApi {
  if (!watcher || typeof watcher !== 'object') {
    return false;
  }
  const dockerApi = (watcher as DockerStatsWatcherApi).dockerApi;
  return !!dockerApi && typeof dockerApi.getContainer === 'function';
}

export interface ContainerStatsAggregatorDependencies {
  getContainers: () => Container[];
  getWatchers: () => Record<string, unknown>;
  intervalSeconds?: number;
  topN?: number;
  now?: () => number;
  setIntervalFn?: typeof globalThis.setInterval;
  clearIntervalFn?: typeof globalThis.clearInterval;
  fetchSnapshot?: (
    watcher: DockerStatsWatcherApi,
    containerName: string,
  ) => Promise<DockerContainerStats | null>;
}

function emptyContainerStatsSummary(timestamp: string): ContainerStatsSummary {
  return {
    timestamp,
    watchedCount: 0,
    avgCpuPercent: 0,
    totalMemoryUsageBytes: 0,
    totalMemoryLimitBytes: 0,
    totalMemoryPercent: 0,
    topCpu: [],
    topMemory: [],
  };
}

function cap(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function defaultFetchSnapshot(
  watcher: DockerStatsWatcherApi,
  containerName: string,
): Promise<DockerContainerStats | null> {
  try {
    return await watcher.dockerApi.getContainer(containerName).stats({ stream: false });
  } catch {
    return null;
  }
}

interface AggregatorRuntime {
  getContainers: () => Container[];
  getWatchers: () => Record<string, unknown>;
  intervalMs: number;
  topN: number;
  now: () => number;
  setIntervalFn: typeof globalThis.setInterval;
  clearIntervalFn: typeof globalThis.clearInterval;
  fetchSnapshot: (
    watcher: DockerStatsWatcherApi,
    containerName: string,
  ) => Promise<DockerContainerStats | null>;
  previousPayloads: Map<string, DockerContainerStats>;
  current: ContainerStatsSummary;
  listeners: Set<SummaryListener>;
  timer?: ReturnType<typeof globalThis.setInterval>;
  stopped: boolean;
}

async function runTick(runtime: AggregatorRuntime): Promise<void> {
  const containers = runtime.getContainers();
  const watchers = runtime.getWatchers();

  const targets: Array<{ container: Container; watcher: DockerStatsWatcherApi }> = [];
  for (const container of containers) {
    const watcherId = `docker.${container.watcher}`;
    const watcher = watchers[watcherId];
    if (isDockerStatsWatcherApi(watcher)) {
      targets.push({ container, watcher });
    }
  }

  const results = await Promise.allSettled(
    targets.map(async ({ container, watcher }) => {
      const payload = await runtime.fetchSnapshot(watcher, container.name);
      if (payload === null) {
        return null;
      }
      if (runtime.stopped) {
        return null;
      }
      const previous = runtime.previousPayloads.get(container.id);
      const snapshot = calculateContainerStatsSnapshot(
        container.id,
        payload,
        previous,
        runtime.now(),
      );
      runtime.previousPayloads.set(container.id, payload);
      return { container, snapshot };
    }),
  );

  if (runtime.stopped) {
    return;
  }

  const rows: ContainerStatsSummaryRow[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== null) {
      const { container, snapshot } = result.value;
      rows.push({
        id: container.id,
        name: container.name,
        cpuPercent: snapshot.cpuPercent,
        memoryUsageBytes: snapshot.memoryUsageBytes,
        memoryLimitBytes: snapshot.memoryLimitBytes,
        memoryPercent: snapshot.memoryPercent,
      });
    }
  }

  const watchedCount = rows.length;
  const avgCpuPercent =
    watchedCount > 0
      ? cap(rows.reduce((sum, r) => sum + r.cpuPercent, 0) / watchedCount, 0, 100)
      : 0;
  const totalMemoryUsageBytes = rows.reduce((sum, r) => sum + r.memoryUsageBytes, 0);
  const totalMemoryLimitBytes = rows.reduce((sum, r) => sum + r.memoryLimitBytes, 0);
  const totalMemoryPercent =
    totalMemoryLimitBytes > 0
      ? cap((totalMemoryUsageBytes / totalMemoryLimitBytes) * 100, 0, 100)
      : 0;

  function sortDesc(
    a: ContainerStatsSummaryRow,
    b: ContainerStatsSummaryRow,
    key: 'cpuPercent' | 'memoryPercent',
  ): number {
    const diff = b[key] - a[key];
    if (diff !== 0) {
      return diff;
    }
    return a.name.localeCompare(b.name);
  }

  const topCpu = [...rows].sort((a, b) => sortDesc(a, b, 'cpuPercent')).slice(0, runtime.topN);
  const topMemory = [...rows]
    .sort((a, b) => sortDesc(a, b, 'memoryPercent'))
    .slice(0, runtime.topN);

  const summary: ContainerStatsSummary = {
    timestamp: new Date(runtime.now()).toISOString(),
    watchedCount,
    avgCpuPercent,
    totalMemoryUsageBytes,
    totalMemoryLimitBytes,
    totalMemoryPercent,
    topCpu,
    topMemory,
  };

  runtime.current = summary;

  for (const listener of runtime.listeners) {
    try {
      listener(summary);
    } catch (err: unknown) {
      log.warn({ err }, 'Stats aggregator listener threw');
    }
  }

  const currentIds = new Set(containers.map((c) => c.id));
  for (const id of runtime.previousPayloads.keys()) {
    if (!currentIds.has(id)) {
      runtime.previousPayloads.delete(id);
    }
  }
}

export function createContainerStatsAggregator(
  deps: ContainerStatsAggregatorDependencies,
): ContainerStatsAggregator {
  const now = deps.now ?? (() => Date.now());
  const runtime: AggregatorRuntime = {
    getContainers: deps.getContainers,
    getWatchers: deps.getWatchers,
    intervalMs: Math.max(1, deps.intervalSeconds ?? getStatsIntervalSeconds()) * 1000,
    topN: deps.topN ?? DEFAULT_TOP_N,
    now,
    setIntervalFn: deps.setIntervalFn ?? globalThis.setInterval,
    clearIntervalFn: deps.clearIntervalFn ?? globalThis.clearInterval,
    fetchSnapshot: deps.fetchSnapshot ?? defaultFetchSnapshot,
    previousPayloads: new Map(),
    current: emptyContainerStatsSummary(new Date(now()).toISOString()),
    listeners: new Set(),
    stopped: false,
  };

  return {
    start() {
      if (runtime.timer !== undefined) {
        return;
      }
      runtime.stopped = false;
      runtime.timer = runtime.setIntervalFn(() => {
        void runTick(runtime).catch((err: unknown) => {
          log.warn({ err }, 'Stats aggregator tick failed');
        });
      }, runtime.intervalMs);
    },

    stop() {
      if (runtime.timer !== undefined) {
        runtime.clearIntervalFn(runtime.timer);
        runtime.timer = undefined;
      }
      runtime.stopped = true;
      runtime.listeners.clear();
      runtime.previousPayloads.clear();
    },

    getCurrent() {
      return runtime.current;
    },

    subscribe(listener: SummaryListener) {
      runtime.listeners.add(listener);
      return () => {
        runtime.listeners.delete(listener);
      };
    },
  };
}
