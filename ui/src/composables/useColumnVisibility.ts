import { computed, ref, watch } from 'vue';

export interface ColumnDef {
  key: string;
  label: string;
  align: string;
  px: string;
  style: string;
  required: boolean;
}

const allColumns: ColumnDef[] = [
  {
    key: 'icon',
    label: '',
    align: 'text-center',
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
    align: 'text-center',
    px: 'px-5',
    style: '',
    required: false,
  },
  { key: 'kind', label: 'Kind', align: 'text-center', px: 'px-3', style: '', required: false },
  { key: 'status', label: 'Status', align: 'text-center', px: 'px-3', style: '', required: false },
  {
    key: 'bouncer',
    label: 'Bouncer',
    align: 'text-center',
    px: 'px-3',
    style: '',
    required: false,
  },
  { key: 'server', label: 'Host', align: 'text-center', px: 'px-3', style: '', required: false },
  {
    key: 'registry',
    label: 'Registry',
    align: 'text-center',
    px: 'px-3',
    style: '',
    required: false,
  },
];

const defaultVisibleCols = allColumns.map((c) => c.key);
const STORAGE_KEY = 'dd-table-cols-v1';
const visibleColumns = ref<Set<string>>(
  new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || defaultVisibleCols),
);
watch(visibleColumns, (v) => localStorage.setItem(STORAGE_KEY, JSON.stringify([...v])), {
  deep: true,
});

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
