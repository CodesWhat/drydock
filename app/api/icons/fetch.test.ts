const {
  mockAxiosGet,
  mockIsCachedIconUsable,
  mockWriteIconAtomically,
  mockEnforceIconCacheLimits,
  mockGetIconInFlightTimeoutMs,
} = vi.hoisted(() => ({
  mockAxiosGet: vi.fn(),
  mockIsCachedIconUsable: vi.fn(),
  mockWriteIconAtomically: vi.fn(),
  mockEnforceIconCacheLimits: vi.fn(),
  mockGetIconInFlightTimeoutMs: vi.fn(() => 15_000),
}));

vi.mock('axios', () => ({
  default: {
    get: mockAxiosGet,
  },
}));

vi.mock('./storage.js', () => ({
  isCachedIconUsable: mockIsCachedIconUsable,
  writeIconAtomically: mockWriteIconAtomically,
  enforceIconCacheLimits: mockEnforceIconCacheLimits,
}));

vi.mock('./settings.js', async () => {
  const actual = await vi.importActual<typeof import('./settings.js')>('./settings.js');
  return {
    ...actual,
    getIconInFlightTimeoutMs: mockGetIconInFlightTimeoutMs,
  };
});

import { clearInFlightIconFetchesForTests, fetchAndCacheIconOnce } from './fetch.js';

describe('icons/fetch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    clearInFlightIconFetchesForTests();
    mockGetIconInFlightTimeoutMs.mockReturnValue(15_000);
    mockIsCachedIconUsable.mockResolvedValue(false);
    mockWriteIconAtomically.mockResolvedValue(undefined);
    mockEnforceIconCacheLimits.mockResolvedValue(undefined);
    mockAxiosGet.mockResolvedValue({ data: Buffer.from('<svg />') });
  });

  test('skips upstream fetch when cached icon is already usable', async () => {
    mockIsCachedIconUsable.mockResolvedValue(true);

    await fetchAndCacheIconOnce({
      provider: 'simple',
      slug: 'docker',
      cachePath: '/store/icons/simple/docker.svg',
    });

    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(mockWriteIconAtomically).not.toHaveBeenCalled();
    expect(mockEnforceIconCacheLimits).not.toHaveBeenCalled();
  });

  test('fetches upstream icon, writes atomically, and enforces cache limits', async () => {
    await fetchAndCacheIconOnce({
      provider: 'simple',
      slug: 'docker',
      cachePath: '/store/icons/simple/docker.svg',
    });

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/docker.svg',
      {
        responseType: 'arraybuffer',
        timeout: 10000,
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 2 * 1024 * 1024,
      },
    );
    expect(mockWriteIconAtomically).toHaveBeenCalledWith(
      '/store/icons/simple/docker.svg',
      expect.any(Buffer),
    );
    expect(mockEnforceIconCacheLimits).toHaveBeenCalledWith({
      protectedPath: '/store/icons/simple/docker.svg',
    });
  });

  test('rejects upstream payload when bytes do not match provider format', async () => {
    await expect(
      fetchAndCacheIconOnce({
        provider: 'homarr',
        slug: 'docker',
        cachePath: '/store/icons/homarr/docker.png',
      }),
    ).rejects.toThrow(/Invalid icon payload/i);

    expect(mockWriteIconAtomically).not.toHaveBeenCalled();
    expect(mockEnforceIconCacheLimits).not.toHaveBeenCalled();
  });

  test('rejects upstream payload when icon size exceeds limit', async () => {
    mockAxiosGet.mockResolvedValue({ data: Buffer.alloc(2 * 1024 * 1024 + 1, 0x41) });

    await expect(
      fetchAndCacheIconOnce({
        provider: 'simple',
        slug: 'oversize',
        cachePath: '/store/icons/simple/oversize.svg',
      }),
    ).rejects.toThrow(/size is out of bounds/i);

    expect(mockWriteIconAtomically).not.toHaveBeenCalled();
    expect(mockEnforceIconCacheLimits).not.toHaveBeenCalled();
  });

  test('deduplicates concurrent fetches for the same provider and slug', async () => {
    let resolveFetch: ((value: { data: Buffer }) => void) | undefined;
    mockAxiosGet.mockReturnValue(
      new Promise<{ data: Buffer }>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const firstPromise = fetchAndCacheIconOnce({
      provider: 'simple',
      slug: 'docker-dedupe',
      cachePath: '/store/icons/simple/docker-dedupe.svg',
    });
    const secondPromise = fetchAndCacheIconOnce({
      provider: 'simple',
      slug: 'docker-dedupe',
      cachePath: '/store/icons/simple/docker-dedupe.svg',
    });

    expect(firstPromise).toBe(secondPromise);
    await vi.waitFor(() => {
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    resolveFetch?.({ data: Buffer.from('<svg />') });
    await Promise.all([firstPromise, secondPromise]);
  });

  test('releases in-flight lock after request completes', async () => {
    await fetchAndCacheIconOnce({
      provider: 'simple',
      slug: 'docker-release',
      cachePath: '/store/icons/simple/docker-release.svg',
    });
    await fetchAndCacheIconOnce({
      provider: 'simple',
      slug: 'docker-release',
      cachePath: '/store/icons/simple/docker-release.svg',
    });

    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
  });

  test('times out fetches and allows a later retry for the same icon', async () => {
    vi.useFakeTimers();
    mockGetIconInFlightTimeoutMs.mockReturnValue(20);
    mockAxiosGet
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce({ data: Buffer.from('<svg />') });

    const request = {
      provider: 'simple',
      slug: 'docker-timeout',
      cachePath: '/store/icons/simple/docker-timeout.svg',
    } as const;

    const firstPromise = fetchAndCacheIconOnce(request);
    const secondPromise = fetchAndCacheIconOnce(request);

    expect(firstPromise).toBe(secondPromise);
    void secondPromise.catch(() => {});
    await vi.waitFor(() => {
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    const timeoutErrorPromise = firstPromise.catch((error) => error as Error);
    await vi.advanceTimersByTimeAsync(25);
    const timeoutError = await timeoutErrorPromise;

    expect(timeoutError.message).toBe('Icon fetch timed out after 20ms');

    await fetchAndCacheIconOnce(request);

    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    expect(mockWriteIconAtomically).toHaveBeenCalledTimes(1);
  });
});
