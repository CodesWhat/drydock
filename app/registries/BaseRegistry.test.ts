// @ts-nocheck
import BaseRegistry from './BaseRegistry.js';

vi.mock('axios', () => ({
  default: vi.fn(),
}));

let baseRegistry;

beforeEach(() => {
  baseRegistry = new BaseRegistry();
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

test('authenticateBasic should add Basic auth header when credentials provided', async () => {
  const result = await baseRegistry.authenticateBasic({ headers: {} }, 'dXNlcjpwYXNz');
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

test('authenticateBearer should not add header when no token', async () => {
  const result = await baseRegistry.authenticateBearer({ headers: {} }, undefined);
  expect(result.headers.Authorization).toBeUndefined();
});

test('getAuthCredentials should return auth when set', () => {
  baseRegistry.configuration = { auth: 'base64-auth' };
  expect(baseRegistry.getAuthCredentials()).toBe('base64-auth');
});

test('getAuthCredentials should return base64 encoded login/password', () => {
  baseRegistry.configuration = { login: 'user', password: 'pass' }; // NOSONAR - test fixture, not a real credential
  expect(baseRegistry.getAuthCredentials()).toBe(Buffer.from('user:pass').toString('base64'));
});

test('getAuthCredentials should return undefined when no auth configured', () => {
  baseRegistry.configuration = {};
  expect(baseRegistry.getAuthCredentials()).toBeUndefined();
});

test('getAuthPull should return login/password when set', async () => {
  baseRegistry.configuration = { login: 'user', password: 'pass' }; // NOSONAR - test fixture, not a real credential
  const result = await baseRegistry.getAuthPull();
  expect(result).toEqual({ username: 'user', password: 'pass' }); // NOSONAR - test fixture, not a real credential
});

test('getAuthPull should return username/token when set', async () => {
  baseRegistry.configuration = { username: 'user', token: 'tok' }; // NOSONAR - test fixture, not a real credential
  const result = await baseRegistry.getAuthPull();
  expect(result).toEqual({ username: 'user', password: 'tok' }); // NOSONAR - test fixture, not a real credential
});

test('getAuthPull should return undefined when no credentials', async () => {
  baseRegistry.configuration = {};
  const result = await baseRegistry.getAuthPull();
  expect(result).toBeUndefined();
});

test('getAuthPull should prefer login/password over username/token', async () => {
  baseRegistry.configuration = {
    login: 'user',
    password: 'pass', // NOSONAR - test fixture, not a real credential
    username: 'user2',
    token: 'tok2', // NOSONAR - test fixture, not a real credential
  };
  const result = await baseRegistry.getAuthPull();
  expect(result).toEqual({ username: 'user', password: 'pass' }); // NOSONAR - test fixture, not a real credential
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
    password: 'supersecret', // NOSONAR - test fixture, not a real credential
    token: 'mytoken', // NOSONAR - test fixture, not a real credential
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
  axios.mockResolvedValue({ data: { token: 'abc123' } }); // NOSONAR - test fixture

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

test('authenticateBearerFromAuthUrl should not set header when token is missing', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValue({ data: {} });

  const result = await baseRegistry.authenticateBearerFromAuthUrl(
    { headers: {} },
    'https://auth.example.com/token',
    undefined,
    (response) => response.data.accessToken,
  );

  expect(result.headers.Authorization).toBeUndefined();
});
