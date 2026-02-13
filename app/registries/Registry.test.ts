// @ts-nocheck
import log from '../log/index.js';

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
  expect(registry.authenticate({}, { x: 'x' })).resolves.toStrictEqual({
    x: 'x',
  });
});

test('getAuthPull should return undefined by default', async () => {
  expect(await registry.getAuthPull()).toBeUndefined();
});

// --- getTags tests ---

describe('getTags', () => {
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
    expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
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
    expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
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
    expect(registryMocked.getImageManifestDigest(imageInput())).resolves.toStrictEqual({
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
