import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());
const mockLogDebug = vi.hoisted(() => vi.fn());
const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
  },
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({
      debug: mockLogDebug,
      info: mockLogInfo,
      warn: mockLogWarn,
      error: mockLogError,
    }),
  },
}));

import { ddEnvVars } from '../configuration/index.js';
import {
  _resetReleaseNotesCacheForTests,
  detectSourceRepoFromImageMetadata,
  getFullReleaseNotesForContainer,
  getIntermediateReleaseNotes,
  resolveSourceRepoForContainer,
  toContainerReleaseNotes,
  truncateReleaseNotesBody,
} from './index.js';
import { _resetGithubProviderCooldownForTests } from './providers/GithubProvider.js';

describe('release-notes service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetReleaseNotesCacheForTests();
    delete ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetGithubProviderCooldownForTests();
    delete ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN;
  });

  test('detectSourceRepoFromImageMetadata should prefer container label but mark it untrusted', () => {
    const resolution = detectSourceRepoFromImageMetadata({
      containerLabels: {
        'dd.source.repo': 'github.com/acme/manual',
      },
      imageLabels: {
        'org.opencontainers.image.source': 'https://github.com/acme/from-image',
      },
      imageRegistryDomain: 'ghcr.io',
      imagePath: 'acme/service',
    });

    expect(resolution).toEqual({ sourceRepo: 'github.com/acme/manual', trusted: false });
  });

  test('detectSourceRepoFromImageMetadata should mark image label (dd.source.repo) as trusted', () => {
    const resolution = detectSourceRepoFromImageMetadata({
      imageLabels: {
        'dd.source.repo': 'github.com/acme/from-image-label',
      },
    });

    expect(resolution).toEqual({ sourceRepo: 'github.com/acme/from-image-label', trusted: true });
  });

  test('detectSourceRepoFromImageMetadata should parse OCI labels and ghcr fallbacks as trusted', () => {
    expect(
      detectSourceRepoFromImageMetadata({
        imageLabels: {
          'org.opencontainers.image.source': 'https://github.com/acme/service.git',
        },
      }),
    ).toEqual({ sourceRepo: 'github.com/acme/service', trusted: true });

    expect(
      detectSourceRepoFromImageMetadata({
        imageLabels: {
          'org.opencontainers.image.url': 'https://github.com/acme/url-only',
        },
      }),
    ).toEqual({ sourceRepo: 'github.com/acme/url-only', trusted: true });

    expect(
      detectSourceRepoFromImageMetadata({
        imageRegistryDomain: 'ghcr.io',
        imagePath: 'acme/service',
      }),
    ).toEqual({ sourceRepo: 'github.com/acme/service', trusted: true });
  });

  test('detectSourceRepoFromImageMetadata should handle malformed values and ssh syntax', () => {
    // Blank container label falls through to image label (OCI source) — trusted
    expect(
      detectSourceRepoFromImageMetadata({
        containerLabels: {
          'dd.source.repo': '   ',
        },
        imageLabels: {
          'org.opencontainers.image.source': 'git@github.com:acme/from-ssh.git',
        },
      }),
    ).toEqual({ sourceRepo: 'github.com/acme/from-ssh', trusted: true });

    expect(
      detectSourceRepoFromImageMetadata({
        imageLabels: {
          'org.opencontainers.image.source': 'https://github.com/',
          'org.opencontainers.image.url': 'http://[::1',
        },
      }),
    ).toBeUndefined();

    expect(
      detectSourceRepoFromImageMetadata({
        imageLabels: {
          'org.opencontainers.image.source': 'https://github.com/acme',
        },
      }),
    ).toBeUndefined();

    expect(
      detectSourceRepoFromImageMetadata({
        imageRegistryDomain: 'ghcr.io',
        imagePath: '/',
      }),
    ).toBeUndefined();

    expect(
      detectSourceRepoFromImageMetadata({
        imageLabels: {
          'org.opencontainers.image.source': 'git@:acme/from-ssh.git',
        },
      }),
    ).toBeUndefined();
  });

  test('resolveSourceRepoForContainer should fetch source from Docker Hub tag metadata and cache it', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        source: 'https://github.com/nginx/nginx',
      },
    });

    const container = {
      image: {
        name: 'library/nginx',
        tag: {
          value: '1.0.0',
        },
        registry: {
          url: 'docker.io',
        },
      },
      labels: {},
    };

    const first = await resolveSourceRepoForContainer(container as any);
    const second = await resolveSourceRepoForContainer(container as any);

    expect(first).toEqual({ sourceRepo: 'github.com/nginx/nginx', trusted: true });
    expect(second).toEqual({ sourceRepo: 'github.com/nginx/nginx', trusted: true });
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://hub.docker.com/v2/repositories/library/nginx/tags/1.0.0',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
        },
      }),
    );
  });

  test('resolveSourceRepoForContainer should treat blank registry url as Docker Hub', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        source: 'https://github.com/library/nginx',
      },
    });

    const resolution = await resolveSourceRepoForContainer({
      image: {
        name: 'library/nginx',
        tag: {
          value: 'stable',
        },
        registry: {
          url: '   ',
        },
      },
      labels: {},
    } as any);

    expect(resolution).toEqual({ sourceRepo: 'github.com/library/nginx', trusted: true });
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  test('resolveSourceRepoForContainer should return untrusted when source comes from container label', async () => {
    const resolution = await resolveSourceRepoForContainer({
      image: {
        name: 'acme/service',
        registry: {
          url: 'docker.io',
        },
      },
      labels: {
        'dd.source.repo': 'https://github.com/acme/from-label.git',
      },
    } as any);

    expect(resolution).toEqual({ sourceRepo: 'github.com/acme/from-label', trusted: false });
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('resolveSourceRepoForContainer should return cached sourceRepo as untrusted when provenance is unavailable', async () => {
    // non-Docker-Hub image (quay.io) with no label-based resolution and no GHCR derivation,
    // but with a pre-cached container.sourceRepo. The sourceRepo value does not carry
    // provenance, so it must not be treated as authenticated/trusted.
    const resolution = await resolveSourceRepoForContainer({
      image: {
        name: 'acme/widget',
        tag: {
          value: '1.0.0',
        },
        registry: {
          url: 'quay.io',
        },
      },
      // No OCI/dd labels and quay.io registry → detectSourceRepoFromImageMetadata returns undefined
      labels: {},
      // Pre-cached sourceRepo populated from a prior resolution cycle
      sourceRepo: 'github.com/acme/widget',
    } as any);

    expect(resolution).toEqual({ sourceRepo: 'github.com/acme/widget', trusted: false });
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('resolveSourceRepoForContainer should return undefined for non-Docker-Hub images', async () => {
    const resolution = await resolveSourceRepoForContainer({
      image: {
        name: 'acme/service',
        tag: {
          value: '1.0.0',
        },
        registry: {
          url: 'quay.io',
        },
      },
      labels: {},
    } as any);

    expect(resolution).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('resolveSourceRepoForContainer should return undefined when image name or tag is missing', async () => {
    const missingName = await resolveSourceRepoForContainer({
      image: {
        tag: {
          value: '1.0.0',
        },
        registry: {
          url: 'docker.io',
        },
      },
      labels: {},
      result: {
        tag: '1.0.0',
      },
    } as any);
    const missingTag = await resolveSourceRepoForContainer({
      image: {
        name: 'library/nginx',
        registry: {
          url: 'docker.io',
        },
      },
      labels: {},
    } as any);

    expect(missingName).toBeUndefined();
    expect(missingTag).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('resolveSourceRepoForContainer should fall back to repository metadata after tag lookup failure', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('tag metadata failed'));
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        repository: {
          source: 'https://github.com/acme/repository-fallback.git',
        },
      },
    });

    const resolution = await resolveSourceRepoForContainer({
      image: {
        name: 'acme/service',
        tag: {
          value: '2.1.0',
        },
        registry: {
          url: 'docker.io',
        },
      },
      labels: {},
    } as any);

    expect(resolution).toEqual({
      sourceRepo: 'github.com/acme/repository-fallback',
      trusted: true,
    });
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    expect(mockAxiosGet).toHaveBeenNthCalledWith(
      2,
      'https://hub.docker.com/v2/repositories/acme/service',
      expect.any(Object),
    );
  });

  test('resolveSourceRepoForContainer should return undefined when Docker Hub metadata does not contain source', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: 'unexpected-payload',
    });
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        repository: {},
      },
    });

    const sourceRepo = await resolveSourceRepoForContainer({
      image: {
        name: 'library/nginx',
        tag: {
          value: '1.27.0',
        },
        registry: {
          url: 'docker.io',
        },
      },
      labels: {},
    } as any);

    expect(sourceRepo).toBeUndefined();
  });

  test('resolveSourceRepoForContainer should handle non-Error failures from Docker Hub endpoints', async () => {
    mockAxiosGet.mockRejectedValueOnce(123);
    mockAxiosGet.mockRejectedValueOnce({ message: 'repository metadata unavailable' });

    const sourceRepo = await resolveSourceRepoForContainer({
      image: {
        name: 'library/nginx',
        tag: {
          value: '1.28.0',
        },
        registry: {
          url: 'docker.io',
        },
      },
      labels: {},
    } as any);

    expect(sourceRepo).toBeUndefined();
  });

  test('resolveSourceRepoForContainer should stringify object failures with non-string message fields', async () => {
    mockAxiosGet.mockRejectedValueOnce({ message: { detail: 'tag metadata unavailable' } });
    mockAxiosGet.mockRejectedValueOnce({ message: { detail: 'repository metadata unavailable' } });

    const sourceRepo = await resolveSourceRepoForContainer({
      image: {
        name: 'library/nginx',
        tag: {
          value: '1.28.1',
        },
        registry: {
          url: 'docker.io',
        },
      },
      labels: {},
    } as any);

    expect(sourceRepo).toBeUndefined();
  });

  test('resolveSourceRepoForContainer should refresh expired Docker Hub source repo cache entries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    mockAxiosGet.mockResolvedValue({
      data: {
        source: 'https://github.com/library/nginx',
      },
    });

    const container = {
      image: {
        name: 'library/nginx',
        tag: {
          value: '1.29.0',
        },
        registry: {
          url: 'docker.io',
        },
      },
      labels: {},
    };

    const first = await resolveSourceRepoForContainer(container as any);
    vi.setSystemTime(new Date('2026-01-01T07:00:00.000Z'));
    const second = await resolveSourceRepoForContainer(container as any);

    expect(first).toEqual({ sourceRepo: 'github.com/library/nginx', trusted: true });
    expect(second).toEqual({ sourceRepo: 'github.com/library/nginx', trusted: true });
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
  });

  test('resolveSourceRepoForContainer should cache not-found Docker Hub source repo lookups', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: {} });
    mockAxiosGet.mockResolvedValueOnce({ data: {} });

    const container = {
      image: {
        name: 'library/nginx',
        tag: {
          value: '9.9.9',
        },
        registry: {
          url: 'docker.io',
        },
      },
      labels: {},
    };

    const first = await resolveSourceRepoForContainer(container as any);
    const second = await resolveSourceRepoForContainer(container as any);

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
  });

  test('resolveSourceRepoForContainer should not treat malformed registry hostnames as Docker Hub', async () => {
    const sourceRepo = await resolveSourceRepoForContainer({
      image: {
        name: 'acme/service',
        tag: {
          value: '1.0.0',
        },
        registry: {
          url: 'https://registry with spaces.example.com/path',
        },
      },
      labels: {},
    } as any);

    expect(sourceRepo).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('getFullReleaseNotesForContainer should resolve GitHub releases with v/version variants', async () => {
    mockAxiosGet.mockRejectedValueOnce({
      response: {
        status: 404,
      },
    });
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: '1.2.3',
        name: 'Release 1.2.3',
        body: 'Full release notes body',
        html_url: 'https://github.com/acme/service/releases/tag/1.2.3',
        published_at: '2026-03-01T00:00:00.000Z',
      },
    });

    const releaseNotes = await getFullReleaseNotesForContainer({
      sourceRepo: 'github.com/acme/service',
      result: {
        tag: '1.2.3',
      },
    } as any);

    expect(mockAxiosGet).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/acme/service/releases/tags/v1.2.3',
      expect.any(Object),
    );
    expect(mockAxiosGet).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/acme/service/releases/tags/1.2.3',
      expect.any(Object),
    );
    expect(releaseNotes).toEqual({
      title: 'Release 1.2.3',
      body: 'Full release notes body',
      url: 'https://github.com/acme/service/releases/tag/1.2.3',
      publishedAt: '2026-03-01T00:00:00.000Z',
      provider: 'github',
    });
  });

  test('getFullReleaseNotesForContainer should include optional GitHub auth token for trusted source repos', async () => {
    ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN = 'ghp_test';
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v2.0.0',
        name: 'Release 2.0.0',
        body: 'Notes',
        html_url: 'https://github.com/acme/service/releases/tag/v2.0.0',
        published_at: '2026-03-01T00:00:00.000Z',
      },
    });

    await getFullReleaseNotesForContainer({
      image: {
        name: 'acme/service',
        registry: {
          url: 'https://ghcr.io',
        },
      },
      result: {
        tag: '2.0.0',
      },
    } as any);

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/service/releases/tags/v2.0.0',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test',
        }),
      }),
    );
  });

  test('getFullReleaseNotesForContainer should omit auth header when token is blank', async () => {
    ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN = '   ';
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v2.1.0',
        name: 'Release 2.1.0',
        body: 'Notes',
        html_url: 'https://github.com/acme/service/releases/tag/v2.1.0',
        published_at: '2026-03-01T00:00:00.000Z',
      },
    });

    await getFullReleaseNotesForContainer({
      sourceRepo: 'github.com/acme/service',
      result: {
        tag: '2.1.0',
      },
    } as any);

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/service/releases/tags/v2.1.0',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  test('getFullReleaseNotesForContainer should return undefined when tag is missing', async () => {
    const releaseNotes = await getFullReleaseNotesForContainer({
      sourceRepo: 'github.com/acme/service',
      result: {},
    } as any);

    expect(releaseNotes).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('getFullReleaseNotesForContainer should return undefined when source repo cannot be resolved', async () => {
    const releaseNotes = await getFullReleaseNotesForContainer({
      result: {
        tag: '1.2.3',
      },
      image: {
        name: 'acme/service',
        tag: {
          value: '1.2.3',
        },
        registry: {
          url: 'registry.example.com',
        },
      },
      labels: {},
    } as any);

    expect(releaseNotes).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('getFullReleaseNotesForContainer should return undefined when no provider supports the source repo', async () => {
    const releaseNotes = await getFullReleaseNotesForContainer({
      sourceRepo: 'https://gitlab.com/acme/service',
      result: {
        tag: '1.2.3',
      },
    } as any);

    expect(releaseNotes).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('getFullReleaseNotesForContainer should cache not-found release notes results', async () => {
    mockAxiosGet
      .mockRejectedValueOnce({
        response: {
          status: 404,
        },
      })
      .mockRejectedValueOnce({
        response: {
          status: 404,
        },
      });

    const container = {
      sourceRepo: 'github.com/acme/service',
      result: {
        tag: '9.9.9',
      },
    };

    const first = await getFullReleaseNotesForContainer(container as any);
    const second = await getFullReleaseNotesForContainer(container as any);

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
  });

  test('getFullReleaseNotesForContainer should return undefined when GitHub rate limit is hit', async () => {
    vi.useFakeTimers();
    // Reject every attempt (all tag variants + all retry attempts) so withRetry exhausts retries
    mockAxiosGet.mockRejectedValue({
      response: {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'retry-after': '0',
        },
      },
    });

    const promise = getFullReleaseNotesForContainer({
      sourceRepo: 'github.com/acme/service',
      result: {
        tag: '2.0.0',
      },
    } as any);
    await vi.runAllTimersAsync();
    const releaseNotes = await promise;

    expect(releaseNotes).toBeUndefined();
    // withRetry fired multiple attempts before exhausting retries
    expect(mockAxiosGet.mock.calls.length).toBeGreaterThan(1);
  });

  test('resolveSourceRepoForContainer finds source repo from imageLabels when container labels are absent', async () => {
    const resolution = await resolveSourceRepoForContainer(
      {
        image: {
          name: 'acme/service',
          registry: {
            url: 'registry.example.com',
          },
        },
        labels: {},
      } as any,
      {
        'org.opencontainers.image.source': 'https://github.com/acme/from-image-labels',
      },
    );

    expect(resolution).toEqual({ sourceRepo: 'github.com/acme/from-image-labels', trusted: true });
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('getReleaseNotesForTag returns undefined for empty-string tag', async () => {
    const { getReleaseNotesForTag } = await import('./index.js');
    const result = await getReleaseNotesForTag(
      { sourceRepo: 'github.com/acme/service' } as any,
      '',
    );

    expect(result).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('getReleaseNotesForTag returns undefined for whitespace-only tag', async () => {
    const { getReleaseNotesForTag } = await import('./index.js');
    const result = await getReleaseNotesForTag(
      { sourceRepo: 'github.com/acme/service' } as any,
      '   ',
    );

    expect(result).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('getReleaseNotesForTag returns undefined when no source repo resolvable', async () => {
    const { getReleaseNotesForTag } = await import('./index.js');
    const result = await getReleaseNotesForTag(
      {
        image: {
          name: 'acme/service',
          registry: { url: 'registry.example.com' },
        },
        labels: {},
      } as any,
      '1.2.3',
    );

    expect(result).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('getReleaseNotesForTag returns undefined when no provider supports the repo (gitlab)', async () => {
    const { getReleaseNotesForTag } = await import('./index.js');
    const result = await getReleaseNotesForTag(
      { sourceRepo: 'gitlab.com/acme/service' } as any,
      '1.2.3',
    );

    expect(result).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('getReleaseNotesForTag returns notes for an arbitrary tag string when provider supports the repo', async () => {
    const { getReleaseNotesForTag } = await import('./index.js');
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v2.5.0',
        name: 'Release 2.5.0',
        body: 'Arbitrary tag notes',
        html_url: 'https://github.com/acme/service/releases/tag/v2.5.0',
        published_at: '2026-03-01T00:00:00.000Z',
      },
    });

    const result = await getReleaseNotesForTag(
      { sourceRepo: 'github.com/acme/service' } as any,
      '2.5.0',
    );

    expect(result).toEqual({
      title: 'Release 2.5.0',
      body: 'Arbitrary tag notes',
      url: 'https://github.com/acme/service/releases/tag/v2.5.0',
      publishedAt: '2026-03-01T00:00:00.000Z',
      provider: 'github',
    });
  });

  test('getFullReleaseNotesForContainer delegates to getReleaseNotesForTag using result.tag', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v3.0.0',
        name: 'Release 3.0.0',
        body: 'Delegation test',
        html_url: 'https://github.com/acme/service/releases/tag/v3.0.0',
        published_at: '2026-04-01T00:00:00.000Z',
      },
    });

    const result = await getFullReleaseNotesForContainer({
      sourceRepo: 'github.com/acme/service',
      result: { tag: '3.0.0' },
    } as any);

    expect(result).toMatchObject({ title: 'Release 3.0.0' });
  });

  test('getFullReleaseNotesForContainer returns undefined when result is missing', async () => {
    const result = await getFullReleaseNotesForContainer({
      sourceRepo: 'github.com/acme/service',
    } as any);

    expect(result).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('truncateReleaseNotesBody and toContainerReleaseNotes should cap body length', () => {
    const fullBody = 'x'.repeat(2500);

    const truncated = truncateReleaseNotesBody(fullBody, 2000);
    expect(truncated.length).toBe(2000);

    const containerReleaseNotes = toContainerReleaseNotes({
      title: 'Release',
      body: fullBody,
      url: 'https://github.com/acme/service/releases/tag/v3.0.0',
      publishedAt: '2026-03-01T00:00:00.000Z',
      provider: 'github',
    });
    expect(containerReleaseNotes.body.length).toBe(2000);
    expect(containerReleaseNotes).toEqual(
      expect.objectContaining({
        title: 'Release',
        url: 'https://github.com/acme/service/releases/tag/v3.0.0',
        provider: 'github',
      }),
    );
  });

  test('truncateReleaseNotesBody should handle boundary maxLength values', () => {
    expect(truncateReleaseNotesBody('abc', 0)).toBe('');
    expect(truncateReleaseNotesBody('abc', 3)).toBe('abc');
    expect(truncateReleaseNotesBody('abcdef', 3)).toBe('abc');
    expect(truncateReleaseNotesBody('abc', 10)).toBe('abc');
  });

  test('truncateReleaseNotesBody should treat non-string bodies as empty', () => {
    expect(truncateReleaseNotesBody(42 as any, 10)).toBe('');
  });

  // -----------------------------------------------------------------------
  // L-4 security fix: container label (dd.source.repo) must not receive a token
  // -----------------------------------------------------------------------

  test('L-4: explicit DD_RELEASE_NOTES_GITHUB_TOKEN is forwarded even to untrusted container-label source repos', async () => {
    // Commit A changed the semantics: an explicit operator token is forwarded
    // to ALL repos (trusted + untrusted), because the operator deliberately scoped
    // it for release-notes lookups. Only the GHCR PAT fallback is suppressed for
    // untrusted sources.
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v1.0.0',
        name: 'Attacker Release',
        body: 'body',
        html_url: 'https://github.com/attacker/evil/releases/tag/v1.0.0',
        published_at: '2026-01-01T00:00:00.000Z',
      },
    });

    ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN = 'ghp_operator_secret';

    await getFullReleaseNotesForContainer({
      labels: {
        'dd.source.repo': 'https://github.com/attacker/evil.git',
      },
      image: {
        name: 'attacker/image',
        registry: { url: 'registry.example.com' },
      },
      result: { tag: '1.0.0' },
    } as any);

    // The explicit token IS forwarded to untrusted sources (only GHCR fallback is suppressed)
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_operator_secret',
        }),
      }),
    );
  });

  test('L-4: explicit token is forwarded even when source comes from cached container.sourceRepo (untrusted provenance)', async () => {
    // container.sourceRepo without label/image-metadata provenance is treated as untrusted,
    // but the explicit operator token is still forwarded (only GHCR fallback is suppressed).
    ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN = 'ghp_operator_secret';
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v1.0.0',
        name: 'Cached Release',
        body: 'body',
        html_url: 'https://github.com/attacker/evil/releases/tag/v1.0.0',
        published_at: '2026-01-01T00:00:00.000Z',
      },
    });

    await getFullReleaseNotesForContainer({
      sourceRepo: 'https://github.com/attacker/evil.git',
      image: {
        name: 'attacker/image',
        registry: { url: 'registry.example.com' },
      },
      labels: {},
      result: { tag: '1.0.0' },
    } as any);

    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_operator_secret',
        }),
      }),
    );
  });

  test('L-4: source repo from GHCR image path (trusted) still sends the token', async () => {
    ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN = 'ghp_operator_secret';
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v2.0.0',
        name: 'Trusted Release',
        body: 'body',
        html_url: 'https://github.com/acme/service/releases/tag/v2.0.0',
        published_at: '2026-01-01T00:00:00.000Z',
      },
    });

    await getFullReleaseNotesForContainer({
      labels: {},
      image: {
        name: 'acme/service',
        registry: { url: 'https://ghcr.io' },
        tag: { value: '2.0.0' },
      },
      result: { tag: '2.0.0' },
    } as any);

    // Token must be sent for GHCR-derived (trusted) source repos
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_operator_secret',
        }),
      }),
    );
  });

  test('L-4: source repo from OCI image label (trusted) still sends the token', async () => {
    ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN = 'ghp_operator_secret';
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v3.0.0',
        name: 'OCI Label Release',
        body: 'body',
        html_url: 'https://github.com/acme/oci/releases/tag/v3.0.0',
        published_at: '2026-01-01T00:00:00.000Z',
      },
    });

    // OCI label is in imageLabels (baked into the image), not containerLabels
    const { getReleaseNotesForTag } = await import('./index.js');
    await getReleaseNotesForTag(
      {
        labels: {},
        image: {
          name: 'acme/oci',
          registry: { url: 'registry.example.com' },
        },
        result: { tag: '3.0.0' },
      } as any,
      '3.0.0',
      {
        'org.opencontainers.image.source': 'https://github.com/acme/oci',
      },
    );

    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_operator_secret',
        }),
      }),
    );
  });

  test('L-4: GHCR token fallback is suppressed for untrusted container-label source repos', async () => {
    // No explicit GitHub token configured, but GHCR fallback exists
    delete ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN;

    // The GithubProvider mock is not in use here — this test drives through the real
    // GithubProvider (via index.ts) with mockAxiosGet intercepting the HTTP call
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v1.0.0',
        name: 'Release',
        body: 'body',
        html_url: 'https://github.com/attacker/evil/releases/tag/v1.0.0',
        published_at: '2026-01-01T00:00:00.000Z',
      },
    });

    // Even if a GHCR PAT is configured (mocked at the GithubProvider level via
    // getGhcrTokenFallback), the token must not be attached when source is untrusted.
    // We verify this by asserting no Authorization header is present.
    await getFullReleaseNotesForContainer({
      labels: {
        'dd.source.repo': 'https://github.com/attacker/evil.git',
      },
      image: {
        name: 'attacker/image',
        registry: { url: 'registry.example.com' },
      },
      result: { tag: '1.0.0' },
    } as any);

    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com'),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  // -----------------------------------------------------------------------
  // Cache key trust segregation (security correctness — cache poisoning fix)
  // -----------------------------------------------------------------------

  test('cache-segregation: untrusted not-found null does not poison a subsequent trusted lookup', async () => {
    const { getReleaseNotesForTag } = await import('./index.js');
    ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN = 'ghp_operator_secret';

    // First call: UNTRUSTED (container label) — GitHub returns 404 (no token sent)
    mockAxiosGet
      .mockRejectedValueOnce({ response: { status: 404 } }) // untrusted: v1.0.0 variant
      .mockRejectedValueOnce({ response: { status: 404 } }); // untrusted: 1.0.0 variant

    const untrustedResult = await getReleaseNotesForTag(
      {
        labels: { 'dd.source.repo': 'https://github.com/acme/private.git' },
        image: { name: 'acme/image', registry: { url: 'registry.example.com' } },
        result: { tag: '1.0.0' },
      } as any,
      '1.0.0',
    );
    expect(untrustedResult).toBeUndefined();

    // Second call: TRUSTED (OCI image label, same repo+tag) — must invoke fetchByTag again
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v1.0.0',
        name: 'Private Release',
        body: 'notes',
        html_url: 'https://github.com/acme/private/releases/tag/v1.0.0',
        published_at: '2026-01-01T00:00:00.000Z',
      },
    });

    const trustedResult = await getReleaseNotesForTag(
      {
        labels: {},
        image: { name: 'acme/image', registry: { url: 'registry.example.com' } },
        result: { tag: '1.0.0' },
      } as any,
      '1.0.0',
      { 'org.opencontainers.image.source': 'https://github.com/acme/private' },
    );

    // The trusted call must NOT return the poisoned null — it must get real notes
    expect(trustedResult).not.toBeUndefined();
    expect(trustedResult?.title).toBe('Private Release');
    // fetchByTag was called for the untrusted attempt (2 tag variants) + once for the trusted attempt
    expect(mockAxiosGet).toHaveBeenCalledTimes(3);
    // The trusted call must have sent the token
    expect(mockAxiosGet).toHaveBeenLastCalledWith(
      expect.stringContaining('api.github.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_operator_secret',
        }),
      }),
    );
  });

  test('cache-segregation: trusted cache entry is not served to an untrusted lookup', async () => {
    const { getReleaseNotesForTag } = await import('./index.js');
    ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN = 'ghp_operator_secret';

    // First call: TRUSTED — caches a successful result
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v2.0.0',
        name: 'Trusted Release',
        body: 'notes',
        html_url: 'https://github.com/acme/shared/releases/tag/v2.0.0',
        published_at: '2026-01-01T00:00:00.000Z',
      },
    });

    await getReleaseNotesForTag(
      {
        labels: {},
        image: { name: 'acme/image', registry: { url: 'registry.example.com' } },
        result: { tag: '2.0.0' },
      } as any,
      '2.0.0',
      { 'org.opencontainers.image.source': 'https://github.com/acme/shared' },
    );

    // Second call: UNTRUSTED (container label, same repo+tag) — must not hit the trusted cache;
    // it must make its own network call (which returns 404)
    mockAxiosGet
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce({ response: { status: 404 } });

    const untrustedResult = await getReleaseNotesForTag(
      {
        labels: { 'dd.source.repo': 'https://github.com/acme/shared.git' },
        image: { name: 'acme/image', registry: { url: 'registry.example.com' } },
        result: { tag: '2.0.0' },
      } as any,
      '2.0.0',
    );

    // Untrusted lookup must NOT receive the trusted cached value
    expect(untrustedResult).toBeUndefined();
    // Total calls: 1 (trusted fetch) + 2 (untrusted fetch, two tag variants)
    expect(mockAxiosGet).toHaveBeenCalledTimes(3);
  });

  test('cache-segregation: same-trust repeated calls still hit the cache (no regression)', async () => {
    const { getReleaseNotesForTag } = await import('./index.js');

    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v3.0.0',
        name: 'Cached Release',
        body: 'notes',
        html_url: 'https://github.com/acme/cached/releases/tag/v3.0.0',
        published_at: '2026-01-01T00:00:00.000Z',
      },
    });

    const container = {
      labels: {},
      image: { name: 'acme/image', registry: { url: 'registry.example.com' } },
      result: { tag: '3.0.0' },
    } as any;
    const imageLabels = { 'org.opencontainers.image.source': 'https://github.com/acme/cached' };

    const first = await getReleaseNotesForTag(container, '3.0.0', imageLabels);
    const second = await getReleaseNotesForTag(container, '3.0.0', imageLabels);

    expect(first?.title).toBe('Cached Release');
    expect(second?.title).toBe('Cached Release');
    // fetchByTag must only have been called once — second call served from cache
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Three-tier cache bucket isolation (#452 cache-poisoning fix)
  // -----------------------------------------------------------------------

  test('cache-segregation: three-tier isolation — #token, #auth, and #anon buckets are all separate', async () => {
    const { getReleaseNotesForTag } = await import('./index.js');
    ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN = 'ghp_token';

    // Call 1: untrusted (container label) WITH token configured → writes to #token bucket
    mockAxiosGet
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce({ response: { status: 404 } });

    const untrustedWithToken = await getReleaseNotesForTag(
      {
        labels: { 'dd.source.repo': 'https://github.com/acme/repo.git' },
        image: { name: 'acme/image', registry: { url: 'registry.example.com' } },
        result: { tag: '4.0.0' },
      } as any,
      '4.0.0',
    );
    expect(untrustedWithToken).toBeUndefined();

    // Call 2: trusted (OCI image label, same repo+tag) → writes to #auth bucket (hits network)
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        tag_name: 'v4.0.0',
        name: 'Auth Release',
        body: 'notes',
        html_url: 'https://github.com/acme/repo/releases/tag/v4.0.0',
        published_at: '2026-01-01T00:00:00.000Z',
      },
    });

    const trusted = await getReleaseNotesForTag(
      {
        labels: {},
        image: { name: 'acme/image', registry: { url: 'registry.example.com' } },
        result: { tag: '4.0.0' },
      } as any,
      '4.0.0',
      { 'org.opencontainers.image.source': 'https://github.com/acme/repo' },
    );
    expect(trusted?.title).toBe('Auth Release');

    // Call 3: untrusted WITHOUT token → writes to #anon bucket (hits network, different from #token)
    delete ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN;
    mockAxiosGet
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce({ response: { status: 404 } });

    const untrustedAnon = await getReleaseNotesForTag(
      {
        labels: { 'dd.source.repo': 'https://github.com/acme/repo.git' },
        image: { name: 'acme/image', registry: { url: 'registry.example.com' } },
        result: { tag: '4.0.0' },
      } as any,
      '4.0.0',
    );
    expect(untrustedAnon).toBeUndefined();

    // Total: 2 (#token 404s) + 1 (#auth hit) + 2 (#anon 404s) = 5 calls
    // Each of the three buckets triggered its own network round-trip.
    expect(mockAxiosGet).toHaveBeenCalledTimes(5);
  });

  // -----------------------------------------------------------------------
  // Silent-downgrade warn (#452 secondary issue)
  // -----------------------------------------------------------------------

  describe('detectSourceRepoFromImageMetadata silent-downgrade warn', () => {
    test('fires when dd.source.repo container label shadows an OCI image.source label', () => {
      detectSourceRepoFromImageMetadata({
        containerLabels: { 'dd.source.repo': 'github.com/attacker/evil' },
        imageLabels: { 'org.opencontainers.image.source': 'https://github.com/acme/real' },
      });

      expect(mockLogWarn).toHaveBeenCalledTimes(1);
      const [msg, containerLabel, trustedLabel] = mockLogWarn.mock.calls[0];
      expect(msg).toContain('dd.source.repo container label');
      expect(containerLabel).toBe('github.com/attacker/evil');
      expect(trustedLabel).toBe('github.com/acme/real');
    });

    test('fires when dd.source.repo container label shadows a dd.source.repo image label', () => {
      detectSourceRepoFromImageMetadata({
        containerLabels: { 'dd.source.repo': 'github.com/attacker/evil' },
        imageLabels: { 'dd.source.repo': 'https://github.com/acme/image-label' },
      });

      expect(mockLogWarn).toHaveBeenCalledTimes(1);
      const [, , trustedLabel] = mockLogWarn.mock.calls[0];
      expect(trustedLabel).toBe('github.com/acme/image-label');
    });

    test('fires when dd.source.repo container label shadows an OCI image.url label', () => {
      detectSourceRepoFromImageMetadata({
        containerLabels: { 'dd.source.repo': 'github.com/attacker/evil' },
        imageLabels: { 'org.opencontainers.image.url': 'https://github.com/acme/url-repo' },
      });

      expect(mockLogWarn).toHaveBeenCalledTimes(1);
      const [, , trustedLabel] = mockLogWarn.mock.calls[0];
      expect(trustedLabel).toBe('github.com/acme/url-repo');
    });

    test('does NOT fire when container label is present but imageLabels has no trusted source', () => {
      detectSourceRepoFromImageMetadata({
        containerLabels: { 'dd.source.repo': 'github.com/attacker/evil' },
        imageLabels: { 'some.other.label': 'value' },
      });

      expect(mockLogWarn).not.toHaveBeenCalled();
    });

    test('resolution is still trusted:false in all warn cases', () => {
      const result = detectSourceRepoFromImageMetadata({
        containerLabels: { 'dd.source.repo': 'github.com/attacker/evil' },
        imageLabels: { 'org.opencontainers.image.source': 'https://github.com/acme/real' },
      });

      expect(result).toEqual({ sourceRepo: 'github.com/attacker/evil', trusted: false });
    });
  });

  // -----------------------------------------------------------------------
  // getMaxIntermediateReleaseNotes (tested indirectly via getIntermediateReleaseNotes)
  // -----------------------------------------------------------------------

  describe('getIntermediateReleaseNotes — max cap and env var', () => {
    const baseContainer = {
      labels: {},
      image: { name: 'acme/image', registry: { url: 'https://ghcr.io' } },
      result: { tag: '2.0.0' },
    } as any;

    function makeNotes(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        tag_name: `v1.0.${i + 1}`,
        name: `Release 1.0.${i + 1}`,
        body: 'notes',
        html_url: `https://github.com/acme/service/releases/tag/v1.0.${i + 1}`,
        published_at: '2026-01-01T00:00:00.000Z',
      }));
    }

    test('default max is 20 when DD_RELEASE_NOTES_MAX_INTERMEDIATE is unset', async () => {
      delete ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE;
      // fetchRange returns 25 notes; default cap is 20 → 20 returned, hiddenCount 5
      mockAxiosGet.mockResolvedValueOnce({ data: makeNotes(25) });

      const result = await getIntermediateReleaseNotes(baseContainer, '1.0.0', '2.0.0');

      expect(result.releaseNotes).toHaveLength(20);
      expect(result.hiddenCount).toBe(5);
    });

    test('max=0 disables the feature and provider.fetchRange is NOT called', async () => {
      ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE = '0';

      const result = await getIntermediateReleaseNotes(baseContainer, '1.0.0', '2.0.0');

      expect(result.releaseNotes).toHaveLength(0);
      expect(result.hiddenCount).toBe(0);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('blank string falls back to default 20', async () => {
      ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE = '   ';
      mockAxiosGet.mockResolvedValueOnce({ data: makeNotes(25) });

      const result = await getIntermediateReleaseNotes(baseContainer, '1.0.0', '2.0.0');

      expect(result.releaseNotes).toHaveLength(20);
      expect(result.hiddenCount).toBe(5);
    });

    test('non-integer string falls back to default 20', async () => {
      ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE = 'banana';
      mockAxiosGet.mockResolvedValueOnce({ data: makeNotes(25) });

      const result = await getIntermediateReleaseNotes(baseContainer, '1.0.0', '2.0.0');

      expect(result.releaseNotes).toHaveLength(20);
    });

    test('negative integer falls back to default 20', async () => {
      ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE = '-5';
      mockAxiosGet.mockResolvedValueOnce({ data: makeNotes(25) });

      const result = await getIntermediateReleaseNotes(baseContainer, '1.0.0', '2.0.0');

      expect(result.releaseNotes).toHaveLength(20);
    });

    afterEach(() => {
      delete ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE;
    });
  });

  // -----------------------------------------------------------------------
  // getIntermediateReleaseNotes — orchestration & caching
  // -----------------------------------------------------------------------

  describe('getIntermediateReleaseNotes', () => {
    const trustedContainer = {
      labels: {},
      image: { name: 'acme/service', registry: { url: 'https://ghcr.io' } },
      result: { tag: '2.0.0' },
    } as any;

    function makeNote(patch: number) {
      return {
        tag_name: `v1.0.${patch}`,
        name: `Release 1.0.${patch}`,
        body: 'notes',
        html_url: `https://github.com/acme/service/releases/tag/v1.0.${patch}`,
        published_at: '2026-01-01T00:00:00.000Z',
      };
    }

    afterEach(() => {
      delete ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE;
    });

    test('fromTag === toTag returns empty, no provider call', async () => {
      const result = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '1.0.0');

      expect(result).toEqual({ releaseNotes: [], hiddenCount: 0 });
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('blank fromTag returns empty', async () => {
      const result = await getIntermediateReleaseNotes(trustedContainer, '   ', '2.0.0');

      expect(result).toEqual({ releaseNotes: [], hiddenCount: 0 });
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('blank toTag returns empty', async () => {
      const result = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '');

      expect(result).toEqual({ releaseNotes: [], hiddenCount: 0 });
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('source unresolvable returns empty', async () => {
      const container = {
        labels: {},
        image: { name: 'acme/image', registry: { url: 'quay.io' } },
        result: { tag: '2.0.0' },
      } as any;

      const result = await getIntermediateReleaseNotes(container, '1.0.0', '2.0.0');

      expect(result).toEqual({ releaseNotes: [], hiddenCount: 0 });
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('provider without fetchRange returns empty', async () => {
      // Use a gitlab-like source repo that no provider supports
      const container = {
        sourceRepo: 'gitlab.com/acme/service',
        labels: {},
        image: { name: 'acme/image', registry: { url: 'quay.io' } },
        result: { tag: '2.0.0' },
      } as any;

      const result = await getIntermediateReleaseNotes(container, '1.0.0', '2.0.0');

      expect(result).toEqual({ releaseNotes: [], hiddenCount: 0 });
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    test('cache MISS calls fetchRange and stores when not interrupted', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [makeNote(1), makeNote(2)] });

      const result = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '2.0.0');

      expect(result.releaseNotes).toHaveLength(2);
      expect(result.hiddenCount).toBe(0);
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    test('cache HIT skips fetchRange on second call', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [makeNote(1)] });

      const first = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '2.0.0');
      const second = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '2.0.0');

      expect(first.releaseNotes).toHaveLength(1);
      expect(second.releaseNotes).toHaveLength(1);
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    test('interrupted result is NOT cached — second call re-invokes fetchRange', async () => {
      // First call: range fetch fails (network error → interrupted=true)
      // GithubProvider returns interrupted=true on exception; trigger by having the
      // list endpoint throw a generic error
      mockAxiosGet.mockRejectedValueOnce(new Error('network error'));
      // Second call: succeeds
      mockAxiosGet.mockResolvedValueOnce({ data: [makeNote(1)] });

      const first = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '2.0.0');
      const second = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '2.0.0');

      // First call returns empty because the range fetch was interrupted (no notes collected)
      expect(first.releaseNotes).toHaveLength(0);
      // Second call hits the network again (result was NOT cached due to interruption)
      expect(second.releaseNotes).toHaveLength(1);
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    });

    test('cap applied at read time — fetchRange returns 25, max=20 → 20 returned + hiddenCount 5', async () => {
      delete ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE; // default 20
      mockAxiosGet.mockResolvedValueOnce({
        data: Array.from({ length: 25 }, (_, i) => makeNote(i + 1)),
      });

      const result = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '2.0.0');

      expect(result.releaseNotes).toHaveLength(20);
      expect(result.hiddenCount).toBe(5);
    });

    test('cap change between two warm-cache calls reflects new hiddenCount without re-fetch', async () => {
      // Populate cache with 10 notes (max=20, so all 10 fit initially)
      delete ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE;
      mockAxiosGet.mockResolvedValueOnce({
        data: Array.from({ length: 10 }, (_, i) => makeNote(i + 1)),
      });

      const first = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '2.0.0');
      expect(first.releaseNotes).toHaveLength(10);
      expect(first.hiddenCount).toBe(0);

      // Now tighten the cap to 3 — the cache holds 10, but we get 3 + hiddenCount 7
      ddEnvVars.DD_RELEASE_NOTES_MAX_INTERMEDIATE = '3';
      const second = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '2.0.0');
      expect(second.releaseNotes).toHaveLength(3);
      expect(second.hiddenCount).toBe(7);
      // No additional network call — served from cache
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    test('three-tier key isolation for intermediate — untrusted+token vs trusted = separate entries', async () => {
      ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN = 'ghp_tok';

      // Untrusted (container label) lookup → #token bucket, 1 note
      mockAxiosGet.mockResolvedValueOnce({ data: [makeNote(1)] });

      const untrustedContainer = {
        labels: { 'dd.source.repo': 'https://github.com/acme/service.git' },
        image: { name: 'acme/service', registry: { url: 'registry.example.com' } },
        result: { tag: '2.0.0' },
      } as any;

      const untrusted = await getIntermediateReleaseNotes(untrustedContainer, '1.0.0', '2.0.0');
      expect(untrusted.releaseNotes).toHaveLength(1);

      // Trusted (GHCR) lookup → #auth bucket, separate network call, 2 notes
      mockAxiosGet.mockResolvedValueOnce({ data: [makeNote(1), makeNote(2)] });

      const trusted = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '2.0.0');
      expect(trusted.releaseNotes).toHaveLength(2);

      // Two separate network calls — different cache keys (#token vs #auth)
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    });

    test('bodies are truncated via toContainerReleaseNotes when body exceeds 2000 chars', async () => {
      const longBody = 'x'.repeat(3000);
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          {
            tag_name: 'v1.0.1',
            name: 'Release 1.0.1',
            body: longBody,
            html_url: 'https://github.com/acme/service/releases/tag/v1.0.1',
            published_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      const result = await getIntermediateReleaseNotes(trustedContainer, '1.0.0', '2.0.0');

      expect(result.releaseNotes).toHaveLength(1);
      expect(result.releaseNotes[0].body.length).toBe(2000);
      expect(result.releaseNotes[0].body.endsWith('...')).toBe(true);
    });
  });
});
