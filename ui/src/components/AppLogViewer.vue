<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  triggerRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import AppIconButton from '@/components/AppIconButton.vue';
import StatusDot from '@/components/StatusDot.vue';
import { writeToClipboard } from '../composables/useClipboard';
import { useLogSearch } from '../composables/useLogSearch';
import type { AppLogEntry } from '../types/log-entry';
import type { AnsiColor, AnsiTextSegment } from '../utils/container-logs';
import { type JsonToken, tokenizeJson } from '../utils/json-tokenizer';

const props = withDefaults(
  defineProps<{
    entries: AppLogEntry[];
    newestFirst?: boolean;
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
    newestFirst: false,
    compact: false,
    showLineNumbers: true,
    statusColor: 'var(--dd-danger)',
    paused: false,
    autoScrollPinned: true,
    lineCount: undefined,
  },
);

const emit = defineEmits<{
  (e: 'update:newestFirst', value: boolean): void;
  (e: 'toggle-pause'): void;
  (e: 'toggle-pin'): void;
}>();

const { t } = useI18n();

const lineElements = new Map<number, HTMLElement>();
const logViewport = ref<HTMLElement | null>(null);
const copySuccess = ref(false);
const copyFailed = ref(false);
const virtualScrollTop = ref(0);
const virtualViewportHeight = ref(0);
const measuredRowHeights = shallowRef(new Map<number, number>());
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
let rowResizeObserver: ResizeObserver | null = null;
let viewportResizeObserver: ResizeObserver | null = null;
let lastViewportWidth = 0;

function isNearEdge(element: HTMLElement): boolean {
  if (props.newestFirst) {
    return element.scrollTop < 28;
  }
  return element.scrollHeight - element.scrollTop - element.clientHeight < 28;
}

function scrollToEdge(): void {
  if (!logViewport.value) {
    return;
  }
  const targetScrollTop = props.newestFirst ? 0 : logViewport.value.scrollHeight;
  logViewport.value.scrollTop = targetScrollTop;
  virtualScrollTop.value = logViewport.value.scrollTop;
}

function handleLogScroll(): void {
  if (!logViewport.value) {
    return;
  }

  virtualScrollTop.value = logViewport.value.scrollTop;
  syncVirtualViewport();
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
  const previousElement = lineElements.get(entryId);
  if (previousElement && previousElement !== element) {
    rowResizeObserver?.unobserve(previousElement);
  }
  if (!(element instanceof HTMLElement)) {
    lineElements.delete(entryId);
    return;
  }

  lineElements.set(entryId, element);
  rowResizeObserver?.observe(element);
  recordMeasuredRowHeight(entryId, element.offsetHeight);
}

const {
  searchQuery,
  regexSearch,
  searchError,
  matchedEntryIds,
  matchedEntryIdSet,
  matchLabel,
  jumpToMatch,
  isMatchedEntry,
  isCurrentMatch,
} = useLogSearch({
  visibleEntries: computed(() => props.entries),
  lineElements,
  t: (key: string) => t(key),
  searchTextForEntry: (entry) =>
    [entry.timestamp, entry.level, entry.channel, entry.component, entry.plainLine]
      .filter(Boolean)
      .join(' '),
  scrollToEntry,
});

const searchFilterMode = ref(false);

const displayEntries = shallowRef<AppLogEntry[]>(props.entries);
// Log polling usually appends to the tail of `props.entries`. In newest-first mode,
// rebuilding `[...entries].reverse()` on every update turns that append-only case
// into repeated O(n) work, so we reuse the previous reversed array whenever the
// existing prefix is unchanged and only reverse/prepend the newly appended tail.
let cachedNewestFirstSource: AppLogEntry[] | null = null;
let cachedNewestFirstLength = 0;
let cachedNewestFirstEntries: AppLogEntry[] = [];
let pendingPrependScrollTop: number | null = null;
let pendingPrependHeight = 0;
let prependAdjustmentScheduled = false;

function setDisplayEntries(entries: AppLogEntry[]): void {
  if (displayEntries.value === entries) {
    triggerRef(displayEntries);
    return;
  }

  displayEntries.value = entries;
}

function canAppendToNewestFirstCache(entries: AppLogEntry[]): boolean {
  if (!cachedNewestFirstSource || entries.length < cachedNewestFirstLength) {
    return false;
  }

  for (let index = 0; index < cachedNewestFirstLength; index += 1) {
    if (entries[index] !== cachedNewestFirstSource[index]) {
      return false;
    }
  }

  return true;
}

function preserveUnpinnedPrependPosition(entries: AppLogEntry[]): void {
  const viewport = logViewport.value;
  if (entries.length === 0 || !viewport || props.autoScrollPinned) {
    return;
  }

  pendingPrependScrollTop ??= viewport.scrollTop;
  pendingPrependHeight += entries.reduce(
    (total, entry) => total + (measuredRowHeights.value.get(entry.id) ?? estimateRowHeight(entry)),
    0,
  );
  virtualScrollTop.value = pendingPrependScrollTop + pendingPrependHeight;
  if (prependAdjustmentScheduled) {
    return;
  }

  prependAdjustmentScheduled = true;
  void nextTick(() => {
    const nextScrollTop = (pendingPrependScrollTop ?? 0) + pendingPrependHeight;
    pendingPrependScrollTop = null;
    pendingPrependHeight = 0;
    prependAdjustmentScheduled = false;

    const currentViewport = logViewport.value;
    if (!currentViewport || !props.newestFirst || props.autoScrollPinned) {
      return;
    }
    currentViewport.scrollTop = nextScrollTop;
    virtualScrollTop.value = currentViewport.scrollTop;
  });
}

function syncDisplayEntries(): void {
  if (searchFilterMode.value && searchQuery.value) {
    const filteredEntries = props.entries.filter((entry) => matchedEntryIdSet.value.has(entry.id));
    setDisplayEntries(props.newestFirst ? filteredEntries.reverse() : filteredEntries);
    return;
  }

  if (!props.newestFirst) {
    setDisplayEntries(props.entries);
    return;
  }

  if (canAppendToNewestFirstCache(props.entries)) {
    const appendedEntries = props.entries.slice(cachedNewestFirstLength).reverse();
    if (appendedEntries.length > 0) {
      preserveUnpinnedPrependPosition(appendedEntries);
      cachedNewestFirstEntries.splice(0, 0, ...appendedEntries);
    }

    cachedNewestFirstSource = props.entries;
    cachedNewestFirstLength = props.entries.length;
    setDisplayEntries(cachedNewestFirstEntries);
    return;
  }

  cachedNewestFirstSource = props.entries;
  cachedNewestFirstLength = props.entries.length;
  cachedNewestFirstEntries = [...props.entries].reverse();
  setDisplayEntries(cachedNewestFirstEntries);
}

watch(
  [
    () => props.entries,
    () => props.entries.length,
    () => props.newestFirst,
    searchFilterMode,
    searchQuery,
    matchedEntryIds,
  ],
  syncDisplayEntries,
  { immediate: true },
);

const VIRTUALIZATION_THRESHOLD = 200;
const VIRTUAL_OVERSCAN = 8;
const DEFAULT_VIEWPORT_HEIGHT = 420;

const virtualizationEnabled = computed(
  () => displayEntries.value.length > VIRTUALIZATION_THRESHOLD,
);

function estimateRowHeight(entry: AppLogEntry): number {
  const baseHeight = props.compact ? 24 : 28;
  if (!entry.json?.pretty) {
    return baseHeight;
  }
  const lineCount = entry.json.pretty.split('\n').length;
  return Math.max(baseHeight, 12 + lineCount * 14);
}

function recordMeasuredRowHeight(entryId: number, height: number): void {
  if (!Number.isFinite(height) || height <= 0) {
    return;
  }
  const previousHeight = measuredRowHeights.value.get(entryId);
  if (previousHeight !== undefined && Math.abs(previousHeight - height) < 1) {
    return;
  }
  measuredRowHeights.value.set(entryId, height);
  triggerRef(measuredRowHeights);
}

const rowOffsets = computed<number[]>(() => {
  const entries = displayEntries.value;
  const offsets = new Array<number>(entries.length + 1);
  offsets[0] = 0;
  let total = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    total += measuredRowHeights.value.get(entry.id) ?? estimateRowHeight(entry);
    offsets[index + 1] = total;
  }
  return offsets;
});

const totalContentHeight = computed(() => rowOffsets.value.at(-1) ?? 0);

function findRowIndexAtOffset(offset: number): number {
  const offsets = rowOffsets.value;
  let low = 0;
  let high = Math.max(0, offsets.length - 1);
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (offsets[middle] <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return Math.min(low, Math.max(0, displayEntries.value.length - 1));
}

function syncVirtualViewport(): void {
  const viewport = logViewport.value;
  if (!viewport) {
    return;
  }
  const nextHeight = viewport.clientHeight;
  virtualViewportHeight.value = nextHeight > 0 ? nextHeight : DEFAULT_VIEWPORT_HEIGHT;

  const nextWidth = viewport.clientWidth;
  if (lastViewportWidth > 0 && nextWidth > 0 && Math.abs(nextWidth - lastViewportWidth) >= 1) {
    measuredRowHeights.value = new Map();
  }
  if (nextWidth > 0) {
    lastViewportWidth = nextWidth;
  }
}

const visibleRangeStart = computed(() => {
  if (!virtualizationEnabled.value) {
    return 0;
  }
  return Math.max(0, findRowIndexAtOffset(virtualScrollTop.value) - VIRTUAL_OVERSCAN);
});

const visibleRangeEnd = computed(() => {
  if (!virtualizationEnabled.value) {
    return displayEntries.value.length;
  }
  const viewportHeight = virtualViewportHeight.value || DEFAULT_VIEWPORT_HEIGHT;
  const lastVisibleIndex = findRowIndexAtOffset(virtualScrollTop.value + viewportHeight);
  return Math.min(displayEntries.value.length, lastVisibleIndex + 1 + VIRTUAL_OVERSCAN);
});

const renderedEntries = computed(() =>
  virtualizationEnabled.value
    ? displayEntries.value.slice(visibleRangeStart.value, visibleRangeEnd.value)
    : displayEntries.value,
);

const topSpacerHeight = computed(() =>
  virtualizationEnabled.value ? (rowOffsets.value[visibleRangeStart.value] ?? 0) : 0,
);

const bottomSpacerHeight = computed(() => {
  if (!virtualizationEnabled.value) {
    return 0;
  }
  return Math.max(
    0,
    totalContentHeight.value -
      (rowOffsets.value[visibleRangeEnd.value] ?? totalContentHeight.value),
  );
});

function absoluteRowIndex(localIndex: number): number {
  return virtualizationEnabled.value ? visibleRangeStart.value + localIndex : localIndex;
}

function clampVirtualScrollTop(): void {
  if (!virtualizationEnabled.value) {
    virtualScrollTop.value = 0;
    return;
  }
  const maximum = Math.max(
    0,
    totalContentHeight.value - (virtualViewportHeight.value || DEFAULT_VIEWPORT_HEIGHT),
  );
  if (virtualScrollTop.value <= maximum) {
    return;
  }
  virtualScrollTop.value = maximum;
  if (logViewport.value) {
    logViewport.value.scrollTop = maximum;
  }
}

function scrollToEntry(entryId: number): void {
  const mountedElement = lineElements.get(entryId);
  if (mountedElement && typeof mountedElement.scrollIntoView === 'function') {
    mountedElement.scrollIntoView({ block: 'center' });
    return;
  }
  const entryIndex = displayEntries.value.findIndex((entry) => entry.id === entryId);
  const viewport = logViewport.value;
  if (entryIndex < 0 || !viewport) {
    return;
  }
  syncVirtualViewport();
  const entryTop = rowOffsets.value[entryIndex] ?? 0;
  const entryBottom = rowOffsets.value[entryIndex + 1] ?? entryTop;
  const targetScrollTop = Math.max(
    0,
    entryTop - (virtualViewportHeight.value - (entryBottom - entryTop)) / 2,
  );
  viewport.scrollTop = targetScrollTop;
  virtualScrollTop.value = targetScrollTop;
  void nextTick(() => {
    const element = lineElements.get(entryId);
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center' });
    }
  });
}

watch(displayEntries, (entries) => {
  const visibleIds = new Set(entries.map((entry) => entry.id));
  let pruned = false;
  for (const entryId of measuredRowHeights.value.keys()) {
    if (!visibleIds.has(entryId)) {
      measuredRowHeights.value.delete(entryId);
      pruned = true;
    }
  }
  if (pruned) {
    triggerRef(measuredRowHeights);
  }
  void nextTick(clampVirtualScrollTop);
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

watch(
  () => props.newestFirst,
  () => {
    if (props.autoScrollPinned) {
      void nextTick(() => scrollToEdge());
    }
  },
);

onMounted(() => {
  syncVirtualViewport();
  if (typeof ResizeObserver !== 'undefined') {
    rowResizeObserver = new ResizeObserver((entries) => {
      for (const observedEntry of entries) {
        const entryId = Number.parseInt(
          (observedEntry.target as HTMLElement).dataset.logEntryId ?? '',
          10,
        );
        if (Number.isFinite(entryId)) {
          recordMeasuredRowHeight(entryId, (observedEntry.target as HTMLElement).offsetHeight);
        }
      }
    });
    for (const element of lineElements.values()) {
      rowResizeObserver.observe(element);
    }
    if (logViewport.value) {
      viewportResizeObserver = new ResizeObserver(syncVirtualViewport);
      viewportResizeObserver.observe(logViewport.value);
    }
  }
  if (props.autoScrollPinned) {
    void nextTick(() => scrollToEdge());
  }
});

onBeforeUnmount(() => {
  rowResizeObserver?.disconnect();
  viewportResizeObserver?.disconnect();
  rowResizeObserver = null;
  viewportResizeObserver = null;
  if (copyResetTimer) {
    clearTimeout(copyResetTimer);
    copyResetTimer = null;
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

  const succeeded = await writeToClipboard(text);
  copySuccess.value = succeeded;
  copyFailed.value = !succeeded;

  if (copyResetTimer) clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    copySuccess.value = false;
    copyFailed.value = false;
    copyResetTimer = null;
  }, 2000);
}

function toggleSortOrder(): void {
  emit('update:newestFirst', !props.newestFirst);
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
          :tooltip="props.paused ? t('appShell.logViewer.toolbar.resume') : t('appShell.logViewer.toolbar.pause')"
          @click="emit('toggle-pause')"
        />

        <AppIconButton
          :icon="props.autoScrollPinned ? 'unpin' : 'pin'"
          size="xs"
          data-test="container-log-toggle-pin"
          :tooltip="props.autoScrollPinned ? t('appShell.logViewer.toolbar.unpinAutoScroll') : t('appShell.logViewer.toolbar.pinAutoScroll')"
          @click="togglePin"
        />

        <AppIconButton
          :icon="props.newestFirst ? 'sort-asc' : 'sort-desc'"
          size="xs"
          data-test="container-log-sort-toggle"
          :tooltip="props.newestFirst ? t('appShell.logViewer.toolbar.newestFirst') : t('appShell.logViewer.toolbar.oldestFirst')"
          @click="toggleSortOrder"
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
            :placeholder="t('appShell.logViewer.search.placeholder')"
          />
        </div>

        <AppButton size="none" variant="plain" weight="none"
          type="button"
          data-test="container-log-regex-toggle"
          class="px-2 py-1.5 dd-rounded text-2xs font-semibold uppercase tracking-wide transition-colors"
          :class="regexSearch ? 'text-drydock-secondary dd-bg-elevated' : 'dd-text-muted hover:dd-text hover:dd-bg-elevated'"
          @click="regexSearch = !regexSearch"
        >
          {{ t('appShell.logViewer.toolbar.regexToggle') }}
        </AppButton>

        <AppIconButton
          icon="filter"
          size="xs"
          :variant="searchFilterMode ? 'secondary' : 'muted'"
          data-test="container-log-filter-toggle"
          :tooltip="searchFilterMode ? t('appShell.logViewer.toolbar.showingMatchesOnly') : t('appShell.logViewer.toolbar.showMatchesOnly')"
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
            {{ t('appShell.logViewer.toolbar.prev') }}
          </AppButton>
          <AppButton size="none" variant="plain" weight="none"
            type="button"
            data-test="container-log-next-match"
            class="px-2 py-1.5 dd-rounded text-2xs font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
            :disabled="matchedEntryIds.length === 0"
            @click="jumpToMatch('next')"
          >
            {{ t('appShell.logViewer.toolbar.next') }}
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
      <span
        v-if="virtualizationEnabled"
        data-test="app-log-virtual-status"
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >{{ renderedEntries.length }} / {{ displayEntries.length }} {{ t('appShell.logViewer.footer.lines') }}</span>
      <AppIconButton
        :icon="copyFailed ? 'xmark' : copySuccess ? 'check' : 'copy'"
        size="xs"
        data-test="container-log-copy"
        :variant="copyFailed ? 'danger' : 'muted'"
        :tooltip="copyFailed ? t('sharedComponents.copyableTag.failed') : copySuccess ? t('appShell.logViewer.search.copied') : t('appShell.logViewer.search.copyLogs')"
        class="absolute top-2 right-2 z-10 opacity-50 hover:opacity-100"
        @click="copyLogs"
      />
    <div
      ref="logViewport"
      data-test="app-log-viewport"
      class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden font-mono"
      :class="props.compact ? 'text-2xs' : 'text-2xs-plus'"
      @scroll="handleLogScroll"
    >
      <div v-if="displayEntries.length === 0" class="px-3 py-5 text-center text-2xs-plus dd-text-muted">
        {{ searchFilterMode && searchQuery ? t('appShell.logViewer.empty.noMatchingEntries') : (props.emptyMessage ?? t('appShell.logViewer.empty.defaultMessage')) }}
      </div>

      <div
        v-if="topSpacerHeight > 0"
        data-test="app-log-top-spacer"
        aria-hidden="true"
        :style="{ height: `${topSpacerHeight}px` }"
      />

      <div
        v-for="(entry, index) in renderedEntries"
        :key="entry.id"
        :ref="(element) => setLineElement(entry.id, element as Element | null)"
        :data-log-entry-id="entry.id"
        data-test="container-log-row"
        class="px-3 py-1.5 transition-colors"
        :class="[
          isMatchedEntry(entry.id) ? 'ring-1 ring-drydock-secondary/50' : '',
          isCurrentMatch(entry.id) ? 'bg-drydock-secondary/10' : '',
        ]"
      >
        <div class="flex items-start gap-2">
          <span
            v-if="props.showLineNumbers"
            data-test="container-log-line-number"
            class="shrink-0 w-8 text-right whitespace-nowrap tabular-nums dd-text-muted"
          >{{ absoluteRowIndex(index) + 1 }}</span>
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

      <div
        v-if="bottomSpacerHeight > 0"
        data-test="app-log-bottom-spacer"
        aria-hidden="true"
        :style="{ height: `${bottomSpacerHeight}px` }"
      />
    </div>
    </div>

    <div
      class="px-3 py-1.5 flex items-center justify-between text-2xs gap-2"
      :style="{ borderTop: '1px solid var(--dd-log-divider)', backgroundColor: 'var(--dd-log-footer-bg)' }"
    >
      <div class="flex items-center gap-2 min-w-0">
        <span class="dd-text-muted font-mono" data-test="container-log-line-count">{{ renderedLineCount }} {{ t('appShell.logViewer.footer.lines') }}</span>
        <slot name="footer-extra" />
      </div>

      <div class="flex items-center gap-1.5">
        <StatusDot :color="props.statusColor" size="md" />
        <span class="font-semibold" :style="{ color: props.statusColor }">
          {{ props.statusLabel ?? t('appShell.logViewer.footer.defaultStatusLabel') }}
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
