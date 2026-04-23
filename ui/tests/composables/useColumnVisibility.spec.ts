import { nextTick } from 'vue';
import { setTestPreferences } from '../helpers/preferences';

describe('useColumnVisibility', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function loadColumnVisibility() {
    const mod = await import('@/composables/useColumnVisibility');
    return mod;
  }

  it('should include all columns by default', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns, visibleColumns, activeColumns } = useColumnVisibility();
    expect(visibleColumns.value.size).toBe(allColumns.length);
    expect(activeColumns.value).toHaveLength(allColumns.length);
  });

  it('should expose correct column keys', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const keys = allColumns.map((c) => c.key);
    expect(keys).toEqual([
      'icon',
      'name',
      'version',
      'kind',
      'status',
      'imageAge',
      'server',
      'registry',
    ]);
  });

  it('should mark icon and name as required', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const required = allColumns.filter((c) => c.required).map((c) => c.key);
    expect(required).toEqual(['icon', 'name']);
  });

  it('should toggle a non-required column off', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns, activeColumns, toggleColumn } = useColumnVisibility();
    expect(visibleColumns.value.has('version')).toBe(true);

    toggleColumn('version');
    expect(visibleColumns.value.has('version')).toBe(false);
    expect(activeColumns.value.find((c) => c.key === 'version')).toBeUndefined();
  });

  it('should toggle a column back on', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns, toggleColumn } = useColumnVisibility();
    toggleColumn('version');
    expect(visibleColumns.value.has('version')).toBe(false);
    toggleColumn('version');
    expect(visibleColumns.value.has('version')).toBe(true);
  });

  it('should not toggle required columns', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns, toggleColumn } = useColumnVisibility();
    toggleColumn('icon');
    expect(visibleColumns.value.has('icon')).toBe(true);
    toggleColumn('name');
    expect(visibleColumns.value.has('name')).toBe(true);
  });

  it('should include all columns in activeColumns regardless of external compact state', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns, activeColumns } = useColumnVisibility();
    expect(activeColumns.value).toHaveLength(allColumns.length);
    const keys = activeColumns.value.map((c) => c.key);
    expect(keys).toContain('kind');
    expect(keys).toContain('status');
    expect(keys).toContain('imageAge');
    expect(keys).toContain('server');
    expect(keys).toContain('registry');
  });

  it('should keep kind and status in activeColumns and allow toggling them off', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { activeColumns, visibleColumns, toggleColumn } = useColumnVisibility();
    expect(activeColumns.value.find((c) => c.key === 'kind')).toBeDefined();
    expect(activeColumns.value.find((c) => c.key === 'status')).toBeDefined();

    toggleColumn('kind');
    expect(visibleColumns.value.has('kind')).toBe(false);
    expect(activeColumns.value.find((c) => c.key === 'kind')).toBeUndefined();

    toggleColumn('status');
    expect(visibleColumns.value.has('status')).toBe(false);
    expect(activeColumns.value.find((c) => c.key === 'status')).toBeUndefined();
  });

  it('should persist visible columns to preferences', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { toggleColumn } = useColumnVisibility();
    toggleColumn('kind');
    await nextTick();
    const { flushPreferences } = await import('@/preferences/store');
    flushPreferences();
    const stored = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}').containers.columns;
    expect(stored).not.toContain('kind');
  });

  it('should restore visible columns from preferences', async () => {
    setTestPreferences({ containers: { columns: ['icon', 'name', 'status'] } });
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns } = useColumnVisibility();
    expect(visibleColumns.value.size).toBe(3);
    expect(visibleColumns.value.has('version')).toBe(false);
    expect(visibleColumns.value.has('status')).toBe(true);
  });

  it('should fall back to defaults when preferences contain invalid data', async () => {
    localStorage.setItem('dd-preferences', '{invalid json');
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns, visibleColumns } = useColumnVisibility();
    expect(visibleColumns.value.size).toBe(allColumns.length);
    expect(visibleColumns.value.has('icon')).toBe(true);
    expect(visibleColumns.value.has('name')).toBe(true);
  });

  it('should default showColumnPicker to false', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { showColumnPicker } = useColumnVisibility();
    expect(showColumnPicker.value).toBe(false);
  });

  it('should define a non-empty width for every column', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    for (const col of allColumns) {
      expect(col.width).toBeTruthy();
    }
  });
});
