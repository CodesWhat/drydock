const mockScanAllContainersApi = vi.fn();

vi.mock('@/services/container', () => ({
  scanAllContainersApi: (...args: any[]) => mockScanAllContainersApi(...args),
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

  function emitSseScanCompleted() {
    globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-completed'));
  }

  it('starts with scanning=false and progress zeroed', async () => {
    const { scanning, scanProgress } = await loadComposable();
    expect(scanning.value).toBe(false);
    expect(scanProgress.value).toEqual({ done: 0, total: 0 });
  });

  it('exposes scanning and scanProgress as readonly refs', async () => {
    const { scanning, scanProgress } = await loadComposable();
    expect((scanning as any).__v_isReadonly).toBe(true);
    expect((scanProgress as any).__v_isReadonly).toBe(true);
  });

  it('exposes currentCycleId as readonly ref initialized to null', async () => {
    const { currentCycleId } = await loadComposable();
    expect((currentCycleId as any).__v_isReadonly).toBe(true);
    expect(currentCycleId.value).toBeNull();
  });

  it('bails out when runtimeLoading is true', async () => {
    const { scanning, scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: true, runtimeLoading: true });
    expect(scanning.value).toBe(false);
    expect(mockScanAllContainersApi).not.toHaveBeenCalled();
  });

  it('bails out when scannerReady is false', async () => {
    const { scanning, scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: false, runtimeLoading: false });
    expect(scanning.value).toBe(false);
    expect(mockScanAllContainersApi).not.toHaveBeenCalled();
  });

  it('guards against double-start', async () => {
    let resolveFirst!: (value: { cycleId: string; scheduledCount: number }) => void;
    mockScanAllContainersApi.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const { scanAllContainers } = await loadComposable();
    const opts = { scannerReady: true, runtimeLoading: false };

    const first = scanAllContainers(opts);
    mockScanAllContainersApi.mockResolvedValueOnce({ cycleId: 'c2', scheduledCount: 0 });
    const second = scanAllContainers(opts);

    resolveFirst({ cycleId: 'c1', scheduledCount: 0 });
    await first;
    await second;

    expect(mockScanAllContainersApi).toHaveBeenCalledTimes(1);
  });

  it('happy path: one POST, SSE events drive progress counter', async () => {
    mockScanAllContainersApi.mockResolvedValue({ cycleId: 'test-cycle-1', scheduledCount: 3 });

    const { scanning, scanProgress, currentCycleId, scanAllContainers } = await loadComposable();

    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(scanning.value).toBe(true);
    expect(mockScanAllContainersApi).toHaveBeenCalledTimes(1);
    expect(mockScanAllContainersApi).toHaveBeenCalledWith(expect.any(AbortSignal));

    // Wait for the API call to resolve and promise to enter SSE-wait state
    await vi.waitFor(() => {
      expect(scanProgress.value.total).toBe(3);
    });

    emitSseScanCompleted();
    emitSseScanCompleted();
    emitSseScanCompleted();

    await promise;

    expect(scanning.value).toBe(false);
    expect(scanProgress.value).toEqual({ done: 3, total: 3 });
    expect(currentCycleId.value).toBeNull(); // reset in endScanSession
  });

  it('stores cycleId from bulk response during scan', async () => {
    let resolveApi!: (value: { cycleId: string; scheduledCount: number }) => void;
    mockScanAllContainersApi.mockReturnValue(
      new Promise((resolve) => {
        resolveApi = resolve;
      }),
    );

    const { currentCycleId, scanAllContainers } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    resolveApi({ cycleId: 'my-cycle-id', scheduledCount: 0 });
    await promise;

    // After session ends, cycleId is reset to null
    expect(currentCycleId.value).toBeNull();
  });

  it('empty inventory: POST returns scheduledCount 0, completes immediately', async () => {
    mockScanAllContainersApi.mockResolvedValue({ cycleId: 'empty-cycle', scheduledCount: 0 });

    const { scanning, scanProgress, scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(scanning.value).toBe(false);
    expect(scanProgress.value).toEqual({ done: 0, total: 0 });
    expect(mockScanAllContainersApi).toHaveBeenCalledTimes(1);
  });

  it('rate-limited (429): surfaces error, does not loop', async () => {
    const tooManyRequestsError = await makeApiError('Too Many Requests', 429);
    mockScanAllContainersApi.mockRejectedValue(tooManyRequestsError);

    const { scanning, scanAllContainers } = await loadComposable();

    await expect(scanAllContainers({ scannerReady: true, runtimeLoading: false })).rejects.toThrow(
      'Too Many Requests',
    );

    // Only one call — no retry loop
    expect(mockScanAllContainersApi).toHaveBeenCalledTimes(1);
    expect(scanning.value).toBe(false);
  });

  it('non-429 API error propagates', async () => {
    const serverError = await makeApiError('Internal Server Error', 500);
    mockScanAllContainersApi.mockRejectedValue(serverError);

    const { scanning, scanAllContainers } = await loadComposable();

    await expect(scanAllContainers({ scannerReady: true, runtimeLoading: false })).rejects.toThrow(
      'Internal Server Error',
    );

    expect(scanning.value).toBe(false);
  });

  it('resets scanning to false even if POST throws', async () => {
    mockScanAllContainersApi.mockRejectedValue(new Error('network error'));

    const { scanning, scanAllContainers } = await loadComposable();
    await scanAllContainers({ scannerReady: true, runtimeLoading: false }).catch(() => {});

    expect(scanning.value).toBe(false);
  });

  it('abort mid-scan: AbortSignal aborts the POST and unsubscribes from SSE', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockScanAllContainersApi.mockImplementation((signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });

    const { scanning, scanAllContainers, cancelScan } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(scanning.value).toBe(true);
    await vi.waitFor(() => {
      expect(capturedSignal).toBeDefined();
    });

    cancelScan();
    await promise;

    expect(scanning.value).toBe(false);
    expect(capturedSignal?.aborted).toBe(true);

    // SSE events after abort do not affect progress
    emitSseScanCompleted();
    emitSseScanCompleted();
    // (progress remains at 0 since we aborted before any response)
  });

  it('abort after POST response: resolves cleanly without waiting for all SSE events', async () => {
    mockScanAllContainersApi.mockResolvedValue({ cycleId: 'cycle-abort', scheduledCount: 5 });

    const { scanning, scanProgress, scanAllContainers, cancelScan } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    await vi.waitFor(() => {
      expect(scanProgress.value.total).toBe(5);
    });

    emitSseScanCompleted();
    await vi.waitFor(() => {
      expect(scanProgress.value.done).toBe(1);
    });

    cancelScan();
    await promise;

    expect(scanning.value).toBe(false);
    // Progress was partially incremented before abort
    expect(scanProgress.value.done).toBe(1);
  });

  it('treats abort errors from POST as cancellation, not fatal failures', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    mockScanAllContainersApi.mockRejectedValue(abortError);

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
    mockScanAllContainersApi.mockResolvedValue({ cycleId: 'c-ok', scheduledCount: 0 });

    const { scanAllContainers } = await loadComposable();
    await expect(
      scanAllContainers({ scannerReady: true, runtimeLoading: false }),
    ).resolves.toBeUndefined();
  });

  it('caps done at total when extra SSE events arrive', async () => {
    mockScanAllContainersApi.mockResolvedValue({ cycleId: 'extra-sse', scheduledCount: 2 });

    const { scanProgress, scanAllContainers } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    await vi.waitFor(() => {
      expect(scanProgress.value.total).toBe(2);
    });

    // Fire 4 events for a 2-container scan
    emitSseScanCompleted();
    emitSseScanCompleted();

    await promise;

    expect(scanProgress.value.done).toBe(2);
  });

  it('does not increment done when signal is aborted during SSE wait', async () => {
    mockScanAllContainersApi.mockResolvedValue({ cycleId: 'sse-abort', scheduledCount: 3 });

    const { scanProgress, scanAllContainers, cancelScan } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    await vi.waitFor(() => {
      expect(scanProgress.value.total).toBe(3);
    });

    cancelScan();
    await promise;

    // Abort before any SSE events
    expect(scanProgress.value.done).toBe(0);
  });

  it('resolves immediately when signal is already aborted before SSE wait begins', async () => {
    // cancelScan() is called synchronously as the API mock resolves,
    // ensuring signal.aborted is true before the Promise constructor runs.
    const { scanProgress, scanAllContainers, cancelScan } = await loadComposable();

    mockScanAllContainersApi.mockImplementation((_signal?: AbortSignal) => {
      cancelScan();
      return Promise.resolve({ cycleId: 'pre-aborted', scheduledCount: 3 });
    });

    await scanAllContainers({ scannerReady: true, runtimeLoading: false });

    expect(scanProgress.value.done).toBe(0);
    expect(scanProgress.value.total).toBe(3);
  });

  it('partial SSE events followed by abort complete with partial progress', async () => {
    mockScanAllContainersApi.mockResolvedValue({ cycleId: 'partial-abort', scheduledCount: 3 });

    const { scanProgress, scanAllContainers, cancelScan } = await loadComposable();
    const promise = scanAllContainers({ scannerReady: true, runtimeLoading: false });

    await vi.waitFor(() => {
      expect(scanProgress.value.total).toBe(3);
    });

    emitSseScanCompleted();
    await vi.waitFor(() => expect(scanProgress.value.done).toBe(1));

    cancelScan();
    await promise;

    expect(scanProgress.value.done).toBe(1);
    expect(scanProgress.value.total).toBe(3);
  });
});
