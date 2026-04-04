<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
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

  const nearBottom = isNearBottom(logViewport.value);
  if (nearBottom !== props.autoScrollPinned) {
    emit('toggle-pin');
  }
}

function togglePin(): void {
  const wasPinned = props.autoScrollPinned;
  emit('toggle-pin');
  if (!wasPinned) {
    void nextTick(() => scrollToBottom());
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
});

const renderedLineCount = computed(() => props.lineCount ?? props.entries.length);

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
      void nextTick(() => scrollToBottom());
    }
  },
);

onMounted(() => {
  if (props.autoScrollPinned) {
    void nextTick(() => scrollToBottom());
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
      <div class="flex items-center gap-2 justify-between">
        <div class="flex items-center gap-2 min-w-0">
          <slot name="toolbar-left" />
        </div>

        <div class="flex items-center gap-1.5">
          <AppButton size="none" variant="plain" weight="none"
            type="button"
            data-test="container-log-toggle-pause"
            class="px-2 py-1 dd-rounded text-2xs font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
            @click="emit('toggle-pause')"
          >
            <span class="inline-flex items-center gap-1">
              <AppIcon :name="props.paused ? 'play' : 'pause'" :size="11" />
              {{ props.paused ? 'Resume' : 'Pause' }}
            </span>
          </AppButton>

          <AppButton size="none" variant="plain" weight="none"
            type="button"
            class="px-2 py-1 dd-rounded text-2xs font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
            @click="togglePin"
          >
            {{ props.autoScrollPinned ? 'Unpin' : 'Pin' }}
          </AppButton>

          <AppButton size="none" variant="plain" weight="none"
            type="button"
            data-test="container-log-copy"
            class="px-2 py-1 dd-rounded text-2xs font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
            @click="copyLogs"
          >
            <span class="inline-flex items-center gap-1">
              <AppIcon :name="copySuccess ? 'check' : 'ph:copy'" :size="11" />
              {{ copySuccess ? 'Copied' : 'Copy' }}
            </span>
          </AppButton>

          <slot name="toolbar-right" />
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

    <div
      ref="logViewport"
      class="flex-1 min-h-[120px] overflow-y-auto overflow-x-hidden font-mono"
      :class="props.compact ? 'text-2xs' : 'text-2xs-plus'"
      @scroll="handleLogScroll"
    >
      <div v-if="props.entries.length === 0" class="px-3 py-5 text-center text-2xs-plus dd-text-muted">
        {{ props.emptyMessage }}
      </div>

      <div
        v-for="(entry, index) in props.entries"
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
          <span v-if="props.showLineNumbers" class="shrink-0 whitespace-nowrap tabular-nums dd-text-muted">{{ index + 1 }}</span>
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

    <div
      class="px-3 py-1.5 flex items-center justify-between text-2xs gap-2"
      :style="{ borderTop: '1px solid var(--dd-log-divider)', backgroundColor: 'var(--dd-log-footer-bg)' }"
    >
      <div class="flex items-center gap-2 min-w-0">
        <span class="dd-text-muted font-mono">{{ renderedLineCount }} lines</span>
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
