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

beforeEach(() => {
  vi.clearAllMocks();
});

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
  expect(masked.privatekey).toBe('[REDACTED]');
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

test('resolveBearerChallengeOptions should use configured service account credentials', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValueOnce({
    data: { access_token: 'challenge-token' },
  });

  const result = await (gar as any).resolveBearerChallengeOptions(
    {
      headers: {},
      url: 'https://us-central1-docker.pkg.dev/v2/project/repository/image/manifests/latest',
    },
    'Bearer realm="https://us-central1-docker.pkg.dev/v2/token",service="us-central1-docker.pkg.dev",scope="repository:project/repository/image:pull"',
    {
      name: 'project/repository/image',
      registry: { url: 'us-central1-docker.pkg.dev' },
    },
  );

  const expectedBasic = Buffer.from(
    `_json_key:${JSON.stringify({
      client_email: TEST_CLIENT_EMAIL,
      private_key: TEST_PRIVATE_KEY,
    })}`,
    'utf-8',
  ).toString('base64');
  expect(axios).toHaveBeenCalledWith({
    method: 'GET',
    url: 'https://us-central1-docker.pkg.dev/v2/token?service=us-central1-docker.pkg.dev&scope=repository%3Aproject%2Frepository%2Fimage%3Apull',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${expectedBasic}`,
    },
  });
  expect(result.headers.Authorization).toBe('Bearer challenge-token');
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

test('authenticate should propagate network errors', async () => {
  const { default: axios } = await import('axios');
  axios.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:443'));

  await expect(
    gar.authenticate(
      {
        name: 'project/repository/image',
        registry: { url: 'us-central1-docker.pkg.dev' },
      },
      { headers: {} },
    ),
  ).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:443');
});

test('authenticate should propagate timeout errors', async () => {
  const { default: axios } = await import('axios');
  axios.mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'));

  await expect(
    gar.authenticate(
      {
        name: 'project/repository/image',
        registry: { url: 'us-central1-docker.pkg.dev' },
      },
      { headers: {} },
    ),
  ).rejects.toThrow('timeout of 15000ms exceeded');
});

test('authenticate should propagate 429 rate limit errors', async () => {
  const { default: axios } = await import('axios');
  const error = new Error('Request failed with status code 429');
  (error as any).response = { status: 429 };
  axios.mockRejectedValueOnce(error);

  await expect(
    gar.authenticate(
      {
        name: 'project/repository/image',
        registry: { url: 'us-central1-docker.pkg.dev' },
      },
      { headers: {} },
    ),
  ).rejects.toThrow('Request failed with status code 429');
});

test('authenticate should propagate 503 errors', async () => {
  const { default: axios } = await import('axios');
  const error = new Error('Request failed with status code 503');
  (error as any).response = { status: 503 };
  axios.mockRejectedValueOnce(error);

  await expect(
    gar.authenticate(
      {
        name: 'project/repository/image',
        registry: { url: 'us-central1-docker.pkg.dev' },
      },
      { headers: {} },
    ),
  ).rejects.toThrow('Request failed with status code 503');
});

test('match should gracefully handle missing registry URL', async () => {
  expect(
    gar.match({
      registry: {},
    }),
  ).toBeFalsy();
});

test('authenticate should throw a URL error when registry URL is missing', async () => {
  await expect(
    gar.authenticate(
      {
        name: 'project/repository/image',
        registry: {},
      },
      { headers: {} },
    ),
  ).rejects.toThrow('Invalid URL');
});

test('authenticate should pass httpsAgent to axios when insecure=true', async () => {
  const { default: axios } = await import('axios');

  const garInsecure = new Gar();
  garInsecure.configuration = {
    clientemail: TEST_CLIENT_EMAIL,
    privatekey: TEST_PRIVATE_KEY,
    insecure: true,
  };

  await garInsecure.authenticate(
    {
      name: 'project/repository/image',
      registry: { url: 'us-central1-docker.pkg.dev' },
    },
    { headers: {} },
  );

  expect(axios).toHaveBeenCalledWith(expect.objectContaining({ httpsAgent: expect.anything() }));
  const calledConfig = (axios as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(calledConfig.httpsAgent.options.rejectUnauthorized).toBe(false);
});

test('authenticate should NOT attach httpsAgent when no TLS config is set', async () => {
  const { default: axios } = await import('axios');

  const garDefault = new Gar();
  garDefault.configuration = {
    clientemail: TEST_CLIENT_EMAIL,
    privatekey: TEST_PRIVATE_KEY,
  };

  await garDefault.authenticate(
    {
      name: 'project/repository/image',
      registry: { url: 'us-central1-docker.pkg.dev' },
    },
    { headers: {} },
  );

  const calledConfig = (axios as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(calledConfig.httpsAgent).toBeUndefined();
  expect(calledConfig.method).toBe('GET');
  expect(calledConfig.url).toContain('https://us-central1-docker.pkg.dev/v2/token');
});
