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

  it('persists a mode and uses the canonical server response', async () => {
    mockUpdateSettings.mockResolvedValue({ internetlessMode: false, updateMode: 'notify' });
    const { useUpdateMode } = await import('@/composables/useUpdateMode');
    const state = useUpdateMode({ autoLoad: false });

    await state.setUpdateMode('notify');

    expect(mockUpdateSettings).toHaveBeenCalledWith({ updateMode: 'notify' });
    expect(state.updateMode.value).toBe('notify');
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
