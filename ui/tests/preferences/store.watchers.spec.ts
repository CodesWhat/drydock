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
  });

  it('registers section-level watchers instead of one full-tree deep watcher', async () => {
    await import('@/preferences/store');

    expect(mockWatch).toHaveBeenCalledTimes(9);
    const deepWatchCount = mockWatch.mock.calls.filter(
      ([, , options]) => options?.deep === true,
    ).length;
    expect(deepWatchCount).toBe(8);
  });
});
