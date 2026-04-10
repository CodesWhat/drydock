import log from '../log/index.js';
import { getRegistryRequestTimeoutMs } from './configuration.js';

vi.mock('axios');
vi.mock('../prometheus/registry', () => ({
  getSummaryTags: () => ({
    observe: () => {},
  }),
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
    const mockResponse = { data: { tags: ['v1'] }, headers: {} };
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
    expect(result).toBe(mockResponse);
  });
});
