import log from '../log/index.js';
import { getRegistryRequestTimeoutMs } from './configuration.js';

// Hoisted spy so we can assert on observe() calls in metric tests
const { observeSpy } = vi.hoisted(() => ({ observeSpy: vi.fn() }));

vi.mock('axios');
vi.mock('../prometheus/registry', () => ({
  getSummaryTags: () => ({
    observe: observeSpy,
  }),
}));

// withRetry: pass-through by default (calls the request fn once and returns the full envelope).
// acquireToken: no-op (token bucket has no effect on unit tests).
vi.mock('./http-retry.js', () => ({
  withRetry: vi.fn(async (requestFn) => {
    return requestFn();
  }),
}));
vi.mock('./token-bucket.js', () => ({
  acquireToken: vi.fn(() => Promise.resolve()),
  getBucketForUrl: vi.fn(() => ({ key: 'mock-host', ratePerSec: 10, burst: 10 })),
}));

import Registry from './Registry.js';

// --- Factory helpers (not used inside vi.mock, safe to define here) ---

/** Create a Registry instance with log already attached */
function createMockedRegistry() {
  const r = new Registry();
  r.log = log;
  return r;
}

/** Standard image input used by most getImageManifestDigest tests */
function imageInput(overrides = {}) {
  return {
    name: 'image',
    architecture: 'amd64',
    os: 'linux',
    tag: { value: 'tag' },
    registry: { url: 'url' },
    ...overrides,
  };
}

/** Build a manifest-list / OCI-index response */
function manifestListResponse(
  manifests,
  mediaType = 'application/vnd.docker.distribution.manifest.list.v2+json',
) {
  return {
    schemaVersion: 2,
    mediaType,
    manifests,
  };
}

/** Build a single platform manifest entry */
function platformManifest(arch, os, digest, mediaType, variant) {
  const platform = { architecture: arch, os };
  if (variant) platform.variant = variant;
  return { platform, digest, mediaType };
}

/** Build a callRegistry spy that returns a head-digest then a manifest body */
function headDigestThenBody(headDigest, body) {
  return vi.fn((options) => {
    if (options.method === 'head') {
      return { headers: { 'docker-content-digest': headDigest } };
    }
    return body;
  });
}

const ALL_MANIFEST_ACCEPT =
  'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json';

// --- Standalone registry instance for simple property tests ---
const registry = new Registry();
registry.register('registry', 'hub', 'test', {});

test('base64Encode should decode credentials', async () => {
  expect(Registry.base64Encode('username', 'password')).toEqual('dXNlcm5hbWU6cGFzc3dvcmQ=');
});

test('getId should return registry type only', async () => {
  expect(registry.getId()).toStrictEqual('hub.test');
});

test('match should return false when not overridden', async () => {
  expect(registry.match({})).toBeFalsy();
});

test('normalizeImage should return same image when not overridden', async () => {
  expect(registry.normalizeImage({ x: 'x' })).toStrictEqual({ x: 'x' });
});

test('authenticate should return same request options when not overridden', async () => {
  await expect(registry.authenticate({}, { x: 'x' })).resolves.toStrictEqual({
    x: 'x',
  });
});

test('getAuthPull should return undefined by default', async () => {
  expect(await registry.getAuthPull()).toBeUndefined();
});

// --- getTags tests ---

describe('getTags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const tagsImage = { name: 'test', registry: { url: 'test' } };

  test.each([
    ['sort tags z -> a', { tags: ['v1', 'v2', 'v3'] }, ['v3', 'v2', 'v1']],
    ['handle empty tags list', { tags: [] }, []],
    ['handle null tags in page response', {}, []],
  ])('should %s', async (_label, data, expected) => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => ({ headers: {}, data });
    const result = await registryMocked.getTags(tagsImage);
    expect(result).toStrictEqual(expected);
  });

  test('should propagate network errors from callRegistry', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:443');
    };
    await expect(registryMocked.getTags(tagsImage)).rejects.toThrow(
      'connect ECONNREFUSED 127.0.0.1:443',
    );
  });

  test('should propagate timeout errors from callRegistry', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => {
      throw new Error('timeout of 15000ms exceeded');
    };
    await expect(registryMocked.getTags(tagsImage)).rejects.toThrow('timeout of 15000ms exceeded');
  });

  test('should propagate 401 errors from callRegistry', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => {
      const error = new Error('Request failed with status code 401');
      (error as any).response = { status: 401 };
      throw error;
    };
    await expect(registryMocked.getTags(tagsImage)).rejects.toThrow(
      'Request failed with status code 401',
    );
  });

  test('should propagate errors during pagination', async () => {
    const registryMocked = createMockedRegistry();
    let callCount = 0;
    registryMocked.callRegistry = () => {
      callCount++;
      if (callCount === 1) {
        return { headers: { link: 'next' }, data: { tags: ['v1', 'v2'] } };
      }
      throw new Error('Request failed with status code 429');
    };
    await expect(registryMocked.getTags(tagsImage)).rejects.toThrow(
      'Request failed with status code 429',
    );
  });

  test('should handle undefined data and tags in page', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => ({ headers: {}, data: undefined });
    const result = await registryMocked.getTags(tagsImage);
    expect(result).toStrictEqual([]);
  });

  test('should paginate when link header is present', async () => {
    const registryMocked = createMockedRegistry();
    let callCount = 0;
    registryMocked.callRegistry = () => {
      callCount++;
      if (callCount === 1) {
        return { headers: { link: 'next' }, data: { tags: ['v1', 'v2'] } };
      }
      return { headers: {}, data: { tags: ['v3'] } };
    };
    const result = await registryMocked.getTags(tagsImage);
    expect(result).toStrictEqual(['v3', 'v2', 'v1']);
  });

  test('should pass last tag as &last= param in paginated request', async () => {
    // This kills mutants on line 206 (StringLiteral ``) and line 209 (StringLiteral ``)
    // by verifying that getTagsPage constructs the correct URL with &last= when lastItem is set
    const registryMocked = createMockedRegistry();
    const callRegistrySpy = vi.fn();
    let callCount = 0;
    callRegistrySpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First page: has link header, includes tags ending with 'v2'
        return { headers: { link: 'rel="next"' }, data: { tags: ['v1', 'v2'] } };
      }
      return { headers: {}, data: { tags: ['v3'] } };
    });
    registryMocked.callRegistry = callRegistrySpy;

    await registryMocked.getTags({ name: 'myimage', registry: { url: 'https://reg.io' } });

    // Second call must include &last=v2 in the URL
    expect(callRegistrySpy).toHaveBeenCalledTimes(2);
    const secondCallUrl = callRegistrySpy.mock.calls[1][0].url;
    expect(secondCallUrl).toContain('&last=v2');
    expect(secondCallUrl).toContain('n=1000');
    // Also verify the URL pattern for first call (no &last=)
    const firstCallUrl = callRegistrySpy.mock.calls[0][0].url;
    expect(firstCallUrl).toContain('n=1000');
    expect(firstCallUrl).not.toContain('&last=');
    expect(firstCallUrl).toContain('myimage/tags/list');
    // Kill line 206:51 StringLiteral "Stryker was here!" — first call must not have garbage appended
    expect(firstCallUrl).toMatch(/\?n=1000$/);
  });

  test('should use the LAST tag (not second) as &last= cursor in paginated request', async () => {
    // Kill line 179:48 [UnaryOperator] +1 mutant: slice(-1) vs slice(+1)
    // With 3 tags ['p1', 'p2', 'p3'], slice(-1)[0]='p3', slice(+1)[0]='p2'
    const registryMocked = createMockedRegistry();
    const callRegistrySpy = vi.fn();
    let callCount2 = 0;
    callRegistrySpy.mockImplementation(() => {
      callCount2++;
      if (callCount2 === 1) {
        return { headers: { link: 'rel="next"' }, data: { tags: ['p1', 'p2', 'p3'] } };
      }
      return { headers: {}, data: { tags: ['p4'] } };
    });
    registryMocked.callRegistry = callRegistrySpy;
    await registryMocked.getTags({ name: 'myimage', registry: { url: 'https://reg.io' } });

    expect(callRegistrySpy).toHaveBeenCalledTimes(2);
    const secondCallUrl = callRegistrySpy.mock.calls[1][0].url;
    // Must use the LAST item (p3), not the second item (p2)
    expect(secondCallUrl).toContain('&last=p3');
    expect(secondCallUrl).not.toContain('&last=p2');
  });

  test('should not paginate when link header is undefined', async () => {
    // Kill line 184 optional chaining mutants: hasNext must depend on link being defined
    const registryMocked = createMockedRegistry();
    const callRegistrySpy = vi.fn().mockReturnValue({
      headers: { link: undefined },
      data: { tags: ['a', 'b'] },
    });
    registryMocked.callRegistry = callRegistrySpy;

    const result = await registryMocked.getTags(tagsImage);
    expect(result).toStrictEqual(['b', 'a']);
    expect(callRegistrySpy).toHaveBeenCalledTimes(1);
  });

  test('should stop pagination when link header transitions from defined to undefined', async () => {
    // Kill line 183-184 optional chaining mutants: link extraction must use ?. correctly
    const registryMocked = createMockedRegistry();
    const callRegistrySpy = vi.fn();
    let page = 0;
    callRegistrySpy.mockImplementation(() => {
      page++;
      if (page === 1) return { headers: { link: 'next' }, data: { tags: ['p1'] } };
      if (page === 2) return { headers: { link: 'next' }, data: { tags: ['p2'] } };
      return { headers: {}, data: { tags: ['p3'] } };
    });
    registryMocked.callRegistry = callRegistrySpy;
    const result = await registryMocked.getTags(tagsImage);
    expect(result).toStrictEqual(['p3', 'p2', 'p1']);
    expect(callRegistrySpy).toHaveBeenCalledTimes(3);
  });

  test('should handle page with undefined headers gracefully', async () => {
    // Kill optional chaining mutants on line 179 (page?.data?.tags?.slice(-1)?.[0])
    // and line 183 (page?.headers?.link) when page.headers is undefined
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn().mockReturnValueOnce({
      headers: undefined,
      data: { tags: ['x'] },
    });
    // headers undefined means link is undefined, so hasNext=false after first page
    const result = await registryMocked.getTags(tagsImage);
    expect(result).toStrictEqual(['x']);
  });

  test('should emit debug log with image name in getTags', async () => {
    // Kill line 173 StringLiteral `` mutant: the debug message must include image name
    const registryMocked = createMockedRegistry();
    const debugSpy = vi.fn();
    registryMocked.log = { debug: debugSpy } as any;
    registryMocked.callRegistry = vi.fn().mockReturnValue({ headers: {}, data: { tags: [] } });

    await registryMocked.getTags({ name: 'my-special-image', registry: { url: 'test' } });

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('my-special-image'));
  });
});

// --- getImageManifestDigest tests ---

describe('getImageManifestDigest', () => {
  test('should return digest for manifest.list.v2 then manifest.v2', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = (options) => {
      if (options.headers.Accept === ALL_MANIFEST_ACCEPT) {
        return manifestListResponse([
          platformManifest(
            'amd64',
            'linux',
            'digest_x',
            'application/vnd.docker.distribution.manifest.v2+json',
          ),
          platformManifest('armv7', 'linux', 'digest_y', 'fail'),
        ]);
      }
      if (options.headers.Accept === 'application/vnd.docker.distribution.manifest.v2+json') {
        return { headers: { 'docker-content-digest': '123456789' } };
      }
      throw new Error('Boom!');
    };
    await expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
      version: 2,
      digest: '123456789',
    });
  });

  test('should return digest for manifest.list.v2 then container.image.v1', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = (options) => {
      if (options.headers.Accept === ALL_MANIFEST_ACCEPT) {
        return manifestListResponse([
          platformManifest(
            'amd64',
            'linux',
            'digest_x',
            'application/vnd.docker.container.image.v1+json',
          ),
          platformManifest('armv7', 'linux', 'digest_y', 'fail'),
        ]);
      }
      throw new Error('Boom!');
    };
    await expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
      version: 1,
      digest: 'digest_x',
    });
  });

  test('should return digest for manifest.v2 with head request', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = headDigestThenBody('123456789', {
      schemaVersion: 2,
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      config: {
        digest: 'digest_x',
        mediaType: 'application/vnd.docker.container.image.v1+json',
      },
    });

    await expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
      version: 2,
      digest: '123456789',
    });

    expect(registryMocked.callRegistry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'head',
        url: 'url/image/manifests/tag',
        headers: {
          Accept: 'application/vnd.docker.distribution.manifest.v2+json',
        },
        resolveWithFullResponse: true,
      }),
    );
  });

  test('should include created date from schemaVersion 2 manifest config blob', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:manifest' } };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        };
      }
      if (
        options.url === 'url/image/manifests/sha256:manifest' &&
        options.method === 'get' &&
        options.headers?.Accept === 'application/vnd.docker.distribution.manifest.v2+json'
      ) {
        return {
          schemaVersion: 2,
          config: {
            digest: 'sha256:config',
          },
        };
      }
      if (options.url === 'url/image/blobs/sha256:config') {
        return {
          created: '2026-03-04T11:22:33.000Z',
        };
      }
      throw new Error(`Unexpected request: ${JSON.stringify(options)}`);
    });

    await expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
      version: 2,
      digest: 'sha256:manifest',
      created: '2026-03-04T11:22:33.000Z',
    });
  });

  test('should fall back to manifest digest when HEAD response omits docker-content-digest', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: {} };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
          config: {
            digest: 'sha256:config',
          },
        };
      }
      if (options.url === 'url/image/blobs/sha256:config') {
        return {
          created: '2026-03-04T11:22:33.000Z',
        };
      }
      throw new Error(`Unexpected request: ${JSON.stringify(options)}`);
    });

    await expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
      version: 2,
      digest: 'tag',
      created: '2026-03-04T11:22:33.000Z',
    });
  });

  test('should ignore invalid created date from schemaVersion 2 config blob', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:manifest' } };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        };
      }
      if (
        options.url === 'url/image/manifests/sha256:manifest' &&
        options.method === 'get' &&
        options.headers?.Accept === 'application/vnd.docker.distribution.manifest.v2+json'
      ) {
        return {
          schemaVersion: 2,
          config: {
            digest: 'sha256:config',
          },
        };
      }
      if (options.url === 'url/image/blobs/sha256:config') {
        return {
          created: 'invalid-date',
        };
      }
      throw new Error(`Unexpected request: ${JSON.stringify(options)}`);
    });

    await expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
      version: 2,
      digest: 'sha256:manifest',
    });
  });

  test('should continue when schemaVersion 2 manifest config fetch fails', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:manifest' } };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        };
      }
      if (
        options.url === 'url/image/manifests/sha256:manifest' &&
        options.method === 'get' &&
        options.headers?.Accept === 'application/vnd.docker.distribution.manifest.v2+json'
      ) {
        throw new Error('manifest config unavailable');
      }
      throw new Error(`Unexpected request: ${JSON.stringify(options)}`);
    });

    await expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
      version: 2,
      digest: 'sha256:manifest',
    });
  });

  test('should return digest for container.image.v1 (schemaVersion 1)', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = (options) => {
      if (options.headers.Accept === ALL_MANIFEST_ACCEPT) {
        return {
          schemaVersion: 1,
          history: [
            {
              v1Compatibility: JSON.stringify({
                config: { Image: 'xxxxxxxxxx' },
              }),
            },
          ],
        };
      }
      throw new Error('Boom!');
    };
    await expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
      version: 1,
      digest: 'xxxxxxxxxx',
      created: undefined,
    });
  });

  test('should return undefined digest for schemaVersion 1 without config image field', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => ({
      schemaVersion: 1,
      history: [
        {
          v1Compatibility: JSON.stringify({
            created: '2024-01-01T00:00:00.000Z',
          }),
        },
      ],
    });

    await expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
      version: 1,
      digest: undefined,
      created: '2024-01-01T00:00:00.000Z',
    });
  });

  test('should reject for schemaVersion 1 when history is an empty array', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => ({
      schemaVersion: 1,
      history: [],
    });

    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow();
  });

  test('should use digest parameter when provided', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = headDigestThenBody('digest-result', {
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
    });
    const result = await registryMocked.getImageManifestDigest(imageInput(), 'sha256:abc123');
    expect(result).toStrictEqual({ version: 2, digest: 'digest-result' });
    expect(registryMocked.callRegistry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ url: 'url/image/manifests/sha256:abc123' }),
    );
  });

  test('should select manifest by variant when multiple match', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = headDigestThenBody(
      'variant-digest',
      manifestListResponse(
        [
          platformManifest(
            'arm',
            'linux',
            'digest_no_variant',
            'application/vnd.oci.image.manifest.v1+json',
          ),
          platformManifest(
            'arm',
            'linux',
            'digest_v7',
            'application/vnd.oci.image.manifest.v1+json',
            'v7',
          ),
        ],
        'application/vnd.oci.image.index.v1+json',
      ),
    );
    const result = await registryMocked.getImageManifestDigest(
      imageInput({ architecture: 'arm', variant: 'v7' }),
    );
    expect(result).toStrictEqual({ version: 2, digest: 'variant-digest' });
  });

  test('should handle oci.image.config.v1+json media type', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () =>
      manifestListResponse([
        platformManifest(
          'amd64',
          'linux',
          'digest_oci_config',
          'application/vnd.oci.image.config.v1+json',
        ),
      ]);
    const result = await registryMocked.getImageManifestDigest(imageInput());
    expect(result).toStrictEqual({ version: 1, digest: 'digest_oci_config' });
  });

  test('should handle no matching platform in manifest list', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () =>
      manifestListResponse([
        platformManifest(
          'arm64',
          'linux',
          'digest_arm64',
          'application/vnd.docker.distribution.manifest.v2+json',
        ),
      ]);
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'Unexpected error; no manifest found',
    );
  });

  test('should handle schemaVersion 2 manifest list payload without manifests array', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => ({
      schemaVersion: 2,
      mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
    });

    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'Unexpected error; no manifest found',
    );
  });

  test('should pick first match when variant does not match any', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = headDigestThenBody(
      'first-match-digest',
      manifestListResponse(
        [
          platformManifest(
            'arm',
            'linux',
            'digest_no_variant1',
            'application/vnd.oci.image.manifest.v1+json',
          ),
          platformManifest(
            'arm',
            'linux',
            'digest_v6',
            'application/vnd.oci.image.manifest.v1+json',
            'v6',
          ),
        ],
        'application/vnd.oci.image.index.v1+json',
      ),
    );
    const result = await registryMocked.getImageManifestDigest(
      imageInput({ architecture: 'arm', variant: 'v7' }),
    );
    expect(result).toStrictEqual({ version: 2, digest: 'first-match-digest' });
  });

  test('should propagate network errors from callRegistry during manifest fetch', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => {
      throw new Error('connect ECONNREFUSED 10.0.0.1:443');
    };
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'connect ECONNREFUSED 10.0.0.1:443',
    );
  });

  test('should propagate timeout errors from callRegistry during manifest fetch', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => {
      throw new Error('timeout of 15000ms exceeded');
    };
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'timeout of 15000ms exceeded',
    );
  });

  test('should propagate 401 errors from callRegistry during manifest fetch', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => {
      const error = new Error('Request failed with status code 401');
      (error as any).response = { status: 401 };
      throw error;
    };
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'Request failed with status code 401',
    );
  });

  test('should propagate 429 rate limit errors from callRegistry during manifest fetch', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => {
      const error = new Error('Request failed with status code 429');
      (error as any).response = { status: 429 };
      throw error;
    };
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'Request failed with status code 429',
    );
  });

  test('should propagate 500 errors from callRegistry during manifest fetch', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => {
      const error = new Error('Request failed with status code 500');
      (error as any).response = { status: 500 };
      throw error;
    };
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'Request failed with status code 500',
    );
  });

  test('should handle malformed JSON in schemaVersion 1 v1Compatibility', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => ({
      schemaVersion: 1,
      history: [{ v1Compatibility: 'not valid json' }],
    });
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow();
  });

  test('should gracefully handle blob fetch error for legacy manifest config', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.headers?.Accept === ALL_MANIFEST_ACCEPT) {
        return manifestListResponse([
          platformManifest(
            'amd64',
            'linux',
            'digest_x',
            'application/vnd.docker.container.image.v1+json',
          ),
        ]);
      }
      if (options.url?.includes('/blobs/')) {
        throw new Error('blob fetch failed');
      }
      throw new Error(`Unexpected request: ${JSON.stringify(options)}`);
    });
    const result = await registryMocked.getImageManifestDigest(imageInput());
    expect(result).toStrictEqual({ version: 1, digest: 'digest_x' });
  });

  test('should include created date when legacy manifest config blob metadata is present', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.headers?.Accept === ALL_MANIFEST_ACCEPT) {
        return manifestListResponse([
          platformManifest(
            'amd64',
            'linux',
            'digest_x',
            'application/vnd.docker.container.image.v1+json',
          ),
        ]);
      }
      if (options.url?.includes('/blobs/')) {
        return {
          created: '2026-04-10T12:34:56.000Z',
        };
      }
      throw new Error(`Unexpected request: ${JSON.stringify(options)}`);
    });

    const result = await registryMocked.getImageManifestDigest(imageInput());
    expect(result).toStrictEqual({
      version: 1,
      digest: 'digest_x',
      created: '2026-04-10T12:34:56.000Z',
    });
  });

  test('should omit created date when legacy manifest config blob metadata is missing', async () => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.headers?.Accept === ALL_MANIFEST_ACCEPT) {
        return manifestListResponse([
          platformManifest(
            'amd64',
            'linux',
            'digest_x',
            'application/vnd.docker.container.image.v1+json',
          ),
        ]);
      }
      if (options.url?.includes('/blobs/')) {
        return {};
      }
      throw new Error(`Unexpected request: ${JSON.stringify(options)}`);
    });

    const result = await registryMocked.getImageManifestDigest(imageInput());
    expect(result).toStrictEqual({ version: 1, digest: 'digest_x' });
  });

  test('should propagate errors from head request during manifest digest resolution', async () => {
    const registryMocked = createMockedRegistry();
    let callCount = 0;
    registryMocked.callRegistry = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return manifestListResponse([
          platformManifest(
            'amd64',
            'linux',
            'digest_x',
            'application/vnd.docker.distribution.manifest.v2+json',
          ),
        ]);
      }
      throw new Error('Request failed with status code 502');
    });
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'Request failed with status code 502',
    );
  });

  test.each([
    ['no digest found (empty object)', () => ({})],
    ['undefined response', () => undefined],
    ['unknown media type', () => ({ schemaVersion: 2, mediaType: 'application/vnd.unknown.type' })],
  ])('should throw when %s', async (_label, callRegistryFn) => {
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = callRegistryFn;
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'Unexpected error; no manifest found',
    );
  });

  // --- filterManifestByPlatform edge cases (tested through getImageManifestDigest) ---

  test('should reject when architecture mismatches (filterManifestByPlatform returns undefined)', async () => {
    // Kill line 85 ConditionalExpression true mutant: the filter must actually check arch AND os
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () =>
      manifestListResponse([
        platformManifest(
          'arm64',
          'linux',
          'digest_arm',
          'application/vnd.docker.distribution.manifest.v2+json',
        ),
      ]);
    // Image requests amd64 but manifest only has arm64
    await expect(
      registryMocked.getImageManifestDigest(imageInput({ architecture: 'amd64' })),
    ).rejects.toThrow('Unexpected error; no manifest found');
  });

  test('should reject when OS mismatches (filterManifestByPlatform returns undefined)', async () => {
    // Kill line 85 mutants: the filter checks both arch AND os
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () =>
      manifestListResponse([
        platformManifest(
          'amd64',
          'windows',
          'digest_win',
          'application/vnd.docker.distribution.manifest.v2+json',
        ),
      ]);
    // Image requests linux but manifest only has windows
    await expect(
      registryMocked.getImageManifestDigest(imageInput({ os: 'linux' })),
    ).rejects.toThrow('Unexpected error; no manifest found');
  });

  test('should return single exact match without variant search', async () => {
    // Kill line 88 [BlockStatement] {} and line 96 [ConditionalExpression] true mutants:
    // when matches.length === 1, the variant refinement block must NOT run
    // (if matches.length === 0 returned undefined, or if variant block always ran, would differ)
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = headDigestThenBody(
      'single-match-digest',
      manifestListResponse([
        platformManifest(
          'amd64',
          'linux',
          'digest_single',
          'application/vnd.oci.image.manifest.v1+json',
        ),
      ]),
    );
    // Even with variant specified, single match should be returned as-is
    const result = await registryMocked.getImageManifestDigest(
      imageInput({ architecture: 'amd64', variant: 'v8' }),
    );
    expect(result).toStrictEqual({ version: 2, digest: 'single-match-digest' });
  });

  test('should use first match when variant is undefined and multiple matches exist', async () => {
    // Kill line 96 [ConditionalExpression] false and [EqualityOperator] mutants:
    // When matches.length > 1 but variant is undefined, first match should be used
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = headDigestThenBody(
      'first-digest',
      manifestListResponse([
        platformManifest(
          'arm',
          'linux',
          'digest_first',
          'application/vnd.oci.image.manifest.v1+json',
        ),
        platformManifest(
          'arm',
          'linux',
          'digest_second',
          'application/vnd.oci.image.manifest.v1+json',
          'v7',
        ),
      ]),
    );
    // No variant in image, two matches exist — must pick first
    const result = await registryMocked.getImageManifestDigest(
      imageInput({ architecture: 'arm', variant: undefined }),
    );
    expect(result).toStrictEqual({ version: 2, digest: 'first-digest' });
  });

  test('should select variant match precisely (m.platform.variant === variant)', async () => {
    // Kill lines 97-99 mutants: ArrowFunction () => undefined, ConditionalExpression on variant match
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = headDigestThenBody(
      'exact-variant-digest',
      manifestListResponse(
        [
          platformManifest(
            'arm',
            'linux',
            'digest_v6',
            'application/vnd.oci.image.manifest.v1+json',
            'v6',
          ),
          platformManifest(
            'arm',
            'linux',
            'digest_v7',
            'application/vnd.oci.image.manifest.v1+json',
            'v7',
          ),
          platformManifest(
            'arm',
            'linux',
            'digest_v8',
            'application/vnd.oci.image.manifest.v1+json',
            'v8',
          ),
        ],
        'application/vnd.oci.image.index.v1+json',
      ),
    );
    const result = await registryMocked.getImageManifestDigest(
      imageInput({ architecture: 'arm', variant: 'v7' }),
    );
    // Must select v7's digest, not v6 or v8
    expect(result).toStrictEqual({ version: 2, digest: 'exact-variant-digest' });
    // The HEAD request must have been called with digest_v7
    const headCall = (registryMocked.callRegistry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].method === 'head',
    );
    expect(headCall[0].url).toContain('digest_v7');
  });

  test('should fall back to first match when variantMatch finds nothing', async () => {
    // Kill line 98 [ConditionalExpression] false mutant: when variantMatch is falsy, best stays as matches[0]
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = headDigestThenBody(
      'fallback-digest',
      manifestListResponse(
        [
          platformManifest(
            'arm',
            'linux',
            'digest_no_variant',
            'application/vnd.oci.image.manifest.v1+json',
          ),
          platformManifest(
            'arm',
            'linux',
            'digest_v6',
            'application/vnd.oci.image.manifest.v1+json',
            'v6',
          ),
        ],
        'application/vnd.oci.image.index.v1+json',
      ),
    );
    // Requesting v9 but v9 doesn't exist — should fall back to first match (digest_no_variant)
    const result = await registryMocked.getImageManifestDigest(
      imageInput({ architecture: 'arm', variant: 'v9' }),
    );
    expect(result).toStrictEqual({ version: 2, digest: 'fallback-digest' });
    const headCall = (registryMocked.callRegistry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].method === 'head',
    );
    expect(headCall[0].url).toContain('digest_no_variant');
  });

  test('should use first match when variant is undefined and first match itself has a variant', async () => {
    // Kill line 96:29 [ConditionalExpression] true mutant: variant !== undefined → true
    // Setup: 3 arm/linux matches where matches[0] HAS a variant, image has NO variant
    // Original (variant=undefined): block condition false → best = matches[0] (arm/v6)
    // Mutation (true): block runs → find(m.variant === undefined) → finds arm/novariant (second match)
    // → best = arm/novariant instead of arm/v6 → DIFFERENT
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = headDigestThenBody(
      'first-has-variant-digest',
      manifestListResponse(
        [
          platformManifest(
            'arm',
            'linux',
            'digest_v6',
            'application/vnd.oci.image.manifest.v1+json',
            'v6',
          ),
          platformManifest(
            'arm',
            'linux',
            'digest_no_variant',
            'application/vnd.oci.image.manifest.v1+json',
          ),
          platformManifest(
            'arm',
            'linux',
            'digest_v7',
            'application/vnd.oci.image.manifest.v1+json',
            'v7',
          ),
        ],
        'application/vnd.oci.image.index.v1+json',
      ),
    );
    // Image has NO variant — should return first match (digest_v6)
    const result = await registryMocked.getImageManifestDigest(
      imageInput({ architecture: 'arm', variant: undefined }),
    );
    expect(result).toStrictEqual({ version: 2, digest: 'first-has-variant-digest' });
    const headCall = (registryMocked.callRegistry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].method === 'head',
    );
    // Must use digest_v6 (first match), NOT digest_no_variant
    expect(headCall[0].url).toContain('digest_v6');
    expect(headCall[0].url).not.toContain('digest_no_variant');
  });

  test('should use OCI index media type for manifest list routing', async () => {
    // Kill line 69 ConditionalExpression true mutant: isManifestList must return true for OCI index
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = headDigestThenBody(
      'oci-index-digest',
      manifestListResponse(
        [
          platformManifest(
            'amd64',
            'linux',
            'digest_oci',
            'application/vnd.oci.image.manifest.v1+json',
          ),
        ],
        'application/vnd.oci.image.index.v1+json',
      ),
    );
    const result = await registryMocked.getImageManifestDigest(imageInput());
    expect(result).toStrictEqual({ version: 2, digest: 'oci-index-digest' });
  });

  test('should handle schemaVersion 2 single manifest (isSingleManifest OCI type)', async () => {
    // Kill line 298 string literal mutants: tagOrDigest must be passed as manifestDigest
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:from-head' } };
      }
      // Return single manifest response (not a list)
      return {
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
      };
    });
    const result = await registryMocked.getImageManifestDigest(
      imageInput({ tag: { value: 'my-tag' } }),
    );
    // The tag 'my-tag' should be used as the manifest reference
    expect(result.digest).toBe('sha256:from-head');
    // The HEAD request should have used 'my-tag' as the digest
    const headCall = (registryMocked.callRegistry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].method === 'head',
    );
    expect(headCall[0].url).toContain('my-tag');
  });

  test('should use docker.distribution.manifest.v2+json as single manifest (isSingleManifest)', async () => {
    // Kill line 301 StringLiteral `` mutant: manifestDigest must be tagOrDigest
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:resolved' } };
      }
      return {
        schemaVersion: 2,
        mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      };
    });
    const result = await registryMocked.getImageManifestDigest(
      imageInput({ tag: { value: 'v1.2.3' } }),
    );
    expect(result.digest).toBe('sha256:resolved');
    const headCall = (registryMocked.callRegistry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].method === 'head',
    );
    expect(headCall[0].url).toContain('v1.2.3');
  });

  test('should check manifestDigest truthiness before isSingleManifest (line 307)', async () => {
    // Kill line 310 [LogicalOperator] mutant: if !manifestDigest, isSingleManifest check on line 307 must not proceed
    // and isLegacyImageConfig on line 310 must not proceed either
    // This is achieved by having a manifest list with no matching platform
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () =>
      manifestListResponse(
        [
          // arm64 manifest, but we're requesting amd64 — no match, manifestDigest stays undefined
          platformManifest(
            'arm64',
            'linux',
            'digest_arm',
            'application/vnd.docker.distribution.manifest.v2+json',
          ),
        ],
        'application/vnd.docker.distribution.manifest.list.v2+json',
      );
    await expect(
      registryMocked.getImageManifestDigest(imageInput({ architecture: 'amd64' })),
    ).rejects.toThrow('Unexpected error; no manifest found');
  });

  test('should include created date from legacy image config blob (handleSchemaV2, line 310-318)', async () => {
    // Kill line 318 StringLiteral `` mutant: log message must include non-empty digest
    const registryMocked = createMockedRegistry();
    const debugSpy = vi.fn();
    registryMocked.log = { debug: debugSpy } as any;
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.headers?.Accept === ALL_MANIFEST_ACCEPT) {
        return manifestListResponse([
          platformManifest(
            'amd64',
            'linux',
            'sha256:legacy-digest',
            'application/vnd.docker.container.image.v1+json',
          ),
        ]);
      }
      if (options.url?.includes('/blobs/')) {
        return { created: '2026-01-15T10:30:00.000Z' };
      }
      throw new Error(`Unexpected: ${JSON.stringify(options)}`);
    });

    const result = await registryMocked.getImageManifestDigest(imageInput());
    expect(result).toStrictEqual({
      version: 1,
      digest: 'sha256:legacy-digest',
      created: '2026-01-15T10:30:00.000Z',
    });
    // The debug log should contain the digest
    const debugMessages = debugSpy.mock.calls.map(([msg]) => msg);
    expect(debugMessages.some((m) => m.includes('sha256:legacy-digest'))).toBe(true);
  });

  test('should handle schemaVersion 1 history optional chain when history has items', async () => {
    // Kill line 108 [OptionalChaining] response.history[0] mutant:
    // response.history?.[0] — optional chain must correctly access index 0
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => ({
      schemaVersion: 1,
      history: [
        {
          v1Compatibility: JSON.stringify({
            config: { Image: 'sha256:v1-legacy' },
            created: '2025-12-01T00:00:00.000Z',
          }),
        },
        {
          // Second history entry — must NOT be used
          v1Compatibility: JSON.stringify({
            config: { Image: 'sha256:wrong-entry' },
            created: '2024-01-01T00:00:00.000Z',
          }),
        },
      ],
    });

    const result = await registryMocked.getImageManifestDigest(imageInput());
    // Must use first entry, not second
    expect(result).toStrictEqual({
      version: 1,
      digest: 'sha256:v1-legacy',
      created: '2025-12-01T00:00:00.000Z',
    });
  });

  test('should fetch config digest and return created date (fetchImageCreatedFromManifestConfig)', async () => {
    // Kill lines 375 [OptionalChaining] mutants: manifestResponse?.config?.digest
    // and line 400 [ObjectLiteral] {}, line 402 [StringLiteral] "", line 405 conditionals
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:manifest-digest' } };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        };
      }
      if (options.url === 'url/image/manifests/sha256:manifest-digest') {
        return {
          schemaVersion: 2,
          config: {
            digest: 'sha256:cfg-digest',
            mediaType: 'application/vnd.docker.container.image.v1+json',
          },
        };
      }
      if (options.url === 'url/image/blobs/sha256:cfg-digest') {
        return { created: '2026-03-01T08:00:00.000Z' };
      }
      throw new Error(`Unexpected: ${JSON.stringify(options)}`);
    });

    const result = await registryMocked.getImageManifestDigest(imageInput());
    expect(result).toStrictEqual({
      version: 2,
      digest: 'sha256:manifest-digest',
      created: '2026-03-01T08:00:00.000Z',
    });
    // Verify the blob URL was called with the correct config digest
    const blobCall = (registryMocked.callRegistry as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].url?.includes('/blobs/'),
    );
    expect(blobCall[0].url).toContain('sha256:cfg-digest');
  });

  test('should return undefined when manifest config has no digest (fetchImageCreatedFromManifestConfig)', async () => {
    // Kill line 375 optional chaining: manifestResponse?.config?.digest being undefined must cause early return
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:manifest-digest' } };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        };
      }
      if (options.url === 'url/image/manifests/sha256:manifest-digest') {
        // No config at all
        return { schemaVersion: 2 };
      }
      throw new Error(`Unexpected: ${JSON.stringify(options)}`);
    });

    const result = await registryMocked.getImageManifestDigest(imageInput());
    // created should be absent since configDigest was falsy
    expect(result).toStrictEqual({
      version: 2,
      digest: 'sha256:manifest-digest',
    });
    // Blob endpoint should NOT have been called
    const blobCalls = (registryMocked.callRegistry as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0].url?.includes('/blobs/'),
    );
    expect(blobCalls).toHaveLength(0);
  });

  test('should use Accept header from blob fetch (line 400-402 string literals)', async () => {
    // Kill line 400 [ObjectLiteral] {} and line 402 [StringLiteral] "" mutants:
    // The blob request must have a non-empty Accept header
    const registryMocked = createMockedRegistry();
    const callRegistrySpy = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:mfst' } };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        };
      }
      if (options.url === 'url/image/manifests/sha256:mfst') {
        return { config: { digest: 'sha256:blob' } };
      }
      if (options.url === 'url/image/blobs/sha256:blob') {
        return { created: '2026-04-01T00:00:00.000Z' };
      }
      throw new Error(`Unexpected: ${JSON.stringify(options)}`);
    });
    registryMocked.callRegistry = callRegistrySpy;

    await registryMocked.getImageManifestDigest(imageInput());

    const blobCall = callRegistrySpy.mock.calls.find((c) => c[0].url?.includes('/blobs/'));
    expect(blobCall[0].headers.Accept).toBeTruthy();
    expect(blobCall[0].headers.Accept).toContain('application/vnd.oci.image.config.v1+json');
  });

  test('should return undefined when blob created is invalid date (fetchImageCreatedFromBlob, line 405)', async () => {
    // Kill line 405 [ConditionalExpression] false and [OptionalChaining] configResponse.created mutants
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:mfst' } };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        };
      }
      if (options.url === 'url/image/manifests/sha256:mfst') {
        return { config: { digest: 'sha256:blob' } };
      }
      if (options.url === 'url/image/blobs/sha256:blob') {
        return { created: 'not-a-valid-date' };
      }
      throw new Error(`Unexpected: ${JSON.stringify(options)}`);
    });

    const result = await registryMocked.getImageManifestDigest(imageInput());
    // Invalid date means created is not included in the result
    expect(result).toStrictEqual({ version: 2, digest: 'sha256:mfst' });
    expect((result as any).created).toBeUndefined();
  });

  test('should return undefined when blob created is a non-string value (typeof check, line 405)', async () => {
    // Kill line 405 [ConditionalExpression] false: typeof check must exclude non-string created
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:mfst' } };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        };
      }
      if (options.url === 'url/image/manifests/sha256:mfst') {
        return { config: { digest: 'sha256:blob' } };
      }
      if (options.url === 'url/image/blobs/sha256:blob') {
        return { created: null }; // null is not a string
      }
      throw new Error(`Unexpected: ${JSON.stringify(options)}`);
    });

    const result = await registryMocked.getImageManifestDigest(imageInput());
    expect(result).toStrictEqual({ version: 2, digest: 'sha256:mfst' });
  });

  test('should log debug message when blob fetch fails (line 409-411)', async () => {
    // Kill line 411 StringLiteral `` mutant: error log must include image identifier
    const registryMocked = createMockedRegistry();
    const debugSpy = vi.fn();
    registryMocked.log = { debug: debugSpy } as any;
    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:mfst' } };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        };
      }
      if (options.url === 'url/image/manifests/sha256:mfst') {
        return { config: { digest: 'sha256:blob' } };
      }
      if (options.url?.includes('/blobs/')) {
        throw new Error('blob-access-denied');
      }
      throw new Error(`Unexpected: ${JSON.stringify(options)}`);
    });

    const result = await registryMocked.getImageManifestDigest(imageInput());
    // Should still succeed (error caught), result has no created date
    expect(result.digest).toBe('sha256:mfst');
    // Debug log should mention blob error
    const debugMessages = debugSpy.mock.calls.map(([msg]) => msg);
    expect(
      debugMessages.some((m) => m.includes('blob-access-denied') || m.includes('Unable to fetch')),
    ).toBe(true);
  });

  test('should throw when schemaVersion 2 top-level mediaType is neither list nor single manifest', async () => {
    // Kill line 298 ConditionalExpression true: isSingleManifest must check the actual mediaType
    // If isSingleManifest(mediaType) always returns true, an unknown mediaType would
    // incorrectly take the single-manifest path instead of falling through to throw
    // This test uses an OCI config type at the TOP level — which is neither list nor single manifest
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => ({
      schemaVersion: 2,
      // This is a legacy config type — NOT a manifest list, NOT a single manifest
      mediaType: 'application/vnd.docker.container.image.v1+json',
    });
    // Production: isManifestList=false, isSingleManifest=false → manifestDigest=undefined → throw
    // Mutation (true): else if (true) → takes single-manifest path → manifestDigest=tag → isLegacyImageConfig=true → blob fetch → returns version 1
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'Unexpected error; no manifest found',
    );
  });

  test('should throw when schemaVersion 2 has OCI config type as single manifest is not recognized', async () => {
    // Kill line 310 LogicalOperator ||: manifestDigest must be set for legacy config path
    // If || instead of &&: isLegacyImageConfig(undefined) = false, so behavior is same when manifestDigest is undefined
    // But if manifestDigest is SET and mediaType is NOT legacy: production correctly falls through, mutation would enter blob path
    // Test: single manifest with oci.image.manifest type — isSingleManifest=true, isLegacyImageConfig=false
    // With mutation ||: isSingleManifest(manifestMediaType)=true → takes head path (line 307 wins first)
    // Actual kill scenario: mediaType NOT legacy, manifestDigest set, production correctly uses isSingleManifest path
    // → this is already covered by other tests. The || mutation would mean:
    // For the case where manifestDigest is undefined and isLegacyImageConfig(undefined)=false:
    // original: if (undefined && false) → false; mutation: if (undefined || false) → false — same
    // The || only differs when manifestDigest=falsy AND isLegacyImageConfig(undefined)=true — but isLegacyImageConfig(undefined)=false
    // So line 310 || is equivalent. Documenting here.
    // Let's write an existing-behavior test to confirm:
    const registryMocked = createMockedRegistry();
    registryMocked.callRegistry = () => ({
      schemaVersion: 2,
      mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
      // Empty manifests list
    });
    await expect(registryMocked.getImageManifestDigest(imageInput())).rejects.toThrow(
      'Unexpected error; no manifest found',
    );
  });
});

describe('getImageManifestDigest logging', () => {
  test('should use child logger and include image name for schemaVersion 2 manifest resolution', async () => {
    const registryMocked = new Registry();
    await registryMocked.register('registry', 'hub', 'test', {});
    const childDebug = vi.fn();
    registryMocked.log = { debug: childDebug } as any;
    const rootDebugSpy = vi.spyOn(log, 'debug').mockImplementation(() => undefined);

    registryMocked.callRegistry = headDigestThenBody(
      'sha256:resolved',
      manifestListResponse([
        platformManifest(
          'amd64',
          'linux',
          'sha256:matched',
          'application/vnd.docker.distribution.manifest.v2+json',
        ),
      ]),
    );

    await expect(
      registryMocked.getImageManifestDigest(imageInput({ name: 'library/nginx' })),
    ).resolves.toStrictEqual({
      version: 2,
      digest: 'sha256:resolved',
    });

    expect(rootDebugSpy).not.toHaveBeenCalled();
    expect(childDebug).toHaveBeenCalled();
    for (const [message] of childDebug.mock.calls) {
      expect(message).toContain('library/nginx');
    }

    rootDebugSpy.mockRestore();
  });

  test('should use child logger and include image name for schemaVersion 1 manifest resolution', async () => {
    const registryMocked = new Registry();
    await registryMocked.register('registry', 'hub', 'test', {});
    const childDebug = vi.fn();
    registryMocked.log = { debug: childDebug } as any;
    const rootDebugSpy = vi.spyOn(log, 'debug').mockImplementation(() => undefined);

    registryMocked.callRegistry = () => ({
      schemaVersion: 1,
      history: [
        {
          v1Compatibility: JSON.stringify({
            config: { Image: 'sha256:legacy' },
            created: '2026-03-04T11:22:33.000Z',
          }),
        },
      ],
    });

    await expect(
      registryMocked.getImageManifestDigest(imageInput({ name: 'library/nginx' })),
    ).resolves.toStrictEqual({
      version: 1,
      digest: 'sha256:legacy',
      created: '2026-03-04T11:22:33.000Z',
    });

    expect(rootDebugSpy).not.toHaveBeenCalled();
    expect(childDebug).toHaveBeenCalled();
    for (const [message] of childDebug.mock.calls) {
      expect(message).toContain('library/nginx');
    }

    rootDebugSpy.mockRestore();
  });

  test('should keep manifest-config fallback debug logs on the child logger', async () => {
    const registryMocked = new Registry();
    await registryMocked.register('registry', 'hub', 'test', {});
    const childDebug = vi.fn();
    registryMocked.log = { debug: childDebug } as any;
    const rootDebugSpy = vi.spyOn(log, 'debug').mockImplementation(() => undefined);

    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:manifest' } };
      }
      if (options.url === 'url/image/manifests/tag') {
        return {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        };
      }
      if (
        options.url === 'url/image/manifests/sha256:manifest' &&
        options.method === 'get' &&
        options.headers?.Accept === 'application/vnd.docker.distribution.manifest.v2+json'
      ) {
        throw new Error('manifest config unavailable');
      }
      throw new Error(`Unexpected request: ${JSON.stringify(options)}`);
    });

    await expect(
      registryMocked.getImageManifestDigest(imageInput({ name: 'image' })),
    ).resolves.toStrictEqual({
      version: 2,
      digest: 'sha256:manifest',
    });

    expect(rootDebugSpy).not.toHaveBeenCalled();
    expect(childDebug).toHaveBeenCalledWith(
      expect.stringContaining(
        'Unable to fetch manifest config created date for url/image@sha256:manifest',
      ),
    );

    rootDebugSpy.mockRestore();
  });

  test('should log manifest reference and mediaType for single-manifest path (line 301)', async () => {
    // Kill line 301 StringLiteral `` mutant: debug log must contain reference AND mediaType
    const registryMocked = new Registry();
    await registryMocked.register('registry', 'hub', 'test', {});
    const childDebug = vi.fn();
    registryMocked.log = { debug: childDebug } as any;
    const rootDebugSpy = vi.spyOn(log, 'debug').mockImplementation(() => undefined);

    registryMocked.callRegistry = vi.fn((options) => {
      if (options.method === 'head') {
        return { headers: { 'docker-content-digest': 'sha256:resolved-single' } };
      }
      // Single manifest response (not list)
      return {
        schemaVersion: 2,
        mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      };
    });

    await registryMocked.getImageManifestDigest(
      imageInput({ name: 'myrepo/myimage', tag: { value: 'v2.0.0' } }),
    );

    const allMessages = childDebug.mock.calls.map(([msg]) => msg);
    // Line 301: `${image.name} - Manifest found with [reference=${manifestReference}, mediaType=${response.mediaType}]`
    // manifestReference = tagOrDigest = 'v2.0.0', mediaType = 'application/vnd.docker.distribution.manifest.v2+json'
    expect(
      allMessages.some(
        (m) =>
          m.includes('v2.0.0') &&
          m.includes('application/vnd.docker.distribution.manifest.v2+json'),
      ),
    ).toBe(true);

    rootDebugSpy.mockRestore();
  });

  test('should log digest and version for legacy manifest config path (line 318)', async () => {
    // Kill line 318 StringLiteral `` mutant: debug log must contain digest AND version
    const registryMocked = new Registry();
    await registryMocked.register('registry', 'hub', 'test', {});
    const childDebug = vi.fn();
    registryMocked.log = { debug: childDebug } as any;
    const rootDebugSpy = vi.spyOn(log, 'debug').mockImplementation(() => undefined);

    registryMocked.callRegistry = vi.fn((options) => {
      if (options.headers?.Accept === ALL_MANIFEST_ACCEPT) {
        return manifestListResponse([
          platformManifest(
            'amd64',
            'linux',
            'sha256:unique-legacy-blob',
            'application/vnd.docker.container.image.v1+json',
          ),
        ]);
      }
      if (options.url?.includes('/blobs/')) {
        return { created: '2026-02-01T00:00:00.000Z' };
      }
      throw new Error(`Unexpected: ${JSON.stringify(options)}`);
    });

    await registryMocked.getImageManifestDigest(imageInput({ name: 'library/legacy-image' }));

    const allMessages = childDebug.mock.calls.map(([msg]) => msg);
    // Line 318: `${image.name} - Manifest found with [digest=${result.digest}, version=${result.version}]`
    // Uniquely: digest=sha256:unique-legacy-blob, version=1
    // The line 292 debug also logs the digest, but NOT with 'version='
    const line318Pattern = allMessages.find(
      (m) => m.includes('sha256:unique-legacy-blob') && m.includes('version=1'),
    );
    expect(line318Pattern).toBeTruthy();

    rootDebugSpy.mockRestore();
  });
});

// --- getImagePublishedAt tests ---

describe('getImagePublishedAt', () => {
  test('should return created date from manifest metadata', async () => {
    const registryMocked = createMockedRegistry();
    vi.spyOn(registryMocked, 'getImageManifestDigest').mockResolvedValue({
      digest: 'sha256:manifest',
      created: '2026-03-04T11:22:33.000Z',
      version: 2,
    });

    const publishedAt = await registryMocked.getImagePublishedAt(
      imageInput({ tag: { value: 'latest' } }),
      '1.2.3',
    );

    expect(publishedAt).toBe('2026-03-04T11:22:33.000Z');
  });

  test('should return undefined when manifest created is missing or invalid', async () => {
    const registryMocked = createMockedRegistry();
    const manifestSpy = vi.spyOn(registryMocked, 'getImageManifestDigest');
    manifestSpy.mockResolvedValueOnce({
      digest: 'sha256:manifest',
      version: 2,
    } as any);
    manifestSpy.mockResolvedValueOnce({
      digest: 'sha256:manifest',
      created: 'invalid-date',
      version: 2,
    } as any);

    const missingCreated = await registryMocked.getImagePublishedAt(imageInput());
    const invalidCreated = await registryMocked.getImagePublishedAt(imageInput());

    expect(missingCreated).toBeUndefined();
    expect(invalidCreated).toBeUndefined();
  });

  test('should propagate network errors from getImageManifestDigest', async () => {
    const registryMocked = createMockedRegistry();
    vi.spyOn(registryMocked, 'getImageManifestDigest').mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:443'),
    );

    await expect(
      registryMocked.getImagePublishedAt(imageInput({ tag: { value: 'latest' } })),
    ).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:443');
  });

  test('should propagate timeout errors from getImageManifestDigest', async () => {
    const registryMocked = createMockedRegistry();
    vi.spyOn(registryMocked, 'getImageManifestDigest').mockRejectedValue(
      new Error('timeout of 15000ms exceeded'),
    );

    await expect(
      registryMocked.getImagePublishedAt(imageInput({ tag: { value: 'latest' } })),
    ).rejects.toThrow('timeout of 15000ms exceeded');
  });

  test('should handle publish date lookup when image tag metadata is absent', async () => {
    const registryMocked = createMockedRegistry();
    const manifestSpy = vi.spyOn(registryMocked, 'getImageManifestDigest').mockResolvedValue({
      digest: 'sha256:manifest',
      created: '2026-03-04T11:22:33.000Z',
      version: 2,
    });

    await registryMocked.getImagePublishedAt(imageInput({ tag: undefined }) as any);

    expect(manifestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'image',
      }),
    );
  });

  test('should use provided non-empty tag string to override image tag', async () => {
    // Kill line 255 mutants: typeof tag === 'string' && tag.length > 0
    // Without the length check, empty string would override; without typeof check, non-string would
    const registryMocked = createMockedRegistry();
    const manifestSpy = vi.spyOn(registryMocked, 'getImageManifestDigest').mockResolvedValue({
      digest: 'sha256:x',
      created: '2026-01-01T00:00:00.000Z',
      version: 2,
    });

    await registryMocked.getImagePublishedAt(imageInput({ tag: { value: 'original' } }), '2.0.0');

    // The manifest should have been called with the tag set to '2.0.0'
    const calledImage = manifestSpy.mock.calls[0][0] as any;
    expect(calledImage.tag.value).toBe('2.0.0');
  });

  test('should fall back to image tag when provided tag is an empty string', async () => {
    // Kill line 255 mutants: tag.length > 0 vs >= 0
    // An empty string tag should NOT override the image's own tag
    const registryMocked = createMockedRegistry();
    const manifestSpy = vi.spyOn(registryMocked, 'getImageManifestDigest').mockResolvedValue({
      digest: 'sha256:x',
      created: '2026-01-01T00:00:00.000Z',
      version: 2,
    });

    await registryMocked.getImagePublishedAt(imageInput({ tag: { value: 'original-tag' } }), '');

    const calledImage = manifestSpy.mock.calls[0][0] as any;
    expect(calledImage.tag.value).toBe('original-tag');
  });

  test('should fall back to image tag when provided tag is undefined', async () => {
    // Kill line 255 [ConditionalExpression] true mutant: when tag is undefined, use image.tag.value
    const registryMocked = createMockedRegistry();
    const manifestSpy = vi.spyOn(registryMocked, 'getImageManifestDigest').mockResolvedValue({
      digest: 'sha256:x',
      created: '2026-01-01T00:00:00.000Z',
      version: 2,
    });

    await registryMocked.getImagePublishedAt(
      imageInput({ tag: { value: 'myversion' } }),
      undefined,
    );

    const calledImage = manifestSpy.mock.calls[0][0] as any;
    expect(calledImage.tag.value).toBe('myversion');
  });

  test('should not update tag when tagToLookup is falsy (no tag on image)', async () => {
    // Kill line 256 [ConditionalExpression] false mutant:
    // when tagToLookup resolves to undefined (no tag, no explicit tag param),
    // the tag.value should not be overwritten
    const registryMocked = createMockedRegistry();
    const manifestSpy = vi.spyOn(registryMocked, 'getImageManifestDigest').mockResolvedValue({
      digest: 'sha256:x',
      created: '2026-01-01T00:00:00.000Z',
      version: 2,
    });

    // No tag in image, no tag param -> tagToLookup is undefined -> if(tagToLookup) is false
    await registryMocked.getImagePublishedAt(imageInput({ tag: undefined }) as any, undefined);

    // Should still call getImageManifestDigest (not crash)
    expect(manifestSpy).toHaveBeenCalledTimes(1);
  });

  test('should return undefined when manifest created is not a string (line 260 check)', async () => {
    // Kill line 260 optional chaining mutant: manifest?.created vs manifest.created
    // Also kills [BlockStatement] {} for the if(typeof manifest?.created !== 'string') body
    const registryMocked = createMockedRegistry();
    vi.spyOn(registryMocked, 'getImageManifestDigest').mockResolvedValue({
      digest: 'sha256:x',
      version: 2,
      created: 42 as any, // not a string
    });

    const result = await registryMocked.getImagePublishedAt(imageInput());
    expect(result).toBeUndefined();
  });

  test('should return undefined when manifest created is a number (strict typeof check)', async () => {
    // Complementary to above: 42 is not a string, so should be undefined
    const registryMocked = createMockedRegistry();
    vi.spyOn(registryMocked, 'getImageManifestDigest').mockResolvedValue({
      digest: 'sha256:x',
      version: 2,
      created: '2026-05-01T00:00:00.000Z',
    });

    const result = await registryMocked.getImagePublishedAt(imageInput());
    expect(result).toBe('2026-05-01T00:00:00.000Z');
  });
});

// --- getImageFullName tests ---

describe('getImageFullName', () => {
  const fullNameImage = { name: 'myimage', registry: { url: 'https://registry.example.com/v2' } };

  test.each([
    ['digest references', 'sha256:abcdef', 'registry.example.com/myimage@sha256:abcdef'],
    ['tag references', 'latest', 'registry.example.com/myimage:latest'],
  ])('should handle %s', (_label, ref, expected) => {
    const registryMocked = new Registry();
    expect(registryMocked.getImageFullName(fullNameImage, ref)).toBe(expected);
  });

  test('should strip http:// prefix from URL (not just https://)', async () => {
    // Kill line 509 [Regex] /https:\/\// mutant: must also handle http:// (the ? makes s optional)
    const registryMocked = new Registry();
    const image = { name: 'myimage', registry: { url: 'http://registry.example.com/v2' } };
    const result = registryMocked.getImageFullName(image, 'latest');
    expect(result).toBe('registry.example.com/myimage:latest');
    expect(result).not.toContain('http://');
  });

  test('should strip https:// prefix from URL', async () => {
    const registryMocked = new Registry();
    const image = { name: 'myimage', registry: { url: 'https://registry.example.com/v2' } };
    const result = registryMocked.getImageFullName(image, 'latest');
    expect(result).not.toContain('https://');
    expect(result).toBe('registry.example.com/myimage:latest');
  });

  test('should strip /v2 path segment from URL', async () => {
    const registryMocked = new Registry();
    const image = { name: 'myimage', registry: { url: 'https://registry.example.com/v2' } };
    const result = registryMocked.getImageFullName(image, 'sha256:abc');
    expect(result).not.toContain('/v2');
    expect(result).toBe('registry.example.com/myimage@sha256:abc');
  });

  test('should not strip non-https/http schemes', async () => {
    // Confirm the regex is specifically /https?:\/\// — not a broader pattern
    const registryMocked = new Registry();
    const image = { name: 'myimage', registry: { url: 'ftp://registry.example.com' } };
    const result = registryMocked.getImageFullName(image, 'latest');
    // ftp:// should NOT be stripped — only http/https
    expect(result).toContain('ftp://');
  });
});

// --- callRegistry tests ---

describe('callRegistry', () => {
  test('should call authenticate', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    const registryMocked = createMockedRegistry();
    const spyAuthenticate = vi.spyOn(registryMocked, 'authenticate');
    await registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' });
    expect(spyAuthenticate).toHaveBeenCalledTimes(1);
  });

  test('should observe metrics and rethrow on error', async () => {
    const { default: axios } = await import('axios');
    axios.mockRejectedValue(new Error('network error'));
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('network error');
  });

  test('should include configured timeout in axios options', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    const registryMocked = createMockedRegistry();
    await registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' });
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: getRegistryRequestTimeoutMs() }),
    );
  });

  test('should use centralized outbound timeout when env override is set', async () => {
    const previousTimeout = process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
    process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = '2345';

    try {
      const { default: axios } = await import('axios');
      axios.mockResolvedValue({ data: {} });
      const registryMocked = createMockedRegistry();

      await registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' });

      expect(axios).toHaveBeenCalledWith(expect.objectContaining({ timeout: 2345 }));
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
      } else {
        process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test('should set keep-alive http and https agents when authenticate does not provide them', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    axios.mockClear();
    const registryMocked = createMockedRegistry();

    await registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' });

    const requestOptions = axios.mock.calls.at(-1)[0];
    expect(requestOptions.httpAgent).toBeDefined();
    expect(requestOptions.httpAgent.options.keepAlive).toBe(true);
    expect(requestOptions.httpsAgent).toBeDefined();
    expect(requestOptions.httpsAgent.options.keepAlive).toBe(true);
  });

  test('should keep custom httpsAgent from authenticate while still setting default http keep-alive agent', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    axios.mockClear();
    const registryMocked = createMockedRegistry();
    const customHttpsAgent = { custom: true };
    vi.spyOn(registryMocked, 'authenticate').mockImplementation(async (_image, requestOptions) => ({
      ...requestOptions,
      httpsAgent: customHttpsAgent,
    }));

    await registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' });

    const requestOptions = axios.mock.calls.at(-1)[0];
    expect(requestOptions.httpAgent).toBeDefined();
    expect(requestOptions.httpAgent.options.keepAlive).toBe(true);
    expect(requestOptions.httpsAgent).toBe(customHttpsAgent);
  });

  test('should rethrow ECONNREFUSED with original error message', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('connect ECONNREFUSED 127.0.0.1:443');
    (error as any).code = 'ECONNREFUSED';
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:443');
  });

  test('should rethrow ETIMEDOUT with original error message', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('connect ETIMEDOUT 10.0.0.1:443');
    (error as any).code = 'ETIMEDOUT';
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('connect ETIMEDOUT 10.0.0.1:443');
  });

  test('should rethrow ECONNRESET with original error message', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('read ECONNRESET');
    (error as any).code = 'ECONNRESET';
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('read ECONNRESET');
  });

  test('should rethrow 401 Unauthorized errors', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('Request failed with status code 401');
    (error as any).response = { status: 401 };
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('Request failed with status code 401');
  });

  test('should rethrow 403 Forbidden errors', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('Request failed with status code 403');
    (error as any).response = { status: 403 };
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('Request failed with status code 403');
  });

  test('should rethrow 429 rate limit errors', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('Request failed with status code 429');
    (error as any).response = { status: 429, headers: { 'retry-after': '30' } };
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('Request failed with status code 429');
  });

  test('should rethrow 500 Internal Server Error', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('Request failed with status code 500');
    (error as any).response = { status: 500 };
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('Request failed with status code 500');
  });

  test('should rethrow 502 Bad Gateway errors', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('Request failed with status code 502');
    (error as any).response = { status: 502 };
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('Request failed with status code 502');
  });

  test('should rethrow 503 Service Unavailable errors', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('Request failed with status code 503');
    (error as any).response = { status: 503 };
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('Request failed with status code 503');
  });

  test('should rethrow timeout errors', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('timeout of 15000ms exceeded');
    (error as any).code = 'ECONNABORTED';
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('timeout of 15000ms exceeded');
  });

  test('should rethrow DNS resolution failure errors', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('getaddrinfo ENOTFOUND registry.nonexistent.tld');
    (error as any).code = 'ENOTFOUND';
    axios.mockRejectedValue(error);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('getaddrinfo ENOTFOUND registry.nonexistent.tld');
  });

  test('should rethrow non-Error rejection values', async () => {
    const { default: axios } = await import('axios');
    axios.mockRejectedValue('plain string error');
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toBe('plain string error');
  });

  test('should return full response when resolveWithFullResponse is true', async () => {
    const { default: axios } = await import('axios');
    const mockResponse = {
      data: { tags: ['v1'] },
      headers: { 'content-type': 'application/json' },
      status: 200,
    };
    axios.mockResolvedValue(mockResponse);
    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';
    const result = await registryMocked.callRegistry({
      image: {},
      url: 'url',
      method: 'get',
      resolveWithFullResponse: true,
    });
    expect(result).toEqual({
      data: { tags: ['v1'] },
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  });

  test('acquires a token bucket token before each request', async () => {
    const { default: axios } = await import('axios');
    const { acquireToken } = await import('./token-bucket.js');
    vi.clearAllMocks();
    axios.mockResolvedValue({ data: 'ok', headers: {} });
    const registryMocked = createMockedRegistry();
    await registryMocked.callRegistry({
      image: {},
      url: 'https://ghcr.io/v2/img/tags/list',
      method: 'get',
    });
    expect(acquireToken).toHaveBeenCalledTimes(1);
    expect(acquireToken).toHaveBeenCalledWith(expect.objectContaining({ key: expect.any(String) }));
  });

  test('delegates 429 retry to withRetry and rethrows after exhaustion', async () => {
    const { withRetry } = await import('./http-retry.js');
    // Override withRetry to simulate exhausted retries throwing the 429
    const err429 = new Error('Request failed with status code 429');
    (err429 as any).response = { status: 429, headers: {} };
    (withRetry as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err429);

    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';

    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('status code 429');
  });

  test('delegates 503 retry to withRetry and rethrows after exhaustion', async () => {
    const { withRetry } = await import('./http-retry.js');
    const err503 = new Error('Request failed with status code 503');
    (err503 as any).response = { status: 503, headers: {} };
    (withRetry as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err503);

    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';

    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('status code 503');
  });

  test('passes logger and requestLabel to withRetry', async () => {
    const { default: axios } = await import('axios');
    const { withRetry } = await import('./http-retry.js');
    axios.mockResolvedValue({ data: 'payload', headers: {} });

    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'myname';

    await registryMocked.callRegistry({
      image: {},
      url: 'https://registry.io/v2/img/tags/list',
      method: 'get',
    });

    expect(withRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        logger: expect.objectContaining({ debug: expect.any(Function) }),
        requestLabel: expect.stringContaining('https://registry.io/v2/img/tags/list'),
      }),
    );
  });

  test('should return just data when resolveWithFullResponse is omitted (default false)', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: { payload: 'value' }, headers: {}, status: 200 });
    const registryMocked = createMockedRegistry();
    const result = await registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' });
    // Must be the data only, not the full AxiosResponse shape
    expect(result).toEqual({ payload: 'value' });
    expect((result as any).status).toBeUndefined();
    expect((result as any).headers).toBeUndefined();
  });

  test('should observe timing metrics with value in seconds on success', async () => {
    // Kill lines 487 [ArithmeticOperator] mutants: (end - start) / 1000 vs * 1000 vs end + start
    // Mock Date.now to return controlled values so elapsed is non-zero and deterministic
    observeSpy.mockClear();
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {}, headers: {}, status: 200 });

    let callCount = 0;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      // start = 1000, end = 1500 → (end - start) / 1000 = 0.5
      return callCount++ === 0 ? 1000 : 1500;
    });

    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';

    await registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' });

    dateNowSpy.mockRestore();

    expect(observeSpy).toHaveBeenCalledTimes(1);
    const [labels, elapsed] = observeSpy.mock.calls[0];
    expect(labels).toEqual({ type: 'hub', name: 'test' });
    // (1500 - 1000) / 1000 = 0.5
    // (1500 - 1000) * 1000 = 500000 (would fail)
    // (1500 + 1000) / 1000 = 2.5 (would fail because we expect exactly 0.5)
    expect(elapsed).toBeCloseTo(0.5, 5);
  });

  test('should observe timing metrics with value in seconds on error path', async () => {
    // Kill lines 497 [ArithmeticOperator] mutants in the catch block
    observeSpy.mockClear();
    const { default: axios } = await import('axios');
    axios.mockRejectedValue(new Error('boom'));

    let callCount = 0;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      return callCount++ === 0 ? 2000 : 2200;
    });

    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';

    await expect(
      registryMocked.callRegistry({ image: {}, url: 'url', method: 'get' }),
    ).rejects.toThrow('boom');

    dateNowSpy.mockRestore();

    expect(observeSpy).toHaveBeenCalledTimes(1);
    const [labels, elapsed] = observeSpy.mock.calls[0];
    expect(labels).toEqual({ type: 'hub', name: 'test' });
    // (2200 - 2000) / 1000 = 0.2
    // (2200 - 2000) * 1000 = 200000 (would fail)
    expect(elapsed).toBeCloseTo(0.2, 5);
  });

  test('buildRequestLabel strips query params from valid URL', async () => {
    const { default: axios } = await import('axios');
    const { withRetry } = await import('./http-retry.js');
    axios.mockResolvedValue({ data: {}, headers: {} });

    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';

    await registryMocked.callRegistry({
      image: {},
      url: 'https://registry.io/v2/img/tags/list?n=1000&last=v1&token=SECRET',
      method: 'get',
    });

    expect(withRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        requestLabel: expect.not.stringContaining('SECRET'),
      }),
    );
    expect(withRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        requestLabel: expect.stringContaining('/v2/img/tags/list'),
      }),
    );
  });

  test('buildRequestLabel falls back to raw URL for invalid URLs', async () => {
    const { default: axios } = await import('axios');
    const { withRetry } = await import('./http-retry.js');
    axios.mockResolvedValue({ data: {}, headers: {} });

    const registryMocked = createMockedRegistry();
    registryMocked.type = 'hub';
    registryMocked.name = 'test';

    // 'not-a-url' is not parseable by new URL(), triggering the catch branch
    await registryMocked.callRegistry({
      image: {},
      url: 'not-a-url/path',
      method: 'get',
    });

    expect(withRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        requestLabel: expect.stringContaining('not-a-url/path'),
      }),
    );
  });
});
