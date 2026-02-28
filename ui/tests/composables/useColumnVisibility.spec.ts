import { nextTick, ref } from 'vue';

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
    const isCompact = ref(false);
    const { allColumns, visibleColumns, activeColumns } = useColumnVisibility(isCompact);
    expect(visibleColumns.value.size).toBe(allColumns.length);
    expect(activeColumns.value).toHaveLength(allColumns.length);
  });

  it('should expose correct column keys', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility(ref(false));
    const keys = allColumns.map((c) => c.key);
    expect(keys).toEqual([
      'icon',
      'name',
      'version',
      'kind',
      'status',
      'bouncer',
      'server',
      'registry',
    ]);
  });

  it('should mark icon and name as required', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility(ref(false));
    const required = allColumns.filter((c) => c.required).map((c) => c.key);
    expect(required).toEqual(['icon', 'name']);
  });

  it('should toggle a non-required column off', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const isCompact = ref(false);
    const { visibleColumns, activeColumns, toggleColumn } = useColumnVisibility(isCompact);
    expect(visibleColumns.value.has('version')).toBe(true);

    toggleColumn('version');
    expect(visibleColumns.value.has('version')).toBe(false);
    expect(activeColumns.value.find((c) => c.key === 'version')).toBeUndefined();
  });

  it('should toggle a column back on', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns, toggleColumn } = useColumnVisibility(ref(false));
    toggleColumn('version');
    expect(visibleColumns.value.has('version')).toBe(false);
    toggleColumn('version');
    expect(visibleColumns.value.has('version')).toBe(true);
  });

  it('should not toggle required columns', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns, toggleColumn } = useColumnVisibility(ref(false));
    toggleColumn('icon');
    expect(visibleColumns.value.has('icon')).toBe(true);
    toggleColumn('name');
    expect(visibleColumns.value.has('name')).toBe(true);
  });

  it('should filter to compact columns when isCompact is true', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const isCompact = ref(true);
    const { activeColumns } = useColumnVisibility(isCompact);
    const keys = activeColumns.value.map((c) => c.key);
    expect(keys).toEqual(['icon', 'name']);
  });

  it('should restore full columns when isCompact toggles back to false', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const isCompact = ref(true);
    const { allColumns, activeColumns } = useColumnVisibility(isCompact);
    expect(activeColumns.value).toHaveLength(2);

    isCompact.value = false;
    await nextTick();
    expect(activeColumns.value).toHaveLength(allColumns.length);
  });

  it('should persist visible columns to localStorage', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { toggleColumn } = useColumnVisibility(ref(false));
    toggleColumn('bouncer');
    await nextTick();
    const stored = JSON.parse(localStorage.getItem('dd-table-cols-v1') || '[]');
    expect(stored).not.toContain('bouncer');
  });

  it('should restore visible columns from localStorage', async () => {
    localStorage.setItem('dd-table-cols-v1', JSON.stringify(['icon', 'name', 'status']));
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns } = useColumnVisibility(ref(false));
    expect(visibleColumns.value.size).toBe(3);
    expect(visibleColumns.value.has('version')).toBe(false);
    expect(visibleColumns.value.has('status')).toBe(true);
  });

  it('should default showColumnPicker to false', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { showColumnPicker } = useColumnVisibility(ref(false));
    expect(showColumnPicker.value).toBe(false);
  });
});
