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
    const { allColumns, visibleColumns, hiddenColumnKeys } = useColumnVisibility();
    // allColumns includes the opt-in uptime column; visible only includes default columns
    expect(visibleColumns.value.size).toBe(allColumns.length - 1);
    expect(hiddenColumnKeys.value).toEqual(['uptime']);
  });

  it('should expose correct column keys', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const keys = allColumns.map((c) => c.key);
    expect(keys).toEqual([
      'icon',
      'name',
      'version',
      'softwareVersion',
      'kind',
      'status',
      'server',
      'registry',
      'links',
      'uptime',
    ]);
  });

  it('version column should be labelled Tag', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const versionCol = allColumns.find((c) => c.key === 'version');
    expect(versionCol?.label).toBe('Tag');
    expect(versionCol?.labelKey).toBe('containersView.columns.tag');
  });

  it('labels the secondary field as Software Version so it is not confused with Tag (#498)', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const swVerCol = allColumns.find((c) => c.key === 'softwareVersion');
    expect(swVerCol?.label).toBe('Software Version');
    expect(swVerCol?.labelKey).toBe('containersView.columns.version');
    expect(swVerCol?.headerTooltipKey).toBe('containersView.columns.versionTooltip');
  });

  it('softwareVersion column should be visible by default', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns } = useColumnVisibility();
    expect(visibleColumns.value.has('softwareVersion')).toBe(true);
  });

  it('kind column has headerTooltipKey for the Update column tooltip', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const kindCol = allColumns.find((c) => c.key === 'kind');
    expect(kindCol?.headerTooltipKey).toBe('containersView.columns.updateTooltip');
  });

  it('columns without extra semantics do not have a headerTooltipKey', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const plainColumns = allColumns.filter((c) => c.key !== 'kind' && c.key !== 'softwareVersion');
    for (const col of plainColumns) {
      expect(col.headerTooltipKey).toBeUndefined();
    }
  });

  it('keeps only row identity columns required so Resources can be hidden (#498)', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const required = allColumns.filter((c) => c.required).map((c) => c.key);
    expect(required).toEqual(['icon', 'name']);
  });

  it('should toggle a non-required column off', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns, hiddenColumnKeys, toggleColumn } = useColumnVisibility();
    expect(visibleColumns.value.has('version')).toBe(true);

    toggleColumn('version');
    expect(visibleColumns.value.has('version')).toBe(false);
    expect(hiddenColumnKeys.value).toContain('version');
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

  it('allows Resources to be hidden and persists that preference (#498)', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { hiddenColumnKeys, visibleColumns, toggleColumn } = useColumnVisibility();

    expect(visibleColumns.value.has('links')).toBe(true);
    toggleColumn('links');
    expect(visibleColumns.value.has('links')).toBe(false);
    expect(hiddenColumnKeys.value).toContain('links');

    await nextTick();
    const { flushPreferences } = await import('@/preferences/store');
    flushPreferences();
    const stored = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}').containers.columns;
    expect(stored).not.toContain('links');
  });

  it('should ignore unknown column keys', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { visibleColumns, toggleColumn } = useColumnVisibility();
    const sizeBefore = visibleColumns.value.size;
    toggleColumn('missing-column');
    expect(visibleColumns.value.size).toBe(sizeBefore);
  });

  it('should keep kind and status visible by default and allow toggling them off', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { hiddenColumnKeys, visibleColumns, toggleColumn } = useColumnVisibility();
    expect(hiddenColumnKeys.value).not.toContain('kind');
    expect(hiddenColumnKeys.value).not.toContain('status');

    toggleColumn('kind');
    expect(visibleColumns.value.has('kind')).toBe(false);
    expect(hiddenColumnKeys.value).toContain('kind');

    toggleColumn('status');
    expect(visibleColumns.value.has('status')).toBe(false);
    expect(hiddenColumnKeys.value).toContain('status');
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
    expect(visibleColumns.value.has('links')).toBe(false);
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

  it('should define numeric sizing metadata for every column', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    for (const col of allColumns) {
      expect(col.width).toBeUndefined();
      expect(typeof col.size).toBe('number');
      expect(typeof col.minSize).toBe('number');
    }
  });

  it('sizes the icon column to fit its 32px ContainerIcon plus pl-5 padding (>= 52px)', async () => {
    // Regression guard: the icon cell renders a 32px ContainerIcon (ContainersGroupedViews.vue)
    // inside `pl-5` (20px) padding. DataTable's icon cells have `overflow-hidden`, so if this
    // column's size/minSize ever shrinks back below 52 (32 + 20), the icon silently clips again
    // instead of just hanging unseen past the cell edge like it used to.
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const iconCol = allColumns.find((c) => c.key === 'icon');
    const ICON_PLUS_PADDING_PX = 52;
    expect(iconCol?.size).toBeGreaterThanOrEqual(ICON_PLUS_PADDING_PX);
    expect(iconCol?.minSize).toBeGreaterThanOrEqual(ICON_PLUS_PADDING_PX);
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

  it('fits three 44px resource targets plus gaps inside the fixed Resources content box', async () => {
    const { useColumnVisibility } = await loadColumnVisibility();
    const { allColumns } = useColumnVisibility();
    const resources = allColumns.find((column) => column.key === 'links');

    // Three sm AppIconButtons need 3 * 44px plus two 4px gaps. `px-1` leaves a
    // 144px content box in this 152px fixed column; `px-2` leaves only 136px.
    expect(resources).toMatchObject({
      px: 'px-1',
      size: 152,
      minSize: 152,
      maxSize: 152,
      autoSize: 'fixed',
    });
  });

  // `cardPriority` per-column annotations were removed from ColumnDef: containers now ships a
  // hand-authored #card template (ContainersGroupedViews.vue) instead of DataTable's generic
  // cardPriority-driven card composition, so the annotations would be inert. See
  // ContainersGroupedViews.spec.ts for card-mode coverage instead.
  describe('auto-hide priority (unaffected by cardPriority removal)', () => {
    it('keeps Host ahead of the redundant software Version column', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { allColumns } = useColumnVisibility();
      const byKey = Object.fromEntries(allColumns.map((c) => [c.key, c.priority]));
      expect(byKey.kind).toBe(60);
      expect(byKey.status).toBe(50);
      expect(byKey.server).toBe(5);
      expect(byKey.softwareVersion).toBe(70);
      expect(byKey.registry).toBe(80);
      expect(byKey.uptime).toBe(90);
    });
  });

  describe('responsive auto-hide', () => {
    it('auto-hides software Version instead of Host at a laptop-width content budget (#498)', async () => {
      setTestPreferences({
        containers: {
          columns: [
            'icon',
            'name',
            'version',
            'softwareVersion',
            'kind',
            'status',
            'server',
            'links',
          ],
        },
      });
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1136);
      const { autoHiddenColumns } = useColumnVisibility(width);

      expect(autoHiddenColumns.value.map((column) => column.key)).toEqual(['softwareVersion']);
      expect(autoHiddenColumns.value.map((column) => column.key)).not.toContain('server');
    });

    it('auto-hides nothing when availableWidth is undefined', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { hiddenColumnKeys, autoHiddenColumns } = useColumnVisibility(undefined);
      // uptime is opt-in / hidden by default; nothing else is auto-hidden
      expect(hiddenColumnKeys.value).toEqual(['uptime']);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('auto-hides nothing when availableWidth is large', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { hiddenColumnKeys, autoHiddenColumns } = useColumnVisibility(width);
      expect(hiddenColumnKeys.value).toEqual(['uptime']);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('drops registry first as width tightens using column min sizes', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      // Keep Host visible at laptop widths; the secondary software-version column
      // yields before it while the default-visible Resources column uses its fixed footprint (#498).
      const width = ref(1029);
      const { hiddenColumnKeys, autoHiddenColumns } = useColumnVisibility(width);
      expect(hiddenColumnKeys.value).toContain('registry');
      expect(hiddenColumnKeys.value).not.toContain('server');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'registry',
        'softwareVersion',
        'kind',
      ]);
    });

    it('drops in documented priority order as width tightens further', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      // Host stays ahead of the secondary software-version column at laptop widths.
      const width = ref(913);
      const { hiddenColumnKeys, autoHiddenColumns } = useColumnVisibility(width);
      expect(hiddenColumnKeys.value).toContain('registry');
      expect(hiddenColumnKeys.value).not.toContain('server');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'registry',
        'softwareVersion',
        'kind',
        'status',
      ]);

      width.value = 797;
      await nextTick();
      expect(hiddenColumnKeys.value).toContain('registry');
      expect(hiddenColumnKeys.value).toContain('server');
      expect(hiddenColumnKeys.value).toContain('kind');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'registry',
        'softwareVersion',
        'kind',
        'status',
        'server',
      ]);

      width.value = 685;
      await nextTick();
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'registry',
        'softwareVersion',
        'kind',
        'status',
        'server',
      ]);
    });

    it('does not auto-hide identity, tag, or default-visible Resources at width=0', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(0);
      const { hiddenColumnKeys, autoHiddenColumns } = useColumnVisibility(width);
      // width=0 → no auto-hide (fallback)
      expect(hiddenColumnKeys.value).not.toContain('icon');
      expect(hiddenColumnKeys.value).not.toContain('name');
      expect(hiddenColumnKeys.value).not.toContain('version');
      expect(hiddenColumnKeys.value).not.toContain('links');
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('does not auto-hide identity, tag, or default-visible Resources at very narrow widths', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1);
      const { hiddenColumnKeys, autoHiddenColumns } = useColumnVisibility(width);
      expect(hiddenColumnKeys.value).not.toContain('icon');
      expect(hiddenColumnKeys.value).not.toContain('name');
      expect(hiddenColumnKeys.value).not.toContain('version');
      expect(hiddenColumnKeys.value).not.toContain('links');
      // All droppable columns dropped (softwareVersion priority 5 > 0, so it is droppable)
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'registry',
        'softwareVersion',
        'kind',
        'status',
        'server',
      ]);
    });

    it('respects user toggle-off: hidden-by-preference column not in autoHiddenColumns', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(913);
      const { hiddenColumnKeys, autoHiddenColumns, toggleColumn } = useColumnVisibility(width);
      // User explicitly hides registry.
      toggleColumn('registry');
      // Registry should not appear in autoHiddenColumns (user preference, not responsive filter).
      expect(autoHiddenColumns.value.map((c) => c.key)).not.toContain('registry');
      // hiddenColumnKeys still lists it — it's hidden either way, just via the picker.
      expect(hiddenColumnKeys.value).toContain('registry');
    });

    it('autoHiddenColumns is empty when nothing is auto-hidden', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { autoHiddenColumns } = useColumnVisibility(width);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('autoHiddenColumns lists exactly the dropped columns when some are auto-hidden', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      // At 1029 the default-visible fixed Resources column pushes three responsive columns out.
      const width = ref(1029);
      const { autoHiddenColumns } = useColumnVisibility(width);
      expect(autoHiddenColumns.value).toHaveLength(3);
      expect(autoHiddenColumns.value[0].key).toBe('registry');
      expect(autoHiddenColumns.value[1].key).toBe('softwareVersion');
      expect(autoHiddenColumns.value[2].key).toBe('kind');
    });

    it('reactivity: changing availableWidth recomputes hiddenColumnKeys and autoHiddenColumns', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { hiddenColumnKeys, autoHiddenColumns } = useColumnVisibility(width);

      // uptime is opt-in / hidden by default
      expect(hiddenColumnKeys.value).toEqual(['uptime']);
      expect(autoHiddenColumns.value).toHaveLength(0);

      width.value = 1029;
      await nextTick();
      expect(hiddenColumnKeys.value).toContain('registry');
      // At 1029, default-visible Resources remains while responsive columns reflow.
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'registry',
        'softwareVersion',
        'kind',
      ]);

      width.value = 5000;
      await nextTick();
      expect(hiddenColumnKeys.value).toEqual(['uptime']);
      expect(autoHiddenColumns.value).toHaveLength(0);
    });

    it('works with a ComputedRef as availableWidth', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const base = ref(5000);
      const width = computed(() => base.value);
      const { hiddenColumnKeys, autoHiddenColumns } = useColumnVisibility(width);

      // uptime is opt-in / hidden by default
      expect(hiddenColumnKeys.value).toEqual(['uptime']);
      base.value = 1029;
      await nextTick();
      expect(hiddenColumnKeys.value).toContain('registry');
      // At 1029, default-visible Resources remains while responsive columns reflow.
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'registry',
        'softwareVersion',
        'kind',
      ]);
    });

    it('user-hidden plus narrow viewport: only preference-visible columns are candidates', async () => {
      setTestPreferences({
        containers: { columns: ['icon', 'name', 'version', 'kind', 'status'] },
      });
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(800);
      const { hiddenColumnKeys, autoHiddenColumns } = useColumnVisibility(width);
      expect(hiddenColumnKeys.value).not.toContain('icon');
      expect(hiddenColumnKeys.value).not.toContain('name');
      expect(hiddenColumnKeys.value).not.toContain('version');
      expect(hiddenColumnKeys.value).toContain('kind');
      expect(hiddenColumnKeys.value).not.toContain('status');
      expect(hiddenColumnKeys.value).toContain('links');
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual(['kind']);
    });
  });

  describe('hiddenColumnKeys (union of picker-hidden and width-auto-hidden)', () => {
    it('lists only picker-hidden columns when nothing is auto-hidden', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { hiddenColumnKeys, toggleColumn } = useColumnVisibility(width);
      toggleColumn('registry');
      expect(hiddenColumnKeys.value.sort()).toEqual(['registry', 'uptime'].sort());
    });

    it('lists only auto-hidden columns when nothing is picker-hidden beyond the opt-in default', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1029);
      const { hiddenColumnKeys, autoHiddenColumns } = useColumnVisibility(width);
      expect(autoHiddenColumns.value.map((c) => c.key)).toEqual([
        'registry',
        'softwareVersion',
        'kind',
      ]);
      // hiddenColumnKeys is the union of responsive optional columns and opt-in uptime.
      expect(hiddenColumnKeys.value.sort()).toEqual(
        ['kind', 'registry', 'softwareVersion', 'uptime'].sort(),
      );
    });

    it('unions picker-hidden and auto-hidden without duplicates', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(1029);
      const { hiddenColumnKeys, toggleColumn } = useColumnVisibility(width);
      // registry is already auto-hidden at this width; explicitly hide it via the picker too.
      toggleColumn('registry');
      const registryOccurrences = hiddenColumnKeys.value.filter((key) => key === 'registry');
      expect(registryOccurrences).toHaveLength(1);
      expect(hiddenColumnKeys.value.sort()).toEqual(
        ['kind', 'registry', 'softwareVersion', 'uptime'].sort(),
      );
    });

    it('includes uptime by default since it is opt-in and never in visibleColumns', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { hiddenColumnKeys } = useColumnVisibility();
      expect(hiddenColumnKeys.value).toContain('uptime');
    });

    it('drops uptime from hiddenColumnKeys once the user opts in (and width allows it)', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { hiddenColumnKeys, toggleColumn } = useColumnVisibility(width);
      expect(hiddenColumnKeys.value).toContain('uptime');
      toggleColumn('uptime');
      expect(hiddenColumnKeys.value).not.toContain('uptime');
    });

    it('is empty when every column is picker-visible and nothing auto-hides', async () => {
      setTestPreferences({
        containers: {
          columns: [
            'icon',
            'name',
            'version',
            'softwareVersion',
            'kind',
            'status',
            'server',
            'registry',
            'links',
            'uptime',
          ],
        },
      });
      const { useColumnVisibility } = await loadColumnVisibility();
      const width = ref(5000);
      const { hiddenColumnKeys } = useColumnVisibility(width);
      expect(hiddenColumnKeys.value).toEqual([]);
    });
  });

  describe('resetColumns', () => {
    it('restores the default visible set after columns were toggled off', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { visibleColumns, toggleColumn, resetColumns } = useColumnVisibility();
      toggleColumn('kind');
      toggleColumn('status');
      expect(visibleColumns.value.has('kind')).toBe(false);
      expect(visibleColumns.value.has('status')).toBe(false);

      resetColumns();
      expect(visibleColumns.value.has('kind')).toBe(true);
      expect(visibleColumns.value.has('status')).toBe(true);
      // uptime is opt-in — reset does not turn it on.
      expect(visibleColumns.value.has('uptime')).toBe(false);
    });

    it('drops uptime back out of visibleColumns if the user had opted in', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { visibleColumns, toggleColumn, resetColumns } = useColumnVisibility();
      toggleColumn('uptime');
      expect(visibleColumns.value.has('uptime')).toBe(true);

      resetColumns();
      expect(visibleColumns.value.has('uptime')).toBe(false);
    });

    it('persists the reset visible set to preferences', async () => {
      const { useColumnVisibility } = await loadColumnVisibility();
      const { toggleColumn, resetColumns } = useColumnVisibility();
      toggleColumn('kind');
      resetColumns();
      await nextTick();
      const { flushPreferences } = await import('@/preferences/store');
      flushPreferences();
      const stored = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}').containers.columns;
      expect(stored).toContain('kind');
      expect(stored).not.toContain('uptime');
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
      const { visibleColumns, hiddenColumnKeys, toggleColumn } = useColumnVisibility();
      expect(visibleColumns.value.has('uptime')).toBe(false);

      toggleColumn('uptime');
      expect(visibleColumns.value.has('uptime')).toBe(true);
      expect(hiddenColumnKeys.value).not.toContain('uptime');
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
