// @ts-nocheck
import Custom from './Custom.js';

// Test fixture credentials - not real secrets
const TEST_LOGIN = 'login';
const TEST_PASSWORD = 'password';

const custom = new Custom();
custom.configuration = {
  login: TEST_LOGIN,
  password: TEST_PASSWORD,
  url: 'http://localhost:5000',
};

test('validatedConfiguration should initialize when configuration is valid', async () => {
  expect(
    custom.validateConfiguration({
      url: 'http://localhost:5000',
      login: TEST_LOGIN,
      password: TEST_PASSWORD,
    }),
  ).toStrictEqual({
    url: 'http://localhost:5000',
    login: TEST_LOGIN,
    password: TEST_PASSWORD,
  });
});

test('validatedConfiguration should accept cafile and insecure tls options', async () => {
  expect(
    custom.validateConfiguration({
      url: 'http://localhost:5000',
      login: TEST_LOGIN,
      password: TEST_PASSWORD,
      cafile: '/certs/internal-ca.pem',
      insecure: true,
    }),
  ).toStrictEqual({
    url: 'http://localhost:5000',
    login: TEST_LOGIN,
    password: TEST_PASSWORD,
    cafile: '/certs/internal-ca.pem',
    insecure: true,
  });
});

test('validatedConfiguration should throw error when auth is not base64', async () => {
  expect(() => {
    custom.validateConfiguration({
      url: 'http://localhost:5000',
      auth: '°°°',
    });
  }).toThrow('"auth" must be a valid base64 string');
});

test('validatedConfiguration should throw error when login is set without password', async () => {
  expect(() => {
    custom.validateConfiguration({
      url: 'http://localhost:5000',
      login: TEST_LOGIN,
    });
  }).toThrow();
});

test('validatedConfiguration should throw error when password is set without login', async () => {
  expect(() => {
    custom.validateConfiguration({
      url: 'http://localhost:5000',
      password: TEST_PASSWORD,
    });
  }).toThrow();
});

test('validatedConfiguration should throw error when auth and login/password are mixed', async () => {
  expect(() => {
    custom.validateConfiguration({
      url: 'http://localhost:5000',
      login: TEST_LOGIN,
      password: TEST_PASSWORD,
      auth: 'dXNlcm5hbWU6cGFzc3dvcmQ=',
    });
  }).toThrow();
});

test('maskConfiguration should mask configuration secrets', async () => {
  expect(custom.maskConfiguration()).toEqual({
    auth: undefined,
    login: TEST_LOGIN,
    password: 'p******d',
    url: 'http://localhost:5000',
  });
});

test('match should return true when registry url is from custom', async () => {
  expect(
    custom.match({
      registry: {
        url: 'localhost:5000',
      },
    }),
  ).toBeTruthy();
});

test('match should return false when registry url is not from custom', async () => {
  expect(
    custom.match({
      registry: {
        url: 'est.notme.io',
      },
    }),
  ).toBeFalsy();
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
  expect(
    custom.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'localhost:5000/test/image',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'http://localhost:5000/v2',
    },
  });
});

test('authenticate should add basic auth', async () => {
  await expect(custom.authenticate(undefined, { headers: {} })).resolves.toEqual({
    headers: {
      Authorization: 'Basic bG9naW46cGFzc3dvcmQ=',
    },
  });
});

test('authenticate should set httpsAgent when insecure=true', async () => {
  const customRegistry = new Custom();
  customRegistry.configuration = {
    url: 'https://registry.internal',
    insecure: true,
  };

  const result = await customRegistry.authenticate(undefined, { headers: {} });
  expect(result.httpsAgent).toBeDefined();
  expect(result.httpsAgent.options.rejectUnauthorized).toBe(false);
});

test('getAuthCredentials should return base64 creds when set in configuration', async () => {
  custom.configuration.auth = 'dXNlcm5hbWU6cGFzc3dvcmQ=';
  expect(custom.getAuthCredentials()).toEqual('dXNlcm5hbWU6cGFzc3dvcmQ=');
});

test('getAuthCredentials should return base64 creds when login/token set in configuration', async () => {
  custom.configuration.login = 'username';
  custom.configuration.token = TEST_PASSWORD;
  expect(custom.getAuthCredentials()).toEqual('dXNlcm5hbWU6cGFzc3dvcmQ=');
});

test('getAuthCredentials should return undefined when no login/token/auth set in configuration', async () => {
  custom.configuration = {};
  expect(custom.getAuthCredentials()).toBe(undefined);
});
