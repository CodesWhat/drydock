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
});
