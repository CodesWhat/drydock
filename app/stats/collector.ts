import logger from '../log/index.js';
import type { Container } from '../model/container.js';
import { getErrorMessage } from '../util/error.js';
import {
  type ContainerStatsSnapshot,
  calculateContainerStatsSnapshot,
  type DockerContainerStats,
} from './calculation.js';
import { getStatsHistorySize, getStatsIntervalSeconds } from './config.js';
import { RingBuffer } from './ring-buffer.js';

const log = logger.child({ component: 'stats.collector' });
const MIN_REST_TOUCH_TTL_MS = 15_000;
const REST_TOUCH_TTL_MULTIPLIER = 3;

interface DockerStatsStream {
  on: (event: string, listener: (payload?: unknown) => void) => unknown;
  destroy?: () => void;
}

interface DockerStatsContainerApi {
  stats: (options: { stream: true }) => Promise<DockerStatsStream> | DockerStatsStream;
}

interface DockerStatsWatcherApi {
  dockerApi?: {
    getContainer: (containerName: string) => DockerStatsContainerApi;
  };
}

type StatsListener = (snapshot: ContainerStatsSnapshot) => void;

interface ContainerCollectionState {
  watchCount: number;
  stream?: DockerStatsStream;
  startPromise?: Promise<void>;
  restTouchRelease?: () => void;
  restTouchTimeout?: ReturnType<typeof globalThis.setTimeout>;
  lastSampleAtMs?: number;
  previousStats?: DockerContainerStats;
  latest?: ContainerStatsSnapshot;
  history: RingBuffer<ContainerStatsSnapshot>;
  listeners: Set<StatsListener>;
}

export interface ContainerStatsCollectorDependencies {
  getContainerById: (id: string) => Container | undefined;
  getWatchers: () => Record<string, unknown>;
  intervalSeconds?: number;
  historySize?: number;
  now?: () => number;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}

export interface ContainerStatsCollector {
  watch: (containerId: string) => () => void;
  touch: (containerId: string) => void;
  subscribe: (containerId: string, listener: StatsListener) => () => void;
  getLatest: (containerId: string) => ContainerStatsSnapshot | undefined;
  getHistory: (containerId: string) => ContainerStatsSnapshot[];
}

function isDockerStatsWatcherApi(watcher: unknown): watcher is DockerStatsWatcherApi {
  if (!watcher || typeof watcher !== 'object') {
    return false;
  }
  const dockerApi = (watcher as DockerStatsWatcherApi).dockerApi;
  return !!dockerApi && typeof dockerApi.getContainer === 'function';
}

function parseStatsChunk(chunk: unknown): DockerContainerStats[] {
  if (!chunk) {
    return [];
  }
  if (typeof chunk === 'object' && !Buffer.isBuffer(chunk)) {
    return [chunk as DockerContainerStats];
  }

  const rawChunk = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  const payloads: DockerContainerStats[] = [];

  for (const line of rawChunk.split('\n')) {
    const candidate = line.trim();
    if (!candidate) {
      continue;
    }
    try {
      payloads.push(JSON.parse(candidate) as DockerContainerStats);
    } catch {
      // Ignore malformed stream chunk slices. Later chunks will often include a complete JSON object.
    }
  }

  return payloads;
}

export function createContainerStatsCollector(
  dependencies: ContainerStatsCollectorDependencies,
): ContainerStatsCollector {
  const intervalMs = Math.max(1, dependencies.intervalSeconds ?? getStatsIntervalSeconds()) * 1000;
  const historySize = Math.max(1, dependencies.historySize ?? getStatsHistorySize());
  const now = dependencies.now ?? (() => Date.now());
  const setTimeoutFn = dependencies.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = dependencies.clearTimeoutFn ?? globalThis.clearTimeout;
  const restTouchTtlMs = Math.max(MIN_REST_TOUCH_TTL_MS, intervalMs * REST_TOUCH_TTL_MULTIPLIER);
  const states = new Map<string, ContainerCollectionState>();

  function getOrCreateState(containerId: string): ContainerCollectionState {
    const existingState = states.get(containerId);
    if (existingState) {
      return existingState;
    }
    const nextState: ContainerCollectionState = {
      watchCount: 0,
      history: new RingBuffer<ContainerStatsSnapshot>(historySize),
      listeners: new Set<StatsListener>(),
    };
    states.set(containerId, nextState);
    return nextState;
  }

  function stopCollection(state: ContainerCollectionState): void {
    state.stream?.destroy?.();
    state.stream = undefined;
  }

  function emitSnapshot(state: ContainerCollectionState, snapshot: ContainerStatsSnapshot): void {
    state.latest = snapshot;
    state.history.push(snapshot);
    for (const listener of state.listeners) {
      listener(snapshot);
    }
  }

  function handleStatsChunk(
    containerId: string,
    state: ContainerCollectionState,
    chunk: unknown,
  ): void {
    for (const payload of parseStatsChunk(chunk)) {
      const nowMs = now();
      if (state.lastSampleAtMs !== undefined && nowMs - state.lastSampleAtMs < intervalMs) {
        continue;
      }
      const snapshot = calculateContainerStatsSnapshot(
        containerId,
        payload,
        state.previousStats,
        nowMs,
      );
      state.previousStats = payload;
      state.lastSampleAtMs = nowMs;
      emitSnapshot(state, snapshot);
    }
  }

  async function startCollection(
    containerId: string,
    state: ContainerCollectionState,
  ): Promise<void> {
    if (state.stream || state.startPromise || state.watchCount <= 0) {
      return;
    }

    state.startPromise = (async () => {
      const container = dependencies.getContainerById(containerId);
      if (!container) {
        return;
      }

      const watcherId = `docker.${container.watcher}`;
      const watcher = dependencies.getWatchers()[watcherId];
      if (!isDockerStatsWatcherApi(watcher)) {
        return;
      }

      try {
        const streamOrPromise = watcher.dockerApi?.getContainer(container.name).stats({
          stream: true,
        });
        const stream = await Promise.resolve(streamOrPromise);
        if (!stream || typeof stream.on !== 'function') {
          return;
        }

        state.stream = stream;

        stream.on('data', (chunk: unknown) => {
          handleStatsChunk(containerId, state, chunk);
        });
        stream.on('error', (error: unknown) => {
          log.warn(`Docker stats stream error for ${containerId} (${getErrorMessage(error)})`);
          state.stream = undefined;
          void startCollection(containerId, state);
        });
        stream.on('close', () => {
          state.stream = undefined;
          void startCollection(containerId, state);
        });
        stream.on('end', () => {
          state.stream = undefined;
          void startCollection(containerId, state);
        });
      } catch (error: unknown) {
        log.warn(
          `Failed to start Docker stats stream for ${containerId} (${getErrorMessage(error)})`,
        );
      }
    })();

    try {
      await state.startPromise;
    } finally {
      state.startPromise = undefined;
    }
  }

  function watch(containerId: string): () => void {
    const state = getOrCreateState(containerId);
    state.watchCount += 1;
    void startCollection(containerId, state);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      state.watchCount = Math.max(0, state.watchCount - 1);
      if (state.watchCount === 0) {
        stopCollection(state);
      }
    };
  }

  function touch(containerId: string): void {
    const state = getOrCreateState(containerId);
    if (!state.restTouchRelease) {
      state.restTouchRelease = watch(containerId);
    }
    if (state.restTouchTimeout) {
      clearTimeoutFn(state.restTouchTimeout);
    }
    state.restTouchTimeout = setTimeoutFn(() => {
      state.restTouchTimeout = undefined;
      const releaseRestTouch = state.restTouchRelease;
      state.restTouchRelease = undefined;
      releaseRestTouch?.();
    }, restTouchTtlMs);
  }

  function subscribe(containerId: string, listener: StatsListener): () => void {
    const state = getOrCreateState(containerId);
    state.listeners.add(listener);

    return () => {
      state.listeners.delete(listener);
    };
  }

  function getLatest(containerId: string): ContainerStatsSnapshot | undefined {
    return states.get(containerId)?.latest;
  }

  function getHistory(containerId: string): ContainerStatsSnapshot[] {
    return states.get(containerId)?.history.toArray() ?? [];
  }

  return {
    watch,
    touch,
    subscribe,
    getLatest,
    getHistory,
  };
}
