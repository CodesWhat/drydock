import axios from 'axios';
import Gitlab from './Gitlab.js';

// Test fixture credentials - not real secrets
const TEST_TOKEN = 'abcdef';

const gitlab = new Gitlab();
gitlab.configuration = {
  url: 'https://registry.gitlab.com',
  authurl: 'https://gitlab.com',
  token: TEST_TOKEN,
};

vi.mock('axios');

beforeEach(() => {
  vi.clearAllMocks();
});

test('validatedConfiguration should initialize when configuration is valid', async () => {
  expect(
    gitlab.validateConfiguration({
      token: TEST_TOKEN,
    }),
  ).toStrictEqual({
    url: 'https://registry.gitlab.com',
    authurl: 'https://gitlab.com',
    token: TEST_TOKEN,
  });
  expect(
    gitlab.validateConfiguration({
      url: 'https://registry.custom.com',
      authurl: 'https://custom.com',
      token: TEST_TOKEN,
    }),
  ).toStrictEqual({
    url: 'https://registry.custom.com',
    authurl: 'https://custom.com',
    token: TEST_TOKEN,
  });
});

test('validatedConfiguration should throw error when no pam', async () => {
  expect(() => {
    gitlab.validateConfiguration({});
  }).toThrow('"token" is required');
});

test('maskConfiguration should mask configuration secrets', async () => {
  expect(gitlab.maskConfiguration()).toEqual({
    url: 'https://registry.gitlab.com',
    authurl: 'https://gitlab.com',
    token: '[REDACTED]',
  });
});

test('match should return true when registry url is from gitlab.com', async () => {
  expect(
    gitlab.match({
      registry: {
        url: 'gitlab.com',
      },
    }),
  ).toBeTruthy();
});

test('match should return true when registry url is from custom gitlab', async () => {
  const gitlabCustom = new Gitlab();
  gitlabCustom.configuration = {
    url: 'https://registry.custom.com',
    authurl: 'https://custom.com',
    token: TEST_TOKEN,
  };
  expect(
    gitlabCustom.match({
      registry: {
        url: 'custom.com',
      },
    }),
  ).toBeTruthy();
});

test('authenticate should perform authenticate request', async () => {
  axios.mockImplementation(() => ({
    data: {
      token: 'token',
    },
  }));
  await expect(
    gitlab.authenticate(
      {},
      {
        headers: {},
      },
    ),
  ).resolves.toEqual({ headers: { Authorization: 'Bearer token' } });
});

test('authenticate should encode scope query parameter', async () => {
  axios.mockImplementation(() => ({
    data: {
      token: 'token',
    },
  }));

  await gitlab.authenticate(
    { name: 'group/project' },
    {
      headers: {},
    },
  );

  expect(axios).toHaveBeenCalledWith({
    method: 'GET',
    url: 'https://gitlab.com/jwt/auth?service=container_registry&scope=repository%3Agroup%2Fproject%3Apull',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`:${TEST_TOKEN}`).toString('base64')}`,
    },
  });
});

test('authenticate should throw when token response is missing token', async () => {
  axios.mockImplementation(() => ({
    data: {},
  }));

  await expect(
    gitlab.authenticate(
      {},
      {
        headers: {},
      },
    ),
  ).rejects.toThrow('GitLab token endpoint response does not contain token');
});

test('authenticate should propagate network errors', async () => {
  axios.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'));

  await expect(gitlab.authenticate({}, { headers: {} })).rejects.toThrow(
    'connect ECONNREFUSED 127.0.0.1:443',
  );
});

test('authenticate should propagate timeout errors', async () => {
  axios.mockRejectedValue(new Error('timeout of 15000ms exceeded'));

  await expect(gitlab.authenticate({}, { headers: {} })).rejects.toThrow(
    'timeout of 15000ms exceeded',
  );
});

test('authenticate should propagate 401 errors', async () => {
  const error = new Error('Request failed with status code 401');
  (error as any).response = { status: 401 };
  axios.mockRejectedValue(error);

  await expect(gitlab.authenticate({}, { headers: {} })).rejects.toThrow(
    'Request failed with status code 401',
  );
});

test('authenticate should propagate 429 rate limit errors', async () => {
  const error = new Error('Request failed with status code 429');
  (error as any).response = { status: 429 };
  axios.mockRejectedValue(error);

  await expect(gitlab.authenticate({}, { headers: {} })).rejects.toThrow(
    'Request failed with status code 429',
  );
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
  expect(
    gitlab.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'registry.gitlab.com',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'https://registry.gitlab.com/v2',
    },
  });
});

test('getAuthPull should return pam', async () => {
  await expect(gitlab.getAuthPull()).resolves.toEqual({
    username: '',
    password: gitlab.configuration.token,
  });
});
