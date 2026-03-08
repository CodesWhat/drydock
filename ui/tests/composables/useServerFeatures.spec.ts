const mockGetServer = vi.fn();

vi.mock('@/services/server', () => ({
  getServer: (...args: unknown[]) => mockGetServer(...args),
}));

describe('useServerFeatures', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function loadComposable() {
    return await import('@/composables/useServerFeatures');
  }

  it('loads server feature flags and exposes reactive feature helpers', async () => {
    mockGetServer.mockResolvedValueOnce({
      configuration: {
        feature: {
          containeractions: true,
          delete: false,
        },
      },
    });

    const { useServerFeatures } = await loadComposable();
    const features = useServerFeatures({ autoLoad: false });
    await features.loadServerFeatures();

    expect(features.containerActionsEnabled.value).toBe(true);
    expect(features.deleteEnabled.value).toBe(false);
    expect(features.isFeatureEnabled('containeractions')).toBe(true);
    expect(features.isFeatureEnabled('delete')).toBe(false);
    expect(features.featureFlags.value).toEqual({
      containeractions: true,
      delete: false,
    });
    expect(features.containerActionsDisabledReason.value).toBe('');
    expect(features.error.value).toBeNull();
    expect(features.loaded.value).toBe(true);
  });

  it('fails closed when feature configuration cannot be loaded', async () => {
    mockGetServer.mockRejectedValueOnce(new Error('server unavailable'));

    const { useServerFeatures } = await loadComposable();
    const features = useServerFeatures({ autoLoad: false });
    await features.loadServerFeatures();

    expect(features.containerActionsEnabled.value).toBe(false);
    expect(features.deleteEnabled.value).toBe(false);
    expect(features.containerActionsDisabledReason.value).toBe(
      'Container actions disabled by server configuration',
    );
    expect(features.featureFlags.value).toEqual({});
    expect(features.error.value).toBe('server unavailable');
    expect(features.loaded.value).toBe(true);
  });

  it('coalesces concurrent loads and caches the first successful payload', async () => {
    mockGetServer.mockResolvedValueOnce({
      configuration: {
        feature: {
          containeractions: false,
          delete: true,
        },
      },
    });

    const { useServerFeatures } = await loadComposable();
    const first = useServerFeatures({ autoLoad: false });
    const second = useServerFeatures({ autoLoad: false });

    await Promise.all([first.loadServerFeatures(), second.loadServerFeatures()]);
    await first.loadServerFeatures();

    expect(mockGetServer).toHaveBeenCalledTimes(1);
    expect(first.containerActionsEnabled.value).toBe(false);
    expect(second.deleteEnabled.value).toBe(true);
  });

  it('auto-loads by default and fail-closes invalid feature payloads', async () => {
    mockGetServer.mockResolvedValueOnce({
      configuration: {
        feature: 'disabled',
      },
    });

    const { useServerFeatures } = await loadComposable();
    const features = useServerFeatures();
    await features.loadServerFeatures();

    expect(mockGetServer).toHaveBeenCalledTimes(1);
    expect(features.featureFlags.value).toEqual({});
    expect(features.containerActionsEnabled.value).toBe(false);
  });
});
