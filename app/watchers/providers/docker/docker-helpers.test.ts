import { describe, expect, test, vi } from 'vitest';
import log from '../../../log/index.js';

import {
  buildFallbackContainerReport,
  canonicalizeContainerName,
  getContainerConfigValue,
  getContainerDisplayName,
  getContainerName,
  getErrorMessage,
  getFirstConfigNumber,
  getFirstConfigString,
  getImageForRegistryLookup,
  getImageReferenceCandidatesFromPattern,
  getImgsetSpecificity,
  getInspectValueByPath,
  getOldContainers,
  getRawContainerName,
  getRepoDigest,
  getResolvedImgsetConfiguration,
  getSemverTagFromInspectPath,
  isContainerToWatch,
  isDigestToWatch,
  shouldUpdateDisplayNameFromContainerName,
} from './docker-helpers.js';

vi.mock('parse-docker-image-name', () => ({
  default: vi.fn((value: string) => {
    if (value === 'ghcr.io/team/service') {
      return { domain: 'ghcr.io', path: 'team/service' };
    }
    if (value === 'ghcr.io/library/nginx') {
      return { domain: 'ghcr.io', path: 'library/nginx' };
    }
    if (value === 'ghcr.io/team/service') {
      return { domain: 'ghcr.io', path: 'team/service' };
    }
    if (value === 'my-registry.local') {
      return { domain: undefined, path: 'my-registry.local' };
    }
    if (value === 'library/nginx') {
      return { domain: undefined, path: 'library/nginx' };
    }
    if (value === 'docker.io') {
      return { domain: undefined, path: undefined };
    }
    throw new Error('invalid pattern');
  }),
}));

describe('docker helper extraction module', () => {
  test('reads nested config string/number values from multiple path aliases', () => {
    const input = {
      token: {
        endpoint: ' https://idp.example.com/oauth/token ',
      },
      timeout: '5000',
    };

    expect(getFirstConfigString(input, ['token.url', 'token.endpoint'])).toBe(
      'https://idp.example.com/oauth/token',
    );
    expect(getFirstConfigNumber(input, ['x.y', 'timeout'])).toBe(5000);
    expect(getFirstConfigString({ token: { endpoint: 123 } }, ['token.endpoint'])).toBeUndefined();
    expect(getFirstConfigString({}, ['missing.path'])).toBeUndefined();
    expect(getFirstConfigNumber({ value: 42 }, ['value'])).toBe(42);
  });

  test('getOldContainers should return empty arrays when inputs are missing', () => {
    expect(getOldContainers(undefined as any, [{ id: 'a' } as any])).toEqual([]);
    expect(getOldContainers([{ id: 'a' } as any], undefined as any)).toEqual([]);
  });

  test('getOldContainers should keep only store entries that are no longer present', () => {
    expect(
      getOldContainers([{ id: 'keep' } as any], [{ id: 'keep' } as any, { id: 'drop' } as any]),
    ).toEqual([{ id: 'drop' }]);
  });

  test('getContainerDisplayName should honor trimmed overrides and fall back cleanly', () => {
    expect(getContainerDisplayName('web', 'ignored', '  custom name  ')).toBe('  custom name  ');
    expect(getContainerDisplayName('web', 'ignored', '   ')).toBe('web');
  });

  test('resolves image lookup candidates from image override and legacy url', () => {
    expect(
      getImageForRegistryLookup({
        registry: { lookupImage: 'ghcr.io/team/service' },
        name: 'ignored/name',
        tag: { value: 'latest' },
      } as any),
    ).toEqual(
      expect.objectContaining({
        name: 'team/service',
        registry: expect.objectContaining({ url: 'ghcr.io' }),
      }),
    );

    expect(
      getImageForRegistryLookup({
        registry: { lookupUrl: 'https://registry-1.docker.io' },
        name: 'library/nginx',
        tag: { value: 'latest' },
      } as any),
    ).toEqual(
      expect.objectContaining({
        registry: expect.objectContaining({ url: 'registry-1.docker.io' }),
      }),
    );
  });

  test('getImageForRegistryLookup should keep the original image when the lookup URL is invalid', () => {
    const image = {
      name: 'library/nginx',
      registry: {
        lookupUrl: 'http://[',
        url: 'registry.example.com',
      },
    } as any;

    expect(getImageForRegistryLookup(image)).toBe(image);
  });

  test('getImageForRegistryLookup should treat a bare registry hostname as the lookup target', () => {
    expect(
      getImageForRegistryLookup({
        name: 'library/nginx',
        registry: {
          lookupImage: 'my-registry.local',
          url: 'registry.example.com',
        },
      } as any),
    ).toEqual(
      expect.objectContaining({
        name: 'library/nginx',
        registry: expect.objectContaining({
          url: 'my-registry.local',
        }),
      }),
    );
  });

  test('getImageForRegistryLookup should keep the original image when parsing yields no path', () => {
    const image = {
      name: 'library/nginx',
      registry: {
        lookupImage: 'docker.io',
        url: 'registry.example.com',
      },
    } as any;

    expect(getImageForRegistryLookup(image)).toBe(image);
  });

  test('getImageForRegistryLookup should return the original image when the lookup value is blank', () => {
    const image = {
      name: 'library/nginx',
      registry: {
        lookupImage: '   ',
        url: 'registry.example.com',
      },
    } as any;

    expect(getImageForRegistryLookup(image)).toBe(image);
  });

  test('getImageReferenceCandidatesFromPattern should normalize registry domains and library prefixes', () => {
    expect(getImageReferenceCandidatesFromPattern('ghcr.io/library/nginx')).toEqual(
      expect.arrayContaining(['library/nginx', 'nginx', 'ghcr.io/library/nginx', 'ghcr.io/nginx']),
    );
    expect(getImageReferenceCandidatesFromPattern('ghcr.io/team/service')).toEqual(
      expect.arrayContaining([
        'team/service',
        'docker.io/team/service',
        'registry-1.docker.io/team/service',
        'ghcr.io/team/service',
      ]),
    );
    expect(getImageReferenceCandidatesFromPattern('   ')).toEqual([]);
    expect(getImageReferenceCandidatesFromPattern('docker.io')).toEqual(['docker.io']);
  });

  test('getImgsetSpecificity should detect matches and mismatch fallbacks', () => {
    expect(getImgsetSpecificity('   ', { domain: 'ghcr.io', path: 'library/nginx' })).toBe(-1);
    expect(
      getImgsetSpecificity('ghcr.io/library/nginx', { domain: 'ghcr.io', path: 'library/nginx' }),
    ).toBeGreaterThan(0);
    expect(
      getImgsetSpecificity('missing/example', { domain: 'ghcr.io', path: 'library/nginx' }),
    ).toBe(-1);
    expect(
      getImgsetSpecificity('ghcr.io/library/nginx', { domain: undefined, path: undefined }),
    ).toBe(-1);
  });

  test('configuration helpers should resolve aliases and preserve precedence', () => {
    expect(
      getResolvedImgsetConfiguration('service', {
        includeTags: 'first',
        exclude: 'second',
        transform: 'third',
        tagFamily: 'family',
        linkTemplate: 'link',
        displayName: 'display',
        displayIcon: 'icon',
        triggerInclude: 'trigger-in',
        triggerExclude: 'trigger-out',
        lookupImage: 'ghcr.io/team/service',
        lookupUrl: 'https://registry-1.docker.io',
        watchDigest: 'digest',
        inspectTagPath: 'Config.Labels.version',
      }),
    ).toEqual(
      expect.objectContaining({
        name: 'service',
        includeTags: 'first',
        excludeTags: 'second',
        transformTags: 'third',
        tagFamily: 'family',
        linkTemplate: 'link',
        displayName: 'display',
        displayIcon: 'icon',
        triggerInclude: 'trigger-in',
        triggerExclude: 'trigger-out',
        registryLookupImage: 'ghcr.io/team/service',
        registryLookupUrl: 'https://registry-1.docker.io',
        watchDigest: 'digest',
        inspectTagPath: 'Config.Labels.version',
      }),
    );

    expect(getContainerConfigValue('  label ', 'fallback')).toBe('label');
    expect(getContainerConfigValue(undefined, ' fallback ')).toBe('fallback');
  });

  test('numeric and inspect helpers should handle empty and missing inputs', () => {
    expect(getFirstConfigNumber({ nested: { value: ' 17 ' } }, ['missing', 'nested.value'])).toBe(
      17,
    );
    expect(getFirstConfigNumber({ nested: { value: 'nan' } }, ['nested.value'])).toBeUndefined();
    expect(getInspectValueByPath({}, '')).toBeUndefined();
    expect(getInspectValueByPath({ a: null }, 'a/b')).toBeUndefined();
    expect(
      getInspectValueByPath({ Config: { Labels: { version: '1.2.3' } } }, 'Config/Labels/version'),
    ).toBe('1.2.3');
    expect(getInspectValueByPath({ Config: null }, 'Config/Labels/version')).toBeUndefined();
    expect(
      getSemverTagFromInspectPath(
        { Config: { Labels: { version: 'v2.0.0' } } },
        'Config/Labels/version',
        's/v//',
      ),
    ).toBe('2.0.0');
    expect(
      getSemverTagFromInspectPath(
        { Config: { Labels: { version: '  ' } } },
        'Config/Labels/version',
        's/v//',
      ),
    ).toBeUndefined();
    expect(getSemverTagFromInspectPath({}, 'Config/Labels/version', 's/v//')).toBeUndefined();
    expect(getRepoDigest({ RepoDigests: [] })).toBeUndefined();
    expect(getRepoDigest({ RepoDigests: ['repo@sha256:abc123'] })).toBe('sha256:abc123');
    expect(isContainerToWatch('true', false)).toBe(true);
    expect(isContainerToWatch('', true)).toBe(true);
  });

  test('digest watch should keep digest-backed summary references enabled only when the tag is still meaningful', () => {
    expect(
      isDigestToWatch(
        undefined as any,
        { domain: 'docker.io', path: 'library/nginx' },
        false,
        'floating',
        undefined,
        'repo@sha256:abc',
      ),
    ).toBe(false);
    expect(
      isDigestToWatch(
        undefined as any,
        { domain: 'docker.io', path: 'library/nginx' },
        false,
        'floating',
        '',
        'repo@sha256:abc',
      ),
    ).toBe(false);
    expect(
      isDigestToWatch(
        undefined as any,
        { domain: 'docker.io', path: 'library/nginx' },
        false,
        'floating',
        'unknown',
        'repo@sha256:abc',
      ),
    ).toBe(false);
    expect(
      isDigestToWatch(
        undefined as any,
        { domain: 'docker.io', path: 'library/nginx' },
        false,
        'floating',
        'latest',
        'repo@sha256:abc',
      ),
    ).toBe(true);
    expect(
      isDigestToWatch(
        undefined as any,
        { domain: 'docker.io', path: 'library/nginx' },
        false,
        'floating',
        'latest',
        'repo:latest',
      ),
    ).toBe(false);
  });

  test('isDigestToWatch should honor an explicit digest label and warn on Docker Hub', () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);

    expect(
      isDigestToWatch('true', { domain: 'docker.io', path: 'library/nginx' }, false, 'floating'),
    ).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'Watching digest for image library/nginx with domain docker.io may result in throttled requests',
    );

    warnSpy.mockRestore();
  });

  test('isDigestToWatch should not warn when an explicit digest label is false', () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);

    expect(
      isDigestToWatch('false', { domain: 'docker.io', path: 'library/nginx' }, false, 'floating'),
    ).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('falls back to normalized pattern when parser throws for image candidates', () => {
    expect(getImageReferenceCandidatesFromPattern('INVALID[')).toEqual(['invalid[']);
  });

  test('extracts inspect path and semver tag from transformed value', () => {
    const inspect = {
      Config: {
        Labels: {
          'org.opencontainers.image.version': 'v1.25.0',
        },
      },
    };

    expect(getInspectValueByPath(inspect, 'Config/Labels/org.opencontainers.image.version')).toBe(
      'v1.25.0',
    );

    expect(
      getSemverTagFromInspectPath(
        inspect,
        'Config/Labels/org.opencontainers.image.version',
        's/v//',
      ),
    ).toBe('1.25.0');
  });

  test('getImageForRegistryLookup should default to the Docker Hub registry when no domain is provided', () => {
    expect(
      getImageForRegistryLookup({
        name: 'ignored/name',
        registry: {
          lookupImage: 'library/nginx',
          url: 'registry.example.com',
        },
      } as any),
    ).toEqual(
      expect.objectContaining({
        name: 'library/nginx',
        registry: expect.objectContaining({
          url: 'registry-1.docker.io',
        }),
      }),
    );
  });

  test('getImageForRegistryLookup should keep the original image when no lookup override exists', () => {
    const image = {
      name: 'library/nginx',
      registry: {
        url: 'registry.example.com',
      },
    } as any;

    expect(getImageForRegistryLookup(image)).toBe(image);
  });

  test('keeps digest-watch defaults and display-name update rule behavior', () => {
    // Non-semver floating tags: Docker Hub stays opt-in, non-Hub defaults to watch
    expect(isDigestToWatch(undefined as any, { domain: undefined }, false, 'floating')).toBe(false);
    expect(isDigestToWatch(undefined as any, { domain: '' }, false, 'floating')).toBe(false);
    expect(isDigestToWatch(undefined as any, { domain: 'docker.io' }, false, 'floating')).toBe(
      false,
    );
    expect(isDigestToWatch(undefined as any, { domain: 'ghcr.io' }, false, 'floating')).toBe(true);

    // Specific semver releases: digest watching disabled regardless of registry
    expect(isDigestToWatch(undefined as any, { domain: 'ghcr.io' }, true, 'specific')).toBe(false);
    expect(isDigestToWatch(undefined as any, { domain: 'docker.io' }, true, 'specific')).toBe(
      false,
    );

    // Floating semver aliases (v3, 1.4): Docker Hub stays opt-in, non-Hub defaults to watch
    expect(isDigestToWatch(undefined as any, { domain: 'ghcr.io' }, true, 'floating')).toBe(true);
    expect(isDigestToWatch(undefined as any, { domain: 'docker.io' }, true, 'floating')).toBe(
      false,
    );

    // Digest-pinned images have no tag-comparison path, so they default to digest watch
    // even on Docker Hub.
    expect(
      isDigestToWatch(
        undefined as any,
        { domain: 'docker.io', path: 'portainer/agent' },
        false,
        'floating',
        'sha256:abc123',
      ),
    ).toBe(true);
    expect(
      isDigestToWatch(
        undefined as any,
        { domain: undefined, path: 'portainer/agent' },
        false,
        'floating',
        'sha256:abc123',
      ),
    ).toBe(true);

    expect(
      isDigestToWatch(
        undefined as any,
        { domain: 'docker.io', path: 'portainer/agent' },
        true,
        'floating',
        'sha256:abc123',
      ),
    ).toBe(true);

    expect(
      isDigestToWatch(
        undefined as any,
        { domain: 'docker.io', path: 'portainer/agent' },
        false,
        'floating',
        'latest',
        'sha256:abc123',
      ),
    ).toBe(true);

    expect(shouldUpdateDisplayNameFromContainerName('new', 'old', 'old')).toBe(true);
    expect(shouldUpdateDisplayNameFromContainerName('new', 'old', 'custom')).toBe(false);
  });

  test('returns fallback message when error payload is empty', () => {
    expect(getErrorMessage(undefined)).toBe('Unexpected container processing error');
    expect(getErrorMessage('boom')).toBe('boom');
  });

  test('builds fallback container report and preserves existing updateKind', () => {
    const withoutKind = buildFallbackContainerReport(
      {
        id: 'c1',
        name: 'web',
        result: { message: 'old' },
      } as any,
      'failed to process',
    );
    expect(withoutKind.changed).toBe(false);
    expect(withoutKind.container.result).toBeUndefined();
    expect(withoutKind.container.error).toEqual({ message: 'failed to process' });
    expect(withoutKind.container.updateAvailable).toBe(false);
    expect(withoutKind.container.updateKind).toEqual({ kind: 'unknown' });

    const withKind = buildFallbackContainerReport(
      {
        id: 'c2',
        name: 'api',
        result: { message: 'old' },
        updateKind: { kind: 'semver' },
      } as any,
      'another failure',
    );
    expect(withKind.container.updateKind).toEqual({ kind: 'semver' });
  });

  test('buildFallbackContainerReport should not mutate the input container', () => {
    const sourceContainer = {
      id: 'c3',
      name: 'worker',
      result: { message: 'old' },
    } as any;

    const report = buildFallbackContainerReport(sourceContainer, 'processing failed');

    expect(report.container).not.toBe(sourceContainer);
    expect(sourceContainer.result).toEqual({ message: 'old' });
    expect(sourceContainer.error).toBeUndefined();
    expect(sourceContainer.updateAvailable).toBeUndefined();
  });

  test('getContainerName should only strip a leading slash', () => {
    expect(getContainerName({ Names: ['/service/api'] })).toBe('service/api');
    expect(getContainerName({ Names: ['service/api'] })).toBe('service/api');
  });

  test('getContainerName should return empty string for missing or empty Names', () => {
    expect(getContainerName({})).toBe('');
    expect(getContainerName({ Names: [] })).toBe('');
  });

  test('getContainerName should prefer non-alias name when Names contains both alias and canonical', () => {
    expect(
      getContainerName({
        Id: '8bf70beac570abcdef1234567890',
        Names: ['/8bf70beac570_termix', '/termix'],
      }),
    ).toBe('termix');
  });

  test('getContainerName should skip non-string entries when scanning multi-name aliases', () => {
    expect(
      getContainerName({
        Id: '8bf70beac570abcdef1234567890',
        Names: [123 as any, '/termix'],
      }),
    ).toBe('termix');
  });

  test('getContainerName should strip alias prefix from single-entry Names when ID matches', () => {
    expect(
      getContainerName({
        Id: '8bf70beac570abcdef1234567890',
        Names: ['/8bf70beac570_termix'],
      }),
    ).toBe('termix');
  });

  test('getContainerName should strip alias unconditionally even when container ID does not match', () => {
    expect(
      getContainerName({
        Id: 'aaaa00000000abcdef1234567890',
        Names: ['/8bf70beac570_termix'],
      }),
    ).toBe('termix');
  });

  test('getContainerName should strip alias unconditionally even when no container ID is available', () => {
    expect(getContainerName({ Names: ['/8bf70beac570_termix'] })).toBe('termix');
  });

  test('getContainerName should skip non-string entries in Names when finding canonical name', () => {
    expect(
      getContainerName({
        Id: '8bf70beac570abcdef1234567890',
        Names: [123 as any, '/termix'],
      }),
    ).toBe('termix');
  });

  test('getContainerName should not strip non-alias names that happen to contain underscores', () => {
    expect(
      getContainerName({
        Id: 'abcdef123456abcdef1234567890',
        Names: ['/my_app_container'],
      }),
    ).toBe('my_app_container');
  });

  describe('canonicalizeContainerName', () => {
    test('should strip alias prefix when container ID matches', () => {
      expect(canonicalizeContainerName('8bf70beac570_termix', '8bf70beac570abcdef1234567890')).toBe(
        'termix',
      );
    });

    test('should strip alias unconditionally even when container ID does not match', () => {
      expect(canonicalizeContainerName('8bf70beac570_termix', 'aaaa00000000abcdef1234567890')).toBe(
        'termix',
      );
    });

    test('should strip alias unconditionally even when no container ID provided', () => {
      expect(canonicalizeContainerName('8bf70beac570_termix', '')).toBe('termix');
    });

    test('should keep non-alias names unchanged', () => {
      expect(canonicalizeContainerName('termix', '8bf70beac570abcdef1234567890')).toBe('termix');
      expect(canonicalizeContainerName('my_app', 'abcdef123456abcdef1234567890')).toBe('my_app');
    });
  });

  describe('getRawContainerName', () => {
    test('should return raw name without canonicalization', () => {
      expect(getRawContainerName({ Names: ['/7ea6b8a42686_termix'] })).toBe('7ea6b8a42686_termix');
    });

    test('should return empty string for non-string first entry', () => {
      expect(getRawContainerName({ Names: [123 as any] })).toBe('');
    });

    test('should return empty string for missing Names', () => {
      expect(getRawContainerName({} as any)).toBe('');
    });
  });
});
