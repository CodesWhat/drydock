// @ts-nocheck
import Trueforge from './trueforge.js';

vi.mock('axios');

const trueforge = new Trueforge();
trueforge.configuration = {
  namespace: 'namespace',
  account: 'account',
  token: 'token', // NOSONAR - test fixture, not a real credential
};

vi.mock('axios');

test('validatedConfiguration should initialize when auth configuration is valid', async () => {
  expect(
    trueforge.validateConfiguration({
      namespace: 'namespace',
      account: 'account',
      token: 'token', // NOSONAR - test fixture, not a real credential
    }),
  ).toStrictEqual({
    namespace: 'namespace',
    account: 'account',
    token: 'token', // NOSONAR - test fixture, not a real credential
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

test('getAuthPull should return quay-compatible pull credentials', async () => {
  await expect(trueforge.getAuthPull()).resolves.toStrictEqual({
    username: 'namespace+account',
    password: 'token', // NOSONAR - test fixture, not a real credential
  });
});
