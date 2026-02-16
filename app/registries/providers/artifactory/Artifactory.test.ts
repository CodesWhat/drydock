import Artifactory from './Artifactory.js';

test('Artifactory should be an instance of SelfHostedBasic', async () => {
  const { default: SelfHostedBasic } = await import('../shared/SelfHostedBasic.js');
  const artifactory = new Artifactory();
  expect(artifactory).toBeInstanceOf(SelfHostedBasic);
});

const artifactory = new Artifactory();
artifactory.configuration = {
  url: 'https://repo.acme.com',
  login: 'svc-drydock',
  password: 'secret',
};

test('validatedConfiguration should initialize when configuration is valid', async () => {
  expect(
    artifactory.validateConfiguration({
      url: 'https://repo.acme.com',
      login: 'svc-drydock',
      password: 'secret',
    }),
  ).toStrictEqual({
    url: 'https://repo.acme.com',
    login: 'svc-drydock',
    password: 'secret',
  });
});

test('match should return true when registry url matches configured artifactory host', async () => {
  expect(
    artifactory.match({
      registry: {
        url: 'repo.acme.com',
      },
    }),
  ).toBeTruthy();
});

test('normalizeImage should return configured registry v2 endpoint', async () => {
  expect(
    artifactory.normalizeImage({
      name: 'docker-local/app',
      registry: {
        url: 'repo.acme.com/docker-local/app',
      },
    }),
  ).toStrictEqual({
    name: 'docker-local/app',
    registry: {
      url: 'https://repo.acme.com/v2',
    },
  });
});
