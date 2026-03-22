import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockLogDebug = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());

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
});
