import Ecr from './Ecr.js';

const mockFetchEcrAuthorizationToken = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    authorizationData: [{ authorizationToken: 'QVdTOnh4eHg=' }],
  }),
);
const mockEcrClient = vi.hoisted(() =>
  // biome-ignore lint/complexity/useArrowFunction: mock constructor requires function expression
  vi.fn().mockImplementation(function () {
    return {
      send: mockFetchEcrAuthorizationToken,
    };
  }),
);
const mockGetAuthorizationTokenCommand = vi.hoisted(() =>
  // biome-ignore lint/complexity/useArrowFunction: mock constructor requires function expression
  vi.fn().mockImplementation(function () {
    return {};
  }),
);
const mockAxios = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-ecr', () => ({
  ECRClient: mockEcrClient,
  GetAuthorizationTokenCommand: mockGetAuthorizationTokenCommand,
}));

const ecr = new Ecr();
ecr.configuration = {
  accesskeyid: 'accesskeyid',
  secretaccesskey: 'secretaccesskey',
  region: 'region',
};

vi.mock('axios', () => ({ default: mockAxios }));

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchEcrAuthorizationToken.mockResolvedValue({
    authorizationData: [{ authorizationToken: 'QVdTOnh4eHg=' }],
  });
});

test('validatedConfiguration should initialize when configuration is valid', async () => {
  expect(
    ecr.validateConfiguration({
      accesskeyid: 'accesskeyid',
      secretaccesskey: 'secretaccesskey',
      region: 'region',
    }),
  ).toStrictEqual({
    accesskeyid: 'accesskeyid',
    secretaccesskey: 'secretaccesskey',
    region: 'region',
  });
});

test('validatedConfiguration should allow an empty string configuration', async () => {
  expect(ecr.validateConfiguration('')).toStrictEqual({});
});

test('validatedConfiguration should throw error when accessKey is missing', async () => {
  expect(() => {
    ecr.validateConfiguration({
      secretaccesskey: 'secretaccesskey',
      region: 'region',
    });
  }).toThrow('"accesskeyid" is required');
});

test('validatedConfiguration should throw error when secretaccesskey is missing', async () => {
  expect(() => {
    ecr.validateConfiguration({
      accesskeyid: 'accesskeyid',
      region: 'region',
    });
  }).toThrow('"secretaccesskey" is required');
});

test('validatedConfiguration should throw error when secretaccesskey is missing', async () => {
  expect(() => {
    ecr.validateConfiguration({
      accesskeyid: 'accesskeyid',
      secretaccesskey: 'secretaccesskey',
    });
  }).toThrow('"region" is required');
});

test('match should return true when registry url is from ecr', async () => {
  expect(
    ecr.match({
      registry: {
        url: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
      },
    }),
  ).toBeTruthy();
});

test('match should return false when registry url is not from ecr', async () => {
  expect(
    ecr.match({
      registry: {
        url: '123456789.dkr.ecr.eu-west-1.acme.com',
      },
    }),
  ).toBeFalsy();
});

test('match should reject hosts that only contain an ECR hostname as a substring', async () => {
  expect(
    ecr.match({
      registry: {
        url: 'prefix-123456789.dkr.ecr.eu-west-1.amazonaws.com.attacker.net',
      },
    }),
  ).toBeFalsy();
});

test('match should accept protocol-less public ECR gallery host', async () => {
  expect(
    ecr.match({
      registry: {
        url: 'public.ecr.aws/v2',
      },
    }),
  ).toBeTruthy();
});

test('match should accept nested public ECR gallery paths', async () => {
  expect(
    ecr.match({
      registry: {
        url: 'public.ecr.aws/team/image',
      },
    }),
  ).toBeTruthy();
});

test('match should reject invalid hosts that only fall back to a non-ECR path segment', async () => {
  expect(
    ecr.match({
      registry: {
        url: '://not-a-valid-registry',
      },
    }),
  ).toBeFalsy();
});

test('maskConfiguration should mask configuration secrets', async () => {
  expect(ecr.maskConfiguration()).toEqual({
    accesskeyid: '[REDACTED]',
    region: 'region',
    secretaccesskey: '[REDACTED]',
  });
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
  expect(
    ecr.normalizeImage({
      name: 'test/image',
      registry: {
        url: '123456789.dkr.ecr.eu-west-1.amazonaws.com/test/image',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'https://123456789.dkr.ecr.eu-west-1.amazonaws.com/test/image/v2',
    },
  });
});

test('normalizeImage should keep already-https urls unchanged', async () => {
  expect(
    ecr.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'https://123456789.dkr.ecr.eu-west-1.amazonaws.com/test/image/v2',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'https://123456789.dkr.ecr.eu-west-1.amazonaws.com/test/image/v2',
    },
  });
});

test('normalizeImage should not mutate the input image object', async () => {
  const image = {
    name: 'test/image',
    registry: {
      url: '123456789.dkr.ecr.eu-west-1.amazonaws.com/test/image',
    },
  };

  const normalized = ecr.normalizeImage(image);

  expect(normalized).not.toBe(image);
  expect(normalized.registry).not.toBe(image.registry);
  expect(image.registry.url).toBe('123456789.dkr.ecr.eu-west-1.amazonaws.com/test/image');
  expect(normalized.registry.url).toBe(
    'https://123456789.dkr.ecr.eu-west-1.amazonaws.com/test/image/v2',
  );
});

test('normalizeImage should preserve explicit http urls', async () => {
  expect(
    ecr.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'http://123456789.dkr.ecr.eu-west-1.amazonaws.com/test/image',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'http://123456789.dkr.ecr.eu-west-1.amazonaws.com/test/image',
    },
  });
});

test('fetchPrivateEcrAuthToken should construct the ECR client with configured credentials', async () => {
  await expect(ecr.fetchPrivateEcrAuthToken()).resolves.toBe('QVdTOnh4eHg=');

  expect(mockEcrClient).toHaveBeenCalledWith({
    credentials: {
      accessKeyId: 'accesskeyid',
      secretAccessKey: 'secretaccesskey',
    },
    region: 'region',
  });
  expect(mockGetAuthorizationTokenCommand).toHaveBeenCalledWith({});
});

test('authenticate should call ecr auth endpoint', async () => {
  await expect(ecr.authenticate(undefined, { headers: {} })).resolves.toEqual({
    headers: {
      Authorization: 'Basic QVdTOnh4eHg=',
    },
  });
});

test('authenticate should preserve existing headers for private ECR', async () => {
  const result = await ecr.authenticate(undefined, {
    headers: {
      'X-Trace': 'trace-123',
    },
  });

  expect(result).toEqual({
    headers: {
      'X-Trace': 'trace-123',
      Authorization: 'Basic QVdTOnh4eHg=',
    },
  });
});

test('authenticate should handle missing request options object', async () => {
  const ecrPrivate = new Ecr();
  ecrPrivate.configuration = {
    accesskeyid: 'accesskeyid',
    secretaccesskey: 'secretaccesskey',
    region: 'region',
  };
  ecrPrivate.fetchPrivateEcrAuthToken = vi.fn().mockResolvedValue('QVdTOnh4eHg=');

  await expect(ecrPrivate.authenticate(undefined, undefined)).resolves.toEqual({
    headers: {
      Authorization: 'Basic QVdTOnh4eHg=',
    },
  });
});

test('getAuthPull should return decoded ECR credentials', async () => {
  await expect(ecr.getAuthPull()).resolves.toEqual({
    username: 'AWS',
    password: 'xxxx',
  });
});

test('getAuthPull should throw when the decoded ECR token is malformed', async () => {
  const ecrPrivate = new Ecr();
  ecrPrivate.configuration = {
    accesskeyid: 'accesskeyid',
    secretaccesskey: 'secretaccesskey',
    region: 'region',
  };
  ecrPrivate.fetchPrivateEcrAuthToken = vi.fn().mockResolvedValue('Zm9v');

  await expect(ecrPrivate.getAuthPull()).rejects.toThrow('ECR authorization token is malformed');
});

test('authenticate should fetch public ECR gallery token for public images', async () => {
  mockAxios.mockResolvedValueOnce({ data: { token: 'public-token-123' } });

  const ecrPublic = new Ecr();
  ecrPublic.configuration = {};

  const result = await ecrPublic.authenticate(
    { registry: { url: 'https://public.ecr.aws/v2' } },
    { headers: {} },
  );
  expect(mockAxios).toHaveBeenCalledWith({
    method: 'GET',
    url: 'https://public.ecr.aws/token/',
    headers: {
      Accept: 'application/json',
    },
  });
  expect(result).toEqual({
    headers: {
      Authorization: 'Bearer public-token-123',
    },
  });
});

test('authenticate should preserve existing headers for public ECR', async () => {
  mockAxios.mockResolvedValueOnce({ data: { token: 'public-token-123' } });

  const ecrPublic = new Ecr();
  ecrPublic.configuration = {};

  const result = await ecrPublic.authenticate(
    { registry: { url: 'https://public.ecr.aws/v2' } },
    { headers: { 'X-Trace': 'trace-123' } },
  );

  expect(result).toEqual({
    headers: {
      'X-Trace': 'trace-123',
      Authorization: 'Bearer public-token-123',
    },
  });
});

test('authenticate should handle missing request options for public ECR', async () => {
  mockAxios.mockResolvedValueOnce({ data: { token: 'public-token-123' } });

  const ecrPublic = new Ecr();
  ecrPublic.configuration = {};

  await expect(
    ecrPublic.authenticate({ registry: { url: 'public.ecr.aws/v2' } }, undefined),
  ).resolves.toEqual({
    headers: {
      Authorization: 'Bearer public-token-123',
    },
  });
});

test('authenticate should throw when public ECR token is missing', async () => {
  mockAxios.mockResolvedValueOnce({ data: {} });

  const ecrPublic = new Ecr();
  ecrPublic.configuration = {};

  await expect(
    ecrPublic.authenticate({ registry: { url: 'https://public.ecr.aws/v2' } }, { headers: {} }),
  ).rejects.toThrow('public ECR token endpoint response does not contain token');
});

test('authenticate should throw when private ECR authorization token is missing', async () => {
  const ecrPrivate = new Ecr();
  ecrPrivate.configuration = {
    accesskeyid: 'accesskeyid',
    secretaccesskey: 'secretaccesskey',
    region: 'region',
  };
  ecrPrivate.fetchPrivateEcrAuthToken = vi.fn().mockResolvedValue(undefined);

  await expect(ecrPrivate.authenticate(undefined, { headers: {} })).rejects.toThrow(
    'ECR authorization token is missing',
  );
});

test('authenticate should return unchanged options when neither private nor public ECR', async () => {
  const ecrAnon = new Ecr();
  ecrAnon.configuration = {};

  const result = await ecrAnon.authenticate(
    { registry: { url: 'https://some-other-registry.com/v2' } },
    { headers: {} },
  );
  expect(result).toEqual({ headers: {} });
});

test('authenticate should return unchanged options when image is missing and no credentials are configured', async () => {
  const ecrAnon = new Ecr();
  ecrAnon.configuration = {};

  await expect(ecrAnon.authenticate(undefined, undefined)).resolves.toEqual({
    headers: {},
  });
});

test('authenticate should return unchanged options when registry metadata is missing and no credentials are configured', async () => {
  const ecrAnon = new Ecr();
  ecrAnon.configuration = {};

  await expect(ecrAnon.authenticate({} as any, { headers: {} })).resolves.toEqual({
    headers: {},
  });
});

test('authenticate should not treat lookalike public ECR hosts as public gallery', async () => {
  mockAxios.mockReset();
  const ecrAnon = new Ecr();
  ecrAnon.configuration = {};

  const result = await ecrAnon.authenticate(
    { registry: { url: 'https://public.ecr.aws.attacker.net/v2' } },
    { headers: {} },
  );

  expect(mockAxios).not.toHaveBeenCalled();
  expect(result).toEqual({ headers: {} });
});

test('getAuthPull should return undefined when no accesskeyid configured', async () => {
  const ecrAnon = new Ecr();
  ecrAnon.configuration = {};
  await expect(ecrAnon.getAuthPull()).resolves.toBeUndefined();
});

test('getAuthPull should throw when private ECR authorization token is missing', async () => {
  const ecrPrivate = new Ecr();
  ecrPrivate.configuration = {
    accesskeyid: 'accesskeyid',
    secretaccesskey: 'secretaccesskey',
    region: 'region',
  };
  ecrPrivate.fetchPrivateEcrAuthToken = vi.fn().mockResolvedValue(undefined);

  await expect(ecrPrivate.getAuthPull()).rejects.toThrow('ECR authorization token is missing');
});

test.each([
  Buffer.from(':password-only').toString('base64'),
  Buffer.from('username-only:').toString('base64'),
])('getAuthPull should reject decoded credentials with a missing token segment (%s)', async (token) => {
  const ecrPrivate = new Ecr();
  ecrPrivate.configuration = {
    accesskeyid: 'accesskeyid',
    secretaccesskey: 'secretaccesskey',
    region: 'region',
  };
  ecrPrivate.fetchPrivateEcrAuthToken = vi.fn().mockResolvedValue(token);

  await expect(ecrPrivate.getAuthPull()).rejects.toThrow('ECR authorization token is malformed');
});

test('match should return true for public ECR gallery', async () => {
  expect(
    ecr.match({
      registry: {
        url: 'public.ecr.aws',
      },
    }),
  ).toBeTruthy();
});
