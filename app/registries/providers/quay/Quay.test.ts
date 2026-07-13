import axios from 'axios';
import log from '../../../log/index.js';
import Quay from './Quay.js';

// Test fixture credentials - not real secrets
const TEST_TOKEN = 'token';

vi.mock('axios');
axios.mockImplementation(() => ({
  data: { token: TEST_TOKEN },
}));

// Pass-through withRetry; no-op acquireToken — unit tests don't need real retry/rate-limiting
vi.mock('../../http-retry.js', () => ({
  withRetry: vi.fn(async (requestFn) => requestFn()),
}));
vi.mock('../../token-bucket.js', () => ({
  acquireToken: vi.fn(() => Promise.resolve()),
  getBucketForUrl: vi.fn(() => ({ key: 'mock-host', ratePerSec: 10, burst: 10 })),
}));

const quay = new Quay();
quay.configuration = {
  namespace: 'namespace',
  account: 'account',
  token: TEST_TOKEN,
};
quay.log = log;

beforeEach(() => {
  vi.clearAllMocks();
});

test('validatedConfiguration should initialize when anonymous configuration is valid', async () => {
  expect(quay.validateConfiguration('')).toStrictEqual({});
  expect(quay.validateConfiguration(undefined)).toStrictEqual({});
});

test('validatedConfiguration should initialize when auth configuration is valid', async () => {
  expect(
    quay.validateConfiguration({
      namespace: 'namespace',
      account: 'account',
      token: TEST_TOKEN,
    }),
  ).toStrictEqual({
    namespace: 'namespace',
    account: 'account',
    token: TEST_TOKEN,
  });
});

test('validatedConfiguration should throw error when configuration is missing', async () => {
  expect(() => {
    quay.validateConfiguration({});
  }).toThrow('"namespace" is required');
});

test('maskConfiguration should mask anonymous configuration secrets', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = '';
  expect(quayInstance.maskConfiguration()).toEqual({});
});

test('maskConfiguration should mask authentication configuration secrets', async () => {
  expect(quay.maskConfiguration()).toEqual({
    account: 'account',
    namespace: 'namespace',
    token: '[REDACTED]',
  });
});

test('match should return true when registry url is from quay.io', async () => {
  expect(
    quay.match({
      registry: {
        url: 'quay.io',
      },
    }),
  ).toBeTruthy();
});

test('match should return false when registry url is not from quay.io', async () => {
  expect(
    quay.match({
      registry: {
        url: 'error.io',
      },
    }),
  ).toBeFalsy();
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
  expect(
    quay.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'quay.io/test/image',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'https://quay.io/test/image/v2',
    },
  });
});

test('getAuthCredentials should return undefined when anonymous configuration', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  expect(quayInstance.getAuthCredentials()).toEqual(undefined);
});

test('getAuthCredentials should return base64 encode credentials when auth configuration', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {
    namespace: 'namespace',
    account: 'account',
    token: TEST_TOKEN,
  };
  expect(quayInstance.getAuthCredentials()).toEqual('bmFtZXNwYWNlK2FjY291bnQ6dG9rZW4=');
});

test('getAuthPull should return undefined when anonymous configuration', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  await expect(quayInstance.getAuthPull()).resolves.toEqual(undefined);
});

test('getAuthPull should return credentials when auth configuration', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {
    namespace: 'namespace',
    account: 'account',
    token: TEST_TOKEN,
  };
  await expect(quayInstance.getAuthPull()).resolves.toEqual({
    password: TEST_TOKEN,
    username: 'namespace+account',
  });
});

test('authenticate should populate header with base64 bearer', async () => {
  await expect(
    quay.authenticate({}, { headers: {}, url: 'https://quay.io/v2/test/image/manifests/latest' }),
  ).resolves.toEqual(
    expect.objectContaining({
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
    }),
  );
});

test('authenticate should not populate header with base64 bearer when anonymous', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  await expect(
    quayInstance.authenticate(
      {},
      { headers: {}, url: 'https://quay.io/v2/test/image/manifests/latest' },
    ),
  ).resolves.toEqual(
    expect.objectContaining({
      headers: {},
    }),
  );
});

test('authenticate anonymous with insecure=true should return httpsAgent on the returned options', async () => {
  const quayAnonInsecure = new Quay();
  quayAnonInsecure.configuration = { insecure: true };

  const result = await quayAnonInsecure.authenticate(
    {},
    { headers: {}, url: 'https://quay.io/v2/test/image/manifests/latest' },
  );

  expect(result.httpsAgent).toBeDefined();
  expect((result.httpsAgent as any).options.rejectUnauthorized).toBe(false);
});

test('authenticate should throw actionable error when configured credentials are rejected with 403', async () => {
  const quayInstance = new Quay();
  await quayInstance.register('registry', 'quay', 'test', {
    namespace: 'namespace',
    account: 'account',
    token: TEST_TOKEN,
  });
  quayInstance.log = log;
  axios.mockRejectedValueOnce(new Error('Request failed with status code 403'));

  await expect(
    quayInstance.authenticate(
      { name: 'test/image' },
      { headers: {}, url: 'https://quay.io/v2/test/image/manifests/latest' },
    ),
  ).rejects.toThrow(
    /Authentication failed for registry quay\.test \(HTTP 403\): Quay credentials were rejected/,
  );

  expect(axios).toHaveBeenCalledTimes(1);
  expect(axios).toHaveBeenCalledWith({
    method: 'GET',
    url: 'https://quay.io/v2/auth?service=quay.io&scope=repository:test/image:pull',
    maxRedirects: 0,
    headers: {
      Accept: 'application/json',
      Authorization: 'Basic bmFtZXNwYWNlK2FjY291bnQ6dG9rZW4=',
    },
  });
});

test('authenticate should throw when token request fails', async () => {
  axios.mockImplementationOnce(() => {
    throw new Error('Network error');
  });
  const quayInstance = new Quay();
  quayInstance.configuration = {
    namespace: 'namespace',
    account: 'account',
    token: TEST_TOKEN,
  };
  await expect(
    quayInstance.authenticate(
      { name: 'test/image' },
      { headers: {}, url: 'https://quay.io/v2/test/image/manifests/latest' },
    ),
  ).rejects.toThrow('token request failed (Network error)');
});

test('getTagsPage should call registry with default pagination', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    undefined,
    undefined,
  );
  expect(quayInstance.callRegistry).toHaveBeenCalledWith({
    image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    url: 'https://quay.io/v2/test/image/tags/list?n=1000',
    resolveWithFullResponse: true,
  });
});

test('getTagsPage should handle link with next_page parameter', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    'sometag',
    '/v2/test/image/tags/list?next_page=abc123',
  );
  expect(quayInstance.callRegistry).toHaveBeenCalledWith({
    image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    url: 'https://quay.io/v2/test/image/tags/list?n=1000&next_page=abc123',
    resolveWithFullResponse: true,
  });
});

test('getTagsPage should handle link with last parameter', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    'sometag',
    '</v2/test/image/tags/list?last=xyz789>; rel="next"',
  );
  expect(quayInstance.callRegistry).toHaveBeenCalledWith({
    image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    url: 'https://quay.io/v2/test/image/tags/list?n=1000&last=xyz789',
    resolveWithFullResponse: true,
  });
});

test('getTagsPage should handle link with no matching pattern', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    'sometag',
    'some-unrecognized-link-format',
  );
  expect(quayInstance.callRegistry).toHaveBeenCalledWith({
    image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    url: 'https://quay.io/v2/test/image/tags/list?n=1000',
    resolveWithFullResponse: true,
  });
});

test('getTagsPage should percent-encode next_page tokens containing URL metacharacters', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    'sometag',
    '/v2/test/image/tags/list?next_page=foo%26bar%3Dbaz&scope=repository:victim/private:pull',
  );
  const calledUrl = quayInstance.callRegistry.mock.calls[0][0].url;
  expect(calledUrl).not.toContain('&scope=');
  expect(calledUrl).toContain('next_page=foo%26bar%3Dbaz');
  expect(calledUrl).not.toContain('next_page=foo%2526bar%253Dbaz');
});

test('getTagsPage should drop &-prefixed last value to prevent query-param injection', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  const maliciousLast = '&scope=repository:victim/private:pull';
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    'sometag',
    `</v2/test/image/tags/list?last=${maliciousLast}>; rel="next"`,
  );
  const calledUrl = quayInstance.callRegistry.mock.calls[0][0].url;
  // The value starts with & so [^>&]+ refuses to match — no last param is emitted,
  // and the injected scope query param never reaches the registry URL.
  expect(calledUrl).not.toMatch(/&scope=/);
  expect(calledUrl).toBe('https://quay.io/v2/test/image/tags/list?n=1000');
});

test('getTagsPage should safely encode a malformed cursor escape', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    'sometag',
    '/v2/test/image/tags/list?next_page=bad%cursor',
  );

  expect(quayInstance.callRegistry).toHaveBeenCalledWith({
    image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    url: 'https://quay.io/v2/test/image/tags/list?n=1000&next_page=bad%25cursor',
    resolveWithFullResponse: true,
  });
});

test('getTagsPage should preserve valid escapes alongside a malformed cursor escape', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    'sometag',
    '/v2/test/image/tags/list?next_page=good%26value%cursor',
  );

  expect(quayInstance.callRegistry).toHaveBeenCalledWith({
    image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    url: 'https://quay.io/v2/test/image/tags/list?n=1000&next_page=good%26value%25cursor',
    resolveWithFullResponse: true,
  });
});

test('getTagsPage should capture next_page token from second query param (&next_page=cursor99)', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    'sometag',
    '/v2/test/image/tags/list?n=100&next_page=cursor99',
  );
  expect(quayInstance.callRegistry).toHaveBeenCalledWith({
    image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    url: 'https://quay.io/v2/test/image/tags/list?n=1000&next_page=cursor99',
    resolveWithFullResponse: true,
  });
});

test('getTagsPage should capture bare last value without RFC5988 angle brackets', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    'sometag',
    '/v2/test/image/tags/list?last=plainvalue',
  );
  expect(quayInstance.callRegistry).toHaveBeenCalledWith({
    image: { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    url: 'https://quay.io/v2/test/image/tags/list?n=1000&last=plainvalue',
    resolveWithFullResponse: true,
  });
});

test('getTagsPage should handle RFC 5988 link with next_page cursor cleanly', async () => {
  const quayInstance = new Quay();
  quayInstance.configuration = {};
  quayInstance.callRegistry = vi.fn().mockResolvedValue({ data: { tags: [] } });
  await quayInstance.getTagsPage(
    { name: 'test/image', registry: { url: 'https://quay.io/v2' } },
    'sometag',
    '</v2/test/image/tags/list?next_page=gAAAAcursorXYZ>; rel="next"',
  );
  const calledUrl = quayInstance.callRegistry.mock.calls[0][0].url;
  // The closing > must not be captured into the cursor token
  expect(calledUrl).toContain('next_page=gAAAAcursorXYZ');
  expect(calledUrl).not.toContain('gAAAAcursorXYZ%3E');
});
