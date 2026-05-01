import { createManagedEventSource } from '@/stores/eventStream';
import { extractCollectionData } from '../utils/api';

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

interface ContainerStatsResponse {
  data: ContainerStatsSnapshot | null;
  history: ContainerStatsSnapshot[];
}

export interface ContainerStatsSummaryItem {
  id: string;
  name: string;
  status?: string;
  watcher?: string;
  agent?: string;
  stats: ContainerStatsSnapshot | null;
}

interface ContainerStatsStreamEventHandlers {
  onOpen?: () => void;
  onSnapshot?: (snapshot: ContainerStatsSnapshot) => void;
  onHeartbeat?: () => void;
  onError?: () => void;
}

interface ContainerStatsStreamOptions {
  reconnectDelayMs?: number;
}

export interface ContainerStatsStreamController {
  pause: () => void;
  resume: () => void;
  disconnect: () => void;
  isPaused: () => boolean;
}

const DEFAULT_RECONNECT_DELAY_MS = 3000;

interface StreamConnectionState {
  eventSource?: EventSource;
  reconnectTimer?: ReturnType<typeof globalThis.setTimeout>;
  paused: boolean;
  disconnected: boolean;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseSnapshot(rawSnapshot: unknown): ContainerStatsSnapshot | null {
  if (!rawSnapshot || typeof rawSnapshot !== 'object') {
    return null;
  }

  const snapshot = rawSnapshot as Record<string, unknown>;
  const containerId =
    typeof snapshot.containerId === 'string' && snapshot.containerId.length > 0
      ? snapshot.containerId
      : undefined;
  const timestamp =
    typeof snapshot.timestamp === 'string' && snapshot.timestamp.length > 0
      ? snapshot.timestamp
      : undefined;

  if (!containerId || !timestamp) {
    return null;
  }

  const numericFields = {
    cpuPercent: toFiniteNumber(snapshot.cpuPercent),
    memoryUsageBytes: toFiniteNumber(snapshot.memoryUsageBytes),
    memoryLimitBytes: toFiniteNumber(snapshot.memoryLimitBytes),
    memoryPercent: toFiniteNumber(snapshot.memoryPercent),
    networkRxBytes: toFiniteNumber(snapshot.networkRxBytes),
    networkTxBytes: toFiniteNumber(snapshot.networkTxBytes),
    blockReadBytes: toFiniteNumber(snapshot.blockReadBytes),
    blockWriteBytes: toFiniteNumber(snapshot.blockWriteBytes),
  };

  if (Object.values(numericFields).some((value) => value === undefined)) {
    return null;
  }

  const {
    cpuPercent,
    memoryUsageBytes,
    memoryLimitBytes,
    memoryPercent,
    networkRxBytes,
    networkTxBytes,
    blockReadBytes,
    blockWriteBytes,
  } = numericFields as Record<keyof typeof numericFields, number>;

  return {
    containerId,
    cpuPercent,
    memoryUsageBytes,
    memoryLimitBytes,
    memoryPercent,
    networkRxBytes,
    networkTxBytes,
    blockReadBytes,
    blockWriteBytes,
    timestamp,
  };
}

function parseHistory(rawHistory: unknown): ContainerStatsSnapshot[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  const snapshots: ContainerStatsSnapshot[] = [];
  for (const rawSnapshot of rawHistory) {
    const snapshot = parseSnapshot(rawSnapshot);
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }

  return snapshots;
}

function parseSummaryItem(rawItem: unknown): ContainerStatsSummaryItem | null {
  if (!rawItem || typeof rawItem !== 'object') {
    return null;
  }

  const item = rawItem as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.name !== 'string') {
    return null;
  }

  const status = typeof item.status === 'string' ? item.status : undefined;
  const watcher = typeof item.watcher === 'string' ? item.watcher : undefined;
  const agent = typeof item.agent === 'string' ? item.agent : undefined;
  const stats = item.stats === null ? null : parseSnapshot(item.stats);

  return {
    id: item.id,
    name: item.name,
    status,
    watcher,
    agent,
    stats,
  };
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json();
}

export async function getContainerStats(containerId: string): Promise<ContainerStatsResponse> {
  const response = await fetch(`/api/v1/containers/${encodeURIComponent(containerId)}/stats`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get container stats: ${response.statusText}`);
  }

  const payload = await parseJson(response);
  const envelope =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const data = envelope.data === null ? null : parseSnapshot(envelope.data);

  return {
    data,
    history: parseHistory(envelope.history),
  };
}

export interface GetAllContainerStatsOptions {
  // When false, the server returns cached snapshots without starting a Docker
  // stats stream per container. Dashboard summary reads use this to avoid
  // spawning per-container streams on every refresh. See #301.
  touch?: boolean;
}

export async function getAllContainerStats(
  options: GetAllContainerStatsOptions = {},
): Promise<ContainerStatsSummaryItem[]> {
  const url =
    options.touch === false ? '/api/v1/containers/stats?touch=false' : '/api/v1/containers/stats';
  const response = await fetch(url, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get container stats: ${response.statusText}`);
  }

  const payload = await parseJson(response);
  const summaryItems: ContainerStatsSummaryItem[] = [];
  for (const rawItem of extractCollectionData(payload)) {
    const item = parseSummaryItem(rawItem);
    if (item) {
      summaryItems.push(item);
    }
  }

  return summaryItems;
}

function parseSnapshotEvent(rawData: unknown): ContainerStatsSnapshot | null {
  if (typeof rawData !== 'string') {
    return null;
  }

  try {
    return parseSnapshot(JSON.parse(rawData));
  } catch {
    return null;
  }
}

function clearReconnectTimer(state: StreamConnectionState): void {
  if (state.reconnectTimer) {
    globalThis.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = undefined;
  }
}

function closeSource(state: StreamConnectionState): void {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = undefined;
  }
}

function createEventSource(
  streamUrl: string,
  handlers: ContainerStatsStreamEventHandlers,
  onError: () => void,
): EventSource {
  const source = createManagedEventSource(streamUrl);
  source.addEventListener('open', () => {
    handlers.onOpen?.();
  });
  source.addEventListener('dd:heartbeat', () => {
    handlers.onHeartbeat?.();
  });
  source.addEventListener('dd:container-stats', (event: Event) => {
    const messageEvent = event as MessageEvent;
    const snapshot = parseSnapshotEvent(messageEvent.data);
    if (snapshot) {
      handlers.onSnapshot?.(snapshot);
    }
  });
  source.onerror = onError;
  return source;
}

function scheduleReconnect(
  state: StreamConnectionState,
  reconnectDelayMs: number,
  reconnect: () => void,
): void {
  clearReconnectTimer(state);
  state.reconnectTimer = globalThis.setTimeout(() => {
    state.reconnectTimer = undefined;
    reconnect();
  }, reconnectDelayMs);
}

export interface ContainerStatsSummaryRowSnapshot {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
}

export interface ContainerStatsSummarySnapshot {
  timestamp: string;
  watchedCount: number;
  totalCpuPercent: number;
  totalMemoryUsageBytes: number;
  totalMemoryLimitBytes: number;
  totalMemoryPercent: number;
  topCpu: ContainerStatsSummaryRowSnapshot[];
  topMemory: ContainerStatsSummaryRowSnapshot[];
}

interface StatsSummaryStreamHandlers {
  onOpen?: () => void;
  onSummary?: (s: ContainerStatsSummarySnapshot) => void;
  onHeartbeat?: () => void;
  onError?: () => void;
}

interface StatsSummaryStreamOptions {
  reconnectDelayMs?: number;
}

export interface StatsSummaryStreamController {
  pause(): void;
  resume(): void;
  disconnect(): void;
  isPaused(): boolean;
}

function parseSummaryRow(rawRow: unknown): ContainerStatsSummaryRowSnapshot | null {
  if (!rawRow || typeof rawRow !== 'object') {
    return null;
  }

  const row = rawRow as Record<string, unknown>;
  const id = typeof row.id === 'string' && row.id.length > 0 ? row.id : undefined;
  const name = typeof row.name === 'string' && row.name.length > 0 ? row.name : undefined;

  if (!id || !name) {
    return null;
  }

  const numericFields = {
    cpuPercent: toFiniteNumber(row.cpuPercent),
    memoryUsageBytes: toFiniteNumber(row.memoryUsageBytes),
    memoryLimitBytes: toFiniteNumber(row.memoryLimitBytes),
    memoryPercent: toFiniteNumber(row.memoryPercent),
  };

  if (Object.values(numericFields).some((value) => value === undefined)) {
    return null;
  }

  const { cpuPercent, memoryUsageBytes, memoryLimitBytes, memoryPercent } = numericFields as Record<
    keyof typeof numericFields,
    number
  >;

  return { id, name, cpuPercent, memoryUsageBytes, memoryLimitBytes, memoryPercent };
}

function parseSummaryRowArray(raw: unknown): ContainerStatsSummaryRowSnapshot[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: ContainerStatsSummaryRowSnapshot[] = [];
  for (const rawRow of raw) {
    const row = parseSummaryRow(rawRow);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

function parseSummarySnapshot(raw: unknown): ContainerStatsSummarySnapshot | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const timestamp =
    typeof obj.timestamp === 'string' && obj.timestamp.length > 0 ? obj.timestamp : undefined;

  if (!timestamp) {
    return null;
  }

  const numericFields = {
    watchedCount: toFiniteNumber(obj.watchedCount),
    totalCpuPercent: toFiniteNumber(obj.totalCpuPercent),
    totalMemoryUsageBytes: toFiniteNumber(obj.totalMemoryUsageBytes),
    totalMemoryLimitBytes: toFiniteNumber(obj.totalMemoryLimitBytes),
    totalMemoryPercent: toFiniteNumber(obj.totalMemoryPercent),
  };

  if (Object.values(numericFields).some((value) => value === undefined)) {
    return null;
  }

  const {
    watchedCount,
    totalCpuPercent,
    totalMemoryUsageBytes,
    totalMemoryLimitBytes,
    totalMemoryPercent,
  } = numericFields as Record<keyof typeof numericFields, number>;

  return {
    timestamp,
    watchedCount,
    totalCpuPercent,
    totalMemoryUsageBytes,
    totalMemoryLimitBytes,
    totalMemoryPercent,
    topCpu: parseSummaryRowArray(obj.topCpu),
    topMemory: parseSummaryRowArray(obj.topMemory),
  };
}

function parseSummarySnapshotEvent(rawData: unknown): ContainerStatsSummarySnapshot | null {
  if (typeof rawData !== 'string') {
    return null;
  }
  try {
    return parseSummarySnapshot(JSON.parse(rawData));
  } catch {
    return null;
  }
}

export async function getStatsSummary(): Promise<ContainerStatsSummarySnapshot> {
  const response = await fetch('/api/v1/stats/summary', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get stats summary: ${response.statusText}`);
  }

  const payload = await parseJson(response);
  const envelope =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const snapshot = parseSummarySnapshot(envelope.data);
  if (!snapshot) {
    throw new Error('Failed to get stats summary: invalid response');
  }
  return snapshot;
}

function createSummaryEventSource(
  streamUrl: string,
  handlers: StatsSummaryStreamHandlers,
  onError: () => void,
): EventSource {
  const source = createManagedEventSource(streamUrl);
  source.addEventListener('open', () => {
    handlers.onOpen?.();
  });
  source.addEventListener('dd:heartbeat', () => {
    handlers.onHeartbeat?.();
  });
  source.addEventListener('dd:stats-summary', (event: Event) => {
    const messageEvent = event as MessageEvent;
    const snapshot = parseSummarySnapshotEvent(messageEvent.data);
    if (snapshot) {
      handlers.onSummary?.(snapshot);
    }
  });
  source.onerror = onError;
  return source;
}

export function connectStatsSummaryStream(
  handlers: StatsSummaryStreamHandlers = {},
  options: StatsSummaryStreamOptions = {},
): StatsSummaryStreamController {
  const reconnectDelayMs = Math.max(1, options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS);
  const streamUrl = '/api/v1/stats/summary/stream';
  const state: StreamConnectionState = {
    paused: false,
    disconnected: false,
  };

  function handleError(): void {
    handlers.onError?.();
    if (state.paused || state.disconnected) {
      return;
    }

    closeSource(state);
    scheduleReconnect(state, reconnectDelayMs, connect);
  }

  function connect(): void {
    closeSource(state);
    state.eventSource = createSummaryEventSource(streamUrl, handlers, handleError);
  }

  connect();

  return {
    pause() {
      if (state.paused || state.disconnected) {
        return;
      }
      state.paused = true;
      clearReconnectTimer(state);
      closeSource(state);
    },
    resume() {
      if (!state.paused || state.disconnected) {
        return;
      }
      state.paused = false;
      connect();
    },
    disconnect() {
      if (state.disconnected) {
        return;
      }
      state.disconnected = true;
      state.paused = true;
      clearReconnectTimer(state);
      closeSource(state);
    },
    isPaused() {
      return state.paused;
    },
  };
}

export function connectContainerStatsStream(
  containerId: string,
  handlers: ContainerStatsStreamEventHandlers = {},
  options: ContainerStatsStreamOptions = {},
): ContainerStatsStreamController {
  const reconnectDelayMs = Math.max(1, options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS);
  const streamUrl = `/api/v1/containers/${encodeURIComponent(containerId)}/stats/stream`;
  const state: StreamConnectionState = {
    paused: false,
    disconnected: false,
  };

  function handleError(): void {
    handlers.onError?.();
    if (state.paused || state.disconnected) {
      return;
    }

    closeSource(state);
    scheduleReconnect(state, reconnectDelayMs, connect);
  }

  function connect(): void {
    closeSource(state);
    state.eventSource = createEventSource(streamUrl, handlers, handleError);
  }

  connect();

  return {
    pause() {
      if (state.paused || state.disconnected) {
        return;
      }
      state.paused = true;
      clearReconnectTimer(state);
      closeSource(state);
    },
    resume() {
      if (!state.paused || state.disconnected) {
        return;
      }
      state.paused = false;
      connect();
    },
    disconnect() {
      if (state.disconnected) {
        return;
      }
      state.disconnected = true;
      state.paused = true;
      clearReconnectTimer(state);
      closeSource(state);
    },
    isPaused() {
      return state.paused;
    },
  };
}
