import { type ComputedRef, computed, type Ref, ref, watch } from 'vue';

interface SearchableLogEntry {
  id: number;
  timestamp: string;
  plainLine: string;
}

interface UseLogSearchOptions<TEntry extends SearchableLogEntry> {
  visibleEntries: Ref<TEntry[]> | ComputedRef<TEntry[]>;
  lineElements: Map<number, HTMLElement>;
  searchTextForEntry?: (entry: TEntry) => string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function useLogSearch<TEntry extends SearchableLogEntry>(
  options: UseLogSearchOptions<TEntry>,
) {
  const searchQuery = ref('');
  const regexSearch = ref(false);
  const searchError = ref<string | null>(null);
  const currentMatchIndex = ref(0);

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

  const matchedEntryIds = computed<number[]>(() => {
    const pattern = searchPattern.value;
    if (!pattern) {
      return [];
    }

    const toSearchText =
      options.searchTextForEntry ?? ((entry: TEntry) => `${entry.timestamp} ${entry.plainLine}`);

    return options.visibleEntries.value
      .filter((entry) => pattern.test(toSearchText(entry)))
      .map((entry) => entry.id);
  });

  const currentMatchEntryId = computed<number | null>(() => {
    const ids = matchedEntryIds.value;
    if (ids.length === 0) {
      return null;
    }

    const safeIndex =
      currentMatchIndex.value >= 0 && currentMatchIndex.value < ids.length
        ? currentMatchIndex.value
        : 0;
    return ids[safeIndex] ?? null;
  });

  const matchLabel = computed(() => {
    const count = matchedEntryIds.value.length;
    if (count === 0) {
      return '0 / 0';
    }
    return `${currentMatchIndex.value + 1} / ${count}`;
  });

  function jumpToMatch(direction: 'next' | 'prev'): void {
    const ids = matchedEntryIds.value;
    if (ids.length === 0) {
      return;
    }

    if (direction === 'next') {
      currentMatchIndex.value = (currentMatchIndex.value + 1) % ids.length;
    } else {
      currentMatchIndex.value = (currentMatchIndex.value - 1 + ids.length) % ids.length;
    }

    const targetId = ids[currentMatchIndex.value];
    const targetElement = options.lineElements.get(targetId);
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

  return {
    searchQuery,
    regexSearch,
    searchError,
    searchPattern,
    matchedEntryIds,
    currentMatchIndex,
    currentMatchEntryId,
    matchLabel,
    jumpToMatch,
    isMatchedEntry,
    isCurrentMatch,
  };
}
