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
    password: 't***n',
  });
});
