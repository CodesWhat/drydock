import Gar from './Gar.js';

// Test fixture credentials - not real secrets
const TEST_CLIENT_EMAIL = 'service-account@example.iam.gserviceaccount.com';
const TEST_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';

vi.mock('axios', () => ({
  default: vi.fn().mockResolvedValue({
    data: { token: 'xxxxx' },
  }),
}));

const gar = new Gar();
gar.configuration = {
  clientemail: TEST_CLIENT_EMAIL,
  privatekey: TEST_PRIVATE_KEY,
};

test('validatedConfiguration should initialize when configuration is valid', async () => {
  expect(
    gar.validateConfiguration({
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
    gar.validateConfiguration({});
  }).toThrow('"clientemail" is required');
});

test('maskConfiguration should mask configuration secrets', async () => {
  const masked = gar.maskConfiguration();
  expect(masked.clientemail).toEqual(TEST_CLIENT_EMAIL);
  expect(masked.privatekey).toMatch(/^-.+\n$/);
  expect(masked.privatekey).not.toEqual(TEST_PRIVATE_KEY);
});

test('match should return true when registry url is from Artifact Registry', async () => {
  expect(
    gar.match({
      registry: {
        url: 'us-central1-docker.pkg.dev',
      },
    }),
  ).toBeTruthy();
  expect(
    gar.match({
      registry: {
        url: 'https://europe-west1-docker.pkg.dev/v2',
      },
    }),
  ).toBeTruthy();
});

test('match should return false when registry url is not from Artifact Registry', async () => {
  expect(
    gar.match({
      registry: {
        url: 'gcr.io',
      },
    }),
  ).toBeFalsy();
  expect(
    gar.match({
      registry: {
        url: 'us-central1-maven.pkg.dev',
      },
    }),
  ).toBeFalsy();
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
  expect(
    gar.normalizeImage({
      name: 'project/repository/image',
      registry: {
        url: 'us-central1-docker.pkg.dev',
      },
    }),
  ).toStrictEqual({
    name: 'project/repository/image',
    registry: {
      url: 'https://us-central1-docker.pkg.dev/v2',
    },
  });
});

test('authenticate should call gar auth endpoint', async () => {
  const { default: axios } = await import('axios');

  await expect(
    gar.authenticate(
      {
        name: 'project/repository/image',
        registry: { url: 'us-central1-docker.pkg.dev' },
      },
      { headers: {} },
    ),
  ).resolves.toEqual({
    headers: {
      Authorization: 'Bearer xxxxx',
    },
  });

  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'GET',
      url: expect.stringContaining('https://us-central1-docker.pkg.dev/v2/token?'),
    }),
  );
});

test('authenticate should return unchanged options when no clientemail configured', async () => {
  const garAnon = new Gar();
  garAnon.configuration = {};
  const result = await garAnon.authenticate(
    { name: 'project/repository/image', registry: { url: 'us-central1-docker.pkg.dev' } },
    { headers: {} },
  );
  expect(result).toEqual({ headers: {} });
});

test('getAuthPull should return credentials', async () => {
  const result = await gar.getAuthPull();
  expect(result).toEqual({
    username: TEST_CLIENT_EMAIL,
    password: TEST_PRIVATE_KEY,
  });
});

test('authenticate should use access_token and create headers when missing', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValueOnce({
    data: { access_token: 'yyyyy' },
  });

  await expect(
    gar.authenticate(
      {
        name: 'project/repository/image',
        registry: { url: 'us-central1-docker.pkg.dev' },
      },
      {},
    ),
  ).resolves.toEqual({
    headers: {
      Authorization: 'Bearer yyyyy',
    },
  });
});

test('authenticate should throw when token response is missing token fields', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValueOnce({
    data: {},
  });

  await expect(
    gar.authenticate(
      {
        name: 'project/repository/image',
        registry: { url: 'us-central1-docker.pkg.dev' },
      },
      { headers: {} },
    ),
  ).rejects.toThrow('GAR token endpoint response does not contain token');
});

test('match should gracefully handle missing registry URL', async () => {
  expect(
    gar.match({
      registry: {},
    }),
  ).toBeFalsy();
});
