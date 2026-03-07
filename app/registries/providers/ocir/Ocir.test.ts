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
    password: '[REDACTED]',
  });
});

test('match should support ocir domain with protocol', async () => {
  expect(
    ocir.match({
      registry: {
        url: 'https://iad.ocir.io/v2',
      },
    }),
  ).toBeTruthy();
});

test('match should gracefully handle malformed registry URLs', async () => {
  expect(
    ocir.match({
      registry: {
        url: '%',
      },
    }),
  ).toBeFalsy();
});

test('authenticate should set basic auth header', async () => {
  await expect(
    ocir.authenticate(
      {
        name: 'namespace/repository',
        registry: { url: 'iad.ocir.io' },
      },
      { headers: {} },
    ),
  ).resolves.toEqual({
    headers: {
      Authorization: `Basic ${Buffer.from('tenancy/my.user@acme.com:token', 'utf-8').toString('base64')}`,
    },
  });
});
