import { EventEmitter } from 'node:events';
import type { InventoryRefreshOptions } from '../../model/inventory-refresh.js';
import * as registry from '../../registry/index.js';
import { createContainerFixture } from '../../test/helpers.js';
import * as inventory from './watcher-inventory.js';

vi.mock('../../registry/index.js', () => ({ getState: vi.fn() }));

const operationId = '86348658-1933-4508-b3b7-52f7fdbed909';
function request(body: unknown = { operationId }) {
  return Object.assign(new EventEmitter(), {
    params: { type: 'docker', name: 'Case.Exact' },
    body,
  });
}
function response() {
  return Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  });
}
function provider() {
  return {
    watch: vi.fn(),
    refreshInventory: vi.fn(async (options: InventoryRefreshOptions) => ({
      context: {
        origin: 'inventory' as const,
        operationId: options.operationId!,
        source: { type: 'docker' as const, name: 'Case.Exact' },
      },
      containers: [
        createContainerFixture({
          watcher: 'Case.Exact',
          details: {
            ports: [],
            volumes: [],
            env: [{ key: 'PASSWORD', value: 'raw-authenticated-value' }],
          },
        }),
      ],
      removedIds: [],
      errors: [],
      authoritative: true,
    })),
  };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

test('uses the controller operation identity and retains raw authenticated replication', async () => {
  const watcher = provider();
  vi.mocked(registry.getState).mockReturnValue({
    watcher: { 'docker.Case.Exact': watcher },
  } as never);
  const res = response();
  await inventory.refreshWatcherInventory(request() as never, res as never);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      context: { origin: 'inventory', operationId, source: { type: 'docker', name: 'Case.Exact' } },
      containers: [
        expect.objectContaining({
          details: expect.objectContaining({
            env: [{ key: 'PASSWORD', value: 'raw-authenticated-value' }],
          }),
        }),
      ],
    }),
  );
  expect(watcher.refreshInventory).toHaveBeenCalledWith(expect.objectContaining({ operationId }));
  expect(watcher.watch).not.toHaveBeenCalled();
});

test.each([
  undefined,
  null,
  [[]],
  'string',
  {},
  { operationId: '' },
  { operationId: 'not-a-uuid' },
  { operationId, extra: true },
  { operationId: 12 },
])('rejects invalid native correlation body %j', async (body) => {
  const req = request();
  req.body = body;
  const res = response();
  await inventory.refreshWatcherInventory(req as never, res as never);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(registry.getState).not.toHaveBeenCalled();
});

test.each(['missing', 'unsupported'] as const)(
  'returns a typed %s response without scanning',
  async (reason) => {
    const watcher = { watch: vi.fn() };
    vi.mocked(registry.getState).mockReturnValue({
      watcher: reason === 'missing' ? {} : { 'docker.Case.Exact': watcher },
    } as never);
    const res = response();
    await inventory.refreshWatcherInventory(request() as never, res as never);
    expect(res.status).toHaveBeenCalledWith(reason === 'missing' ? 404 : 501);
    expect(watcher.watch).not.toHaveBeenCalled();
  },
);

test('invalidates the mutation guard when the exact watcher is replaced', async () => {
  const watcher = provider();
  const state = { watcher: { 'docker.Case.Exact': watcher } };
  vi.mocked(registry.getState).mockReturnValue(state as never);
  watcher.refreshInventory.mockImplementation(async (options) => {
    state.watcher['docker.Case.Exact'] = provider();
    expect(options.isCurrent!()).toBe(false);
    return {
      context: { origin: 'inventory', operationId, source: { type: 'docker', name: 'Case.Exact' } },
      containers: [],
      removedIds: [],
      errors: [],
      authoritative: false,
    };
  });
  const res = response();
  await inventory.refreshWatcherInventory(request() as never, res as never);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ authoritative: false }));
});

test('aborts timed-out native inventory and hides unexpected errors', async () => {
  vi.useFakeTimers();
  const watcher = provider();
  vi.mocked(registry.getState).mockReturnValue({
    watcher: { 'docker.Case.Exact': watcher },
  } as never);
  let received!: InventoryRefreshOptions;
  watcher.refreshInventory.mockImplementation((options) => {
    received = options;
    return new Promise(() => {});
  });
  const res = response();
  const pending = inventory.refreshWatcherInventory(request() as never, res as never);
  await vi.advanceTimersByTimeAsync(30_000);
  await pending;
  expect(received.signal!.aborted).toBe(true);
  expect(res.status).toHaveBeenCalledWith(504);
  watcher.refreshInventory.mockRejectedValue(new Error('private-daemon-secret'));
  const failed = response();
  await inventory.refreshWatcherInventory(request() as never, failed as never);
  expect(failed.status).toHaveBeenCalledWith(500);
  expect(JSON.stringify(failed.json.mock.calls)).not.toContain('private-daemon-secret');
});

test.each(['aborted', 'close'] as const)('cancels native inventory on %s', async (event) => {
  const watcher = provider();
  vi.mocked(registry.getState).mockReturnValue({
    watcher: { 'docker.Case.Exact': watcher },
  } as never);
  const req = request();
  const res = response();
  watcher.refreshInventory.mockImplementation(async (options) => {
    (event === 'aborted' ? req : res).emit(event);
    expect(options.isCurrent!()).toBe(false);
    return {
      context: { origin: 'inventory', operationId, source: { type: 'docker', name: 'Case.Exact' } },
      containers: [],
      removedIds: [],
      errors: [],
      authoritative: false,
    };
  });
  await inventory.refreshWatcherInventory(req as never, res as never);
  expect(req.listenerCount('aborted')).toBe(0);
  expect(res.listenerCount('close')).toBe(0);
});

test.each(['destroyed', 'writableEnded'] as const)(
  'does not write to a %s native response',
  async (field) => {
    const watcher = provider();
    vi.mocked(registry.getState).mockReturnValue({
      watcher: { 'docker.Case.Exact': watcher },
    } as never);
    const res = response();
    res[field] = true;
    const original = watcher.refreshInventory.getMockImplementation()!;
    watcher.refreshInventory.mockImplementation(async (options) => {
      res.emit('close');
      return original(options);
    });
    await inventory.refreshWatcherInventory(request() as never, res as never);
    expect(res.json).not.toHaveBeenCalled();
    watcher.refreshInventory.mockRejectedValue(new Error('private-failure'));
    await inventory.refreshWatcherInventory(request() as never, res as never);
    expect(res.json).not.toHaveBeenCalled();
  },
);
