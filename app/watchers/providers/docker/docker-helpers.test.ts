import { describe, expect, test, vi } from 'vitest';

import {
  buildFallbackContainerReport,
  getErrorMessage,
  getFirstConfigNumber,
  getFirstConfigString,
  getImageForRegistryLookup,
  getImageReferenceCandidatesFromPattern,
  getInspectValueByPath,
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
    expect(isDigestToWatch(undefined as any, { domain: 'docker.io' }, false)).toBe(false);
    expect(isDigestToWatch(undefined as any, { domain: 'ghcr.io' }, false)).toBe(true);
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
});
