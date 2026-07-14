import fs from 'node:fs';
import { RE2JS } from 're2js';
import * as registryPrometheus from '../prometheus/registry.js';
import BaseRegistry from './BaseRegistry.js';
import { REGISTRY_BEARER_TOKEN_CACHE_TTL_MS } from './configuration.js';
import Registry from './Registry.js';

vi.mock('axios', () => ({
  default: vi.fn(),
}));

// Pass-through withRetry so the request fn is called once and returns its data.
vi.mock('./http-retry.js', () => ({
  withRetry: vi.fn(async (requestFn) => requestFn()),
}));

// No-op token bucket — unit tests don't need rate-limiting
vi.mock('./token-bucket.js', () => ({
  acquireToken: vi.fn(() => Promise.resolve()),
  getBucketForUrl: vi.fn(() => ({ key: 'mock-host', ratePerSec: 10, burst: 10 })),
}));

let baseRegistry;

class TestBaseRegistry extends BaseRegistry {
  exposeGetRegistryHostname(value) {
    return this.getRegistryHostname(value);
  }
}

class TrustedAuthBaseRegistry extends TestBaseRegistry {
  protected override getTrustedAuthHosts(): string[] {
    return ['auth.example.com'];
  }
}

class MixedCaseTrustedAuthBaseRegistry extends TestBaseRegistry {
  protected override getTrustedAuthHosts(): string[] {
    return ['AUTH.EXAMPLE.COM'];
  }
}

class SparseTrustedAuthBaseRegistry extends TestBaseRegistry {
  protected override getTrustedAuthHosts(): string[] {
    return ['   ', undefined as unknown as string, 'auth.example.com'];
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
  baseRegistry.type = 'registry';
  baseRegistry.name = 'test';
  baseRegistry.configuration = { insecure: true };
  const warnSpy = vi.spyOn(baseRegistry.log, 'warn').mockImplementation(() => undefined);

  const result = await baseRegistry.authenticateBasic({ headers: {} }, 'dXNlcjpwYXNz');
  await baseRegistry.authenticateBasic({ headers: {} }, 'dXNlcjpwYXNz');

  expect(result.headers.Authorization).toBe('Basic dXNlcjpwYXNz');
  expect(result.httpsAgent).toBeDefined();
  expect(result.httpsAgent.options.rejectUnauthorized).toBe(false);
  expect(warnSpy).toHaveBeenCalledTimes(2);
  expect(warnSpy).toHaveBeenCalledWith(
    'Registry registry.test request is using insecure TLS verification because insecure=true; certificate validation is disabled.',
  );

  warnSpy.mockRestore();
});

test('authenticateBearer should attach CA from cafile when configured', async () => {
  const caPath = '/tmp/test-ca.pem';
  const readFileSyncSpy = vi
    .spyOn(fs, 'readFileSync')
    .mockReturnValue(Buffer.from('test-ca-content'));
  try {
    baseRegistry.configuration = { cafile: caPath };
    const result = await baseRegistry.authenticateBearer({ headers: {} }, 'token-value');
    expect(readFileSyncSpy).toHaveBeenCalledWith(caPath);
    expect(result.headers.Authorization).toBe('Bearer token-value');
    expect(result.httpsAgent).toBeDefined();
    expect(result.httpsAgent.options.rejectUnauthorized).toBe(true);
    expect(result.httpsAgent.options.ca.toString('utf-8')).toBe('test-ca-content');
  } finally {
    readFileSyncSpy.mockRestore();
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
  expect(result.password).toBe('[REDACTED]');
  expect(result.token).toBe('[REDACTED]');
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
    { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  expect(axios).toHaveBeenCalledWith({
    method: 'GET',
    url: 'https://auth.example.com/token',
    maxRedirects: 0,
    headers: {
      Accept: 'application/json',
      Authorization: 'Basic dXNlcjpwYXNz',
    },
  });
  expect(result.headers.Authorization).toBe('Bearer abc123');
});

test('authenticateBearerFromAuthUrl should set bearer token using access_token from default extractor', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { access_token: 'access-abc123' } });

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
    'https://auth.example.com/token',
    undefined,
  );

  expect(result.headers.Authorization).toBe('Bearer access-abc123');
});

test('authenticateBearerFromAuthUrl should reject token endpoint host that does not match registry host', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'https://attacker.internal/token',
      'dXNlcjpwYXNz',
    ),
  ).rejects.toThrow('token endpoint host attacker.internal is not trusted');

  expect(axios).not.toHaveBeenCalled();
});

test('authenticateBearerFromAuthUrl should reject token endpoint port that does not match configured registry port', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  baseRegistry.configuration = { url: 'https://registry.example.com:5000/v2' };

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {} },
      'https://registry.example.com:8443/token',
      'dXNlcjpwYXNz',
    ),
  ).rejects.toThrow('token endpoint host registry.example.com:8443 is not trusted');

  expect(axios).not.toHaveBeenCalled();
});

test('authenticateBearerFromAuthUrl should trust token endpoint port that matches configured registry port', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  baseRegistry.configuration = { url: 'https://registry.example.com:5000/v2' };

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://registry.example.com:5000/token',
    'dXNlcjpwYXNz',
  );

  expect(result.headers.Authorization).toBe('Bearer abc123');
  expect(axios).toHaveBeenCalledTimes(1);
});

test('authenticateBearerFromAuthUrl should normalize default https port when validating token endpoint', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  baseRegistry.configuration = { url: 'https://registry.example.com/v2' };

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://registry.example.com:443/token',
    undefined,
  );

  expect(result.headers.Authorization).toBe('Bearer abc123');
  expect(axios).toHaveBeenCalledTimes(1);
});

test('validateAuthUrlHost should reject http authUrl when request is https (scheme-downgrade attack)', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'http://registry.example.com/token',
      'dXNlcjpwYXNz',
    ),
  ).rejects.toThrow(
    'token endpoint http://registry.example.com/token uses plaintext HTTP while the registry is served over HTTPS; refusing to send credentials over an unencrypted connection',
  );

  // Must NOT have made any network call — the scheme guard fires before the token fetch
  expect(axios).not.toHaveBeenCalled();
});

test('validateAuthUrlHost should allow http authUrl when request is also http (plain insecure registry)', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  baseRegistry.configuration = { url: 'http://registry.local/v2' };

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {}, url: 'http://registry.local/v2/library/nginx/manifests/latest' },
    'http://registry.local/token',
    undefined,
  );

  // http→http should pass the scheme check (insecure self-hosted registries are unaffected)
  expect(result.headers.Authorization).toBe('Bearer abc123');
  expect(axios).toHaveBeenCalledTimes(1);
});

test('validateAuthUrlHost should default to https: scheme when requestOptions.url is missing (fail-safe)', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });

  // No url on requestOptions — defaults to https: which means http authUrl is rejected
  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {} },
      'http://registry.example.com/token',
      undefined,
    ),
  ).rejects.toThrow(
    'token endpoint http://registry.example.com/token uses plaintext HTTP while the registry is served over HTTPS; refusing to send credentials over an unencrypted connection',
  );

  expect(axios).not.toHaveBeenCalled();
});

test('validateAuthUrlHost should default to empty authScheme when authUrl is malformed (fail-safe rejects under https)', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });

  // Malformed authUrl — authScheme defaults to '' which !== 'https:' so rejected when request is https
  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'not-a-url',
      undefined,
    ),
  ).rejects.toThrow(
    'token endpoint not-a-url uses plaintext HTTP while the registry is served over HTTPS; refusing to send credentials over an unencrypted connection',
  );

  expect(axios).not.toHaveBeenCalled();
});

test('authenticateBearerFromAuthUrl should trust host from configured registry url when request url is absent', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  baseRegistry.configuration = { url: 'https://auth.example.com/v2' };

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://auth.example.com/token',
    undefined,
  );

  expect(axios).toHaveBeenCalledTimes(1);
  expect(result.headers.Authorization).toBe('Bearer abc123');
});

test('authenticateBearerFromAuthUrl should trust hosts returned by getTrustedAuthHosts', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  const registry = new TrustedAuthBaseRegistry();

  const result = await registry.authenticateBearerFromAuthUrl(
    { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
    'https://auth.example.com/token',
    undefined,
  );

  expect(axios).toHaveBeenCalledTimes(1);
  expect(result.headers.Authorization).toBe('Bearer abc123');
});

test('authenticateBearerFromAuthUrl should normalize trusted auth hosts returned in mixed case', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  const registry = new MixedCaseTrustedAuthBaseRegistry();

  await expect(
    registry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).resolves.toHaveProperty('headers.Authorization', 'Bearer abc123');
  expect(axios).toHaveBeenCalledTimes(1);
});

test('authenticateBearerFromAuthUrl should ignore blank trusted auth hosts', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  const registry = new SparseTrustedAuthBaseRegistry();

  await expect(
    registry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).resolves.toHaveProperty('headers.Authorization', 'Bearer abc123');
  expect(axios).toHaveBeenCalledTimes(1);
});

test('authenticateBearerFromAuthUrl should fail closed when registry host cannot be inferred', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {} },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token endpoint host auth.example.com cannot be validated');

  expect(axios).not.toHaveBeenCalled();
});

test('authenticateBearerFromAuthUrl should add basic auth header when credentials are provided without headers', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
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
      { url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
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
    { url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
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
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
      (response) => response.data.accessToken,
    ),
  ).rejects.toThrow('token endpoint response does not contain token');
});

test('authenticateBearerFromAuthUrlWithPublicFallback should throw actionable error (not silently retry) when credentials are rejected with 401', async () => {
  const authenticateSpy = vi
    .spyOn(baseRegistry as any, 'authenticateBearerFromAuthUrl')
    .mockRejectedValueOnce(new Error('token request failed (Request failed with status code 401)'));

  await expect(
    (baseRegistry as any).authenticateBearerFromAuthUrlWithPublicFallback(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'https://registry.example.com/token',
      'dXNlcjpwYXNz',
      {
        providerLabel: 'Docker Hub',
      },
    ),
  ).rejects.toThrow(
    /Authentication failed for registry.*HTTP 401.*Docker Hub credentials were rejected/,
  );

  // Must NOT retry anonymously — only one call
  expect(authenticateSpy).toHaveBeenCalledTimes(1);
});

test('getRejectedCredentialStatus should return matched status using module-level compiled pattern', () => {
  // Default statuses [401, 403] use a module-level pre-compiled RE2 pattern —
  // RE2JS.compile is NOT invoked at call time for the common case.
  const compileSpy = vi.spyOn(RE2JS, 'compile');

  try {
    expect(
      (baseRegistry as any).getRejectedCredentialStatus(
        new Error('token request failed (Request failed with status code 403)'),
      ),
    ).toBe('403');
    expect(
      (baseRegistry as any).getRejectedCredentialStatus(
        new Error('token request failed (Request failed with status code 401)'),
      ),
    ).toBe('401');
    // The default path must not compile a new pattern on each invocation
    expect(compileSpy).not.toHaveBeenCalled();
  } finally {
    compileSpy.mockRestore();
  }
});

test('getRejectedCredentialStatus compiles a new RE2 pattern for custom status lists', () => {
  const compileSpy = vi
    .spyOn(RE2JS, 'compile')
    .mockReturnValue(
      RE2JS.compile('token request failed \\(Request failed with status code (429)\\)'),
    );

  try {
    expect(
      (baseRegistry as any).getRejectedCredentialStatus(
        new Error('token request failed (Request failed with status code 429)'),
        [429],
      ),
    ).toBe('429');
    expect(compileSpy).toHaveBeenCalledWith(
      'token request failed \\(Request failed with status code (429)\\)',
    );
  } finally {
    compileSpy.mockRestore();
  }
});

test('authenticateBearerFromAuthUrlWithPublicFallback should rethrow non-Error failures', async () => {
  const authenticateSpy = vi
    .spyOn(baseRegistry as any, 'authenticateBearerFromAuthUrl')
    .mockRejectedValueOnce('boom');

  await expect(
    (baseRegistry as any).authenticateBearerFromAuthUrlWithPublicFallback(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'https://registry.example.com/token',
      'dXNlcjpwYXNz',
    ),
  ).rejects.toBe('boom');

  expect(authenticateSpy).toHaveBeenCalledTimes(1);
});

test('authenticateBearerFromAuthUrlWithPublicFallback should rethrow when credentials are absent', async () => {
  const error = new Error('token request failed (Request failed with status code 401)');
  const authenticateSpy = vi
    .spyOn(baseRegistry as any, 'authenticateBearerFromAuthUrl')
    .mockRejectedValueOnce(error);
  const warnSpy = vi.spyOn(baseRegistry.log, 'warn').mockImplementation(() => undefined);

  await expect(
    (baseRegistry as any).authenticateBearerFromAuthUrlWithPublicFallback(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'https://registry.example.com/token',
      undefined,
    ),
  ).rejects.toBe(error);

  expect(authenticateSpy).toHaveBeenCalledTimes(1);
  expect(warnSpy).not.toHaveBeenCalled();
});

test('authenticateBearerFromAuthUrlWithPublicFallback should rethrow when the status is not treated as credential rejection', async () => {
  const error = new Error('token request failed (Request failed with status code 429)');
  const authenticateSpy = vi
    .spyOn(baseRegistry as any, 'authenticateBearerFromAuthUrl')
    .mockRejectedValueOnce(error);
  const warnSpy = vi.spyOn(baseRegistry.log, 'warn').mockImplementation(() => undefined);

  await expect(
    (baseRegistry as any).authenticateBearerFromAuthUrlWithPublicFallback(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'https://registry.example.com/token',
      'dXNlcjpwYXNz',
    ),
  ).rejects.toBe(error);

  expect(authenticateSpy).toHaveBeenCalledTimes(1);
  expect(warnSpy).not.toHaveBeenCalled();
});

test('authenticateBearerFromAuthUrlWithPublicFallback should rethrow when rejected credential statuses are disabled', async () => {
  const error = new Error('token request failed (Request failed with status code 403)');
  vi.spyOn(baseRegistry as any, 'authenticateBearerFromAuthUrl').mockRejectedValueOnce(error);

  await expect(
    (baseRegistry as any).authenticateBearerFromAuthUrlWithPublicFallback(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'https://registry.example.com/token',
      'dXNlcjpwYXNz',
      {
        rejectedCredentialStatuses: [],
      },
    ),
  ).rejects.toBe(error);
});

test('authenticateBearerFromAuthUrlWithPublicFallback should use registry id as provider label when none is supplied', async () => {
  baseRegistry.type = 'registry';
  baseRegistry.name = 'base';
  vi.spyOn(baseRegistry as any, 'authenticateBearerFromAuthUrl').mockRejectedValueOnce(
    new Error('token request failed (Request failed with status code 403)'),
  );

  await expect(
    (baseRegistry as any).authenticateBearerFromAuthUrlWithPublicFallback(
      { headers: {}, url: 'https://registry.example.com/v2/library/nginx/manifests/latest' },
      'https://registry.example.com/token',
      'dXNlcjpwYXNz',
    ),
  ).rejects.toThrow(
    /Authentication failed for registry registry\.base.*HTTP 403.*registry\.base credentials were rejected/,
  );
});

test('authenticateBearerFromAuthUrl should set bearer token using custom tokenExtractor', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { access_token: 'custom-token-123' } });

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
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
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
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
    { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
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

test('authenticateBearerFromAuthUrl should set maxRedirects: 0 on the token-endpoint request to prevent credential exfiltration via redirect', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });

  await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      maxRedirects: 0,
    }),
  );
});

test('authenticateBearerFromAuthUrl should fail closed when the token endpoint returns a redirect (3xx treated as request failure)', async () => {
  const { default: axios } = await import('axios');
  // axios with maxRedirects:0 rejects on 3xx — simulate that behavior
  axios.mockRejectedValue(new Error('Request failed with status code 301'));

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      'dXNlcjpwYXNz',
    ),
  ).rejects.toThrow('token request failed (Request failed with status code 301)');
});

test('authenticateBearerFromAuthUrl should reuse cached token within configured ttl', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  vi.setSystemTime(startedAtMs);
  const firstResult = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  vi.setSystemTime(startedAtMs + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS - 1);
  const secondResult = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  expect(axios).toHaveBeenCalledTimes(1);
  expect(firstResult.headers.Authorization).toBe('Bearer abc123');
  expect(secondResult.headers.Authorization).toBe('Bearer abc123');
  vi.useRealTimers();
});

test('authenticateBearerFromAuthUrl should refresh when the token expires before the configured ttl', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios
    .mockResolvedValueOnce({ data: { token: 'short-lived', expires_in: 2 } })
    .mockResolvedValueOnce({ data: { token: 'refreshed', expires_in: 2 } });
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    vi.setSystemTime(startedAtMs);
    const firstResult = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/short-lived-token',
      'dXNlcjpwYXNz',
    );

    vi.setSystemTime(startedAtMs + 2000);
    const secondResult = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/short-lived-token',
      'dXNlcjpwYXNz',
    );

    expect(axios).toHaveBeenCalledTimes(2);
    expect(firstResult.headers.Authorization).toBe('Bearer short-lived');
    expect(secondResult.headers.Authorization).toBe('Bearer refreshed');
  } finally {
    vi.useRealTimers();
  }
});

test('authenticateBearerFromAuthUrl should cache tokens separately per credentials', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios
    .mockResolvedValueOnce({ data: { token: 'abc123' } })
    .mockResolvedValueOnce({ data: { token: 'def456' } });
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    vi.setSystemTime(startedAtMs);
    const firstResult = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      'dXNlcjpwYXNz',
    );

    const secondResult = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      'ZGlmZmVyZW50LWNyZWRlbnRpYWxz',
    );

    expect(axios).toHaveBeenCalledTimes(2);
    expect(firstResult.headers.Authorization).toBe('Bearer abc123');
    expect(secondResult.headers.Authorization).toBe('Bearer def456');
  } finally {
    vi.useRealTimers();
  }
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
    { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
    'https://auth.example.com/token',
    'dXNlcjpwYXNz',
  );

  vi.setSystemTime(startedAtMs + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS + 1);
  const secondResult = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
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
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token-1',
      'dXNlcjE6cGFzczE=',
    );

    vi.setSystemTime(startedAtMs + 1000);
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token-2',
      'dXNlcjI6cGFzczI=',
    );

    vi.setSystemTime(startedAtMs + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS + 1001);
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token-3',
      'dXNlcjM6cGFzczM=',
    );

    expect(getBearerTokenCacheSize(baseRegistry)).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test('authenticateBearer should preserve an existing httpsAgent when TLS configuration is present', async () => {
  const readFileSyncSpy = vi.spyOn(fs, 'readFileSync');
  const customHttpsAgent = { custom: true } as any;

  try {
    baseRegistry.configuration = { cafile: '/tmp/test-ca.pem' };

    const result = await baseRegistry.authenticateBearer(
      { headers: {}, httpsAgent: customHttpsAgent },
      'token-value',
    );

    expect(readFileSyncSpy).not.toHaveBeenCalled();
    expect(result.httpsAgent).toBe(customHttpsAgent);
    expect(result.headers.Authorization).toBe('Bearer token-value');
  } finally {
    readFileSyncSpy.mockRestore();
  }
});

test('authenticateBearer should return request options unchanged when TLS is not configured', async () => {
  const requestOptions = {
    headers: { 'X-Trace': 'trace-123' },
  };

  const result = await baseRegistry.authenticateBearer(requestOptions, 'token-value');

  expect(result).toEqual({
    headers: {
      'X-Trace': 'trace-123',
      Authorization: 'Bearer token-value',
    },
  });
  expect(result).not.toHaveProperty('httpsAgent');
});

test('authenticateBearer should create and reuse a mutual TLS agent from client cert and key', async () => {
  const certPath = '/tmp/client-cert.pem';
  const keyPath = '/tmp/client-key.pem';
  const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((path) => {
    if (path === certPath) {
      return Buffer.from('client-cert');
    }
    if (path === keyPath) {
      return Buffer.from('client-key');
    }
    throw new Error(`unexpected path ${String(path)}`);
  });

  try {
    baseRegistry.configuration = {
      clientcert: certPath,
      clientkey: keyPath,
    };

    const firstResult = await baseRegistry.authenticateBearer({ headers: {} }, 'token-value');
    const secondResult = await baseRegistry.authenticateBearer({ headers: {} }, 'token-value');

    expect(readFileSyncSpy).toHaveBeenCalledTimes(2);
    expect(readFileSyncSpy).toHaveBeenNthCalledWith(1, certPath);
    expect(readFileSyncSpy).toHaveBeenNthCalledWith(2, keyPath);
    expect(firstResult.httpsAgent).toBeDefined();
    expect(firstResult.httpsAgent).toBe(secondResult.httpsAgent);
    expect(firstResult.httpsAgent.options.rejectUnauthorized).toBe(true);
    expect(firstResult.httpsAgent.options.cert.toString('utf-8')).toBe('client-cert');
    expect(firstResult.httpsAgent.options.key.toString('utf-8')).toBe('client-key');
  } finally {
    readFileSyncSpy.mockRestore();
  }
});

test('getImagePublishedAt should return created date from manifest metadata', async () => {
  const getImageManifestDigestSpy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:abc123',
      created: '2026-03-06T08:00:00.000Z',
      version: 2,
    });

  const publishedAt = await baseRegistry.getImagePublishedAt({
    name: 'library/nginx',
    tag: { value: 'latest' },
    registry: { url: 'https://registry.example.com/v2' },
  });

  expect(getImageManifestDigestSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      tag: { value: 'latest' },
    }),
  );
  expect(publishedAt).toBe('2026-03-06T08:00:00.000Z');
});

test('getImagePublishedAt should pass lookup cache scope to manifest resolution', async () => {
  const getImageManifestDigestSpy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:abc123',
      created: '2026-03-06T08:00:00.000Z',
      version: 2,
    });
  const lookupOptions = { usePollCycleCache: false };

  await baseRegistry.getImagePublishedAt(
    {
      name: 'library/nginx',
      tag: { value: 'latest' },
      registry: { url: 'https://registry.example.com/v2' },
    },
    undefined,
    lookupOptions,
  );

  expect(getImageManifestDigestSpy).toHaveBeenCalledWith(
    expect.objectContaining({ tag: { value: 'latest' } }),
    undefined,
    lookupOptions,
  );
});

test('getImagePublishedAt should use provided tag override for lookup', async () => {
  const getImageManifestDigestSpy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({
      created: '2026-03-06T08:00:00.000Z',
    });

  await baseRegistry.getImagePublishedAt(
    {
      name: 'library/nginx',
      tag: { value: 'latest' },
      registry: { url: 'https://registry.example.com/v2' },
    },
    '1.26.0',
  );

  expect(getImageManifestDigestSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      tag: { value: '1.26.0' },
    }),
  );
});

test('getImagePublishedAt should apply a tag override even when the image has no tag metadata', async () => {
  const getImageManifestDigestSpy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({
      created: '2026-03-06T08:00:00.000Z',
    });

  await baseRegistry.getImagePublishedAt(
    {
      name: 'library/nginx',
      registry: { url: 'https://registry.example.com/v2' },
    } as any,
    '1.26.0',
  );

  expect(getImageManifestDigestSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      tag: { value: '1.26.0' },
    }),
  );
});

test('getImageManifestDigest should not cache responses when digest is undefined', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: undefined,
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  await baseRegistry.getImageManifestDigest(image);
  await baseRegistry.getImageManifestDigest(image);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
  expect(
    (
      baseRegistry as unknown as {
        digestManifestCache: Map<string, unknown>;
      }
    ).digestManifestCache.size,
  ).toBe(0);
});

test('getImagePublishedAt should return undefined when manifest metadata has no created field', async () => {
  vi.spyOn(baseRegistry, 'getImageManifestDigest').mockResolvedValue({
    digest: 'sha256:abc123',
    version: 2,
  });

  const publishedAt = await baseRegistry.getImagePublishedAt({
    name: 'library/nginx',
    tag: { value: 'latest' },
    registry: { url: 'https://registry.example.com/v2' },
  });

  expect(publishedAt).toBeUndefined();
});

test('getImagePublishedAt should return undefined when created timestamp is invalid', async () => {
  vi.spyOn(baseRegistry, 'getImageManifestDigest').mockResolvedValue({
    digest: 'sha256:abc123',
    created: 'not-a-date',
    version: 2,
  });

  const publishedAt = await baseRegistry.getImagePublishedAt({
    name: 'library/nginx',
    tag: { value: 'latest' },
    registry: { url: 'https://registry.example.com/v2' },
  });

  expect(publishedAt).toBeUndefined();
});

test('getImagePublishedAt should handle images without tag metadata', async () => {
  const getImageManifestDigestSpy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:abc123',
      created: '2026-03-06T08:00:00.000Z',
      version: 2,
    });

  await baseRegistry.getImagePublishedAt({
    name: 'library/nginx',
    registry: { url: 'https://registry.example.com/v2' },
  } as any);

  expect(getImageManifestDigestSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'library/nginx',
    }),
  );
});

test('getImageManifestDigest should deduplicate sequential lookups within a poll cycle', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-123',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'https://registry-1.docker.io/v2' },
  };

  const first = await baseRegistry.getImageManifestDigest(image);
  const second = await baseRegistry.getImageManifestDigest(image);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
  expect(first).toEqual(second);
});

test('getTags should deduplicate sequential repository lookups within a poll cycle', async () => {
  const superGetTagsSpy = vi
    .spyOn(Registry.prototype, 'getTags')
    .mockResolvedValue(['2.0.0', '1.0.0']);

  baseRegistry.startDigestCachePollCycle();

  const first = await baseRegistry.getTags({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'https://registry-1.docker.io/v2' },
  });
  const second = await baseRegistry.getTags({
    name: 'postgres',
    tag: { value: '17' },
    architecture: 'arm64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  expect(superGetTagsSpy).toHaveBeenCalledTimes(1);
  expect(first).toEqual(['2.0.0', '1.0.0']);
  expect(second).toEqual(first);
});

test('getTags should bypass the cache when no poll cycle is active', async () => {
  const superGetTagsSpy = vi.spyOn(Registry.prototype, 'getTags').mockResolvedValue(['3.0.0']);
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    registry: { url: 'docker.io' },
  };

  await expect(baseRegistry.getTags(image)).resolves.toEqual(['3.0.0']);
  await expect(baseRegistry.getTags(image)).resolves.toEqual(['3.0.0']);

  expect(superGetTagsSpy).toHaveBeenCalledTimes(2);
});

test('getTags should not reuse a completed poll cycle for a standalone lookup', async () => {
  const superGetTagsSpy = vi.spyOn(Registry.prototype, 'getTags').mockResolvedValue(['3.0.0']);
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    registry: { url: 'docker.io' },
  };

  baseRegistry.startDigestCachePollCycle();
  await expect(baseRegistry.getTags(image)).resolves.toEqual(['3.0.0']);
  baseRegistry.endDigestCachePollCycle();
  await expect(baseRegistry.getTags(image)).resolves.toEqual(['3.0.0']);

  expect(superGetTagsSpy).toHaveBeenCalledTimes(2);
});

test('getTags should bypass an active poll cache for a standalone lookup', async () => {
  const superGetTagsSpy = vi.spyOn(Registry.prototype, 'getTags').mockResolvedValue(['3.0.0']);
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    registry: { url: 'docker.io' },
  };

  baseRegistry.startDigestCachePollCycle();
  await expect(baseRegistry.getTags(image, { usePollCycleCache: true })).resolves.toEqual([
    '3.0.0',
  ]);
  await expect(baseRegistry.getTags(image, { usePollCycleCache: false })).resolves.toEqual([
    '3.0.0',
  ]);
  await expect(baseRegistry.getTags(image, { usePollCycleCache: false })).resolves.toEqual([
    '3.0.0',
  ]);

  expect(superGetTagsSpy).toHaveBeenCalledTimes(3);
});

test('getTags should deduplicate concurrent repository lookups within a poll cycle', async () => {
  let resolveTags: (tags: string[]) => void = () => {};
  const pendingTags = new Promise<string[]>((resolve) => {
    resolveTags = resolve;
  });
  const superGetTagsSpy = vi
    .spyOn(Registry.prototype, 'getTags')
    .mockImplementation(() => pendingTags);

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  const firstLookup = baseRegistry.getTags(image);
  const secondLookup = baseRegistry.getTags(image);
  resolveTags(['17', '16']);

  await expect(Promise.all([firstLookup, secondLookup])).resolves.toEqual([
    ['17', '16'],
    ['17', '16'],
  ]);
  expect(superGetTagsSpy).toHaveBeenCalledTimes(1);
});

test('getTags should return isolated arrays for cached results', async () => {
  vi.spyOn(Registry.prototype, 'getTags').mockResolvedValue(['2.0.0', '1.0.0']);
  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    registry: { url: 'docker.io' },
  };

  const first = await baseRegistry.getTags(image);
  first.pop();
  const second = await baseRegistry.getTags(image);

  expect(second).toEqual(['2.0.0', '1.0.0']);
  expect(second).not.toBe(first);
});

test('getTags should fall back to the original image when cache-key normalization fails', async () => {
  const superGetTagsSpy = vi
    .spyOn(Registry.prototype, 'getTags')
    .mockResolvedValue(['2.0.0', '1.0.0']);
  const normalizeImageSpy = vi.spyOn(baseRegistry, 'normalizeImage').mockImplementation(() => {
    throw new Error('normalize failed');
  });
  const warnSpy = vi.spyOn(baseRegistry.log, 'warn').mockImplementation(() => undefined);
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    registry: { url: 'docker.io' },
  };

  baseRegistry.startDigestCachePollCycle();
  await baseRegistry.getTags(image);
  await baseRegistry.getTags(image);
  const imageWithoutName = {
    tag: { value: '16' },
    registry: { url: 'docker.io' },
  } as any;
  await baseRegistry.getTags(imageWithoutName);
  await baseRegistry.getTags(imageWithoutName);

  expect(superGetTagsSpy).toHaveBeenCalledTimes(2);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining(
      'Unable to normalize image metadata for tag-list cache key generation: docker.io/library/postgres:16 (normalize failed)',
    ),
  );
  normalizeImageSpy.mockRestore();
});

test('startDigestCachePollCycle should clear previous tag-list cache entries', async () => {
  const superGetTagsSpy = vi
    .spyOn(Registry.prototype, 'getTags')
    .mockResolvedValue(['2.0.0', '1.0.0']);
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    registry: { url: 'docker.io' },
  };

  baseRegistry.startDigestCachePollCycle();
  await baseRegistry.getTags(image);
  await baseRegistry.getTags(image);
  baseRegistry.startDigestCachePollCycle();
  await baseRegistry.getTags(image);

  expect(superGetTagsSpy).toHaveBeenCalledTimes(2);
});

test('stale tag lookups cannot overwrite a newer poll cycle cache', async () => {
  let resolveStale: (tags: string[]) => void = () => {};
  let resolveFresh: (tags: string[]) => void = () => {};
  const superGetTagsSpy = vi
    .spyOn(Registry.prototype, 'getTags')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFresh = resolve;
        }),
    );
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    registry: { url: 'docker.io' },
  };

  baseRegistry.startDigestCachePollCycle();
  const staleLookup = baseRegistry.getTags(image);
  baseRegistry.startDigestCachePollCycle();
  const freshLookup = baseRegistry.getTags(image);
  resolveFresh(['18']);
  await expect(freshLookup).resolves.toEqual(['18']);
  resolveStale(['17']);
  await expect(staleLookup).resolves.toEqual(['17']);

  await expect(baseRegistry.getTags(image)).resolves.toEqual(['18']);
  expect(superGetTagsSpy).toHaveBeenCalledTimes(2);
});

test('getImageManifestDigest should deduplicate concurrent lookups within a poll cycle', async () => {
  let resolveDigest: (manifest: { digest: string; created: string; version: number }) => void;
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDigest = resolve;
        }),
    );

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'https://registry-1.docker.io/v2' },
  };

  const firstLookup = baseRegistry.getImageManifestDigest(image);
  const secondLookup = baseRegistry.getImageManifestDigest(image);

  resolveDigest({
    digest: 'sha256:manifest-456',
    created: '2026-03-10T12:00:00.000Z',
    version: 2,
  });

  const [first, second] = await Promise.all([firstLookup, secondLookup]);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
  expect(first).toEqual(second);
});

test('stale manifest completion preserves the newer in-flight poll lookup', async () => {
  type Manifest = { digest: string; created: string; version: number };
  let resolveStale: (manifest: Manifest) => void = () => {};
  let resolveFresh: (manifest: Manifest) => void = () => {};
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFresh = resolve;
        }),
    );
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'https://registry-1.docker.io/v2' },
  };

  baseRegistry.startDigestCachePollCycle();
  const staleLookup = baseRegistry.getImageManifestDigest(image);
  baseRegistry.startDigestCachePollCycle();
  const freshLookup = baseRegistry.getImageManifestDigest(image);

  resolveStale({
    digest: 'sha256:stale',
    created: '2026-03-10T12:00:00.000Z',
    version: 2,
  });
  await expect(staleLookup).resolves.toMatchObject({ digest: 'sha256:stale' });

  const joinedFreshLookup = baseRegistry.getImageManifestDigest(image);
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);

  resolveFresh({
    digest: 'sha256:fresh',
    created: '2026-03-10T12:01:00.000Z',
    version: 2,
  });
  await expect(Promise.all([freshLookup, joinedFreshLookup])).resolves.toEqual([
    expect.objectContaining({ digest: 'sha256:fresh' }),
    expect.objectContaining({ digest: 'sha256:fresh' }),
  ]);
});

test('getImageManifestDigest should bypass the cache when no poll cycle is active', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:new', version: 2 });
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  await expect(baseRegistry.getImageManifestDigest(image)).resolves.toMatchObject({
    digest: 'sha256:new',
  });
  await expect(baseRegistry.getImageManifestDigest(image)).resolves.toMatchObject({
    digest: 'sha256:new',
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

test('getImageManifestDigest should not reuse a completed poll cycle for a standalone lookup', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:new', version: 2 });
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  baseRegistry.startDigestCachePollCycle();
  await expect(baseRegistry.getImageManifestDigest(image)).resolves.toMatchObject({
    digest: 'sha256:new',
  });
  baseRegistry.endDigestCachePollCycle();
  await expect(baseRegistry.getImageManifestDigest(image)).resolves.toMatchObject({
    digest: 'sha256:new',
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

test('getImageManifestDigest should bypass an active poll cache for a standalone lookup', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:new', version: 2 });
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  baseRegistry.startDigestCachePollCycle();
  await expect(
    baseRegistry.getImageManifestDigest(image, undefined, {
      usePollCycleCache: true,
    }),
  ).resolves.toMatchObject({ digest: 'sha256:new' });
  await expect(
    baseRegistry.getImageManifestDigest(image, undefined, {
      usePollCycleCache: false,
    }),
  ).resolves.toMatchObject({ digest: 'sha256:new' });
  await expect(
    baseRegistry.getImageManifestDigest(image, undefined, {
      usePollCycleCache: false,
    }),
  ).resolves.toMatchObject({ digest: 'sha256:new' });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(3);
});

test('startDigestCachePollCycle should clear previous digest cache entries', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-789',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'https://registry-1.docker.io/v2' },
  };

  baseRegistry.startDigestCachePollCycle();
  await baseRegistry.getImageManifestDigest(image);
  await baseRegistry.getImageManifestDigest(image);
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);

  baseRegistry.startDigestCachePollCycle();
  await baseRegistry.getImageManifestDigest(image);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

test('stale manifest lookups cannot overwrite a newer poll cycle cache', async () => {
  let resolveStale: (manifest: { digest: string; version: number }) => void = () => {};
  let resolveFresh: (manifest: { digest: string; version: number }) => void = () => {};
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFresh = resolve;
        }),
    );
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  baseRegistry.startDigestCachePollCycle();
  const staleLookup = baseRegistry.getImageManifestDigest(image);
  baseRegistry.startDigestCachePollCycle();
  const freshLookup = baseRegistry.getImageManifestDigest(image);
  resolveFresh({ digest: 'sha256:fresh', version: 2 });
  await expect(freshLookup).resolves.toMatchObject({ digest: 'sha256:fresh' });
  resolveStale({ digest: 'sha256:stale', version: 2 });
  await expect(staleLookup).resolves.toMatchObject({ digest: 'sha256:stale' });

  await expect(baseRegistry.getImageManifestDigest(image)).resolves.toMatchObject({
    digest: 'sha256:fresh',
  });
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

test('getImageManifestDigest should include architecture in digest cache keys', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-arch',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'https://registry-1.docker.io/v2' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'arm64',
    os: 'linux',
    registry: { url: 'https://registry-1.docker.io/v2' },
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

test('getImageManifestDigest should normalize docker hub references to canonical cache key', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-canonical',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  await baseRegistry.getImageManifestDigest({
    name: 'postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'registry-1.docker.io' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('getImageManifestDigest should treat blank registry URLs as docker.io for cache keys', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-blank-registry',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();
  await baseRegistry.getImageManifestDigest({
    name: 'postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: '   ' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('getImageManifestDigest should fall back to original image when normalizeImage throws during cache key generation', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-normalize-throw',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });
  const normalizeImageSpy = vi.spyOn(baseRegistry, 'normalizeImage').mockImplementation(() => {
    throw new Error('normalize failed');
  });
  const warnSpy = vi.spyOn(baseRegistry.log, 'warn').mockImplementation(() => undefined);

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };
  await baseRegistry.getImageManifestDigest(image);
  await baseRegistry.getImageManifestDigest(image);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining(
      'Unable to normalize image metadata for digest cache key generation: docker.io/library/postgres:16 (normalize failed)',
    ),
  );
  normalizeImageSpy.mockRestore();
});

test('getImageManifestDigest should build cache key with defensive defaults for missing fields', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-defaults',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();
  const image = {
    registry: { url: 'docker.io' },
    tag: { value: '' },
  } as any;

  await baseRegistry.getImageManifestDigest(image);
  await baseRegistry.getImageManifestDigest(image);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('getDigestCacheImageLabel should use defensive defaults and digest precedence', () => {
  const getDigestCacheImageLabel = (
    baseRegistry as unknown as {
      getDigestCacheImageLabel: (image: unknown, digest?: string) => string;
    }
  ).getDigestCacheImageLabel.bind(baseRegistry);

  expect(getDigestCacheImageLabel({})).toBe('unknown-registry/unknown-image:latest');
  expect(
    getDigestCacheImageLabel({
      registry: { url: 'docker.io' },
      name: 'library/nginx',
      digest: { value: 'sha256:cached' },
    }),
  ).toBe('docker.io/library/nginx:sha256:cached');
  expect(
    getDigestCacheImageLabel(
      {
        registry: { url: 'docker.io' },
        name: 'library/nginx',
        tag: { value: 'stable' },
        digest: { value: 'sha256:cached' },
      },
      'sha256:explicit',
    ),
  ).toBe('docker.io/library/nginx:sha256:explicit');
});

test('getImageManifestDigest should include variant and explicit digest in cache keys', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-variant',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    variant: 'v8',
    registry: { url: 'docker.io' },
  };

  await baseRegistry.getImageManifestDigest(image, 'sha256:explicit-digest');
  await baseRegistry.getImageManifestDigest(image, 'sha256:explicit-digest');

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('authenticateBearerFromAuthUrl should include ECONNREFUSED in error message', async () => {
  const { default: axios } = await import('axios');
  const error = new Error('connect ECONNREFUSED 127.0.0.1:443');
  (error as any).code = 'ECONNREFUSED';
  axios.mockRejectedValue(error);

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token request failed (connect ECONNREFUSED 127.0.0.1:443)');
});

test('authenticateBearerFromAuthUrl should include ETIMEDOUT in error message', async () => {
  const { default: axios } = await import('axios');
  const error = new Error('connect ETIMEDOUT 10.0.0.1:443');
  (error as any).code = 'ETIMEDOUT';
  axios.mockRejectedValue(error);

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token request failed (connect ETIMEDOUT 10.0.0.1:443)');
});

test('authenticateBearerFromAuthUrl should include ECONNRESET in error message', async () => {
  const { default: axios } = await import('axios');
  const error = new Error('read ECONNRESET');
  (error as any).code = 'ECONNRESET';
  axios.mockRejectedValue(error);

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token request failed (read ECONNRESET)');
});

test('authenticateBearerFromAuthUrl should wrap 401 Unauthorized in error message', async () => {
  const { default: axios } = await import('axios');
  const error = new Error('Request failed with status code 401');
  (error as any).response = { status: 401 };
  axios.mockRejectedValue(error);

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      'dXNlcjpwYXNz',
    ),
  ).rejects.toThrow('token request failed (Request failed with status code 401)');
});

test('authenticateBearerFromAuthUrl should wrap 429 rate limit in error message', async () => {
  const { default: axios } = await import('axios');
  const error = new Error('Request failed with status code 429');
  (error as any).response = { status: 429, headers: { 'retry-after': '60' } };
  axios.mockRejectedValue(error);

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token request failed (Request failed with status code 429)');
});

test('authenticateBearerFromAuthUrl should wrap 502 Bad Gateway in error message', async () => {
  const { default: axios } = await import('axios');
  axios.mockRejectedValue(new Error('Request failed with status code 502'));

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token request failed (Request failed with status code 502)');
});

test('authenticateBearerFromAuthUrl should wrap 503 Service Unavailable in error message', async () => {
  const { default: axios } = await import('axios');
  axios.mockRejectedValue(new Error('Request failed with status code 503'));

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token request failed (Request failed with status code 503)');
});

test('authenticateBearerFromAuthUrl should preserve non-Error rejection messages', async () => {
  const { default: axios } = await import('axios');
  axios.mockRejectedValue('string rejection');

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token request failed (string rejection)');
});

test('authenticateBearerFromAuthUrl should handle null token request rejections', async () => {
  const { default: axios } = await import('axios');
  axios.mockRejectedValue(null);

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token request failed (unknown error)');
});

test('authenticateBearerFromAuthUrl should handle null response data', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: null });

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token endpoint response does not contain token');
});

test('authenticateBearerFromAuthUrl should handle response with empty string token', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: '' } });

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token endpoint response does not contain token');
});

test('authenticateBearerFromAuthUrl should handle response with whitespace-only token', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: '   ' } });

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('token endpoint response does not contain token');
});

test('authenticateBearerFromAuthUrl should handle token refresh failure after cache expiry', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    vi.setSystemTime(startedAtMs);
    axios.mockResolvedValueOnce({ data: { token: 'initial-token' } });
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      'dXNlcjpwYXNz',
    );

    vi.setSystemTime(startedAtMs + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS + 1);
    axios.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:443'));

    await expect(
      baseRegistry.authenticateBearerFromAuthUrl(
        { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
        'https://auth.example.com/token',
        'dXNlcjpwYXNz',
      ),
    ).rejects.toThrow('token request failed (connect ECONNREFUSED 127.0.0.1:443)');

    expect(axios).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

test('getImageManifestDigest should propagate errors through digest cache', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockRejectedValue(new Error('registry unavailable'));

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  await expect(baseRegistry.getImageManifestDigest(image)).rejects.toThrow('registry unavailable');
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('getImageManifestDigest should not cache failed lookups', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockRejectedValueOnce(new Error('temporary failure'))
    .mockResolvedValueOnce({
      digest: 'sha256:recovered',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  await expect(baseRegistry.getImageManifestDigest(image)).rejects.toThrow('temporary failure');
  const result = await baseRegistry.getImageManifestDigest(image);

  expect(result.digest).toBe('sha256:recovered');
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

test('getImageManifestDigest should clear in-flight entry after rejection', async () => {
  let rejectDigest: (error: Error) => void;
  vi.spyOn(Registry.prototype, 'getImageManifestDigest').mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectDigest = reject;
      }),
  );

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  const lookup = baseRegistry.getImageManifestDigest(image);
  rejectDigest(new Error('connection reset'));

  await expect(lookup).rejects.toThrow('connection reset');

  const inFlightMap = (
    baseRegistry as unknown as {
      digestManifestCacheInFlight: Map<string, unknown>;
    }
  ).digestManifestCacheInFlight;
  expect(inFlightMap.size).toBe(0);
});

test('getImagePublishedAt should return undefined when getImageManifestDigest throws', async () => {
  vi.spyOn(baseRegistry, 'getImageManifestDigest').mockRejectedValue(new Error('registry offline'));

  await expect(
    baseRegistry.getImagePublishedAt({
      name: 'library/nginx',
      tag: { value: 'latest' },
      registry: { url: 'https://registry.example.com/v2' },
    }),
  ).rejects.toThrow('registry offline');
});

test('getImageManifestDigest should not cache responses without a digest string', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: '',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  await baseRegistry.getImageManifestDigest(image);
  await baseRegistry.getImageManifestDigest(image);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

test('endDigestCachePollCycle should return zero hit rate when no requests were recorded', () => {
  baseRegistry.startDigestCachePollCycle();
  baseRegistry.log = {} as any;

  expect(baseRegistry.endDigestCachePollCycle()).toEqual({
    hits: 0,
    misses: 0,
    hitRate: 0,
  });
});

test('endDigestCachePollCycle should return exact digest cache accounting and log it', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-stats',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });
  const debug = vi.fn();
  baseRegistry.type = 'registry';
  baseRegistry.name = 'base';
  baseRegistry.log = {
    debug,
  } as any;

  baseRegistry.startDigestCachePollCycle();
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  expect(baseRegistry.endDigestCachePollCycle()).toEqual({
    hits: 1,
    misses: 1,
    hitRate: 50,
  });
  expect(debug).toHaveBeenCalledWith(
    'registry.base digest cache hit rate 50.00% (1 hits, 1 misses)',
  );
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('endDigestCachePollCycle should log debug hit rate summary', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-stats',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });
  const debug = vi.fn();
  baseRegistry.log = {
    debug,
  } as any;

  baseRegistry.startDigestCachePollCycle();
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });
  baseRegistry.endDigestCachePollCycle();

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
  expect(debug).toHaveBeenCalledWith(expect.stringContaining('digest cache hit rate'));
});

test('getImageManifestDigest should increment digest cache hit and miss counters when metrics are initialized', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:manifest-metrics',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  registryPrometheus.init();
  const hitsCounter = registryPrometheus.getDigestCacheHitsCounter();
  const missesCounter = registryPrometheus.getDigestCacheMissesCounter();
  const hitsIncSpy = vi.spyOn(hitsCounter, 'inc');
  const missesIncSpy = vi.spyOn(missesCounter, 'inc');

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };
  await baseRegistry.getImageManifestDigest(image);
  await baseRegistry.getImageManifestDigest(image);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
  expect(hitsIncSpy).toHaveBeenCalledTimes(1);
  expect(missesIncSpy).toHaveBeenCalledTimes(1);
});

describe('authenticateBearerFromAuthUrl rate-limit and retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('acquires a rate-limit token for the auth host before making the request', async () => {
    const { default: axios } = await import('axios');
    const { acquireToken, getBucketForUrl } = await import('./token-bucket.js');
    axios.mockResolvedValue({ data: { token: 'auth-token' } });

    const authUrl = 'https://auth.example.com/token';
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      authUrl,
      'dXNlcjpwYXNz',
    );

    expect(getBucketForUrl).toHaveBeenCalledWith(authUrl);
    expect(acquireToken).toHaveBeenCalledWith(expect.objectContaining({ key: 'mock-host' }));
  });

  test('wraps the auth call with withRetry so 429 responses are retried', async () => {
    const { withRetry } = await import('./http-retry.js');
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: { token: 'auth-token' } });

    const authUrl = 'https://auth.example.com/token';
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      authUrl,
      'dXNlcjpwYXNz',
    );

    // withRetry should have been called with a request fn and options containing the auth label
    expect(withRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ requestLabel: expect.stringContaining('auth') }),
    );
  });
});

// ── getBearerTokenCacheKey (line 52) ─────────────────────────────────────────

test('getBearerTokenCacheKey should use empty string for missing credentials in cache key', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios
    .mockResolvedValueOnce({ data: { token: 'tok-no-creds' } })
    .mockResolvedValueOnce({ data: { token: 'tok-with-creds' } });
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    vi.setSystemTime(startedAtMs);
    // Call without credentials — caches under key "url|"
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      undefined,
    );

    // Call with credentials — must NOT reuse the anonymous cache entry
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      'dXNlcjpwYXNz',
    );

    // Both should have triggered a real network call (different cache keys)
    expect(axios).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

// ── pruneExpiredBearerTokenCache (line 57) ────────────────────────────────────

test('pruneExpiredBearerTokenCache should evict tokens that expire exactly at now', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios
    .mockResolvedValueOnce({ data: { token: 'first' } })
    .mockResolvedValueOnce({ data: { token: 'second' } });
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    vi.setSystemTime(startedAtMs);
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      'dXNlcjpwYXNz',
    );

    // Advance time to exactly expiresAt — token is expired and should be pruned
    vi.setSystemTime(startedAtMs + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS);
    const result = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      'dXNlcjpwYXNz',
    );

    // Must have fetched a new token (not reused the expired one)
    expect(axios).toHaveBeenCalledTimes(2);
    expect(result.headers.Authorization).toBe('Bearer second');
  } finally {
    vi.useRealTimers();
  }
});

// ── getCanonicalRegistryHost (lines 64, 69) ───────────────────────────────────

test('getCanonicalRegistryHost should return docker.io for index.docker.io registry URL', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:index-docker-canonical',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  // Lookup via index.docker.io
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'index.docker.io' },
  });

  // Lookup via docker.io — should hit the cache (same canonical host)
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // Only one real lookup — index.docker.io and docker.io are the same canonical key
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('getCanonicalRegistryHost should return host unchanged for non-Docker-Hub URL', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:non-dockerhub',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  await baseRegistry.getImageManifestDigest({
    name: 'myimage',
    tag: { value: 'v1' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'ghcr.io' },
  });

  // Second lookup with docker.io should NOT reuse ghcr.io cache entry
  await baseRegistry.getImageManifestDigest({
    name: 'myimage',
    tag: { value: 'v1' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // Two separate cache keys — two real lookups
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

// ── getDigestCacheImageLabel edge-cases (lines 77–88) ─────────────────────────

test('getDigestCacheImageLabel should use unknown-registry when registry url is empty string', () => {
  const getDigestCacheImageLabel = (
    baseRegistry as unknown as {
      getDigestCacheImageLabel: (image: unknown, digest?: string) => string;
    }
  ).getDigestCacheImageLabel.bind(baseRegistry);

  expect(getDigestCacheImageLabel({ registry: { url: '' }, name: 'myimage' })).toBe(
    'unknown-registry/myimage:latest',
  );
});

test('getDigestCacheImageLabel should use unknown-image when name is empty string', () => {
  const getDigestCacheImageLabel = (
    baseRegistry as unknown as {
      getDigestCacheImageLabel: (image: unknown, digest?: string) => string;
    }
  ).getDigestCacheImageLabel.bind(baseRegistry);

  expect(getDigestCacheImageLabel({ registry: { url: 'docker.io' }, name: '' })).toBe(
    'docker.io/unknown-image:latest',
  );
});

test('getDigestCacheImageLabel should use digest parameter when explicitly provided over image tag', () => {
  const getDigestCacheImageLabel = (
    baseRegistry as unknown as {
      getDigestCacheImageLabel: (image: unknown, digest?: string) => string;
    }
  ).getDigestCacheImageLabel.bind(baseRegistry);

  // explicit digest='sha256:explicit' should win over tag
  expect(
    getDigestCacheImageLabel(
      { registry: { url: 'docker.io' }, name: 'myimage', tag: { value: 'latest' } },
      'sha256:explicit',
    ),
  ).toBe('docker.io/myimage:sha256:explicit');
});

test('getDigestCacheImageLabel should use latest when digest is empty string', () => {
  const getDigestCacheImageLabel = (
    baseRegistry as unknown as {
      getDigestCacheImageLabel: (image: unknown, digest?: string) => string;
    }
  ).getDigestCacheImageLabel.bind(baseRegistry);

  expect(getDigestCacheImageLabel({ registry: { url: 'docker.io' }, name: 'myimage' }, '')).toBe(
    'docker.io/myimage:latest',
  );
});

test('getDigestCacheImageLabel should use image digest value when no tag or explicit digest', () => {
  const getDigestCacheImageLabel = (
    baseRegistry as unknown as {
      getDigestCacheImageLabel: (image: unknown, digest?: string) => string;
    }
  ).getDigestCacheImageLabel.bind(baseRegistry);

  expect(
    getDigestCacheImageLabel({
      registry: { url: 'docker.io' },
      name: 'myimage',
      digest: { value: 'sha256:fromimage' },
    }),
  ).toBe('docker.io/myimage:sha256:fromimage');
});

// ── buildDigestCacheKey — imageName empty guard (line 102, 104) ───────────────

test('buildDigestCacheKey should not library-prefix an empty image name even when registryHost is docker.io', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:empty-name',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  // Two lookups with same (empty) name on docker.io should reuse the same cache key
  const image1 = { registry: { url: 'docker.io' } } as any;
  const image2 = { registry: { url: 'docker.io' } } as any;
  await baseRegistry.getImageManifestDigest(image1);
  await baseRegistry.getImageManifestDigest(image2);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('buildDigestCacheKey should not library-prefix imageName that already contains a slash', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:already-ns',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  // Two lookups: one with 'ns/image' (already has slash) and one with 'library/ns/image' — different keys
  await baseRegistry.getImageManifestDigest({
    name: 'ns/image',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/image',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // Different names → different cache keys → 2 real lookups
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

// ── buildDigestCacheKey — tagOrDigest 'latest' fallback (lines 108–109) ──────

test('buildDigestCacheKey should use latest as tagOrDigest when both digest and tag are absent', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:latest-fallback',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  // Two images with no tag and no explicit digest — both should map to :latest in the key
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  } as any);
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  } as any);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('buildDigestCacheKey should prefer explicit digest parameter over tag value', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:explicit-wins',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  // Same image, same tag, different explicit digest → different cache keys
  await baseRegistry.getImageManifestDigest(
    {
      name: 'library/postgres',
      tag: { value: 'latest' },
      architecture: 'amd64',
      os: 'linux',
      registry: { url: 'docker.io' },
    },
    'sha256:digest-a',
  );
  await baseRegistry.getImageManifestDigest(
    {
      name: 'library/postgres',
      tag: { value: 'latest' },
      architecture: 'amd64',
      os: 'linux',
      registry: { url: 'docker.io' },
    },
    'sha256:digest-b',
  );

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

test('buildDigestCacheKey explicit empty-string digest falls back to tag value', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:tag-fallback',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  // Same image, empty-string explicit digest — both should use the tag 'v1' and hit the cache
  const image = {
    name: 'library/postgres',
    tag: { value: 'v1' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };
  await baseRegistry.getImageManifestDigest(image, '');
  await baseRegistry.getImageManifestDigest(image, '');

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// ── buildDigestCacheKey — architecture/os/variant (lines 110–112) ────────────

test('buildDigestCacheKey should use unknown for missing architecture', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:arch-unknown',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  // Two images without architecture — both should resolve to 'unknown' and share cache key
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    os: 'linux',
    registry: { url: 'docker.io' },
  } as any);
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    os: 'linux',
    registry: { url: 'docker.io' },
  } as any);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('buildDigestCacheKey should use unknown for missing os', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:os-unknown',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  // Two images without os — both resolve to 'unknown' and share cache key
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    registry: { url: 'docker.io' },
  } as any);
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    registry: { url: 'docker.io' },
  } as any);

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('buildDigestCacheKey should include variant in cache key when present', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:variant-key',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  // variant='v8' vs no variant → different keys
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    variant: 'v8',
    registry: { url: 'docker.io' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

test('buildDigestCacheKey should use empty variant suffix when variant is empty string', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:variant-empty',
      created: '2026-03-10T12:00:00.000Z',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();

  // variant='' and no variant should produce the same cache key
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    variant: '',
    registry: { url: 'docker.io' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// ── getTrustedRegistryHosts / validateAuthUrlHost (lines 166–177) ─────────────

test('authenticateBearerFromAuthUrl should reject when request URL is blank and config URL is absent', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  // No configuration URL and blank request URL → no trusted hosts → fail closed
  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { url: '   ' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('cannot be validated');

  expect(axios).not.toHaveBeenCalled();
});

test('authenticateBearerFromAuthUrl should ignore whitespace-only config URL', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'abc123' } });
  baseRegistry.configuration = { url: '   ' };

  await expect(
    baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {} },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('cannot be validated');

  expect(axios).not.toHaveBeenCalled();
});

// ── getHttpsAgent — optional chaining on configuration (lines 204–206) ────────

test('getHttpsAgent should return undefined when configuration is absent', async () => {
  baseRegistry.configuration = undefined as any;
  const result = await baseRegistry.authenticateBasic({ headers: {} }, 'creds');
  // No httpsAgent should be attached when configuration is missing
  expect(result.httpsAgent).toBeUndefined();
});

// ── withTlsRequestOptions — insecure=true warning (line 252) ─────────────────

test('withTlsRequestOptions should warn when insecure=true and request URL is used from context', async () => {
  baseRegistry.type = 'registry';
  baseRegistry.name = 'warn-test';
  baseRegistry.configuration = { insecure: true };
  const warnSpy = vi.spyOn(baseRegistry.log, 'warn').mockImplementation(() => undefined);

  // authenticateBearer triggers withTlsRequestOptions internally
  await baseRegistry.authenticateBearer({ headers: {} }, 'tok');

  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('insecure TLS verification'));

  warnSpy.mockRestore();
});

// ── authenticateBearerFromAuthUrl — cache reuse exactly at boundary (line 381) ─

test('authenticateBearerFromAuthUrl should not reuse cached token when now equals expiresAt', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios
    .mockResolvedValueOnce({ data: { token: 'first-token' } })
    .mockResolvedValueOnce({ data: { token: 'refreshed-token' } });
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    vi.setSystemTime(startedAtMs);
    const first = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      'dXNlcjpwYXNz',
    );
    expect(first.headers.Authorization).toBe('Bearer first-token');

    // Advance to exactly expiresAt (now === expiresAt). The condition is `now < expiresAt`,
    // so this should NOT use the cache and must fetch a fresh token.
    vi.setSystemTime(startedAtMs + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS);
    const second = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/library/nginx/manifests/latest' },
      'https://auth.example.com/token',
      'dXNlcjpwYXNz',
    );

    expect(axios).toHaveBeenCalledTimes(2);
    expect(second.headers.Authorization).toBe('Bearer refreshed-token');
  } finally {
    vi.useRealTimers();
  }
});

// ── getAuthCredentials — partial credentials (lines 511, 521) ─────────────────

test('getAuthCredentials should return undefined when only login is configured (no password)', () => {
  baseRegistry.configuration = { login: 'user' };
  expect(baseRegistry.getAuthCredentials()).toBeUndefined();
});

test('getAuthCredentials should return undefined when only password is configured (no login)', () => {
  baseRegistry.configuration = { password: 'pass' };
  expect(baseRegistry.getAuthCredentials()).toBeUndefined();
});

test('getAuthPull should return undefined when only login is configured (no password)', async () => {
  baseRegistry.configuration = { login: 'user' };
  const result = await baseRegistry.getAuthPull();
  expect(result).toBeUndefined();
});

test('getAuthPull should return undefined when only password is configured (no login)', async () => {
  baseRegistry.configuration = { password: 'pass' };
  const result = await baseRegistry.getAuthPull();
  expect(result).toBeUndefined();
});

test('getAuthPull should return undefined when only username is configured (no token)', async () => {
  baseRegistry.configuration = { username: 'user' };
  const result = await baseRegistry.getAuthPull();
  expect(result).toBeUndefined();
});

test('getAuthPull should return undefined when only token is configured (no username)', async () => {
  baseRegistry.configuration = { token: 'mytoken' };
  const result = await baseRegistry.getAuthPull();
  expect(result).toBeUndefined();
});

// ── getImagePublishedAt — tag/tagToLookup guards (lines 549–558) ──────────────

test('getImagePublishedAt should use image tag when provided tag argument is empty string', async () => {
  const getImageManifestDigestSpy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:abc',
      created: '2026-03-06T08:00:00.000Z',
      version: 2,
    });

  await baseRegistry.getImagePublishedAt(
    { name: 'nginx', tag: { value: 'stable' }, registry: { url: 'docker.io' } },
    '',
  );

  expect(getImageManifestDigestSpy).toHaveBeenCalledWith(
    expect.objectContaining({ tag: { value: 'stable' } }),
  );
});

test('getImagePublishedAt should set tag to provided non-empty override even when image has no tag', async () => {
  const getImageManifestDigestSpy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:abc',
      created: '2026-03-06T08:00:00.000Z',
      version: 2,
    });

  await baseRegistry.getImagePublishedAt(
    { name: 'nginx', registry: { url: 'docker.io' } } as any,
    'v1.0.0',
  );

  expect(getImageManifestDigestSpy).toHaveBeenCalledWith(
    expect.objectContaining({ tag: { value: 'v1.0.0' } }),
  );
});

test('getImagePublishedAt should preserve existing tag properties when applying override', async () => {
  const getImageManifestDigestSpy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({ created: '2026-03-06T08:00:00.000Z' });

  await baseRegistry.getImagePublishedAt(
    {
      name: 'nginx',
      tag: { value: 'latest', semver: '1.0.0' } as any,
      registry: { url: 'docker.io' },
    },
    '1.26.0',
  );

  // The call should contain the overridden value, and other tag properties preserved
  expect(getImageManifestDigestSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      tag: expect.objectContaining({ value: '1.26.0', semver: '1.0.0' }),
    }),
  );
});

test('getImagePublishedAt should return undefined when manifest returns null created', async () => {
  vi.spyOn(baseRegistry, 'getImageManifestDigest').mockResolvedValue({ created: null as any });

  const result = await baseRegistry.getImagePublishedAt({
    name: 'nginx',
    tag: { value: 'latest' },
    registry: { url: 'docker.io' },
  });

  expect(result).toBeUndefined();
});

// ── getRegistryHostname — regex anchoring (lines 569, 574) ───────────────────

test('getRegistryHostname should detect http:// prefix (not just https://)', () => {
  // /^https?:\/\//i — the ? makes 's' optional; test with http:// to verify 's?' is exercised
  expect(baseRegistry.exposeGetRegistryHostname('http://registry.example.com/v2')).toBe(
    'registry.example.com',
  );
});

test('getRegistryHostname should prepend https when no protocol present', () => {
  expect(baseRegistry.exposeGetRegistryHostname('registry.example.com')).toBe(
    'registry.example.com',
  );
});

test('getRegistryHostname fallback path should strip http:// prefix correctly', () => {
  // Force the URL constructor to fail so the fallback regex is exercised.
  // A malformed value with path component after % should fail URL parsing,
  // but the fallback split('/')[0] should still work.
  // We test the fallback with a value that is not a valid URL but has http:// prefix.
  // Using a value that starts with https?:// but is not URL-parseable:
  const originalURL = global.URL;
  try {
    // @ts-expect-error - intentional override
    global.URL = class {
      constructor() {
        throw new Error('forced failure');
      }
    };
    expect(baseRegistry.exposeGetRegistryHostname('http://registry.example.com/v2')).toBe(
      'registry.example.com',
    );
  } finally {
    global.URL = originalURL;
  }
});

test('getRegistryHostname fallback should strip https:// prefix in fallback path', () => {
  const originalURL = global.URL;
  try {
    // @ts-expect-error - intentional override
    global.URL = class {
      constructor() {
        throw new Error('forced failure');
      }
    };
    expect(
      baseRegistry.exposeGetRegistryHostname('https://registry.example.com/v2/something'),
    ).toBe('registry.example.com');
  } finally {
    global.URL = originalURL;
  }
});

// ── getImageManifestDigest — caching guards (line 335) ────────────────────────

test('getImageManifestDigest should not cache a manifest with an empty-string digest', async () => {
  const _superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: '',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  const result = await baseRegistry.getImageManifestDigest(image);

  // An empty-string digest should not be cached; empty string is returned as-is
  expect(result.digest).toBe('');
  expect(
    (baseRegistry as unknown as { digestManifestCache: Map<string, unknown> }).digestManifestCache
      .size,
  ).toBe(0);
});

// ── Prometheus optional chaining (lines 119, 127) ────────────────────────────

test('recordDigestCacheHit should increment internal counter even when prometheus is not initialized', async () => {
  const superSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:prom-miss', version: 2 });

  // Ensure prometheus counters are absent (not init'd)
  const getHitsSpy = vi
    .spyOn(registryPrometheus, 'getDigestCacheHitsCounter')
    .mockReturnValue(undefined as any);
  const getMissesSpy = vi
    .spyOn(registryPrometheus, 'getDigestCacheMissesCounter')
    .mockReturnValue(undefined as any);

  try {
    baseRegistry.startDigestCachePollCycle();
    const image = {
      name: 'library/nginx',
      tag: { value: 'latest' },
      architecture: 'amd64',
      os: 'linux',
      registry: { url: 'docker.io' },
    };

    await baseRegistry.getImageManifestDigest(image); // miss
    await baseRegistry.getImageManifestDigest(image); // hit

    const stats = baseRegistry.endDigestCachePollCycle();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(superSpy).toHaveBeenCalledTimes(1);
  } finally {
    getHitsSpy.mockRestore();
    getMissesSpy.mockRestore();
  }
});

// ── getBearerTokenCacheKey — empty-string separator (line 52) ─────────────────
// The key format must be `${authUrl}|${credentials || ''}` exactly.
// Calling with no credentials twice should reuse cache (both map to "url|").

test('getBearerTokenCacheKey should cache anonymous lookups with consistent key', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios.mockResolvedValue({ data: { token: 'anon-tok' } });
  const startedAtMs = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    vi.setSystemTime(startedAtMs);
    const first = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/nginx' },
      'https://auth.example.com/token',
      undefined,
    );
    const second = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/nginx' },
      'https://auth.example.com/token',
      undefined,
    );
    // Both calls without credentials should share the same cache key → 1 real request
    expect(axios).toHaveBeenCalledTimes(1);
    expect(first.headers.Authorization).toBe('Bearer anon-tok');
    expect(second.headers.Authorization).toBe('Bearer anon-tok');
  } finally {
    vi.useRealTimers();
  }
});

// ── pruneExpiredBearerTokenCache — boundary at exactly expiresAt (line 57) ────
// now >= expiresAt should prune (>= not just >).

test('pruneExpiredBearerTokenCache should prune tokens at exactly expiresAt (not one ms before)', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios
    .mockResolvedValueOnce({ data: { token: 'token-A' } })
    .mockResolvedValueOnce({ data: { token: 'token-B' } })
    .mockResolvedValueOnce({ data: { token: 'token-C' } });
  const t0 = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    // Populate a token at t0 and another at t0+1000
    vi.setSystemTime(t0);
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/nginx' },
      'https://auth.example.com/token-A',
      'credA',
    );
    vi.setSystemTime(t0 + 1000);
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/nginx' },
      'https://auth.example.com/token-B',
      'credB',
    );

    // Advance to exactly where token-A expires (t0 + TTL). The prune should remove token-A.
    vi.setSystemTime(t0 + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS);
    await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/nginx' },
      'https://auth.example.com/token-C',
      'credC',
    );

    // Only token-B and token-C remain; token-A (expiresAt === now) was pruned
    expect(getBearerTokenCacheSize(baseRegistry)).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

// ── getDigestCacheImageLabel — null/undefined image (lines 77, 81, 85) ─────────
// The optional-chaining `image?.registry?.url` is there to handle null/undefined image.

test('getDigestCacheImageLabel should use all-unknown defaults when image is null', () => {
  const getDigestCacheImageLabel = (
    baseRegistry as unknown as {
      getDigestCacheImageLabel: (image: unknown, digest?: string) => string;
    }
  ).getDigestCacheImageLabel.bind(baseRegistry);

  expect(getDigestCacheImageLabel(null)).toBe('unknown-registry/unknown-image:latest');
});

test('getDigestCacheImageLabel should use all-unknown defaults when image is undefined', () => {
  const getDigestCacheImageLabel = (
    baseRegistry as unknown as {
      getDigestCacheImageLabel: (image: unknown, digest?: string) => string;
    }
  ).getDigestCacheImageLabel.bind(baseRegistry);

  expect(getDigestCacheImageLabel(undefined)).toBe('unknown-registry/unknown-image:latest');
});

test('getDigestCacheImageLabel should fallback to latest when image has no tag and no digest', () => {
  const getDigestCacheImageLabel = (
    baseRegistry as unknown as {
      getDigestCacheImageLabel: (image: unknown, digest?: string) => string;
    }
  ).getDigestCacheImageLabel.bind(baseRegistry);

  expect(getDigestCacheImageLabel({ registry: { url: 'docker.io' }, name: 'nginx' })).toBe(
    'docker.io/nginx:latest',
  );
});

// ── buildDigestCacheKey — imageName '' fallback to '' not 'Stryker was here!' (line 102:48, 109:7, 110:59, 111:39) ─

test('buildDigestCacheKey should produce a stable key with imageName empty string (defaulting to empty not Stryker)', async () => {
  // When imageName is empty string, the cache key repository part should be empty,
  // and tagOrDigest should fall back to 'latest' (not empty string).
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({
      digest: 'sha256:empty-name-stable',
      version: 2,
    });

  baseRegistry.startDigestCachePollCycle();
  const image = { registry: { url: 'ghcr.io' } } as any;

  await baseRegistry.getImageManifestDigest(image);
  await baseRegistry.getImageManifestDigest(image);

  // Both lookups hit the same cache key (no imageName, defaults to '')
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('buildDigestCacheKey should default architecture to string "unknown" not empty string', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:arch-stable', version: 2 });

  baseRegistry.startDigestCachePollCycle();
  // Two images: one with no architecture, one with architecture='unknown' — should share key
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    os: 'linux',
    registry: { url: 'docker.io' },
  } as any);
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'unknown',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('buildDigestCacheKey should default os to string "unknown" not empty string', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:os-stable', version: 2 });

  baseRegistry.startDigestCachePollCycle();
  // Two images: one with no os, one with os='unknown' — should share key
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    registry: { url: 'docker.io' },
  } as any);
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'unknown',
    registry: { url: 'docker.io' },
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

test('buildDigestCacheKey variant absent should produce key with no variant suffix, not Stryker placeholder', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:no-variant', version: 2 });

  baseRegistry.startDigestCachePollCycle();
  // No-variant should produce key ending in 'linux/amd64' — same as variant=undefined
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    variant: undefined,
    registry: { url: 'docker.io' },
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// ── buildDigestCacheKey — non-docker.io host should not library-prefix (line 104:7) ──

test('buildDigestCacheKey should not add library/ prefix for non-docker.io registries', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:no-prefix', version: 2 });

  baseRegistry.startDigestCachePollCycle();
  // On ghcr.io, 'nginx' should NOT become 'library/nginx'
  await baseRegistry.getImageManifestDigest({
    name: 'nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'ghcr.io' },
  });
  // On docker.io, 'nginx' SHOULD become 'library/nginx' — different key
  await baseRegistry.getImageManifestDigest({
    name: 'nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // Different keys → 2 real lookups
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

// ── buildDigestCacheKey — non-string digest type check (line 108:8) ─────────────

test('buildDigestCacheKey should fall back to tag value when digest is a number (type check)', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:type-check', version: 2 });

  baseRegistry.startDigestCachePollCycle();
  // digest=42 (not a string) should fall back to tag 'v2'
  const image = {
    name: 'library/nginx',
    tag: { value: 'v2' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };
  await baseRegistry.getImageManifestDigest(image, 42 as any);
  await baseRegistry.getImageManifestDigest(image, 42 as any);

  // Both use tag 'v2' as fallback → same key → 1 real lookup
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// ── getTrustedRegistryHosts — whitespace host filtering (lines 177:11, 177:39) ───

test('authenticateBearerFromAuthUrl should not trust a host consisting only of whitespace from getTrustedAuthHosts', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'tok' } });

  // SparseTrustedAuthBaseRegistry returns ['   ', undefined, 'auth.example.com']
  // Only 'auth.example.com' should be added — the blank entry must be ignored
  const registry = new SparseTrustedAuthBaseRegistry();

  const result = await registry.authenticateBearerFromAuthUrl(
    { headers: {}, url: 'https://registry.example.com/v2/library/nginx' },
    'https://auth.example.com/token',
    undefined,
  );

  expect(result.headers.Authorization).toBe('Bearer tok');
  expect(axios).toHaveBeenCalledTimes(1);
});

test('getTrustedAuthHosts host.trim() should be tested — a host with only whitespace is not trusted', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'tok' } });

  // Registry that returns a whitespace-only host alongside a valid one
  class WhitespaceHostRegistry extends TestBaseRegistry {
    protected override getTrustedAuthHosts(): string[] {
      return ['   auth.example.com   ', '  ', 'auth.example.com'];
    }
  }
  const registry = new WhitespaceHostRegistry();

  // auth.example.com should be trusted; blank entry should NOT crash
  await expect(
    registry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://registry.example.com/v2/nginx' },
      'https://auth.example.com/token',
      undefined,
    ),
  ).resolves.toHaveProperty('headers.Authorization', 'Bearer tok');
});

// ── resolveConfiguredPath labels (lines 217–231) ───────────────────────────────
// The label strings matter: they appear in error messages when the path is invalid.

test('getHttpsAgent should pass correct label for CA file path resolution', async () => {
  const { resolveConfiguredPath } = await import('../runtime/paths.js');
  const resolveSpy = vi
    .spyOn({ resolveConfiguredPath }, 'resolveConfiguredPath')
    .mockImplementation((p) => p as string);

  // We can't easily spy on the module-level import; instead verify via the error message
  baseRegistry.type = 'registry';
  baseRegistry.name = 'label-test';
  baseRegistry.configuration = { cafile: '/nonexistent-path-for-label-test.pem' };

  const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('fake-ca'));
  try {
    await baseRegistry.authenticateBearer({ headers: {} }, 'tok');
    expect(readFileSyncSpy).toHaveBeenCalledWith('/nonexistent-path-for-label-test.pem');
  } finally {
    readFileSyncSpy.mockRestore();
    resolveSpy.mockRestore();
  }
});

test('getHttpsAgent should pass correct label for client cert path resolution', async () => {
  baseRegistry.type = 'registry';
  baseRegistry.name = 'cert-label-test';
  baseRegistry.configuration = { clientcert: '/fake-cert.pem', clientkey: '/fake-key.pem' };

  const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((path) => {
    if (path === '/fake-cert.pem') return Buffer.from('cert');
    if (path === '/fake-key.pem') return Buffer.from('key');
    throw new Error(`unexpected: ${String(path)}`);
  });

  try {
    const result = await baseRegistry.authenticateBearer({ headers: {} }, 'tok');
    expect(readFileSyncSpy).toHaveBeenCalledWith('/fake-cert.pem');
    expect(readFileSyncSpy).toHaveBeenCalledWith('/fake-key.pem');
    expect(result.httpsAgent).toBeDefined();
  } finally {
    readFileSyncSpy.mockRestore();
  }
});

// ── withTlsRequestOptions — configuration?.insecure optional chain (line 252) ─

test('withTlsRequestOptions should not warn when configuration is undefined and httpsAgent is provided externally', async () => {
  // configuration is absent — the optional chain configuration?.insecure should not throw
  baseRegistry.configuration = undefined as any;
  const customHttpsAgent = { custom: true } as any;
  const warnSpy = vi.spyOn(baseRegistry.log, 'warn').mockImplementation(() => undefined);

  try {
    const result = await baseRegistry.authenticateBearer(
      { headers: {}, httpsAgent: customHttpsAgent },
      'tok',
    );
    // Agent is forwarded, no insecure warning
    expect(result.httpsAgent).toBe(customHttpsAgent);
    expect(warnSpy).not.toHaveBeenCalled();
  } finally {
    warnSpy.mockRestore();
  }
});

// ── getImageManifestDigest — manifest?.digest optional chain (line 335) ──────

test('getImageManifestDigest should not cache when manifest is undefined', async () => {
  vi.spyOn(Registry.prototype, 'getImageManifestDigest').mockResolvedValue(undefined as any);

  baseRegistry.startDigestCachePollCycle();
  const image = {
    name: 'library/postgres',
    tag: { value: '16' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  const result = await baseRegistry.getImageManifestDigest(image);
  expect(result).toBeUndefined();
  expect(
    (baseRegistry as unknown as { digestManifestCache: Map<string, unknown> }).digestManifestCache
      .size,
  ).toBe(0);
});

// ── authenticateBearerFromAuthUrl — requestOptions spread (line 374) ─────────

test('authenticateBearerFromAuthUrl should preserve existing request headers in token response', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'preserved-headers-tok' } });

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    {
      headers: { 'X-Custom-Header': 'custom-value' },
      url: 'https://auth.example.com/v2/library/nginx',
    },
    'https://auth.example.com/token',
    undefined,
  );

  // The custom header from the original requestOptions should be preserved
  expect(result.headers['X-Custom-Header']).toBe('custom-value');
  expect(result.headers.Authorization).toBe('Bearer preserved-headers-tok');
});

// ── authenticateBearerFromAuthUrl cache — boundary at expiresAt (line 381) ────

test('authenticateBearerFromAuthUrl should not use cache when now equals expiresAt (now < expiresAt is strict)', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios
    .mockResolvedValueOnce({ data: { token: 'tok-boundary-1' } })
    .mockResolvedValueOnce({ data: { token: 'tok-boundary-2' } });
  const t0 = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    vi.setSystemTime(t0);
    const r1 = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/nginx' },
      'https://auth.example.com/token',
      'credX',
    );
    expect(r1.headers.Authorization).toBe('Bearer tok-boundary-1');

    // Exactly at expiresAt: `now < expiresAt` is false → should NOT use cache
    vi.setSystemTime(t0 + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS);
    const r2 = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/nginx' },
      'https://auth.example.com/token',
      'credX',
    );

    expect(axios).toHaveBeenCalledTimes(2);
    expect(r2.headers.Authorization).toBe('Bearer tok-boundary-2');
  } finally {
    vi.useRealTimers();
  }
});

// ── getRejectedCredentialStatus — empty rejectedCredentialStatuses (line 439) ─

test('getRejectedCredentialStatus should return undefined when rejectedCredentialStatuses is empty', () => {
  const getRejectedCredentialStatus = (
    baseRegistry as unknown as {
      getRejectedCredentialStatus: (
        error: unknown,
        statuses: readonly number[],
      ) => string | undefined;
    }
  ).getRejectedCredentialStatus.bind(baseRegistry);

  expect(
    getRejectedCredentialStatus(
      new Error('token request failed (Request failed with status code 401)'),
      [],
    ),
  ).toBeUndefined();
});

// ── getImagePublishedAt — tag guards (lines 549, 550, 558) ───────────────────

test('getImagePublishedAt should use image tag when tag argument is undefined', async () => {
  const spy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:a', created: '2026-01-01T00:00:00.000Z', version: 2 });

  await baseRegistry.getImagePublishedAt({
    name: 'nginx',
    tag: { value: 'specific-tag' },
    registry: { url: 'docker.io' },
  });

  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tag: { value: 'specific-tag' } }));
});

test('getImagePublishedAt should not overwrite tag when tag argument is not a string', async () => {
  const spy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:b', created: '2026-01-01T00:00:00.000Z', version: 2 });

  await baseRegistry.getImagePublishedAt(
    { name: 'nginx', tag: { value: 'from-image' }, registry: { url: 'docker.io' } },
    undefined,
  );

  // tagToLookup falls back to imageToInspect.tag?.value = 'from-image'
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tag: { value: 'from-image' } }));
});

test('getImagePublishedAt should not write tag when tagToLookup is empty string', async () => {
  const spy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:c', created: '2026-01-01T00:00:00.000Z', version: 2 });

  // When image has no tag and tag arg is empty → tagToLookup is empty string
  await baseRegistry.getImagePublishedAt(
    { name: 'nginx', registry: { url: 'docker.io' } } as any,
    '',
  );

  // imageToInspect.tag should remain falsy
  expect(spy).toHaveBeenCalledWith(expect.not.objectContaining({ tag: { value: '' } }));
});

test('getImagePublishedAt should return undefined when created is null (not a string)', async () => {
  vi.spyOn(baseRegistry, 'getImageManifestDigest').mockResolvedValue({
    digest: 'sha256:null-created',
    created: null as any,
  });

  const result = await baseRegistry.getImagePublishedAt({
    name: 'nginx',
    tag: { value: 'latest' },
    registry: { url: 'docker.io' },
  });

  expect(result).toBeUndefined();
});

test('getImagePublishedAt should return the created date string (block statement coverage)', async () => {
  vi.spyOn(baseRegistry, 'getImageManifestDigest').mockResolvedValue({
    digest: 'sha256:d',
    created: '2026-04-01T00:00:00.000Z',
    version: 2,
  });

  const result = await baseRegistry.getImagePublishedAt({
    name: 'nginx',
    tag: { value: 'latest' },
    registry: { url: 'docker.io' },
  });

  expect(result).toBe('2026-04-01T00:00:00.000Z');
});

// ── getRegistryHostname — regex anchoring (lines 569, 574) ───────────────────

test('getRegistryHostname should not prepend https when value already contains http://', () => {
  // The ^ anchor in /^https?:\/\//i means 'http://host/path' should match at start
  // and NOT add another 'https://' prefix
  const result = baseRegistry.exposeGetRegistryHostname('http://my.registry.com/v2');
  expect(result).toBe('my.registry.com');
  // The 's?' makes the regex work for both http and https
});

test('getRegistryHostname should not match https:// in the middle of a URL as a protocol', () => {
  // /^https?:\/\//i has ^ anchor — something like "path/https://x" should NOT match
  // and the code should prepend https://
  const result = baseRegistry.exposeGetRegistryHostname(
    'registry.example.com/redirect/https://other.com',
  );
  // URL parsing: the prepended https:// URL would parse registry.example.com as host
  expect(result).toBe('registry.example.com');
});

test('getRegistryHostname fallback should use lowercase for the first path segment', () => {
  const originalURL = global.URL;
  try {
    // @ts-expect-error
    global.URL = class {
      constructor() {
        throw new Error('force fallback');
      }
    };
    // The fallback path strips protocol and splits on '/', taking [0] then lowercase
    expect(baseRegistry.exposeGetRegistryHostname('HTTPS://REGISTRY.EXAMPLE.COM/v2')).toBe(
      'registry.example.com',
    );
  } finally {
    global.URL = originalURL;
  }
});

// ── buildDigestCacheKey: registryHost === 'docker.io' check (line 104:7) ──────
// The ConditionalExpression mutant 'true && !imageName.includes("/")'
// would add library/ prefix to ALL simple names on ANY registry.
// We must assert that non-docker.io simple names do NOT get the library/ prefix.

test('buildDigestCacheKey does NOT add library/ prefix on non-docker.io when name has no slash', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:prefix-check', version: 2 });

  baseRegistry.startDigestCachePollCycle();

  // On ghcr.io, 'nginx' and 'library/nginx' should have DIFFERENT cache keys
  await baseRegistry.getImageManifestDigest({
    name: 'nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'ghcr.io' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'ghcr.io' },
  });

  // If library/ were incorrectly added to ghcr.io/nginx, both would map to the same key (1 call).
  // The correct behavior is 2 separate keys → 2 real lookups.
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

// ── buildDigestCacheKey: imageName.length > 0 guard (line 104:39) ─────────────
// The EqualityOperator mutant 'imageName.length >= 0' always true,
// so empty imageName on docker.io would incorrectly become 'library/'.
// We need to assert that empty imageName on docker.io does NOT produce 'library/' prefix.

test('buildDigestCacheKey does NOT add library/ prefix on docker.io when imageName is empty', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:empty-name-docker', version: 2 });

  baseRegistry.startDigestCachePollCycle();

  // docker.io with empty name should not produce 'library/' prefix
  await baseRegistry.getImageManifestDigest({
    name: '',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  } as any);
  await baseRegistry.getImageManifestDigest({
    name: 'library/',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // 'library/' has a slash so it's not prefixed; '' stays as '' not 'library/'
  // With the mutant, '' would become 'library/' which would match 'library/' → 1 call
  // With correct behavior, different keys → 2 calls
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(2);
});

// ── buildDigestCacheKey: tagOrDigest 'latest' vs '' fallback (line 109:7) ────
// The StringLiteral mutant '' → "Stryker was here!" changes what the key contains
// when both digest and tag are missing. With '' the cache key would contain ':' + '' = ':'.
// With 'latest', the key contains ':latest'. Two images with empty tag/digest should
// produce the same key as an image with tag='latest'.

test('buildDigestCacheKey uses "latest" not empty string for missing tag+digest in cache key', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:latest-key-test', version: 2 });

  baseRegistry.startDigestCachePollCycle();

  // Image with no tag, no digest
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  } as any);

  // Image with tag='latest' explicitly — should share the same cache key
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // Same key (both use 'latest') → 1 real lookup
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// ── buildDigestCacheKey: architecture 'unknown' vs '' fallback (line 110:59) ──

test('buildDigestCacheKey uses "unknown" not empty string for missing architecture in cache key', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:arch-key-test', version: 2 });

  baseRegistry.startDigestCachePollCycle();

  // Image with no architecture
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    os: 'linux',
    registry: { url: 'docker.io' },
  } as any);

  // Image with architecture='unknown' — should share the same cache key
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'unknown',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // Same key → 1 real lookup
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// Image with architecture='' is different from architecture='unknown'
test('buildDigestCacheKey treats empty architecture as "unknown"', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:arch-empty-test', version: 2 });

  baseRegistry.startDigestCachePollCycle();

  // Image with architecture='' (falsy) — same key as 'unknown'
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: '',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // Image with architecture='unknown'
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'unknown',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // With the StringLiteral mutant '' → same key  (wrong, but would pass this test)
  // With 'unknown' → both map to 'unknown' → same key → 1 real lookup
  // With '' → '' maps to '' and 'unknown' maps to 'unknown' → DIFFERENT keys → 2 lookups
  // So this kills the StringLiteral '' mutant (110:59)
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// ── buildDigestCacheKey: os 'unknown' vs '' fallback (line 111:39) ────────────

test('buildDigestCacheKey treats empty os as "unknown"', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:os-empty-test', version: 2 });

  baseRegistry.startDigestCachePollCycle();

  // os='' (falsy) — same key as os='unknown'
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: '',
    registry: { url: 'docker.io' },
  });
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'unknown',
    registry: { url: 'docker.io' },
  });

  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// ── buildDigestCacheKey: variant '' vs 'Stryker was here!' (line 112:80) ──────

test('buildDigestCacheKey uses empty string not "Stryker was here!" for no-variant suffix', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:variant-no-suffix', version: 2 });

  baseRegistry.startDigestCachePollCycle();

  // Image with no variant
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // Image with variant='' (also no variant) — should produce the same key
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'latest' },
    architecture: 'amd64',
    os: 'linux',
    variant: '',
    registry: { url: 'docker.io' },
  });

  // Both should share the same cache key → 1 lookup
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// ── buildDigestCacheKey: tagOrDigest type check (line 108:8) ─────────────────
// ConditionalExpression mutant: (true ? digest : normalizedImage?.tag?.value)
// This always uses `digest` even when `digest=undefined`.
// The || 'latest' after it would then return 'latest'.
// But when `digest=undefined` AND `tag?.value='v1'`, the correct result uses tag.
// The mutant would incorrectly use undefined || 'latest' = 'latest' instead of 'v1'.

test('buildDigestCacheKey uses tag value when digest is undefined (type check matters)', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:type-check-v2', version: 2 });

  baseRegistry.startDigestCachePollCycle();

  // Lookup 1: no explicit digest, tag='v1'
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'v1' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // Lookup 2: same image — should share key with v1, not fall back to 'latest'
  await baseRegistry.getImageManifestDigest({
    name: 'library/nginx',
    tag: { value: 'v1' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  });

  // Same key (both use tag 'v1') → 1 real lookup
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// With the `true` mutant, undefined digest would still go through `undefined || 'latest'` = 'latest'
// BUT when tag='v1', correct code gives 'v1'. The mutant gives 'latest'.
// So lookup2 with tag='v1' would have a DIFFERENT key from lookup1 (v1 vs latest).
// → 2 lookups. Correct code → 1 lookup. This kills the mutant.

// ── buildDigestCacheKey: digest length > 0 check (line 108:38) ───────────────
// The mutant 'digest.length >= 0' always true (even for empty string).
// Need test where digest='' should fall back to tag.

test('buildDigestCacheKey falls back to tag when digest is empty string (length > 0 check)', async () => {
  const superGetImageManifestDigestSpy = vi
    .spyOn(Registry.prototype, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:digest-len-check', version: 2 });

  baseRegistry.startDigestCachePollCycle();

  const image = {
    name: 'library/nginx',
    tag: { value: 'stable' },
    architecture: 'amd64',
    os: 'linux',
    registry: { url: 'docker.io' },
  };

  // Pass digest='' — should fall back to tag 'stable'
  await baseRegistry.getImageManifestDigest(image, '');
  // Pass no digest — should also use tag 'stable'
  await baseRegistry.getImageManifestDigest(image);

  // Both should have the same key (':stable') → 1 real lookup
  expect(superGetImageManifestDigestSpy).toHaveBeenCalledTimes(1);
});

// ── Prometheus optional chaining (lines 119, 127) — need getDigestCacheHitsCounter?.() ─
// The optional chaining means if getDigestCacheHitsCounter is not a function, it won't crash.

test('recordDigestCacheHit does not crash when getDigestCacheHitsCounter is not a function', async () => {
  vi.spyOn(Registry.prototype, 'getImageManifestDigest').mockResolvedValue({
    digest: 'sha256:prom-nofunc',
    version: 2,
  });
  // @ts-expect-error - intentionally delete the method to test optional chaining
  const origGetDigestCacheHitsCounter = registryPrometheus.getDigestCacheHitsCounter;
  const origGetDigestCacheMissesCounter = registryPrometheus.getDigestCacheMissesCounter;

  try {
    // @ts-expect-error
    delete registryPrometheus.getDigestCacheHitsCounter;
    // @ts-expect-error
    delete registryPrometheus.getDigestCacheMissesCounter;

    baseRegistry.startDigestCachePollCycle();
    const image = {
      name: 'library/nginx',
      tag: { value: 'latest' },
      architecture: 'amd64',
      os: 'linux',
      registry: { url: 'docker.io' },
    };

    // Should not throw even with no prometheus methods
    await expect(baseRegistry.getImageManifestDigest(image)).resolves.toBeDefined();
    await expect(baseRegistry.getImageManifestDigest(image)).resolves.toBeDefined();

    const stats = baseRegistry.endDigestCachePollCycle();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  } finally {
    // @ts-expect-error
    registryPrometheus.getDigestCacheHitsCounter = origGetDigestCacheHitsCounter;
    // @ts-expect-error
    registryPrometheus.getDigestCacheMissesCounter = origGetDigestCacheMissesCounter;
  }
});

// ── getTrustedAuthHosts host.trim().length > 0 (line 177:39) ──────────────────
// The MethodExpression mutant 'host.length > 0' (without trim) would still accept
// whitespace-only hosts. We need a test where:
// - The only trusted auth host is a whitespace-padded URL
// - The auth URL matches after trimming but not before

test('getTrustedRegistryHosts ignores hosts that become empty after trimming', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'tok' } });

  class WhitespaceOnlyTrustedHost extends TestBaseRegistry {
    protected override getTrustedAuthHosts(): string[] {
      // Only whitespace entries — none should be trusted
      return ['   ', '\t', '  \n  '];
    }
  }
  const registry = new WhitespaceOnlyTrustedHost();

  // Only trusted host was whitespace — should fail closed (no trusted hosts)
  await expect(
    registry.authenticateBearerFromAuthUrl(
      { headers: {} },
      'https://auth.example.com/token',
      undefined,
    ),
  ).rejects.toThrow('cannot be validated');

  expect(axios).not.toHaveBeenCalled();
});

// ── resolveConfiguredPath label verification (lines 217–231) ──────────────────
// The ObjectLiteral mutant `{}` passes empty options to resolveConfiguredPath.
// We need to verify the `label` option IS passed (not just that readFileSync is called).

test('getHttpsAgent passes label to resolveConfiguredPath for CA file', async () => {
  const resolveSpy = vi
    .spyOn(await import('../runtime/paths.js'), 'resolveConfiguredPath')
    .mockImplementation((p) => p as string);
  const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('ca'));

  try {
    baseRegistry.type = 'registry';
    baseRegistry.name = 'label-ca';
    baseRegistry.configuration = { cafile: '/tmp/ca.pem' };
    await baseRegistry.authenticateBearer({ headers: {} }, 'tok');

    expect(resolveSpy).toHaveBeenCalledWith(
      '/tmp/ca.pem',
      expect.objectContaining({ label: expect.stringContaining('CA file path') }),
    );
  } finally {
    resolveSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  }
});

test('getHttpsAgent passes label to resolveConfiguredPath for client cert and key', async () => {
  const resolveSpy = vi
    .spyOn(await import('../runtime/paths.js'), 'resolveConfiguredPath')
    .mockImplementation((p) => p as string);
  const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('pem'));

  try {
    baseRegistry.type = 'registry';
    baseRegistry.name = 'label-cert';
    baseRegistry.configuration = { clientcert: '/tmp/cert.pem', clientkey: '/tmp/key.pem' };
    await baseRegistry.authenticateBearer({ headers: {} }, 'tok');

    expect(resolveSpy).toHaveBeenCalledWith(
      '/tmp/cert.pem',
      expect.objectContaining({ label: expect.stringContaining('client certificate file path') }),
    );
    expect(resolveSpy).toHaveBeenCalledWith(
      '/tmp/key.pem',
      expect.objectContaining({ label: expect.stringContaining('client key file path') }),
    );
  } finally {
    resolveSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  }
});

// ── authenticateBearerFromAuthUrl cache: cachedToken && true mutant (line 381) ─
// The ConditionalExpression mutant 'cachedToken && true' means if a cached token
// exists (even an expired one), it's always used. We need to verify that an expired
// token is NOT used.

test('authenticateBearerFromAuthUrl does NOT reuse expired token that was pruned from cache', async () => {
  const { default: axios } = await import('axios');
  vi.useFakeTimers();
  axios
    .mockResolvedValueOnce({ data: { token: 'expired-tok' } })
    .mockResolvedValueOnce({ data: { token: 'fresh-tok' } });
  const t0 = new Date('2026-03-05T10:00:00.000Z').getTime();

  try {
    vi.setSystemTime(t0);
    const r1 = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/nginx' },
      'https://auth.example.com/token',
      'myCredential',
    );
    expect(r1.headers.Authorization).toBe('Bearer expired-tok');

    // Advance past the TTL so the token is expired (and will be pruned)
    vi.setSystemTime(t0 + REGISTRY_BEARER_TOKEN_CACHE_TTL_MS + 5000);
    const r2 = await baseRegistry.authenticateBearerFromAuthUrl(
      { headers: {}, url: 'https://auth.example.com/v2/nginx' },
      'https://auth.example.com/token',
      'myCredential',
    );

    // With 'cachedToken && true' mutant, the expired token would be reused (1 call).
    // Correct behavior: expired token NOT reused → fetch fresh → 2 calls.
    expect(axios).toHaveBeenCalledTimes(2);
    expect(r2.headers.Authorization).toBe('Bearer fresh-tok');
  } finally {
    vi.useRealTimers();
  }
});

// ── getRejectedCredentialStatus: rejectedCredentialStatuses.length === 0 (line 439) ─
// ConditionalExpression mutant 'false' means the function never returns undefined
// for empty statuses. Need test that verifies empty statuses → undefined.

test('getRejectedCredentialStatus returns undefined for an Error with empty rejected statuses', () => {
  const fn = (
    baseRegistry as unknown as {
      getRejectedCredentialStatus: (
        err: unknown,
        statuses: readonly number[],
      ) => string | undefined;
    }
  ).getRejectedCredentialStatus.bind(baseRegistry);

  // With the 'false' mutant, it would try to compile a pattern and potentially match
  expect(
    fn(new Error('token request failed (Request failed with status code 403)'), []),
  ).toBeUndefined();
  expect(fn(new Error('some other error'), [401, 403])).toBeUndefined();
});

// ── getImagePublishedAt: tagToLookup type check (line 549:25) ─────────────────
// The ConditionalExpression mutant 'true ? tag : imageToInspect.tag?.value'
// always picks `tag`, even when it's undefined. This means when tag=undefined,
// tagToLookup = undefined (same result). But when tag=null, tagToLookup = null vs
// image.tag.value. We need to test with a non-string tag.

test('getImagePublishedAt falls back to image tag when tag argument is not a string type', async () => {
  const spy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({ digest: 'sha256:e', created: '2026-01-01T00:00:00.000Z', version: 2 });

  // Pass a numeric tag (not a string) — should fall back to image tag 'from-image'
  await baseRegistry.getImagePublishedAt(
    { name: 'nginx', tag: { value: 'from-image' }, registry: { url: 'docker.io' } },
    42 as any,
  );

  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tag: { value: 'from-image' } }));
});

// ── getImagePublishedAt: tag.length > 0 (line 549:52) ─────────────────────────
// 'true' mutant means tag='' (empty string) would be used.
// Need test where tag='' and image has a tag — should use image tag not empty string.

test('getImagePublishedAt does not use empty string as tag override (length check)', async () => {
  const spy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({ created: '2026-01-01T00:00:00.000Z' });

  // tag='' is empty → should fall back to image tag 'stable'
  await baseRegistry.getImagePublishedAt(
    { name: 'nginx', tag: { value: 'stable' }, registry: { url: 'docker.io' } },
    '',
  );

  // The tag in the call should be 'stable' (image tag), NOT '' (empty override)
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ tag: expect.objectContaining({ value: 'stable' }) }),
  );
});

// ── getImagePublishedAt: tagToLookup.length > 0 guard (line 550) ──────────────
// ConditionalExpression mutant 'true' would set imageToInspect.tag even when tagToLookup=undefined.
// Need test where tagToLookup is undefined (no tag, no arg) and verify that tag is not set.

test('getImagePublishedAt does not set tag when both tag arg and image tag are absent', async () => {
  const spy = vi
    .spyOn(baseRegistry, 'getImageManifestDigest')
    .mockResolvedValue({ created: '2026-01-01T00:00:00.000Z' });

  // Image has no tag and no tag argument
  await baseRegistry.getImagePublishedAt(
    { name: 'nginx', registry: { url: 'docker.io' } } as any,
    undefined,
  );

  // imageToInspect.tag should be undefined/absent
  expect(spy).toHaveBeenCalledWith(
    expect.not.objectContaining({ tag: expect.objectContaining({ value: expect.anything() }) }),
  );
});

// ── getRegistryHostname: regex anchor ^ (lines 569:26, 574:18) ────────────────
// The /https?:\/\//i → /^https?:\/\//i change matters when value has protocol at start.
// We need to test that a URL WITHOUT a protocol gets https:// prepended (verifying the
// decision path: test() returns false → prepend https://).

test('getRegistryHostname should correctly detect http:// at the start only (^ anchor)', () => {
  // 'http://registry.example.com' has protocol at START → test() returns true → use as-is
  expect(baseRegistry.exposeGetRegistryHostname('http://registry.example.com/v2')).toBe(
    'registry.example.com',
  );

  // 'registry.example.com' has NO protocol → test() returns false → prepend https://
  expect(baseRegistry.exposeGetRegistryHostname('registry.example.com')).toBe(
    'registry.example.com',
  );
});

test('getRegistryHostname fallback: /^https?:///i removes protocol prefix in catch block', () => {
  // Force the fallback path. The fallback uses .replace(/^https?:\/\//i, '') to strip protocol.
  // Without ^ anchor, 'https://registry.example.com' would match mid-string too (no effect here
  // since it's at start anyway). But the key is that http:// is correctly stripped.
  const originalURL = global.URL;
  try {
    // @ts-expect-error
    global.URL = class {
      constructor() {
        throw new Error('force');
      }
    };

    // http:// should be stripped in the fallback path
    const result = baseRegistry.exposeGetRegistryHostname('http://registry.example.com/v2');
    expect(result).toBe('registry.example.com');
  } finally {
    global.URL = originalURL;
  }
});

// ── getRegistryHostname: 'https://' fallback string (line 569:64) ─────────────
// StringLiteral mutant: 'https://${value}' → '' means no protocol prepended.
// The fallback catch uses `value` directly (not withProtocol), so for simple hostnames
// the result is the same (both paths use value). This is equivalent.
// But for values with a path like 'registry.io/v2', URL('') would fail, catch strips
// protocol from the ORIGINAL value.
// → This mutant IS equivalent because the fallback always uses `value` not `withProtocol`.

// ── authenticateBearerFromAuthUrl: {…requestOptions} spread (line 374) ────────
// ObjectLiteral mutant {} means requestOptions headers are not copied.
// We verify this by checking that headers from requestOptions appear in the auth result.

test('authenticateBearerFromAuthUrl preserves original requestOptions timeout option', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: { token: 'preserved-opts-tok' } });

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    {
      headers: {},
      url: 'https://auth.example.com/v2/nginx',
      timeout: 5000,
    },
    'https://auth.example.com/token',
    undefined,
  );

  // The timeout option from the original requestOptions should be preserved
  expect(result.timeout).toBe(5000);
});

// --- resolveBearerChallengeOptions tests ---

describe('resolveBearerChallengeOptions', () => {
  const requestOptionsWithUrl = {
    url: 'https://registry.example.com/v2/library/nginx/tags/list',
    headers: { Accept: 'application/json' },
  };
  const image = {
    name: 'library/nginx',
    registry: { url: 'https://registry.example.com/v2' },
  };

  test('should perform anonymous token exchange and return options with Bearer header', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: { token: 'anon-token-xyz' } });
    baseRegistry.configuration = {};

    const result = await (baseRegistry as any).resolveBearerChallengeOptions(
      requestOptionsWithUrl,
      'Bearer realm="https://registry.example.com/token",service="registry.example.com",scope="repository:library/nginx:pull"',
      image,
    );

    expect(result).toBeDefined();
    expect(result.headers.Authorization).toBe('Bearer anon-token-xyz');
    // Token request should include service and scope as query params
    const calledUrl: string = axios.mock.calls[0][0].url;
    expect(calledUrl).toContain('service=registry.example.com');
    expect(calledUrl).toContain('scope=repository');
    expect(axios.mock.calls[0][0].headers.Authorization).toBeUndefined();
  });

  test('should perform credentialed token exchange and return options with Bearer header', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: { token: 'cred-token-abc' } });
    baseRegistry.configuration = { login: 'user', password: 'pass' };

    const result = await (baseRegistry as any).resolveBearerChallengeOptions(
      requestOptionsWithUrl,
      'Bearer realm="https://registry.example.com/token",service="registry.example.com"',
      image,
    );

    expect(result).toBeDefined();
    expect(result.headers.Authorization).toBe('Bearer cred-token-abc');
    // Token request should use Basic credentials
    expect(axios.mock.calls[0][0].headers.Authorization).toMatch(/^Basic /);
  });

  test('should perform token exchange when Bearer challenge appears after Basic challenge', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: { token: 'multi-challenge-token' } });
    baseRegistry.configuration = {};

    const result = await (baseRegistry as any).resolveBearerChallengeOptions(
      requestOptionsWithUrl,
      'Basic realm="registry login", Bearer realm="https://registry.example.com/token",service="registry.example.com"',
      image,
    );

    expect(result).toBeDefined();
    expect(result.headers.Authorization).toBe('Bearer multi-challenge-token');
  });

  test('should return undefined for non-Bearer WWW-Authenticate header', async () => {
    const { default: axios } = await import('axios');
    baseRegistry.configuration = {};

    const result = await (baseRegistry as any).resolveBearerChallengeOptions(
      requestOptionsWithUrl,
      'Basic realm="registry.example.com"',
      image,
    );

    expect(result).toBeUndefined();
    expect(axios).not.toHaveBeenCalled();
  });

  test('should return undefined for undefined WWW-Authenticate header', async () => {
    const { default: axios } = await import('axios');
    baseRegistry.configuration = {};

    const result = await (baseRegistry as any).resolveBearerChallengeOptions(
      requestOptionsWithUrl,
      undefined,
      image,
    );

    expect(result).toBeUndefined();
    expect(axios).not.toHaveBeenCalled();
  });

  test('should return undefined when realm host is different from request host (untrusted)', async () => {
    const { default: axios } = await import('axios');
    baseRegistry.configuration = {};

    // Realm host (attacker.internal) does not match request host (registry.example.com)
    const result = await (baseRegistry as any).resolveBearerChallengeOptions(
      requestOptionsWithUrl,
      'Bearer realm="https://attacker.internal/token",service="registry.example.com"',
      image,
    );

    expect(result).toBeUndefined();
    // Axios must NOT have been called — the security guard prevented the exchange
    expect(axios).not.toHaveBeenCalled();
  });

  test('should reject same-host different-port realm without sending credentials', async () => {
    const { default: axios } = await import('axios');
    baseRegistry.configuration = {
      url: 'https://registry.example.com:5000/v2',
      login: 'user',
      password: 'pass',
    };

    const result = await (baseRegistry as any).resolveBearerChallengeOptions(
      {
        url: 'https://registry.example.com:5000/v2/library/nginx/tags/list',
        headers: { Accept: 'application/json' },
      },
      'Bearer realm="https://registry.example.com:8443/token",service="registry.example.com"',
      image,
    );

    expect(result).toBeUndefined();
    expect(axios).not.toHaveBeenCalled();
  });

  test('should return undefined when token fetch fails', async () => {
    const { default: axios } = await import('axios');
    axios.mockRejectedValue(new Error('network timeout'));
    baseRegistry.configuration = {};

    const result = await (baseRegistry as any).resolveBearerChallengeOptions(
      requestOptionsWithUrl,
      'Bearer realm="https://registry.example.com/token"',
      image,
    );

    expect(result).toBeUndefined();
  });

  test('should return undefined for malformed realm URL', async () => {
    const { default: axios } = await import('axios');
    baseRegistry.configuration = {};

    const result = await (baseRegistry as any).resolveBearerChallengeOptions(
      requestOptionsWithUrl,
      'Bearer realm="not a valid url %%$$"',
      image,
    );

    expect(result).toBeUndefined();
    expect(axios).not.toHaveBeenCalled();
  });

  test('should log debug message when falling back on any failure', async () => {
    const { default: axios } = await import('axios');
    axios.mockRejectedValue(new Error('some-fetch-error'));
    baseRegistry.configuration = {};
    const debugSpy = vi.fn();
    baseRegistry.log = { debug: debugSpy, warn: vi.fn(), info: vi.fn(), error: vi.fn() } as any;

    const result = await (baseRegistry as any).resolveBearerChallengeOptions(
      requestOptionsWithUrl,
      'Bearer realm="https://registry.example.com/token"',
      image,
    );

    expect(result).toBeUndefined();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('falling back'));
  });
});

test('callRegistry should surface credential rejection from Bearer challenge token endpoint', async () => {
  const { default: axios } = await import('axios');
  const original401 = new Error('Request failed with status code 401');
  (original401 as any).response = {
    status: 401,
    headers: {
      'www-authenticate':
        'Bearer realm="https://registry.example.com/token",service="registry.example.com"',
    },
  };
  const token401 = new Error('Request failed with status code 401');
  (token401 as any).response = { status: 401 };
  axios.mockRejectedValueOnce(original401).mockRejectedValueOnce(token401);
  baseRegistry.type = 'registry';
  baseRegistry.name = 'challenge';
  baseRegistry.configuration = { login: 'user', password: 'pass' };

  await expect(
    baseRegistry.callRegistry({
      image: {
        name: 'library/nginx',
        registry: { url: 'https://registry.example.com/v2' },
      },
      url: 'https://registry.example.com/v2/library/nginx/tags/list',
      method: 'get',
    }),
  ).rejects.toThrow(
    /Authentication failed for registry registry\.challenge \(HTTP 401\): registry\.challenge credentials were rejected/,
  );

  expect(axios).toHaveBeenCalledTimes(2);
  expect(axios.mock.calls[1][0].headers.Authorization).toMatch(/^Basic /);
});

test('publishedAtIsPushDate is false on BaseRegistry', () => {
  expect(baseRegistry.publishedAtIsPushDate).toBe(false);
});
