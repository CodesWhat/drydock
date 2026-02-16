import Harbor from './Harbor.js';

test('Harbor should be an instance of SelfHostedBasic', async () => {
  const { default: SelfHostedBasic } = await import('../shared/SelfHostedBasic.js');
  const harbor = new Harbor();
  expect(harbor).toBeInstanceOf(SelfHostedBasic);
});

const harbor = new Harbor();
harbor.configuration = {
  url: 'https://harbor.acme.com',
  login: 'robot$drydock',
  password: 'secret',
};

test('validatedConfiguration should initialize when configuration is valid', async () => {
  expect(
    harbor.validateConfiguration({
      url: 'https://harbor.acme.com',
      login: 'robot$drydock',
      password: 'secret',
    }),
  ).toStrictEqual({
    url: 'https://harbor.acme.com',
    login: 'robot$drydock',
    password: 'secret',
  });
});

test('match should return true when registry url matches configured harbor host', async () => {
  expect(
    harbor.match({
      registry: {
        url: 'harbor.acme.com',
      },
    }),
  ).toBeTruthy();
});

test('match should return false when registry url is not from harbor host', async () => {
  expect(
    harbor.match({
      registry: {
        url: 'other.acme.com',
      },
    }),
  ).toBeFalsy();
});

test('normalizeImage should return configured registry v2 endpoint', async () => {
  expect(
    harbor.normalizeImage({
      name: 'library/nginx',
      registry: {
        url: 'harbor.acme.com/library/nginx',
      },
    }),
  ).toStrictEqual({
    name: 'library/nginx',
    registry: {
      url: 'https://harbor.acme.com/v2',
    },
  });
});
