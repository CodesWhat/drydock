<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppLogViewer from '../AppLogViewer.vue';
import {
  createContainerLogStreamConnection,
  downloadContainerLogs,
  toLogTailValue,
  type ContainerLogStreamConnection,
  type ContainerLogStreamFrame,
  type ContainerLogStreamStatus,
} from '../../services/logs';
import {
  parseAnsiSegments,
  parseJsonLogLine,
  parseLogTimestampToUnixSeconds,
  stripAnsiCodes,
} from '../../utils/container-logs';
import { preferences } from '../../preferences/store';
import { usePreference } from '../../preferences/usePreference';
import type { AppLogEntry } from '../../types/log-entry';

type TailOption = 100 | 500 | 1000 | 'all';

const props = withDefaults(
  defineProps<{
    containerId: string;
    containerName: string;
    compact?: boolean;
  }>(),
  {
    compact: false,
  },
);

const entries = ref<AppLogEntry[]>([]);
const streamStatus = ref<ContainerLogStreamStatus>('disconnected');
const streamPaused = ref(false);
const autoScrollPinned = ref(true);
const showStdout = ref(true);
const showStderr = ref(true);
const levelFilter = ref('all');
const tailSize = ref<TailOption>(100);
const downloadInProgress = ref(false);
const downloadError = ref<string | null>(null);
const nextEntryId = ref(1);
const lastSince = ref<number | undefined>(undefined);
const newestFirst = usePreference(
  () => preferences.views.logs.newestFirst,
  (value) => {
    preferences.views.logs.newestFirst = value;
  },
);

let streamConnection: ContainerLogStreamConnection | null = null;

const MAX_VISIBLE_LOGS = 5000;
const TAIL_OPTIONS: ReadonlyArray<{ label: string; value: TailOption }> = [
  { label: 'Tail 100', value: 100 },
  { label: 'Tail 500', value: 500 },
  { label: 'Tail 1000', value: 1000 },
  { label: 'Tail All', value: 'all' },
];

const levelOptions = computed(() => {
  const uniqueLevels = new Set<string>();
  for (const entry of entries.value) {
    if (entry.level) {
      uniqueLevels.add(entry.level);
    }
  }
  return ['all', ...Array.from(uniqueLevels).sort((left, right) => left.localeCompare(right))];
});

const hasJsonEntries = computed(() => entries.value.some((entry) => entry.json !== null));

const visibleEntries = computed(() => {
  return entries.value.filter((entry) => {
    if (entry.channel === 'stdout' && !showStdout.value) {
      return false;
    }
    if (entry.channel === 'stderr' && !showStderr.value) {
      return false;
    }
    if (levelFilter.value !== 'all' && entry.level !== levelFilter.value) {
      return false;
    }
    return true;
  });
});

const statusLabel = computed(() => {
  if (streamPaused.value) {
    return 'Paused';
  }
  return streamStatus.value === 'connected' ? 'Live' : 'Offline';
});

const statusColor = computed(() => {
  if (streamPaused.value) {
    return 'var(--dd-warning)';
  }
  return streamStatus.value === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)';
});

function setStreamStatus(status: ContainerLogStreamStatus): void {
  streamStatus.value = status;
}

function connectStream(): void {
  if (!props.containerId) {
    return;
  }

  streamConnection?.close();
  streamConnection = createContainerLogStreamConnection({
    containerId: props.containerId,
    query: {
      stdout: showStdout.value,
      stderr: showStderr.value,
      tail: toLogTailValue(tailSize.value),
      since: lastSince.value,
      follow: true,
    },
    onMessage: appendLogEntry,
    onStatus: setStreamStatus,
  });
}

function clearLogsAndReconnect(): void {
  entries.value = [];
  lastSince.value = undefined;
  connectStream();
}

function appendLogEntry(frame: ContainerLogStreamFrame): void {
  if (streamPaused.value) {
    return;
  }

  const json = parseJsonLogLine(frame.line);
  const entry: AppLogEntry = {
    id: nextEntryId.value,
    timestamp: frame.displayTs,
    line: frame.line,
    plainLine: stripAnsiCodes(frame.line),
    ansiSegments: parseAnsiSegments(frame.line),
    json,
    level: json?.level ?? null,
    channel: frame.type,
  };
  nextEntryId.value += 1;

  entries.value.push(entry);
  if (entries.value.length > MAX_VISIBLE_LOGS) {
    entries.value = entries.value.slice(entries.value.length - MAX_VISIBLE_LOGS);
  }

  const parsedSince = parseLogTimestampToUnixSeconds(frame.ts);
  if (
    parsedSince !== undefined &&
    (lastSince.value === undefined || parsedSince > lastSince.value)
  ) {
    lastSince.value = parsedSince;
  }
}

function togglePause(): void {
  if (!streamConnection) {
    return;
  }

  streamPaused.value = !streamPaused.value;
  if (streamPaused.value) {
    streamConnection.pause();
    streamStatus.value = 'disconnected';
    return;
  }

  streamConnection.resume();
}

function togglePin(): void {
  autoScrollPinned.value = !autoScrollPinned.value;
}

function sanitizeFileName(value: string): string {
  const sanitizedValue = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return sanitizedValue.length > 0 ? sanitizedValue : 'container';
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

async function downloadLogs(): Promise<void> {
  if (downloadInProgress.value) {
    return;
  }

  downloadInProgress.value = true;
  downloadError.value = null;

  try {
    const logBlob = await downloadContainerLogs(props.containerId, {
      stdout: showStdout.value,
      stderr: showStderr.value,
      tail: toLogTailValue(tailSize.value),
      since: lastSince.value,
    });

    const fileName = `${sanitizeFileName(props.containerName)}-logs.log`;
    downloadBlob(logBlob, fileName);
  } catch {
    downloadError.value = 'Unable to download logs';
  } finally {
    downloadInProgress.value = false;
  }
}

watch([showStdout, showStderr], () => {
  streamConnection?.update({
    stdout: showStdout.value,
    stderr: showStderr.value,
    since: lastSince.value,
    tail: toLogTailValue(tailSize.value),
    follow: true,
  });
});

watch(tailSize, () => {
  clearLogsAndReconnect();
});

watch(
  () => props.containerId,
  () => {
    entries.value = [];
    nextEntryId.value = 1;
    lastSince.value = undefined;
    connectStream();
  },
);

onMounted(() => {
  connectStream();
});

onBeforeUnmount(() => {
  streamConnection?.close();
  streamConnection = null;
});
</script>

<template>
  <div data-test="container-logs" class="min-h-0 flex flex-col flex-1">
    <AppLogViewer
      v-model:newest-first="newestFirst"
      :entries="visibleEntries"
      :compact="props.compact"
      :paused="streamPaused"
      :auto-scroll-pinned="autoScrollPinned"
      :status-label="statusLabel"
      :status-color="statusColor"
      :line-count="visibleEntries.length"
      @toggle-pause="togglePause"
      @toggle-pin="togglePin"
    >
      <template #toolbar-left>
        <AppIcon name="terminal" :size="12" class="dd-text-muted" />
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Container Logs</span>
        <span class="text-2xs-plus font-mono text-drydock-secondary truncate">{{ props.containerName }}</span>
      </template>

      <template #toolbar-right>
        <AppButton size="none" variant="plain" weight="none"
          type="button"
          data-test="container-log-download"
          class="px-2 py-1 dd-rounded text-2xs font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
          :class="downloadInProgress ? 'opacity-50 pointer-events-none' : ''"
          @click="downloadLogs"
        >
          <span class="inline-flex items-center gap-1">
            <AppIcon name="download" :size="11" />
            Download
          </span>
        </AppButton>
      </template>

      <template #filter-bar>
        <AppButton size="none" variant="plain" weight="none"
          type="button"
          class="px-2 py-1.5 dd-rounded text-2xs font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
          :class="showStdout ? 'ring-1 ring-white/10' : ''"
          @click="showStdout = !showStdout"
        >
          <span class="inline-flex items-center gap-1" style="color: var(--dd-success)">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: var(--dd-success)" />
            stdout
          </span>
        </AppButton>

        <AppButton size="none" variant="plain" weight="none"
          type="button"
          data-test="container-log-toggle-stderr"
          class="px-2 py-1.5 dd-rounded text-2xs font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
          :class="showStderr ? 'ring-1 ring-white/10' : ''"
          @click="showStderr = !showStderr"
        >
          <span class="inline-flex items-center gap-1" style="color: var(--dd-danger)">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: var(--dd-danger)" />
            stderr
          </span>
        </AppButton>

        <select
          v-model="tailSize"
          class="px-2 py-1.5 dd-rounded text-2xs font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
        >
          <option v-for="option in TAIL_OPTIONS" :key="option.label" :value="option.value">{{ option.label }}</option>
        </select>

        <select
          v-if="hasJsonEntries"
          v-model="levelFilter"
          class="px-2 py-1.5 dd-rounded text-2xs font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
        >
          <option v-for="option in levelOptions" :key="option" :value="option">
            {{ option === 'all' ? 'All Levels' : option }}
          </option>
        </select>

        <span v-if="downloadError" class="text-2xs" style="color: var(--dd-danger)">
          {{ downloadError }}
        </span>
      </template>

      <template #entry-prefix="{ entry }">
        <span
          class="shrink-0 font-semibold uppercase text-2xs"
          :style="{ color: entry.channel === 'stderr' ? 'var(--dd-danger)' : 'var(--dd-success)' }"
        >
          {{ entry.channel || '-' }}
        </span>
      </template>
    </AppLogViewer>
  </div>
</template>
