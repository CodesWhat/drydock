import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BaseRegistry from './BaseRegistry.js';
import { REGISTRY_BEARER_TOKEN_CACHE_TTL_MS } from './configuration.js';

vi.mock('axios', () => ({
  default: vi.fn(),
}));

let baseRegistry;

class TestBaseRegistry extends BaseRegistry {
  exposeGetRegistryHostname(value) {
    return this.getRegistryHostname(value);
  }
}

function getBearerTokenCacheSize(registry: BaseRegistry) {
  return (
    registry as unknown as {
      bearerTokenCache: Map<string, { token: string; expiresAt: number }>;
    }
  ).bearerTokenCache.size;
}

beforeEach(() => {
  baseRegistry = new TestBaseRegistry();
  vi.clearAllMocks();
});

test('normalizeImageUrl should prepend https when missing', () => {
  const image = {
    registry: { url: 'registry.example.com' },
  };
  const result = baseRegistry.normalizeImageUrl(image);
  expect(result.registry.url).toBe('https://registry.example.com/v2');
});

test('normalizeImageUrl should not modify url when already https', () => {
  const image = {
    registry: { url: 'https://registry.example.com' },
  };
  const result = baseRegistry.normalizeImageUrl(image);
  expect(result.registry.url).toBe('https://registry.example.com');
});

test('normalizeImageUrl should use registryUrl param when provided', () => {
  const image = {
    registry: { url: 'will-be-ignored' },
  };
  const result = baseRegistry.normalizeImageUrl(image, 'custom.io');
  expect(result.registry.url).toBe('https://custom.io/v2');
});

test('normalizeImageUrl should not mutate input image object', () => {
  const image = {
    name: 'library/nginx',
    registry: { url: 'registry.example.com' },
  };

  const result = baseRegistry.normalizeImageUrl(image);

  expect(result).not.toBe(image);
  expect(result.registry).not.toBe(image.registry);
  expect(image.registry.url).toBe('registry.example.com');
  expect(result.registry.url).toBe('https://registry.example.com/v2');
});

test('getRegistryHostname should normalize host from url-like values', () => {
  expect(baseRegistry.exposeGetRegistryHostname('registry.cn-hangzhou.aliyuncs.com')).toBe(
    'registry.cn-hangzhou.aliyuncs.com',
  );
  expect(baseRegistry.exposeGetRegistryHostname('https://US.ICR.IO/v2/library/alpine:latest')).toBe(
    'us.icr.io',
  );
});

test('getRegistryHostname should gracefully handle malformed values', () => {
  expect(baseRegistry.exposeGetRegistryHostname('%')).toBe('%');
});

test('authenticateBasic should add Basic auth header when credentials provided', async () => {
  const result = await baseRegistry.authenticateBasic({ headers: {} }, 'dXNlcjpwYXNz');
  expect(result.headers.Authorization).toBe('Basic dXNlcjpwYXNz');
});

test('authenticateBasic should add Basic auth header when headers are not provided', async () => {
  const result = await baseRegistry.authenticateBasic({}, 'dXNlcjpwYXNz');
  expect(result.headers.Authorization).toBe('Basic dXNlcjpwYXNz');
});

test('authenticateBasic should not add header when no credentials', async () => {
  const result = await baseRegistry.authenticateBasic({ headers: {} }, undefined);
  expect(result.headers.Authorization).toBeUndefined();
});

test('authenticateBearer should add Bearer auth header when token provided', async () => {
  const result = await baseRegistry.authenticateBearer({ headers: {} }, 'my-token');
  expect(result.headers.Authorization).toBe('Bearer my-token');
});

test('authenticateBearer should add Bearer auth header when headers are not provided', async () => {
  const result = await baseRegistry.authenticateBearer({}, 'my-token');
  expect(result.headers.Authorization).toBe('Bearer my-token');
});

test('authenticateBearer should not add header when no token', async () => {
  const result = await baseRegistry.authenticateBearer({ headers: {} }, undefined);
  expect(result.headers.Authorization).toBeUndefined();
});

test('authenticateBasic should attach httpsAgent when insecure=true', async () => {
  baseRegistry.configuration = { insecure: true };
  const result = await baseRegistry.authenticateBasic({ headers: {} }, 'dXNlcjpwYXNz');
  expect(result.headers.Authorization).toBe('Basic dXNlcjpwYXNz');
  expect(result.httpsAgent).toBeDefined();
  expect(result.httpsAgent.options.rejectUnauthorized).toBe(false);
});

test('authenticateBearer should attach CA from cafile when configured', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-baseregistry-'));
  const caPath = path.join(tempDir, 'ca.pem');
  try {
    fs.writeFileSync(caPath, 'test-ca-content');
    baseRegistry.configuration = { cafile: caPath };
    const result = await baseRegistry.authenticateBearer({ headers: {} }, 'token-value');
    expect(result.headers.Authorization).toBe('Bearer token-value');
    expect(result.httpsAgent).toBeDefined();
    expect(result.httpsAgent.options.rejectUnauthorized).toBe(true);
    expect(result.httpsAgent.options.ca.toString('utf-8')).toBe('test-ca-content');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getAuthCredentials should return auth when set', () => {
  baseRegistry.configuration = { auth: 'base64-auth' };
  expect(baseRegistry.getAuthCredentials()).toBe('base64-auth');
});

test('getAuthCredentials should return base64 encoded login/password', () => {
  baseRegistry.configuration = { login: 'user', password: 'pass' };
  expect(baseRegistry.getAuthCredentials()).toBe(Buffer.from('user:pass').toString('base64'));
});

test('getAuthCredentials should return undefined when no auth configured', () => {
  baseRegistry.configuration = {};
  expect(baseRegistry.getAuthCredentials()).toBeUndefined();
});

test('getAuthPull should return login/password when set', async () => {
  baseRegistry.configuration = { login: 'user', password: 'pass' };
  const result = await baseRegistry.getAuthPull();
  expect(result).toEqual({ username: 'user', password: 'pass' });
});

test('getAuthPull should return username/token when set', async () => {
  baseRegistry.configuration = { username: 'user', token: 'tok' };
  const result = await baseRegistry.getAuthPull();
  expect(result).toEqual({ username: 'user', password: 'tok' });
});

test('getAuthPull should return undefined when no credentials', async () => {
  baseRegistry.configuration = {};
  const result = await baseRegistry.getAuthPull();
  expect(result).toBeUndefined();
});

test('getAuthPull should prefer login/password over username/token', async () => {
  baseRegistry.configuration = {
    login: 'user',
    password: 'pass',
    username: 'user2',
    token: 'tok2',
  };
  const result = await baseRegistry.getAuthPull();
  expect(result).toEqual({ username: 'user', password: 'pass' });
});

test('matchUrlPattern should test image url against pattern', () => {
  expect(
    baseRegistry.matchUrlPattern({ registry: { url: 'test.azurecr.io' } }, /azurecr\.io$/),
  ).toBeTruthy();
  expect(
    baseRegistry.matchUrlPattern({ registry: { url: 'test.example.com' } }, /azurecr\.io$/),
  ).toBeFalsy();
});

test('maskSensitiveFields should mask specified fields', () => {
  baseRegistry.configuration = {
    login: 'user',
    password: 'supersecret',
    token: 'mytoken',
  };
  const result = baseRegistry.maskSensitiveFields(['password', 'token']);
  expect(result.login).toBe('user');
  expect(result.password).toBe('s*********t');
  expect(result.token).toBe('m*****n');
});

test('maskSensitiveFields should skip fields not in configuration', () => {
  baseRegistry.configuration = { login: 'user' };
  const result = baseRegistry.maskSensitiveFields(['password']);
  expect(result.login).toBe('user');
  expect(result.password).toBeUndefined();
});

test('authenticateBearerFromAuthUrl should set bearer token using default extractor', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  expect(axios).toHaveBeenCalledWith({
    method: 'GET',
    url: 'https://auth.example.com/token',
    headers: {
      Accept: 'application/json',
      Authorization: 'Basic dXNlcjpwYXNz',
    },
  });
  expect(result.headers.Authorization).toBe('Bearer abc123');
});

test('authenticateBearerFromAuthUrl should add basic auth header when credentials are provided without headers', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    {},
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      headers: {
        Accept: 'application/json',
        Authorization: 'Basic dXNlcjpwYXNz',
      },
    }),
  );
  expect(result.headers.Authorization).toBe('Bearer abc123');
});

test('authenticateBearerFromAuthUrl should create headers object when token request headers are absent', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  const withTlsSpy = vi
    .spyOn(baseRegistry, 'withTlsRequestOptions')
    .mockImplementation((requestOptions: Record<string, unknown>) => {
      if (requestOptions.url === 'https://auth.example.com/no-headers') {
        return {
          method: 'GET',
          url: 'https://auth.example.com/no-headers',
        };
      }
      return requestOptions;
    });

  try {
    const result = await baseRegistry.authenticateBearerFromAuthUrl(
      {},
      'https://auth.example.com/no-headers',
      'dXNlcjpwYXNz',
    );

    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://auth.example.com/no-headers',
      headers: {
        Authorization: 'Basic dXNlcjpwYXNz',
      },
    });
    expect(result.headers.Authorization).toBe('Bearer abc123');
  } finally {
    withTlsSpy.mockRestore();
  }
});

test('authenticateBearerFromAuthUrl should set bearer token when request headers are not provided', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    {},
    'https://auth.example.com/token',
    undefined,
  );

  expect(result.headers.Authorization).toBe('Bearer abc123');
});

test('authenticateBearerFromAuthUrl should throw when token is missing', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: {} });

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {} },
      'https://auth.example.com/token',
      undefined,
      (response) => response.data.accessToken,
    ),
  ).rejects.toThrow('token endpoint response does not contain token');
});

test('authenticateBearerFromAuthUrl should set bearer token using custom tokenExtractor', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { access_token: 'custom-token-123' } });

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://auth.example.com/token',
    undefined,
    (response) => response.data.access_token,
  );

  expect(result.headers.Authorization).toBe('Bearer custom-token-123');
});

test('authenticateBearerFromAuthUrl should throw when token request fails', async () => {
  const { default: axios } = await import('axios');
  axios.mockRejectedValue(new Error('Network error'));

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {} },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token request failed (Network error)');
});

test('authenticateBearerFromAuthUrl should apply tls options to token request', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  baseRegistry.configuration = { insecure: true };

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'GET',
      url: 'https://auth.example.com/token',
      httpsAgent: expect.anything(),
    }),
  );
  expect(result.headers.Authorization).toBe('Bearer abc123');
  expect(result.httpsAgent).toBeDefined();
  expect(result.httpsAgent.options.rejectUnauthorized).toBe(false);
});

test('authenticateBearerFromAuthUrl should reuse cached token within configured ttl', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  vi.setSystemTime(startedAtMs);
  const firstResult = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  vi.setSystemTime(startedAtMs + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS - 1);
  const secondResult = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  expect(axios).toHaveBeenCalledTimes(1);
  expect(firstResult.headers.Authorization).toBe('Bearer abc123');
  expect(secondResult.headers.Authorization).toBe('Bearer abc123');
  vi.useRealTimers();
});

test('authenticateBearerFromAuthUrl should refresh cached token after configured ttl', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios
    .mockResolvedValueOnce({ data: { token: 'abc123' } })
    .mockResolvedValueOnce({ data: { token: 'def456' } });
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  vi.setSystemTime(startedAtMs);
  const firstResult = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  vi.setSystemTime(startedAtMs + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS + 1);
  const secondResult = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  expect(axios).toHaveBeenCalledTimes(2);
  expect(firstResult.headers.Authorization).toBe('Bearer abc123');
  expect(secondResult.headers.Authorization).toBe('Bearer def456');
  vi.useRealTimers();
});

test('authenticateBearerFromAuthUrl should evict expired cache entries from other auth URLs', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios
    .mockResolvedValueOnce({ data: { token: 'abc123' } })
    .mockResolvedValueOnce({ data: { token: 'def456' } })
    .mockResolvedValueOnce({ data: { token: 'ghi789' } });
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    vi.setSystemTime(startedAtMs);
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {} },
      'https://auth.example.com/token-1',
      'dXNlcjE6cGFzczE=',
    );

    vi.setSystemTime(startedAtMs + 1000);
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {} },
      'https://auth.example.com/token-2',
      'dXNlcjI6cGFzczI=',
    );

    vi.setSystemTime(startedAtMs + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS + 1001);
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {} },
      'https://auth.example.com/token-3',
      'dXNlcjM6cGFzczM=',
    );

    expect(getBearerTokenCacheSize(baseRegistry)).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
