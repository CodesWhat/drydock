import Ocir from './Ocir.js';

const ocir = new Ocir();
ocir.configuration = {
  login: 'tenancy/my.user@acme.com',
  password: 'token',
};

test('validatedConfiguration should accept login/password', async () => {
  expect(
    ocir.validateConfiguration({
      login: 'tenancy/my.user@acme.com',
      password: 'token',
    }),
  ).toStrictEqual({
    login: 'tenancy/my.user@acme.com',
    password: 'token',
  });
});

test('match should return true for ocir domains', async () => {
  expect(
    ocir.match({
      registry: {
        url: 'iad.ocir.io',
      },
    }),
  ).toBeTruthy();
});

test('match should return false for non-ocir domains', async () => {
  expect(
    ocir.match({
      registry: {
        url: 'gcr.io',
      },
    }),
  ).toBeFalsy();
});

test('normalizeImage should return proper v2 endpoint', async () => {
  expect(
    ocir.normalizeImage({
      name: 'namespace/repository',
      registry: {
        url: 'iad.ocir.io',
      },
    }),
  ).toStrictEqual({
    name: 'namespace/repository',
    registry: {
      url: 'https://iad.ocir.io/v2',
    },
  });
});

test('maskConfiguration should mask credentials', async () => {
  expect(ocir.maskConfiguration()).toEqual({
    login: 'tenancy/my.user@acme.com',
    password: 't***n',
  });
});
