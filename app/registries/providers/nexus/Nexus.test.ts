import Nexus from './Nexus.js';

test('Nexus should be an instance of SelfHostedBasic', async () => {
  const { default: SelfHostedBasic } = await import('../shared/SelfHostedBasic.js');
  const nexus = new Nexus();
  expect(nexus).toBeInstanceOf(SelfHostedBasic);
});

const nexus = new Nexus();
nexus.configuration = {
  url: 'https://nexus.acme.com',
  login: 'drydock',
  password: 'secret',
};

test('validatedConfiguration should initialize when configuration is valid', async () => {
  expect(
    nexus.validateConfiguration({
      url: 'https://nexus.acme.com',
      login: 'drydock',
      password: 'secret',
    }),
  ).toStrictEqual({
    url: 'https://nexus.acme.com',
    login: 'drydock',
    password: 'secret',
  });
});

test('match should return true when registry url matches configured nexus host', async () => {
  expect(
    nexus.match({
      registry: {
        url: 'nexus.acme.com',
      },
    }),
  ).toBeTruthy();
});

test('normalizeImage should return configured registry v2 endpoint', async () => {
  expect(
    nexus.normalizeImage({
      name: 'repo/app',
      registry: {
        url: 'nexus.acme.com/repo/app',
      },
    }),
  ).toStrictEqual({
    name: 'repo/app',
    registry: {
      url: 'https://nexus.acme.com/v2',
    },
  });
});
