import Gcr from './Gcr.js';

// Test fixture credentials - not real secrets
const TEST_CLIENT_EMAIL = 'accesskeyid';
const TEST_PRIVATE_KEY = 'secretaccesskey';

vi.mock('axios', () => ({
  default: vi.fn().mockImplementation(() => ({
    data: { token: 'xxxxx' },
  })),
}));

let gcr;

beforeEach(() => {
  vi.clearAllMocks();
  gcr = new Gcr();
  gcr.configuration = {
    clientemail: TEST_CLIENT_EMAIL,
    privatekey: TEST_PRIVATE_KEY,
  };
});

test('validatedConfiguration should initialize when configuration is valid', async () => {
  expect(
    gcr.validateConfiguration({
      clientemail: TEST_CLIENT_EMAIL,
      privatekey: TEST_PRIVATE_KEY,
    }),
  ).toStrictEqual({
    clientemail: TEST_CLIENT_EMAIL,
    privatekey: TEST_PRIVATE_KEY,
  });
});

test('validatedConfiguration should throw error when configuration is missing', async () => {
  expect(() => {
    gcr.validateConfiguration({});
  }).toThrow('"clientemail" is required');
});

test('maskConfiguration should mask configuration secrets', async () => {
  expect(gcr.maskConfiguration()).toEqual({
    clientemail: TEST_CLIENT_EMAIL,
    privatekey: '[REDACTED]',
  });
});

test('match should return true when registry url is from gcr', async () => {
  expect(
    gcr.match({
      registry: {
        url: 'gcr.io',
      },
    }),
  ).toBeTruthy();
  expect(
    gcr.match({
      registry: {
        url: 'us.gcr.io',
      },
    }),
  ).toBeTruthy();
  expect(
    gcr.match({
      registry: {
        url: 'eu.gcr.io',
      },
    }),
  ).toBeTruthy();
  expect(
    gcr.match({
      registry: {
        url: 'asia.gcr.io',
      },
    }),
  ).toBeTruthy();
});

test('match should return false when registry url is not from gcr', async () => {
  expect(
    gcr.match({
      registry: {
        url: 'grr.io',
      },
    }),
  ).toBeFalsy();
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
  expect(
    gcr.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'eu.gcr.io/test/image',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'https://eu.gcr.io/test/image/v2',
    },
  });
});

test('authenticate should call gcr auth endpoint', async () => {
  await expect(gcr.authenticate({}, { headers: {} })).resolves.toEqual({
    headers: {
      Authorization: 'Bearer xxxxx',
    },
  });
});

test('authenticate should return unchanged options when no clientemail configured', async () => {
  const gcrAnon = new Gcr();
  gcrAnon.configuration = {};
  const result = await gcrAnon.authenticate({}, { headers: {} });
  expect(result).toEqual({ headers: {} });
});

test('authenticate should retry anonymously when configured credentials are rejected with 403', async () => {
  const { default: axios } = await import('axios');
  const gcrWithCreds = new Gcr();
  await gcrWithCreds.register('registry', 'gcr', 'test', {
    clientemail: TEST_CLIENT_EMAIL,
    privatekey: TEST_PRIVATE_KEY,
  });
  axios
    .mockRejectedValueOnce(new Error('Request failed with status code 403'))
    .mockResolvedValueOnce({ data: { token: 'anon-token' } });
  const warnSpy = vi.spyOn(gcrWithCreds.log, 'warn');

  const result = await gcrWithCreds.authenticate({ name: 'project/image' }, { headers: {} });

  const expectedBasic = Buffer.from(
    `_json_key:${JSON.stringify({
      client_email: TEST_CLIENT_EMAIL,
      private_key: TEST_PRIVATE_KEY,
    })}`,
    'utf-8',
  ).toString('base64');
  expect(axios).toHaveBeenNthCalledWith(1, {
    method: 'GET',
    url: 'https://gcr.io/v2/token?scope=repository:project/image:pull',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${expectedBasic}`,
    },
  });
  expect(axios).toHaveBeenNthCalledWith(2, {
    method: 'GET',
    url: 'https://gcr.io/v2/token?scope=repository:project/image:pull',
    headers: {
      Accept: 'application/json',
    },
  });
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining('GCR credentials were rejected for registry gcr.test (status 403)'),
  );
  expect(result).toEqual({
    headers: {
      Authorization: 'Bearer anon-token',
    },
  });
});

test('authenticate should throw when gcr token is missing', async () => {
  const { default: axios } = await import('axios');
  axios.mockImplementationOnce(() => ({
    data: {},
  }));

  await expect(gcr.authenticate({}, { headers: {} })).rejects.toThrow(
    'GCR token endpoint response does not contain token',
  );
});

test('authenticate should propagate network errors', async () => {
  const { default: axios } = await import('axios');
  axios.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:443'));

  await expect(gcr.authenticate({}, { headers: {} })).rejects.toThrow(
    'connect ECONNREFUSED 127.0.0.1:443',
  );
});

test('authenticate should propagate timeout errors', async () => {
  const { default: axios } = await import('axios');
  axios.mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'));

  await expect(gcr.authenticate({}, { headers: {} })).rejects.toThrow(
    'timeout of 15000ms exceeded',
  );
});

test('authenticate should propagate 429 rate limit errors', async () => {
  const { default: axios } = await import('axios');
  const error = new Error('Request failed with status code 429');
  (error as any).response = { status: 429 };
  axios.mockRejectedValueOnce(error);

  await expect(gcr.authenticate({}, { headers: {} })).rejects.toThrow(
    'Request failed with status code 429',
  );
});

test('getAuthPull should return credentials', async () => {
  const result = await gcr.getAuthPull();
  expect(result).toEqual({
    username: TEST_CLIENT_EMAIL,
    password: TEST_PRIVATE_KEY,
  });
});
