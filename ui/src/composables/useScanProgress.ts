import { readonly, ref, watch } from 'vue';
import { i18n } from '../boot/i18n';
import { scanAllContainersApi } from '../services/container';
import { type ScanLifecyclePayload, useEventStreamStore } from '../stores/eventStream';
import { ApiError } from '../utils/error';

const scanning = ref(false);
const scanProgress = ref({ done: 0, total: 0 });
const currentCycleId = ref<string | null>(null);
let scanAbortController: AbortController | null = null;
const MAX_EARLY_COMPLETIONS = 500;
const ACCEPTANCE_TIMEOUT_MS = 30_000;

interface ScanAllContainersOptions {
  scannerReady: boolean;
  runtimeLoading: boolean;
}

function progressUnavailable() {
  return new ApiError(i18n.global.t('securityView.scanProgressUnavailable'), 0);
}

function completionIdentity(payload: unknown): { containerId: string; cycleId: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const { containerId, cycleId } = payload as ScanLifecyclePayload;
  return typeof containerId === 'string' &&
    containerId.trim() !== '' &&
    typeof cycleId === 'string' &&
    cycleId.trim() !== ''
    ? { containerId, cycleId }
    : null;
}

async function processContainerBatch(
  signal: AbortSignal,
  stream: ReturnType<typeof useEventStreamStore>,
) {
  const finished = Promise.withResolvers<void>();
  const cancelled = Symbol('cancelled');
  const completed = new Set<string>();
  let early: { containerId: string; cycleId: string }[] | null = [];
  const onAbort = () => finished.resolve();
  const unavailable = () => finished.reject(progressUnavailable());

  function onCompleted(payload: unknown) {
    const identity = completionIdentity(payload);
    if (!identity || signal.aborted) return;
    if (early !== null) {
      if (early.length >= MAX_EARLY_COMPLETIONS) unavailable();
      else early.push(identity);
      return;
    }
    if (identity.cycleId !== currentCycleId.value || completed.has(identity.containerId)) return;
    if (completed.size >= scanProgress.value.total) return;
    completed.add(identity.containerId);
    scanProgress.value.done = completed.size;
    if (completed.size === scanProgress.value.total) finished.resolve();
  }

  // Subscribe before POST: cached scans can finish before its response arrives.
  const unsubscribeCompleted = stream.subscribe('scan-completed', onCompleted);
  const unsubscribeResync = stream.subscribe('resync-required', unavailable);
  const stopWatching = watch(
    () => stream.status,
    (status) => {
      if (status !== 'open') unavailable();
    },
    { flush: 'sync' },
  );
  signal.addEventListener('abort', onAbort, { once: true });
  const acceptanceDeadline = setTimeout(unavailable, ACCEPTANCE_TIMEOUT_MS);
  try {
    const result = await Promise.race([
      scanAllContainersApi(signal),
      finished.promise.then(() => cancelled),
    ]);
    clearTimeout(acceptanceDeadline);
    if (signal.aborted || typeof result === 'symbol') return;
    if (
      !result ||
      typeof result.cycleId !== 'string' ||
      !result.cycleId.trim() ||
      !Number.isSafeInteger(result.scheduledCount) ||
      result.scheduledCount < 0
    ) {
      throw progressUnavailable();
    }
    currentCycleId.value = result.cycleId;
    scanProgress.value.total = result.scheduledCount;
    const buffered = early;
    early = null;
    for (const payload of buffered) onCompleted(payload);
    if (result.scheduledCount === 0) finished.resolve();
    await finished.promise;
  } finally {
    clearTimeout(acceptanceDeadline);
    unsubscribeCompleted();
    unsubscribeResync();
    stopWatching();
    signal.removeEventListener('abort', onAbort);
  }
}

async function scanAllContainers(opts: ScanAllContainersOptions) {
  if (scanning.value || opts.runtimeLoading || !opts.scannerReady) return;
  const stream = useEventStreamStore();
  if (stream.status !== 'open') throw progressUnavailable();
  const controller = new AbortController();
  scanAbortController = controller;
  scanning.value = true;
  scanProgress.value = { done: 0, total: 0 };
  currentCycleId.value = null;
  try {
    await processContainerBatch(controller.signal, stream);
  } catch (error: unknown) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  } finally {
    controller.abort();
    scanAbortController = null;
    scanning.value = false;
    currentCycleId.value = null;
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
