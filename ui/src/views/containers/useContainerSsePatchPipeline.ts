import { onMounted, onUnmounted, type Ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  applyUpdateOperationSseToHold,
  type ParsedUpdateOperationSse,
  parseUpdateLifecycleSsePayload,
  parseUpdateOperationSsePayload,
} from '../../composables/useOperationDisplayHold';
import { useOperationStore } from '../../stores/operations';
import type { Container } from '../../types/container';
import { OPERATOR_CANCELLED_ROLLBACK_REASON } from '../../types/update-operation';
import { mapApiContainer } from '../../utils/container-mapper';
import { resolveUpdateFailureReason } from '../../utils/update-error-summary';

type ContainerPatchKind = 'added' | 'updated' | 'removed';

interface UseContainerSsePatchPipelineInput {
  containers: Ref<Container[]>;
  containerIdMap: Ref<Record<string, string>>;
  containerMetaMap: Ref<Record<string, unknown>>;
  selectedContainerId: Readonly<Ref<string | undefined>>;
  loadContainers: () => Promise<void>;
  loadDetailSecurityData: () => Promise<void>;
  reconcileHoldsAgainstContainers: (
    containers: readonly Pick<Container, 'id' | 'identityKey' | 'name'>[],
  ) => void;
  refreshServerNames?: () => void;
  schedulePostTerminalReload: () => void;
}

export function useContainerSsePatchPipeline(input: UseContainerSsePatchPipelineInput) {
  const { t } = useI18n();
  const operationStore = useOperationStore();

  const containerIndexById = new Map<string, number>();
  const containerIdByIndex = new Map<number, string>();

  function rebuildContainerIndexById() {
    containerIndexById.clear();
    containerIdByIndex.clear();
    for (let index = 0; index < input.containers.value.length; index += 1) {
      setContainerIndex(input.containers.value[index]!, index);
    }
  }

  function setContainerIndex(container: Container, index: number) {
    const previousIdAtIndex = containerIdByIndex.get(index);
    if (previousIdAtIndex && previousIdAtIndex !== container.id) {
      containerIndexById.delete(previousIdAtIndex);
    }
    if (!container.id) {
      containerIdByIndex.delete(index);
      return;
    }
    const previousIndexForId = containerIndexById.get(container.id);
    if (previousIndexForId !== undefined && previousIndexForId !== index) {
      containerIdByIndex.delete(previousIndexForId);
    }
    containerIndexById.set(container.id, index);
    containerIdByIndex.set(index, container.id);
  }

  function removeContainerIndexAt(removedIndex: number) {
    const removedId = containerIdByIndex.get(removedIndex)!;
    containerIndexById.delete(removedId);
    containerIdByIndex.delete(removedIndex);

    for (let index = removedIndex; index < input.containers.value.length; index += 1) {
      const shiftedId = containerIdByIndex.get(index + 1);
      if (shiftedId) {
        containerIdByIndex.set(index, shiftedId);
        containerIndexById.set(shiftedId, index);
      } else {
        containerIdByIndex.delete(index);
      }
      containerIdByIndex.delete(index + 1);
    }
  }

  function resolveContainerLookupId(id: unknown, name: unknown): string | undefined {
    const idKey = typeof id === 'string' && id.length > 0 ? id : undefined;
    if (idKey) {
      return input.containerIdMap.value[idKey] ?? idKey;
    }
    // applyContainerPatch rejects payloads that carry neither an id nor a name.
    return input.containerIdMap.value[name as string];
  }

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
    const containerId = resolveContainerLookupId(id, name);
    return containerId ? (containerIndexById.get(containerId) ?? -1) : -1;
  }

  watch(input.containers, rebuildContainerIndexById, { immediate: true });

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
        removeContainerIndexAt(idx);
      }
      removeLookupMapsForContainer(id ?? '', name);
      input.refreshServerNames?.();
      input.reconcileHoldsAgainstContainers(input.containers.value);
      return;
    }

    let mapped: Container;
    try {
      mapped = mapApiContainer(raw, t);
    } catch {
      void handleSseContainerChanged();
      return;
    }

    const idx = findContainerIndexByIdOrName(id, name);
    if (idx === -1) {
      if (kind === 'added' || kind === 'updated') {
        input.containers.value.push(mapped);
        setContainerIndex(mapped, input.containers.value.length - 1);
        input.refreshServerNames?.();
      }
    } else {
      const existing = input.containers.value[idx]!;
      const previousId = existing.id;
      const previousServer = existing.server;
      Object.assign(existing, mapped);
      if (previousId !== existing.id) {
        containerIndexById.delete(previousId);
      }
      setContainerIndex(existing, idx);
      if (existing.server !== previousServer) {
        input.refreshServerNames?.();
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
    // Hot path for dd:update-operation-changed: prefer the O(1) Map index built
    // by setContainerIndex / rebuildContainerIndexById so we don't re-scan
    // containers.value (which can be 100s of rows) on every operation event.
    if (typeof target.containerId === 'string') {
      const idx = containerIndexById.get(target.containerId);
      if (idx !== undefined) return input.containers.value[idx];
    }
    if (typeof target.newContainerId === 'string') {
      const idx = containerIndexById.get(target.newContainerId);
      if (idx !== undefined) return input.containers.value[idx];
    }
    // Name lookup falls back to a linear scan because the composable does not
    // maintain a name -> index map; the parent view holds containerIdMap for
    // that purpose, but it is not in scope here. Name-only targets are rare
    // (operation events carry containerId in the common path).
    if (typeof target.containerName === 'string') {
      const name = target.containerName;
      return input.containers.value.find((c) => c.name === name);
    }
    return undefined;
  }

  function applyParsedOperationPatch(parsed: ParsedUpdateOperationSse) {
    return applyUpdateOperationSseToHold({
      parsed,
      resolveContainer: findContainerForOperationTarget,
      resolvePreviousOperation: (container) => operationStore.getOperationForContainer(container),
      // Terminal operation SSEs can race ahead of the container-list refresh
      // that renames the row post-recreate, so still release the hold even when
      // the row has already fallen out of containers.value.
      onTerminalEvent: ({ container, status }) => {
        const reason = resolveUpdateFailureReason(
          {
            lastError: parsed.lastError,
            rollbackReason: parsed.rollbackReason,
          },
          (key) => t(key),
        );
        if (container) {
          if (
            status === 'failed' ||
            (status === 'rolled-back' &&
              parsed.rollbackReason !== OPERATOR_CANCELLED_ROLLBACK_REASON)
          ) {
            (container as Container).lastUpdateFailureReason =
              reason ?? t('containerComponents.groupedViews.updateFailed');
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

  function applyOperationPatch(event: Event) {
    const parsed = parseUpdateOperationSsePayload((event as CustomEvent)?.detail);
    if (!parsed) {
      return;
    }
    applyParsedOperationPatch(parsed);
  }

  function handleSseUpdateApplied(event: Event) {
    const detail = (event as CustomEvent)?.detail as Record<string, unknown> | undefined;
    if (!detail) {
      return;
    }
    const parsed = parseUpdateLifecycleSsePayload(detail, 'succeeded');
    if (!parsed) {
      return;
    }
    applyParsedOperationPatch(parsed);
  }

  function handleSseUpdateFailed(event: Event) {
    const detail = (event as CustomEvent)?.detail as Record<string, unknown> | undefined;
    if (!detail) {
      return;
    }
    const parsed = parseUpdateLifecycleSsePayload(detail, 'failed');
    if (!parsed) {
      return;
    }
    applyParsedOperationPatch(parsed);
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
  };
}
