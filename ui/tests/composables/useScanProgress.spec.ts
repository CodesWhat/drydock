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

  async function makeApiError(message: string, status: number) {
    const { ApiError } = await import('@/utils/error');
    return new ApiError(message, status);
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
    expect(mockScanContainer).toHaveBeenNthCalledWith(1, 'c1', expect.any(AbortSignal));
    expect(mockScanContainer).toHaveBeenNthCalledWith(2, 'c2', expect.any(AbortSignal));
    expect(mockScanContainer).toHaveBeenNthCalledWith(3, 'c3', expect.any(AbortSignal));
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

  it('counts containers with invalid ids as done without calling scanContainer', async () => {
    mockGetAllContainers.mockResolvedValue([
      { id: 'c1' },
      {},
      { id: null },
      { id: 42 },
      { id: '' },
      { id: 'c2' },
    ]);
    mockScanContainer.mockResolvedValue({});

    const { scanProgress, scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(scanProgress.value).toEqual({ done: 6, total: 6 });
    expect(mockScanContainer).toHaveBeenCalledTimes(2);
    expect(mockScanContainer).toHaveBeenNthCalledWith(1, 'c1', expect.any(AbortSignal));
    expect(mockScanContainer).toHaveBeenNthCalledWith(2, 'c2', expect.any(AbortSignal));
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
    const tooManyRequestsError = await makeApiError(
      'Failed to scan container: Too Many Requests',
      429,
    );
    mockScanContainer.mockRejectedValueOnce(tooManyRequestsError).mockResolvedValueOnce({});

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
    const tooManyRequestsError = await makeApiError(
      'Failed to scan container: Too Many Requests',
      429,
    );
    mockScanContainer.mockRejectedValue(tooManyRequestsError);

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

  it('aborts before retry starts when the signal flips between loop checks', async () => {
    const { scanAllContainers, cancelScan, scanProgress } = await loadComposable();
    const containers: Array<{ id: string }> = [];
    const containerWithAbortOnIdRead = {} as { id: string };
    Object.defineProperty(containerWithAbortOnIdRead, 'id', {
      configurable: true,
      get() {
        cancelScan();
        return 'c1';
      },
    });
    containers.push(containerWithAbortOnIdRead);

    mockGetAllContainers.mockResolvedValue(containers);
    mockScanContainer.mockResolvedValue({});

    await scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(mockScanContainer).not.toHaveBeenCalled();
    expect(scanProgress.value).toEqual({ done: 0, total: 1 });
  });

  it('aborts immediately when retry backoff starts with an already-aborted signal', async () => {
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }]);

    const { scanAllContainers, cancelScan, scanProgress } = await loadComposable();
    const tooManyRequestsError = await makeApiError(
      'Failed to scan container: Too Many Requests',
      429,
    );
    Object.defineProperty(tooManyRequestsError, 'status', {
      configurable: true,
      get() {
        cancelScan();
        return 429;
      },
    });
    mockScanContainer.mockRejectedValueOnce(tooManyRequestsError);

    await scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(mockScanContainer).toHaveBeenCalledTimes(1);
    expect(scanProgress.value.done).toBe(0);
  });

  it('aborts during retry backoff sleep when cancelScan is called', async () => {
    vi.useFakeTimers();
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const tooManyRequestsError = await makeApiError(
      'Failed to scan container: Too Many Requests',
      429,
    );
    mockScanContainer.mockRejectedValueOnce(tooManyRequestsError).mockResolvedValueOnce({});

    const { scanAllContainers, cancelScan, scanProgress } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    await vi.waitFor(() => {
      expect(mockScanContainer).toHaveBeenCalledTimes(1);
    });
    cancelScan();
    await vi.runOnlyPendingTimersAsync();
    await promise;

    expect(mockScanContainer).toHaveBeenCalledTimes(1);
    expect(scanProgress.value).toEqual({ done: 0, total: 2 });
    vi.useRealTimers();
  });

  it('does not retry plain Error with Too Many Requests message', async () => {
    vi.useFakeTimers();
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }]);
    mockScanContainer.mockRejectedValue(new Error('Too Many Requests'));

    const { scanAllContainers } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    // Drain any pending retry timers to avoid hanging if behavior regresses.
    await vi.advanceTimersByTimeAsync(36_000);
    await promise;

    expect(mockScanContainer).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not retry non-429 ApiError', async () => {
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }]);
    const serverError = await makeApiError('Failed to scan container: Internal Server Error', 500);
    mockScanContainer.mockRejectedValue(serverError);

    const { scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(mockScanContainer).toHaveBeenCalledTimes(1);
  });

  it('breaks at the top of the loop when cancellation happens before the next iteration', async () => {
    const { scanAllContainers, cancelScan, scanProgress } = await loadComposable();
    const containers: Array<{ id: string }> = [{ id: 'c1' }];
    Object.defineProperty(containers, '1', {
      configurable: true,
      get() {
        cancelScan();
        return { id: 'c2' };
      },
    });
    containers.length = 2;

    mockGetAllContainers.mockResolvedValue(containers);
    mockScanContainer.mockResolvedValue({});

    await scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(mockScanContainer).toHaveBeenCalledTimes(1);
    expect(scanProgress.value).toEqual({ done: 1, total: 2 });
  });

  it('breaks after a successful scan when cancellation happens before progress increment', async () => {
    vi.useFakeTimers();
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

    const { scanAllContainers, cancelScan, scanProgress } = await loadComposable();
    mockScanContainer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            cancelScan();
            resolve({});
          }, 0);
        }),
    );
    mockScanContainer.mockResolvedValue({});

    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(mockScanContainer).toHaveBeenCalledTimes(1);
    expect(scanProgress.value).toEqual({ done: 0, total: 2 });
    vi.useRealTimers();
  });

  it('cancels an in-flight batch scan and stops before the next container', async () => {
    mockGetAllContainers.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    mockScanContainer.mockImplementationOnce((_containerId: string, signal?: AbortSignal) => {
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          },
          { once: true },
        );
      });
    });
    mockScanContainer.mockResolvedValueOnce({});

    const { scanning, scanProgress, scanAllContainers, cancelScan } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(scanning.value).toBe(true);
    await vi.waitFor(() => {
      expect(mockScanContainer).toHaveBeenCalledTimes(1);
    });
    cancelScan();
    await promise;

    expect(scanning.value).toBe(false);
    expect(scanProgress.value.total).toBe(2);
    expect(scanProgress.value.done).toBe(0);
    expect(mockScanContainer).toHaveBeenCalledTimes(1);
    expect(mockScanContainer).toHaveBeenCalledWith('c1', expect.any(AbortSignal));
  });

  it('treats abort errors from getAllContainers as cancellation, not fatal failures', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    mockGetAllContainers.mockRejectedValue(abortError);

    const { scanning, scanAllContainers } = await loadComposable();
    await expect(
      scanAllContainers({ scannerReady: true, runtimeLoading: false }),
    ).resolves.toBeUndefined();

    expect(scanning.value).toBe(false);
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
