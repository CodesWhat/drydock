<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import AppIconButton from '@/components/AppIconButton.vue';
import StatusDot from '@/components/StatusDot.vue';
import { useLogSearch } from '../composables/useLogSearch';
import type { AppLogEntry } from '../types/log-entry';
import type { AnsiColor, AnsiTextSegment } from '../utils/container-logs';

interface JsonToken {
  text: string;
  type: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'text';
}

const props = withDefaults(
  defineProps<{
    entries: AppLogEntry[];
    compact?: boolean;
    showLineNumbers?: boolean;
    emptyMessage?: string;
    statusLabel?: string;
    statusColor?: string;
    paused?: boolean;
    autoScrollPinned?: boolean;
    lineCount?: number;
  }>(),
  {
    compact: false,
    showLineNumbers: true,
    emptyMessage: 'No log entries yet',
    statusLabel: 'Offline',
    statusColor: 'var(--dd-danger)',
    paused: false,
    autoScrollPinned: true,
    lineCount: undefined,
  },
);

const emit = defineEmits<{
  (e: 'toggle-pause'): void;
  (e: 'toggle-pin'): void;
}>();

const lineElements = new Map<number, HTMLElement>();
const logViewport = ref<HTMLElement | null>(null);
const copySuccess = ref(false);

const newestFirst = ref(false);

function isNearEdge(element: HTMLElement): boolean {
  if (newestFirst.value) {
    return element.scrollTop < 28;
  }
  return element.scrollHeight - element.scrollTop - element.clientHeight < 28;
}

function scrollToEdge(): void {
  if (!logViewport.value) {
    return;
  }
  logViewport.value.scrollTop = newestFirst.value ? 0 : logViewport.value.scrollHeight;
}

function handleLogScroll(): void {
  if (!logViewport.value) {
    return;
  }

  const nearEdge = isNearEdge(logViewport.value);
  if (nearEdge !== props.autoScrollPinned) {
    emit('toggle-pin');
  }
}

function togglePin(): void {
  const wasPinned = props.autoScrollPinned;
  emit('toggle-pin');
  if (!wasPinned) {
    void nextTick(() => scrollToEdge());
  }
}

function setLineElement(entryId: number, element: Element | null): void {
  if (!(element instanceof HTMLElement)) {
    lineElements.delete(entryId);
    return;
  }

  lineElements.set(entryId, element);
}

const {
  searchQuery,
  regexSearch,
  searchError,
  matchedEntryIds,
  matchLabel,
  jumpToMatch,
  isMatchedEntry,
  isCurrentMatch,
} = useLogSearch({
  visibleEntries: computed(() => props.entries),
  lineElements,
  searchTextForEntry: (entry) =>
    [entry.timestamp, entry.level, entry.channel, entry.component, entry.plainLine]
      .filter(Boolean)
      .join(' '),
});

const searchFilterMode = ref(false);

const displayEntries = computed(() => {
  let entries = props.entries;
  if (searchFilterMode.value && searchQuery.value) {
    const matchedIds = new Set(matchedEntryIds.value);
    entries = entries.filter((entry) => matchedIds.has(entry.id));
  }
  return newestFirst.value ? [...entries].reverse() : entries;
});

const renderedLineCount = computed(() => {
  const total = props.lineCount ?? props.entries.length;
  if (
    searchFilterMode.value &&
    searchQuery.value &&
    displayEntries.value.length < props.entries.length
  ) {
    return `${displayEntries.value.length} / ${total}`;
  }
  return `${total}`;
});

watch(
  () => props.entries.length,
  () => {
    const visibleIds = new Set(props.entries.map((entry) => entry.id));
    for (const id of lineElements.keys()) {
      if (!visibleIds.has(id)) {
        lineElements.delete(id);
      }
    }

    if (props.autoScrollPinned) {
      void nextTick(() => scrollToEdge());
    }
  },
);

onMounted(() => {
  if (props.autoScrollPinned) {
    void nextTick(() => scrollToEdge());
  }
});

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
    style.opacity = 'var(--dd-opacity-dim)';
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

async function copyLogs(): Promise<void> {
  const text = props.entries
    .map((entry) => {
      const parts = [entry.timestamp];
      if (entry.channel) {
        parts.push(entry.channel.toUpperCase());
      } else if (entry.level) {
        parts.push(entry.level.toUpperCase());
      }
      if (entry.component) {
        parts.push(entry.component);
      }
      parts.push(entry.plainLine);
      return parts.filter((part) => part && part.trim().length > 0).join(' ');
    })
    .join('\n');

  try {
    await navigator.clipboard.writeText(text);
    copySuccess.value = true;
    setTimeout(() => {
      copySuccess.value = false;
    }, 2000);
  } catch {
    // Clipboard API may not be available in all contexts.
  }
}
</script>

<template>
  <div
    class="dd-rounded overflow-hidden flex flex-col flex-1 min-h-0"
    :style="{ backgroundColor: 'var(--dd-bg-code)' }"
    data-test="app-log-viewer"
  >
    <div
      class="px-3 py-2.5 flex flex-col gap-2 shrink-0"
      :style="{ borderBottom: '1px solid var(--dd-log-divider)' }"
    >
      <div class="flex items-center gap-1.5 flex-wrap">
        <slot name="toolbar-left" />

        <AppIconButton
          :icon="props.paused ? 'play' : 'pause'"
          size="xs"
          data-test="container-log-toggle-pause"
          :tooltip="props.paused ? 'Resume' : 'Pause'"
          @click="emit('toggle-pause')"
        />

        <AppIconButton
          :icon="props.autoScrollPinned ? 'unpin' : 'pin'"
          size="xs"
          data-test="container-log-toggle-pin"
          :tooltip="props.autoScrollPinned ? 'Unpin auto-scroll' : 'Pin auto-scroll'"
          @click="togglePin"
        />

        <AppIconButton
          :icon="newestFirst ? 'sort-asc' : 'sort-desc'"
          size="xs"
          data-test="container-log-sort-toggle"
          :tooltip="newestFirst ? 'Newest first' : 'Oldest first'"
          @click="newestFirst = !newestFirst"
        />

        <slot name="toolbar-right" />
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
            class="w-full pl-7 pr-2 py-1.5 dd-rounded text-2xs-plus outline-none dd-text dd-placeholder"
            style="background-color: var(--dd-log-footer-bg)"
            placeholder="Search logs"
          />
        </div>

        <AppButton size="none" variant="plain" weight="none"
          type="button"
          data-test="container-log-regex-toggle"
          class="px-2 py-1.5 dd-rounded text-2xs font-semibold uppercase tracking-wide transition-colors"
          :class="regexSearch ? 'text-drydock-secondary dd-bg-elevated' : 'dd-text-muted hover:dd-text hover:dd-bg-elevated'"
          @click="regexSearch = !regexSearch"
        >
          .* Regex
        </AppButton>

        <AppIconButton
          icon="filter"
          size="xs"
          :variant="searchFilterMode ? 'secondary' : 'muted'"
          data-test="container-log-filter-toggle"
          :tooltip="searchFilterMode ? 'Showing matches only' : 'Show matches only'"
          :class="searchFilterMode ? 'dd-bg-elevated' : ''"
          @click="searchFilterMode = !searchFilterMode"
        />

        <template v-if="searchQuery">
          <AppButton size="none" variant="plain" weight="none"
            type="button"
            data-test="container-log-prev-match"
            class="px-2 py-1.5 dd-rounded text-2xs font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
            :disabled="matchedEntryIds.length === 0"
            @click="jumpToMatch('prev')"
          >
            Prev
          </AppButton>
          <AppButton size="none" variant="plain" weight="none"
            type="button"
            data-test="container-log-next-match"
            class="px-2 py-1.5 dd-rounded text-2xs font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
            :disabled="matchedEntryIds.length === 0"
            @click="jumpToMatch('next')"
          >
            Next
          </AppButton>
          <span data-test="container-log-match-index" class="text-2xs dd-text-muted font-mono">{{ matchLabel }}</span>
        </template>

        <slot name="filter-bar" />
      </div>

      <div v-if="searchError" class="text-2xs" style="color: var(--dd-danger)">
        {{ searchError }}
      </div>
    </div>

    <div class="relative flex-1 min-h-[120px] flex flex-col">
      <AppIconButton
        :icon="copySuccess ? 'check' : 'copy'"
        size="xs"
        data-test="container-log-copy"
        :tooltip="copySuccess ? 'Copied!' : 'Copy logs'"
        class="absolute top-2 right-2 z-10 opacity-50 hover:opacity-100"
        @click="copyLogs"
      />
    <div
      ref="logViewport"
      class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden font-mono"
      :class="props.compact ? 'text-2xs' : 'text-2xs-plus'"
      @scroll="handleLogScroll"
    >
      <div v-if="displayEntries.length === 0" class="px-3 py-5 text-center text-2xs-plus dd-text-muted">
        {{ searchFilterMode && searchQuery ? 'No matching entries' : props.emptyMessage }}
      </div>

      <div
        v-for="(entry, index) in displayEntries"
        :key="entry.id"
        :ref="(element) => setLineElement(entry.id, element as Element | null)"
        data-test="container-log-row"
        class="px-3 py-1.5 transition-colors"
        :class="[
          isMatchedEntry(entry.id) ? 'ring-1 ring-drydock-secondary/50' : '',
          isCurrentMatch(entry.id) ? 'bg-drydock-secondary/10' : '',
        ]"
      >
        <div class="flex items-start gap-2">
          <span v-if="props.showLineNumbers" class="shrink-0 w-8 text-right whitespace-nowrap tabular-nums dd-text-muted">{{ index + 1 }}</span>
          <span class="shrink-0 whitespace-nowrap tabular-nums" style="color: var(--dd-log-text-muted)">{{ entry.timestamp || '-' }}</span>

          <slot name="entry-prefix" :entry="entry" />

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
    </div>

    <div
      class="px-3 py-1.5 flex items-center justify-between text-2xs gap-2"
      :style="{ borderTop: '1px solid var(--dd-log-divider)', backgroundColor: 'var(--dd-log-footer-bg)' }"
    >
      <div class="flex items-center gap-2 min-w-0">
        <span class="dd-text-muted font-mono" data-test="container-log-line-count">{{ renderedLineCount }} lines</span>
        <slot name="footer-extra" />
      </div>

      <div class="flex items-center gap-1.5">
        <StatusDot :color="props.statusColor" size="md" />
        <span class="font-semibold" :style="{ color: props.statusColor }">
          {{ props.statusLabel }}
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
