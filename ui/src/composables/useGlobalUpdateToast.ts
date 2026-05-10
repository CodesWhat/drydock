import { onScopeDispose } from 'vue';
import { useI18n } from 'vue-i18n';
import { resolveUpdateFailureReason } from '../utils/update-error-summary';
import { useToast } from './useToast';

// Hold operationIds in the dedup window long enough that an SSE replay
// (Last-Event-ID buffer is 5 min server-side) cannot trigger a duplicate
// toast for the same terminal event.
const COMPLETED_OPERATION_TTL_MS = 5 * 60 * 1000;

// Hard ceiling on the dedup map size. The TTL alone bounds memory under
// normal use; this cap defends against runaway operation throughput
// (e.g. an agent loop) piling entries faster than the TTL can drain them.
const COMPLETED_OPERATION_MAX_ENTRIES = 500;

// Safety net: if no matching container-state event arrives (e.g., remote
// host whose state events do not relay, or the watcher missed the change)
// fire the toast after this delay so the user is never left without
// confirmation. The primary trigger is the container-state SSE event.
export const UPDATE_TOAST_FALLBACK_DELAY_MS = 5000;

// Module-level guard. The composable registers six globalThis listeners
// and is intended to be installed once at App.vue. A second call would
// silently double-fire every toast; we log and bail instead.
let installed = false;

interface PendingToast {
  containerId?: string;
  newContainerId?: string;
  containerName?: string;
  fire: () => void;
  timer: ReturnType<typeof setTimeout>;
}

function getDetailString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getDetail(event: Event): Record<string, unknown> | undefined {
  const detail = (event as CustomEvent)?.detail;
  return detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : undefined;
}

/**
 * Single source of truth for "container update finished" toasts.
 *
 * Mounted at App.vue so listeners survive route navigation. Previously this
 * lived in three places: ContainerUpdateDialog (per-instance), the per-view
 * SSE pipeline, and ContainersGroupedViews — each could miss or duplicate
 * the toast depending on which views were mounted.
 *
 * Toast firing waits for the container-state SSE event that actually
 * settles the row (added/updated/removed) so the toast appears at the
 * moment the "Updating" badge clears, not before. A 5s safety timer
 * ensures the toast still fires if no row event arrives (remote agents,
 * deleted containers).
 */
export function useGlobalUpdateToast() {
  if (installed) {
    console.warn('[useGlobalUpdateToast] already installed; ignoring duplicate call');
    return;
  }
  installed = true;

  const toast = useToast();
  const { t } = useI18n();

  // Dedup operationIds across SSE replay and across multiple SSE listeners.
  const completedOperationIds = new Map<string, ReturnType<typeof setTimeout>>();
  // Pending toasts waiting for a matching container-state event before firing.
  // Keyed by operationId when present, falling back to a containerName + nonce
  // synthetic key when the backend omits operationId.
  const pendingToasts = new Map<string, PendingToast>();
  let pendingNonce = 0;

  function recordCompleted(operationId: string) {
    if (completedOperationIds.size >= COMPLETED_OPERATION_MAX_ENTRIES) {
      // Map iteration is insertion-order; the first entry is the oldest.
      // Size check guarantees at least one entry, so the loop body always runs.
      for (const [oldestKey, oldestTimer] of completedOperationIds) {
        clearTimeout(oldestTimer);
        completedOperationIds.delete(oldestKey);
        break;
      }
    }
    const timer = setTimeout(() => {
      completedOperationIds.delete(operationId);
    }, COMPLETED_OPERATION_TTL_MS);
    completedOperationIds.set(operationId, timer);
  }

  function queuePending(args: {
    operationId?: string;
    containerId?: string;
    newContainerId?: string;
    containerName?: string;
    fire: () => void;
  }) {
    const key = args.operationId ?? `_anon_${++pendingNonce}`;
    const timer = setTimeout(() => {
      pendingToasts.delete(key);
      args.fire();
    }, UPDATE_TOAST_FALLBACK_DELAY_MS);
    pendingToasts.set(key, {
      containerId: args.containerId,
      newContainerId: args.newContainerId,
      containerName: args.containerName,
      fire: args.fire,
      timer,
    });
  }

  function settleByContainer(containerId: string | undefined, containerName: string | undefined) {
    if (!containerId && !containerName) return;
    for (const [key, entry] of pendingToasts) {
      const idMatch =
        (containerId && entry.containerId === containerId) ||
        (containerId && entry.newContainerId === containerId);
      const nameMatch = containerName && entry.containerName === containerName;
      if (idMatch || nameMatch) {
        pendingToasts.delete(key);
        clearTimeout(entry.timer);
        entry.fire();
      }
    }
  }

  function onUpdateApplied(event: Event) {
    const detail = getDetail(event);
    if (!detail) return;
    if (getDetailString(detail.batchId)) {
      return;
    }
    const operationId = getDetailString(detail.operationId);
    if (operationId && completedOperationIds.has(operationId)) {
      return;
    }
    if (operationId) {
      recordCompleted(operationId);
    }
    const name = getDetailString(detail.containerName) ?? 'container';
    queuePending({
      operationId,
      containerId: getDetailString(detail.containerId),
      newContainerId: getDetailString(detail.newContainerId),
      containerName: getDetailString(detail.containerName),
      fire: () => toast.success(t('containersView.toast.updated', { name })),
    });
  }

  function onUpdateFailed(event: Event) {
    const detail = getDetail(event);
    if (!detail) return;
    if (getDetailString(detail.batchId)) {
      return;
    }
    const operationId = getDetailString(detail.operationId);
    if (operationId && completedOperationIds.has(operationId)) {
      return;
    }
    if (operationId) {
      recordCompleted(operationId);
    }
    const name = getDetailString(detail.containerName) ?? 'container';
    const error = getDetailString(detail.error);
    const rollbackReason = getDetailString(detail.rollbackReason);
    const reason = resolveUpdateFailureReason({ lastError: error, rollbackReason });
    const isCancelled = rollbackReason === 'cancelled' || error === 'Cancelled by operator';
    queuePending({
      operationId,
      containerId: getDetailString(detail.containerId),
      newContainerId: getDetailString(detail.newContainerId),
      containerName: getDetailString(detail.containerName),
      fire: () => {
        if (rollbackReason) {
          if (isCancelled) {
            toast.success(t('containersView.toast.cancelled', { name }));
            return;
          }
          toast.warning(
            reason
              ? t('containersView.toast.rolledBackWithReason', { name, reason })
              : t('containersView.toast.rolledBack', { name }),
          );
          return;
        }
        toast.error(
          reason
            ? t('containersView.toast.updateFailedWithReason', { name, reason })
            : t('containersView.toast.updateFailed', { name }),
        );
      },
    });
  }

  function onContainerStateEvent(event: Event) {
    const detail = getDetail(event);
    if (!detail) return;
    const containerId = getDetailString(detail.id) ?? getDetailString(detail.containerId);
    const containerName = getDetailString(detail.name) ?? getDetailString(detail.containerName);
    settleByContainer(containerId, containerName);
  }

  function onBatchCompleted(event: Event) {
    const detail = getDetail(event);
    if (!detail) return;
    const batchId = getDetailString(detail.batchId);
    if (batchId && completedOperationIds.has(batchId)) {
      return;
    }
    if (batchId) {
      recordCompleted(batchId);
    }
    const total = typeof detail.total === 'number' ? detail.total : 0;
    const succeeded = typeof detail.succeeded === 'number' ? detail.succeeded : 0;
    const failed = typeof detail.failed === 'number' ? detail.failed : 0;
    if (failed === 0) {
      toast.success(t('containersView.toast.batchUpdatedNoGroup', { count: succeeded }));
      return;
    }
    if (succeeded === 0) {
      toast.error(t('containersView.toast.batchFailedNoGroup', { count: failed }));
      return;
    }
    toast.warning(t('containersView.toast.batchPartialNoGroup', { succeeded, total, failed }));
  }

  globalThis.addEventListener('dd:sse-update-applied', onUpdateApplied);
  globalThis.addEventListener('dd:sse-update-failed', onUpdateFailed);
  globalThis.addEventListener('dd:sse-batch-update-completed', onBatchCompleted);
  globalThis.addEventListener('dd:sse-container-added', onContainerStateEvent);
  globalThis.addEventListener('dd:sse-container-updated', onContainerStateEvent);
  globalThis.addEventListener('dd:sse-container-removed', onContainerStateEvent);

  onScopeDispose(() => {
    globalThis.removeEventListener('dd:sse-update-applied', onUpdateApplied);
    globalThis.removeEventListener('dd:sse-update-failed', onUpdateFailed);
    globalThis.removeEventListener('dd:sse-batch-update-completed', onBatchCompleted);
    globalThis.removeEventListener('dd:sse-container-added', onContainerStateEvent);
    globalThis.removeEventListener('dd:sse-container-updated', onContainerStateEvent);
    globalThis.removeEventListener('dd:sse-container-removed', onContainerStateEvent);
    for (const entry of pendingToasts.values()) {
      clearTimeout(entry.timer);
    }
    pendingToasts.clear();
    for (const timer of completedOperationIds.values()) {
      clearTimeout(timer);
    }
    completedOperationIds.clear();
    installed = false;
  });
}
