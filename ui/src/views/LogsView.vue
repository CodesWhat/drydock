<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import ConfigLogsTab from '../components/config/ConfigLogsTab.vue';
import { useSystemLogStream } from '../composables/useSystemLogStream';
import { getLog, getLogEntries } from '../services/log';
import type { SystemLogEntry } from '../services/system-log-stream';
import type { AppLogEntry } from '../types/log-entry';
import { errorMessage } from '../utils/error';
import { toAppLogEntry } from '../utils/system-log-adapter';

interface ApiLogEntry {
  timestamp?: string | number;
  level?: string;
  component?: string;
  msg?: string;
  message?: string;
}

const streamingEnabled = ref(true);
const {
  entries: streamEntries,
  status: streamStatus,
  connect: streamConnect,
  disconnect: streamDisconnect,
  updateFilters: streamUpdateFilters,
  clear: streamClear,
} = useSystemLogStream();

const appLogLevel = ref('unknown');
const appLogEntries = ref<AppLogEntry[]>([]);
const appLogsLoading = ref(false);
const appLogsError = ref('');
const appLogLevelFilter = ref('all');
const appLogTail = ref(100);
const appLogComponent = ref('');

const isStreaming = computed(() => streamingEnabled.value && streamStatus.value === 'connected');

const streamAppEntries = computed<AppLogEntry[]>(() => {
  return streamEntries.value.map((entry, index) => toAppLogEntry(entry, index + 1));
});

const displayEntries = computed<AppLogEntry[]>(() => {
  if (streamingEnabled.value) {
    return streamAppEntries.value;
  }
  return appLogEntries.value;
});

function toTimestampMs(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function toSystemLogEntry(entry: ApiLogEntry): SystemLogEntry {
  return {
    timestamp: toTimestampMs(entry.timestamp),
    level: entry.level || 'info',
    component: entry.component || '-',
    msg: entry.msg || entry.message || '',
  };
}

function buildStreamQuery() {
  return {
    level: appLogLevelFilter.value !== 'all' ? appLogLevelFilter.value : undefined,
    component: appLogComponent.value.trim() || undefined,
    tail: appLogTail.value,
  };
}

function startStreaming() {
  streamConnect(buildStreamQuery());
}

async function refreshAppLogs() {
  if (streamingEnabled.value) {
    return;
  }
  appLogsLoading.value = true;
  appLogsError.value = '';
  try {
    const [logInfo, entries] = await Promise.all([
      getLog().catch(() => ({ level: 'unknown' })),
      getLogEntries({
        level: appLogLevelFilter.value,
        component: appLogComponent.value.trim() || undefined,
        tail: appLogTail.value,
      }),
    ]);

    appLogLevel.value = logInfo?.level ?? 'unknown';
    appLogEntries.value = Array.isArray(entries)
      ? entries.map((entry, index) =>
          toAppLogEntry(toSystemLogEntry(entry as ApiLogEntry), index + 1),
        )
      : [];
  } catch (e: unknown) {
    appLogsError.value = errorMessage(e, 'Failed to load application logs');
    appLogEntries.value = [];
  } finally {
    appLogsLoading.value = false;
  }
}

function applyFilters() {
  if (streamingEnabled.value) {
    streamUpdateFilters(buildStreamQuery());
  } else {
    void refreshAppLogs();
  }
}

function resetLogFilters() {
  appLogLevelFilter.value = 'all';
  appLogTail.value = 100;
  appLogComponent.value = '';
  applyFilters();
}

function toggleStreamingPause() {
  streamingEnabled.value = !streamingEnabled.value;
}

watch(streamingEnabled, (enabled) => {
  if (enabled) {
    startStreaming();
  } else {
    streamDisconnect();
    streamClear();
    void refreshAppLogs();
  }
});

onMounted(() => {
  void getLog()
    .then((logInfo) => {
      appLogLevel.value = logInfo?.level ?? 'unknown';
    })
    .catch(() => {
      appLogLevel.value = 'unknown';
    });
  if (streamingEnabled.value) {
    startStreaming();
  } else {
    void refreshAppLogs();
  }
});
</script>

<template>
  <div class="flex-1 min-h-0 min-w-0 overflow-y-auto pr-2 sm:pr-[15px]">
    <ConfigLogsTab
      :log-level="appLogLevel"
      :entries="displayEntries"
      :loading="appLogsLoading"
      :error="appLogsError"
      :log-level-filter="appLogLevelFilter"
      :tail="appLogTail"
      :component-filter="appLogComponent"
      :streaming-enabled="streamingEnabled"
      :streaming-connected="isStreaming"
      @update:log-level-filter="appLogLevelFilter = $event"
      @update:tail="appLogTail = $event"
      @update:component-filter="appLogComponent = $event"
      @update:streaming-enabled="streamingEnabled = $event"
      @refresh="applyFilters"
      @reset="resetLogFilters"
      @toggle-pause="toggleStreamingPause"
    />
  </div>
</template>
