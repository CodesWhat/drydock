// @ts-nocheck
import Ecr from './Ecr.js';

vi.mock('@aws-sdk/client-ecr', () => ({
  // biome-ignore lint/complexity/useArrowFunction: mock constructor requires function expression
  ECRClient: vi.fn().mockImplementation(function () {
    return {
      send: vi.fn().mockResolvedValue({
        authorizationData: [{ authorizationToken: 'QVdTOnh4eHg=' }],
      }),
    };
  }),
  // biome-ignore lint/complexity/useArrowFunction: mock constructor requires function expression
  GetAuthorizationTokenCommand: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

const ecr = new Ecr();
ecr.configuration = {
  accesskeyid: 'accesskeyid',
  secretaccesskey: 'secretaccesskey', // NOSONAR - test fixture, not a real credential
  region: 'region',
};

vi.mock('axios', () => ({ default: vi.fn() }));

test('validatedConfiguration should initialize when configuration is valid', async () => {
  expect(
    ecr.validateConfiguration({
      accesskeyid: 'accesskeyid',
      secretaccesskey: 'secretaccesskey', // NOSONAR - test fixture, not a real credential
      region: 'region',
    }),
  ).toStrictEqual({
    accesskeyid: 'accesskeyid',
    secretaccesskey: 'secretaccesskey', // NOSONAR - test fixture, not a real credential
    region: 'region',
  });
});

test('validatedConfiguration should throw error when accessKey is missing', async () => {
  expect(() => {
    ecr.validateConfiguration({
      secretaccesskey: 'secretaccesskey', // NOSONAR - test fixture, not a real credential
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
      secretaccesskey: 'secretaccesskey', // NOSONAR - test fixture, not a real credential
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

test('maskConfiguration should mask configuration secrets', async () => {
  expect(ecr.maskConfiguration()).toEqual({
    accesskeyid: 'a*********d',
    region: 'region',
    secretaccesskey: 's*************y',
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

test('authenticate should call ecr auth endpoint', async () => {
  await expect(ecr.authenticate(undefined, { headers: {} })).resolves.toEqual({
    headers: {
      Authorization: 'Basic QVdTOnh4eHg=', // NOSONAR - test fixture, not a real credential
    },
  });
});

test('getAuthPull should return decoded ECR credentials', async () => {
  await expect(ecr.getAuthPull()).resolves.toEqual({
    username: 'AWS',
    password: 'xxxx', // NOSONAR - test fixture, not a real credential
  });
});

test('authenticate should fetch public ECR gallery token for public images', async () => {
  const { default: axios } = await import('axios');
  axios.mockResolvedValueOnce({ data: { token: 'public-token-123' } }); // NOSONAR - test fixture, not a real credential

  const ecrPublic = new Ecr();
  ecrPublic.configuration = {};

  const result = await ecrPublic.authenticate(
    { registry: { url: 'https://public.ecr.aws/v2' } },
    { headers: {} },
  );
  expect(result).toEqual({
    headers: {
      Authorization: 'Bearer public-token-123', // NOSONAR - test fixture, not a real credential
    },
  });
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

test('getAuthPull should return undefined when no accesskeyid configured', async () => {
  const ecrAnon = new Ecr();
  ecrAnon.configuration = {};
  await expect(ecrAnon.getAuthPull()).resolves.toBeUndefined();
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
