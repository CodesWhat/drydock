import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetState, mockSuggestTag } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockSuggestTag: vi.fn(),
}));

vi.mock('../../../registry/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../registry/index.js')>();
  return {
    ...actual,
    getState: mockGetState,
  };
});

vi.mock('../../../tag/suggest.js', () => ({
  suggest: mockSuggestTag,
}));

vi.mock('../../../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { findNewVersion, normalizeContainer } from './image-comparison.js';

function createDigestOnlyContainer(overrides: Record<string, unknown> = {}) {
  return {
    image: {
      id: 'image-1',
      registry: { name: 'hub' },
      tag: { value: 'sha256:abc123', semver: false },
      digest: { watch: true, repo: 'sha256:abc123' },
    },
    ...overrides,
  };
}

function createFloatingAliasContainer(overrides: Record<string, unknown> = {}) {
  return {
    image: {
      id: 'image-1',
      registry: { name: 'hub' },
      name: 'library/postgres',
      tag: { value: '16-alpine', semver: true, tagPrecision: 'floating' },
      digest: { watch: true, repo: 'sha256:local' },
    },
    tagFamily: 'strict',
    ...overrides,
  };
}

function createManifestLookup(version = 1) {
  return vi.fn().mockResolvedValue({
    digest: 'sha256:def456',
    created: '2026-04-01T00:00:00.000Z',
    version,
  });
}

function identityNormalizeImage<T>(image: T): T {
  return image;
}

describe('image-comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSuggestTag.mockReturnValue(null);
  });

  test('retains the remote candidate version separately from the installed alias version', async () => {
    const getImageManifestDigest = vi.fn().mockResolvedValue({
      digest: 'sha256:remote',
      version: 2,
      softwareVersion: '2026.8.2',
    });
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest', '2026.8.2']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const current = createFloatingAliasContainer();
    current.image.tag.value = 'latest';
    current.image.tag.semver = false;
    Object.assign(current.image, { softwareVersion: '2026.7.5' });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    const result = await findNewVersion(current as never, log);

    expect(result).toHaveProperty('softwareVersion', '2026.8.2');
    expect(result.tag).toBe('latest');
    expect(current.image).toHaveProperty('softwareVersion', '2026.7.5');
  });

  test.each([
    {
      tag: 'latest',
      semver: false,
      version: '2026.8.2',
      tags: ['2026.7.9', '2026.8.0', 'v2026.8.0', '2026.8.1', '2026.8.2'],
      family: '2026.8',
    },
    {
      tag: '9',
      semver: true,
      version: '9.0.2',
      tags: ['8.0.0', '9.0.0', 'v9.0.0', 'V9.0.0', '9.0.1', '9.0.2', '10.0.0'],
      family: '9',
    },
  ])(
    'discovers release evidence behind $tag without changing its deploy tag or adding requests',
    async ({ tag, semver, version, tags, family }) => {
      const lookup = vi
        .fn()
        .mockResolvedValue({ digest: 'sha256:remote', version: 2, softwareVersion: version });
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getTags: vi.fn().mockResolvedValue([tag, ...tags]),
            getImageManifestDigest: lookup,
            normalizeImage: identityNormalizeImage,
          },
        },
      });
      const current = createFloatingAliasContainer();
      Object.assign(current.image.tag, { value: tag, semver });
      const result = await findNewVersion(current as never, {
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      expect(result.tag).toBe(tag);
      expect(result.releaseMaturity).toEqual({ version, family, earlierReleases: 2 });
      expect(lookup).toHaveBeenCalledTimes(2);
    },
  );

  test('release evidence uses all filtered releases, including releases older than the install', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['2.0.0', '2.0.1', '2.0.2', '2.0.3', '2.0.4']),
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const current = createFloatingAliasContainer({
      excludeTags: '^2\\.0\\.[01]$',
      tagFamily: 'loose',
    });
    Object.assign(current.image.tag, { value: '2.0.3', tagPrecision: 'specific' });
    current.image.digest.watch = false;
    const result = await findNewVersion(current as never, {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    expect(result.tag).toBe('2.0.4');
    expect(result.releaseMaturity).toEqual({ version: '2.0.4', family: '2', earlierReleases: 2 });
  });

  test('release evidence preserves the strict numeric padding constraint', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['5.01.4', '5.1.5']),
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const current = createFloatingAliasContainer({ includeTags: '^5\\.' });
    Object.assign(current.image.tag, { value: '5.1.4', tagPrecision: 'specific' });
    current.image.digest.watch = false;
    const result = await findNewVersion(current as never, {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    expect(result.tag).toBe('5.1.5');
    expect(result.releaseMaturity).toEqual({ version: '5.1.5', family: '5', earlierReleases: 0 });
  });

  test('does not use installed version or a remote version outside a pinned alias track as release evidence', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValue({ digest: 'sha256:remote', version: 2, softwareVersion: '10.0.2' });
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['9', '9.0.0', '9.0.1', '10.0.0', '10.0.1']),
          getImageManifestDigest: lookup,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const current = createFloatingAliasContainer();
    current.image.tag.value = '9';
    Object.assign(current.image, { softwareVersion: '9.0.2' });
    const result = await findNewVersion(current as never, {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    expect(result.tag).toBe('9');
    expect(result.releaseMaturity).toBeUndefined();
  });

  test.each([
    {
      tag: 'latest',
      version: '2026.8.2',
      family: '2026.8',
      tags: ['2026.8.0', '2026.8.1', '2026.8.2', '2026.8.3'],
    },
    {
      tag: '2',
      version: '2.0.2',
      family: '2',
      tags: ['2.0.0', '2.0.1', '2.0.2', '2.0.3', '3.0.0'],
    },
    {
      tag: '9',
      version: '9.0.2',
      family: '9',
      tags: ['9.0.0', '9.0.1', '9.0.2', '9.0.3', '10.0.0'],
    },
  ])(
    'proves the concrete version behind unlabeled $tag by matching remote digests',
    async ({ tag, version, family, tags }) => {
      const lookup = vi.fn().mockImplementation(async (image) => ({
        digest: [tag, version].includes(image.tag.value)
          ? 'sha256:remote'
          : `sha256:${image.tag.value}`,
        version: 2,
      }));
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getTags: vi.fn().mockResolvedValue([tag, ...tags]),
            getImageManifestDigest: lookup,
            normalizeImage: identityNormalizeImage,
          },
        },
      });
      const current = createFloatingAliasContainer({
        updatePolicy: { maturityMode: 'mature', maturitySkipReleases: 2 },
      });
      Object.assign(current.image.tag, { value: tag, semver: tag !== 'latest' });
      const result = await findNewVersion(current as never, {
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      });
      expect(result.tag).toBe(tag);
      expect(current.image.tag.value).toBe(tag);
      expect(result.releaseMaturity).toEqual({ version, family, earlierReleases: 2 });
      expect(lookup.mock.calls.map(([image]) => image.tag.value).slice(2)).toEqual([
        tags[3],
        version,
      ]);
    },
  );

  test('limits alias proof lookups to eight distinct stable releases and ignores excluded or foreign tracks', async () => {
    const lookup = vi
      .fn()
      .mockImplementation(async (image) => ({ digest: `sha256:${image.tag.value}`, version: 1 }));
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi
            .fn()
            .mockResolvedValue([
              '2',
              '3.0.99',
              '2.0.99-beta.1',
              '2.0.99-debug',
              ...Array.from({ length: 15 }, (_, i) => `2.0.${i}`),
              'v2.0.14',
            ]),
          getImageManifestDigest: lookup,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const current = createFloatingAliasContainer({
      updatePolicy: { maturityMode: 'mature', maturitySkipReleases: 2 },
      excludeTags: '^2\\.0\\.14$',
    });
    current.image.tag.value = '2';
    const result = await findNewVersion(current as never, {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    expect(result.releaseMaturity).toBeUndefined();
    expect(lookup.mock.calls.map(([image]) => image.tag.value)).toEqual([
      '2',
      'v2.0.14',
      '2.0.13',
      '2.0.12',
      '2.0.11',
      '2.0.10',
      '2.0.9',
      '2.0.8',
      '2.0.7',
    ]);
  });

  test.each([
    undefined,
    { maturityMode: 'mature', maturitySkipReleases: 0 },
    { maturityMode: 'all', maturitySkipReleases: 2 },
  ])('adds no alias proof requests when release counting is disabled: %j', async (updatePolicy) => {
    const lookup = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['2', '2.0.0', '2.0.1']),
          getImageManifestDigest: lookup,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const current = createFloatingAliasContainer({ updatePolicy });
    current.image.tag.value = '2';
    const result = await findNewVersion(current as never, {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(result.releaseMaturity).toBeUndefined();
  });

  test('collection hints prove transformed releases through the registry lookup image and survive one failed lookup', async () => {
    const lookup = vi.fn().mockImplementation(async (image) => {
      if (image.tag.value === 'release-2.0.3') throw new Error('registry unavailable');
      return { digest: 'sha256:remote', version: 1 };
    });
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi
            .fn()
            .mockResolvedValue([
              '2',
              'release-2.0.0',
              'release-2.0.1',
              'release-2.0.2',
              'release-2.0.3',
            ]),
          getImageManifestDigest: lookup,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const current = createFloatingAliasContainer({
      transformTags: '^release-(.+) => $1',
      includeTags: '^release-',
      tagFamily: 'loose',
    });
    Object.assign(current.image, {
      name: 'private/mirror',
      registry: { name: 'hub', lookupImage: 'library/upstream' },
      architecture: 'arm64',
      os: 'linux',
    });
    Object.assign(current.image.tag, { value: '2', semver: true });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const result = await findNewVersion(current as never, log, {
      collectReleaseMaturity: true,
      useRegistryPollCache: true,
    });
    expect(result.releaseMaturity).toEqual({ version: '2.0.2', family: '2', earlierReleases: 2 });
    expect(result.tag).toBe('2');
    expect(current.image.name).toBe('private/mirror');
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Release version proof lookup failed'),
    );
    expect(
      lookup.mock.calls.every(
        ([image, digest, options]) =>
          image.name === 'library/upstream' &&
          image.architecture === 'arm64' &&
          digest === undefined &&
          options.usePollCycleCache,
      ),
    ).toBe(true);
  });

  test('does not fabricate release evidence when an enabled alias has no remote digest', async () => {
    const lookup = vi.fn().mockResolvedValue({ version: 1 });
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['2', '2.0.0']),
          getImageManifestDigest: lookup,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const current = createFloatingAliasContainer({
      updatePolicy: { maturityMode: 'mature', maturitySkipReleases: 2 },
    });
    current.image.tag.value = '2';
    const result = await findNewVersion(current as never, {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(result.releaseMaturity).toBeUndefined();
  });

  test('warns and ignores invalid digest include filters', async () => {
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await findNewVersion(createDigestOnlyContainer({ includeTags: '[invalid' }) as never, log);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid regex pattern'));
    expect(getImageManifestDigest.mock.calls[0][0].tag.value).toBe('latest');
  });

  test('applies digest exclude filters before choosing a comparison tag', async () => {
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest', 'stable']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await findNewVersion(createDigestOnlyContainer({ excludeTags: '^latest$' }) as never, log);

    expect(getImageManifestDigest.mock.calls[0][0].tag.value).toBe('stable');
  });

  test('keeps digest-only updates idle when filtering removes every candidate tag', async () => {
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest', 'stable']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    const result = await findNewVersion(
      createDigestOnlyContainer({ includeTags: '^nonexistent$' }) as never,
      log,
    );

    expect(getImageManifestDigest).not.toHaveBeenCalled();
    expect(result).toEqual({
      tag: 'sha256:abc123',
      noUpdateReason: 'Running by digest — no tag to compare',
    });
    expect(log.debug).toHaveBeenCalledWith(
      'Digest-only image — no registry tag candidate available',
    );
  });

  test('falls back to reverse-alphabetical digest tag ordering when no latest or suggested tag exists', async () => {
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['alpha', 'beta']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await findNewVersion(createDigestOnlyContainer() as never, log);

    expect(getImageManifestDigest.mock.calls[0][0].tag.value).toBe('beta');
  });

  test('compares strict floating aliases by digest without advancing to the next tag alias', async () => {
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['16-alpine', '16.1-alpine', '17-alpine']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    const result = await findNewVersion(createFloatingAliasContainer() as never, log);

    expect(result.tag).toBe('16-alpine');
    expect(result.digest).toBe('sha256:def456');
    expect(result.noUpdateReason).toBeUndefined();
    expect(getImageManifestDigest.mock.calls[0][0].tag.value).toBe('16-alpine');
  });

  test('passes explicit poll-cycle cache scope through registry lookups', async () => {
    const getTags = vi.fn().mockResolvedValue(['16-alpine']);
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags,
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await findNewVersion(createFloatingAliasContainer() as never, log, {
      useRegistryPollCache: true,
    });

    expect(getTags).toHaveBeenCalledWith(expect.any(Object), { usePollCycleCache: true });
    expect(getImageManifestDigest).toHaveBeenCalledWith(expect.any(Object), undefined, {
      usePollCycleCache: true,
    });
  });

  test('sets publishedAtTrusted=true in result when provider.publishedAtIsPushDate is true', async () => {
    const publishedAt = '2026-04-01T00:00:00.000Z';
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.1.0']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockResolvedValue(publishedAt),
          publishedAtIsPushDate: true,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.0.0', semver: false },
        digest: { watch: false },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result.publishedAt).toBe(publishedAt);
    expect(result.publishedAtTrusted).toBe(true);
  });

  test('does not set publishedAtTrusted when provider.publishedAtIsPushDate is false', async () => {
    const publishedAt = '2026-04-01T00:00:00.000Z';
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.1.0']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockResolvedValue(publishedAt),
          publishedAtIsPushDate: false,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.0.0', semver: false },
        digest: { watch: false },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result.publishedAt).toBe(publishedAt);
    expect(result.publishedAtTrusted).toBeUndefined();
  });

  test('does not set publishedAtTrusted when publishedAtIsPushDate is absent from provider', async () => {
    const publishedAt = '2026-04-01T00:00:00.000Z';
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.1.0']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockResolvedValue(publishedAt),
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.0.0', semver: false },
        digest: { watch: false },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result.publishedAt).toBe(publishedAt);
    expect(result.publishedAtTrusted).toBeUndefined();
  });

  test('returns current tag when registry is unsupported', async () => {
    mockGetState.mockReturnValue({ registry: {} });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'unknown-registry' },
        name: 'library/nginx',
        tag: { value: '1.0.0', semver: false },
        digest: { watch: false },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result).toEqual({ tag: '1.0.0' });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Unsupported registry'));
  });

  test('returns early with no-update reason when tag is "unknown"', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: 'unknown', semver: false },
        digest: { watch: false },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result.noUpdateReason).toBe('Running by digest — no tag to compare');
    expect(result.tag).toBe('unknown');
  });

  test('digest-only container skips handleDigestWatch when digest.repo is missing', async () => {
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const result = await findNewVersion(
      createDigestOnlyContainer({
        image: {
          id: 'image-1',
          registry: { name: 'hub' },
          tag: { value: 'sha256:abc123', semver: false },
          digest: { watch: true },
        },
      }) as never,
      log,
    );
    // getTags is NOT called when digest.repo is missing and digest.watch is true
    expect(getImageManifestDigest).not.toHaveBeenCalled();
    expect(result.noUpdateReason).toBe('Running by digest — no tag to compare');
  });

  test('digest-only with comparisonTag on trusted provider sets publishedAt and publishedAtTrusted', async () => {
    const publishedAt = '2026-05-01T12:00:00.000Z';
    const getImagePublishedAt = vi.fn().mockResolvedValue(publishedAt);
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt,
          publishedAtIsPushDate: true,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    const result = await findNewVersion(createDigestOnlyContainer() as never, log);

    expect(result.publishedAt).toBe(publishedAt);
    expect(result.publishedAtTrusted).toBe(true);
    expect(getImagePublishedAt).toHaveBeenCalledWith(expect.any(Object), 'latest', {
      usePollCycleCache: false,
    });
  });

  test('digest-only with comparisonTag on untrusted provider sets publishedAt but not publishedAtTrusted', async () => {
    const publishedAt = '2026-05-01T12:00:00.000Z';
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockResolvedValue(publishedAt),
          publishedAtIsPushDate: false,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    const result = await findNewVersion(createDigestOnlyContainer() as never, log);

    expect(result.publishedAt).toBe(publishedAt);
    expect(result.publishedAtTrusted).toBeUndefined();
  });

  test('digest-only with comparisonTag swallows getImagePublishedAt errors and still returns result', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockRejectedValue(new Error('registry timeout')),
          publishedAtIsPushDate: true,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    const result = await findNewVersion(createDigestOnlyContainer() as never, log);

    expect(result.publishedAt).toBeUndefined();
    expect(result.publishedAtTrusted).toBeUndefined();
    expect(result.digest).toBe('sha256:def456');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('registry timeout'));
  });

  test('digest-only with comparisonTag continues when getImagePublishedAt throws and logContainer.warn is absent', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockRejectedValue(new Error('timeout')),
        },
      },
    });
    const log = { error: vi.fn(), debug: vi.fn() } as unknown as Parameters<
      typeof findNewVersion
    >[1];

    const result = await findNewVersion(createDigestOnlyContainer() as never, log);

    expect(result.publishedAt).toBeUndefined();
    expect(result.digest).toBe('sha256:def456');
  });

  test('digest-only with comparisonTag does not set publishedAt when getImagePublishedAt returns non-string', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockResolvedValue(null),
          publishedAtIsPushDate: true,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    const result = await findNewVersion(createDigestOnlyContainer() as never, log);

    expect(result.publishedAt).toBeUndefined();
    expect(result.publishedAtTrusted).toBeUndefined();
    expect(result.digest).toBe('sha256:def456');
  });

  test('digest-only with no comparisonTag returns result without publishedAt', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest', 'stable']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockResolvedValue('2026-05-01T12:00:00.000Z'),
          publishedAtIsPushDate: true,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    // includeTags that matches nothing forces comparisonTag to be undefined
    const result = await findNewVersion(
      createDigestOnlyContainer({ includeTags: '^nonexistent$' }) as never,
      log,
    );

    expect(result.publishedAt).toBeUndefined();
    expect(result.publishedAtTrusted).toBeUndefined();
    expect(result.noUpdateReason).toBe('Running by digest — no tag to compare');
  });

  test('resolveDigestComparisonTag returns suggestTag result when no latest and suggestTag is non-null', async () => {
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['stable', 'edge']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    // suggestTag returns non-null to cover the `if (suggestedTag) { return suggestedTag }` branch
    mockSuggestTag.mockReturnValue('stable');
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    await findNewVersion(createDigestOnlyContainer() as never, log);
    // 'stable' was selected as the comparison tag (not 'edge')
    expect(getImageManifestDigest.mock.calls[0][0].tag.value).toBe('stable');
  });

  test('handleDigestWatch calls getImageManifestDigest twice for v2 manifests', async () => {
    const getImageManifestDigest = vi
      .fn()
      .mockResolvedValueOnce({
        digest: 'sha256:def456',
        created: '2026-04-01T00:00:00.000Z',
        version: 2,
      })
      .mockResolvedValueOnce({ digest: 'sha256:v2digest' });
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['latest']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const result = await findNewVersion(createDigestOnlyContainer() as never, log);
    expect(getImageManifestDigest).toHaveBeenCalledTimes(2);
    expect(result.digest).toBe('sha256:def456');
  });

  describe('multi-anchor digest comparison (#669)', () => {
    function createMultiAnchorContainer(overrides: Record<string, unknown> = {}) {
      return {
        image: {
          id: 'image-1',
          registry: { name: 'hub' },
          name: 'library/postgres',
          tag: { value: '16-alpine', semver: true, tagPrecision: 'floating' },
          digest: {
            watch: true,
            repo: 'sha256:anchor-a',
            repoDigests: ['sha256:anchor-a', 'sha256:anchor-b'],
          },
        },
        tagFamily: 'strict',
        ...overrides,
      };
    }

    function mockRegistry(getImageManifestDigest: ReturnType<typeof vi.fn>) {
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getTags: vi.fn().mockResolvedValue(['16-alpine']),
            getImageManifestDigest,
            normalizeImage: identityNormalizeImage,
          },
        },
      });
    }

    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    test('(b) raw match on a non-first anchor short-circuits with no normalization call and re-anchors digest.repo', async () => {
      const getImageManifestDigest = vi.fn().mockResolvedValueOnce({
        digest: 'sha256:anchor-b',
        created: '2026-04-01T00:00:00.000Z',
        version: 2,
      });
      mockRegistry(getImageManifestDigest);
      const container = createMultiAnchorContainer();

      await findNewVersion(container as never, log);

      // Only the initial remote-digest lookup happened — the raw match at
      // step 2 skips the normalize-and-compare registry call entirely.
      expect(getImageManifestDigest).toHaveBeenCalledTimes(1);
      expect(container.image.digest.value).toBe('sha256:anchor-b');
      expect(container.image.digest.repo).toBe('sha256:anchor-b');
    });

    test('(c) match only after normalizing a non-first anchor (e.g. manifest-list digest) re-anchors digest.repo', async () => {
      const getImageManifestDigest = vi
        .fn()
        .mockResolvedValueOnce({
          digest: 'sha256:platform-digest',
          created: '2026-04-01T00:00:00.000Z',
          version: 2,
        })
        .mockResolvedValueOnce({ digest: 'sha256:normalized-a' })
        .mockResolvedValueOnce({ digest: 'sha256:platform-digest' });
      mockRegistry(getImageManifestDigest);
      const container = createMultiAnchorContainer();

      await findNewVersion(container as never, log);

      expect(getImageManifestDigest).toHaveBeenCalledTimes(3);
      expect(getImageManifestDigest.mock.calls[1][1]).toBe('sha256:anchor-a');
      expect(getImageManifestDigest.mock.calls[2][1]).toBe('sha256:anchor-b');
      expect(container.image.digest.value).toBe('sha256:platform-digest');
      expect(container.image.digest.repo).toBe('sha256:anchor-b');
    });

    test('(d) genuine republish: no anchor matches, update still flagged using the first anchor normalized value', async () => {
      const getImageManifestDigest = vi
        .fn()
        .mockResolvedValueOnce({
          digest: 'sha256:new-republish',
          created: '2026-04-01T00:00:00.000Z',
          version: 2,
        })
        .mockResolvedValueOnce({ digest: 'sha256:normalized-a' })
        .mockResolvedValueOnce({ digest: 'sha256:normalized-b' });
      mockRegistry(getImageManifestDigest);
      const container = createMultiAnchorContainer();

      await findNewVersion(container as never, log);

      expect(getImageManifestDigest).toHaveBeenCalledTimes(3);
      expect(container.image.digest.value).toBe('sha256:normalized-a');
      // digest.repo is left untouched — no anchor matched, so no re-anchoring.
      expect(container.image.digest.repo).toBe('sha256:anchor-a');
    });

    test('(e) one anchor fails to normalize, a later anchor matches — comparison still succeeds', async () => {
      const getImageManifestDigest = vi
        .fn()
        .mockResolvedValueOnce({
          digest: 'sha256:target',
          created: '2026-04-01T00:00:00.000Z',
          version: 2,
        })
        .mockRejectedValueOnce(new Error('manifest unknown (404)'))
        .mockResolvedValueOnce({ digest: 'sha256:target' });
      mockRegistry(getImageManifestDigest);
      const container = createMultiAnchorContainer();

      const result = await findNewVersion(container as never, log);

      expect(getImageManifestDigest).toHaveBeenCalledTimes(3);
      expect(result.digest).toBe('sha256:target');
      expect(container.image.digest.value).toBe('sha256:target');
      expect(container.image.digest.repo).toBe('sha256:anchor-b');
    });

    test('(f) every anchor fails to normalize — findNewVersion resolves with container.error set instead of rejecting', async () => {
      const getImageManifestDigest = vi
        .fn()
        .mockResolvedValueOnce({
          digest: 'sha256:target',
          created: '2026-04-01T00:00:00.000Z',
          version: 2,
        })
        .mockRejectedValueOnce(new Error('anchor-a manifest unknown'))
        .mockRejectedValueOnce(new Error('anchor-b manifest unknown'));
      mockRegistry(getImageManifestDigest);
      const container = createMultiAnchorContainer();

      const result = await findNewVersion(container as never, log);

      expect(getImageManifestDigest).toHaveBeenCalledTimes(3);
      expect((container as { error?: { message: string } }).error?.message).toContain(
        'anchor-b manifest unknown',
      );
      // getTags only returns the container's own current tag, so there is no
      // newer tag to fabricate — the tag-based result stands unchanged.
      expect(result.tag).toBe(container.image.tag.value);
    });

    test('(g) legacy container with no repoDigests field falls back to single-anchor comparison unchanged', async () => {
      const getImageManifestDigest = vi
        .fn()
        .mockResolvedValueOnce({
          digest: 'sha256:new-manifest',
          created: '2026-04-01T00:00:00.000Z',
          version: 2,
        })
        .mockResolvedValueOnce({ digest: 'sha256:normalized-legacy' });
      mockRegistry(getImageManifestDigest);
      const container = createMultiAnchorContainer({
        image: {
          id: 'image-1',
          registry: { name: 'hub' },
          name: 'library/postgres',
          tag: { value: '16-alpine', semver: true, tagPrecision: 'floating' },
          digest: { watch: true, repo: 'sha256:legacy-anchor' },
        },
      });

      await findNewVersion(container as never, log);

      expect(getImageManifestDigest).toHaveBeenCalledTimes(2);
      expect(getImageManifestDigest.mock.calls[1][1]).toBe('sha256:legacy-anchor');
      expect(container.image.digest.value).toBe('sha256:normalized-legacy');
      expect(container.image.digest.repo).toBe('sha256:legacy-anchor');
    });

    test('(i) self-heal: a stale digest.repo absent from the fresh repoDigests list is replaced by the matching entry', async () => {
      const getImageManifestDigest = vi.fn().mockResolvedValueOnce({
        digest: 'sha256:anchor-b',
        created: '2026-04-01T00:00:00.000Z',
        version: 2,
      });
      mockRegistry(getImageManifestDigest);
      const container = createMultiAnchorContainer({
        image: {
          id: 'image-1',
          registry: { name: 'hub' },
          name: 'library/postgres',
          tag: { value: '16-alpine', semver: true, tagPrecision: 'floating' },
          digest: {
            watch: true,
            // Poisoned: not present anywhere in the freshly derived list below.
            repo: 'sha256:very-stale-and-foreign',
            repoDigests: ['sha256:anchor-a', 'sha256:anchor-b'],
          },
        },
      });

      await findNewVersion(container as never, log);

      expect(container.image.digest.repo).toBe('sha256:anchor-b');
      expect(container.image.digest.value).toBe('sha256:anchor-b');
    });

    test('(j) version !== 2 fallback is unchanged: digest.value takes digest.repo verbatim, repoDigests is not consulted', async () => {
      const getImageManifestDigest = vi.fn().mockResolvedValueOnce({
        digest: 'sha256:anchor-b',
        created: '2026-04-01T00:00:00.000Z',
        version: 1,
      });
      mockRegistry(getImageManifestDigest);
      const container = createMultiAnchorContainer();

      await findNewVersion(container as never, log);

      expect(getImageManifestDigest).toHaveBeenCalledTimes(1);
      expect(container.image.digest.value).toBe('sha256:anchor-a');
      expect(container.image.digest.repo).toBe('sha256:anchor-a');
    });
  });

  describe('digest watch failure degrades to container.error instead of erasing the tag result (#814, #808)', () => {
    test('digest lookup throws, a newer tag was found — findNewVersion resolves with the new tag and records container.error', async () => {
      const getImageManifestDigest = vi.fn().mockRejectedValue(new Error('registry unavailable'));
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getTags: vi.fn().mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']),
            getImageManifestDigest,
            normalizeImage: identityNormalizeImage,
          },
        },
      });
      const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      const container = {
        image: {
          id: 'image-1',
          registry: { name: 'hub' },
          name: 'library/nginx',
          tag: { value: '1.0.0', semver: true },
          digest: { watch: true, repo: 'sha256:local' },
        },
      };

      const result = await findNewVersion(container as never, log);

      expect(result.tag).toBe('2.0.0');
      expect((container as { error?: { message: string } }).error?.message).toBe(
        'registry unavailable',
      );
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('registry unavailable'));
    });

    test('digest lookup throws, no newer tag available — findNewVersion resolves with the tag unchanged and records container.error', async () => {
      const getImageManifestDigest = vi.fn().mockRejectedValue(new Error('registry unavailable'));
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getTags: vi.fn().mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']),
            getImageManifestDigest,
            normalizeImage: identityNormalizeImage,
          },
        },
      });
      const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      const container = {
        image: {
          id: 'image-1',
          registry: { name: 'hub' },
          name: 'library/nginx',
          tag: { value: '2.0.0', semver: true },
          digest: { watch: true, repo: 'sha256:local' },
        },
      };

      const result = await findNewVersion(container as never, log);

      expect(result.tag).toBe('2.0.0');
      expect((container as { error?: { message: string } }).error?.message).toBe(
        'registry unavailable',
      );
    });

    test('regression: a digest-only (sha256-pinned) container still rejects when its digest lookup fails', async () => {
      const getImageManifestDigest = vi.fn().mockRejectedValue(new Error('manifest unreachable'));
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getTags: vi.fn().mockResolvedValue(['latest']),
            getImageManifestDigest,
            normalizeImage: identityNormalizeImage,
          },
        },
      });
      const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      await expect(findNewVersion(createDigestOnlyContainer() as never, log)).rejects.toThrow(
        'manifest unreachable',
      );
    });

    test('regression: a getTags failure still rejects findNewVersion', async () => {
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getTags: vi.fn().mockRejectedValue(new Error('tag listing failed')),
            getImageManifestDigest: createManifestLookup(),
            normalizeImage: identityNormalizeImage,
          },
        },
      });
      const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      const container = {
        image: {
          id: 'image-1',
          registry: { name: 'hub' },
          name: 'library/nginx',
          tag: { value: '1.0.0', semver: true },
          digest: { watch: true, repo: 'sha256:local' },
        },
      };

      await expect(findNewVersion(container as never, log)).rejects.toThrow('tag listing failed');
    });
  });

  test('sets noUpdateReason from getTagCandidates when tag is pinned-specific and digest watch is off', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.2.3', '1.2.4', '2.0.0']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.2.3', semver: true, tagPrecision: 'specific' },
        digest: { watch: false },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result.noUpdateReason).toBeDefined();
    expect(result.noUpdateReason).toContain('Pinned tag');
  });

  test('short-circuits without a registry call for a locally-built image (isLocalImage marker)', async () => {
    const getTags = vi.fn().mockResolvedValue(['1.0.0']);
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags,
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'portwing',
        tag: { value: '0.3.0-qa', semver: false },
        digest: { watch: false },
        isLocalImage: true,
      },
    };

    const result = await findNewVersion(container as never, log);

    expect(getTags).not.toHaveBeenCalled();
    expect(result.noUpdateReason).toBe(
      'Locally-built image (no repository digest) — registry not queried',
    );
    expect(result.tag).toBe('0.3.0-qa');
  });

  test('does not short-circuit a registry-backed container that merely lacks digest.repo', async () => {
    // Regression guard: many registry-backed fixtures don't populate digest.repo
    // (digest watching is off), so the gate must key off the explicit
    // isLocalImage marker, not digest.repo absence, or this would wrongly skip
    // the registry call for real registry-backed images too.
    const getTags = vi.fn().mockResolvedValue(['1.0.0', '2.0.0']);
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags,
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.0.0', semver: true, tagPrecision: 'floating' },
        digest: { watch: false },
      },
    };

    await findNewVersion(container as never, log);

    expect(getTags).toHaveBeenCalledTimes(1);
  });

  test('populates result.updateInsight for a pinned specific tag when a newer same-family tag exists (#498)', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.2.3', '1.2.4', '2.0.0']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.2.3', semver: true, tagPrecision: 'specific' },
        digest: { watch: false },
      },
      tagFamily: 'strict',
    };
    const result = await findNewVersion(container as never, log);
    // The pin gate still blocks the actionable path — updateAvailable-affecting fields
    // are untouched — but the insight is surfaced as pure information.
    expect(result.tag).toBe('1.2.3');
    expect(result.updateInsight).toEqual({ tag: '2.0.0', kind: 'major' });
  });

  test('does not populate result.updateInsight when pinInfoEnabled option is false (#498)', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.2.3', '1.2.4', '2.0.0']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.2.3', semver: true, tagPrecision: 'specific' },
        digest: { watch: false },
      },
      tagFamily: 'strict',
    };
    const result = await findNewVersion(container as never, log, { pinInfoEnabled: false });
    expect(result.updateInsight).toBeUndefined();
  });

  test('specific pin + digest.watch=true detects a same-tag rebuild via digest, no semver climb (#498)', async () => {
    const getImageManifestDigest = vi.fn().mockResolvedValue({
      digest: 'sha256:newmanifest',
      created: '2026-07-01T00:00:00.000Z',
      version: 1,
    });
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.2.3', '1.2.4', '2.0.0']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.2.3', semver: true, tagPrecision: 'specific' },
        digest: { watch: true, repo: 'sha256:oldmanifest' },
      },
      tagFamily: 'strict',
    };

    const result = await findNewVersion(container as never, log);

    // The pinned tag itself is the only digest query — no semver climbing.
    expect(getImageManifestDigest.mock.calls.map(([image]) => image.tag.value)).toEqual(['1.2.3']);
    expect(result.digest).toBe('sha256:newmanifest');
    expect(result.noUpdateReason).toBeUndefined();
    expect(result.tag).toBe('1.2.3');
  });

  test('sets result.suggestedTag and result.tag from tagsCandidates on semver container', async () => {
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    mockSuggestTag.mockReturnValue('1.1.0');
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.0.0', semver: true },
        digest: { watch: true, repo: 'sha256:local' },
      },
    };
    const result = await findNewVersion(container as never, log);
    // suggestedTag should be set by mockSuggestTag
    expect(result.suggestedTag).toBe('1.1.0');
    // tagsCandidates should include newer tags → result.tag advances
    expect(result.tag).toBeDefined();
    // digest watch should be triggered (handleDigestWatch called)
    expect(getImageManifestDigest).toHaveBeenCalled();
  });

  test('suggests the real stable tag alongside a PEP 440 nightly without disturbing the digest path (#473)', async () => {
    const actualSuggest =
      await vi.importActual<typeof import('../../../tag/suggest.js')>('../../../tag/suggest.js');
    mockSuggestTag.mockImplementation(actualSuggest.suggest);
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['2026.7.1', '2026.8.0.dev202607050315']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/homeassistant',
        tag: { value: 'latest', semver: false },
        digest: { watch: true, repo: 'sha256:local' },
      },
    };
    const result = await findNewVersion(container as never, log);
    // The real suggest() must reject the coercion-lossy nightly and offer the stable release.
    expect(result.suggestedTag).toBe('2026.7.1');
    // The suggested-tag hint is independent of the digest-comparison path: tag stays 'latest'.
    expect(result.tag).toBe('latest');
    expect(getImageManifestDigest).toHaveBeenCalled();
  });

  // #859: linuxserver/plex repro — a bare integer build-number tag ("168")
  // must never outrank a real dotted release ("1.43.3"), neither in the
  // suggested-tag badge nor in the actionable tag advanced to result.tag.
  test('watched latest tag suggests the dotted version over a bare integer and leaves the actionable tag untouched (#859)', async () => {
    const actualSuggest =
      await vi.importActual<typeof import('../../../tag/suggest.js')>('../../../tag/suggest.js');
    mockSuggestTag.mockImplementation(actualSuggest.suggest);
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['168', '1.43.3']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'linuxserver/plex',
        tag: { value: 'latest', semver: false },
        digest: { watch: true, repo: 'sha256:local' },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result.suggestedTag).toBe('1.43.3');
    // No includeTags is set, so getTagCandidates never enters the recovery
    // branch — the actionable tag stays put rather than forcing an update.
    expect(result.tag).toBe('latest');
  });

  test('a permissive includeTags never lets the actionable tag advance to a bare integer over a real dotted version (#859)', async () => {
    const actualSuggest =
      await vi.importActual<typeof import('../../../tag/suggest.js')>('../../../tag/suggest.js');
    mockSuggestTag.mockImplementation(actualSuggest.suggest);
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['168', '1.43.3']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      includeTags: String.raw`^\d+(\.\d+)*$`,
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'linuxserver/plex',
        tag: { value: 'latest', semver: false },
        digest: { watch: true, repo: 'sha256:local' },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result.suggestedTag).toBe('1.43.3');
    expect(result.tag).toBe('1.43.3');
    expect(result.tag).not.toBe('168');
  });

  test('digest comparison never resolves a bare integer tag over a real dotted version (#859)', async () => {
    const actualSuggest =
      await vi.importActual<typeof import('../../../tag/suggest.js')>('../../../tag/suggest.js');
    mockSuggestTag.mockImplementation(actualSuggest.suggest);
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['168', '1.43.3']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await findNewVersion(createDigestOnlyContainer() as never, log);

    expect(getImageManifestDigest.mock.calls[0][0].tag.value).toBe('1.43.3');
  });

  test('digest comparison sorts a genuinely integer-only tag pool numerically, not lexically (#859)', async () => {
    const actualSuggest =
      await vi.importActual<typeof import('../../../tag/suggest.js')>('../../../tag/suggest.js');
    mockSuggestTag.mockImplementation(actualSuggest.suggest);
    const getImageManifestDigest = createManifestLookup();
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['9', '10']),
          getImageManifestDigest,
          normalizeImage: identityNormalizeImage,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await findNewVersion(createDigestOnlyContainer() as never, log);

    expect(getImageManifestDigest.mock.calls[0][0].tag.value).toBe('10');
  });

  test('publishedTag falls back to container.image.tag.value when result.tag is falsy', async () => {
    const getImagePublishedAt = vi.fn().mockResolvedValue('2026-04-01T00:00:00.000Z');
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue([]),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt,
          publishedAtIsPushDate: true,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        // Empty string tag so result.tag is falsy → triggers the || fallback
        tag: { value: '', semver: false },
        digest: { watch: false },
      },
    };
    const result = await findNewVersion(container as never, log);
    // The publishedAt lookup should have been called with the fallback tag (empty string)
    expect(result.publishedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(getImagePublishedAt).toHaveBeenCalled();
  });

  test('does not set publishedAt when getImagePublishedAt returns non-string', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.1.0']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockResolvedValue(null),
          publishedAtIsPushDate: true,
        },
      },
    });
    const log = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.0.0', semver: false },
        digest: { watch: false },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result.publishedAt).toBeUndefined();
    expect(result.publishedAtTrusted).toBeUndefined();
  });

  test('logs warn and continues when getImagePublishedAt throws', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.1.0']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockRejectedValue(new Error('API error')),
        },
      },
    });
    const warnFn = vi.fn();
    const log = { error: vi.fn(), warn: warnFn, debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.0.0', semver: false },
        digest: { watch: false },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result.publishedAt).toBeUndefined();
    expect(warnFn).toHaveBeenCalledWith(expect.stringContaining('API error'));
  });

  test('logs warn on registry auth failure so it is not silently swallowed', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.1.0']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockRejectedValue(new Error('401 Unauthorized')),
        },
      },
    });
    const warnFn = vi.fn();
    const log = { error: vi.fn(), warn: warnFn, debug: vi.fn() };
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.0.0', semver: false },
        digest: { watch: false },
      },
    };
    const result = await findNewVersion(container as never, log);
    expect(result.publishedAt).toBeUndefined();
    expect(warnFn).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
  });

  test('continues silently when getImagePublishedAt throws and logContainer.warn is absent', async () => {
    mockGetState.mockReturnValue({
      registry: {
        hub: {
          getTags: vi.fn().mockResolvedValue(['1.1.0']),
          getImageManifestDigest: createManifestLookup(),
          normalizeImage: identityNormalizeImage,
          getImagePublishedAt: vi.fn().mockRejectedValue(new Error('timeout')),
        },
      },
    });
    // Intentionally omit warn from log to exercise the false branch of typeof logContainer.warn
    const log = { error: vi.fn(), debug: vi.fn() } as unknown as Parameters<
      typeof findNewVersion
    >[1];
    const container = {
      image: {
        id: 'image-1',
        registry: { name: 'hub' },
        name: 'library/nginx',
        tag: { value: '1.0.0', semver: false },
        digest: { watch: false },
      },
    };
    // Should not throw
    const result = await findNewVersion(container as never, log);
    expect(result.publishedAt).toBeUndefined();
  });

  describe('normalizeContainer', () => {
    function createBaseContainer(registryOverrides: Record<string, unknown> = {}) {
      return {
        id: 'c1',
        name: 'test-container',
        watcher: 'docker',
        image: {
          id: 'sha256:abc',
          registry: {
            name: 'hub',
            url: 'docker.io',
            ...registryOverrides,
          },
          name: 'library/nginx',
          tag: { value: '1.25', semver: true },
          digest: { watch: false },
          architecture: 'amd64',
          os: 'linux',
        },
      };
    }

    test('normalizeContainer applies provider name canonicalization and URL normalization for a plain Docker Hub container', () => {
      // Regression guard for 594a07e8 + follow-up fix: removing normalizeImage
      // left registry.url in raw form ("docker.io") instead of the API base form.
      // The follow-up fix restores image.name canonicalization too — Hub's
      // normalizeImage adds a "library/" prefix to un-prefixed names, and without
      // it the Prometheus image_name label emits "nginx" instead of "library/nginx".
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getId: () => 'hub',
            match: () => true,
            // Faithful stub of Hub.normalizeImage semantics: adds "library/" to
            // un-prefixed names and rewrites the URL to the API base form.
            normalizeImage: (image: { name: string; registry: { url: string } }) => ({
              ...image,
              name: image.name.includes('/') ? image.name : `library/${image.name}`,
              registry: {
                ...image.registry,
                url: 'https://registry-1.docker.io/v2',
              },
            }),
          },
        },
      });

      const container = {
        ...createBaseContainer({ url: 'docker.io' }),
        image: {
          ...createBaseContainer({ url: 'docker.io' }).image,
          name: 'nginx',
        },
      };
      const result = normalizeContainer(container as never);

      expect(result.image.name).toBe('library/nginx');
      expect(result.image.registry.url).toBe('https://registry-1.docker.io/v2');
    });

    test('normalizeContainer preserves image.name when a lookup-label diverts queries to the same registry', () => {
      // Regression guard for #336 staying fixed: the lookup-label substitution
      // must not bleed back into the deploy identity (image.name).
      // In this case the deploy URL is docker.io and the hub provider also
      // matches the deploy image, so URL normalization still applies.
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getId: () => 'hub',
            match: () => true,
            normalizeImage: (image: { name: string; registry: { url: string } }) => ({
              ...image,
              registry: {
                ...image.registry,
                url: 'https://registry-1.docker.io/v2',
              },
              // Simulate what Hub.normalizeImage does for an already-namespaced name —
              // it is a no-op because the name already contains '/'.
              name: image.name.includes('/') ? image.name : `library/${image.name}`,
            }),
          },
        },
      });

      const container = {
        ...createBaseContainer({ url: 'docker.io', lookupImage: 'library/nextcloud' }),
        image: {
          ...createBaseContainer({ url: 'docker.io', lookupImage: 'library/nextcloud' }).image,
          name: 'myreg/nextcloud',
        },
      };

      const result = normalizeContainer(container as never);

      // Deploy identity name must be preserved
      expect(result.image.name).toBe('myreg/nextcloud');
      // URL is normalized because the provider also matches the deploy image
      expect(result.image.registry.url).toBe('https://registry-1.docker.io/v2');
    });

    test('normalizeContainer preserves deploy URL when lookup-label diverts to a different registry', () => {
      // Regression guard for harbor-mirror case: a container running at
      // harbor.example.com uses dd.registry.lookup.image to look up tags from
      // Docker Hub. The hub provider matches the LOOKUP image (library/traefik)
      // but NOT the deploy image (harbor.example.com). The deploy URL must not
      // be overwritten with the Hub API URL.
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getId: () => 'hub',
            // Matches the lookup image (no domain → docker.io) but NOT the deploy image
            match: (img: { registry: { url: string } }) =>
              !img.registry.url ||
              img.registry.url === 'docker.io' ||
              /docker\.io$/.test(img.registry.url),
            normalizeImage: (image: { registry: { url: string } }) => ({
              ...image,
              registry: { ...image.registry, url: 'https://registry-1.docker.io/v2' },
            }),
          },
        },
      });

      const container = {
        ...createBaseContainer({
          url: 'harbor.example.com',
          lookupImage: 'library/traefik',
        }),
        image: {
          ...createBaseContainer({ url: 'harbor.example.com' }).image,
          name: 'dockerhub-proxy/traefik',
          registry: { name: 'hub', url: 'harbor.example.com', lookupImage: 'library/traefik' },
        },
      };

      const result = normalizeContainer(container as never);

      // Deploy identity name and URL must both be preserved
      expect(result.image.name).toBe('dockerhub-proxy/traefik');
      expect(result.image.registry.url).toBe('harbor.example.com');
      // Registry name is resolved from the matched provider
      expect(result.image.registry.name).toBe('hub');
    });

    test('normalizeContainer sets registry name to unknown when no provider matches', () => {
      mockGetState.mockReturnValue({ registry: {} });

      const container = createBaseContainer({ url: 'unknown.registry.io' });
      const result = normalizeContainer(container as never);

      expect(result.image.registry.name).toBe('unknown');
    });

    test('normalizeContainer does not mutate the input container', () => {
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getId: () => 'hub',
            match: () => true,
            normalizeImage: (image: { name: string; registry: { url: string } }) => ({
              ...image,
              name: image.name.includes('/') ? image.name : `library/${image.name}`,
              registry: { ...image.registry, url: 'https://registry-1.docker.io/v2' },
            }),
          },
        },
      });

      const originalUrl = 'docker.io';
      const originalName = 'nginx';
      const container = {
        ...createBaseContainer({ url: originalUrl }),
        image: { ...createBaseContainer({ url: originalUrl }).image, name: originalName },
      };

      normalizeContainer(container as never);

      // Input must be unmodified
      expect(container.image.registry.url).toBe(originalUrl);
      expect(container.image.name).toBe(originalName);
    });

    describe('pickRegistryProvider — deterministic routing', () => {
      function makeProvider(
        id: string,
        configuration: Record<string, unknown> = {},
        matchAll = true,
      ) {
        return {
          getId: () => id,
          name: id.split('.').pop() ?? id,
          match: () => matchAll,
          normalizeImage: identityNormalizeImage,
          configuration,
        };
      }

      test('credentialed instance wins over anonymous regardless of insertion order', () => {
        // anonymous inserted first, credentialed second
        mockGetState.mockReturnValue({
          registry: {
            'ghcr.public': makeProvider('ghcr.public', {}),
            'ghcr.token': makeProvider('ghcr.token', { token: 'ghp_secret' }),
          },
        });

        const container = createBaseContainer({ url: 'ghcr.io' });
        const result = normalizeContainer(container as never);

        expect(result.image.registry.name).toBe('ghcr.token');
      });

      test('credentialed instance wins even when inserted first and anonymous second', () => {
        // credentialed first, anonymous second — order must not matter
        mockGetState.mockReturnValue({
          registry: {
            'ghcr.token': makeProvider('ghcr.token', { token: 'ghp_secret' }),
            'ghcr.public': makeProvider('ghcr.public', {}),
          },
        });

        const container = createBaseContainer({ url: 'ghcr.io' });
        const result = normalizeContainer(container as never);

        expect(result.image.registry.name).toBe('ghcr.token');
      });

      test('alphabetical tie-break when multiple anonymous instances match', () => {
        mockGetState.mockReturnValue({
          registry: {
            'ghcr.zzz': makeProvider('ghcr.zzz', {}),
            'ghcr.aaa': makeProvider('ghcr.aaa', {}),
          },
        });

        const container = createBaseContainer({ url: 'ghcr.io' });
        const result = normalizeContainer(container as never);

        // 'aaa' sorts before 'zzz' → aaa wins
        expect(result.image.registry.name).toBe('ghcr.aaa');
      });

      test('alphabetical tie-break when multiple credentialed instances match', () => {
        mockGetState.mockReturnValue({
          registry: {
            'ghcr.zzz': makeProvider('ghcr.zzz', { token: 'tok1' }),
            'ghcr.aaa': makeProvider('ghcr.aaa', { token: 'tok2' }),
          },
        });

        const container = createBaseContainer({ url: 'ghcr.io' });
        const result = normalizeContainer(container as never);

        expect(result.image.registry.name).toBe('ghcr.aaa');
      });

      test('single matching provider is returned directly without sorting', () => {
        mockGetState.mockReturnValue({
          registry: {
            'hub.public': makeProvider('hub.public', {}),
            'ghcr.public': { ...makeProvider('ghcr.public', {}), match: () => false },
          },
        });

        const container = createBaseContainer({});
        const result = normalizeContainer(container as never);

        expect(result.image.registry.name).toBe('hub.public');
      });

      test('whitespace-only token is treated as anonymous — public wins alphabetical tie-break', () => {
        // Registry with token='   ' must NOT be treated as credentialed
        mockGetState.mockReturnValue({
          registry: {
            'ghcr.aaa': makeProvider('ghcr.aaa', {}),
            'ghcr.ws': makeProvider('ghcr.ws', { token: '   ' }),
          },
        });

        const container = createBaseContainer({ url: 'ghcr.io' });
        const result = normalizeContainer(container as never);

        // Both are treated as anonymous; alphabetical tie-break picks 'aaa'
        expect(result.image.registry.name).toBe('ghcr.aaa');
      });

      test('ECR-style accesskeyid/secretaccesskey causes registry to be picked as credentialed', () => {
        mockGetState.mockReturnValue({
          registry: {
            'ecr.public': makeProvider('ecr.public', {}),
            'ecr.creds': makeProvider('ecr.creds', {
              accesskeyid: 'AKIAIOSFODNN7EXAMPLE',
              secretaccesskey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            }),
          },
        });

        const container = createBaseContainer({ url: '123456789.dkr.ecr.us-east-1.amazonaws.com' });
        const result = normalizeContainer(container as never);

        expect(result.image.registry.name).toBe('ecr.creds');
      });
    });
  });
});
