const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('@/services/settings', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}));

describe('useUpdateMode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('coalesces loads and exposes the server-backed mode', async () => {
    mockGetSettings.mockResolvedValue({ internetlessMode: false, updateMode: 'auto' });
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const first = useUpdateMode({ autoLoad: false });
    const second = useUpdateMode({ autoLoad: false });

    await Promise.all([first.loadUpdateMode(), second.loadUpdateMode()]);

    expect(mockGetSettings).toHaveBeenCalledTimes(1);
    expect(first.updateMode.value).toBe('auto');
    expect(second.updateMode.value).toBe('auto');
    expect(first.loaded.value).toBe(true);
  });

  it('force-loads a newer mode after the initial request', async () => {
    mockGetSettings
      .mockResolvedValueOnce({ internetlessMode: false, updateMode: 'manual' })
      .mockResolvedValueOnce({ internetlessMode: false, updateMode: 'auto' });
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const state = useUpdateMode({ autoLoad: false });

    await state.loadUpdateMode();
    await state.loadUpdateMode({ force: true });

    expect(mockGetSettings).toHaveBeenCalledTimes(2);
    expect(state.updateMode.value).toBe('auto');
  });

  it('exposes an initial load error without treating the default as loaded', async () => {
    mockGetSettings.mockRejectedValue(new Error('settings unavailable'));
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const state = useUpdateMode({ autoLoad: false });

    await state.loadUpdateMode();

    expect(state.loaded.value).toBe(false);
    expect(state.error.value).toBe('settings unavailable');
  });

  it('revalidates on focus and visible visibility changes, then removes listeners', async () => {
    mockGetSettings.mockResolvedValue({ internetlessMode: false, updateMode: 'manual' });
    const addWindow = vi.spyOn(window, 'addEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const addDocument = vi.spyOn(document, 'addEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const { startUpdateModeRevalidation } = await import('@/composables/useUpdateMode');
    const stop = startUpdateModeRevalidation();

    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(mockGetSettings).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(mockGetSettings).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(mockGetSettings).toHaveBeenCalledTimes(2));

    stop();
    stop();
    expect(addWindow).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(addDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('keeps a successful save when an older forced load resolves afterward', async () => {
    let resolveLoad!: (value: { internetlessMode: boolean; updateMode: 'auto' }) => void;
    mockGetSettings.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    mockUpdateSettings.mockResolvedValue({ internetlessMode: false, updateMode: 'notify' });
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const state = useUpdateMode({ autoLoad: false });

    const oldLoad = state.loadUpdateMode({ force: true });
    await state.setUpdateMode('notify');
    resolveLoad({ internetlessMode: false, updateMode: 'auto' });
    await oldLoad;

    expect(state.updateMode.value).toBe('notify');
    expect(state.loaded.value).toBe(true);
  });

  it('ignores an older load failure after a successful save', async () => {
    let rejectLoad!: (reason: Error) => void;
    mockGetSettings.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    mockUpdateSettings.mockResolvedValue({ internetlessMode: false, updateMode: 'notify' });
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const state = useUpdateMode({ autoLoad: false });

    const oldLoad = state.loadUpdateMode({ force: true });
    await state.setUpdateMode('notify');
    rejectLoad(new Error('stale load failed'));
    await oldLoad;

    expect(state.updateMode.value).toBe('notify');
    expect(state.error.value).toBeNull();
  });

  it('persists a mode and uses the canonical server response', async () => {
    mockUpdateSettings.mockResolvedValue({ internetlessMode: false, updateMode: 'notify' });
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const state = useUpdateMode({ autoLoad: false });

    await state.setUpdateMode('notify');

    expect(mockUpdateSettings).toHaveBeenCalledWith({ updateMode: 'notify' });
    expect(state.updateMode.value).toBe('notify');
    expect(state.saving.value).toBe(false);
  });

  it('coalesces concurrent saves', async () => {
    let resolveSave!: (value: { internetlessMode: boolean; updateMode: 'auto' }) => void;
    mockUpdateSettings.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const state = useUpdateMode({ autoLoad: false });

    const first = state.setUpdateMode('auto');
    const second = state.setUpdateMode('auto');
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    resolveSave({ internetlessMode: false, updateMode: 'auto' });
    await Promise.all([first, second]);

    expect(state.updateMode.value).toBe('auto');
    expect(state.saving.value).toBe(false);
  });

  it('preserves the current mode and exposes an error when persistence fails', async () => {
    mockUpdateSettings.mockRejectedValue(new Error('settings unavailable'));
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const state = useUpdateMode({ autoLoad: false });

    await expect(state.setUpdateMode('auto')).rejects.toThrow('settings unavailable');

    expect(state.updateMode.value).toBe('manual');
    expect(state.error.value).toBe('settings unavailable');
    expect(state.saving.value).toBe(false);
  });
});
