import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockAxiosGet = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
  },
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { ddEnvVars } from '../configuration/index.js';
import {
  _resetReleaseNotesCacheForTests,
  detectSourceRepoFromImageMetadata,
  getFullReleaseNotesForContainer,
  resolveSourceRepoForContainer,
  toContainerReleaseNotes,
  truncateReleaseNotesBody,
} from './index.js';

describe('release-notes service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetReleaseNotesCacheForTests();
    delete ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete ddEnvVars.DD_RELEASE_NOTES_GITHUB_TOKEN;
  });

  test('detectSourceRepoFromImageMetadata should prefer manual override label', () => {
    const sourceRepo = detectSourceRepoFromImageMetadata({
      containerLabels: {
        'dd.source.repo': 'github.com/acme/manual',
      },
      imageLabels: {
        'org.opencontainers.image.source': 'https://github.com/acme/from-image',
      },
      imageRegistryDomain: 'ghcr.io',
      imagePath: 'acme/service',
    });

    expect(sourceRepo).toBe('github.com/acme/manual');
  });

  test('detectSourceRepoFromImageMetadata should parse OCI labels and ghcr fallbacks', () => {
    expect(
      detectSourceRepoFromImageMetadata({
        imageLabels: {
          'org.opencontainers.image.source': 'https://github.com/acme/service.git',
        },
      }),
    ).toBe('github.com/acme/service');

    expect(
      detectSourceRepoFromImageMetadata({
        imageLabels: {
          'org.opencontainers.image.url': 'https://github.com/acme/url-only',
        },
      }),
    ).toBe('github.com/acme/url-only');

    expect(
      detectSourceRepoFromImageMetadata({
        imageRegistryDomain: 'ghcr.io',
        imagePath: 'acme/service',
      }),
    ).toBe('github.com/acme/service');
  });

  test('detectSourceRepoFromImageMetadata should handle malformed values and ssh syntax', () => {
    expect(
      detectSourceRepoFromImageMetadata({
        containerLabels: {
          'dd.source.repo': '   ',
        },
        imageLabels: {
          'org.opencontainers.image.source': 'git@github.com:acme/from-ssh.git',
        },
      }),
    ).toBe('github.com/acme/from-ssh');

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

    expect(first).toBe('github.com/nginx/nginx');
    expect(second).toBe('github.com/nginx/nginx');
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

    const sourceRepo = await resolveSourceRepoForContainer({
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

    expect(sourceRepo).toBe('github.com/library/nginx');
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  test('resolveSourceRepoForContainer should short-circuit when metadata labels resolve source', async () => {
    const sourceRepo = await resolveSourceRepoForContainer({
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

    expect(sourceRepo).toBe('github.com/acme/from-label');
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('resolveSourceRepoForContainer should return undefined for non-Docker-Hub images', async () => {
    const sourceRepo = await resolveSourceRepoForContainer({
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

    expect(sourceRepo).toBeUndefined();
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

    const sourceRepo = await resolveSourceRepoForContainer({
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

    expect(sourceRepo).toBe('github.com/acme/repository-fallback');
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

    expect(first).toBe('github.com/library/nginx');
    expect(second).toBe('github.com/library/nginx');
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

  test('getFullReleaseNotesForContainer should include optional GitHub auth token', async () => {
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
      sourceRepo: 'github.com/acme/service',
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
    mockAxiosGet.mockRejectedValueOnce({
      response: {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
        },
      },
    });

    const releaseNotes = await getFullReleaseNotesForContainer({
      sourceRepo: 'github.com/acme/service',
      result: {
        tag: '2.0.0',
      },
    } as any);

    expect(releaseNotes).toBeUndefined();
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
});
