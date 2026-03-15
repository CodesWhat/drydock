import { createMockRequest, createMockResponse } from '../../test/helpers.js';

const {
  mockRouter,
  mockGetWebhookConfiguration,
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
        markContainerFresh: expect.any(Function),
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
});
