import { onScopeDispose } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  OPERATOR_CANCELLED_ERROR_MESSAGE,
  OPERATOR_CANCELLED_ROLLBACK_REASON,
} from '../types/update-operation';
import { resolveUpdateFailureReason } from '../utils/update-error-summary';
import { useToast } from './useToast';

// Hold operationIds in the dedup window for 20% longer than the server's
// 5-minute SSE ring-buffer window. A reconnect at the exact boundary could
// otherwise replay an event whose dedup entry just expired, producing a
// duplicate toast. The extra margin ensures the entry outlives any replay.
const COMPLETED_OPERATION_TTL_MS = 6 * 60 * 1000; // 360 000 ms (server replay buffer is 300 000 ms)

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

// Dedup is namespaced by terminal event-kind. Using a shared map across
// applied/failed/batch lets an early `update-applied` for opId X silently
// swallow a later `update-failed` for the same opId — and that can happen
// when an SSE replay (or out-of-order agent relay) reorders the two events.
// Separate namespaces let each terminal kind dedup independently.
type DedupKind = 'applied' | 'failed' | 'batch';

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
    // Bumped from warn to error so a duplicate install — which silently
    // double-fires every toast — surfaces in CI logs and screenshot
    // artifacts instead of being lost in the noise floor.
    console.error('[useGlobalUpdateToast] already installed; ignoring duplicate call');
    return;
  }
  installed = true;

  const toast = useToast();
  const { t } = useI18n();

  // Dedup operationIds across SSE replay and across multiple SSE listeners.
  // Keyed by `${kind}:${operationId}` so an `applied` event does not block
  // a subsequent `failed` event (or vice versa) for the same operationId.
  const completedOperationIds = new Map<string, ReturnType<typeof setTimeout>>();
  // Pending toasts waiting for a matching container-state event before firing.
  // Keyed by operationId when present, falling back to a containerName + nonce
  // synthetic key when the backend omits operationId.
  const pendingToasts = new Map<string, PendingToast>();
  // Secondary index: containerId -> set of pending-toast keys. Lets
  // settleByContainer hit the matching toast(s) in O(1) instead of scanning
  // the entire pendingToasts Map on every container-state SSE event.
  const pendingKeysByContainerId = new Map<string, Set<string>>();
  let pendingNonce = 0;

  function dedupKey(kind: DedupKind, id: string): string {
    return `${kind}:${id}`;
  }

  function recordCompleted(kind: DedupKind, id: string) {
    const key = dedupKey(kind, id);
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
      completedOperationIds.delete(key);
    }, COMPLETED_OPERATION_TTL_MS);
    completedOperationIds.set(key, timer);
  }

  function hasCompleted(kind: DedupKind, id: string): boolean {
    return completedOperationIds.has(dedupKey(kind, id));
  }

  function indexPendingByContainer(key: string, containerIds: Array<string | undefined>) {
    for (const id of containerIds) {
      if (!id) continue;
      let keys = pendingKeysByContainerId.get(id);
      if (!keys) {
        keys = new Set();
        pendingKeysByContainerId.set(id, keys);
      }
      keys.add(key);
    }
  }

  function unindexPending(key: string, entry: PendingToast) {
    for (const id of [entry.containerId, entry.newContainerId]) {
      if (!id) continue;
      const keys = pendingKeysByContainerId.get(id);
      if (!keys) continue;
      keys.delete(key);
      if (keys.size === 0) {
        pendingKeysByContainerId.delete(id);
      }
    }
  }

  function removePending(key: string) {
    const entry = pendingToasts.get(key);
    // c8 ignore next -- defensive guard; unreachable through the public API
    if (!entry) return undefined;
    pendingToasts.delete(key);
    clearTimeout(entry.timer);
    unindexPending(key, entry);
    return entry;
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
      const entry = pendingToasts.get(key);
      // c8 ignore next -- defensive guard; timer is cleared by removePending before it fires
      if (!entry) return;
      pendingToasts.delete(key);
      unindexPending(key, entry);
      args.fire();
    }, UPDATE_TOAST_FALLBACK_DELAY_MS);
    pendingToasts.set(key, {
      containerId: args.containerId,
      newContainerId: args.newContainerId,
      containerName: args.containerName,
      fire: args.fire,
      timer,
    });
    indexPendingByContainer(key, [args.containerId, args.newContainerId]);
  }

  function settleByContainer(containerId: string | undefined, containerName: string | undefined) {
    if (!containerId && !containerName) return;
    // Fast path: container-state events for known IDs hit the secondary index
    // and skip the Map scan entirely. This is the hot path — fires on every
    // dd:sse-container-added/updated/removed event.
    if (containerId) {
      const keys = pendingKeysByContainerId.get(containerId);
      if (keys && keys.size > 0) {
        for (const key of [...keys]) {
          const entry = removePending(key);
          entry?.fire();
        }
        // When all pending toasts for this container settle via the ID-indexed
        // path, the name-match scan below is unnecessary. Return only when at
        // least one match fired, so name-only entries still get a chance.
        if (containerName === undefined) return;
      }
    }
    // Fallback: name-only match for anonymous (no operationId, no containerId)
    // queued toasts. Tiny working set in practice (one pending per in-flight
    // update with a name but no id), so a linear scan is fine here.
    if (containerName) {
      for (const [key, entry] of pendingToasts) {
        if (entry.containerName === containerName) {
          removePending(key);
          entry.fire();
        }
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
    if (operationId && hasCompleted('applied', operationId)) {
      return;
    }
    if (operationId) {
      recordCompleted('applied', operationId);
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
    if (operationId && hasCompleted('failed', operationId)) {
      return;
    }
    if (operationId) {
      recordCompleted('failed', operationId);
    }
    const name = getDetailString(detail.containerName) ?? 'container';
    const error = getDetailString(detail.error);
    const rollbackReason = getDetailString(detail.rollbackReason);
    const reason = resolveUpdateFailureReason({ lastError: error, rollbackReason });
    const isCancelled =
      rollbackReason === OPERATOR_CANCELLED_ROLLBACK_REASON ||
      error === OPERATOR_CANCELLED_ERROR_MESSAGE;
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
    // When the server sends a container-removed event with replacementExpected=true it
    // means the old container was just destroyed as part of a local-Docker recreate — the
    // new container has not started yet. Settling the toast here would fire "Updated
    // Successfully" while the replacement is still starting (the #421 status gap). Skip
    // settlement and let the subsequent container-added/updated event (or the 5 s safety
    // fallback) trigger the toast instead.
    if (event.type === 'dd:sse-container-removed' && detail.replacementExpected === true) {
      return;
    }
    const containerId = getDetailString(detail.id) ?? getDetailString(detail.containerId);
    const containerName = getDetailString(detail.name) ?? getDetailString(detail.containerName);
    settleByContainer(containerId, containerName);
  }

  function onBatchCompleted(event: Event) {
    const detail = getDetail(event);
    if (!detail) return;
    const batchId = getDetailString(detail.batchId);
    if (batchId && hasCompleted('batch', batchId)) {
      return;
    }
    if (batchId) {
      recordCompleted('batch', batchId);
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
    pendingKeysByContainerId.clear();
    for (const timer of completedOperationIds.values()) {
      clearTimeout(timer);
    }
    completedOperationIds.clear();
    installed = false;
  });
}
