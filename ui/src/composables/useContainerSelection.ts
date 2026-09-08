import { type ComputedRef, computed, type Ref, ref } from 'vue';

// Module-level singleton state shared by every composable consumer (roadmap
// 6.1.1) — selection is a single global resource across container views, so
// every consumer shares one selection set, in the same style as
// useDependencyGraph's expandedIds.
const selectedIds = ref<Set<string>>(new Set());

function isSelected(id: string): boolean {
  return selectedIds.value.has(id);
}

function toggle(id: string): void {
  const next = new Set(selectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedIds.value = next;
}

function setSelected(id: string, selected: boolean): void {
  const next = new Set(selectedIds.value);
  if (selected) {
    next.add(id);
  } else {
    next.delete(id);
  }
  selectedIds.value = next;
}

function selectAllVisible(ids: readonly string[]): void {
  const next = new Set(selectedIds.value);
  for (const id of ids) {
    next.add(id);
  }
  selectedIds.value = next;
}

function clearVisible(ids: readonly string[]): void {
  const next = new Set(selectedIds.value);
  for (const id of ids) {
    next.delete(id);
  }
  selectedIds.value = next;
}

function selectAllState(ids: readonly string[]): 'none' | 'some' | 'all' {
  if (ids.length === 0) {
    return 'none';
  }
  const selectedCount = ids.filter((id) => selectedIds.value.has(id)).length;
  if (selectedCount === 0) {
    return 'none';
  }
  if (selectedCount === ids.length) {
    return 'all';
  }
  return 'some';
}

function clear(): void {
  selectedIds.value = new Set();
}

function pruneTo(ids: readonly string[]): void {
  const allowed = new Set(ids);
  const next = new Set<string>();
  let changed = false;
  for (const id of selectedIds.value) {
    if (allowed.has(id)) {
      next.add(id);
    } else {
      changed = true;
    }
  }
  if (!changed) {
    return;
  }
  selectedIds.value = next;
}

export function useContainerSelection(): {
  selectedIds: Readonly<Ref<ReadonlySet<string>>>;
  count: ComputedRef<number>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  setSelected: (id: string, selected: boolean) => void;
  selectAllVisible: (ids: readonly string[]) => void;
  clearVisible: (ids: readonly string[]) => void;
  selectAllState: (ids: readonly string[]) => 'none' | 'some' | 'all';
  clear: () => void;
  pruneTo: (ids: readonly string[]) => void;
} {
  const count = computed<number>(() => selectedIds.value.size);

  return {
    selectedIds,
    count,
    isSelected,
    toggle,
    setSelected,
    selectAllVisible,
    clearVisible,
    selectAllState,
    clear,
    pruneTo,
  };
}

/** Test-only reset of the module-level singleton state. */
export function resetContainerSelectionState(): void {
  selectedIds.value = new Set();
}
