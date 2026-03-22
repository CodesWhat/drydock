import { describe, expect, test, vi } from 'vitest';

import {
  buildFallbackContainerReport,
  canonicalizeContainerName,
  getContainerName,
  getErrorMessage,
  getFirstConfigNumber,
  getFirstConfigString,
  getImageForRegistryLookup,
  getImageReferenceCandidatesFromPattern,
  getInspectValueByPath,
  getRawContainerName,
  getSemverTagFromInspectPath,
  isDigestToWatch,
  shouldUpdateDisplayNameFromContainerName,
} from './docker-helpers.js';

vi.mock('parse-docker-image-name', () => ({
  default: vi.fn((value: string) => {
    if (value === 'ghcr.io/team/service') {
      return { domain: 'ghcr.io', path: 'team/service' };
    }
    if (value === 'my-registry.local') {
      return { domain: undefined, path: 'my-registry.local' };
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

  test('keeps digest-watch defaults and display-name update rule behavior', () => {
    // Non-semver floating tags: Docker Hub stays opt-in, non-Hub defaults to watch
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

  test('getContainerName should keep alias name when container ID does not match the prefix', () => {
    expect(
      getContainerName({
        Id: 'aaaa00000000abcdef1234567890',
        Names: ['/8bf70beac570_termix'],
      }),
    ).toBe('8bf70beac570_termix');
  });

  test('getContainerName should keep alias name when no container ID is available', () => {
    expect(getContainerName({ Names: ['/8bf70beac570_termix'] })).toBe('8bf70beac570_termix');
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

    test('should keep name when container ID does not match', () => {
      expect(canonicalizeContainerName('8bf70beac570_termix', 'aaaa00000000abcdef1234567890')).toBe(
        '8bf70beac570_termix',
      );
    });

    test('should keep name when no container ID provided', () => {
      expect(canonicalizeContainerName('8bf70beac570_termix', '')).toBe('8bf70beac570_termix');
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
