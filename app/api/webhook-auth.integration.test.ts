/**
 * Per-endpoint webhook credentials against a real Express router. Express
 * routes case-insensitively by default, so the credential selection has to
 * classify the path the same way or a shared credential slips through on
 * `/UPDATE/x` while endpoint credentials are configured. `webhook.test.ts`
 * hand-builds `req.path` and cannot see that.
 */
import http from 'node:http';
import express from 'express';

const mocks = vi.hoisted(() => ({
  getWebhookConfiguration: vi.fn(),
  getContainers: vi.fn(),
  getState: vi.fn(),
  requestContainerUpdate: vi.fn(),
  triggerManualWatch: vi.fn(),
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock('../configuration/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../configuration/index.js')>()),
  getWebhookConfiguration: mocks.getWebhookConfiguration,
}));
vi.mock('../store/container.js', () => ({ getContainers: mocks.getContainers }));
vi.mock('../registry/index.js', () => ({ getState: mocks.getState }));
vi.mock('../updates/request-update.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../updates/request-update.js')>()),
  requestContainerUpdate: mocks.requestContainerUpdate,
}));
vi.mock('../watchers/manual-watch.js', () => ({ triggerManualWatch: mocks.triggerManualWatch }));
vi.mock('./audit-events.js', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('../prometheus/webhook.js', () => ({ getWebhookCounter: vi.fn() }));

import * as webhookRouter from './webhook.js';

const SHARED = 'shared-secret';
const TOKENS = { watchall: 'tok-watchall', watch: 'tok-watch', update: 'tok-update' };

function configure(overrides: Record<string, unknown> = {}) {
  mocks.getWebhookConfiguration.mockReturnValue({
    enabled: true,
    token: SHARED,
    tokens: { ...TOKENS },
    ...overrides,
  });
}

describe('webhook per-endpoint credentials on a real router', () => {
  let server: http.Server;
  let port: number;
  const watcher = { watchContainer: vi.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const app = express();
    app.use('/api/v1/webhook', webhookRouter.init());
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    configure();
    mocks.getContainers.mockReturnValue([{ id: 'c1', name: 'myapp', watcher: 'local' }]);
    mocks.getState.mockReturnValue({ watcher: { 'docker.local': watcher } });
    mocks.requestContainerUpdate.mockResolvedValue({ operationId: 'op-1' });
    mocks.triggerManualWatch.mockResolvedValue({ coalesced: false });
  });

  function post(path: string, credential: string) {
    return fetch(`http://127.0.0.1:${port}/api/v1/webhook${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}` },
    });
  }

  test.each([
    '/UPDATE/myapp',
    '/Update/myapp',
    '/UPDATE/myapp/',
    '/Watch/myapp',
    '/WATCH/myapp',
    '/WATCH/myapp/',
    '/Watch',
    '/WATCH',
    '/WATCH/',
  ])('rejects the shared credential on %s when endpoint credentials exist', async (path) => {
    const response = await post(path, SHARED);

    expect(response.status).toBe(401);
    expect(mocks.requestContainerUpdate).not.toHaveBeenCalled();
    expect(watcher.watchContainer).not.toHaveBeenCalled();
    expect(mocks.triggerManualWatch).not.toHaveBeenCalled();
  });

  test.each([
    ['/update/myapp', TOKENS.update],
    ['/UPDATE/myapp', TOKENS.update],
    ['/Update/myapp/', TOKENS.update],
  ])('accepts the update credential on %s', async (path, credential) => {
    const response = await post(path, credential);

    expect(response.status).toBe(202);
    expect(mocks.requestContainerUpdate).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['/watch/myapp', TOKENS.watch],
    ['/WATCH/myapp', TOKENS.watch],
  ])('accepts the watch credential on %s', async (path, credential) => {
    const response = await post(path, credential);

    expect(response.status).toBe(200);
    expect(watcher.watchContainer).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['/watch', TOKENS.watchall],
    ['/WATCH', TOKENS.watchall],
  ])('accepts the watch-all credential on %s', async (path, credential) => {
    const response = await post(path, credential);

    expect(response.status).toBe(200);
    expect(mocks.triggerManualWatch).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['/UPDATE/myapp', TOKENS.watch],
    ['/UPDATE/myapp', TOKENS.watchall],
    ['/WATCH/myapp', TOKENS.update],
    ['/WATCH', TOKENS.update],
  ])('rejects a different endpoint credential on %s', async (path, credential) => {
    const response = await post(path, credential);

    expect(response.status).toBe(401);
    expect(mocks.requestContainerUpdate).not.toHaveBeenCalled();
  });

  test('shared-only configuration still authenticates every path, case included', async () => {
    configure({ tokens: { watchall: '', watch: '', update: '' } });

    const lower = await post('/update/myapp', SHARED);
    const upper = await post('/UPDATE/myapp', SHARED);

    expect(lower.status).toBe(202);
    expect(upper.status).toBe(202);
  });

  test('a disabled webhook is rejected', async () => {
    configure({ enabled: false });

    const response = await post('/UPDATE/myapp', TOKENS.update);

    expect(response.status).toBe(403);
    expect(mocks.requestContainerUpdate).not.toHaveBeenCalled();
  });
});
