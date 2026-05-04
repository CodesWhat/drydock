import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetState, mockSuggestTag } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockSuggestTag: vi.fn(),
}));

vi.mock('../../../registry/index.js', () => ({
  getState: mockGetState,
}));

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

    test('normalizeContainer applies provider URL normalization to image.registry.url', () => {
      // Regression guard for 594a07e8: removing normalizeImage call left
      // registry.url in raw user-config form ("docker.io") instead of the
      // API base form ("https://registry-1.docker.io/v2").
      mockGetState.mockReturnValue({
        registry: {
          hub: {
            getId: () => 'hub',
            match: () => true,
            normalizeImage: (image: { registry: { url: string } }) => ({
              ...image,
              registry: {
                ...image.registry,
                url: 'https://registry-1.docker.io/v2',
              },
            }),
          },
        },
      });

      const container = createBaseContainer({ url: 'docker.io' });
      const result = normalizeContainer(container as never);

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
  });
});
