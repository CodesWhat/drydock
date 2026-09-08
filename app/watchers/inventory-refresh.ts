import { randomUUID } from 'node:crypto';
import type {
  InventoryRefreshOptions,
  InventoryRefreshResult,
} from '../model/inventory-refresh.js';

export interface InventoryRefreshProvider {
  refreshInventory?: (options?: InventoryRefreshOptions) => Promise<InventoryRefreshResult>;
  isInventoryRefreshSupported?: () => boolean;
}

export class InventoryRefreshOperationError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const activeRefreshes = new WeakMap<InventoryRefreshProvider, AbortController>();

export function isInventoryRefreshSupported(provider: InventoryRefreshProvider): boolean {
  return (
    typeof provider.refreshInventory === 'function' &&
    (provider.isInventoryRefreshSupported?.() ?? true)
  );
}

export async function runInventoryRefresh(
  provider: InventoryRefreshProvider,
  options: InventoryRefreshOptions = {},
): Promise<InventoryRefreshResult> {
  if (!isInventoryRefreshSupported(provider)) {
    throw new InventoryRefreshOperationError(
      501,
      'Inventory refresh is not supported by this watcher',
    );
  }
  activeRefreshes.get(provider)?.abort();
  const cancellation = new AbortController();
  activeRefreshes.set(provider, cancellation);
  const abort = () => cancellation.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const isCurrent = () =>
    activeRefreshes.get(provider) === cancellation &&
    !cancellation.signal.aborted &&
    (options.isCurrent?.() ?? true);
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => {
        cancellation.abort();
        reject(new InventoryRefreshOperationError(504, 'Inventory refresh timed out'));
      }, 30_000);
    });
    const result = await Promise.race([
      provider.refreshInventory!({
        operationId: options.operationId ?? randomUUID(),
        signal: cancellation.signal,
        isCurrent,
      }),
      timeout,
    ]);
    if (!isCurrent()) {
      return {
        ...result,
        authoritative: false,
        errors: [
          ...result.errors,
          { phase: 'stale', message: 'Inventory request is no longer current' },
        ],
      };
    }
    return result;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', abort);
    cancellation.abort();
    if (activeRefreshes.get(provider) === cancellation) activeRefreshes.delete(provider);
  }
}
