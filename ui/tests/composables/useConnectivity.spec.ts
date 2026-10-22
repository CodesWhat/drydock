import {
  CONNECTIVITY_PROBE_INTERVAL_MS,
  GatewayUnavailableError,
  installConnectivityMonitor,
  useConnectivity,
} from '@/composables/useConnectivity';
import { readLastKnown, saveLastKnown } from '@/utils/last-known';

function setOnline(value: boolean) {
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true });
}

describe('useConnectivity', () => {
  let uninstall: (() => void) | undefined;
  let baseFetch: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    baseFetch = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = baseFetch as unknown as typeof fetch;
    setOnline(true);
    uninstall = installConnectivityMonitor();
    const c = useConnectivity();
    c.markServerReachable();
    globalThis.dispatchEvent(new Event('online'));
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    setOnline(true);
  });

  it('is online by default and not read-only', () => {
    const c = useConnectivity();
    expect(c.status.value).toBe('online');
    expect(c.isReadOnly.value).toBe(false);
    expect(c.readOnlyReason.value).toBe('');
  });

  it('reports offline when the browser goes offline and recovers on online', async () => {
    const c = useConnectivity();

    globalThis.dispatchEvent(new Event('offline'));
    expect(c.status.value).toBe('offline');
    expect(c.isReadOnly.value).toBe(true);
    expect(c.readOnlyReason.value).toBe('Unavailable while offline');

    globalThis.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(c.status.value).toBe('online');
  });

  it('reports server-unreachable after a network failure on an API call', async () => {
    const c = useConnectivity();
    baseFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(globalThis.fetch('/api/v1/containers')).rejects.toThrow('Failed to fetch');

    expect(c.status.value).toBe('server-unreachable');
    expect(c.readOnlyReason.value).toBe('Unavailable while the Drydock server is unreachable');
  });

  it('ignores aborted API calls and non-API traffic', async () => {
    const c = useConnectivity();
    baseFetch.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await expect(globalThis.fetch('/api/v1/containers')).rejects.toThrow('aborted');
    expect(c.status.value).toBe('online');

    baseFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(globalThis.fetch('/auth/user')).rejects.toThrow();
    expect(c.status.value).toBe('online');
  });

  it('resolves URL and Request inputs, and tolerates unparseable ones', async () => {
    const c = useConnectivity();
    baseFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(globalThis.fetch(new URL('/api/v1/server', 'http://localhost'))).rejects.toThrow();
    expect(c.status.value).toBe('server-unreachable');
    c.markServerReachable();

    await expect(
      globalThis.fetch({ url: '/api/v1/server' } as unknown as Request),
    ).rejects.toThrow();
    expect(c.status.value).toBe('server-unreachable');
    c.markServerReachable();

    await expect(globalThis.fetch('http://')).rejects.toThrow();
    expect(c.status.value).toBe('online');
  });

  describe('reverse proxy gateway errors', () => {
    it.each([502, 503, 504])(
      'treats a %i as unreachable once the confirming request agrees',
      async (code) => {
        const c = useConnectivity();
        baseFetch.mockResolvedValue({ status: code });

        const failure = globalThis.fetch('/api/v1/containers');
        await expect(failure).rejects.toBeInstanceOf(GatewayUnavailableError);
        await expect(failure).rejects.toMatchObject({ status: code });
        await vi.advanceTimersByTimeAsync(0);

        expect(c.status.value).toBe('server-unreachable');
      },
    );

    it('does not flip the banner on a transient 503 and asks views to refetch', async () => {
      const c = useConnectivity();
      c.noteLastKnownServed(1);
      const resync = vi.fn();
      globalThis.addEventListener('dd:sse-resync-required', resync);
      baseFetch.mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 200 });

      await expect(globalThis.fetch('/api/v1/containers')).rejects.toThrow(
        'Server unavailable (503)',
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(c.status.value).toBe('online');
      expect(c.lastKnownAt.value).toBeNull();
      expect(resync).toHaveBeenCalledTimes(1);
      globalThis.removeEventListener('dd:sse-resync-required', resync);
    });

    it('recovers once, without a duplicate refresh, when the confirmation succeeds while already unreachable', async () => {
      const c = useConnectivity();
      c.markServerUnreachable();
      const resync = vi.fn();
      globalThis.addEventListener('dd:sse-resync-required', resync);
      baseFetch.mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 200 });

      await expect(globalThis.fetch('/api/v1/containers')).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);

      expect(c.status.value).toBe('online');
      expect(resync).toHaveBeenCalledTimes(1);
      globalThis.removeEventListener('dd:sse-resync-required', resync);
    });

    it('marks unreachable when the confirming request itself cannot connect', async () => {
      const c = useConnectivity();
      baseFetch
        .mockResolvedValueOnce({ status: 502 })
        .mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(globalThis.fetch('/api/v1/containers')).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);

      expect(c.status.value).toBe('server-unreachable');
    });

    it('runs a single confirming request for a burst of failures', async () => {
      baseFetch.mockResolvedValue({ status: 503 });
      baseFetch.mockClear();

      await Promise.allSettled([
        globalThis.fetch('/api/v1/a'),
        globalThis.fetch('/api/v1/b'),
        globalThis.fetch('/api/v1/c'),
      ]);
      await vi.advanceTimersByTimeAsync(0);

      // three originals plus one confirmation
      expect(baseFetch).toHaveBeenCalledTimes(4);
    });

    it('does not treat other HTTP errors as unreachable', async () => {
      const c = useConnectivity();
      baseFetch.mockResolvedValueOnce({ status: 500 });

      const response = await globalThis.fetch('/api/v1/containers');

      expect(response.status).toBe(500);
      expect(c.status.value).toBe('online');
    });
  });

  it('refreshes open views and clears the marker when the server answers again', async () => {
    const c = useConnectivity();
    c.noteLastKnownServed(500);
    c.noteLastKnownServed(900);
    expect(c.lastKnownAt.value).toBe(500);
    baseFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(globalThis.fetch('/api/v1/containers')).rejects.toThrow();
    const resync = vi.fn();
    globalThis.addEventListener('dd:sse-resync-required', resync);

    await globalThis.fetch('/api/v1/containers');

    expect(c.status.value).toBe('online');
    expect(c.lastKnownAt.value).toBeNull();
    expect(resync).toHaveBeenCalledTimes(1);
    expect((resync.mock.calls[0][0] as CustomEvent).detail).toEqual({ reason: 'reconnect' });
    globalThis.removeEventListener('dd:sse-resync-required', resync);
  });

  it('probes while degraded and stops probing once online', async () => {
    const c = useConnectivity();
    c.markServerUnreachable();
    baseFetch.mockClear();
    baseFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await vi.advanceTimersByTimeAsync(CONNECTIVITY_PROBE_INTERVAL_MS);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(c.status.value).toBe('server-unreachable');

    await vi.advanceTimersByTimeAsync(CONNECTIVITY_PROBE_INTERVAL_MS);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(c.status.value).toBe('online');

    await vi.advanceTimersByTimeAsync(CONNECTIVITY_PROBE_INTERVAL_MS * 3);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('does not start a second probe timer and skips probing while the browser is offline', async () => {
    const c = useConnectivity();
    c.markServerUnreachable();
    globalThis.dispatchEvent(new Event('offline'));
    baseFetch.mockClear();

    await vi.advanceTimersByTimeAsync(CONNECTIVITY_PROBE_INTERVAL_MS * 2);

    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('wipes the last-known store on a 401 from the API', async () => {
    saveLastKnown('containers', [{ id: 'a' }]);
    baseFetch.mockResolvedValueOnce({ status: 401 });

    await globalThis.fetch('/api/v1/containers');

    expect(readLastKnown('containers')).toBeUndefined();
  });

  it('is idempotent to install and restores fetch on uninstall', () => {
    expect(installConnectivityMonitor()).toBe(uninstall);
    const wrapped = globalThis.fetch;

    uninstall?.();
    uninstall = undefined;

    expect(globalThis.fetch).toBe(baseFetch);
    expect(globalThis.fetch).not.toBe(wrapped);
  });
});
