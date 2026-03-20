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
  removeAllListeners?: () => void;
  destroy?: () => void;
}

interface DockerStatsContainerApi {
  stats: (options: { stream: true }) => Promise<DockerStatsStream> | DockerStatsStream;
}

interface DockerStatsWatcherApi {
  dockerApi: {
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

interface ContainerStatsCollectorDependencies {
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

interface CollectorRuntime {
  dependencies: ContainerStatsCollectorDependencies;
  intervalMs: number;
  historySize: number;
  now: () => number;
  setTimeoutFn: typeof globalThis.setTimeout;
  clearTimeoutFn: typeof globalThis.clearTimeout;
  restTouchTtlMs: number;
  states: Map<string, ContainerCollectionState>;
}

interface ResolvedStatsTarget {
  containerName: string;
  watcher: DockerStatsWatcherApi;
}

function isDockerStatsWatcherApi(watcher: unknown): watcher is DockerStatsWatcherApi {
  if (!watcher || typeof watcher !== 'object') {
    return false;
  }
  const dockerApi = (watcher as DockerStatsWatcherApi).dockerApi;
  return !!dockerApi && typeof dockerApi.getContainer === 'function';
}

function isDockerStatsStream(stream: unknown): stream is DockerStatsStream {
  if (!stream || typeof stream !== 'object') {
    return false;
  }
  return typeof (stream as DockerStatsStream).on === 'function';
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

function createCollectorRuntime(
  dependencies: ContainerStatsCollectorDependencies,
): CollectorRuntime {
  const intervalMs = Math.max(1, dependencies.intervalSeconds ?? getStatsIntervalSeconds()) * 1000;
  const historySize = Math.max(1, dependencies.historySize ?? getStatsHistorySize());
  const now = dependencies.now ?? (() => Date.now());
  const setTimeoutFn = dependencies.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = dependencies.clearTimeoutFn ?? globalThis.clearTimeout;
  const restTouchTtlMs = Math.max(MIN_REST_TOUCH_TTL_MS, intervalMs * REST_TOUCH_TTL_MULTIPLIER);
  return {
    dependencies,
    intervalMs,
    historySize,
    now,
    setTimeoutFn,
    clearTimeoutFn,
    restTouchTtlMs,
    states: new Map<string, ContainerCollectionState>(),
  };
}

function createCollectionState(historySize: number): ContainerCollectionState {
  return {
    watchCount: 0,
    history: new RingBuffer<ContainerStatsSnapshot>(historySize),
    listeners: new Set<StatsListener>(),
  };
}

function getOrCreateState(
  runtime: CollectorRuntime,
  containerId: string,
): ContainerCollectionState {
  const existingState = runtime.states.get(containerId);
  if (existingState) {
    return existingState;
  }

  const nextState = createCollectionState(runtime.historySize);
  runtime.states.set(containerId, nextState);
  return nextState;
}

function stopCollection(state: ContainerCollectionState): void {
  detachStream(state);
}

function emitSnapshot(state: ContainerCollectionState, snapshot: ContainerStatsSnapshot): void {
  state.latest = snapshot;
  state.history.push(snapshot);
  for (const listener of state.listeners) {
    listener(snapshot);
  }
}

function processStatsPayload(
  runtime: CollectorRuntime,
  containerId: string,
  state: ContainerCollectionState,
  payload: DockerContainerStats,
): void {
  const nowMs = runtime.now();
  if (state.lastSampleAtMs !== undefined && nowMs - state.lastSampleAtMs < runtime.intervalMs) {
    return;
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

function handleStatsChunk(
  runtime: CollectorRuntime,
  containerId: string,
  state: ContainerCollectionState,
  chunk: unknown,
): void {
  for (const payload of parseStatsChunk(chunk)) {
    processStatsPayload(runtime, containerId, state, payload);
  }
}

function resolveStatsTarget(
  dependencies: ContainerStatsCollectorDependencies,
  containerId: string,
): ResolvedStatsTarget | undefined {
  const container = dependencies.getContainerById(containerId);
  if (!container) {
    return undefined;
  }

  const watcherId = `docker.${container.watcher}`;
  const watcher = dependencies.getWatchers()[watcherId];
  if (!isDockerStatsWatcherApi(watcher)) {
    return undefined;
  }

  return {
    containerName: container.name,
    watcher,
  };
}

function shouldStartCollection(state: ContainerCollectionState): boolean {
  return state.watchCount > 0 && !state.stream && !state.startPromise;
}

function detachStream(state: ContainerCollectionState): void {
  const { stream } = state;
  if (stream) {
    stream.removeAllListeners?.();
    stream.destroy?.();
    state.stream = undefined;
  }
}

function restartCollection(
  runtime: CollectorRuntime,
  containerId: string,
  state: ContainerCollectionState,
): void {
  detachStream(state);
  void startCollection(runtime, containerId, state);
}

function attachStreamListeners(
  runtime: CollectorRuntime,
  containerId: string,
  state: ContainerCollectionState,
  stream: DockerStatsStream,
): void {
  state.stream = stream;

  stream.on('data', (chunk: unknown) => {
    handleStatsChunk(runtime, containerId, state, chunk);
  });
  stream.on('error', (error: unknown) => {
    log.warn(`Docker stats stream error for ${containerId} (${getErrorMessage(error)})`);
    restartCollection(runtime, containerId, state);
  });
  stream.on('close', () => {
    restartCollection(runtime, containerId, state);
  });
  stream.on('end', () => {
    restartCollection(runtime, containerId, state);
  });
}

async function startStream(
  runtime: CollectorRuntime,
  containerId: string,
  state: ContainerCollectionState,
): Promise<void> {
  const target = resolveStatsTarget(runtime.dependencies, containerId);
  if (!target) {
    return;
  }

  try {
    const streamOrPromise = target.watcher.dockerApi.getContainer(target.containerName).stats({
      stream: true,
    });
    const stream = await Promise.resolve(streamOrPromise);
    if (!isDockerStatsStream(stream)) {
      return;
    }
    attachStreamListeners(runtime, containerId, state, stream);
  } catch (error: unknown) {
    log.warn(`Failed to start Docker stats stream for ${containerId} (${getErrorMessage(error)})`);
  }
}

async function startCollection(
  runtime: CollectorRuntime,
  containerId: string,
  state: ContainerCollectionState,
): Promise<void> {
  if (!shouldStartCollection(state)) {
    return;
  }

  state.startPromise = startStream(runtime, containerId, state);
  try {
    await state.startPromise;
  } finally {
    state.startPromise = undefined;
  }
}

function createWatchRelease(state: ContainerCollectionState): () => void {
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

function watchContainer(runtime: CollectorRuntime, containerId: string): () => void {
  const state = getOrCreateState(runtime, containerId);
  state.watchCount += 1;
  void startCollection(runtime, containerId, state);
  return createWatchRelease(state);
}

function touchContainer(runtime: CollectorRuntime, containerId: string): void {
  const state = getOrCreateState(runtime, containerId);
  if (!state.restTouchRelease) {
    state.restTouchRelease = watchContainer(runtime, containerId);
  }

  if (state.restTouchTimeout) {
    runtime.clearTimeoutFn(state.restTouchTimeout);
  }

  state.restTouchTimeout = runtime.setTimeoutFn(() => {
    state.restTouchTimeout = undefined;
    const releaseRestTouch = state.restTouchRelease;
    state.restTouchRelease = undefined;
    releaseRestTouch?.();
  }, runtime.restTouchTtlMs);
}

function subscribeToContainer(
  runtime: CollectorRuntime,
  containerId: string,
  listener: StatsListener,
): () => void {
  const state = getOrCreateState(runtime, containerId);
  state.listeners.add(listener);

  return () => {
    state.listeners.delete(listener);
  };
}

function getLatest(
  runtime: CollectorRuntime,
  containerId: string,
): ContainerStatsSnapshot | undefined {
  return runtime.states.get(containerId)?.latest;
}

function getHistory(runtime: CollectorRuntime, containerId: string): ContainerStatsSnapshot[] {
  return runtime.states.get(containerId)?.history.toArray() ?? [];
}

export function createContainerStatsCollector(
  dependencies: ContainerStatsCollectorDependencies,
): ContainerStatsCollector {
  const runtime = createCollectorRuntime(dependencies);

  return {
    watch: (containerId: string) => watchContainer(runtime, containerId),
    touch: (containerId: string) => touchContainer(runtime, containerId),
    subscribe: (containerId: string, listener: StatsListener) =>
      subscribeToContainer(runtime, containerId, listener),
    getLatest: (containerId: string) => getLatest(runtime, containerId),
    getHistory: (containerId: string) => getHistory(runtime, containerId),
  };
}
