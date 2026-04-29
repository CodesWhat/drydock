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

import { findNewVersion } from './image-comparison.js';

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
});
