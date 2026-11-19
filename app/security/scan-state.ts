/**
 * Transient "this container is being scanned right now" state.
 *
 * Lives in memory only. It is never written to the store, so a restart starts
 * clean and a crashed scan can never leave a container stuck as scanning.
 * Callers hold a reference for the lifetime of one scan and release it on every
 * exit path. References are counted per container so overlapping scans of the
 * same container (a scheduled cycle and an on-demand click, or two digest
 * groups) only clear the state when the last one finishes.
 */

export type ContainerScanStateListener = (containerId: string, scanning: boolean) => void;

const scansByContainerId = new Map<string, number>();
const listeners = new Set<ContainerScanStateListener>();

function notify(containerId: string, scanning: boolean): void {
  for (const listener of listeners) {
    try {
      listener(containerId, scanning);
    } catch {
      // A broken listener must never fail or leak a scan.
    }
  }
}

/**
 * Mark a container as scanning. Returns an idempotent release function; call it
 * from a `finally` so success, failure, timeout and abort all clear the state.
 */
export function beginContainerScan(containerId: string): () => void {
  const count = scansByContainerId.get(containerId) ?? 0;
  scansByContainerId.set(containerId, count + 1);
  if (count === 0) {
    notify(containerId, true);
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const remaining = (scansByContainerId.get(containerId) ?? 1) - 1;
    if (remaining > 0) {
      scansByContainerId.set(containerId, remaining);
      return;
    }
    scansByContainerId.delete(containerId);
    notify(containerId, false);
  };
}

export function isContainerScanning(containerId: string | undefined): boolean {
  return containerId !== undefined && scansByContainerId.has(containerId);
}

/** Subscribe to scanning/idle transitions. Returns an unsubscribe function. */
export function onContainerScanStateChange(listener: ContainerScanStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Overlay the transient state on an outgoing container payload. A container that
 * is not scanning is returned untouched.
 */
export function withTransientScanState<T>(container: T): T {
  if (!container || typeof container !== 'object') {
    return container;
  }
  const id = (container as { id?: unknown }).id;
  if (typeof id !== 'string' || !scansByContainerId.has(id)) {
    return container;
  }
  return { ...container, securityScanState: 'scanning' } as T;
}

export function _resetContainerScanStateForTesting(): void {
  scansByContainerId.clear();
  listeners.clear();
}
