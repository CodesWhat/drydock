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

import GithubProvider from './GithubProvider.js';

describe('release-notes/providers/GithubProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  test('fetchByTag should stop on non-rate-limited 403 responses', async () => {
    const provider = new GithubProvider();
    mockAxiosGet.mockRejectedValueOnce({
      response: {
        status: 403,
        headers: null,
      },
      message: 'forbidden',
    });

    const releaseNotes = await provider.fetchByTag('github.com/acme/service', '1.0.0');

    expect(releaseNotes).toBeUndefined();
    expect(mockLogDebug).toHaveBeenCalledTimes(1);
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
});
