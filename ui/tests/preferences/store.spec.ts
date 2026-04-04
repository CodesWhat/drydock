import { nextTick } from 'vue';

describe('preferences store', () => {
  const originalRequestIdleCallback = (globalThis as any).requestIdleCallback;

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalRequestIdleCallback === undefined) {
      delete (globalThis as any).requestIdleCallback;
    } else {
      (globalThis as any).requestIdleCallback = originalRequestIdleCallback;
    }
    vi.restoreAllMocks();
  });

  async function loadStore() {
    return await import('@/preferences/store');
  }

  it('should return defaults when localStorage is empty', async () => {
    const { preferences } = await loadStore();
    expect(preferences.schemaVersion).toBe(2);
    expect(preferences.theme.family).toBe('one-dark');
    expect(preferences.theme.variant).toBe('dark');
    expect(preferences.containers.viewMode).toBe('table');
  });

  it('should load persisted preferences', async () => {
    const { DEFAULTS } = await import('@/preferences/schema');
    const saved = {
      ...structuredClone(DEFAULTS),
      theme: { family: 'github', variant: 'light' },
    };
    localStorage.setItem('dd-preferences', JSON.stringify(saved));
    const { preferences } = await loadStore();
    expect(preferences.theme.family).toBe('github');
    expect(preferences.theme.variant).toBe('light');
  });

  it('should fall back to defaults on corrupt JSON', async () => {
    localStorage.setItem('dd-preferences', '{corrupt');
    const { preferences } = await loadStore();
    expect(preferences.theme.family).toBe('one-dark');
    expect(preferences.theme.variant).toBe('dark');
  });

  it('should fall back to defaults when legacy migration throws', async () => {
    vi.doMock('@/preferences/migrate', async () => {
      const actual = await vi.importActual('@/preferences/migrate');
      return {
        ...actual,
        migrateFromLegacyKeys: () => {
          throw new Error('legacy migration failed');
        },
      };
    });

    const { preferences } = await loadStore();
    expect(preferences.theme.family).toBe('one-dark');
    expect(preferences.theme.variant).toBe('dark');
    vi.doUnmock('@/preferences/migrate');
  });

  it('should merge missing keys with defaults', async () => {
    localStorage.setItem(
      'dd-preferences',
      JSON.stringify({ schemaVersion: 1, theme: { family: 'dracula' } }),
    );
    const { preferences } = await loadStore();
    expect(preferences.theme.family).toBe('dracula');
    // Missing variant should be filled from defaults
    expect(preferences.theme.variant).toBe('dark');
    expect(preferences.containers.viewMode).toBe('table');
    expect(preferences.font.family).toBe('ibm-plex-mono');
  });

  it('should persist changes via flushPreferences', async () => {
    const { preferences, flushPreferences } = await loadStore();
    preferences.theme.family = 'catppuccin';
    flushPreferences();
    const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
    expect(raw.theme.family).toBe('catppuccin');
  });

  it('should persist nested object changes via flushPreferences', async () => {
    const { preferences, flushPreferences } = await loadStore();
    preferences.containers.sort.key = 'status';
    preferences.containers.sort.asc = false;
    flushPreferences();
    const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
    expect(raw.containers.sort.key).toBe('status');
    expect(raw.containers.sort.asc).toBe(false);
  });

  it('should serialize and restore appearance radius', async () => {
    const { preferences, flushPreferences } = await loadStore();
    preferences.appearance.radius = 'soft';
    flushPreferences();

    vi.resetModules();

    const { preferences: restoredPreferences } = await loadStore();
    expect(restoredPreferences.appearance.radius).toBe('soft');
  });

  it('should reset to defaults via resetPreferences', async () => {
    const { preferences, resetPreferences } = await loadStore();
    preferences.theme.family = 'github';
    preferences.containers.viewMode = 'cards';
    preferences.layout.sidebarCollapsed = true;
    resetPreferences();
    expect(preferences.theme.family).toBe('one-dark');
    expect(preferences.containers.viewMode).toBe('table');
    expect(preferences.layout.sidebarCollapsed).toBe(false);
  });

  it('should persist defaults to localStorage after resetPreferences', async () => {
    const { preferences, flushPreferences, resetPreferences } = await loadStore();
    preferences.theme.family = 'dracula';
    flushPreferences();
    resetPreferences();
    const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
    expect(raw.theme.family).toBe('one-dark');
  });

  it('should preserve array values when persisting', async () => {
    const { preferences, flushPreferences } = await loadStore();
    preferences.containers.columns = ['name', 'status'];
    flushPreferences();
    const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
    expect(raw.containers.columns).toEqual(['name', 'status']);
  });

  it('should preserve dashboard widgetOrder when persisting', async () => {
    const { preferences, flushPreferences } = await loadStore();
    const newOrder = ['stat-updates', 'stat-containers'];
    preferences.dashboard.widgetOrder = newOrder;
    flushPreferences();
    const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
    expect(raw.dashboard.widgetOrder).toEqual(newOrder);
  });

  it('should fall back to setTimeout when requestIdleCallback is unavailable', async () => {
    vi.useFakeTimers();
    delete (globalThis as any).requestIdleCallback;
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const { preferences } = await loadStore();
    preferences.theme.family = 'github';
    await nextTick();

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100);
    vi.advanceTimersByTime(100);

    const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
    expect(raw.theme.family).toBe('github');
  });

  it('should swallow quota errors during flush and keep future writes working', async () => {
    const { preferences, flushPreferences } = await loadStore();
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('QuotaExceededError');
      })
      .mockImplementation(originalSetItem);

    preferences.theme.family = 'catppuccin';
    expect(() => flushPreferences()).not.toThrow();

    preferences.theme.family = 'github';
    flushPreferences();

    const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
    expect(raw.theme.family).toBe('github');
  });

  it('should coalesce multiple updates into a single scheduled write', async () => {
    const idleCallbacks: Array<(deadline: IdleDeadline) => void> = [];
    (globalThis as any).requestIdleCallback = vi.fn(
      (callback: (deadline: IdleDeadline) => void) => {
        idleCallbacks.push(callback);
        return 1;
      },
    );

    const { preferences } = await loadStore();

    // Store initialization may trigger requestIdleCallback (e.g. legacy-key cleanup).
    // Reset mocks so we only count calls from the mutations below.
    (globalThis as any).requestIdleCallback.mockClear();
    idleCallbacks.length = 0;

    const setItemSpy = vi.spyOn(localStorage, 'setItem');

    preferences.theme.family = 'dracula';
    preferences.theme.variant = 'light';
    preferences.containers.viewMode = 'cards';
    await nextTick();

    expect((globalThis as any).requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(setItemSpy).not.toHaveBeenCalled();

    idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    const raw = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
    expect(raw.theme.family).toBe('dracula');
    expect(raw.theme.variant).toBe('light');
    expect(raw.containers.viewMode).toBe('cards');

    // Re-running the queued callback should be a no-op once dirty state is flushed.
    idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });
});
