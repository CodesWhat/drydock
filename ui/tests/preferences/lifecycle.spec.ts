describe('preferences lifecycle integration', () => {
  const originalRIC = (globalThis as any).requestIdleCallback;

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    // Install a synchronous requestIdleCallback so deferred legacy-key cleanup
    // executes immediately within migrateFromLegacyKeys().
    (globalThis as any).requestIdleCallback = (cb: (deadline: IdleDeadline) => void) => {
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 0;
    };
  });

  afterEach(() => {
    if (originalRIC === undefined) {
      delete (globalThis as any).requestIdleCallback;
    } else {
      (globalThis as any).requestIdleCallback = originalRIC;
    }
  });

  it('covers legacy keys -> migrate() -> reactive store -> composable reactivity', async () => {
    localStorage.setItem('dd-triggers-view-v1', 'cards');
    localStorage.setItem('drydock-theme-family-v1', 'github');

    const migrateModule = await import('@/preferences/migrate');
    const migrated = migrateModule.migrateFromLegacyKeys();

    expect(migrated.views.triggers.mode).toBe('cards');
    expect(localStorage.getItem('dd-triggers-view-v1')).toBeNull();
    expect(localStorage.getItem('drydock-theme-family-v1')).toBeNull();

    const migrateSpy = vi.spyOn(migrateModule, 'migrate');

    const { preferences, flushPreferences } = await import('@/preferences/store');
    const { useViewMode } = await import('@/preferences/useViewMode');

    expect(migrateSpy).toHaveBeenCalledTimes(1);

    const triggerMode = useViewMode('triggers');
    const triggerModeMirror = useViewMode('triggers');

    expect(triggerMode.value).toBe('cards');
    expect(preferences.views.triggers.mode).toBe('cards');

    triggerMode.value = 'list';

    expect(preferences.views.triggers.mode).toBe('list');
    expect(triggerModeMirror.value).toBe('list');

    flushPreferences();

    const persisted = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
    expect(persisted.theme.family).toBe('github');
    expect(persisted.views.triggers.mode).toBe('list');

    migrateSpy.mockRestore();
  });
});
