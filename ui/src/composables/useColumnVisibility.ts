import type { ComputedRef, Ref } from 'vue';
import { computed, ref, watch } from 'vue';
import { preferences } from '../preferences/store';
import { type ResponsiveSizingColumn, responsiveAutoHiddenColumns } from '../utils/table-sizing';

interface ColumnDef extends ResponsiveSizingColumn {
  key: string;
  label: string;
  align?: string;
  px: string;
  required: boolean;
}

export const CONTAINER_TABLE_ACTIONS_SIZE = 180;

const allColumns: ColumnDef[] = [
  {
    key: 'icon',
    label: '',
    px: 'px-0',
    size: 40,
    minSize: 40,
    maxSize: 40,
    autoSize: 'fixed',
    required: true,
    icon: true,
  },
  {
    key: 'name',
    label: 'Container',
    align: 'text-left',
    px: 'px-5',
    size: 360,
    minSize: 220,
    maxSize: 640,
    flex: 1,
    priority: 0,
    overflow: 'truncate',
    required: true,
  },
  {
    key: 'version',
    label: 'Version',
    px: 'px-5',
    size: 220,
    minSize: 150,
    maxSize: 320,
    priority: 0,
    overflow: 'truncate',
    required: false,
  },
  {
    key: 'kind',
    label: 'Update',
    px: 'px-3',
    size: 128,
    minSize: 116,
    maxSize: 180,
    priority: 60,
    required: false,
  },
  {
    key: 'status',
    label: 'Status',
    px: 'px-3',
    size: 118,
    minSize: 112,
    maxSize: 160,
    priority: 50,
    required: false,
  },
  {
    key: 'server',
    label: 'Host',
    px: 'px-3',
    size: 152,
    minSize: 132,
    maxSize: 240,
    priority: 70,
    required: false,
  },
  {
    key: 'registry',
    label: 'Registry',
    px: 'px-3',
    size: 126,
    minSize: 116,
    maxSize: 180,
    priority: 80,
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
  if (!col) return;
  if (col?.required) return;
  if (visibleColumns.value.has(key)) visibleColumns.value.delete(key);
  else visibleColumns.value.add(key);
}

export function useColumnVisibility(availableWidth?: Ref<number> | ComputedRef<number>) {
  const preferenceVisibleColumns = computed(() =>
    allColumns.filter((c) => visibleColumns.value.has(c.key)),
  );

  const autoHiddenColumns = computed(() =>
    responsiveAutoHiddenColumns(
      preferenceVisibleColumns.value,
      availableWidth?.value,
      CONTAINER_TABLE_ACTIONS_SIZE,
    ),
  );

  const activeColumns = computed(() => {
    const prefVisible = allColumns.filter((c) => visibleColumns.value.has(c.key));
    const width = availableWidth?.value;
    if (!width || width <= 0) return prefVisible;
    const dropped = new Set(autoHiddenColumns.value.map((column) => column.key));
    return prefVisible.filter((c) => !dropped.has(c.key));
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
