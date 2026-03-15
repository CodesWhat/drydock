<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
  type AnsiColor,
  type AnsiTextSegment,
  type ParsedJsonLogLine,
} from '../../utils/container-logs';

type TailOption = 100 | 500 | 1000 | 'all';

type StreamType = 'stdout' | 'stderr';

interface LogEntry {
  id: number;
  type: StreamType;
  ts: string;
  line: string;
  plainLine: string;
  ansiSegments: AnsiTextSegment[];
  json: ParsedJsonLogLine | null;
  level: string | null;
}

interface JsonToken {
  text: string;
  type: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'text';
}

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

const entries = ref<LogEntry[]>([]);
const streamStatus = ref<ContainerLogStreamStatus>('disconnected');
const streamPaused = ref(false);
const autoScrollPinned = ref(true);
const searchQuery = ref('');
const regexSearch = ref(false);
const searchError = ref<string | null>(null);
const showStdout = ref(true);
const showStderr = ref(true);
const levelFilter = ref('all');
const tailSize = ref<TailOption>(100);
const downloadInProgress = ref(false);
const downloadError = ref<string | null>(null);
const nextEntryId = ref(1);
const lastSince = ref<number | undefined>(undefined);
const currentMatchIndex = ref(0);
const logViewport = ref<HTMLElement | null>(null);

const lineElements = new Map<number, HTMLElement>();
let streamConnection: ContainerLogStreamConnection | null = null;

const MAX_VISIBLE_LOGS = 5000;
const TAIL_OPTIONS: ReadonlyArray<{ label: string; value: TailOption }> = [
  { label: 'Tail 100', value: 100 },
  { label: 'Tail 500', value: 500 },
  { label: 'Tail 1000', value: 1000 },
  { label: 'Tail All', value: 'all' },
];

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 28;
}

function scrollToBottom(): void {
  if (!logViewport.value) {
    return;
  }

  logViewport.value.scrollTop = logViewport.value.scrollHeight;
}

function handleLogScroll(): void {
  if (!logViewport.value) {
    return;
  }

  autoScrollPinned.value = isNearBottom(logViewport.value);
}

function togglePin(): void {
  autoScrollPinned.value = !autoScrollPinned.value;
  if (autoScrollPinned.value) {
    scrollToBottom();
  }
}

function appendLogEntry(frame: ContainerLogStreamFrame): void {
  if (streamPaused.value) {
    return;
  }

  const plainLine = stripAnsiCodes(frame.line);
  const json = parseJsonLogLine(frame.line);
  const entry: LogEntry = {
    id: nextEntryId.value,
    type: frame.type,
    ts: frame.ts,
    line: frame.line,
    plainLine,
    ansiSegments: parseAnsiSegments(frame.line),
    json,
    level: json?.level ?? null,
  };
  nextEntryId.value += 1;

  entries.value.push(entry);
  if (entries.value.length > MAX_VISIBLE_LOGS) {
    const overflow = entries.value.length - MAX_VISIBLE_LOGS;
    const trimmedEntries = entries.value.slice(overflow);
    for (const removedEntry of entries.value.slice(0, overflow)) {
      lineElements.delete(removedEntry.id);
    }
    entries.value = trimmedEntries;
  }

  const parsedSince = parseLogTimestampToUnixSeconds(frame.ts);
  if (
    parsedSince !== undefined &&
    (lastSince.value === undefined || parsedSince > lastSince.value)
  ) {
    lastSince.value = parsedSince;
  }

  if (autoScrollPinned.value) {
    void nextTick(() => scrollToBottom());
  }
}

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
  lineElements.clear();
  lastSince.value = undefined;
  currentMatchIndex.value = 0;
  connectStream();
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const searchPattern = computed<RegExp | null>(() => {
  const rawQuery = searchQuery.value;
  if (!rawQuery) {
    searchError.value = null;
    return null;
  }

  try {
    const source = regexSearch.value ? rawQuery : escapeRegExp(rawQuery);
    const pattern = new RegExp(source, 'i');
    searchError.value = null;
    return pattern;
  } catch {
    searchError.value = regexSearch.value ? 'Invalid regular expression' : null;
    return null;
  }
});

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
    if (entry.type === 'stdout' && !showStdout.value) {
      return false;
    }
    if (entry.type === 'stderr' && !showStderr.value) {
      return false;
    }
    if (levelFilter.value !== 'all' && entry.level !== levelFilter.value) {
      return false;
    }
    return true;
  });
});

const matchedEntryIds = computed(() => {
  const pattern = searchPattern.value;
  if (!pattern) {
    return [];
  }

  return visibleEntries.value
    .filter((entry) => pattern.test(`${entry.ts} ${entry.plainLine}`))
    .map((entry) => entry.id);
});

const currentMatchEntryId = computed(() => {
  if (matchedEntryIds.value.length === 0) {
    return null;
  }

  const safeIndex =
    currentMatchIndex.value >= 0 && currentMatchIndex.value < matchedEntryIds.value.length
      ? currentMatchIndex.value
      : 0;
  return matchedEntryIds.value[safeIndex] ?? null;
});

const matchLabel = computed(() => {
  if (matchedEntryIds.value.length === 0) {
    return '0 / 0';
  }
  return `${currentMatchIndex.value + 1} / ${matchedEntryIds.value.length}`;
});

function jumpToMatch(direction: 'next' | 'prev'): void {
  if (matchedEntryIds.value.length === 0) {
    return;
  }

  if (direction === 'next') {
    currentMatchIndex.value = (currentMatchIndex.value + 1) % matchedEntryIds.value.length;
  } else {
    currentMatchIndex.value =
      (currentMatchIndex.value - 1 + matchedEntryIds.value.length) % matchedEntryIds.value.length;
  }

  const targetId = matchedEntryIds.value[currentMatchIndex.value];
  const targetElement = lineElements.get(targetId);
  if (targetElement && typeof targetElement.scrollIntoView === 'function') {
    targetElement.scrollIntoView({ block: 'center' });
  }
}

function isMatchedEntry(entryId: number): boolean {
  return matchedEntryIds.value.includes(entryId);
}

function isCurrentMatch(entryId: number): boolean {
  return currentMatchEntryId.value === entryId;
}

function setLineElement(entryId: number, element: Element | null): void {
  if (!(element instanceof HTMLElement)) {
    lineElements.delete(entryId);
    return;
  }

  lineElements.set(entryId, element);
}

function ansiColorValue(color: AnsiColor | null): string | null {
  if (!color) {
    return null;
  }

  const colorMap: Readonly<Record<AnsiColor, string>> = {
    black: '#111827',
    red: 'var(--dd-danger)',
    green: 'var(--dd-success)',
    yellow: 'var(--dd-warning)',
    blue: 'var(--dd-info)',
    magenta: '#d946ef',
    cyan: '#06b6d4',
    white: 'var(--dd-log-text)',
    'bright-black': 'var(--dd-log-text-muted)',
    'bright-red': '#ef4444',
    'bright-green': '#22c55e',
    'bright-yellow': '#facc15',
    'bright-blue': '#3b82f6',
    'bright-magenta': '#e879f9',
    'bright-cyan': '#22d3ee',
    'bright-white': '#f8fafc',
  };

  return colorMap[color];
}

function ansiSegmentStyle(segment: AnsiTextSegment): Record<string, string> {
  const style: Record<string, string> = {};

  const colorValue = ansiColorValue(segment.color);
  if (colorValue) {
    style.color = colorValue;
  }
  if (segment.bold) {
    style.fontWeight = '700';
  }
  if (segment.dim) {
    style.opacity = '0.75';
  }

  return style;
}

function tokenizeJson(prettyJson: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let cursor = 0;

  const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

  while (cursor < prettyJson.length) {
    const character = prettyJson[cursor];

    if (/\s/u.test(character)) {
      let end = cursor + 1;
      while (end < prettyJson.length && /\s/u.test(prettyJson[end])) {
        end += 1;
      }
      tokens.push({ text: prettyJson.slice(cursor, end), type: 'text' });
      cursor = end;
      continue;
    }

    if ('{}[],:'.includes(character)) {
      tokens.push({ text: character, type: 'punctuation' });
      cursor += 1;
      continue;
    }

    if (character === '"') {
      let end = cursor + 1;
      while (end < prettyJson.length) {
        if (prettyJson[end] === '"' && prettyJson[end - 1] !== '\\') {
          end += 1;
          break;
        }
        end += 1;
      }

      let lookAhead = end;
      while (lookAhead < prettyJson.length && /\s/u.test(prettyJson[lookAhead])) {
        lookAhead += 1;
      }

      tokens.push({
        text: prettyJson.slice(cursor, end),
        type: prettyJson[lookAhead] === ':' ? 'key' : 'string',
      });
      cursor = end;
      continue;
    }

    const remaining = prettyJson.slice(cursor);
    if (remaining.startsWith('true') || remaining.startsWith('false')) {
      const value = remaining.startsWith('true') ? 'true' : 'false';
      tokens.push({ text: value, type: 'boolean' });
      cursor += value.length;
      continue;
    }

    if (remaining.startsWith('null')) {
      tokens.push({ text: 'null', type: 'null' });
      cursor += 4;
      continue;
    }

    const numberMatch = remaining.match(numberPattern);
    if (numberMatch?.[0]) {
      tokens.push({ text: numberMatch[0], type: 'number' });
      cursor += numberMatch[0].length;
      continue;
    }

    tokens.push({ text: character, type: 'text' });
    cursor += 1;
  }

  return tokens;
}

function tokenClassName(token: JsonToken): string {
  if (token.type === 'key') {
    return 'json-key';
  }
  if (token.type === 'string') {
    return 'json-string';
  }
  if (token.type === 'number') {
    return 'json-number';
  }
  if (token.type === 'boolean') {
    return 'json-boolean';
  }
  if (token.type === 'null') {
    return 'json-null';
  }
  if (token.type === 'punctuation') {
    return 'json-punctuation';
  }
  return 'json-text';
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

watch(searchPattern, () => {
  currentMatchIndex.value = 0;
});

watch(matchedEntryIds, (matches) => {
  if (matches.length === 0) {
    currentMatchIndex.value = 0;
    return;
  }

  if (currentMatchIndex.value >= matches.length) {
    currentMatchIndex.value = 0;
  }
});

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
    lineElements.clear();
    nextEntryId.value = 1;
    currentMatchIndex.value = 0;
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
  <div
    class="dd-rounded overflow-hidden flex flex-col min-h-0"
    :style="{ backgroundColor: 'var(--dd-bg-code)' }"
    data-test="container-logs"
  >
    <div
      class="px-3 py-2.5 flex flex-col gap-2"
      :style="{ borderBottom: '1px solid var(--dd-log-divider)' }"
    >
      <div class="flex items-center gap-2 justify-between">
        <div class="flex items-center gap-2 min-w-0">
          <AppIcon name="terminal" :size="12" class="dd-text-muted" />
          <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Container Logs</span>
          <span class="text-[0.6875rem] font-mono text-drydock-secondary truncate">{{ props.containerName }}</span>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            type="button"
            data-test="container-log-toggle-pause"
            class="px-2 py-1 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
            @click="togglePause"
          >
            <span class="inline-flex items-center gap-1">
              <AppIcon :name="streamPaused ? 'play' : 'pause'" :size="11" />
              {{ streamPaused ? 'Resume' : 'Pause' }}
            </span>
          </button>

          <button
            type="button"
            class="px-2 py-1 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
            @click="togglePin"
          >
            {{ autoScrollPinned ? 'Unpin' : 'Pin' }}
          </button>

          <button
            type="button"
            data-test="container-log-download"
            class="px-2 py-1 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
            :class="downloadInProgress ? 'opacity-50 pointer-events-none' : ''"
            @click="downloadLogs"
          >
            <span class="inline-flex items-center gap-1">
              <AppIcon name="download" :size="11" />
              Download
            </span>
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="relative flex-1 min-w-[220px]">
          <AppIcon
            name="search"
            :size="11"
            class="absolute left-2 top-1/2 -translate-y-1/2 dd-text-muted pointer-events-none"
          />
          <input
            v-model="searchQuery"
            data-test="container-log-search-input"
            type="text"
            class="w-full pl-7 pr-2 py-1.5 dd-rounded text-[0.6875rem] outline-none dd-bg dd-text dd-placeholder"
            placeholder="Search logs"
          />
        </div>

        <button
          type="button"
          data-test="container-log-regex-toggle"
          class="px-2 py-1.5 dd-rounded text-[0.625rem] font-semibold uppercase tracking-wide transition-colors"
          :class="regexSearch ? 'text-drydock-secondary dd-bg-elevated' : 'dd-text-muted hover:dd-text hover:dd-bg-elevated'"
          @click="regexSearch = !regexSearch"
        >
          .* Regex
        </button>

        <button
          type="button"
          class="px-2 py-1.5 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
          :class="showStdout ? 'ring-1 ring-white/10' : ''"
          @click="showStdout = !showStdout"
        >
          <span class="inline-flex items-center gap-1" style="color: var(--dd-success)">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: var(--dd-success)" />
            stdout
          </span>
        </button>

        <button
          type="button"
          data-test="container-log-toggle-stderr"
          class="px-2 py-1.5 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
          :class="showStderr ? 'ring-1 ring-white/10' : ''"
          @click="showStderr = !showStderr"
        >
          <span class="inline-flex items-center gap-1" style="color: var(--dd-danger)">
            <span class="w-1.5 h-1.5 rounded-full" style="background-color: var(--dd-danger)" />
            stderr
          </span>
        </button>

        <select
          v-model="tailSize"
          class="px-2 py-1.5 dd-rounded text-[0.625rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
        >
          <option v-for="option in TAIL_OPTIONS" :key="option.label" :value="option.value">{{ option.label }}</option>
        </select>

        <select
          v-if="hasJsonEntries"
          v-model="levelFilter"
          class="px-2 py-1.5 dd-rounded text-[0.625rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
        >
          <option v-for="option in levelOptions" :key="option" :value="option">
            {{ option === 'all' ? 'All Levels' : option }}
          </option>
        </select>

        <button
          type="button"
          data-test="container-log-prev-match"
          class="px-2 py-1.5 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
          :disabled="matchedEntryIds.length === 0"
          @click="jumpToMatch('prev')"
        >
          Prev
        </button>
        <button
          type="button"
          data-test="container-log-next-match"
          class="px-2 py-1.5 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
          :disabled="matchedEntryIds.length === 0"
          @click="jumpToMatch('next')"
        >
          Next
        </button>
        <span data-test="container-log-match-index" class="text-[0.625rem] dd-text-muted font-mono">{{ matchLabel }}</span>
      </div>

      <div v-if="searchError" class="text-[0.625rem]" style="color: var(--dd-danger)">
        {{ searchError }}
      </div>
      <div v-if="downloadError" class="text-[0.625rem]" style="color: var(--dd-danger)">
        {{ downloadError }}
      </div>
    </div>

    <div
      ref="logViewport"
      class="flex-1 min-h-0 overflow-auto font-mono"
      :class="props.compact ? 'text-[0.625rem]' : 'text-[0.6875rem]'"
      @scroll="handleLogScroll"
    >
      <div v-if="visibleEntries.length === 0" class="px-3 py-5 text-center text-[0.6875rem] dd-text-muted">
        No log entries yet
      </div>

      <div
        v-for="entry in visibleEntries"
        :key="entry.id"
        :ref="(element) => setLineElement(entry.id, element as Element | null)"
        data-test="container-log-row"
        class="px-3 py-1.5 transition-colors"
        :class="[
          isMatchedEntry(entry.id) ? 'ring-1 ring-drydock-secondary/50' : '',
          isCurrentMatch(entry.id) ? 'bg-drydock-secondary/10' : '',
        ]"
        :style="{ borderBottom: '1px solid var(--dd-log-line)' }"
      >
        <div class="flex items-start gap-2">
          <span class="shrink-0 tabular-nums" style="color: var(--dd-log-text-muted)">{{ entry.ts || '-' }}</span>
          <span
            class="shrink-0 font-semibold uppercase text-[0.625rem]"
            :style="{ color: entry.type === 'stderr' ? 'var(--dd-danger)' : 'var(--dd-success)' }"
          >
            {{ entry.type }}
          </span>

          <pre
            v-if="entry.json"
            class="min-w-0 flex-1 whitespace-pre-wrap break-words"
            style="color: var(--dd-log-text)"
          ><span v-for="(token, tokenIndex) in tokenizeJson(entry.json.pretty)" :key="`${entry.id}-${tokenIndex}`" :class="tokenClassName(token)">{{ token.text }}</span></pre>
          <span v-else class="min-w-0 flex-1 whitespace-pre-wrap break-words" style="color: var(--dd-log-text)">
            <span
              v-for="(segment, segmentIndex) in entry.ansiSegments"
              :key="`${entry.id}-${segmentIndex}`"
              :style="ansiSegmentStyle(segment)"
            >{{ segment.text }}</span>
          </span>
        </div>
      </div>
    </div>

    <div
      class="px-3 py-1.5 flex items-center justify-between text-[0.625rem]"
      :style="{ borderTop: '1px solid var(--dd-log-divider)', backgroundColor: 'var(--dd-log-footer-bg)' }"
    >
      <span class="dd-text-muted font-mono">{{ visibleEntries.length }} lines</span>
      <div class="flex items-center gap-1.5">
        <div
          class="w-2 h-2 rounded-full"
          :style="{ backgroundColor: streamPaused ? 'var(--dd-warning)' : streamStatus === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }"
        />
        <span
          class="font-semibold"
          :style="{ color: streamPaused ? 'var(--dd-warning)' : streamStatus === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }"
        >
          {{ streamPaused ? 'Paused' : streamStatus === 'connected' ? 'Live' : 'Offline' }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.json-key {
  color: #93c5fd;
}

.json-string {
  color: #86efac;
}

.json-number {
  color: #f9a8d4;
}

.json-boolean {
  color: #fcd34d;
}

.json-null {
  color: #c4b5fd;
}

.json-punctuation {
  color: var(--dd-log-text-muted);
}

.json-text {
  color: var(--dd-log-text);
}
</style>
