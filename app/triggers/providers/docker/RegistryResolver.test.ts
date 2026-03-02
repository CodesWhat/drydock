import { describe, expect, test, vi } from 'vitest';
import RegistryResolver from './RegistryResolver.js';

function createLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
  };
}

describe('RegistryResolver', () => {
  test('normalizeRegistryHost should handle urls, bare hosts, and invalid values', () => {
    const resolver = new RegistryResolver();

    expect(resolver.normalizeRegistryHost(undefined)).toBeUndefined();
    expect(resolver.normalizeRegistryHost('  ')).toBeUndefined();
    expect(resolver.normalizeRegistryHost('https://ghcr.io/v2/')).toBe('ghcr.io');
    expect(resolver.normalizeRegistryHost('https://ghcr.io:8443/v2/')).toBe('ghcr.io:8443');
    expect(resolver.normalizeRegistryHost('ghcr.io/v2/')).toBe('ghcr.io');
    expect(resolver.normalizeRegistryHost('http://registry.example.com/')).toBe(
      'registry.example.com',
    );
    expect(resolver.normalizeRegistryHost('https://[invalid-host')).toBeUndefined();
  });

  test('buildRegistryLookupCandidates should build host variants and v2-stripped variants', () => {
    const resolver = new RegistryResolver();
    const image = {
      name: 'library/nginx',
      registry: {
        name: 'ghcr',
        url: ' https://ghcr.io/v2/ ',
      },
    };

    const candidates = resolver.buildRegistryLookupCandidates(image);

    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toBe(image);
    expect(candidates[1].registry.url).toBe('ghcr.io');
    expect(candidates[2].registry.url).toBe('http://ghcr.io');
    expect(candidates[3].registry.url).toBe('https://ghcr.io');
    expect(candidates[4].registry.url).toBe('https://ghcr.io');

    expect(resolver.buildRegistryLookupCandidates(undefined)).toEqual([]);
    expect(
      resolver.buildRegistryLookupCandidates({
        name: 'nginx',
        registry: {},
      }),
    ).toHaveLength(1);

    expect(
      resolver.buildRegistryLookupCandidates({
        name: 'nginx',
        registry: {
          url: 'https://[broken-url',
        },
      }),
    ).toEqual([
      {
        name: 'nginx',
        registry: {
          url: 'https://[broken-url',
        },
      },
    ]);
  });

  test('isRegistryManagerCompatible should validate required methods', () => {
    const resolver = new RegistryResolver();

    expect(resolver.isRegistryManagerCompatible(undefined)).toBe(false);
    expect(resolver.isRegistryManagerCompatible({})).toBe(false);
    expect(
      resolver.isRegistryManagerCompatible({
        getAuthPull: vi.fn(),
      }),
    ).toBe(false);
    expect(
      resolver.isRegistryManagerCompatible({
        getAuthPull: vi.fn(),
        getImageFullName: vi.fn(),
      }),
    ).toBe(true);
    expect(
      resolver.isRegistryManagerCompatible(
        {
          getAuthPull: vi.fn(),
          getImageFullName: vi.fn(),
        },
        { requireNormalizeImage: true },
      ),
    ).toBe(false);
  });

  test('createAnonymousRegistryManager should require host and image name and provide helper methods', async () => {
    const resolver = new RegistryResolver();
    const log = createLog();

    expect(
      resolver.createAnonymousRegistryManager(
        {
          image: {
            registry: { name: 'missing', url: '' },
            name: 'library/nginx',
          },
        },
        log,
      ),
    ).toBeUndefined();

    expect(
      resolver.createAnonymousRegistryManager(
        {
          image: {
            registry: { name: 'ghcr', url: 'https://ghcr.io/v2/' },
            name: '  ',
          },
        },
        log,
      ),
    ).toBeUndefined();

    const anonymous = resolver.createAnonymousRegistryManager(
      {
        image: {
          registry: { name: 'ghcr', url: 'https://ghcr.io/v2/' },
          name: 'library/nginx',
        },
      },
      log,
    );

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('using anonymous pull mode'));
    await expect(anonymous.getAuthPull()).resolves.toBeUndefined();
    expect(anonymous.getImageFullName({ name: '/library/nginx' }, '1.25')).toBe(
      'ghcr.io/library/nginx:1.25',
    );
    expect(
      anonymous.getImageFullName(
        { name: 'library/nginx' },
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe('ghcr.io/library/nginx@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(() => anonymous.getImageFullName({ name: '' }, '1.0.0')).toThrow(
      'Container image name is missing',
    );
    expect(() => anonymous.getImageFullName({ name: 'library/nginx' }, '   ')).toThrow(
      'Container image tag/digest is missing',
    );
    try {
      anonymous.getImageFullName({ name: '' }, '1.0.0');
      throw new Error('Expected missing image name to throw');
    } catch (error: any) {
      expect(error.code).toBe('registry-image-name-missing');
    }
    try {
      anonymous.getImageFullName(undefined, '1.0.0');
      throw new Error('Expected missing image object to throw');
    } catch (error: any) {
      expect(error.code).toBe('registry-image-name-missing');
    }
    try {
      anonymous.getImageFullName({ name: 'library/nginx' }, '   ');
      throw new Error('Expected missing image tag to throw');
    } catch (error: any) {
      expect(error.code).toBe('registry-image-tag-missing');
    }
    try {
      anonymous.getImageFullName({ name: 'library/nginx' }, undefined);
      throw new Error('Expected undefined image tag to throw');
    } catch (error: any) {
      expect(error.code).toBe('registry-image-tag-missing');
    }

    expect(
      anonymous.normalizeImage({
        name: 'library/nginx',
        registry: {
          name: '',
          url: 'https://ignored.example.com',
        },
      }),
    ).toEqual({
      name: 'library/nginx',
      registry: {
        name: 'ghcr',
        url: 'ghcr.io',
      },
    });

    const anonymousNameFallback = resolver.createAnonymousRegistryManager(
      {
        image: {
          registry: { url: 'https://ghcr.io/v2/' },
          name: 'library/nginx',
        },
      },
      log,
    );
    expect(
      anonymousNameFallback.normalizeImage({
        name: 'library/nginx',
      }),
    ).toEqual({
      name: 'library/nginx',
      registry: {
        name: 'anonymous',
        url: 'ghcr.io',
      },
    });
  });

  test('resolveRegistryManager should resolve compatible registry by name and throw for misconfiguration', () => {
    const resolver = new RegistryResolver();
    const registryManager = {
      getAuthPull: vi.fn(),
      getImageFullName: vi.fn(),
      normalizeImage: vi.fn(),
    };

    expect(
      resolver.resolveRegistryManager(
        {
          image: {
            registry: {
              name: 'hub',
            },
          },
        },
        createLog(),
        {
          hub: registryManager,
        },
        {
          requireNormalizeImage: true,
        },
      ),
    ).toBe(registryManager);

    expect(() =>
      resolver.resolveRegistryManager(
        {
          image: {
            registry: {
              name: 'bad',
            },
          },
        },
        createLog(),
        {
          bad: {
            getAuthPull: vi.fn(),
          },
        },
        {
          requireNormalizeImage: true,
        },
      ),
    ).toThrow(
      'Registry manager "bad" is misconfigured (lookup by name); expected methods: getAuthPull, getImageFullName, normalizeImage',
    );
  });

  test('resolveRegistryManager should include a stable error code for misconfigured registries', () => {
    const resolver = new RegistryResolver();

    try {
      resolver.resolveRegistryManager(
        {
          image: {
            registry: {
              name: 'bad',
            },
          },
        },
        createLog(),
        {
          bad: {
            getAuthPull: vi.fn(),
          },
        },
        {
          requireNormalizeImage: true,
        },
      );
      throw new Error('Expected misconfigured registry to throw');
    } catch (error: any) {
      expect(error.code).toBe('registry-manager-misconfigured');
    }
  });

  test('resolveRegistryManager should fallback to matcher and log matched registry id', () => {
    const resolver = new RegistryResolver();
    const log = createLog();
    const matcher = {
      match: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('temporary matcher failure');
        })
        .mockImplementationOnce((image) => image.registry?.url === 'ghcr.io')
        .mockImplementation(() => false),
      getAuthPull: vi.fn(),
      getImageFullName: vi.fn(),
      normalizeImage: vi.fn(),
      getId: vi.fn(() => 'matcher-ghcr'),
    };

    const resolved = resolver.resolveRegistryManager(
      {
        image: {
          name: 'library/nginx',
          registry: {
            name: 'unknown',
            url: 'https://ghcr.io/v2/',
          },
        },
      },
      log,
      {
        primary: matcher,
      },
      {
        requireNormalizeImage: true,
      },
    );

    expect(resolved).toBe(matcher);
    expect(log.debug).toHaveBeenCalledWith(
      'Resolved registry manager "unknown" using matcher "matcher-ghcr"',
    );
  });

  test('resolveRegistryManager should throw a typed error when matcher result is misconfigured', () => {
    const resolver = new RegistryResolver();

    try {
      resolver.resolveRegistryManager(
        {
          image: {
            name: 'library/nginx',
            registry: {
              name: 'unknown',
              url: 'ghcr.io',
            },
          },
        },
        createLog(),
        {
          badMatcher: {
            match: vi.fn(() => true),
            getAuthPull: vi.fn(),
          },
        },
        {
          requireNormalizeImage: true,
        },
      );
      throw new Error('Expected matcher misconfiguration to throw');
    } catch (error: any) {
      expect(error.code).toBe('registry-manager-misconfigured');
      expect(error.message).toContain('lookup by image match');
    }
  });

  test('resolveRegistryManager should fallback to unknown matcher id when getId is missing', () => {
    const resolver = new RegistryResolver();
    const log = createLog();
    const matcher = {
      match: vi.fn(() => true),
      getAuthPull: vi.fn(),
      getImageFullName: vi.fn(),
      normalizeImage: vi.fn(),
    };

    const resolved = resolver.resolveRegistryManager(
      {
        image: {
          name: 'library/nginx',
          registry: {
            name: 'unknown',
            url: 'ghcr.io',
          },
        },
      },
      log,
      {
        primary: matcher,
      },
      {
        requireNormalizeImage: true,
      },
    );

    expect(resolved).toBe(matcher);
    expect(log.debug).toHaveBeenCalledWith(
      'Resolved registry manager "unknown" using matcher "unknown"',
    );
  });

  test('resolveRegistryManager should support anonymous fallback and throw unsupported errors otherwise', () => {
    const resolver = new RegistryResolver();
    const log = createLog();

    const anonymous = resolver.resolveRegistryManager(
      {
        image: {
          name: 'library/nginx',
          registry: {
            name: 'missing',
            url: 'https://ghcr.io/v2/',
          },
        },
      },
      log,
      {},
      {
        allowAnonymousFallback: true,
      },
    );

    expect(typeof anonymous.getImageFullName).toBe('function');

    expect(() =>
      resolver.resolveRegistryManager(
        {
          image: {
            name: 'library/nginx',
            registry: {
              name: 'missing',
              url: 'https://ghcr.io/v2/',
            },
          },
        },
        log,
        {
          known: {
            getAuthPull: vi.fn(),
            getImageFullName: vi.fn(),
            normalizeImage: vi.fn(),
            match: vi.fn(() => false),
          },
        },
        {
          allowAnonymousFallback: false,
        },
      ),
    ).toThrow(
      'Unsupported registry manager "missing". Known registries: known. Configure a matching registry or provide a valid registry URL.',
    );

    expect(() => resolver.resolveRegistryManager(undefined, log, {})).toThrow(
      'Unsupported registry manager "undefined". Known registries: none. Configure a matching registry or provide a valid registry URL.',
    );

    expect(
      resolver.resolveRegistryManager(
        {
          image: {
            name: 'library/nginx',
            registry: {
              name: 'missing-match',
              url: 'https://ghcr.io/v2/',
            },
          },
        },
        log,
        {
          withoutMatchMethod: {
            getAuthPull: vi.fn(),
            getImageFullName: vi.fn(),
          },
        },
        {
          allowAnonymousFallback: true,
        },
      ),
    ).toBeDefined();

    expect(() =>
      resolver.resolveRegistryManager(
        {
          image: {
            name: 'library/nginx',
            registry: {
              name: 'no-anon-host',
              url: '',
            },
          },
        },
        log,
        {},
        {
          allowAnonymousFallback: true,
        },
      ),
    ).toThrow('Unsupported registry manager "no-anon-host". Known registries: none.');
  });
});
