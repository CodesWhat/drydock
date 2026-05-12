import axios from 'axios';
import Acr from '../acr/Acr.js';
import Alicr from '../alicr/Alicr.js';
import Artifactory from '../artifactory/Artifactory.js';
import Codeberg from '../codeberg/Codeberg.js';
import Forgejo from '../forgejo/Forgejo.js';
import Gitea from '../gitea/Gitea.js';
import Harbor from '../harbor/Harbor.js';
import Ibmcr from '../ibmcr/Ibmcr.js';
import Nexus from '../nexus/Nexus.js';
import Ocir from '../ocir/Ocir.js';

vi.mock('axios');

function createHttpError(message: string, status?: number) {
  const error = new Error(message);
  if (status) {
    (error as any).response = { status };
  }
  return error;
}

const basicAuthProviderCases = [
  {
    providerName: 'ACR',
    createRegistry: () => {
      const registry = new Acr();
      registry.configuration = {
        clientid: 'clientid',
        clientsecret: 'clientsecret',
      };
      return registry;
    },
    image: {
      name: 'project/app',
      registry: { url: 'https://example.azurecr.io/v2' },
    },
    expectedAuthorization: `Basic ${Buffer.from('clientid:clientsecret', 'utf-8').toString(
      'base64',
    )}`,
  },
  {
    providerName: 'Alibaba CR',
    createRegistry: () => {
      const registry = new Alicr();
      registry.configuration = {
        login: 'drydock',
        password: 'token',
      };
      return registry;
    },
    image: {
      name: 'namespace/repository',
      registry: { url: 'https://registry.cn-hangzhou.aliyuncs.com/v2' },
    },
    expectedAuthorization: `Basic ${Buffer.from('drydock:token', 'utf-8').toString('base64')}`,
  },
  {
    providerName: 'Artifactory',
    createRegistry: () => {
      const registry = new Artifactory();
      registry.configuration = {
        url: 'https://repo.acme.com',
        login: 'svc-drydock',
        password: 'secret',
      };
      return registry;
    },
    image: {
      name: 'docker-local/app',
      registry: { url: 'https://repo.acme.com/v2' },
    },
    expectedAuthorization: `Basic ${Buffer.from('svc-drydock:secret', 'utf-8').toString('base64')}`,
  },
  {
    providerName: 'Codeberg',
    createRegistry: () => {
      const registry = new Codeberg();
      registry.configuration = {
        url: 'https://codeberg.org',
        login: 'drydock',
        password: 'token',
      };
      return registry;
    },
    image: {
      name: 'owner/image',
      registry: { url: 'https://codeberg.org/v2' },
    },
    expectedAuthorization: `Basic ${Buffer.from('drydock:token', 'utf-8').toString('base64')}`,
  },
  {
    providerName: 'Forgejo',
    createRegistry: () => {
      const registry = new Forgejo();
      registry.configuration = {
        url: 'https://forgejo.acme.com',
        login: 'drydock',
        password: 'token',
      };
      return registry;
    },
    image: {
      name: 'owner/image',
      registry: { url: 'https://forgejo.acme.com/v2' },
    },
    expectedAuthorization: `Basic ${Buffer.from('drydock:token', 'utf-8').toString('base64')}`,
  },
  {
    providerName: 'Gitea',
    createRegistry: () => {
      const registry = new Gitea();
      registry.configuration = {
        url: 'https://gitea.acme.com',
        login: 'drydock',
        password: 'token',
      };
      return registry;
    },
    image: {
      name: 'owner/image',
      registry: { url: 'https://gitea.acme.com/v2' },
    },
    expectedAuthorization: `Basic ${Buffer.from('drydock:token', 'utf-8').toString('base64')}`,
  },
  {
    providerName: 'Harbor',
    createRegistry: () => {
      const registry = new Harbor();
      registry.configuration = {
        url: 'https://harbor.acme.com',
        login: 'robot$drydock',
        password: 'secret',
      };
      return registry;
    },
    image: {
      name: 'library/nginx',
      registry: { url: 'https://harbor.acme.com/v2' },
    },
    expectedAuthorization: `Basic ${Buffer.from('robot$drydock:secret', 'utf-8').toString(
      'base64',
    )}`,
  },
  {
    providerName: 'IBM CR',
    createRegistry: () => {
      const registry = new Ibmcr();
      registry.configuration = {
        login: 'iamapikey',
        password: 'api-key',
      };
      return registry;
    },
    image: {
      name: 'namespace/repository',
      registry: { url: 'https://us.icr.io/v2' },
    },
    expectedAuthorization: `Basic ${Buffer.from('iamapikey:api-key', 'utf-8').toString('base64')}`,
  },
  {
    providerName: 'Nexus',
    createRegistry: () => {
      const registry = new Nexus();
      registry.configuration = {
        url: 'https://nexus.acme.com',
        login: 'drydock',
        password: 'secret',
      };
      return registry;
    },
    image: {
      name: 'repo/app',
      registry: { url: 'https://nexus.acme.com/v2' },
    },
    expectedAuthorization: `Basic ${Buffer.from('drydock:secret', 'utf-8').toString('base64')}`,
  },
  {
    providerName: 'OCIR',
    createRegistry: () => {
      const registry = new Ocir();
      registry.configuration = {
        login: 'tenancy/my.user@acme.com',
        password: 'token',
      };
      return registry;
    },
    image: {
      name: 'namespace/repository',
      registry: { url: 'https://iad.ocir.io/v2' },
    },
    expectedAuthorization: `Basic ${Buffer.from('tenancy/my.user@acme.com:token', 'utf-8').toString(
      'base64',
    )}`,
  },
];

const registryFailureCases = basicAuthProviderCases.flatMap((providerCase) =>
  [
    {
      failureName: '429 rate limit',
      createError: () => createHttpError('Request failed with status code 429', 429),
      expectedMessage: 'Request failed with status code 429',
    },
    {
      failureName: '503 service unavailable',
      createError: () => createHttpError('Request failed with status code 503', 503),
      expectedMessage: 'Request failed with status code 503',
    },
    {
      failureName: 'timeout',
      createError: () => {
        const error = createHttpError('timeout of 15000ms exceeded');
        (error as any).code = 'ECONNABORTED';
        return error;
      },
      expectedMessage: 'timeout of 15000ms exceeded',
    },
  ].map((failureCase) => ({
    ...providerCase,
    ...failureCase,
  })),
);

beforeEach(() => {
  vi.clearAllMocks();
});

test.each(
  basicAuthProviderCases,
)('$providerName authenticate should add Basic auth without remote token request', async ({
  createRegistry,
  image,
  expectedAuthorization,
}) => {
  const registry = createRegistry();

  await expect(
    registry.authenticate(image, {
      url: `${image.registry.url}/${image.name}/tags/list`,
      headers: { Accept: 'application/json' },
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: expectedAuthorization,
      }),
    }),
  );
  expect(axios).not.toHaveBeenCalled();
});

test.each(
  registryFailureCases,
)('$providerName should propagate $failureName after Basic authenticate', async ({
  createRegistry,
  image,
  expectedAuthorization,
  createError,
  expectedMessage,
}) => {
  const registry = createRegistry();
  const requestUrl = `${image.registry.url}/${image.name}/tags/list`;
  axios.mockRejectedValueOnce(createError());

  await expect(
    registry.callRegistry({
      image,
      url: requestUrl,
      method: 'get',
    }),
  ).rejects.toThrow(expectedMessage);

  expect(axios).toHaveBeenCalledWith(
    expect.objectContaining({
      url: requestUrl,
      method: 'get',
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: expectedAuthorization,
      }),
    }),
  );
});
