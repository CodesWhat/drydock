import type { ComputedRef, Ref } from 'vue';
import { computed, ref, watch } from 'vue';
import { preferences } from '../preferences/store';

interface ColumnDef {
  key: string;
  label: string;
  align?: string;
  px: string;
  width: string;
  required: boolean;
}

const RESPONSIVE_DROP_ORDER = ['imageAge', 'registry', 'server', 'kind', 'status'] as const;

// Overhead to subtract from availableWidth before comparing against column widths.
// Matches actions-width="180px" in ContainersGroupedViews.vue plus a safety buffer.
const ACTIONS_OVERHEAD_PX = 180 + 24;

const allColumns: ColumnDef[] = [
  {
    key: 'icon',
    label: '',
    px: 'px-0',
    width: '40px',
    required: true,
  },
  {
    key: 'name',
    label: 'Container',
    align: 'text-left',
    px: 'px-5',
    width: '360px',
    required: true,
  },
  {
    key: 'version',
    label: 'Version',
    px: 'px-5',
    width: '260px',
    required: false,
  },
  { key: 'kind', label: 'Kind', px: 'px-3', width: '130px', required: false },
  { key: 'status', label: 'Status', px: 'px-3', width: '120px', required: false },
  { key: 'imageAge', label: 'Image Age', px: 'px-3', width: '90px', required: false },
  { key: 'server', label: 'Host', px: 'px-3', width: '100px', required: false },
  {
    key: 'registry',
    label: 'Registry',
    px: 'px-3',
    width: '120px',
    required: false,
  },
];

const visibleColumns = ref<Set<string>>(new Set(preferences.containers.columns));
watch(
  visibleColumns,
  (v) => {
    preferences.containers.columns = [...v];
  },
  { deep: true },
);

const showColumnPicker = ref(false);

function toggleColumn(key: string) {
  const col = allColumns.find((c) => c.key === key);
  if (col?.required) return;
  if (visibleColumns.value.has(key)) visibleColumns.value.delete(key);
  else visibleColumns.value.add(key);
}

export function useColumnVisibility(availableWidth?: Ref<number> | ComputedRef<number>) {
  const activeColumns = computed(() => {
    const prefVisible = allColumns.filter((c) => visibleColumns.value.has(c.key));
    const width = availableWidth?.value;
    if (!width || width <= 0) return prefVisible;

    const budget = width - ACTIONS_OVERHEAD_PX;
    const dropped = new Set<string>();
    let sum = prefVisible.reduce((acc, c) => acc + parseInt(c.width, 10), 0);

    for (const key of RESPONSIVE_DROP_ORDER) {
      if (sum <= budget) break;
      const col = prefVisible.find((c) => c.key === key);
      if (!col) continue;
      dropped.add(key);
      sum -= parseInt(col.width, 10);
    }

    return prefVisible.filter((c) => !dropped.has(c.key));
  });

  const autoHiddenColumns = computed(() => {
    const width = availableWidth?.value;
    if (!width || width <= 0) return [] as ColumnDef[];

    const prefVisible = allColumns.filter((c) => visibleColumns.value.has(c.key));
    const budget = width - ACTIONS_OVERHEAD_PX;
    const dropped: ColumnDef[] = [];
    let sum = prefVisible.reduce((acc, c) => acc + parseInt(c.width, 10), 0);

    for (const key of RESPONSIVE_DROP_ORDER) {
      if (sum <= budget) break;
      const col = prefVisible.find((c) => c.key === key);
      if (!col) continue;
      dropped.push(col);
      sum -= parseInt(col.width, 10);
    }

    return dropped;
  });

  return {
    allColumns,
    visibleColumns,
    activeColumns,
    autoHiddenColumns,
    showColumnPicker,
    toggleColumn,
  };
}
