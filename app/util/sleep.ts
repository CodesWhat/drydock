import { setTimeout as delay } from 'node:timers/promises';

// Without a signal this stays on the global setTimeout so fake timers keep
// working; with one it uses the abort-aware timers/promises variant.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal) {
    return delay(ms, undefined, { signal });
  }
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
