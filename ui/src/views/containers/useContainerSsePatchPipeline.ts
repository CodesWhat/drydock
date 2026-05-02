import { onMounted, onScopeDispose, onUnmounted, type Ref, type WatchStopHandle, watch } from 'vue';
import {
  applyUpdateOperationSseToHold,
  OPERATION_DISPLAY_HOLD_MS,
  parseUpdateOperationSsePayload,
} from '../../composables/useOperationDisplayHold';
import { type UiUpdateOperation, useOperationStore } from '../../stores/operations';
import type { Container, ContainerUpdateOperation } from '../../types/container';
import { mapApiContainer } from '../../utils/container-mapper';
import { resolveUpdateFailureReason } from '../../utils/update-error-summary';

type ContainerPatchKind = 'added' | 'updated' | 'removed';

type ToastApi = {
  error: (title: string) => void;
  success: (title: string) => void;
  warning: (title: string) => void;
};

type Translate = (key: string, params?: Record<string, unknown>) => string;

interface UseContainerSsePatchPipelineInput {
  containers: Ref<Container[]>;
  containerIdMap: Ref<Record<string, string>>;
  containerMetaMap: Ref<Record<string, unknown>>;
  selectedContainerId: Readonly<Ref<string | undefined>>;
  loadContainers: () => Promise<void>;
  loadDetailSecurityData: () => Promise<void>;
  reconcileHoldsAgainstContainers: (
    containers: readonly Pick<Container, 'id' | 'name' | 'updateOperation'>[],
  ) => void;
  schedulePostTerminalReload: () => void;
  toast: ToastApi;
  t: Translate;
}

const DEFERRED_OPERATION_ATTACH_TIMEOUT_MS = 30_000;

export function useContainerSsePatchPipeline(input: UseContainerSsePatchPipelineInput) {
  const operationStore = useOperationStore();
  const completionToastTimers = new Set<ReturnType<typeof setTimeout>>();

  // Deferred operation re-attach: when dd:container-added arrives before
  // dd:update-operation-changed (agent-relay path has no ordering guarantee),
  // the synchronous resolveStoreOperation lookup misses. Each entry here is a
  // pending watcher waiting for the operation to appear in the store.
  // Keyed by container ID so at most one watcher exists per container.
  const pendingOperationWatchers = new Map<string, WatchStopHandle>();
  const pendingOperationWatcherTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function scheduleCompletionToast(callback: () => void) {
    const timer = setTimeout(() => {
      completionToastTimers.delete(timer);
      callback();
    }, OPERATION_DISPLAY_HOLD_MS);
    completionToastTimers.add(timer);
  }

  onScopeDispose(() => {
    for (const timer of completionToastTimers) {
      clearTimeout(timer);
    }
    completionToastTimers.clear();
    for (const stop of pendingOperationWatchers.values()) {
      stop();
    }
    pendingOperationWatchers.clear();
    for (const timer of pendingOperationWatcherTimers.values()) {
      clearTimeout(timer);
    }
    pendingOperationWatcherTimers.clear();
  });

  // Refreshes container list and security detail data. Used on (re)connect and
  // resync-required events where the whole list needs a reconciliation sweep,
  // and as the fallback path when applyContainerPatch cannot derive identity
  // from a malformed SSE payload.
  async function handleSseContainerChanged() {
    await input.loadContainers();
    if (input.selectedContainerId.value) {
      await input.loadDetailSecurityData();
    }
  }

  // Scan-completed only refreshes security detail; container-changed events
  // emitted by the same scan cycle already drive loadContainers() via the
  // debounced container-changed listener. Calling loadContainers() here would
  // produce a duplicate GET /api/containers per scan.
  async function handleSseScanCompleted() {
    if (input.selectedContainerId.value) {
      await input.loadDetailSecurityData();
    }
  }

  function findContainerIndexByIdOrName(id: unknown, name: unknown): number {
    return input.containers.value.findIndex(
      (c) =>
        (typeof id === 'string' && id.length > 0 && c.id === id) ||
        (typeof name === 'string' && name.length > 0 && c.name === name),
    );
  }

  // Patch the id+meta maps once per SSE event instead of spread-copying the
  // full map per field. On a 400-container deployment the old code did 4 full
  // O(N) spreads per event (id-key, meta-key, alias-key, alias-meta-key); this
  // does 2. Identity still changes per call so downstream caches keyed on
  // `containerMetaMap.value !== cached` invalidate correctly. See #301.
  function updateLookupMapsForContainer(raw: Record<string, unknown>) {
    const containerId = typeof raw.id === 'string' ? raw.id : '';
    if (!containerId) {
      return;
    }
    const uiName =
      typeof raw.displayName === 'string' && raw.displayName.trim().length > 0
        ? raw.displayName
        : typeof raw.name === 'string'
          ? raw.name
          : '';

    const nextId = { ...input.containerIdMap.value, [containerId]: containerId };
    const nextMeta = { ...input.containerMetaMap.value, [containerId]: raw };
    if (uiName) {
      nextId[uiName] = containerId;
      nextMeta[uiName] = raw;
    }
    input.containerIdMap.value = nextId;
    input.containerMetaMap.value = nextMeta;
  }

  function removeLookupMapsForContainer(id: string, name: string | undefined) {
    const current = input.containerIdMap.value;
    const hasId = !!id && current[id] !== undefined;
    const hasName = !!name && current[name] !== undefined;
    if (!hasId && !hasName) {
      return;
    }
    const nextId = { ...input.containerIdMap.value };
    const nextMeta = { ...input.containerMetaMap.value };
    if (hasId) {
      delete nextId[id];
      delete nextMeta[id];
    }
    if (hasName) {
      delete nextId[name!];
      delete nextMeta[name!];
    }
    input.containerIdMap.value = nextId;
    input.containerMetaMap.value = nextMeta;
  }

  /**
   * Look up an active operation in the Pinia operations store by container id
   * and coerce it to the ContainerUpdateOperation shape used on row objects.
   * Returns undefined when no active operation exists for the given id.
   */
  function resolveStoreOperation(containerId: string): ContainerUpdateOperation | undefined {
    const storeOp = operationStore.getOperationByContainerId(containerId) as
      | UiUpdateOperation
      | undefined;
    if (!storeOp) {
      return undefined;
    }
    return {
      id: storeOp.operationId,
      status: storeOp.status as ContainerUpdateOperation['status'],
      phase: (storeOp.phase ?? 'queued') as ContainerUpdateOperation['phase'],
      batchId: storeOp.batchId,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Deferred operation re-attach for SSE ordering races.
   *
   * In the direct-controller path, dd:update-operation-changed fires
   * synchronously before dd:container-added (the container event is debounced
   * through the watcher), so resolveStoreOperation() finds the operation
   * immediately. In the agent-relay path ordering is NOT guaranteed:
   * dd:container-added can win the race and push a row before the operation
   * lands in the store.
   *
   * When the synchronous lookup misses, this function sets up a one-shot watcher
   * on operationStore.getOperationByContainerId(containerId). When the operation
   * arrives, the watcher attaches it to the row. The watcher self-cancels on
   * success, when the container is removed, or after
   * DEFERRED_OPERATION_ATTACH_TIMEOUT_MS to bound watcher lifetime. At most one
   * watcher exists per container ID.
   */
  function attachOperationWhenAvailable(containerId: string, name: string | undefined) {
    // Cancel any existing watcher for this container to avoid stacking.
    const existingStop = pendingOperationWatchers.get(containerId);
    if (existingStop) {
      existingStop();
      pendingOperationWatchers.delete(containerId);
      const existingTimer = pendingOperationWatcherTimers.get(containerId);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
        pendingOperationWatcherTimers.delete(containerId);
      }
    }

    const stop = watch(
      () => operationStore.getOperationByContainerId(containerId),
      (op) => {
        if (!op) {
          return;
        }
        const idx = findContainerIndexByIdOrName(containerId, name);
        if (idx === -1) {
          // Container was removed before the operation arrived.
          cleanup();
          return;
        }
        if (input.containers.value[idx]!.updateOperation === undefined) {
          input.containers.value[idx]!.updateOperation = resolveStoreOperation(containerId);
        }
        cleanup();
      },
      { immediate: false },
    );

    function cleanup() {
      stop();
      pendingOperationWatchers.delete(containerId);
      const timer = pendingOperationWatcherTimers.get(containerId);
      if (timer !== undefined) {
        clearTimeout(timer);
        pendingOperationWatcherTimers.delete(containerId);
      }
    }

    pendingOperationWatchers.set(containerId, stop);

    const timeoutTimer = setTimeout(() => {
      pendingOperationWatcherTimers.delete(containerId);
      // stop() also removes from pendingOperationWatchers via cleanup() if still
      // present, but we call stop directly here since the timer callback owns the
      // cleanup.
      stop();
      pendingOperationWatchers.delete(containerId);
    }, DEFERRED_OPERATION_ATTACH_TIMEOUT_MS);
    pendingOperationWatcherTimers.set(containerId, timeoutTimer);
  }

  // Apply a single-container SSE payload in place instead of falling back to a
  // full GET /api/v1/containers + remap + array reassign. The backend emits the
  // full validated container object on dd:container-added/-updated, so we can
  // run it through mapApiContainer() and merge field-by-field onto the matching
  // row, preserving row object identity so downstream computeds
  // (filteredContainers -> displayContainers -> sortedContainers -> groupedContainers)
  // do not invalidate for unaffected rows. Falls back to loadContainers() when
  // the payload is malformed or the mapper cannot derive identity.
  function applyContainerPatch(event: Event, kind: ContainerPatchKind) {
    const raw = (event as CustomEvent)?.detail as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') {
      void handleSseContainerChanged();
      return;
    }
    const id = typeof raw.id === 'string' ? raw.id : undefined;
    const name = typeof raw.name === 'string' ? raw.name : undefined;
    if (!id && !name) {
      void handleSseContainerChanged();
      return;
    }

    if (kind === 'removed') {
      const idx = findContainerIndexByIdOrName(id, name);
      if (idx !== -1) {
        input.containers.value.splice(idx, 1);
      }
      // If a deferred operation-attach watcher is pending for this container,
      // cancel it immediately: no point attaching an operation to a container
      // that is gone.
      if (id) {
        const stop = pendingOperationWatchers.get(id);
        if (stop) {
          stop();
          pendingOperationWatchers.delete(id);
          const timer = pendingOperationWatcherTimers.get(id);
          if (timer !== undefined) {
            clearTimeout(timer);
            pendingOperationWatcherTimers.delete(id);
          }
        }
      }
      removeLookupMapsForContainer(id ?? '', name);
      input.reconcileHoldsAgainstContainers(input.containers.value);
      return;
    }

    let mapped: Container;
    try {
      mapped = mapApiContainer(raw);
    } catch {
      void handleSseContainerChanged();
      return;
    }

    const idx = findContainerIndexByIdOrName(id, name);
    if (idx === -1) {
      if (kind === 'added' || kind === 'updated') {
        // Container metadata SSE doesn't carry updateOperation. If there's an
        // active operation in the store keyed to this container's id or
        // newContainerId, attach it before push so
        // reconcileHoldsAgainstContainers doesn't false-positive-release the hold.
        if (mapped.updateOperation === undefined) {
          mapped.updateOperation = resolveStoreOperation(mapped.id);
        }
        input.containers.value.push(mapped);
        // Deferred fallback: if the synchronous lookup still found nothing, set
        // up a one-shot watcher so the operation is attached as soon as it
        // arrives in the store. This covers the agent-relay path where
        // dd:container-added can arrive before dd:update-operation-changed with
        // no ordering guarantee.
        if (mapped.updateOperation === undefined) {
          attachOperationWhenAvailable(mapped.id, mapped.name);
        }
      }
    } else {
      // In-place merge preserves the row object identity; downstream row wrappers
      // and :key bindings therefore keep pointing at the same object reference.
      //
      // updateOperation is owned by the SSE operation-stream pipeline
      // (applyOperationPatch -> applyUpdateOperationSseToHold). Container-metadata
      // SSE events (dd:container-updated / dd:container-added) carry only
      // container metadata; they do not carry the live updateOperation. If we
      // blindly Object.assign the mapped result, mapped.updateOperation
      // (undefined) clobbers the row's live updateOperation, causing
      // reconcileHoldsAgainstContainers to read undefined status -> rawIsActive:false
      // -> scheduleHeldOperationRelease. Preserve the existing operation when the
      // patch does not carry a replacement. When neither the row nor the patch
      // carry an operation, fall back to the store.
      const existingOp = input.containers.value[idx]!.updateOperation;
      Object.assign(input.containers.value[idx]!, mapped);
      if (mapped.updateOperation === undefined) {
        input.containers.value[idx]!.updateOperation =
          existingOp ?? resolveStoreOperation(input.containers.value[idx]!.id);
      }
    }
    updateLookupMapsForContainer(raw);
    input.reconcileHoldsAgainstContainers(input.containers.value);
  }

  function findContainerForOperationTarget(target: {
    containerId?: string;
    newContainerId?: string;
    containerName?: string;
  }): Container | undefined {
    const idx = input.containers.value.findIndex(
      (c) =>
        (typeof target.containerId === 'string' && c.id === target.containerId) ||
        (typeof target.newContainerId === 'string' && c.id === target.newContainerId) ||
        (typeof target.containerName === 'string' && c.name === target.containerName),
    );
    return idx === -1 ? undefined : input.containers.value[idx];
  }

  function applyOperationPatch(event: Event) {
    const parsed = parseUpdateOperationSsePayload((event as CustomEvent)?.detail);
    if (!parsed) {
      return;
    }
    applyUpdateOperationSseToHold({
      parsed,
      resolveContainer: findContainerForOperationTarget,
      // ContainersView drives row reactivity by mutating updateOperation in
      // place, so the view keeps responsibility for that while the composable
      // owns the hold map + snapshot.
      onActiveOperationComputed: ({ container, nextOperation }) => {
        (container as Container).updateOperation = nextOperation;
      },
      // Terminal operation SSEs can race ahead of the container-list refresh
      // that renames the row post-recreate, so still release the hold even when
      // the row has already fallen out of containers.value.
      onTerminalEvent: ({ container, status }) => {
        const reason = resolveUpdateFailureReason({
          lastError: parsed.lastError,
          rollbackReason: parsed.rollbackReason,
        });
        if (container) {
          (container as Container).updateOperation = undefined;
          if (
            status === 'failed' ||
            (status === 'rolled-back' && parsed.rollbackReason !== 'cancelled')
          ) {
            (container as Container).lastUpdateFailureReason = reason ?? 'Update failed';
            (container as Container).lastUpdateFailureAt = Date.now();
          } else if (status === 'succeeded') {
            (container as Container).lastUpdateFailureReason = undefined;
            (container as Container).lastUpdateFailureAt = undefined;
          }
        }
        // Resync the full list so the row reflects post-update state: new image
        // tag on success, restored update-available banner with
        // lastUpdateFailureReason on failure. Granular SSE patches don't always
        // cover renames/new container IDs.
        input.schedulePostTerminalReload();
      },
    });
  }

  function handleSseUpdateApplied(event: Event) {
    const detail = (event as CustomEvent)?.detail as Record<string, unknown> | undefined;
    if (!detail) {
      return;
    }
    const operationId = typeof detail.operationId === 'string' ? detail.operationId : undefined;
    const containerName =
      typeof detail.containerName === 'string' ? detail.containerName : 'container';
    const batchId = detail.batchId ?? null;
    // Batch completions are handled by Track D; suppress per-container toast.
    if (batchId !== null) {
      return;
    }
    if (!operationId) {
      return;
    }
    scheduleCompletionToast(() =>
      input.toast.success(input.t('containersView.toast.updated', { name: containerName })),
    );
  }

  function handleSseUpdateFailed(event: Event) {
    const detail = (event as CustomEvent)?.detail as Record<string, unknown> | undefined;
    if (!detail) {
      return;
    }
    const operationId = typeof detail.operationId === 'string' ? detail.operationId : undefined;
    const containerName =
      typeof detail.containerName === 'string' ? detail.containerName : 'container';
    const batchId = detail.batchId ?? null;
    if (batchId !== null) {
      return;
    }
    if (!operationId) {
      return;
    }
    // Classify the failure reason from the SSE payload. The dd:update-failed
    // payload carries `error` and `rollbackReason`; the presence of
    // rollbackReason signals a rolled-back (vs failed) terminal state and drives
    // the toast variant.
    const error = typeof detail.error === 'string' ? detail.error : undefined;
    const rollbackReason =
      typeof detail.rollbackReason === 'string' ? detail.rollbackReason : undefined;
    const reason = resolveUpdateFailureReason({ lastError: error, rollbackReason });
    const isCancelled = rollbackReason === 'cancelled' || error === 'Cancelled by operator';
    if (rollbackReason !== undefined) {
      if (isCancelled) {
        scheduleCompletionToast(() =>
          input.toast.success(input.t('containersView.toast.cancelled', { name: containerName })),
        );
      } else {
        scheduleCompletionToast(() =>
          input.toast.warning(
            reason
              ? input.t('containersView.toast.rolledBackWithReason', {
                  name: containerName,
                  reason,
                })
              : input.t('containersView.toast.rolledBack', { name: containerName }),
          ),
        );
      }
    } else {
      scheduleCompletionToast(() =>
        input.toast.error(
          reason
            ? input.t('containersView.toast.updateFailedWithReason', {
                name: containerName,
                reason,
              })
            : input.t('containersView.toast.updateFailed', { name: containerName }),
        ),
      );
    }
  }

  const sseScanCompletedListener = handleSseScanCompleted as EventListener;
  const sseUpdateAppliedListener = handleSseUpdateApplied as EventListener;
  const sseUpdateFailedListener = handleSseUpdateFailed as EventListener;
  const sseConnectedListener = handleSseContainerChanged as EventListener;
  const sseResyncRequiredListener = handleSseContainerChanged as EventListener;
  const sseUpdateOperationChangedListener = ((event: Event) => {
    applyOperationPatch(event);
  }) as EventListener;
  const sseContainerAddedListener = ((event: Event) => {
    applyContainerPatch(event, 'added');
  }) as EventListener;
  const sseContainerUpdatedListener = ((event: Event) => {
    applyContainerPatch(event, 'updated');
  }) as EventListener;
  const sseContainerRemovedListener = ((event: Event) => {
    applyContainerPatch(event, 'removed');
  }) as EventListener;

  onMounted(() => {
    globalThis.addEventListener('dd:sse-scan-completed', sseScanCompletedListener);
    globalThis.addEventListener('dd:sse-container-added', sseContainerAddedListener);
    globalThis.addEventListener('dd:sse-container-updated', sseContainerUpdatedListener);
    globalThis.addEventListener('dd:sse-container-removed', sseContainerRemovedListener);
    globalThis.addEventListener(
      'dd:sse-update-operation-changed',
      sseUpdateOperationChangedListener,
    );
    globalThis.addEventListener('dd:sse-connected', sseConnectedListener);
    globalThis.addEventListener('dd:sse-resync-required', sseResyncRequiredListener);
    globalThis.addEventListener('dd:sse-update-applied', sseUpdateAppliedListener);
    globalThis.addEventListener('dd:sse-update-failed', sseUpdateFailedListener);
  });

  onUnmounted(() => {
    globalThis.removeEventListener('dd:sse-scan-completed', sseScanCompletedListener);
    globalThis.removeEventListener('dd:sse-container-added', sseContainerAddedListener);
    globalThis.removeEventListener('dd:sse-container-updated', sseContainerUpdatedListener);
    globalThis.removeEventListener('dd:sse-container-removed', sseContainerRemovedListener);
    globalThis.removeEventListener(
      'dd:sse-update-operation-changed',
      sseUpdateOperationChangedListener,
    );
    globalThis.removeEventListener('dd:sse-connected', sseConnectedListener);
    globalThis.removeEventListener('dd:sse-resync-required', sseResyncRequiredListener);
    globalThis.removeEventListener('dd:sse-update-applied', sseUpdateAppliedListener);
    globalThis.removeEventListener('dd:sse-update-failed', sseUpdateFailedListener);
  });

  return {
    applyContainerPatch,
    applyOperationPatch,
    pendingOperationWatchers,
    pendingOperationWatcherTimers,
  };
}
