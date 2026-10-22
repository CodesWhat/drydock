import { createMockRequest, createMockResponse } from '../../test/helpers.js';

const {
  mockRouter,
  mockGetWebhookConfiguration,
  mockGetRegistryWebhookAuthConfiguration,
  mockVerifyRegistryWebhookSignature,
  mockParseRegistryWebhookPayload,
  mockRunRegistryWebhookDispatch,
  mockGetContainers,
  mockGetState,
} = vi.hoisted(() => ({
  mockRouter: {
    use: vi.fn(),
    post: vi.fn(),
  },
  mockGetWebhookConfiguration: vi.fn(() => ({
    enabled: true,
    secret: 'webhook-secret',
    token: '',
    tokens: {
      watchall: '',
      watch: '',
      update: '',
    },
  })),
  mockGetRegistryWebhookAuthConfiguration: vi.fn(() => ({}) as Record<string, unknown>),
  mockVerifyRegistryWebhookSignature: vi.fn(() => ({ valid: true })),
  mockParseRegistryWebhookPayload: vi.fn(() => ({
    provider: 'dockerhub',
    references: [{ image: 'library/nginx', tag: 'latest' }],
  })),
  mockRunRegistryWebhookDispatch: vi.fn(() =>
    Promise.resolve({
      referencesMatched: 1,
      containersMatched: 1,
      checksTriggered: 1,
      checksFailed: 0,
      watchersMissing: 0,
    }),
  ),
  mockGetContainers: vi.fn(() => [
    { id: 'c1', watcher: 'local', image: { name: 'library/nginx' } },
  ]),
  mockGetState: vi.fn(() => ({
    watcher: {
      'docker.local': {
        watchContainer: vi.fn().mockResolvedValue(undefined),
      },
    },
    trigger: {},
  })),
}));

vi.mock('express', () => ({
  default: {
    Router: vi.fn(() => mockRouter),
  },
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => 'rate-limit-middleware'),
}));

vi.mock('nocache', () => ({
  default: vi.fn(() => 'nocache-middleware'),
}));

vi.mock('../../configuration/index.js', () => ({
  getWebhookConfiguration: mockGetWebhookConfiguration,
  getRegistryWebhookAuthConfiguration: mockGetRegistryWebhookAuthConfiguration,
}));

vi.mock('./signature.js', () => ({
  verifyRegistryWebhookSignature: mockVerifyRegistryWebhookSignature,
}));

vi.mock('./parsers/index.js', () => ({
  parseRegistryWebhookPayload: mockParseRegistryWebhookPayload,
}));

vi.mock('./registry-dispatch.js', () => ({
  runRegistryWebhookDispatch: mockRunRegistryWebhookDispatch,
}));

vi.mock('../../store/container.js', () => ({
  getContainers: mockGetContainers,
}));

vi.mock('../../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../../watchers/registry-webhook-fresh.js', () => ({
  markContainerFreshForScheduledPollSkip: vi.fn(),
}));

vi.mock('../../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));

import { markContainerFreshForScheduledPollSkip } from '../../watchers/registry-webhook-fresh.js';
import * as registryWebhookRouter from './registry.js';

function getHandler() {
  registryWebhookRouter.init();
  const postCall = mockRouter.post.mock.calls.find((call) => call[0] === '/');
  return postCall?.[1];
}

describe('api/webhooks/registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWebhookConfiguration.mockReturnValue({
      enabled: true,
      secret: 'webhook-secret',
      token: '',
      tokens: {
        watchall: '',
        watch: '',
        update: '',
      },
    });
    mockVerifyRegistryWebhookSignature.mockReturnValue({ valid: true });
    mockParseRegistryWebhookPayload.mockReturnValue({
      provider: 'dockerhub',
      references: [{ image: 'library/nginx', tag: 'latest' }],
    });
    mockRunRegistryWebhookDispatch.mockResolvedValue({
      referencesMatched: 1,
      containersMatched: 1,
      checksTriggered: 1,
      checksFailed: 0,
      watchersMissing: 0,
    });
  });

  test('registers middleware and POST route', () => {
    registryWebhookRouter.init();

    expect(mockRouter.use).toHaveBeenCalledWith('rate-limit-middleware');
    expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
    expect(mockRouter.post).toHaveBeenCalledWith('/', expect.any(Function));
    expect(mockRouter.post).toHaveBeenCalledWith('/:provider', expect.any(Function));
    expect(mockRouter.post).toHaveBeenCalledWith('/:provider/:secret', expect.any(Function));
  });

  test('returns 403 when registry webhooks are disabled', async () => {
    mockGetWebhookConfiguration.mockReturnValue({
      enabled: false,
      secret: 'webhook-secret',
      token: '',
      tokens: { watchall: '', watch: '', update: '' },
    });
    const handler = getHandler();
    const req = createMockRequest({ body: {}, headers: {} });
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Registry webhooks are disabled' });
  });

  test('returns 500 when webhook secret is missing', async () => {
    mockGetWebhookConfiguration.mockReturnValue({
      enabled: true,
      secret: '',
      token: '',
      tokens: { watchall: '', watch: '', update: '' },
    });
    const handler = getHandler();
    const req = createMockRequest({ body: {}, headers: {} });
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Registry webhook secret is not configured' });
  });

  test('returns 401 when signature verification fails', async () => {
    mockVerifyRegistryWebhookSignature.mockReturnValue({
      valid: false,
      reason: 'invalid-signature',
    });
    const handler = getHandler();
    const req = createMockRequest({
      body: {},
      headers: {
        'x-hub-signature-256': 'sha256=bad',
      },
    });
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid registry webhook signature' });
  });

  test('returns 401 when registry webhook signature is missing', async () => {
    mockVerifyRegistryWebhookSignature.mockReturnValue({
      valid: false,
      reason: 'missing-signature',
    });
    const handler = getHandler();
    const req = createMockRequest({
      body: {},
      headers: {},
    });
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(mockVerifyRegistryWebhookSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: undefined,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing registry webhook signature' });
  });

  test('returns 400 when payload is not supported', async () => {
    mockParseRegistryWebhookPayload.mockReturnValue(undefined);
    const handler = getHandler();
    const req = createMockRequest({
      body: { unsupported: true },
      headers: {
        'x-hub-signature-256': 'sha256=test',
      },
      rawBody: Buffer.from('{"unsupported":true}'),
    });
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unsupported registry webhook payload' });
  });

  test('dispatches checks and returns 202 for valid webhook payloads', async () => {
    const handler = getHandler();
    const req = createMockRequest({
      body: { test: true },
      headers: {
        'x-hub-signature-256': 'sha256=test',
      },
      rawBody: Buffer.from('{"test":true}'),
    });
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(mockRunRegistryWebhookDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [{ image: 'library/nginx', tag: 'latest' }],
        containers: expect.any(Array),
        watchers: expect.any(Object),
        markContainerFresh: markContainerFreshForScheduledPollSkip,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Registry webhook processed',
      result: {
        provider: 'dockerhub',
        referencesMatched: 1,
        containersMatched: 1,
        checksTriggered: 1,
        checksFailed: 0,
        watchersMissing: 0,
      },
    });
  });

  test('extracts x-drydock-signature and uses string body when raw body is absent', async () => {
    const handler = getHandler();
    const req = createMockRequest({
      body: '{"event":"push"}',
      headers: {
        'x-drydock-signature': 'sha256=test',
      },
    });
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(mockVerifyRegistryWebhookSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: 'sha256=test',
        payload: Buffer.from('{"event":"push"}'),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test('uses an empty object payload when both rawBody and body are missing', async () => {
    const handler = getHandler();
    const req = createMockRequest({
      headers: {
        'x-drydock-signature': 'sha256=test',
      },
    });
    delete (req as any).body;
    const res = createMockResponse();

    await handler(req as any, res as any);

    expect(mockVerifyRegistryWebhookSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: 'sha256=test',
        payload: Buffer.from('{}'),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(202);
  });

  describe('provider-scoped static secret endpoint', () => {
    const STATIC_SECRET = 'static-secret-0123456789';

    function getProviderHandler(route = '/:provider/:secret') {
      registryWebhookRouter.init();
      return mockRouter.post.mock.calls.find((call) => call[0] === route)?.[1];
    }

    beforeEach(() => {
      mockGetRegistryWebhookAuthConfiguration.mockReturnValue({
        dockerhub: { modes: ['path', 'query'], staticSecret: STATIC_SECRET },
        harbor: { modes: ['bearer'], staticSecret: STATIC_SECRET },
        quay: { modes: ['hmac'], staticSecret: '' },
      });
    });

    test('returns 403 when registry webhooks are disabled', async () => {
      mockGetWebhookConfiguration.mockReturnValue({ enabled: false } as any);
      const res = createMockResponse();
      await getProviderHandler()(
        createMockRequest({ params: { provider: 'dockerhub', secret: STATIC_SECRET } }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('returns 404 for an unknown provider, including inherited property names', async () => {
      const handler = getProviderHandler();
      for (const provider of ['nope', 'constructor']) {
        const res = createMockResponse();
        await handler(
          createMockRequest({ params: { provider, secret: STATIC_SECRET } }) as any,
          res as any,
        );
        expect(res.status).toHaveBeenCalledWith(404);
      }
    });

    test('accepts the path secret, dispatches and returns 202', async () => {
      const res = createMockResponse();
      await getProviderHandler()(
        createMockRequest({
          params: { provider: 'DockerHub', secret: STATIC_SECRET },
          body: { push_data: {} },
          headers: {},
        }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(202);
      expect(mockRunRegistryWebhookDispatch).toHaveBeenCalledTimes(1);
    });

    test('accepts the query secret on the provider-only route', async () => {
      const res = createMockResponse();
      await getProviderHandler('/:provider')(
        createMockRequest({
          params: { provider: 'dockerhub' },
          query: { secret: STATIC_SECRET },
          body: {},
          headers: {},
        }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });

    test('accepts a Bearer secret for a bearer provider', async () => {
      mockParseRegistryWebhookPayload.mockReturnValue({
        provider: 'harbor',
        references: [{ image: 'library/nginx', tag: 'latest' }],
      } as any);
      const res = createMockResponse();
      await getProviderHandler('/:provider')(
        createMockRequest({
          params: { provider: 'harbor' },
          body: {},
          headers: { authorization: `Bearer ${STATIC_SECRET}` },
        }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });

    test('returns 401 invalid for a wrong secret and never logs or echoes it', async () => {
      const res = createMockResponse();
      await getProviderHandler()(
        createMockRequest({
          params: { provider: 'dockerhub', secret: 'wrong-secret-value-123' },
          originalUrl: '/api/v1/webhooks/registry/dockerhub/wrong-secret-value-123',
          body: {},
          headers: {},
        }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid registry webhook credentials' });
      expect(JSON.stringify(res.json.mock.calls)).not.toContain('wrong-secret-value-123');
    });

    test('returns 401 missing when the provider is HMAC-only and no signature is sent', async () => {
      mockParseRegistryWebhookPayload.mockClear();
      mockVerifyRegistryWebhookSignature.mockReturnValue({
        valid: false,
        reason: 'missing-signature',
      });
      const res = createMockResponse();
      await getProviderHandler('/:provider')(
        createMockRequest({ params: { provider: 'quay' }, body: {}, headers: {} }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing registry webhook credentials' });
      expect(mockParseRegistryWebhookPayload).not.toHaveBeenCalled();
    });

    test('falls back to an empty HMAC secret and handles a missing request url', async () => {
      mockGetWebhookConfiguration.mockReturnValue({ enabled: true } as any);
      mockVerifyRegistryWebhookSignature.mockReturnValue({
        valid: false,
        reason: 'invalid-signature',
      });
      const res = createMockResponse();
      await getProviderHandler('/:provider')(
        createMockRequest({
          params: { provider: 'quay' },
          body: {},
          headers: { 'x-quay-signature': 'sha256=abcd' },
        }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('returns 400 when the payload parses as a different provider than the URL', async () => {
      mockParseRegistryWebhookPayload.mockReturnValue({
        provider: 'quay',
        references: [{ image: 'x/y', tag: 'z' }],
      } as any);
      const res = createMockResponse();
      await getProviderHandler()(
        createMockRequest({
          params: { provider: 'dockerhub', secret: STATIC_SECRET },
          body: {},
          headers: {},
        }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockRunRegistryWebhookDispatch).not.toHaveBeenCalled();
    });

    test('treats a missing provider param as unknown', async () => {
      const res = createMockResponse();
      await getProviderHandler()(createMockRequest({ params: {} }) as any, res as any);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
