import { computed, ref, watch } from 'vue';
import { preferences } from '../preferences/store';

interface ColumnDef {
  key: string;
  label: string;
  align?: string;
  px: string;
  style: string;
  required: boolean;
}

const allColumns: ColumnDef[] = [
  {
    key: 'icon',
    label: '',
    px: 'px-0',
    style: 'width: 40px;',
    required: true,
  },
  {
    key: 'name',
    label: 'Container',
    align: 'text-left',
    px: 'px-5',
    style: 'width: 99%;',
    required: true,
  },
  {
    key: 'version',
    label: 'Version',
    px: 'px-5',
    style: '',
    required: false,
  },
  { key: 'kind', label: 'Kind', px: 'px-3', style: '', required: false },
  { key: 'status', label: 'Status', px: 'px-3', style: '', required: false },
  {
    key: 'bouncer',
    label: 'Bouncer',
    px: 'px-3',
    style: '',
    required: false,
  },
  { key: 'imageAge', label: 'Image Age', px: 'px-3', style: '', required: false },
  { key: 'server', label: 'Host', px: 'px-3', style: '', required: false },
  {
    key: 'registry',
    label: 'Registry',
    px: 'px-3',
    style: '',
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

export function useColumnVisibility(isCompact: { value: boolean }) {
  const compactVisibleKeys = new Set(['icon', 'name']);
  const activeColumns = computed(() =>
    allColumns.filter(
      (c) => visibleColumns.value.has(c.key) && (!isCompact.value || compactVisibleKeys.has(c.key)),
    ),
  );

  return { allColumns, visibleColumns, activeColumns, showColumnPicker, toggleColumn };
}
