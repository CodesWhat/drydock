import { type ComputedRef, computed, type MaybeRefOrGetter, ref, toValue, watch } from 'vue';
import type { ViewTableColumnKey } from '../preferences/schema';
import { preferences } from '../preferences/store';

export interface PickerColumn {
  key: string;
  label: string;
  required?: boolean;
}

/** Re-exported for call sites — one of the five views sharing the picker infrastructure. */
export type ViewColumnVisibilityKey = ViewTableColumnKey;

/**
 * Per-view table column visibility, backed by `preferences.views[viewKey].hiddenColumns`.
 *
 * Unlike `useColumnVisibility` (Containers), this persists the HIDDEN set rather than the
 * visible set: default `[]` means nothing hidden, so a column added in a future release is
 * automatically visible for existing users instead of silently staying hidden.
 *
 * Each call creates its own state seeded from preferences at call time — there is no
 * cross-component sharing requirement here (each of the five views instantiates its own).
 */
export function useViewColumnVisibility(
  viewKey: ViewColumnVisibilityKey,
  columns: MaybeRefOrGetter<PickerColumn[]>,
) {
  const hiddenColumnKeySet = ref<Set<string>>(new Set(preferences.views[viewKey].hiddenColumns));

  watch(
    hiddenColumnKeySet,
    (value) => {
      preferences.views[viewKey].hiddenColumns = [...value];
    },
    { deep: true },
  );

  const hiddenColumnKeys: ComputedRef<string[]> = computed(() => [...hiddenColumnKeySet.value]);

  function isHidden(key: string): boolean {
    return hiddenColumnKeySet.value.has(key);
  }

  function toggleColumn(key: string): void {
    const column = toValue(columns).find((c) => c.key === key);
    if (!column || column.required) return;
    if (hiddenColumnKeySet.value.has(key)) hiddenColumnKeySet.value.delete(key);
    else hiddenColumnKeySet.value.add(key);
  }

  const hiddenCount: ComputedRef<number> = computed(() => {
    const currentKeys = new Set(toValue(columns).map((c) => c.key));
    let count = 0;
    for (const key of hiddenColumnKeySet.value) {
      if (currentKeys.has(key)) count++;
    }
    return count;
  });

  function resetColumns(): void {
    hiddenColumnKeySet.value = new Set();
  }

  return {
    hiddenColumnKeys,
    isHidden,
    toggleColumn,
    hiddenCount,
    resetColumns,
  };
}
