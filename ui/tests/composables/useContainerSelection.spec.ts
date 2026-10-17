import {
  resetContainerSelectionState,
  useContainerSelection,
} from '@/composables/useContainerSelection';

describe('useContainerSelection', () => {
  beforeEach(() => {
    resetContainerSelectionState();
  });

  it('starts empty', () => {
    const { selectedIds, count } = useContainerSelection();

    expect(selectedIds.value.size).toBe(0);
    expect(count.value).toBe(0);
  });

  describe('toggle', () => {
    it('selects an unselected id and replaces the Set', () => {
      const { selectedIds, toggle, isSelected } = useContainerSelection();

      const before = selectedIds.value;
      toggle('a');

      expect(selectedIds.value).not.toBe(before);
      expect(isSelected('a')).toBe(true);
    });

    it('is idempotent: toggling twice returns to the original state', () => {
      const { toggle, isSelected } = useContainerSelection();

      toggle('a');
      toggle('a');

      expect(isSelected('a')).toBe(false);
    });
  });

  describe('setSelected', () => {
    it('adds the id when selected is true', () => {
      const { setSelected, isSelected } = useContainerSelection();

      setSelected('a', true);

      expect(isSelected('a')).toBe(true);
    });

    it('removes the id when selected is false', () => {
      const { setSelected, isSelected } = useContainerSelection();

      setSelected('a', true);
      setSelected('a', false);

      expect(isSelected('a')).toBe(false);
    });
  });

  describe('selectAllVisible', () => {
    it('unions the given ids into the existing selection', () => {
      const { setSelected, selectAllVisible, isSelected, count } = useContainerSelection();

      setSelected('a', true);
      selectAllVisible(['b', 'c']);

      expect(isSelected('a')).toBe(true);
      expect(isSelected('b')).toBe(true);
      expect(isSelected('c')).toBe(true);
      expect(count.value).toBe(3);
    });
  });

  describe('clearVisible', () => {
    it('removes only the given ids, leaving others selected', () => {
      const { selectAllVisible, clearVisible, isSelected } = useContainerSelection();

      selectAllVisible(['a', 'b', 'c']);
      clearVisible(['b']);

      expect(isSelected('a')).toBe(true);
      expect(isSelected('b')).toBe(false);
      expect(isSelected('c')).toBe(true);
    });
  });

  describe('selectAllState', () => {
    it('returns none for an empty ids list', () => {
      const { selectAllState } = useContainerSelection();

      expect(selectAllState([])).toBe('none');
    });

    it('returns none when nothing in ids is selected', () => {
      const { selectAllState } = useContainerSelection();

      expect(selectAllState(['a', 'b'])).toBe('none');
    });

    it('returns some when part of ids is selected', () => {
      const { setSelected, selectAllState } = useContainerSelection();

      setSelected('a', true);

      expect(selectAllState(['a', 'b'])).toBe('some');
    });

    it('returns all when every id is selected', () => {
      const { selectAllVisible, selectAllState } = useContainerSelection();

      selectAllVisible(['a', 'b']);

      expect(selectAllState(['a', 'b'])).toBe('all');
    });
  });

  describe('clear', () => {
    it('empties the selection', () => {
      const { selectAllVisible, clear, count } = useContainerSelection();

      selectAllVisible(['a', 'b']);
      clear();

      expect(count.value).toBe(0);
    });
  });

  describe('pruneTo', () => {
    it('drops selected ids that are not in the given list', () => {
      const { selectAllVisible, pruneTo, isSelected, count } = useContainerSelection();

      selectAllVisible(['a', 'b', 'c']);
      pruneTo(['a', 'c']);

      expect(isSelected('a')).toBe(true);
      expect(isSelected('b')).toBe(false);
      expect(isSelected('c')).toBe(true);
      expect(count.value).toBe(2);
    });

    it('is a no-op that keeps the same Set instance when nothing changes', () => {
      const { selectedIds, selectAllVisible, pruneTo } = useContainerSelection();

      selectAllVisible(['a', 'b']);
      const before = selectedIds.value;
      pruneTo(['a', 'b', 'c']);

      expect(selectedIds.value).toBe(before);
    });
  });

  it('shares state across every composable call (module-level singleton)', () => {
    const first = useContainerSelection();
    const second = useContainerSelection();

    first.toggle('a');

    expect(second.isSelected('a')).toBe(true);
    expect(second.count.value).toBe(1);
  });

  describe('resetContainerSelectionState', () => {
    it('resets the selection back to empty', () => {
      const { selectedIds, selectAllVisible } = useContainerSelection();

      selectAllVisible(['a', 'b']);
      resetContainerSelectionState();

      expect(selectedIds.value.size).toBe(0);
    });
  });
});
