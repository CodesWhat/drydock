import Alicr from './Alicr.js';

const alicr = new Alicr();
alicr.configuration = {
  login: 'drydock',
  password: 'token',
};

test('validatedConfiguration should accept login/password', async () => {
  expect(
    alicr.validateConfiguration({
      login: 'drydock',
      password: 'token',
    }),
  ).toStrictEqual({
    login: 'drydock',
    password: 'token',
  });
});

test('match should return true for Alibaba CR domains', async () => {
  expect(
    alicr.match({
      registry: {
        url: 'registry.cn-hangzhou.aliyuncs.com',
      },
    }),
  ).toBeTruthy();
  expect(
    alicr.match({
      registry: {
        url: 'crpi-abc123.cn-hangzhou.personal.cr.aliyuncs.com',
      },
    }),
  ).toBeTruthy();
});

test('match should return true for Alibaba CR domains with protocol', async () => {
  expect(
    alicr.match({
      registry: {
        url: 'https://registry-intl.cn-hangzhou.aliyuncs.com/v2',
      },
    }),
  ).toBeTruthy();
});

test('match should return false for non-Alibaba domains', async () => {
  expect(
    alicr.match({
      registry: {
        url: 'ghcr.io',
      },
    }),
  ).toBeFalsy();
});

test('normalizeImage should return proper v2 endpoint', async () => {
  expect(
    alicr.normalizeImage({
      name: 'namespace/repository',
      registry: {
        url: 'registry.cn-hangzhou.aliyuncs.com',
      },
    }),
  ).toStrictEqual({
    name: 'namespace/repository',
    registry: {
      url: 'https://registry.cn-hangzhou.aliyuncs.com/v2',
    },
  });
});

test('maskConfiguration should mask credentials', async () => {
  expect(alicr.maskConfiguration()).toEqual({
    login: 'drydock',
    password: '[REDACTED]',
  });
});

test('match should gracefully handle malformed registry URLs', async () => {
  expect(
    alicr.match({
      registry: {
        url: '%',
      },
    }),
  ).toBeFalsy();
});

test('authenticate should set basic auth header', async () => {
  await expect(
    alicr.authenticate(
      {
        name: 'namespace/repository',
        registry: { url: 'registry.cn-hangzhou.aliyuncs.com' },
      },
      { headers: {} },
    ),
  ).resolves.toEqual({
    headers: {
      Authorization: `Basic ${Buffer.from('drydock:token', 'utf-8').toString('base64')}`,
    },
  });
});
