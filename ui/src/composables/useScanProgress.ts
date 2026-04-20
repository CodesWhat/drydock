import { readonly, ref } from 'vue';
import { scanAllContainersApi } from '../services/container';
import { ApiError } from '../utils/error';

const scanning = ref(false);
const scanProgress = ref({ done: 0, total: 0 });
const currentCycleId = ref<string | null>(null);
let scanAbortController: AbortController | null = null;

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

interface ScanAllContainersOptions {
  scannerReady: boolean;
  runtimeLoading: boolean;
}

function canStartScan(opts: ScanAllContainersOptions) {
  if (scanning.value) {
    return false;
  }
  if (opts.runtimeLoading || !opts.scannerReady) {
    return false;
  }
  return true;
}

function startScanSession() {
  scanAbortController = new AbortController();
  const { signal } = scanAbortController;
  scanning.value = true;
  scanProgress.value = { done: 0, total: 0 };
  currentCycleId.value = null;
  return signal;
}

function endScanSession() {
  scanAbortController = null;
  scanning.value = false;
  currentCycleId.value = null;
}

async function processContainerBatch(signal: AbortSignal) {
  const result = await scanAllContainersApi(signal);
  currentCycleId.value = result.cycleId;
  scanProgress.value.total = result.scheduledCount;

  if (result.scheduledCount === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const onScanCompleted = () => {
      scanProgress.value.done = Math.min(scanProgress.value.done + 1, scanProgress.value.total);
      if (scanProgress.value.done >= scanProgress.value.total) {
        cleanup();
        resolve();
      }
    };

    const onAbort = () => {
      cleanup();
      resolve();
    };

    function cleanup() {
      globalThis.removeEventListener('dd:sse-scan-completed', onScanCompleted);
      signal.removeEventListener('abort', onAbort);
    }

    globalThis.addEventListener('dd:sse-scan-completed', onScanCompleted);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function scanAllContainers(opts: ScanAllContainersOptions) {
  if (!canStartScan(opts)) {
    return;
  }

  const signal = startScanSession();
  try {
    await processContainerBatch(signal);
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 429) {
      throw error;
    }
    if (!isAbortError(error)) {
      throw error;
    }
    // AbortError = user cancellation, treat as clean exit
  } finally {
    endScanSession();
  }
}

function cancelScan() {
  scanAbortController?.abort();
}

export function useScanProgress() {
  return {
    scanning: readonly(scanning),
    scanProgress: readonly(scanProgress),
    currentCycleId: readonly(currentCycleId),
    scanAllContainers,
    cancelScan,
  };
}
