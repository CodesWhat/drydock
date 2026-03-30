import { computed, nextTick, ref } from 'vue';
import { useLogSearch } from '@/composables/useLogSearch';

type SearchEntry = {
  id: number;
  timestamp: string;
  plainLine: string;
};

function makeEntry(id: number, timestamp: string, plainLine: string): SearchEntry {
  return { id, timestamp, plainLine };
}

describe('useLogSearch', () => {
  it('matches using escaped plain-text search by default', () => {
    const visibleEntries = ref<SearchEntry[]>([
      makeEntry(1, '2026-03-15T00:00:00Z', 'alpha'),
      makeEntry(2, '2026-03-15T00:00:01Z', 'alpha.*'),
      makeEntry(3, '2026-03-15T00:00:02Z', 'beta'),
    ]);

    const search = useLogSearch({
      visibleEntries: computed(() => visibleEntries.value),
      lineElements: new Map(),
      searchTextForEntry: (entry) => entry.plainLine,
    });

    search.searchQuery.value = 'alpha.*';

    expect(search.searchError.value).toBeNull();
    expect(search.searchPattern.value?.source).toBe('alpha\\.\\*');
    expect(search.matchedEntryIds.value).toEqual([2]);
    expect(search.matchLabel.value).toBe('1 / 1');
  });

  it('supports regex mode and reports invalid regex patterns', () => {
    const visibleEntries = ref<SearchEntry[]>([
      makeEntry(1, '2026-03-15T00:00:00Z', 'alpha'),
      makeEntry(2, '2026-03-15T00:00:01Z', 'beta'),
      makeEntry(3, '2026-03-15T00:00:02Z', 'alpha-2'),
    ]);

    const search = useLogSearch({
      visibleEntries: computed(() => visibleEntries.value),
      lineElements: new Map(),
      searchTextForEntry: (entry) => entry.plainLine,
    });

    search.regexSearch.value = true;
    search.searchQuery.value = '^alpha(-\\d+)?$';

    expect(search.searchError.value).toBeNull();
    expect(search.matchedEntryIds.value).toEqual([1, 3]);

    search.searchQuery.value = '[unclosed';
    expect(search.searchPattern.value).toBeNull();
    expect(search.searchError.value).toBe('Invalid regular expression');
    expect(search.matchedEntryIds.value).toEqual([]);
  });

  it('falls back to null error when regex construction fails in plain-text mode', () => {
    const visibleEntries = ref<SearchEntry[]>([makeEntry(1, '2026-03-15T00:00:00Z', 'alpha')]);
    const search = useLogSearch({
      visibleEntries: computed(() => visibleEntries.value),
      lineElements: new Map(),
      searchTextForEntry: (entry) => entry.plainLine,
    });

    const originalRegExp = globalThis.RegExp;
    Object.defineProperty(globalThis, 'RegExp', {
      value: (() => {
        throw new Error('forced-regex-failure');
      }) as unknown as RegExpConstructor,
      configurable: true,
      writable: true,
    });

    try {
      search.regexSearch.value = false;
      search.searchQuery.value = 'alpha';
      expect(search.searchPattern.value).toBeNull();
      expect(search.searchError.value).toBeNull();
      expect(search.matchedEntryIds.value).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, 'RegExp', {
        value: originalRegExp,
        configurable: true,
        writable: true,
      });
    }
  });

  it('navigates matches in both directions and scrolls to active match', async () => {
    const visibleEntries = ref<SearchEntry[]>([
      makeEntry(1, '2026-03-15T00:00:00Z', 'alpha'),
      makeEntry(2, '2026-03-15T00:00:01Z', 'beta'),
      makeEntry(3, '2026-03-15T00:00:02Z', 'alpha-2'),
    ]);

    const firstRow = document.createElement('div');
    const thirdRow = document.createElement('div');
    firstRow.scrollIntoView = vi.fn();
    thirdRow.scrollIntoView = vi.fn();

    const search = useLogSearch({
      visibleEntries: computed(() => visibleEntries.value),
      lineElements: new Map([
        [1, firstRow],
        [3, thirdRow],
      ]),
    });

    search.searchQuery.value = 'alpha';
    await nextTick();

    expect(search.currentMatchEntryId.value).toBe(1);
    expect(search.isMatchedEntry(1)).toBe(true);
    expect(search.isCurrentMatch(1)).toBe(true);

    search.jumpToMatch('next');
    expect(search.currentMatchEntryId.value).toBe(3);
    expect(search.matchLabel.value).toBe('2 / 2');
    expect(thirdRow.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });

    search.jumpToMatch('next');
    expect(search.currentMatchEntryId.value).toBe(1);
    expect(firstRow.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });

    search.jumpToMatch('prev');
    expect(search.currentMatchEntryId.value).toBe(3);
  });

  it('resets match index when search input changes', async () => {
    const visibleEntries = ref<SearchEntry[]>([
      makeEntry(1, '2026-03-15T00:00:00Z', 'alpha'),
      makeEntry(2, '2026-03-15T00:00:01Z', 'beta'),
      makeEntry(3, '2026-03-15T00:00:02Z', 'alpha-2'),
    ]);

    const search = useLogSearch({
      visibleEntries: computed(() => visibleEntries.value),
      lineElements: new Map(),
    });

    search.searchQuery.value = 'alpha';
    await nextTick();

    search.jumpToMatch('next');
    expect(search.matchLabel.value).toBe('2 / 2');

    search.searchQuery.value = 'beta';
    await nextTick();

    expect(search.currentMatchIndex.value).toBe(0);
    expect(search.currentMatchEntryId.value).toBe(2);
    expect(search.matchLabel.value).toBe('1 / 1');
  });

  it('handles empty matches and keeps current index in range when entries change', async () => {
    const visibleEntries = ref<SearchEntry[]>([
      makeEntry(1, '2026-03-15T00:00:00Z', 'alpha'),
      makeEntry(2, '2026-03-15T00:00:01Z', 'alpha-2'),
      makeEntry(3, '2026-03-15T00:00:02Z', 'alpha-3'),
    ]);

    const search = useLogSearch({
      visibleEntries: computed(() => visibleEntries.value),
      lineElements: new Map(),
    });

    search.searchQuery.value = 'alpha';
    await nextTick();

    search.jumpToMatch('next');
    search.jumpToMatch('next');
    expect(search.currentMatchIndex.value).toBe(2);

    visibleEntries.value = [makeEntry(1, '2026-03-15T00:00:00Z', 'alpha')];
    await nextTick();

    expect(search.currentMatchIndex.value).toBe(0);
    expect(search.currentMatchEntryId.value).toBe(1);

    search.searchQuery.value = 'does-not-exist';
    await nextTick();
    expect(search.currentMatchEntryId.value).toBeNull();
    expect(search.matchLabel.value).toBe('0 / 0');
  });

  it('uses the first match when current match index is out of range', async () => {
    const visibleEntries = ref<SearchEntry[]>([
      makeEntry(1, '2026-03-15T00:00:00Z', 'alpha'),
      makeEntry(2, '2026-03-15T00:00:01Z', 'alpha-2'),
    ]);
    const search = useLogSearch({
      visibleEntries: computed(() => visibleEntries.value),
      lineElements: new Map(),
    });

    search.searchQuery.value = 'alpha';
    await nextTick();

    search.currentMatchIndex.value = -1;
    expect(search.currentMatchEntryId.value).toBe(1);

    search.currentMatchIndex.value = 9;
    expect(search.currentMatchEntryId.value).toBe(1);
  });

  it('returns null when a matched entry id is missing at runtime', async () => {
    const visibleEntries = ref<SearchEntry[]>([
      {
        id: undefined as unknown as number,
        timestamp: '2026-03-15T00:00:00Z',
        plainLine: 'alpha',
      },
    ]);
    const search = useLogSearch({
      visibleEntries: computed(() => visibleEntries.value),
      lineElements: new Map(),
    });

    search.searchQuery.value = 'alpha';
    await nextTick();

    expect(search.matchedEntryIds.value).toEqual([undefined]);
    expect(search.currentMatchEntryId.value).toBeNull();
  });

  it('no-ops jump navigation when there are no matches', () => {
    const visibleEntries = ref<SearchEntry[]>([
      makeEntry(1, '2026-03-15T00:00:00Z', 'alpha'),
      makeEntry(2, '2026-03-15T00:00:01Z', 'beta'),
    ]);

    const search = useLogSearch({
      visibleEntries: computed(() => visibleEntries.value),
      lineElements: new Map(),
    });

    expect(search.matchedEntryIds.value).toEqual([]);
    expect(search.currentMatchIndex.value).toBe(0);

    search.jumpToMatch('next');
    search.jumpToMatch('prev');

    expect(search.currentMatchIndex.value).toBe(0);
    expect(search.currentMatchEntryId.value).toBeNull();
  });
});
