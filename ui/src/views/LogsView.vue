<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import {
  LOG_AUTO_FETCH_INTERVALS,
  useAutoFetchLogs,
  useLogViewport,
} from '../composables/useLogViewerBehavior';
import ConfigLogsTab from '../components/config/ConfigLogsTab.vue';
import { getLog, getLogEntries } from '../services/log';
import { errorMessage } from '../utils/error';

interface AppLogEntry {
  timestamp?: string | number;
  level?: string;
  component?: string;
  msg?: string;
  message?: string;
}

const { logContainer, scrollBlocked, scrollToBottom, handleLogScroll, resumeAutoScroll } =
  useLogViewport();
const { autoFetchInterval } = useAutoFetchLogs({
  fetchFn: refreshAppLogs,
  scrollToBottom,
  scrollBlocked,
});

const appLogLevel = ref('unknown');
const appLogEntries = ref<AppLogEntry[]>([]);
const appLogsLoading = ref(false);
const appLogsError = ref('');
const appLogLevelFilter = ref('all');
const appLogTail = ref(100);
const appLogComponent = ref('');
const appLogsLastFetched = ref('');

function formatLogTimestamp(timestamp: string | number | undefined): string {
  if (timestamp === undefined || timestamp === null) {
    return 'unknown';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return String(timestamp);
  }
  return date.toLocaleString();
}

function formatLastFetched(iso: string): string {
  if (!iso) {
    return 'never';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'never';
  }
  return date.toLocaleTimeString();
}

function logMessage(entry: AppLogEntry): string {
  return entry.msg || entry.message || '';
}

function getLevelColor(level: string | undefined): string {
  const value = (level || '').toLowerCase();
  if (value === 'error') return 'var(--dd-danger)';
  if (value === 'warn' || value === 'warning') return 'var(--dd-warning)';
  if (value === 'info') return 'var(--dd-info)';
  if (value === 'debug') return 'var(--dd-text-secondary)';
  return 'var(--dd-text-secondary)';
}

async function refreshAppLogs() {
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
    appLogEntries.value = Array.isArray(entries) ? entries : [];
    appLogsLastFetched.value = new Date().toISOString();
    if (!scrollBlocked.value) {
      void nextTick(() => scrollToBottom());
    }
  } catch (e: unknown) {
    appLogsError.value = errorMessage(e, 'Failed to load application logs');
    appLogEntries.value = [];
  } finally {
    appLogsLoading.value = false;
  }
}

function resetLogFilters() {
  appLogLevelFilter.value = 'all';
  appLogTail.value = 100;
  appLogComponent.value = '';
  void refreshAppLogs();
}

function setAppLogContainer(element: HTMLElement | null) {
  logContainer.value = element;
}

onMounted(() => {
  void refreshAppLogs();
});
</script>

<template>
  <div class="flex-1 min-h-0 min-w-0 overflow-y-auto pr-2 sm:pr-[15px]">
    <ConfigLogsTab
      :log-level="appLogLevel"
      :entries="appLogEntries"
      :loading="appLogsLoading"
      :error="appLogsError"
      :log-level-filter="appLogLevelFilter"
      :tail="appLogTail"
      :auto-fetch-interval="autoFetchInterval"
      :component-filter="appLogComponent"
      :auto-fetch-options="LOG_AUTO_FETCH_INTERVALS"
      :scroll-blocked="scrollBlocked"
      :last-fetched-iso="appLogsLastFetched"
      :format-last-fetched="formatLastFetched"
      :format-timestamp="formatLogTimestamp"
      :message-for-entry="logMessage"
      :level-color="getLevelColor"
      @update:log-level-filter="appLogLevelFilter = $event"
      @update:tail="appLogTail = $event"
      @update:auto-fetch-interval="autoFetchInterval = $event"
      @update:component-filter="appLogComponent = $event"
      @refresh="refreshAppLogs"
      @reset="resetLogFilters"
      @resume-auto-scroll="resumeAutoScroll"
      @log-scroll="handleLogScroll"
      @set-log-container="setAppLogContainer"
    />
  </div>
</template>
