import { readonly, ref } from 'vue';
import { getAllContainers, scanContainer } from '../services/container';

const scanning = ref(false);
const scanProgress = ref({ done: 0, total: 0 });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scanContainerWithRetry(containerId: string, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await scanContainer(containerId);
    } catch (e: unknown) {
      const is429 = e instanceof Error && e.message.includes('Too Many Requests');
      if (is429 && attempt < maxRetries) {
        await sleep(12_000);
        continue;
      }
      throw e;
    }
  }
}

export interface ScanAllContainersOptions {
  scannerReady: boolean;
  runtimeLoading: boolean;
  onProgress?: () => void | Promise<void>;
}

async function scanAllContainers(opts: ScanAllContainersOptions) {
  if (scanning.value) return;
  if (opts.runtimeLoading || !opts.scannerReady) return;

  scanning.value = true;
  scanProgress.value = { done: 0, total: 0 };
  try {
    const containers = await getAllContainers();
    scanProgress.value.total = containers.length;
    for (const container of containers) {
      try {
        await scanContainerWithRetry(container.id);
      } catch {
        // Individual scan failures shouldn't stop the batch
      }
      scanProgress.value.done++;
      if (opts.onProgress) {
        await opts.onProgress();
      }
    }
  } finally {
    scanning.value = false;
  }
}

export function useScanProgress() {
  return {
    scanning: readonly(scanning),
    scanProgress: readonly(scanProgress),
    scanAllContainers,
  };
}
