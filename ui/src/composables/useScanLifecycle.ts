import { readonly, ref } from 'vue';

// Manual scan POSTs may take 30+ seconds while Trivy runs server-side; we cap
// the per-row spinner at 120s so a dropped completion event can never leave a
// row spinning forever. Real scans that exceed the cap will be reconciled by
// the next dd:sse-scan-completed event or page reload.
const SCAN_LIFECYCLE_TIMEOUT_MS = 120_000;

const scansInFlight = ref(new Set<string>());
const scanTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function clearScanTimeout(containerId: string): void {
  const handle = scanTimeouts.get(containerId);
  if (handle !== undefined) {
    clearTimeout(handle);
    scanTimeouts.delete(containerId);
  }
}

function setScansInFlight(next: Set<string>): void {
  scansInFlight.value = next;
}

function markScanStarted(containerId: string | undefined): void {
  if (!containerId) {
    return;
  }
  clearScanTimeout(containerId);
  if (!scansInFlight.value.has(containerId)) {
    const next = new Set(scansInFlight.value);
    next.add(containerId);
    setScansInFlight(next);
  }
  scanTimeouts.set(
    containerId,
    setTimeout(() => {
      markScanCompleted(containerId);
    }, SCAN_LIFECYCLE_TIMEOUT_MS),
  );
}

function markScanCompleted(containerId: string | undefined): void {
  if (!containerId) {
    return;
  }
  clearScanTimeout(containerId);
  if (!scansInFlight.value.has(containerId)) {
    return;
  }
  const next = new Set(scansInFlight.value);
  next.delete(containerId);
  setScansInFlight(next);
}

function isScanInFlight(containerId: string | undefined): boolean {
  if (!containerId) {
    return false;
  }
  return scansInFlight.value.has(containerId);
}

function extractContainerId(detail: unknown): string | undefined {
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }
  const containerId = (detail as Record<string, unknown>).containerId;
  return typeof containerId === 'string' && containerId.length > 0 ? containerId : undefined;
}

// AppLayout re-emits the parsed SSE payload via these CustomEvents so the
// per-row spinner is driven entirely from the backend lifecycle and stays
// anchored to the right container regardless of whether the scan was started
// by a user click or by the cron scheduler.
globalThis.addEventListener('dd:sse-scan-started', (event: Event) => {
  markScanStarted(extractContainerId((event as CustomEvent).detail));
});
globalThis.addEventListener('dd:sse-scan-completed', (event: Event) => {
  markScanCompleted(extractContainerId((event as CustomEvent).detail));
});

export function useScanLifecycle() {
  return {
    scansInFlight: readonly(scansInFlight),
    markScanStarted,
    markScanCompleted,
    isScanInFlight,
  };
}

// Test-only reset hook so unit tests can isolate state across cases.
export function _resetScanLifecycleStateForTests(): void {
  for (const handle of scanTimeouts.values()) {
    clearTimeout(handle);
  }
  scanTimeouts.clear();
  scansInFlight.value = new Set();
}
