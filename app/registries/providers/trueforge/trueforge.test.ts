import Trueforge from './trueforge.js';

vi.mock('axios');

const trueforge = new Trueforge();
trueforge.configuration = {
  username: 'myuser',
  token: 'token',
};

test('validatedConfiguration should initialize when auth configuration is valid', async () => {
  expect(
    trueforge.validateConfiguration({
      username: 'myuser',
      token: 'token',
    }),
  ).toStrictEqual({
    username: 'myuser',
    token: 'token',
  });
});

test('validatedConfiguration should initialize when anonymous configuration is valid', async () => {
  expect(trueforge.validateConfiguration('')).toStrictEqual({});
  expect(trueforge.validateConfiguration(undefined)).toStrictEqual({});
});

test('validatedConfiguration should throw error when configuration is missing', async () => {
  expect(() => {
    trueforge.validateConfiguration({});
  }).toThrow();
});

test('validatedConfiguration should reject quay-style namespace/account config', async () => {
  expect(() => {
    trueforge.validateConfiguration({
      namespace: 'namespace',
      account: 'account',
      token: 'token',
    });
  }).toThrow();
});

test('match should return true when registry url is from trueforge', async () => {
  expect(
    trueforge.match({
      registry: {
        url: 'oci.trueforge.org',
      },
    }),
  ).toBeTruthy();
});

test('match should return true for valid trueforge subdomains', async () => {
  expect(
    trueforge.match({
      registry: {
        url: 'team.oci.trueforge.org',
      },
    }),
  ).toBe(true);
});

test('match should return false when registry url is not from trueforge', async () => {
  expect(
    trueforge.match({
      registry: {
        url: 'wrong.io',
      },
    }),
  ).toBeFalsy();
});

test('match should return false and never throw when registry url is missing', async () => {
  expect(() => trueforge.match({ registry: { url: undefined } })).not.toThrow();
  expect(() => trueforge.match({})).not.toThrow();
  expect(trueforge.match({ registry: { url: undefined } })).toBe(false);
  expect(trueforge.match({})).toBe(false);
});

test('match should reject hostnames that bypass unescaped dot in regex', async () => {
  expect(trueforge.match({ registry: { url: 'ociXtrueforgeXorg' } })).toBe(false);
  expect(trueforge.match({ registry: { url: 'evil-oci.trueforge.org.attacker.com' } })).toBe(false);
  expect(trueforge.match({ registry: { url: 'notoci.trueforge.org' } })).toBe(false);
});

test('normalizeImage should return the proper registry v2 endpoint', async () => {
  expect(
    trueforge.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'oci.trueforge.org/test/image',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'https://oci.trueforge.org/test/image/v2',
    },
  });
});

test('normalizeImage should preserve already-https registry urls', async () => {
  expect(
    trueforge.normalizeImage({
      name: 'test/image',
      registry: {
        url: 'https://oci.trueforge.org/v2',
      },
    }),
  ).toStrictEqual({
    name: 'test/image',
    registry: {
      url: 'https://oci.trueforge.org/v2',
    },
  });
});

test('normalizeImage should not mutate the input image object', async () => {
  const image = {
    name: 'test/image',
    registry: {
      url: 'oci.trueforge.org/test/image',
    },
  };

  const normalized = trueforge.normalizeImage(image);

  expect(normalized).not.toBe(image);
  expect(normalized.registry).not.toBe(image.registry);
  expect(image.registry.url).toBe('oci.trueforge.org/test/image');
  expect(normalized.registry.url).toBe('https://oci.trueforge.org/test/image/v2');
});

test('getAuthCredentials should return base64 encoded credentials', () => {
  expect(trueforge.getAuthCredentials()).toEqual('bXl1c2VyOnRva2Vu');
});

test('getAuthCredentials should return undefined when anonymous', () => {
  const instance = new Trueforge();
  instance.configuration = {};
  expect(instance.getAuthCredentials()).toBeUndefined();
});

test('getAuthPull should return username/password credentials', async () => {
  await expect(trueforge.getAuthPull()).resolves.toStrictEqual({
    username: 'myuser',
    password: 'token',
  });
});

test('getAuthPull should return undefined when anonymous', async () => {
  const instance = new Trueforge();
  instance.configuration = {};
  await expect(instance.getAuthPull()).resolves.toBeUndefined();
});
