import { computed, nextTick, ref } from 'vue';
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

  it('should include all default columns by default (uptime is opt-in and hidden)', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns, visibleColumns, activeColumns } = useColumnVisibility();
    // allColumns includes the opt-in uptime column; visible/active only include default columns
    expect(visibleColumns.value.size).toBe(allColumns.length - 1);
    expect(activeColumns.value).toHaveLength(allColumns.length - 1);
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
      'server',
      'registry',
      'uptime',
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

  it('should ignore unknown column keys', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns, toggleColumn } = useColumnVisibility();
    const sizeBefore = visibleColumns.value.size;
    toggleColumn('missing-column');
    expect(visibleColumns.value.size).toBe(sizeBefore);
  });

  it('should include all default columns in activeColumns (uptime is opt-in, not active by default)', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns, activeColumns } = useColumnVisibility();
    // uptime is opt-in / hidden by default; active = allColumns minus uptime
    expect(activeColumns.value).toHaveLength(allColumns.length - 1);
    const keys = activeColumns.value.map((c) => c.key);
    expect(keys).toContain('kind');
    expect(keys).toContain('status');
    expect(keys).toContain('server');
    expect(keys).toContain('registry');
    expect(keys).not.toContain('imageAge');
    expect(keys).not.toContain('uptime');
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
    // Default columns exclude the opt-in uptime column (allColumns.length - 1)
    expect(visibleColumns.value.size).toBe(allColumns.length - 1);
    expect(visibleColumns.value.has('icon')).toBe(true);
    expect(visibleColumns.value.has('name')).toBe(true);
  });

  it('should default showColumnPicker to false', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { showColumnPicker } = useColumnVisibility();
    expect(showColumnPicker.value).toBe(false);
  });

  it('should define numeric sizing metadata for every column', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    for (const col of allColumns) {
      expect(col.width).toBeUndefined();
      expect(typeof col.size).toBe('number');
      expect(typeof col.minSize).toBe('number');
    }
  });

  it('keeps host names with numeric suffixes readable by default', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const hostColumn = allColumns.find((col) => col.key === 'server');
    expect(hostColumn?.size).toBeGreaterThanOrEqual(152);
    expect(hostColumn?.minSize).toBeGreaterThanOrEqual(132);
    expect(hostColumn?.maxSize).toBeGreaterThanOrEqual(240);
  });

  it('should expose a shared actions column sizing value for responsive math', async () => {
    const { CONTAINER_TABLE_ACTIONS_SIZE } = await loadColumnVisibility();
    expect(CONTAINER_TABLE_ACTIONS_SIZE).toBe(180);
  });

  describe('responsive auto-hide', () => {
    it('returns all preference-visible columns when availableWidth is undefined', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { allColumns, activeColumns, autoHiddenColumns } = useColumnVisibility(undefined);
      // uptime is opt-in / hidden by default, so visible = allColumns - 1
      expect(activeColumns.value).toHaveLength(allColumns.length - 1);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('returns all preference-visible columns when availableWidth is large', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { allColumns, activeColumns, autoHiddenColumns } = useColumnVisibility(width);
      // uptime is opt-in / hidden by default, so visible = allColumns - 1
      expect(activeColumns.value).toHaveLength(allColumns.length - 1);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('drops registry first as width tightens using column min sizes', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1029);
      const { activeColumns, autoHiddenColumns } = useColumnVisibility(width);
      const activeKeys = activeColumns.value.map((c) => c.key);
      expect(activeKeys).not.toContain('registry');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['registry']);
    });

    it('drops in documented priority order as width tightens further', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(913);
      const { activeColumns, autoHiddenColumns } = useColumnVisibility(width);
      const activeKeys = activeColumns.value.map((c) => c.key);
      expect(activeKeys).not.toContain('registry');
      expect(activeKeys).not.toContain('server');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['registry', 'server']);

      width.value = 797;
      await nextTick();
      const activeKeys2 = activeColumns.value.map((c) => c.key);
      expect(activeKeys2).not.toContain('registry');
      expect(activeKeys2).not.toContain('server');
      expect(activeKeys2).not.toContain('kind');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['registry', 'server', 'kind']);

      width.value = 685;
      await nextTick();
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'registry',
        'server',
        'kind',
        'status',
      ]);
    });

    it('never drops icon, name, or version even at width=0', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(0);
      const { activeColumns, autoHiddenColumns } = useColumnVisibility(width);
      // width=0 → no auto-hide (fallback)
      const activeKeys = activeColumns.value.map((c) => c.key);
      expect(activeKeys).toContain('icon');
      expect(activeKeys).toContain('name');
      expect(activeKeys).toContain('version');
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('never drops icon, name, or version even at very narrow positive width', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1);
      const { activeColumns, autoHiddenColumns } = useColumnVisibility(width);
      const activeKeys = activeColumns.value.map((c) => c.key);
      expect(activeKeys).toContain('icon');
      expect(activeKeys).toContain('name');
      expect(activeKeys).toContain('version');
      // All droppable dropped
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'registry',
        'server',
        'kind',
        'status',
      ]);
    });

    it('respects user toggle-off: hidden-by-preference column not in autoHiddenColumns', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(913);
      const { activeColumns, autoHiddenColumns, toggleColumn } = useColumnVisibility(width);
      // User explicitly hides registry.
      toggleColumn('registry');
      // Registry should not appear in autoHiddenColumns (user preference, not responsive filter).
      expect(autoHiddenColumns.value.map((c) => c.key)).not.toContain('registry');
      // activeColumns also lacks registry.
      expect(activeColumns.value.map((c) => c.key)).not.toContain('registry');
    });

    it('autoHiddenColumns is empty when nothing is auto-hidden', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { autoHiddenColumns } = useColumnVisibility(width);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('autoHiddenColumns lists exactly the dropped columns when some are auto-hidden', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1029);
      const { autoHiddenColumns } = useColumnVisibility(width);
      expect(autoHiddenColumns.value).toHaveLength(1);
      expect(autoHiddenColumns.value[0].key).toBe('registry');
    });

    it('reactivity: changing availableWidth recomputes activeColumns and autoHiddenColumns', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { activeColumns, autoHiddenColumns, allColumns } = useColumnVisibility(width);

      // uptime is opt-in / hidden by default
      expect(activeColumns.value).toHaveLength(allColumns.length - 1);
      expect(autoHiddenColumns.value).toHaveLength(0);

      width.value = 1029;
      await nextTick();
      expect(activeColumns.value.map((c) => c.key)).not.toContain('registry');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['registry']);

      width.value = 5000;
      await nextTick();
      expect(activeColumns.value).toHaveLength(allColumns.length - 1);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('works with a ComputedRef as availableWidth', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const base = ref(5000);
      const width = computed(() => base.value);
      const { activeColumns, autoHiddenColumns, allColumns } = useColumnVisibility(width);

      // uptime is opt-in / hidden by default
      expect(activeColumns.value).toHaveLength(allColumns.length - 1);
      base.value = 1029;
      await nextTick();
      expect(activeColumns.value.map((c) => c.key)).not.toContain('registry');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['registry']);
    });

    it('user-hidden plus narrow viewport: only preference-visible columns are candidates', async () => {
      setTestPreferences({
        containers: { columns: ['icon', 'name', 'version', 'kind', 'status'] },
      });
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(800);
      const { activeColumns, autoHiddenColumns } = useColumnVisibility(width);
      const activeKeys = activeColumns.value.map((c) => c.key);
      expect(activeKeys).toContain('icon');
      expect(activeKeys).toContain('name');
      expect(activeKeys).toContain('version');
      expect(activeKeys).not.toContain('kind');
      expect(activeKeys).toContain('status');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['kind']);
    });
  });

  describe('uptime column (opt-in)', () => {
    it('uptime is in allColumns but not in default visible columns', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { allColumns, visibleColumns } = useColumnVisibility();
      const uptimeInAll = allColumns.some((c) => c.key === 'uptime');
      expect(uptimeInAll).toBe(true);
      expect(visibleColumns.value.has('uptime')).toBe(false);
    });

    it('user can opt in to uptime via toggleColumn', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { visibleColumns, activeColumns, toggleColumn } = useColumnVisibility();
      expect(visibleColumns.value.has('uptime')).toBe(false);

      toggleColumn('uptime');
      expect(visibleColumns.value.has('uptime')).toBe(true);
      expect(activeColumns.value.find((c) => c.key === 'uptime')).toBeDefined();
    });

    it('uptime column has correct sizing metadata', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { allColumns } = useColumnVisibility();
      const uptimeCol = allColumns.find((c) => c.key === 'uptime');
      expect(uptimeCol).toBeDefined();
      expect(typeof uptimeCol!.size).toBe('number');
      expect(typeof uptimeCol!.minSize).toBe('number');
      expect(uptimeCol!.required).toBe(false);
    });

    it('uptime column is auto-hidden at narrow widths when opted in', async () => {
      setTestPreferences({
        containers: {
          columns: ['icon', 'name', 'version', 'kind', 'status', 'server', 'registry', 'uptime'],
        },
      });
      const { useColumnVisibility } = await loadColumnVisibility();
      // At a very narrow width uptime should be among the first to be auto-hidden (priority 90)
      const width = ref(1);
      const { autoHiddenColumns } = useColumnVisibility(width);
      expect(autoHiddenColumns.value.map((c) => c.key)).toContain('uptime');
    });
  });
});
