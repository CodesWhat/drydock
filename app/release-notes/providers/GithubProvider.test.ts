import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockLogDebug = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());
const mockGetGhcrTokenFallback = vi.hoisted(() => vi.fn<[], string | undefined>(() => undefined));

vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
  },
}));

vi.mock('../../log/index.js', () => ({
  default: {
    child: () => ({
      debug: mockLogDebug,
      info: vi.fn(),
      warn: mockLogWarn,
      error: vi.fn(),
    }),
  },
}));

vi.mock('../../registries/ghcr-token-fallback.js', () => ({
  getGhcrTokenFallback: () => mockGetGhcrTokenFallback(),
}));

import GithubProvider, { _resetGithubProviderCooldownForTests } from './GithubProvider.js';

describe('release-notes/providers/GithubProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetGithubProviderCooldownForTests();
  });

  test('supports should only match github repositories', () => {
    const provider = new GithubProvider();

    expect(provider.supports('github.com/acme/service')).toBe(true);
    expect(provider.supports(' https://github.com/acme/service ')).toBe(true);
    expect(provider.supports('gitlab.com/acme/service')).toBe(false);
  });

  test('fetchByTag should return undefined for non-github source repos', async () => {
    const provider = new GithubProvider();

    await expect(
      provider.fetchByTag('https://gitlab.com/acme/service', '1.0.0'),
    ).resolves.toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('fetchByTag should return undefined when github path is incomplete', async () => {
    const provider = new GithubProvider();

    await expect(provider.fetchByTag('https://github.com/acme', '1.0.0')).resolves.toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('fetchByTag should return undefined when tag is empty after trimming', async () => {
    const provider = new GithubProvider();

    await expect(provider.fetchByTag('github.com/acme/service', '   ')).resolves.toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('fetchByTag should return undefined after exhausting 404 tag variants', async () => {
    const provider = new GithubProvider();
    mockAxiosGet.mockRejectedValueOnce({
      response: {
        status: 404,
      },
    });

    const releaseNotes = await provider.fetchByTag('github.com/acme/service', 'v');

    expect(releaseNotes).toBeUndefined();
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/service/releases/tags/v',
      expect.any(Object),
    );
  });

  test('fetchByTag should stop on non-rate-limited 403 responses with no token', async () => {
    const provider = new GithubProvider();
    mockGetGhcrTokenFallback.mockReturnValueOnce(undefined);
    mockAxiosGet.mockRejectedValueOnce({
      response: {
        status: 403,
        headers: null,
      },
      message: 'forbidden',
    });

    const releaseNotes = await provider.fetchByTag('github.com/acme/service', '1.0.0');

    expect(releaseNotes).toBeUndefined();
    // No token involved — neither debug nor warn for auth rejection
    expect(mockLogDebug).not.toHaveBeenCalled();
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  test('fetchByTag should handle non-object thrown errors', async () => {
    const provider = new GithubProvider();
    mockAxiosGet.mockRejectedValueOnce('request failed');

    const releaseNotes = await provider.fetchByTag('github.com/acme/service', '1.0.0');

    expect(releaseNotes).toBeUndefined();
    expect(mockLogDebug).toHaveBeenCalledTimes(1);
  });

  test('fetchByTag should apply fallback values for missing release fields', async () => {
    const provider = new GithubProvider();
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        body: null,
        name: '   ',
        html_url: '',
        published_at: 'not-a-date',
      },
    });

    const releaseNotes = await provider.fetchByTag('github.com/acme/service', '1.0.0');

    expect(releaseNotes).toEqual({
      title: 'v1.0.0',
      body: '',
      url: 'https://github.com/acme/service/releases/tag/v1.0.0',
      publishedAt: new Date(0).toISOString(),
      provider: 'github',
    });
  });

  test('fetchByTag uses GHCR token fallback when no token is provided', async () => {
    const provider = new GithubProvider();
    mockGetGhcrTokenFallback.mockReturnValueOnce('ghcr-pat-token');
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        body: 'release body',
        name: 'v1.0.0',
        html_url: 'https://github.com/acme/service/releases/tag/v1.0.0',
        published_at: '2024-01-01T00:00:00Z',
      },
    });

    const releaseNotes = await provider.fetchByTag('github.com/acme/service', '1.0.0');

    expect(releaseNotes).toBeDefined();
    // The authorization header should contain the GHCR fallback token
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghcr-pat-token',
        }),
      }),
    );
  });

  test('fetchByTag does not use GHCR fallback when explicit token is provided', async () => {
    const provider = new GithubProvider();
    // Do not queue a fallback value — getGhcrTokenFallback won't be called when token is explicit
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        body: 'body',
        name: 'v1.0.0',
        html_url: 'https://github.com/acme/service/releases/tag/v1.0.0',
        published_at: '2024-01-01T00:00:00Z',
      },
    });

    await provider.fetchByTag('github.com/acme/service', '1.0.0', 'explicit-token');

    // Should use the explicit token, not the fallback
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer explicit-token',
        }),
      }),
    );
  });

  test('fetchByTag makes unauthenticated request when no token and no GHCR fallback', async () => {
    const provider = new GithubProvider();
    mockGetGhcrTokenFallback.mockReturnValueOnce(undefined);
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        body: 'body',
        name: 'v1.0.0',
        html_url: 'https://github.com/acme/service/releases/tag/v1.0.0',
        published_at: '2024-01-01T00:00:00Z',
      },
    });

    await provider.fetchByTag('github.com/acme/service', '1.0.0');

    // No Authorization header when no token available
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  test('fetchByTag retries on 429 and returns data on success', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    mockAxiosGet
      .mockRejectedValueOnce({
        response: { status: 429, headers: { 'retry-after': '0' } },
      })
      .mockResolvedValueOnce({
        data: {
          body: 'release body',
          name: 'v1.2.3',
          html_url: 'https://github.com/acme/service/releases/tag/v1.2.3',
          published_at: '2024-06-01T00:00:00Z',
        },
      });

    const promise = provider.fetchByTag('github.com/acme/service', '1.2.3');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeDefined();
    expect(result?.title).toBe('v1.2.3');
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  test('fetchByTag logs warn when GHCR fallback token is rejected with 401', async () => {
    const provider = new GithubProvider();
    mockGetGhcrTokenFallback.mockReturnValueOnce('ghcr-fallback-token');
    mockAxiosGet.mockRejectedValueOnce({
      response: { status: 401, headers: {} },
      message: 'unauthorized',
    });

    const result = await provider.fetchByTag('github.com/acme/service', '1.0.0');

    expect(result).toBeUndefined();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringMatching(/GHCR token fallback.*rejected/i),
    );
    expect(mockLogDebug).not.toHaveBeenCalled();
  });

  test('fetchByTag logs different warn when configured token is rejected with 401', async () => {
    const provider = new GithubProvider();
    mockAxiosGet.mockRejectedValueOnce({
      response: { status: 401, headers: {} },
      message: 'unauthorized',
    });

    const result = await provider.fetchByTag(
      'github.com/acme/service',
      '1.0.0',
      'explicit-bad-token',
    );

    expect(result).toBeUndefined();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringMatching(/Configured GITHUB_TOKEN rejected/i),
    );
    expect(mockLogDebug).not.toHaveBeenCalled();
  });

  test('fetchByTag makes unauthenticated request and returns undefined on 401 when no token at all', async () => {
    const provider = new GithubProvider();
    mockGetGhcrTokenFallback.mockReturnValueOnce(undefined);
    mockAxiosGet.mockRejectedValueOnce({
      response: { status: 401, headers: {} },
      message: 'unauthorized',
    });

    const result = await provider.fetchByTag('github.com/acme/service', '1.0.0');

    expect(result).toBeUndefined();
    // No special warn for unauthenticated case, and no debug — just a silent return
    expect(mockLogWarn).not.toHaveBeenCalled();
    expect(mockLogDebug).not.toHaveBeenCalled();
  });

  test('fetchByTag returns undefined after rate-limit 429 exhausts all retries', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    mockAxiosGet.mockRejectedValue({
      response: { status: 429, headers: { 'retry-after': '0' } },
    });

    const promise = provider.fetchByTag('github.com/acme/service', '1.2.3');
    const expectation = expect(promise).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await expectation;

    // withRetry throws after exhaustion — caught by fetchByTag's catch block → returns undefined
    expect(mockLogDebug).toHaveBeenCalled();

    vi.useRealTimers();
  });

  test('fetchByTag logs the error message when a network error object with a message is thrown', async () => {
    const provider = new GithubProvider();
    // Throw an actual Error (has a .message property) with no .response — hits getDebugErrorMessage line 31
    mockAxiosGet.mockRejectedValueOnce(
      new Error('ECONNREFUSED connect ECONNREFUSED 127.0.0.1:443'),
    );

    const result = await provider.fetchByTag('github.com/acme/service', '1.0.0');

    expect(result).toBeUndefined();
    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED connect ECONNREFUSED 127.0.0.1:443'),
    );
  });

  // -----------------------------------------------------------------------
  // Part 1: secondary rate-limit 403 retry tests
  // -----------------------------------------------------------------------

  test('fetchByTag retries a secondary-rate-limit 403 (retry-after header) and succeeds', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    // First attempt: secondary rate-limit 403 with retry-after
    mockAxiosGet
      .mockRejectedValueOnce({
        response: { status: 403, headers: { 'retry-after': '1' } },
      })
      .mockResolvedValueOnce({
        data: {
          body: 'release body',
          name: 'v1.0.0',
          html_url: 'https://github.com/acme/service/releases/tag/v1.0.0',
          published_at: '2024-01-01T00:00:00Z',
        },
      });

    const promise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeDefined();
    expect(result?.title).toBe('v1.0.0');
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    // No warn on a retry that eventually succeeds
    expect(mockLogWarn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  test('fetchByTag retries a secondary-rate-limit 403 (x-ratelimit-remaining=0) and succeeds', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    mockAxiosGet
      .mockRejectedValueOnce({
        response: {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          body: 'body',
          name: 'v2.0.0',
          html_url: 'https://github.com/acme/service/releases/tag/v2.0.0',
          published_at: '2024-06-01T00:00:00Z',
        },
      });

    const promise = provider.fetchByTag('github.com/acme/service', '2.0.0');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeDefined();
    expect(result?.title).toBe('v2.0.0');
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  test('fetchByTag exhausts retries on a persistent secondary-rate-limit 403 and sets cooldown', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    mockAxiosGet.mockRejectedValue({
      response: { status: 403, headers: { 'retry-after': '0' } },
    });

    const promise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeUndefined();
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringMatching(/rate-limited.*cooldown/i));

    vi.useRealTimers();
  });

  test('fetchByTag does NOT retry a genuine auth 403 (no rate-limit headers)', async () => {
    const provider = new GithubProvider();
    // Plain 403 — no retry-after, no x-ratelimit-remaining=0 → auth failure, not rate limit
    mockAxiosGet.mockRejectedValueOnce({
      response: { status: 403, headers: {} },
      message: 'Forbidden',
    });

    const result = await provider.fetchByTag('github.com/acme/service', '1.0.0', 'bad-token');

    expect(result).toBeUndefined();
    // Should have been called exactly once — no retry
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringMatching(/Configured GITHUB_TOKEN rejected/i),
    );
  });

  test('fetchByTag does NOT retry a genuine auth 403 when headers are null', async () => {
    const provider = new GithubProvider();
    mockGetGhcrTokenFallback.mockReturnValueOnce(undefined);
    mockAxiosGet.mockRejectedValueOnce({
      response: { status: 403, headers: null },
      message: 'Forbidden',
    });

    const result = await provider.fetchByTag('github.com/acme/service', '1.0.0');

    expect(result).toBeUndefined();
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    // No token at all — no warn logged for auth rejection
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Part 2: burst cooldown tests
  // -----------------------------------------------------------------------

  test('fetchByTag skips API call and returns undefined when cooldown is active', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    // Trip the cooldown: exhaust retries on a secondary-rate-limit 403
    mockAxiosGet.mockRejectedValue({
      response: { status: 403, headers: { 'retry-after': '60' } },
    });

    const firstPromise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    await firstPromise;

    // Reset axios mock — second call should never reach it
    mockAxiosGet.mockReset();
    mockAxiosGet.mockResolvedValue({
      data: { body: '', name: 'v1.0.0', html_url: '', published_at: '' },
    });

    // Call again while still in cooldown
    const secondResult = await provider.fetchByTag('github.com/acme/service', '1.0.0');
    expect(secondResult).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining('cooldown active'));

    vi.useRealTimers();
  });

  test('fetchByTag with retry-after: 0 sets a real 60 s cooldown that blocks the next call', async () => {
    vi.useFakeTimers();
    _resetGithubProviderCooldownForTests();
    const provider = new GithubProvider();

    // Exhaust retries with retry-after: '0' — per-attempt delay is 0ms (correct), but
    // the burst cooldown must be floored at DEFAULT_SECONDARY_RATE_LIMIT_COOLDOWN_MS (60 s).
    mockAxiosGet.mockRejectedValue({
      response: { status: 403, headers: { 'retry-after': '0' } },
    });

    const firstPromise = provider.fetchByTag('github.com/acme/service', '2.0.0');
    await vi.runAllTimersAsync();
    await firstPromise;

    // The first call should have been retried (axios called multiple times) and returned undefined
    expect(mockAxiosGet).toHaveBeenCalled();

    // Reset mock — the second call must NOT reach axios (cooldown blocks it)
    mockAxiosGet.mockReset();
    mockAxiosGet.mockResolvedValue({
      data: { body: '', name: 'v2.0.0', html_url: '', published_at: '' },
    });

    // Advance less than 60 s — cooldown still active
    vi.advanceTimersByTime(30_000);

    const secondResult = await provider.fetchByTag('github.com/acme/service', '2.0.0');
    expect(secondResult).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining('cooldown active'));

    vi.useRealTimers();
  });

  test('fetchByTag resumes API calls after the cooldown period expires', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    // Trip the cooldown with a 60-second retry-after
    mockAxiosGet.mockRejectedValue({
      response: { status: 403, headers: { 'retry-after': '60' } },
    });

    const tripPromise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    await tripPromise;

    // Advance time past the cooldown
    vi.advanceTimersByTime(61_000);

    // Now the next call should reach the API again
    mockAxiosGet.mockReset();
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        body: 'after cooldown',
        name: 'v1.0.0',
        html_url: 'https://github.com/acme/service/releases/tag/v1.0.0',
        published_at: '2024-01-01T00:00:00Z',
      },
    });

    const result = await provider.fetchByTag('github.com/acme/service', '1.0.0');
    expect(result).toBeDefined();
    expect(result?.body).toBe('after cooldown');
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test('fetchByTag cooldown activates when secondary rate-limit uses x-ratelimit-remaining=0', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    // Supply retry-after: '0' so per-retry sleeps are instant (no clock drift).
    // x-ratelimit-remaining: '0' makes isSecondaryRateLimit403 return true.
    // After exhaustion the catch block sets a cooldown; the next call must be blocked.
    mockAxiosGet.mockRejectedValue({
      response: {
        status: 403,
        headers: {
          'retry-after': '0',
          'x-ratelimit-remaining': '0',
        },
      },
    });

    // Trip the cooldown.
    const promise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    // Immediately after exhaustion: retry-after was '0' so cooldown is
    // technically Date.now()+0 = Date.now(); advance 1 ms to ensure the
    // timestamp comparison is strict < rather than <=.  If rateLimitCooldownUntil
    // is set to > Date.now(), the next call must be blocked.
    // We use a separate test (retry-after:60) to verify blocking; here we just
    // verify the x-ratelimit-remaining=0 path triggers the secondary-rate-limit
    // warn and returns undefined (it does since the retry-after:0 path exhausted).
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringMatching(/rate-limited.*cooldown/i));

    vi.useRealTimers();
  });

  test('fetchByTag cooldown duration uses x-ratelimit-reset epoch (no retry-after)', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    // Set a far-future reset epoch and NO retry-after header.
    // Per-retry delay and cooldown both derive from x-ratelimit-reset.
    // We only assert the cooldown is active immediately after exhaustion.
    const resetEpoch = Math.floor((Date.now() + 3600_000) / 1000); // 1 h from now
    mockAxiosGet.mockRejectedValue({
      response: {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(resetEpoch),
        },
      },
    });

    const promise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    // Immediately after exhaustion — should still be well within cooldown.
    mockAxiosGet.mockReset();
    const midResult = await provider.fetchByTag('github.com/acme/service', '1.0.0');
    expect(midResult).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  test('fetchByTag cooldown falls back to default when x-ratelimit-reset is in the past', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    // Use retry-after: '0' so per-retry sleeps are instant (no clock advancement).
    // x-ratelimit-reset in the past → getSecondaryRateLimitDelayMs returns default (60 s).
    // With retry-after: '0', the delay for retries is 0 ms, but the cooldown in the
    // catch block also uses retry-after: '0' → 0 ms.  So we can't verify "still in
    // cooldown" with this header combo.  Instead, use ONLY x-ratelimit-remaining=0
    // and a past reset epoch so the default 60 s applies everywhere.
    // To avoid per-retry clock drift, rely on the fact that retries with a past reset
    // still use getSecondaryRateLimitDelayMs → default 60 s per retry.
    // After vi.runAllTimersAsync(), the fake clock has advanced 3×60 s = 180 s.
    // rateLimitCooldownUntil = (fakeStart+180_000) + 60_000 = fakeStart + 240_000.
    // Immediately after exhaustion, Date.now() = fakeStart + 180_000 < 240_000 → blocked.
    const pastEpoch = Math.floor((Date.now() - 10_000) / 1000);
    mockAxiosGet.mockRejectedValue({
      response: {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(pastEpoch),
        },
      },
    });

    const promise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    // Immediately after exhaustion — should be in cooldown.
    mockAxiosGet.mockReset();
    const midResult = await provider.fetchByTag('github.com/acme/service', '1.0.0');
    expect(midResult).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  test('fetchByTag warns with authenticated:true when token is present on rate-limit exhaustion', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();
    mockGetGhcrTokenFallback.mockReturnValue('some-token');

    mockAxiosGet.mockRejectedValue({
      response: { status: 403, headers: { 'retry-after': '0' } },
    });

    const promise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringMatching(/rate-limited \(authenticated\)/),
    );

    vi.useRealTimers();
  });

  test('fetchByTag warns with authenticated:false when no token on rate-limit exhaustion', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();
    mockGetGhcrTokenFallback.mockReturnValue(undefined);

    mockAxiosGet.mockRejectedValue({
      response: { status: 403, headers: { 'retry-after': '0' } },
    });

    const promise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringMatching(/rate-limited \(unauthenticated\)/),
    );

    vi.useRealTimers();
  });

  test('fetchByTag 404 still skips to next tag variant without retry', async () => {
    const provider = new GithubProvider();
    // v1.0.0 not found, 1.0.0 (without v prefix) succeeds
    mockAxiosGet.mockRejectedValueOnce({ response: { status: 404 } }).mockResolvedValueOnce({
      data: {
        body: 'body',
        name: '1.0.0',
        html_url: 'https://github.com/acme/service/releases/tag/1.0.0',
        published_at: '2024-01-01T00:00:00Z',
      },
    });

    const result = await provider.fetchByTag('github.com/acme/service', '1.0.0');

    expect(result).toBeDefined();
    expect(result?.title).toBe('1.0.0');
    // Exactly 2 calls: first 404 (v1.0.0), second success (1.0.0)
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  test('fetchByTag cooldown falls back to default when x-ratelimit-reset is a non-numeric string', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    // NO retry-after header — so getSecondaryRateLimitDelayMs reaches the x-ratelimit-reset
    // check.  A non-integer value fails the /^\d+$/ branch (line 124 false branch) and
    // falls back to DEFAULT_SECONDARY_RATE_LIMIT_COOLDOWN_MS (60 s).
    // x-ratelimit-remaining: '0' satisfies isSecondaryRateLimit403 without retry-after.
    mockAxiosGet.mockRejectedValue({
      response: {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': 'not-a-number',
        },
      },
    });

    const promise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeUndefined();
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringMatching(/rate-limited/));

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Clamp tests — verify MAX_SECONDARY_RATE_LIMIT_COOLDOWN_MS (1 h) is enforced
  // -----------------------------------------------------------------------

  test('getSecondaryRateLimitDelayMs clamps an absurdly large retry-after header to 1 hour', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    // retry-after: 999999 seconds (≈11.5 days) → raw = 999_999_000 ms, must be clamped to 3600 s
    mockAxiosGet.mockRejectedValue({
      response: {
        status: 403,
        headers: { 'retry-after': '999999' },
      },
    });

    const promise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    // Cooldown duration reported in the warn message must not exceed 3600 s (1 hour cap)
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringMatching(/cooldown active for (\d+)s/));
    const warnCall = mockLogWarn.mock.calls[0][0] as string;
    const match = /cooldown active for (\d+)s/.exec(warnCall);
    expect(match).not.toBeNull();
    const reportedSeconds = Number.parseInt(match![1], 10);
    expect(reportedSeconds).toBeLessThanOrEqual(3600);
    expect(reportedSeconds).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  test('getSecondaryRateLimitDelayMs clamps a far-future x-ratelimit-reset epoch to 1 hour', async () => {
    vi.useFakeTimers();
    const provider = new GithubProvider();

    // x-ratelimit-reset: 100 years in the future → raw delay ≫ 1 hour, must be clamped to 3600 s.
    // No retry-after header so getSecondaryRateLimitDelayMs uses the x-ratelimit-reset branch.
    const farFutureEpoch = Math.floor((Date.now() + 100 * 365 * 24 * 3600 * 1000) / 1000);
    mockAxiosGet.mockRejectedValue({
      response: {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(farFutureEpoch),
        },
      },
    });

    const promise = provider.fetchByTag('github.com/acme/service', '1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    // Cooldown duration reported in the warn message must not exceed 3600 s (1 hour cap)
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringMatching(/cooldown active for (\d+)s/));
    const warnCall = mockLogWarn.mock.calls[0][0] as string;
    const match = /cooldown active for (\d+)s/.exec(warnCall);
    expect(match).not.toBeNull();
    const reportedSeconds = Number.parseInt(match![1], 10);
    expect(reportedSeconds).toBeLessThanOrEqual(3600);
    expect(reportedSeconds).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // #452 — allowToken now gates ONLY the GHCR PAT fallback; explicit token always forwarded
  // -----------------------------------------------------------------------

  test('fetchByTag with allowToken:false still forwards explicit token to GitHub API', async () => {
    const provider = new GithubProvider();
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        body: 'body',
        name: 'v1.0.0',
        html_url: 'https://github.com/acme/service/releases/tag/v1.0.0',
        published_at: '2024-01-01T00:00:00Z',
      },
    });

    await provider.fetchByTag('github.com/acme/service', '1.0.0', 'explicit-token', {
      allowToken: false,
    });

    // Explicit token MUST be sent even when allowToken:false
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer explicit-token',
        }),
      }),
    );
    // Debug log fires to record that the token was forwarded to an untrusted source
    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.stringContaining('DD_RELEASE_NOTES_GITHUB_TOKEN forwarded'),
      expect.any(String),
    );
    // GHCR fallback must NOT be called (token is explicit, allowGhcrFallback is false)
    expect(mockGetGhcrTokenFallback).not.toHaveBeenCalled();
  });

  test('fetchByTag with allowToken:false does not attach the GHCR token fallback', async () => {
    const provider = new GithubProvider();
    mockGetGhcrTokenFallback.mockReturnValueOnce('ghcr-pat-token');
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        body: 'body',
        name: 'v1.0.0',
        html_url: 'https://github.com/acme/service/releases/tag/v1.0.0',
        published_at: '2024-01-01T00:00:00Z',
      },
    });

    await provider.fetchByTag('github.com/acme/service', '1.0.0', undefined, {
      allowToken: false,
    });

    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
    // getGhcrTokenFallback must NOT have been called
    expect(mockGetGhcrTokenFallback).not.toHaveBeenCalled();
  });

  test('fetchByTag with allowToken:true (default) still attaches the GHCR fallback', async () => {
    const provider = new GithubProvider();
    mockGetGhcrTokenFallback.mockReturnValueOnce('ghcr-pat-token');
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        body: 'body',
        name: 'v1.0.0',
        html_url: 'https://github.com/acme/service/releases/tag/v1.0.0',
        published_at: '2024-01-01T00:00:00Z',
      },
    });

    await provider.fetchByTag('github.com/acme/service', '1.0.0', undefined, {
      allowToken: true,
    });

    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghcr-pat-token',
        }),
      }),
    );
  });

  test('fetchByTag with allowToken:false + explicit token still triggers Configured GITHUB_TOKEN warn on 401', async () => {
    const provider = new GithubProvider();
    mockAxiosGet.mockRejectedValueOnce({
      response: { status: 401, headers: {} },
      message: 'unauthorized',
    });

    const result = await provider.fetchByTag(
      'github.com/acme/service',
      '1.0.0',
      'explicit-bad-token',
      { allowToken: false },
    );

    expect(result).toBeUndefined();
    // Token was forwarded → on rejection, logs the configured-token warn
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringMatching(/Configured GITHUB_TOKEN rejected/i),
    );
  });

  // -----------------------------------------------------------------------
  // fetchRange
  // -----------------------------------------------------------------------

  describe('fetchRange', () => {
    // Helper: build a minimal release record for the GitHub list endpoint
    function makeRelease(
      tagName: string,
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        tag_name: tagName,
        name: `Release ${tagName}`,
        body: `Notes for ${tagName}`,
        html_url: `https://github.com/acme/service/releases/tag/${tagName}`,
        published_at: '2024-01-01T00:00:00Z',
        ...overrides,
      };
    }

    // Helper: build a full page of 100 releases (all outside any typical test range)
    function makePaddingPage(count = 100): Record<string, unknown>[] {
      return Array.from({ length: count }, (_, i) => makeRelease(`v0.0.${i + 1}`));
    }

    test('returns empty without calling API when cooldown is active', async () => {
      vi.useFakeTimers();
      const provider = new GithubProvider();

      // Trip the cooldown via fetchByTag
      mockAxiosGet.mockRejectedValue({
        response: { status: 403, headers: { 'retry-after': '60' } },
      });
      const tripPromise = provider.fetchByTag('github.com/acme/service', '1.0.0');
      await vi.runAllTimersAsync();
      await tripPromise;

      mockAxiosGet.mockReset();

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');
      expect(result).toEqual({ notes: [], interrupted: true });
      expect(mockAxiosGet).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    test('returns empty for non-GitHub source repos', async () => {
      const provider = new GithubProvider();
      const result = await provider.fetchRange('gitlab.com/acme/service', '1.0.0', '2.0.0');
      expect(result).toEqual({ notes: [], interrupted: false });
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('returns empty when fromTag is not strict semver', async () => {
      const provider = new GithubProvider();
      const result = await provider.fetchRange('github.com/acme/service', 'latest', '2.0.0');
      expect(result).toEqual({ notes: [], interrupted: false });
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('returns empty when toTag is not strict semver', async () => {
      const provider = new GithubProvider();
      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '2024-01-15');
      expect(result).toEqual({ notes: [], interrupted: false });
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('returns empty when fromTag and toTag are equal', async () => {
      const provider = new GithubProvider();
      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '1.0.0');
      expect(result).toEqual({ notes: [], interrupted: false });
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('returns empty when fromTag is greater than toTag (inverted range)', async () => {
      const provider = new GithubProvider();
      const result = await provider.fetchRange('github.com/acme/service', '2.0.0', '1.0.0');
      expect(result).toEqual({ notes: [], interrupted: false });
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('range filtering: fromTag excluded, toTag included, out-of-range skipped, across two pages', async () => {
      const provider = new GithubProvider();

      // Page 1 (full 100): mix of in-range and out-of-range releases
      const page1: Record<string, unknown>[] = [
        // above toTag — excluded
        makeRelease('v1.3.0'),
        // equal to toTag — included (toSemver.compare(1.2.0) = 0 >= 0)
        makeRelease('v1.2.0'),
        // in range
        makeRelease('v1.1.5'),
        // equal to fromTag — excluded (fromSemver.compare(1.0.0) = 0, not < 0)
        makeRelease('v1.0.0'),
        // below fromTag — excluded
        makeRelease('v0.9.0'),
        // pad to 100
        ...makePaddingPage(95),
      ];
      // Page 2 (partial): one more in-range release
      const page2 = [makeRelease('v1.1.0')];

      mockAxiosGet.mockResolvedValueOnce({ data: page1 });
      mockAxiosGet.mockResolvedValueOnce({ data: page2 });

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '1.2.0');

      expect(result.interrupted).toBe(false);
      // Collected: v1.2.0, v1.1.5, v1.1.0 — sorted newest-first
      expect(result.notes).toHaveLength(3);
      expect(result.notes[0].title).toBe('Release v1.2.0');
      expect(result.notes[1].title).toBe('Release v1.1.5');
      expect(result.notes[2].title).toBe('Release v1.1.0');
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    });

    test('sorts newest-first even when a backport appears earlier in the feed', async () => {
      const provider = new GithubProvider();

      // GitHub feed is sorted by created_at, not semver.
      // A backport (1.0.5) may appear near top of feed (created recently),
      // but must sort to the end after 1.2.0 and 1.1.0.
      const page: Record<string, unknown>[] = [
        makeRelease('v1.0.5'), // backport — low semver but created recently
        makeRelease('v1.2.0'),
        makeRelease('v1.1.0'),
      ];

      mockAxiosGet.mockResolvedValueOnce({ data: page });

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '1.2.0');

      expect(result.interrupted).toBe(false);
      expect(result.notes).toHaveLength(3);
      // Newest-first by semver, not feed order
      expect(result.notes[0].title).toBe('Release v1.2.0');
      expect(result.notes[1].title).toBe('Release v1.1.0');
      expect(result.notes[2].title).toBe('Release v1.0.5');
    });

    test('stops pagination when a page returns 0 records', async () => {
      const provider = new GithubProvider();

      mockAxiosGet
        .mockResolvedValueOnce({ data: makePaddingPage(100) }) // full page
        .mockResolvedValueOnce({ data: [] }); // empty → stop

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');
      expect(result).toEqual({ notes: [], interrupted: false });
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    });

    test('stops pagination when a page returns fewer than 100 records', async () => {
      const provider = new GithubProvider();

      mockAxiosGet
        .mockResolvedValueOnce({ data: makePaddingPage(100) }) // full page
        .mockResolvedValueOnce({ data: makePaddingPage(42) }); // partial → stop

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');
      expect(result).toEqual({ notes: [], interrupted: false });
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    });

    test('hard cap: stops at MAX_RELEASE_LIST_PAGES (10) even when all pages are full', async () => {
      const provider = new GithubProvider();

      // 11 full pages — only 10 should be fetched; reaching the cap with a full page
      // means there may be more data, so interrupted must be true.
      for (let i = 0; i < 11; i++) {
        mockAxiosGet.mockResolvedValueOnce({ data: makePaddingPage(100) });
      }

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');
      expect(result.interrupted).toBe(true);
      expect(result.notes).toEqual([]);
      expect(mockAxiosGet).toHaveBeenCalledTimes(10);
    });

    test('returns empty notes when no releases fall within the range', async () => {
      const provider = new GithubProvider();

      // Only a release above toTag (3.0.0 > 2.0.0)
      mockAxiosGet.mockResolvedValueOnce({
        data: [makeRelease('v3.0.0')],
      });

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');
      expect(result).toEqual({ notes: [], interrupted: false });
    });

    test('forwards explicit token even when allowToken:false', async () => {
      const provider = new GithubProvider();
      mockAxiosGet.mockResolvedValueOnce({ data: [] });

      await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0', 'explicit-token', {
        allowToken: false,
      });

      expect(mockAxiosGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer explicit-token',
          }),
        }),
      );
    });

    test('fetchRange logs debug when explicit token forwarded to untrusted source (allowToken:false)', async () => {
      const provider = new GithubProvider();
      mockAxiosGet.mockResolvedValueOnce({ data: [] });

      await provider.fetchRange('github.com/acme/untrusted', '1.0.0', '2.0.0', 'explicit-token', {
        allowToken: false,
      });

      expect(mockLogDebug).toHaveBeenCalledWith(
        expect.stringContaining('DD_RELEASE_NOTES_GITHUB_TOKEN forwarded'),
        'github.com/acme/untrusted',
      );
    });

    test('uses GHCR fallback when allowToken:true and no explicit token', async () => {
      const provider = new GithubProvider();
      mockGetGhcrTokenFallback.mockReturnValueOnce('ghcr-pat-token');
      mockAxiosGet.mockResolvedValueOnce({ data: [] });

      await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');

      expect(mockAxiosGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ghcr-pat-token',
          }),
        }),
      );
    });

    test('does NOT use GHCR fallback when allowToken:false (no explicit token)', async () => {
      const provider = new GithubProvider();
      mockGetGhcrTokenFallback.mockReturnValueOnce('ghcr-pat-token');
      mockAxiosGet.mockResolvedValueOnce({ data: [] });

      await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0', undefined, {
        allowToken: false,
      });

      expect(mockAxiosGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      );
      expect(mockGetGhcrTokenFallback).not.toHaveBeenCalled();
    });

    test('skips non-semver tag_name entries without breaking pagination', async () => {
      const provider = new GithubProvider();

      const page = [
        { tag_name: 'latest', name: 'Latest', body: '', html_url: '', published_at: '' },
        { tag_name: '2024-01-15', name: 'Date tag', body: '', html_url: '', published_at: '' },
        makeRelease('v1.1.0'),
      ];

      mockAxiosGet.mockResolvedValueOnce({ data: page });

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '1.2.0');
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].title).toBe('Release v1.1.0');
      expect(result.interrupted).toBe(false);
    });

    test('skips non-record items and records without string tag_name in array', async () => {
      const provider = new GithubProvider();

      const page = [
        null, // !isRecord → skip
        'string-item', // !isRecord → skip
        { tag_name: 42 }, // tag_name not a string → skip
        { tag_name: undefined }, // tag_name not a string → skip
        makeRelease('v1.1.0'), // valid → included
      ];

      mockAxiosGet.mockResolvedValueOnce({ data: page });

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '1.2.0');
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].title).toBe('Release v1.1.0');
    });

    test('treats non-array API response as empty page and stops', async () => {
      const provider = new GithubProvider();

      // GitHub shouldn't do this, but guard against it
      mockAxiosGet.mockResolvedValueOnce({ data: { message: 'Not Found' } });

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');
      expect(result).toEqual({ notes: [], interrupted: false });
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    test('retries a 429 on a page via withRetry and returns notes on success', async () => {
      vi.useFakeTimers();
      const provider = new GithubProvider();

      mockAxiosGet
        .mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '0' } } })
        .mockResolvedValueOnce({ data: [makeRelease('v1.1.0')] });

      const promise = provider.fetchRange('github.com/acme/service', '1.0.0', '1.2.0');
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.interrupted).toBe(false);
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].title).toBe('Release v1.1.0');
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    test('secondary-rate-limit 403 after withRetry exhaustion: sets cooldown, interrupted:true, returns partial notes', async () => {
      vi.useFakeTimers();
      const provider = new GithubProvider();

      // Page 1: one in-range release + padding to make it a full page
      const page1 = [
        makeRelease('v1.1.0'),
        ...makePaddingPage(99), // padding — all outside test range
      ];
      mockAxiosGet.mockResolvedValueOnce({ data: page1 });

      // Page 2: persistent secondary-rate-limit 403 — withRetry exhausts all retries
      mockAxiosGet.mockRejectedValue({
        response: { status: 403, headers: { 'retry-after': '0' } },
      });

      const promise = provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.interrupted).toBe(true);
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].title).toBe('Release v1.1.0');
      // No token → unauthenticated
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringMatching(/rate-limited \(unauthenticated\).*cooldown/i),
      );

      vi.useRealTimers();
    });

    test('secondary-rate-limit 403: warn says authenticated when token is present', async () => {
      vi.useFakeTimers();
      const provider = new GithubProvider();

      // All retries exhaust immediately on the first page
      mockAxiosGet.mockRejectedValue({
        response: { status: 403, headers: { 'retry-after': '0' } },
      });

      const promise = provider.fetchRange(
        'github.com/acme/service',
        '1.0.0',
        '2.0.0',
        'explicit-token',
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.interrupted).toBe(true);
      expect(result.notes).toEqual([]);
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringMatching(/rate-limited \(authenticated\).*cooldown/i),
      );

      vi.useRealTimers();
    });

    test('plain 401 with explicit token: interrupted:true + Configured GITHUB_TOKEN rejected warn', async () => {
      const provider = new GithubProvider();
      mockAxiosGet.mockRejectedValueOnce({
        response: { status: 401, headers: {} },
      });

      const result = await provider.fetchRange(
        'github.com/acme/service',
        '1.0.0',
        '2.0.0',
        'bad-token',
      );

      expect(result.interrupted).toBe(true);
      expect(result.notes).toEqual([]);
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringMatching(/Configured GITHUB_TOKEN rejected/i),
      );
    });

    test('plain 401 with GHCR fallback: interrupted:true + GHCR token fallback rejected warn', async () => {
      const provider = new GithubProvider();
      mockGetGhcrTokenFallback.mockReturnValueOnce('ghcr-token');
      mockAxiosGet.mockRejectedValueOnce({
        response: { status: 401, headers: {} },
      });

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');

      expect(result.interrupted).toBe(true);
      expect(result.notes).toEqual([]);
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringMatching(/GHCR token fallback.*rejected/i),
      );
    });

    test('plain 403 with no token and no GHCR fallback: interrupted:true, no warn', async () => {
      const provider = new GithubProvider();
      mockGetGhcrTokenFallback.mockReturnValueOnce(undefined);
      mockAxiosGet.mockRejectedValueOnce({
        response: { status: 403, headers: null },
      });

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');

      expect(result.interrupted).toBe(true);
      expect(result.notes).toEqual([]);
      expect(mockLogWarn).not.toHaveBeenCalled();
      expect(mockLogDebug).not.toHaveBeenCalled();
    });

    test('generic network error: interrupted:true + debug log', async () => {
      const provider = new GithubProvider();
      mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '2.0.0');

      expect(result.interrupted).toBe(true);
      expect(result.notes).toEqual([]);
      expect(mockLogDebug).toHaveBeenCalledWith(
        expect.stringContaining('Unable to list GitHub releases'),
      );
      expect(mockLogWarn).not.toHaveBeenCalled();
    });

    test('mapGithubReleaseToNotes fallbacks applied inside fetchRange', async () => {
      const provider = new GithubProvider();

      // Release with missing/bad fields — same fallbacks as fetchByTag
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          {
            tag_name: 'v1.1.0',
            body: null,
            name: '   ',
            html_url: '',
            published_at: 'bad-date',
          },
        ],
      });

      const result = await provider.fetchRange('github.com/acme/service', '1.0.0', '1.2.0');
      expect(result.notes).toHaveLength(1);
      const note = result.notes[0];
      expect(note.title).toBe('v1.1.0'); // tag fallback
      expect(note.body).toBe('');
      expect(note.url).toBe('https://github.com/acme/service/releases/tag/v1.1.0');
      expect(note.publishedAt).toBe(new Date(0).toISOString());
      expect(note.provider).toBe('github');
    });
  });
});
