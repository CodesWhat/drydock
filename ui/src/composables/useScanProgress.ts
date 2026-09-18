import { readonly, ref, watch } from 'vue';
import { i18n } from '../boot/i18n';
import { scanAllContainersApi } from '../services/container';
import { type ScanLifecyclePayload, useEventStreamStore } from '../stores/eventStream';
import { ApiError } from '../utils/error';

const scanning = ref(false);
const scanProgress = ref({ done: 0, total: 0 });
const currentCycleId = ref<string | null>(null);
let scanAbortController: AbortController | null = null;
const ACCEPTANCE_TIMEOUT_MS = 30_000;

interface ScanAllContainersOptions {
  scannerReady: boolean;
  runtimeLoading: boolean;
}

export class ScanProgressUnavailableError extends ApiError {}

function progressUnavailable() {
  return new ScanProgressUnavailableError(i18n.global.t('securityView.scanProgressUnavailable'), 0);
}

async function processContainerBatch(
  signal: AbortSignal,
  stream: ReturnType<typeof useEventStreamStore>,
) {
  const finished = Promise.withResolvers<void>();
  const cancelled = Symbol('cancelled');
  const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  let latest: { cycleId: string; done: number; total: number } | null = null;
  let accepted = false;
  let failed = false;
  const onAbort = () => finished.resolve();
  const unavailable = () => {
    failed = true;
    finished.reject(progressUnavailable());
  };

  function applyProgress() {
    if (!accepted || failed) return;
    scanProgress.value.done = latest?.done ?? 0;
    if (scanProgress.value.done === scanProgress.value.total) finished.resolve();
  }

  function onCompleted(payload: unknown) {
    if (!payload || typeof payload !== 'object' || signal.aborted || failed) return;
    const progress = payload as ScanLifecyclePayload;
    if (progress.requestId !== requestId) return;
    const { cycleId, completedCount: done, scheduledCount: total } = progress;
    if (
      typeof cycleId !== 'string' ||
      !cycleId.trim() ||
      typeof done !== 'number' ||
      !Number.isSafeInteger(done) ||
      done < 0 ||
      typeof total !== 'number' ||
      !Number.isSafeInteger(total) ||
      total < 0 ||
      done > total ||
      (latest && (cycleId !== latest.cycleId || total !== latest.total)) ||
      (accepted && (cycleId !== currentCycleId.value || total !== scanProgress.value.total))
    ) {
      unavailable();
      return;
    }
    latest = { cycleId, total, done: Math.max(latest?.done ?? 0, done) };
    applyProgress();
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
      scanAllContainersApi(signal, requestId),
      finished.promise.then(() => cancelled),
    ]);
    clearTimeout(acceptanceDeadline);
    if (signal.aborted || typeof result === 'symbol') return;
    if (
      !result ||
      result.requestId !== requestId ||
      typeof result.cycleId !== 'string' ||
      !result.cycleId.trim() ||
      !Number.isSafeInteger(result.scheduledCount) ||
      result.scheduledCount < 0 ||
      (latest && (latest.cycleId !== result.cycleId || latest.total !== result.scheduledCount))
    ) {
      throw progressUnavailable();
    }
    currentCycleId.value = result.cycleId;
    scanProgress.value.total = result.scheduledCount;
    accepted = true;
    applyProgress();
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
