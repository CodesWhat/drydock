import { nextTick, ref } from 'vue';
import type { PickerColumn } from '@/composables/useViewColumnVisibility';
import { setTestPreferences } from '../helpers/preferences';

describe('useViewColumnVisibility', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function loadComposable() {
    return import('@/composables/useViewColumnVisibility');
  }

  const columns: PickerColumn[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'status', label: 'Status' },
    { key: 'containers', label: 'Containers' },
  ];

  it('defaults to nothing hidden when preferences have no hiddenColumns entries', async () => {
    const { useViewColumnVisibility } = await loadComposable();
    const { hiddenColumnKeys, isHidden } = useViewColumnVisibility('watchers', columns);
    expect(hiddenColumnKeys.value).toEqual([]);
    expect(isHidden('status')).toBe(false);
  });

  it('seeds hiddenColumnKeys from preferences at call time', async () => {
    setTestPreferences({ views: { watchers: { hiddenColumns: ['status'] } } });
    const { useViewColumnVisibility } = await loadComposable();
    const { hiddenColumnKeys, isHidden } = useViewColumnVisibility('watchers', columns);
    expect(hiddenColumnKeys.value).toEqual(['status']);
    expect(isHidden('status')).toBe(true);
    expect(isHidden('containers')).toBe(false);
  });

  it('toggleColumn hides a non-required column', async () => {
    const { useViewColumnVisibility } = await loadComposable();
    const { toggleColumn, isHidden } = useViewColumnVisibility('watchers', columns);
    expect(isHidden('status')).toBe(false);
    toggleColumn('status');
    expect(isHidden('status')).toBe(true);
  });

  it('toggleColumn unhides an already-hidden column', async () => {
    const { useViewColumnVisibility } = await loadComposable();
    const { toggleColumn, isHidden } = useViewColumnVisibility('watchers', columns);
    toggleColumn('status');
    expect(isHidden('status')).toBe(true);
    toggleColumn('status');
    expect(isHidden('status')).toBe(false);
  });

  it('toggleColumn is a no-op for a required column', async () => {
    const { useViewColumnVisibility } = await loadComposable();
    const { toggleColumn, isHidden } = useViewColumnVisibility('watchers', columns);
    toggleColumn('name');
    expect(isHidden('name')).toBe(false);
  });

  it('toggleColumn is a no-op for an unknown column key', async () => {
    const { useViewColumnVisibility } = await loadComposable();
    const { toggleColumn, hiddenColumnKeys } = useViewColumnVisibility('watchers', columns);
    toggleColumn('does-not-exist');
    expect(hiddenColumnKeys.value).toEqual([]);
  });

  it('hiddenCount only counts hidden keys present in the current columns', async () => {
    setTestPreferences({ views: { watchers: { hiddenColumns: ['status', 'cron'] } } });
    const { useViewColumnVisibility } = await loadComposable();
    // 'cron' is a valid watchers column but not in the `columns` passed here, so it
    // must not inflate the count (mirrors what happens when a picker only shows a
    // subset of the persisted keys — e.g. narrower views).
    const { hiddenCount } = useViewColumnVisibility('watchers', columns);
    expect(hiddenCount.value).toBe(1);
  });

  it('resetColumns clears the hidden set back to none hidden', async () => {
    const { useViewColumnVisibility } = await loadComposable();
    const { toggleColumn, resetColumns, hiddenColumnKeys } = useViewColumnVisibility(
      'watchers',
      columns,
    );
    toggleColumn('status');
    toggleColumn('containers');
    expect(hiddenColumnKeys.value).toHaveLength(2);
    resetColumns();
    expect(hiddenColumnKeys.value).toEqual([]);
  });

  it('persists hidden columns back to preferences.views[viewKey].hiddenColumns', async () => {
    const { useViewColumnVisibility } = await loadComposable();
    const { toggleColumn } = useViewColumnVisibility('watchers', columns);
    toggleColumn('status');
    await nextTick();
    const { preferences, flushPreferences } = await import('@/preferences/store');
    expect(preferences.views.watchers.hiddenColumns).toEqual(['status']);
    flushPreferences();
    const stored = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}').views.watchers
      .hiddenColumns;
    expect(stored).toEqual(['status']);
  });

  it('supports columns passed as a Ref and recomputes hiddenCount reactively', async () => {
    setTestPreferences({ views: { watchers: { hiddenColumns: ['status', 'containers'] } } });
    const { useViewColumnVisibility } = await loadComposable();
    const columnsRef = ref<PickerColumn[]>([...columns]);
    const { hiddenCount } = useViewColumnVisibility('watchers', columnsRef);
    expect(hiddenCount.value).toBe(2);

    columnsRef.value = [columns[0], columns[1]];
    await nextTick();
    expect(hiddenCount.value).toBe(1);
  });

  it('supports columns passed as a getter function', async () => {
    const { useViewColumnVisibility } = await loadComposable();
    const { toggleColumn, isHidden } = useViewColumnVisibility('watchers', () => columns);
    toggleColumn('status');
    expect(isHidden('status')).toBe(true);
  });

  it('works for a different view key (agents), keeping state independent per call', async () => {
    setTestPreferences({ views: { agents: { hiddenColumns: ['os'] } } });
    const { useViewColumnVisibility } = await loadComposable();
    const agentColumns: PickerColumn[] = [
      { key: 'name', label: 'Name', required: true },
      { key: 'os', label: 'OS' },
    ];
    const { isHidden } = useViewColumnVisibility('agents', agentColumns);
    expect(isHidden('os')).toBe(true);
  });
});
