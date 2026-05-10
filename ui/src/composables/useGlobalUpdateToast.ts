import { onScopeDispose } from 'vue';
import { useI18n } from 'vue-i18n';
import { resolveUpdateFailureReason } from '../utils/update-error-summary';
import { OPERATION_DISPLAY_HOLD_MS } from './useOperationDisplayHold';
import { useToast } from './useToast';

// Hold operationIds in the dedup window long enough that an SSE replay
// (Last-Event-ID buffer is 5 min server-side) cannot trigger a duplicate
// toast for the same terminal event.
const COMPLETED_OPERATION_TTL_MS = 5 * 60 * 1000;

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
 */
export function useGlobalUpdateToast() {
  const toast = useToast();
  const { t } = useI18n();

  // Dedup operationIds across SSE replay and across multiple SSE listeners.
  const completedOperationIds = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  function recordCompleted(operationId: string) {
    const timer = setTimeout(() => {
      completedOperationIds.delete(operationId);
    }, COMPLETED_OPERATION_TTL_MS);
    completedOperationIds.set(operationId, timer);
  }

  function scheduleToast(callback: () => void) {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      callback();
    }, OPERATION_DISPLAY_HOLD_MS);
    pendingTimers.add(timer);
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
    scheduleToast(() => toast.success(t('containersView.toast.updated', { name })));
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
    scheduleToast(() => {
      if (rollbackReason !== undefined) {
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
    });
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

  onScopeDispose(() => {
    globalThis.removeEventListener('dd:sse-update-applied', onUpdateApplied);
    globalThis.removeEventListener('dd:sse-update-failed', onUpdateFailed);
    globalThis.removeEventListener('dd:sse-batch-update-completed', onBatchCompleted);
    for (const timer of pendingTimers) {
      clearTimeout(timer);
    }
    pendingTimers.clear();
    for (const timer of completedOperationIds.values()) {
      clearTimeout(timer);
    }
    completedOperationIds.clear();
  });
}
