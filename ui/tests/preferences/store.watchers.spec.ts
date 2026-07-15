const mockWatch = vi.fn();

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  return {
    ...actual,
    reactive: <T>(value: T) => value,
    watch: mockWatch,
  };
});

describe('preferences store watcher registration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    mockWatch.mockReset();
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
  });

  it('registers section-level watchers instead of one full-tree deep watcher', async () => {
    await import('@/preferences/store');

    expect(mockWatch).toHaveBeenCalledTimes(12);
    const deepWatchCount = mockWatch.mock.calls.filter(
      ([, , options]) => options?.deep === true,
    ).length;
    expect(deepWatchCount).toBe(11);

    const { preferences } = await import('@/preferences/store');
    const syncWatcher = mockWatch.mock.calls.find(([source]) => source() === preferences.sync);
    expect(syncWatcher).toBeDefined();
    preferences.sync.enabled = true;
    syncWatcher?.[1]();
    expect(localStorage.getItem('dd-preferences')).toContain('"enabled":true');
  });
});
