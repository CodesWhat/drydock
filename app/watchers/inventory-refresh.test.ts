import { getEventListeners } from 'node:events';
import type {
  InventoryRefreshOptions,
  InventoryRefreshResult,
} from '../model/inventory-refresh.js';
import { isInventoryRefreshSupported, runInventoryRefresh } from './inventory-refresh.js';

function result(options: InventoryRefreshOptions): InventoryRefreshResult {
  return {
    context: {
      origin: 'inventory',
      operationId: options.operationId!,
      source: { type: 'docker', name: 'local' },
    },
    containers: [],
    removedIds: [],
    errors: [],
    authoritative: true,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('reports an obsolete provider result as stale even if the provider did not check its guard', async () => {
  let current = true;
  const provider = {
    refreshInventory: vi.fn(async (options: InventoryRefreshOptions) => {
      current = false;
      return result(options);
    }),
  };
  const refreshed = await runInventoryRefresh(provider, { isCurrent: () => current });
  expect(refreshed.authoritative).toBe(false);
  expect(refreshed.errors).toEqual([
    { phase: 'stale', message: 'Inventory request is no longer current' },
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

test('a newer request invalidates older work without letting old cleanup invalidate the new request', async () => {
  const options: InventoryRefreshOptions[] = [];
  const releases: Array<() => void> = [];
  const provider = {
    refreshInventory: vi.fn((received: InventoryRefreshOptions) => {
      options.push(received);
      return new Promise<InventoryRefreshResult>((resolve) => {
        releases.push(() => resolve(result(received)));
      });
    }),
  };
  const old = runInventoryRefresh(provider);
  const fresh = runInventoryRefresh(provider);
  expect(options[0].signal?.aborted).toBe(true);
  expect(options[0].isCurrent?.()).toBe(false);
  expect(options[1].isCurrent?.()).toBe(true);
  releases[0]();
  expect((await old).authoritative).toBe(false);
  expect(options[1].isCurrent?.()).toBe(true);
  releases[1]();
  expect((await fresh).authoritative).toBe(true);
  expect(options[1].isCurrent?.()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

test.each([true, false])(
  'honors an external cancellation (already aborted=%s) and removes its listener',
  async (alreadyAborted) => {
    const cancellation = new AbortController();
    if (alreadyAborted) cancellation.abort();
    let captured!: InventoryRefreshOptions;
    const provider = {
      refreshInventory: vi.fn(async (options: InventoryRefreshOptions) => {
        captured = options;
        cancellation.abort();
        return result(options);
      }),
    };
    const refreshed = await runInventoryRefresh(provider, { signal: cancellation.signal });
    expect(refreshed.authoritative).toBe(false);
    expect(captured.signal?.aborted).toBe(true);
    expect(getEventListeners(cancellation.signal, 'abort')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);

test('cleans up a rejected provider without altering its error', async () => {
  const error = new Error('provider failure');
  await expect(
    runInventoryRefresh({ refreshInventory: vi.fn().mockRejectedValue(error) }),
  ).rejects.toBe(error);
  expect(vi.getTimerCount()).toBe(0);
});

test('requires an implementation and respects explicit unsupported capability', async () => {
  expect(isInventoryRefreshSupported({})).toBe(false);
  const provider = { refreshInventory: vi.fn(), isInventoryRefreshSupported: () => false };
  await expect(runInventoryRefresh(provider)).rejects.toMatchObject({ status: 501 });
  expect(provider.refreshInventory).not.toHaveBeenCalled();
});
