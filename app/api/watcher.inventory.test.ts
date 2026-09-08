import { EventEmitter } from 'node:events';
import * as agents from '../agent/manager.js';
import type { InventoryRefreshOptions } from '../model/inventory-refresh.js';
import * as registry from '../registry/index.js';
import { createContainerFixture } from '../test/helpers.js';
import { init } from './watcher.js';

vi.mock('../registry/index.js', () => ({ getState: vi.fn() }));
vi.mock('../agent/manager.js', () => ({ getAgent: vi.fn() }));

function request(params = {}, body: unknown = {}) {
  return Object.assign(new EventEmitter(), {
    params: { type: 'docker', name: 'local', ...params },
    body,
  });
}

function response() {
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    destroyed: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn((_body: unknown) => {
      res.writableEnded = true;
    }),
  });
  return res;
}

function handler(agent = false) {
  const path = agent ? '/:type/:name/:agent/inventory' : '/:type/:name/inventory';
  const router = init() as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: { post?: boolean };
        stack: Array<{ handle: (req: unknown, res: unknown) => Promise<void> }>;
      };
    }>;
  };
  const route = router.stack.find((layer) => layer.route?.path === path)?.route;
  expect(route?.methods.post).toBe(true);
  return route!.stack[0].handle;
}

function provider(agent?: string) {
  return {
    type: 'docker',
    name: 'local',
    agent,
    watch: vi.fn(),
    refreshInventory: vi.fn(async (options: InventoryRefreshOptions) => ({
      context: {
        origin: 'inventory' as const,
        operationId: options.operationId!,
        source: { type: 'docker' as const, name: 'local', ...(agent ? { agent } : {}) },
      },
      containers: [
        createContainerFixture({
          id: 'container',
          watcher: 'local',
          agent,
          details: { ports: [], volumes: [], env: [{ key: 'PASSWORD', value: 'private-value' }] },
        }),
      ],
      removedIds: [],
      errors: [],
      authoritative: true,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

test.each([undefined, 'Local'])(
  'refreshes the exact %s watcher with public redaction',
  async (agent) => {
    const watcher = provider(agent);
    vi.mocked(registry.getState).mockReturnValue({
      watcher: { [agent ? `${agent}.docker.local` : 'docker.local']: watcher },
    } as never);
    vi.mocked(agents.getAgent).mockReturnValue({ isConnected: true } as never);
    const res = response();
    await handler(Boolean(agent))(request(agent ? { agent } : {}), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          origin: 'inventory',
          operationId: expect.any(String),
          source: { type: 'docker', name: 'local', ...(agent ? { agent } : {}) },
        },
        authoritative: true,
        containers: [
          expect.objectContaining({
            details: {
              ports: [],
              volumes: [],
              env: [{ key: 'PASSWORD', value: '[REDACTED]', sensitive: true }],
            },
          }),
        ],
      }),
    );
    expect(watcher.watch).not.toHaveBeenCalled();
  },
);

test.each([
  ['missing', 404],
  ['unsupported', 501],
  ['disconnected', 503],
] as const)('returns %s without a full-watch fallback', async (reason, status) => {
  const watcher = provider('edge');
  if (reason === 'unsupported')
    Object.assign(watcher, { isInventoryRefreshSupported: () => false });
  vi.mocked(registry.getState).mockReturnValue({
    watcher: reason === 'missing' ? {} : { 'edge.docker.local': watcher },
  } as never);
  vi.mocked(agents.getAgent).mockReturnValue({ isConnected: reason !== 'disconnected' } as never);
  const res = response();
  await handler(true)(request({ agent: 'edge' }), res);
  expect(res.status).toHaveBeenCalledWith(status);
  expect(watcher.refreshInventory).not.toHaveBeenCalled();
  expect(watcher.watch).not.toHaveBeenCalled();
});

test('requires watch scope and rejects public operation-id injection', async () => {
  const watcher = provider();
  vi.mocked(registry.getState).mockReturnValue({ watcher: { 'docker.local': watcher } } as never);
  const denied = response();
  const req = Object.assign(request(), { principal: { kind: 'api-key', scopes: ['read'] } });
  await handler()(req, denied);
  expect(denied.status).toHaveBeenCalledWith(403);
  const invalid = response();
  await handler()(request({}, { operationId: 'chosen-by-public-client' }), invalid);
  expect(invalid.status).toHaveBeenCalledWith(400);
  expect(watcher.refreshInventory).not.toHaveBeenCalled();
});

test('aborts a timed-out operation before any late provider mutation can be current', async () => {
  vi.useFakeTimers();
  const watcher = provider();
  let options!: InventoryRefreshOptions;
  watcher.refreshInventory.mockImplementation((received) => {
    options = received;
    return new Promise(() => {});
  });
  vi.mocked(registry.getState).mockReturnValue({ watcher: { 'docker.local': watcher } } as never);
  const res = response();
  const pending = handler()(request(), res);
  await vi.advanceTimersByTimeAsync(30_001);
  await pending;
  expect(res.status).toHaveBeenCalledWith(504);
  expect(options.signal?.aborted).toBe(true);
  expect(options.isCurrent?.()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

test.each([null, [], 'unexpected', 42])('rejects invalid public body %j', async (body) => {
  const res = response();
  await handler()(request({}, body), res);
  expect(res.status).toHaveBeenCalledWith(400);
});

test.each([true, false])(
  'returns honest empty inventory (authoritative=%s) with sanitized diagnostics',
  async (authoritative) => {
    const watcher = provider();
    watcher.refreshInventory.mockImplementation(async (options) => ({
      context: {
        origin: 'inventory',
        operationId: options.operationId!,
        source: { type: 'docker', name: 'local' },
      },
      containers: [],
      removedIds: [],
      authoritative,
      errors: authoritative
        ? []
        : [
            { phase: 'enumerate', message: 'password=private-value' },
            { phase: 'inspect', id: 'missing', message: 'https://user:password@host' },
          ],
    }));
    vi.mocked(registry.getState).mockReturnValue({ watcher: { 'docker.local': watcher } } as never);
    const req = request();
    delete (req as { body?: unknown }).body;
    const res = response();
    await handler()(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0] as {
      authoritative: boolean;
      containers: unknown[];
      errors: unknown[];
    };
    expect(body.authoritative).toBe(authoritative);
    expect(body.containers).toEqual([]);
    expect(body.errors).toEqual(
      authoritative
        ? []
        : [
            { phase: 'enumerate', message: 'Unable to enumerate Docker containers' },
            { phase: 'inspect', id: 'missing', message: 'Unable to inspect this container' },
          ],
    );
  },
);

test('does not expose unexpected provider error text', async () => {
  const watcher = provider();
  watcher.refreshInventory.mockRejectedValue(new Error('password=private-value'));
  vi.mocked(registry.getState).mockReturnValue({ watcher: { 'docker.local': watcher } } as never);
  const res = response();
  await handler()(request(), res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Inventory refresh failed' });
});

test.each(['watcher', 'client', 'disconnected'] as const)(
  'rejects a result after %s replacement or disconnect',
  async (changed) => {
    const watcher = provider('edge');
    const state = { watcher: { 'edge.docker.local': watcher } };
    const client = { isConnected: true };
    vi.mocked(registry.getState).mockReturnValue(state as never);
    vi.mocked(agents.getAgent).mockReturnValue(client as never);
    const refresh = watcher.refreshInventory.getMockImplementation()!;
    watcher.refreshInventory.mockImplementation(async (options) => {
      if (changed === 'watcher') state.watcher['edge.docker.local'] = provider('edge');
      else if (changed === 'client')
        vi.mocked(agents.getAgent).mockReturnValue({ isConnected: true } as never);
      else client.isConnected = false;
      return refresh(options);
    });
    const res = response();
    await handler(true)(request({ agent: 'edge' }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ authoritative: false }));
  },
);

test.each(['close', 'aborted'] as const)(
  'cancels on %s and does not write a destroyed response',
  async (closedEvent) => {
    const watcher = provider();
    const req = request();
    const res = response();
    const refresh = watcher.refreshInventory.getMockImplementation()!;
    watcher.refreshInventory.mockImplementation(async (options) => {
      res.destroyed = true;
      (closedEvent === 'close' ? res : req).emit(closedEvent);
      expect(options.signal?.aborted).toBe(true);
      return refresh(options);
    });
    vi.mocked(registry.getState).mockReturnValue({ watcher: { 'docker.local': watcher } } as never);
    await handler()(req, res);
    expect(res.json).not.toHaveBeenCalled();
    expect(req.listenerCount('aborted')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
  },
);

test.each([true, false])(
  'does not write an already-finished response when provider rejects=%s',
  async (rejects) => {
    const watcher = provider();
    const res = response();
    const refresh = watcher.refreshInventory.getMockImplementation()!;
    watcher.refreshInventory.mockImplementation(async (options) => {
      res.writableEnded = true;
      res.emit('close');
      expect(options.signal?.aborted).toBe(false);
      if (rejects) throw new Error('provider failed after response ended');
      return refresh(options);
    });
    vi.mocked(registry.getState).mockReturnValue({ watcher: { 'docker.local': watcher } } as never);
    await handler()(request(), res);
    expect(res.json).not.toHaveBeenCalled();
  },
);

test('does not write an error to a destroyed response', async () => {
  const watcher = provider();
  const res = response();
  watcher.refreshInventory.mockImplementation(async () => {
    res.destroyed = true;
    throw new Error('provider failed after disconnect');
  });
  vi.mocked(registry.getState).mockReturnValue({ watcher: { 'docker.local': watcher } } as never);
  await handler()(request(), res);
  expect(res.json).not.toHaveBeenCalled();
});
