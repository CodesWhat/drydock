<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ContainerStatsSnapshot, ContainerStatsStreamController } from '../../services/stats';
import { connectContainerStatsStream, getContainerStats } from '../../services/stats';
import { buildSparklinePoints } from '../../utils/stats-sparkline';
import { getUsageThresholdColor } from '../../utils/stats-thresholds';
import { errorMessage } from '../../utils/error';

const SPARKLINE_WIDTH = 160;
const SPARKLINE_HEIGHT = 34;

const props = withDefaults(
  defineProps<{
    containerId: string;
    compact?: boolean;
  }>(),
  {
    compact: false,
  },
);

const loading = ref(false);
const loadError = ref<string | null>(null);
const streamPaused = ref(false);
const snapshots = ref<ContainerStatsSnapshot[]>([]);
const lastHeartbeatAt = ref<string | null>(null);

let streamController: ContainerStatsStreamController | undefined;
let loadRequestId = 0;

function parseTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toFiniteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, toFiniteNumber(value)));
}

function appendSnapshot(snapshot: ContainerStatsSnapshot): void {
  snapshots.value = [...snapshots.value, snapshot];
}

function replaceSnapshotHistory(
  history: ContainerStatsSnapshot[],
  latest: ContainerStatsSnapshot | null,
) {
  const nextHistory = [...history];
  if (latest) {
    const hasLatest = history.some((entry) => entry.timestamp === latest.timestamp);
    if (!hasLatest) {
      nextHistory.push(latest);
    }
  }
  nextHistory.sort(
    (left, right) => parseTimestamp(left.timestamp) - parseTimestamp(right.timestamp),
  );
  snapshots.value = nextHistory;
}

function stopStream() {
  streamController?.disconnect();
  streamController = undefined;
}

function connectStream() {
  stopStream();
  streamController = connectContainerStatsStream(
    props.containerId,
    {
      onSnapshot: (snapshot) => {
        appendSnapshot(snapshot);
      },
      onHeartbeat: () => {
        lastHeartbeatAt.value = new Date().toISOString();
      },
    },
    {
      reconnectDelayMs: 2000,
    },
  );
  streamPaused.value = false;
}

async function loadStats() {
  const requestId = ++loadRequestId;
  loading.value = true;
  loadError.value = null;
  lastHeartbeatAt.value = null;
  try {
    const response = await getContainerStats(props.containerId);
    if (requestId !== loadRequestId) {
      return;
    }
    replaceSnapshotHistory(response.history, response.data);
    connectStream();
  } catch (error: unknown) {
    if (requestId !== loadRequestId) {
      return;
    }
    loadError.value = errorMessage(error, 'Failed to load container stats');
    stopStream();
  } finally {
    if (requestId === loadRequestId) {
      loading.value = false;
    }
  }
}

function toggleStream() {
  if (!streamController) {
    return;
  }
  if (streamPaused.value) {
    streamController.resume();
    streamPaused.value = false;
    return;
  }
  streamController.pause();
  streamPaused.value = true;
}

function buildRateHistory(
  history: ContainerStatsSnapshot[],
  getter: (snapshot: ContainerStatsSnapshot) => number,
): number[] {
  if (history.length === 0) {
    return [];
  }
  if (history.length === 1) {
    return [0];
  }

  const rates = [0];
  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    const deltaTimeMs = parseTimestamp(current.timestamp) - parseTimestamp(previous.timestamp);
    if (deltaTimeMs <= 0) {
      rates.push(0);
      continue;
    }
    const deltaBytes = toFiniteNumber(getter(current)) - toFiniteNumber(getter(previous));
    rates.push(Math.max(0, deltaBytes / (deltaTimeMs / 1000)));
  }
  return rates;
}

function getCurrentValue(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return toFiniteNumber(values[values.length - 1]);
}

function normalizeMeterPercent(currentValue: number, values: number[]): number {
  const maxValue = Math.max(1, ...values.map((entry) => toFiniteNumber(entry)));
  return clampPercent((toFiniteNumber(currentValue) / maxValue) * 100);
}

function formatPercent(value: number): string {
  return `${toFiniteNumber(value).toFixed(1)}%`;
}

function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let nextValue = Math.max(0, toFiniteNumber(value));
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${nextValue.toFixed(precision)} ${units[unitIndex]}`;
}

function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

const latestSnapshot = computed<ContainerStatsSnapshot | null>(() => {
  if (snapshots.value.length === 0) {
    return null;
  }
  return snapshots.value[snapshots.value.length - 1];
});

const cpuHistory = computed(() => snapshots.value.map((snapshot) => snapshot.cpuPercent));
const memoryHistory = computed(() => snapshots.value.map((snapshot) => snapshot.memoryPercent));
const networkRxRateHistory = computed(() =>
  buildRateHistory(snapshots.value, (snapshot) => snapshot.networkRxBytes),
);
const networkTxRateHistory = computed(() =>
  buildRateHistory(snapshots.value, (snapshot) => snapshot.networkTxBytes),
);
const blockReadRateHistory = computed(() =>
  buildRateHistory(snapshots.value, (snapshot) => snapshot.blockReadBytes),
);
const blockWriteRateHistory = computed(() =>
  buildRateHistory(snapshots.value, (snapshot) => snapshot.blockWriteBytes),
);
const networkCombinedRateHistory = computed(() =>
  networkRxRateHistory.value.map(
    (value, index) => value + (networkTxRateHistory.value[index] ?? 0),
  ),
);
const blockCombinedRateHistory = computed(() =>
  blockReadRateHistory.value.map(
    (value, index) => value + (blockWriteRateHistory.value[index] ?? 0),
  ),
);

const currentCpuPercent = computed(() => clampPercent(latestSnapshot.value?.cpuPercent ?? 0));
const currentMemoryPercent = computed(() => clampPercent(latestSnapshot.value?.memoryPercent ?? 0));
const currentMemoryUsageBytes = computed(() => latestSnapshot.value?.memoryUsageBytes ?? 0);
const currentMemoryLimitBytes = computed(() => latestSnapshot.value?.memoryLimitBytes ?? 0);
const currentNetworkRxRate = computed(() => getCurrentValue(networkRxRateHistory.value));
const currentNetworkTxRate = computed(() => getCurrentValue(networkTxRateHistory.value));
const currentBlockReadRate = computed(() => getCurrentValue(blockReadRateHistory.value));
const currentBlockWriteRate = computed(() => getCurrentValue(blockWriteRateHistory.value));

const currentNetworkMeterPercent = computed(() =>
  normalizeMeterPercent(
    currentNetworkRxRate.value + currentNetworkTxRate.value,
    networkCombinedRateHistory.value,
  ),
);
const currentBlockMeterPercent = computed(() =>
  normalizeMeterPercent(
    currentBlockReadRate.value + currentBlockWriteRate.value,
    blockCombinedRateHistory.value,
  ),
);

const cpuSparklinePoints = computed(() =>
  buildSparklinePoints(cpuHistory.value, SPARKLINE_WIDTH, SPARKLINE_HEIGHT),
);
const memorySparklinePoints = computed(() =>
  buildSparklinePoints(memoryHistory.value, SPARKLINE_WIDTH, SPARKLINE_HEIGHT),
);
const networkSparklinePoints = computed(() =>
  buildSparklinePoints(networkCombinedRateHistory.value, SPARKLINE_WIDTH, SPARKLINE_HEIGHT),
);
const blockSparklinePoints = computed(() =>
  buildSparklinePoints(blockCombinedRateHistory.value, SPARKLINE_WIDTH, SPARKLINE_HEIGHT),
);

watch(
  () => props.containerId,
  () => {
    void loadStats();
  },
);

onMounted(() => {
  void loadStats();
});

onUnmounted(() => {
  stopStream();
});
</script>

<template>
  <div class="space-y-4" data-test="container-stats">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <div
          class="h-2.5 w-2.5 rounded-full"
          :style="{ backgroundColor: streamPaused ? 'var(--dd-warning)' : 'var(--dd-success)' }" />
        <span class="text-[0.6875rem] font-semibold dd-text-secondary">
          {{ streamPaused ? 'Paused' : 'Live' }}
        </span>
        <span v-if="lastHeartbeatAt" class="text-[0.625rem] dd-text-muted">
          heartbeat active
        </span>
      </div>

      <button
        type="button"
        class="px-2.5 py-1 text-[0.625rem] font-semibold dd-rounded transition-colors hover:opacity-90"
        :style="{
          backgroundColor: streamPaused ? 'var(--dd-success-muted)' : 'var(--dd-warning-muted)',
          color: streamPaused ? 'var(--dd-success)' : 'var(--dd-warning)',
        }"
        data-test="stats-toggle-stream"
        @click="toggleStream">
        {{ streamPaused ? 'Resume' : 'Pause' }}
      </button>
    </div>

    <div
      v-if="loading"
      class="p-3 text-[0.6875rem] dd-rounded dd-text-muted"
      :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
      Loading container stats...
    </div>

    <div
      v-else-if="loadError"
      class="p-3 text-[0.6875rem] dd-rounded"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ loadError }}
    </div>

    <div v-else-if="!latestSnapshot" class="p-3 text-[0.6875rem] dd-rounded dd-text-muted" :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
      Stats stream has not produced data yet.
    </div>

    <div v-else :class="props.compact ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 xl:grid-cols-2 gap-3'">
      <article class="p-3 dd-rounded space-y-2" :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
        <div class="flex items-center justify-between gap-3">
          <span class="text-[0.625rem] font-semibold uppercase tracking-wider dd-text-muted">CPU</span>
          <span class="text-sm font-semibold dd-text" data-test="metric-cpu-value">
            {{ formatPercent(currentCpuPercent) }}
          </span>
        </div>
        <div class="h-2 dd-rounded overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
          <div
            class="h-full dd-rounded transition-[width,color,background-color]"
            :style="{
              width: `${currentCpuPercent}%`,
              backgroundColor: getUsageThresholdColor(currentCpuPercent),
            }" />
        </div>
        <svg :viewBox="`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`" class="h-8 w-full">
          <polyline
            data-test="sparkline-cpu"
            fill="none"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :stroke="getUsageThresholdColor(currentCpuPercent)"
            :points="cpuSparklinePoints" />
        </svg>
      </article>

      <article class="p-3 dd-rounded space-y-2" :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
        <div class="flex items-center justify-between gap-3">
          <span class="text-[0.625rem] font-semibold uppercase tracking-wider dd-text-muted">Memory</span>
          <span class="text-sm font-semibold dd-text" data-test="metric-memory-value">
            {{ formatPercent(currentMemoryPercent) }}
          </span>
        </div>
        <div class="text-[0.625rem] dd-text-secondary">
          {{ formatBytes(currentMemoryUsageBytes) }} / {{ formatBytes(currentMemoryLimitBytes) }}
        </div>
        <div class="h-2 dd-rounded overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
          <div
            class="h-full dd-rounded transition-[width,color,background-color]"
            :style="{
              width: `${currentMemoryPercent}%`,
              backgroundColor: getUsageThresholdColor(currentMemoryPercent),
            }" />
        </div>
        <svg :viewBox="`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`" class="h-8 w-full">
          <polyline
            data-test="sparkline-memory"
            fill="none"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :stroke="getUsageThresholdColor(currentMemoryPercent)"
            :points="memorySparklinePoints" />
        </svg>
      </article>

      <article class="p-3 dd-rounded space-y-2" :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
        <div class="flex items-center justify-between gap-3">
          <span class="text-[0.625rem] font-semibold uppercase tracking-wider dd-text-muted">Network RX/TX</span>
          <span class="text-[0.6875rem] font-semibold dd-text">
            {{ formatRate(currentNetworkRxRate) }} / {{ formatRate(currentNetworkTxRate) }}
          </span>
        </div>
        <div class="h-2 dd-rounded overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
          <div
            class="h-full dd-rounded transition-[width,color,background-color]"
            :style="{
              width: `${currentNetworkMeterPercent}%`,
              backgroundColor: getUsageThresholdColor(currentNetworkMeterPercent),
            }" />
        </div>
        <svg :viewBox="`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`" class="h-8 w-full">
          <polyline
            data-test="sparkline-network"
            fill="none"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :stroke="getUsageThresholdColor(currentNetworkMeterPercent)"
            :points="networkSparklinePoints" />
        </svg>
      </article>

      <article class="p-3 dd-rounded space-y-2" :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
        <div class="flex items-center justify-between gap-3">
          <span class="text-[0.625rem] font-semibold uppercase tracking-wider dd-text-muted">Block I/O</span>
          <span class="text-[0.6875rem] font-semibold dd-text">
            {{ formatRate(currentBlockReadRate) }} / {{ formatRate(currentBlockWriteRate) }}
          </span>
        </div>
        <div class="h-2 dd-rounded overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
          <div
            class="h-full dd-rounded transition-[width,color,background-color]"
            :style="{
              width: `${currentBlockMeterPercent}%`,
              backgroundColor: getUsageThresholdColor(currentBlockMeterPercent),
            }" />
        </div>
        <svg :viewBox="`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`" class="h-8 w-full">
          <polyline
            data-test="sparkline-block"
            fill="none"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :stroke="getUsageThresholdColor(currentBlockMeterPercent)"
            :points="blockSparklinePoints" />
        </svg>
      </article>
    </div>
  </div>
</template>
