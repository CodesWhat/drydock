import type { ComputedRef, Ref } from 'vue';
import { computed, ref, watch } from 'vue';
import { CONTAINER_TABLE_COLUMN_KEYS } from '../preferences/schema';
import { preferences } from '../preferences/store';
import { type ResponsiveSizingColumn, responsiveAutoHiddenColumns } from '../utils/table-sizing';

interface ColumnDef extends ResponsiveSizingColumn {
  key: string;
  label: string;
  labelKey?: string;
  headerTooltipKey?: string;
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
    // 56 = 32px ContainerIcon (ContainersGroupedViews.vue) + 20px pl-5 padding + 4px breathing
    // room. Was 40 until the icon cell gained `overflow-hidden`: that class made the pre-existing
    // ~11.9px overflow (32px icon inside a 20px content box) visibly clip instead of silently
    // hanging past the cell edge. Keep this >= 52 (icon + padding) or the clip comes back.
    size: 56,
    minSize: 56,
    maxSize: 56,
    autoSize: 'fixed',
    required: true,
    icon: true,
  },
  {
    key: 'name',
    label: 'Container',
    labelKey: 'containersView.columns.container',
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
    label: 'Tag',
    labelKey: 'containersView.columns.tag',
    px: 'px-5',
    size: 220,
    minSize: 150,
    maxSize: 320,
    priority: 0,
    overflow: 'truncate',
    required: false,
  },
  {
    key: 'softwareVersion',
    label: 'Software Version',
    labelKey: 'containersView.columns.version',
    headerTooltipKey: 'containersView.columns.versionTooltip',
    px: 'px-5',
    size: 220,
    minSize: 150,
    maxSize: 320,
    // At laptop widths the Tag column already carries current → newer. Prefer
    // keeping Host visible and drop this secondary image metadata first (#498).
    priority: 70,
    overflow: 'truncate',
    required: false,
  },
  {
    key: 'kind',
    label: 'Update',
    labelKey: 'containersView.columns.update',
    headerTooltipKey: 'containersView.columns.updateTooltip',
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
    labelKey: 'containersView.columns.status',
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
    labelKey: 'containersView.columns.host',
    px: 'px-3',
    size: 152,
    minSize: 132,
    maxSize: 240,
    priority: 5,
    required: false,
  },
  {
    key: 'registry',
    label: 'Registry',
    labelKey: 'containersView.columns.registry',
    px: 'px-3',
    size: 126,
    minSize: 116,
    maxSize: 180,
    priority: 80,
    required: false,
  },
  {
    key: 'links',
    label: 'Resources',
    labelKey: 'containersView.columns.resources',
    px: 'px-1',
    size: 152,
    minSize: 152,
    maxSize: 152,
    autoSize: 'fixed',
    // Visible by default, but user-hideable (#498). The same shortcuts remain
    // available from the row's More menu, cards, and container detail views.
    required: false,
  },
  {
    key: 'uptime',
    label: 'Uptime',
    labelKey: 'containersView.columns.uptime',
    px: 'px-3',
    size: 120,
    minSize: 100,
    maxSize: 180,
    priority: 90,
    required: false,
  },
];
// Containers no longer carries per-column `cardPriority` annotations: this view ships a
// hand-authored `#card` template (ContainersGroupedViews.vue) instead of DataTable's generic
// cardPriority-driven card composition, so those annotations would be inert and misleading.

const visibleColumns = ref<Set<string>>(new Set(preferences.containers.columns));
watch(
  visibleColumns,
  (v) => {
    preferences.containers.columns = [...v];
  },
  { deep: true },
);

function toggleColumn(key: string) {
  const col = allColumns.find((c) => c.key === key);
  if (!col) return;
  if (col?.required) return;
  if (visibleColumns.value.has(key)) visibleColumns.value.delete(key);
  else visibleColumns.value.add(key);
}

/** Resets picker-driven visibility back to the shipped default (opt-in columns stay hidden). */
function resetColumns() {
  visibleColumns.value = new Set(CONTAINER_TABLE_COLUMN_KEYS);
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

  /**
   * Full DataTable-facing hidden set: catalog keys the user picker-hid, unioned with
   * width-driven auto-hidden keys. Table mode (DataTable `hiddenColumnKeys` prop) honors
   * both; card mode (< 640px) ignores this entirely by design — see DataTable.vue. Always
   * derived from the FULL `allColumns` catalog (not a pre-filtered subset) so card mode can
   * still see every column object, including opt-in ones the user never enabled.
   */
  const hiddenColumnKeys = computed<string[]>(() => {
    const autoHidden = new Set(autoHiddenColumns.value.map((column) => column.key));
    return allColumns
      .filter((column) => !visibleColumns.value.has(column.key) || autoHidden.has(column.key))
      .map((column) => column.key);
  });

  return {
    allColumns,
    visibleColumns,
    autoHiddenColumns,
    hiddenColumnKeys,
    toggleColumn,
    resetColumns,
  };
}
