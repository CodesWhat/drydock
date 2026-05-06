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

  describe('responsive auto-hide', () => {
    // Column widths: icon=40 name=360 version=260 kind=130 status=120 imageAge=90 server=100 registry=120
    // Total all 8 cols = 1220px. ACTIONS_OVERHEAD = 204px.
    // Drop order: imageAge(90) → registry(120) → server(100) → kind(130) → status(120)

    it('returns all preference-visible columns when availableWidth is undefined', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { allColumns, activeColumns, autoHiddenColumns } = useColumnVisibility(undefined);
      expect(activeColumns.value).toHaveLength(allColumns.length);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('returns all preference-visible columns when availableWidth is large', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { allColumns, activeColumns, autoHiddenColumns } = useColumnVisibility(width);
      expect(activeColumns.value).toHaveLength(allColumns.length);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('drops imageAge first as width tightens (exactly at threshold)', async () => {
      // budget = 1334 - 204 = 1130; sum=1220 > 1130; drop imageAge(90) → 1130 = 1130 ✓
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1334);
      const { activeColumns, autoHiddenColumns } = useColumnVisibility(width);
      const activeKeys = activeColumns.value.map((c) => c.key);
      expect(activeKeys).not.toContain('imageAge');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['imageAge']);
    });

    it('drops in documented priority order as width tightens further', async () => {
      // budget = 1333 - 204 = 1129; sum=1220; drop imageAge → 1130 > 1129; drop registry → 1010 ≤ 1129
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1333);
      const { activeColumns, autoHiddenColumns } = useColumnVisibility(width);
      const activeKeys = activeColumns.value.map((c) => c.key);
      expect(activeKeys).not.toContain('imageAge');
      expect(activeKeys).not.toContain('registry');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['imageAge', 'registry']);

      // Further tighten to also drop server
      // budget = 1209 - 204 = 1005; sum=1220; drop imageAge→1130>1005; drop registry→1010>1005; drop server→910≤1005
      width.value = 1209;
      await nextTick();
      const activeKeys2 = activeColumns.value.map((c) => c.key);
      expect(activeKeys2).not.toContain('imageAge');
      expect(activeKeys2).not.toContain('registry');
      expect(activeKeys2).not.toContain('server');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['imageAge', 'registry', 'server']);

      // Further: drop kind too
      // budget = 1109 - 204 = 905; sum=1220; drop imageAge→1130, registry→1010, server→910>905; drop kind→780≤905
      width.value = 1109;
      await nextTick();
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'imageAge',
        'registry',
        'server',
        'kind',
      ]);

      // Further: drop status too
      // budget = 979 - 204 = 775; sum=1220; drop all 5 droppable → 1220-90-120-100-130-120=660≤775
      width.value = 979;
      await nextTick();
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'imageAge',
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
        'imageAge',
        'registry',
        'server',
        'kind',
        'status',
      ]);
    });

    it('respects user toggle-off: hidden-by-preference column not in autoHiddenColumns', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1334); // drops imageAge at this width
      const { activeColumns, autoHiddenColumns, toggleColumn } = useColumnVisibility(width);
      // User explicitly hides imageAge
      toggleColumn('imageAge');
      // imageAge should not appear in autoHiddenColumns (user preference, not responsive filter)
      expect(autoHiddenColumns.value.map((c) => c.key)).not.toContain('imageAge');
      // activeColumns also lacks imageAge
      expect(activeColumns.value.map((c) => c.key)).not.toContain('imageAge');
    });

    it('autoHiddenColumns is empty when nothing is auto-hidden', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { autoHiddenColumns } = useColumnVisibility(width);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('autoHiddenColumns lists exactly the dropped columns when some are auto-hidden', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1334);
      const { autoHiddenColumns } = useColumnVisibility(width);
      expect(autoHiddenColumns.value).toHaveLength(1);
      expect(autoHiddenColumns.value[0].key).toBe('imageAge');
    });

    it('reactivity: changing availableWidth recomputes activeColumns and autoHiddenColumns', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { activeColumns, autoHiddenColumns, allColumns } = useColumnVisibility(width);

      expect(activeColumns.value).toHaveLength(allColumns.length);
      expect(autoHiddenColumns.value).toHaveLength(0);

      width.value = 1334;
      await nextTick();
      expect(activeColumns.value.map((c) => c.key)).not.toContain('imageAge');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['imageAge']);

      width.value = 5000;
      await nextTick();
      expect(activeColumns.value).toHaveLength(allColumns.length);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('works with a ComputedRef as availableWidth', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const base = ref(5000);
      const width = computed(() => base.value);
      const { activeColumns, autoHiddenColumns, allColumns } = useColumnVisibility(width);

      expect(activeColumns.value).toHaveLength(allColumns.length);
      base.value = 1334;
      await nextTick();
      expect(activeColumns.value.map((c) => c.key)).not.toContain('imageAge');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['imageAge']);
    });

    it('user-hidden plus narrow viewport: only preference-visible columns are candidates', async () => {
      setTestPreferences({
        containers: { columns: ['icon', 'name', 'version', 'kind', 'status'] },
      });
      const { useColumnVisibility } = await loadColumnVisibility();
      // imageAge, server, registry already hidden by preference
      // At tight width, only kind/status can be dropped from the visible set
      // sum of visible = 40+360+260+130+120=910; budget at width=800: 800-204=596; need to drop
      // drop imageAge? not visible → skip. drop registry? not visible → skip. drop server? not visible → skip.
      // drop kind(130) → 910-130=780 > 596. drop status(120) → 780-120=660 > 596. exhausted.
      const width = ref(800);
      const { activeColumns, autoHiddenColumns } = useColumnVisibility(width);
      const activeKeys = activeColumns.value.map((c) => c.key);
      expect(activeKeys).toContain('icon');
      expect(activeKeys).toContain('name');
      expect(activeKeys).toContain('version');
      expect(activeKeys).not.toContain('kind');
      expect(activeKeys).not.toContain('status');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['kind', 'status']);
    });
  });
});
