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

// What a reverse proxy sends when Drydock is down: no JSON body.
function proxyError(status: number): Response {
  return new Response('<html>Bad gateway</html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

function jsonError(status: number, body: object, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
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
        baseFetch.mockResolvedValue(proxyError(code));

        const failure = globalThis.fetch('/api/v1/containers');
        await expect(failure).rejects.toBeInstanceOf(GatewayUnavailableError);
        await expect(failure).rejects.toMatchObject(proxyError(code));
        await vi.advanceTimersByTimeAsync(0);

        expect(c.status.value).toBe('server-unreachable');
      },
    );

    it('does not flip the banner on a transient 503 and asks views to refetch', async () => {
      const c = useConnectivity();
      c.noteLastKnownServed(1);
      const resync = vi.fn();
      globalThis.addEventListener('dd:sse-resync-required', resync);
      baseFetch.mockResolvedValueOnce(proxyError(503)).mockResolvedValueOnce({ status: 200 });

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
      baseFetch.mockResolvedValueOnce(proxyError(503)).mockResolvedValueOnce({ status: 200 });

      await expect(globalThis.fetch('/api/v1/containers')).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);

      expect(c.status.value).toBe('online');
      expect(resync).toHaveBeenCalledTimes(1);
      globalThis.removeEventListener('dd:sse-resync-required', resync);
    });

    it('marks unreachable when the confirming request itself cannot connect', async () => {
      const c = useConnectivity();
      baseFetch
        .mockResolvedValueOnce(proxyError(502))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(globalThis.fetch('/api/v1/containers')).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);

      expect(c.status.value).toBe('server-unreachable');
    });

    it('runs a single confirming request for a burst of failures', async () => {
      baseFetch.mockResolvedValue(proxyError(503));
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

    it('lets a Drydock JSON 503 through with its body and without probing', async () => {
      const c = useConnectivity();
      c.markServerUnreachable();
      baseFetch.mockResolvedValueOnce(jsonError(503, { error: 'Outbox store unavailable' }));
      baseFetch.mockClear();

      const response = await globalThis.fetch('/api/v1/notifications/outbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: 'Outbox store unavailable' });
      expect(c.status.value).toBe('online');
      expect(baseFetch).toHaveBeenCalledTimes(1);
    });

    it('treats a +json content type as a Drydock answer', async () => {
      baseFetch.mockResolvedValueOnce(
        jsonError(502, { title: 'Bad gateway' }, 'application/problem+json; charset=utf-8'),
      );

      const response = await globalThis.fetch('/api/v1/containers');

      expect(response.status).toBe(502);
    });

    it('still throws for a non-JSON 503 and confirms', async () => {
      baseFetch.mockResolvedValueOnce(proxyError(503)).mockResolvedValueOnce(proxyError(503));
      baseFetch.mockClear();

      await expect(globalThis.fetch('/api/v1/containers')).rejects.toBeInstanceOf(
        GatewayUnavailableError,
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(baseFetch).toHaveBeenCalledTimes(2);
      expect(useConnectivity().status.value).toBe('server-unreachable');
    });

    it('treats an empty 504 with no content type as a proxy error', async () => {
      baseFetch.mockResolvedValueOnce(new Response(null, { status: 504 }));

      await expect(globalThis.fetch('/api/v1/containers')).rejects.toBeInstanceOf(
        GatewayUnavailableError,
      );
    });

    it('counts a JSON 503 on the confirming request as reachable', async () => {
      const c = useConnectivity();
      baseFetch
        .mockResolvedValueOnce(proxyError(503))
        .mockResolvedValueOnce(jsonError(503, { error: 'Service starting' }));

      await expect(globalThis.fetch('/api/v1/containers')).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);

      expect(c.status.value).toBe('online');
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
