import Ibmcr from './Ibmcr.js';

const ibmcr = new Ibmcr();
ibmcr.configuration = {
  login: 'iamapikey',
  password: 'api-key',
};

test('validatedConfiguration should accept login/password', async () => {
  expect(
    ibmcr.validateConfiguration({
      login: 'iamapikey',
      password: 'api-key',
    }),
  ).toStrictEqual({
    login: 'iamapikey',
    password: 'api-key',
  });
});

test('validatedConfiguration should accept apikey', async () => {
  expect(
    ibmcr.validateConfiguration({
      apikey: 'api-key',
    }),
  ).toStrictEqual({
    apikey: 'api-key',
  });
});

test('init should map apikey to iamapikey credentials', async () => {
  const ibmcrWithApiKey = new Ibmcr();
  ibmcrWithApiKey.configuration = {
    apikey: 'api-key',
  };

  ibmcrWithApiKey.init();

  expect(ibmcrWithApiKey.configuration).toEqual({
    apikey: 'api-key',
    login: 'iamapikey',
    password: 'api-key',
  });
});

test('match should return true for icr domains', async () => {
  expect(
    ibmcr.match({
      registry: {
        url: 'us.icr.io',
      },
    }),
  ).toBeTruthy();
});

test('match should return false for non-icr domains', async () => {
  expect(
    ibmcr.match({
      registry: {
        url: 'docker.io',
      },
    }),
  ).toBeFalsy();
});

test('normalizeImage should return proper v2 endpoint', async () => {
  expect(
    ibmcr.normalizeImage({
      name: 'namespace/repository',
      registry: {
        url: 'us.icr.io',
      },
    }),
  ).toStrictEqual({
    name: 'namespace/repository',
    registry: {
      url: 'https://us.icr.io/v2',
    },
  });
});

test('maskConfiguration should mask credentials', async () => {
  expect(ibmcr.maskConfiguration()).toEqual({
    login: 'iamapikey',
    password: 'a*****y',
  });
});

test('maskConfiguration should mask apikey', async () => {
  const ibmcrWithApiKey = new Ibmcr();
  ibmcrWithApiKey.configuration = {
    apikey: 'api-key',
  };

  expect(ibmcrWithApiKey.maskConfiguration()).toEqual({
    apikey: 'a*****y',
  });
});
