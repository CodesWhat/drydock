import { readonly, ref } from 'vue';
import { getAllContainers, scanContainer } from '../services/container';
import { ApiError } from '../utils/error';

const scanning = ref(false);
const scanProgress = ref({ done: 0, total: 0 });
let scanAbortController: AbortController | null = null;

function createAbortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function scanContainerWithRetry(containerId: string, signal?: AbortSignal, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw createAbortError();
    }

    try {
      return await scanContainer(containerId, signal);
    } catch (e: unknown) {
      if (isAbortError(e) || signal?.aborted) {
        throw createAbortError();
      }

      const is429 = e instanceof ApiError && e.status === 429;
      if (is429 && attempt < maxRetries) {
        await sleep(12_000, signal);
        continue;
      }
      throw e;
    }
  }
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
  return signal;
}

function endScanSession() {
  scanAbortController = null;
  scanning.value = false;
}

function throwUnlessAbortError(error: unknown) {
  if (!isAbortError(error)) {
    throw error;
  }
}

async function processSingleContainer(containerId: string, signal: AbortSignal) {
  try {
    await scanContainerWithRetry(containerId, signal);
  } catch {
    if (signal.aborted) {
      return false;
    }
    // Individual scan failures shouldn't stop the batch
  }

  return !signal.aborted;
}

async function processContainerBatch(signal: AbortSignal) {
  const containers = await getAllContainers(signal);
  scanProgress.value.total = containers.length;

  for (const container of containers) {
    if (signal.aborted) {
      break;
    }

    const containerId = typeof container?.id === 'string' ? container.id : '';
    if (containerId === '') {
      scanProgress.value.done++;
      continue;
    }

    const shouldCountAsDone = await processSingleContainer(containerId, signal);
    if (!shouldCountAsDone) {
      break;
    }

    scanProgress.value.done++;
  }
}

async function scanAllContainers(opts: ScanAllContainersOptions) {
  if (!canStartScan(opts)) {
    return;
  }

  const signal = startScanSession();
  try {
    await processContainerBatch(signal);
  } catch (error: unknown) {
    throwUnlessAbortError(error);
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
    scanAllContainers,
    cancelScan,
  };
}
