const mockGetAllContainers = vi.fn();
const mockScanContainer = vi.fn();

vi.mock('@/services/container', () => ({
  getAllContainers: (...args: any[]) => mockGetAllContainers(...args),
  scanContainer: (...args: any[]) => mockScanContainer(...args),
}));

describe('useScanProgress', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.useRealTimers();
  });

  async function loadComposable() {
    const mod = await import('@/composables/useScanProgress');
    return mod.useScanProgress();
  }

  it('starts with scanning=false and progress zeroed', async () => {
    const { scanning, scanProgress } = await loadComposable();
    expect(scanning.value).toBe(false);
    expect(scanProgress.value).toEqual({ done: 0, total: 0 });
  });

  it('exposes scanning and scanProgress as readonly refs', async () => {
    const { scanning, scanProgress } = await loadComposable();
    // Vue readonly refs have the __v_isReadonly flag
    expect((scanning as any).__v_isReadonly).toBe(true);
    expect((scanProgress as any).__v_isReadonly).toBe(true);
  });

  it('scans all containers and tracks progress', async () => {
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    mockScanContainer.mockResolvedValue({});

    const { scanning, scanProgress, scanAllContainers } = await loadComposable();

    const promise = scanAllContainers({
      scannerReady: true,
      runtimeLoading: false,
    });

    expect(scanning.value).toBe(true);
    await promise;

    expect(scanning.value).toBe(false);
    expect(scanProgress.value).toEqual({ done: 3, total: 3 });
    expect(mockScanContainer).toHaveBeenCalledTimes(3);
    expect(mockScanContainer).toHaveBeenCalledWith('c1');
    expect(mockScanContainer).toHaveBeenCalledWith('c2');
    expect(mockScanContainer).toHaveBeenCalledWith('c3');
  });

  it('bails out when runtimeLoading is true', async () => {
    const { scanning, scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: true, runtimeLoading: true });
    expect(scanning.value).toBe(false);
    expect(mockGetAllContainers).not.toHaveBeenCalled();
  });

  it('bails out when scannerReady is false', async () => {
    const { scanning, scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: false, runtimeLoading: false });
    expect(scanning.value).toBe(false);
    expect(mockGetAllContainers).not.toHaveBeenCalled();
  });

  it('guards against double-start', async () => {
    let resolveFirst: () => void;
    mockGetAllContainers.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = () => resolve([{ id: 'c1' }]);
      }),
    );
    mockScanContainer.mockResolvedValue({});

    const { scanAllContainers } = await loadComposable();
    const opts = { scannerReady: true, runtimeLoading: false };

    const first = scanAllContainers(opts);
    // Second call while first is in progress should be a no-op
    mockGetAllContainers.mockResolvedValueOnce([{ id: 'c2' }]);
    const second = scanAllContainers(opts);

    resolveFirst!();
    await first;
    await second;

    // getAllContainers should only have been called once (the second call bailed)
    expect(mockGetAllContainers).toHaveBeenCalledTimes(1);
  });

  it('continues scanning even if individual containers fail', async () => {
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    mockScanContainer.mockRejectedValueOnce(new Error('scan failed')).mockResolvedValueOnce({});

    const { scanning, scanProgress, scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(scanning.value).toBe(false);
    expect(scanProgress.value.done).toBe(2);
    expect(mockScanContainer).toHaveBeenCalledTimes(2);
  });

  it('resets scanning to false even if getAllContainers throws', async () => {
    mockGetAllContainers.mockRejectedValue(new Error('network error'));

    const { scanning, scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: true, runtimeLoading: false }).catch(() => {});

    expect(scanning.value).toBe(false);
  });

  it('retries on 429 Too Many Requests', async () => {
    vi.useFakeTimers();
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }]);
    mockScanContainer
      .mockRejectedValueOnce(new Error('Too Many Requests'))
      .mockResolvedValueOnce({});

    const { scanAllContainers } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    // Advance past the 12s retry delay
    await vi.advanceTimersByTimeAsync(12_000);
    await promise;

    expect(mockScanContainer).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws after exhausting 429 retries', async () => {
    vi.useFakeTimers();
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }]);
    mockScanContainer.mockRejectedValue(new Error('Too Many Requests'));

    const { scanning, scanProgress, scanAllContainers } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    // Advance through all 3 retry delays (attempts 0->fail, 1->fail, 2->fail, 3->fail+throw)
    await vi.advanceTimersByTimeAsync(12_000);
    await vi.advanceTimersByTimeAsync(12_000);
    await vi.advanceTimersByTimeAsync(12_000);
    await promise;

    // 4 total calls: initial + 3 retries
    expect(mockScanContainer).toHaveBeenCalledTimes(4);
    // Container still counts as "done" (error is swallowed at batch level)
    expect(scanProgress.value.done).toBe(1);
    expect(scanning.value).toBe(false);
    vi.useRealTimers();
  });

  it('does not retry non-429 errors', async () => {
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }]);
    mockScanContainer.mockRejectedValue(new Error('Internal Server Error'));

    const { scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(mockScanContainer).toHaveBeenCalledTimes(1);
  });

  it('shares state across multiple composable calls (singleton)', async () => {
    const mod = await import('@/composables/useScanProgress');
    const first = mod.useScanProgress();
    const second = mod.useScanProgress();

    expect(first.scanning).toBe(second.scanning);
    expect(first.scanProgress).toBe(second.scanProgress);
  });

  it('resolves when scan completes successfully', async () => {
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }]);
    mockScanContainer.mockResolvedValue({});

    const { scanAllContainers } = await loadComposable();
    await expect(
      scanAllContainers({ scannerReady: true, runtimeLoading: false }),
    ).resolves.toBeUndefined();
  });
});
