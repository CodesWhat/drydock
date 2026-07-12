import { computed, onUnmounted, type Ref, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import { useOperationDisplayHold } from '../../composables/useOperationDisplayHold';
import { useScanLifecycle } from '../../composables/useScanLifecycle';
import { useServerFeatures } from '../../composables/useServerFeatures';
import { useToast } from '../../composables/useToast';
import { useUpdateBatches } from '../../composables/useUpdateBatches';
import {
  deleteContainer as apiDeleteContainer,
  refreshContainer as apiRefreshContainer,
  scanContainer as apiScanContainer,
} from '../../services/container';
import {
  cancelUpdateOperation as apiCancelUpdateOperation,
  restartContainer as apiRestartContainer,
  startContainer as apiStartContainer,
  stopContainer as apiStopContainer,
  updateContainer as apiUpdateContainer,
  updateContainers as apiUpdateContainers,
} from '../../services/container-actions';
import type { Container } from '../../types/container';
import type { ContainerActionKind } from '../../utils/container-action-key';
import {
  getContainerActionIdentityKey,
  getContainerActionKey,
  hasTrackedContainerAction,
  hasTrackedContainerActionOfKind,
} from '../../utils/container-action-key';
import {
  getContainerAlreadyUpToDateMessage,
  getContainerUpdateStartedMessage,
  getForceContainerUpdateStartedMessage,
  isStaleContainerUpdateError,
  runContainerUpdateRequest,
  shouldRenderStandaloneQueuedUpdateAsUpdating,
  type TranslateFn,
} from '../../utils/container-update';
import { errorMessage } from '../../utils/error';
import {
  getPrimaryHardBlocker,
  getSoftBlockers,
  hasHardBlocker,
} from '../../utils/update-eligibility';
import { useContainerBackups } from './useContainerBackups';
import { useContainerPolicy } from './useContainerPolicy';
import { useContainerPreview } from './useContainerPreview';
import { useContainerTriggers } from './useContainerTriggers';

interface ContainerActionGroup {
  key: string;
  containers: Container[];
}

type ContainerActionTarget =
  | string
  | Pick<Container, 'id' | 'name' | 'identityKey' | 'updateOperation' | 'updateEligibility'>;

interface UseContainerActionsInput {
  activeDetailTab: Readonly<Ref<string>>;
  closeFullPage: () => void;
  closePanel: () => void;
  containerIdMap: Readonly<Ref<Record<string, string>>>;
  containerMetaMap: Readonly<Ref<Record<string, unknown>>>;
  containers: Readonly<Ref<Container[]>>;
  error: Ref<string | null>;
  loadContainers: () => Promise<void>;
  selectedContainer: Readonly<Ref<Container | null | undefined>>;
  selectedContainerId: Readonly<Ref<string | undefined>>;
}

export const ACTION_TAB_DETAIL_REFRESH_DEBOUNCE_MS = 250;
export const PENDING_ACTIONS_POLL_INTERVAL_MS = 2000;
export const PENDING_ACTIONS_POLL_MAX_INTERVAL_MS = 8000;
const PENDING_ACTIONS_POLL_BACKOFF_FACTOR = 2;
const PENDING_UPDATE_GRACE_MS = 6000;

type PendingActionLifecycleMode = 'presence' | 'update';

function resolveContainerActionTargetKey(target: ContainerActionTarget): string {
  if (typeof target === 'string') {
    return target;
  }
  return getContainerActionKey(target);
}

function resolveContainerActionTarget(
  target: ContainerActionTarget,
  containerIdMap: Record<string, string>,
  containerIdOverride?: string,
) {
  const name = typeof target === 'string' ? target : target.name;
  const containerId =
    containerIdOverride ??
    (typeof target === 'string' ? undefined : target.id) ??
    containerIdMap[name];
  return { containerId, name };
}

function hasPendingContainerAction(
  target: ContainerActionTarget,
  actionPending: Readonly<Ref<Map<string, Container>>>,
) {
  const pendingKey = resolveContainerActionTargetKey(target);
  if (pendingKey && actionPending.value.has(pendingKey)) {
    return true;
  }

  const identityKey = typeof target === 'string' ? target : getContainerActionIdentityKey(target);
  if (!identityKey) {
    return false;
  }

  return [...actionPending.value.values()].some((snapshot) => {
    return typeof target === 'string'
      ? snapshot.name === identityKey
      : getContainerActionIdentityKey(snapshot) === identityKey;
  });
}

function hasInProgressUpdateOperationByIdentityKey(
  targetIdentityKey: string,
  containers: readonly Pick<Container, 'name' | 'updateOperation'>[],
) {
  return containers.some((container) => {
    return (
      container.name === targetIdentityKey && container.updateOperation?.status === 'in-progress'
    );
  });
}

function markPendingActionState(args: {
  actionPending: Ref<Map<string, Container>>;
  actionPendingLifecycleModes: Ref<Map<string, PendingActionLifecycleMode>>;
  actionPendingLifecycleObserved: Ref<Set<string>>;
  startPolling: (pendingKey: string) => void;
  pendingKey: string;
  snapshot?: Container;
  mode: PendingActionLifecycleMode;
}) {
  if (!args.snapshot) {
    return;
  }

  args.actionPending.value.set(args.pendingKey, args.snapshot);
  args.actionPendingLifecycleModes.value.set(args.pendingKey, args.mode);

  const nextObserved = new Set(args.actionPendingLifecycleObserved.value);
  if (args.mode === 'update') {
    nextObserved.delete(args.pendingKey);
  } else {
    nextObserved.add(args.pendingKey);
  }
  args.actionPendingLifecycleObserved.value = nextObserved;
  args.startPolling(args.pendingKey);
}

async function executeContainerActionState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerId?: string;
  actionKey: string;
  pendingKey: string;
  name: string;
  kind: ContainerActionKind;
  actionInProgress: Ref<Map<string, ContainerActionKind>>;
  inputError: Ref<string | null>;
  containers: Readonly<Ref<Container[]>>;
  action: (id: string) => Promise<unknown>;
  loadContainers: () => Promise<void>;
  reloadContainers?: boolean;
  actionPending: Ref<Map<string, Container>>;
  actionPendingLifecycleModes: Ref<Map<string, PendingActionLifecycleMode>>;
  actionPendingLifecycleObserved: Ref<Set<string>>;
  startPolling: (pendingKey: string) => void;
  selectedContainerId: string | undefined;
  activeDetailTab: string;
  refreshActionTabData: () => Promise<void>;
  successMessage?: string;
  staleMessage?: string;
  treatNoUpdateAsStale?: boolean;
  pendingLifecycleMode?: PendingActionLifecycleMode;
  t: TranslateFn;
}): Promise<boolean> {
  if (!args.containerActionsEnabled) {
    args.inputError.value = args.containerActionsDisabledReason;
    return false;
  }
  const containerId = args.containerId;
  if (!containerId || args.actionInProgress.value.has(args.actionKey)) {
    return false;
  }
  const next = new Map(args.actionInProgress.value);
  next.set(args.actionKey, args.kind);
  args.actionInProgress.value = next;
  args.inputError.value = null;
  const shouldReloadContainers = args.reloadContainers ?? true;
  const snapshot =
    args.containers.value.find((container) => container.id === containerId) ??
    args.containers.value.find((container) => container.name === args.name);
  try {
    const result = await runContainerUpdateRequest({
      request: () => args.action(containerId),
      onAccepted: async () => {
        if (args.pendingLifecycleMode === 'update') {
          markPendingActionState({
            actionPending: args.actionPending,
            actionPendingLifecycleModes: args.actionPendingLifecycleModes,
            actionPendingLifecycleObserved: args.actionPendingLifecycleObserved,
            startPolling: args.startPolling,
            pendingKey: args.pendingKey,
            snapshot,
            mode: 'update',
          });
        }
        if (shouldReloadContainers) {
          await args.loadContainers();
          const stillPresent = args.containers.value.find(
            (container) => container.id === containerId,
          );
          if (!stillPresent && snapshot) {
            markPendingActionState({
              actionPending: args.actionPending,
              actionPendingLifecycleModes: args.actionPendingLifecycleModes,
              actionPendingLifecycleObserved: args.actionPendingLifecycleObserved,
              startPolling: args.startPolling,
              pendingKey: args.pendingKey,
              snapshot,
              mode: args.pendingLifecycleMode ?? 'presence',
            });
          }
        }
        if (args.selectedContainerId === containerId && args.activeDetailTab === 'actions') {
          await args.refreshActionTabData();
        }
      },
      onStale: async () => {
        if (shouldReloadContainers) {
          await args.loadContainers();
        }
      },
      isStaleError: args.treatNoUpdateAsStale ? isStaleContainerUpdateError : undefined,
    });
    if (result === 'stale') {
      if (args.staleMessage) {
        const toast = useToast();
        toast.info(args.staleMessage);
      }
      return false;
    }
    if (args.successMessage) {
      const toast = useToast();
      toast.success(args.successMessage);
    }
    return true;
  } catch (e: unknown) {
    const msg = errorMessage(
      e,
      args.t('containerComponents.actionToasts.actionFailedDetail', { name: args.name }),
    );
    args.inputError.value = msg;
    const toast = useToast();
    toast.error(
      args.t('containerComponents.actionToasts.updateFailedTitle', { name: args.name }),
      msg,
    );
    if (shouldReloadContainers) {
      await args.loadContainers();
    }
    return false;
  } finally {
    const next = new Map(args.actionInProgress.value);
    next.delete(args.actionKey);
    args.actionInProgress.value = next;
  }
}

async function updateAllInGroupState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containers: Readonly<Ref<Container[]>>;
  projectContainerDisplayState: (container: Container) => Container;
  inputError: Ref<string | null>;
  actionInProgress: Ref<Map<string, ContainerActionKind>>;
  actionPending: Ref<Map<string, Container>>;
  actionPendingLifecycleModes: Ref<Map<string, PendingActionLifecycleMode>>;
  actionPendingLifecycleObserved: Ref<Set<string>>;
  startPolling: (pendingKey: string) => void;
  group: ContainerActionGroup;
  loadContainers: () => Promise<void>;
  captureBatch: (groupKey: string, frozenTotal: number) => void;
  clearBatch: (groupKey: string) => void;
  alreadyInProgressMessage: string;
  t: TranslateFn;
}) {
  if (!args.containerActionsEnabled) {
    args.inputError.value = args.containerActionsDisabledReason;
    return;
  }
  const updatableContainers = args.group.containers.filter((container) => {
    return (
      container.newTag &&
      container.bouncer !== 'blocked' &&
      !hasHardBlocker(container.updateEligibility)
    );
  });
  const displayContainers = args.containers.value.map(args.projectContainerDisplayState);
  if (
    updatableContainers.some((container) => {
      const liveContainer = displayContainers.find((entry) => entry.id === container.id);
      const operation =
        liveContainer?.updateOperation ??
        args.projectContainerDisplayState(container).updateOperation;
      return (
        operation?.status === 'queued' ||
        operation?.status === 'in-progress' ||
        args.actionInProgress.value.has(container.id)
      );
    })
  ) {
    useToast().warning(args.alreadyInProgressMessage);
    return;
  }
  const frozenUpdateTargets = updatableContainers.map((container) => ({
    id: container.id,
    identityKey: container.identityKey,
    name: container.name,
  }));
  if (frozenUpdateTargets.length === 0) {
    return;
  }
  const groupContainerIds = frozenUpdateTargets.map((t) => t.id);
  const firstTargetActionKey = resolveContainerActionTargetKey(frozenUpdateTargets[0]!);
  const headActionInProgress = new Map(args.actionInProgress.value);
  headActionInProgress.set(firstTargetActionKey, 'update');
  args.actionInProgress.value = headActionInProgress;
  let acceptedTargetIds: string[] = [];
  try {
    const response = await apiUpdateContainers(groupContainerIds);
    acceptedTargetIds = response.accepted.map((accepted) => accepted.containerId);
    const acceptedTargetIdSet = new Set(acceptedTargetIds);

    const toast = useToast();
    for (const rejected of response.rejected) {
      if (isStaleContainerUpdateError(rejected.message)) {
        continue;
      }
      toast.error(
        args.t('containerComponents.actionToasts.groupUpdateRejected', {
          name: rejected.containerName,
          message: rejected.message,
        }),
      );
    }

    await args.loadContainers();
    for (const container of updatableContainers) {
      if (!acceptedTargetIdSet.has(container.id)) {
        continue;
      }
      markPendingActionState({
        actionPending: args.actionPending,
        actionPendingLifecycleModes: args.actionPendingLifecycleModes,
        actionPendingLifecycleObserved: args.actionPendingLifecycleObserved,
        startPolling: args.startPolling,
        pendingKey: container.id,
        snapshot: container,
        mode: 'update',
      });
    }
    if (acceptedTargetIds.length >= 2) {
      args.captureBatch(args.group.key, acceptedTargetIds.length);
    } else {
      args.clearBatch(args.group.key);
    }
    if (acceptedTargetIds.length > 0) {
      toast.success(
        args.t(
          acceptedTargetIds.length === 1
            ? 'containersView.toast.queuedUpdateGroupSingle'
            : 'containersView.toast.queuedUpdateGroupMultiple',
          { count: acceptedTargetIds.length, group: args.group.key },
        ),
      );
    }
  } catch (error: unknown) {
    args.clearBatch(args.group.key);
    useToast().error(
      errorMessage(
        error,
        args.t('containerComponents.actionToasts.groupUpdateFailed', { name: args.group.key }),
      ),
    );
  } finally {
    if (acceptedTargetIds.length === 0) {
      args.clearBatch(args.group.key);
    }
    const nextActionInProgress = new Map(args.actionInProgress.value);
    nextActionInProgress.delete(firstTargetActionKey);
    args.actionInProgress.value = nextActionInProgress;
  }
}

async function deleteContainerState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerId?: string;
  actionKey: string;
  name: string;
  skipKey: string;
  actionInProgress: Ref<Map<string, ContainerActionKind>>;
  inputError: Ref<string | null>;
  skippedUpdates: Ref<Set<string>>;
  selectedContainerId: string | undefined;
  closeFullPage: () => void;
  closePanel: () => void;
  loadContainers: () => Promise<void>;
  t: TranslateFn;
}): Promise<boolean> {
  if (!args.containerActionsEnabled) {
    args.inputError.value = args.containerActionsDisabledReason;
    return false;
  }
  const containerId = args.containerId;
  if (!containerId || args.actionInProgress.value.has(args.actionKey)) {
    return false;
  }
  const next = new Map(args.actionInProgress.value);
  next.set(args.actionKey, 'delete');
  args.actionInProgress.value = next;
  try {
    await apiDeleteContainer(containerId);
    args.skippedUpdates.value.delete(args.skipKey);
    if (args.selectedContainerId === containerId) {
      args.closeFullPage();
      args.closePanel();
    }
    await args.loadContainers();
    const toast = useToast();
    toast.success(args.t('containerComponents.actionToasts.deleted', { name: args.name }));
    return true;
  } catch (e: unknown) {
    const msg = errorMessage(
      e,
      args.t('containerComponents.actionToasts.deleteFailedDetail', { name: args.name }),
    );
    args.inputError.value = msg;
    const toast = useToast();
    toast.error(
      args.t('containerComponents.actionToasts.deleteFailedTitle', { name: args.name }),
      msg,
    );
    return false;
  } finally {
    const next = new Map(args.actionInProgress.value);
    next.delete(args.actionKey);
    args.actionInProgress.value = next;
  }
}

function stopPendingActionsPollingState(
  pendingActionsPollTimer: Ref<ReturnType<typeof setTimeout> | null>,
  pendingActionsPollIntervalMs?: Ref<number>,
) {
  if (!pendingActionsPollTimer.value) {
    // c8 ignore next 3: the optional param is always passed by the only caller; defensive guard
    /* c8 ignore next 3 */
    if (pendingActionsPollIntervalMs) {
      pendingActionsPollIntervalMs.value = PENDING_ACTIONS_POLL_INTERVAL_MS;
    }
    return;
  }
  clearTimeout(pendingActionsPollTimer.value);
  pendingActionsPollTimer.value = null;
  // c8 ignore next 3: the optional param is always passed by the only caller; defensive guard
  /* c8 ignore next 3 */
  if (pendingActionsPollIntervalMs) {
    pendingActionsPollIntervalMs.value = PENDING_ACTIONS_POLL_INTERVAL_MS;
  }
}

function clearPendingActionState(args: {
  actionPending: Ref<Map<string, Container>>;
  actionPendingStartTimes: Ref<Map<string, number>>;
  actionPendingLifecycleModes: Ref<Map<string, PendingActionLifecycleMode>>;
  actionPendingLifecycleObserved: Ref<Set<string>>;
  pendingKey: string;
}) {
  args.actionPending.value.delete(args.pendingKey);
  args.actionPendingStartTimes.value.delete(args.pendingKey);
  args.actionPendingLifecycleModes.value.delete(args.pendingKey);
  const nextObserved = new Set(args.actionPendingLifecycleObserved.value);
  nextObserved.delete(args.pendingKey);
  args.actionPendingLifecycleObserved.value = nextObserved;
}

export function isPendingUpdateSettled(args: {
  pendingKey: string;
  now: number;
  startTime: number;
  liveContainer?: Container;
  snapshot?: Container;
  actionPendingLifecycleObserved: Ref<Set<string>>;
}) {
  const expectedStatus = args.snapshot?.status ?? args.liveContainer?.status;
  const observedLifecycleSignal =
    !args.liveContainer ||
    args.liveContainer.updateOperation?.status === 'in-progress' ||
    args.liveContainer.updateOperation?.status === 'queued' ||
    args.liveContainer.status !== expectedStatus;
  if (observedLifecycleSignal) {
    const nextObserved = new Set(args.actionPendingLifecycleObserved.value);
    nextObserved.add(args.pendingKey);
    args.actionPendingLifecycleObserved.value = nextObserved;
  }

  if (!args.liveContainer) {
    return false;
  }

  if (
    args.liveContainer.updateOperation?.status === 'in-progress' ||
    args.liveContainer.updateOperation?.status === 'queued'
  ) {
    return false;
  }

  if (args.liveContainer.status !== expectedStatus) {
    return false;
  }

  return (
    args.actionPendingLifecycleObserved.value.has(args.pendingKey) ||
    args.now - args.startTime >= PENDING_UPDATE_GRACE_MS
  );
}

export function prunePendingActionsState(args: {
  now: number;
  containers: Readonly<Ref<Container[]>>;
  actionPending: Ref<Map<string, Container>>;
  actionPendingStartTimes: Ref<Map<string, number>>;
  actionPendingLifecycleModes: Ref<Map<string, PendingActionLifecycleMode>>;
  actionPendingLifecycleObserved: Ref<Set<string>>;
  pollTimeout: number;
  stopPendingActionsPolling: () => void;
}) {
  const liveContainersByActionKey = new Map<string, Container>();
  const liveContainersByIdentityKey = new Map<string, Container>();

  for (const container of args.containers.value) {
    const actionKey = getContainerActionKey(container);
    if (actionKey) {
      liveContainersByActionKey.set(actionKey, container);
    }
    const identityKey = getContainerActionIdentityKey(container);
    if (identityKey) {
      liveContainersByIdentityKey.set(identityKey, container);
    }
  }

  for (const [pendingKey, startTime] of args.actionPendingStartTimes.value.entries()) {
    const snapshot = args.actionPending.value.get(pendingKey);
    const snapshotIdentityKey = snapshot ? getContainerActionIdentityKey(snapshot) : '';
    const liveContainer =
      liveContainersByActionKey.get(pendingKey) ??
      (snapshotIdentityKey ? liveContainersByIdentityKey.get(snapshotIdentityKey) : undefined);
    const pendingMode = args.actionPendingLifecycleModes.value.get(pendingKey);
    const timedOut = args.now - startTime >= args.pollTimeout;
    const settled =
      pendingMode === 'update'
        ? isPendingUpdateSettled({
            pendingKey,
            now: args.now,
            startTime,
            liveContainer,
            snapshot,
            actionPendingLifecycleObserved: args.actionPendingLifecycleObserved,
          })
        : Boolean(liveContainer);

    if (timedOut || settled) {
      clearPendingActionState({
        actionPending: args.actionPending,
        actionPendingStartTimes: args.actionPendingStartTimes,
        actionPendingLifecycleModes: args.actionPendingLifecycleModes,
        actionPendingLifecycleObserved: args.actionPendingLifecycleObserved,
        pendingKey,
      });
    }
  }
  if (args.actionPending.value.size === 0) {
    args.stopPendingActionsPolling();
  }
}

export async function pollPendingActionsState(args: {
  pendingActionsPollInFlight: Ref<boolean>;
  loadContainers: () => Promise<void>;
  prunePendingActions: (now: number) => void;
}) {
  if (args.pendingActionsPollInFlight.value) {
    return;
  }
  args.pendingActionsPollInFlight.value = true;
  try {
    // containers.value is now kept fresh by granular SSE patches
    // (applyContainerPatch + applyOperationPatch). prunePendingActions walks
    // the current in-memory list to settle/time-out pending actions — no
    // GET /api/v1/containers needed each tick. loadContainers remains on args
    // for back-compat with callers that may wire it, but is no longer called
    // from the happy-path poll.
    args.prunePendingActions(Date.now());
  } finally {
    args.pendingActionsPollInFlight.value = false;
  }
}

function startPollingState(args: {
  pendingKey: string;
  actionPending: Ref<Map<string, Container>>;
  actionPendingStartTimes: Ref<Map<string, number>>;
  pendingActionsPollTimer: Ref<ReturnType<typeof setTimeout> | null>;
  pendingActionsPollIntervalMs: Ref<number>;
  initialPollInterval: number;
  maxPollInterval: number;
  pollBackoffFactor: number;
  pollPendingActions: () => Promise<void>;
}) {
  if (!args.actionPendingStartTimes.value.has(args.pendingKey)) {
    args.actionPendingStartTimes.value.set(args.pendingKey, Date.now());
  }
  if (args.pendingActionsPollTimer.value) {
    return;
  }
  args.pendingActionsPollIntervalMs.value = args.initialPollInterval;
  schedulePendingActionsPoll(args);
}

function schedulePendingActionsPoll(args: {
  actionPending: Ref<Map<string, Container>>;
  pendingActionsPollTimer: Ref<ReturnType<typeof setTimeout> | null>;
  pendingActionsPollIntervalMs: Ref<number>;
  initialPollInterval: number;
  maxPollInterval: number;
  pollBackoffFactor: number;
  pollPendingActions: () => Promise<void>;
}) {
  args.pendingActionsPollTimer.value = setTimeout(() => {
    args.pendingActionsPollTimer.value = null;
    void args.pollPendingActions();
    if (args.actionPending.value.size === 0) {
      args.pendingActionsPollIntervalMs.value = args.initialPollInterval;
      return;
    }
    args.pendingActionsPollIntervalMs.value = Math.min(
      args.pendingActionsPollIntervalMs.value * args.pollBackoffFactor,
      args.maxPollInterval,
    );
    schedulePendingActionsPoll(args);
  }, args.pendingActionsPollIntervalMs.value);
}

function createConfirmHandlers(args: {
  confirm: ReturnType<typeof useConfirmDialog>;
  executeAction: (
    target: ContainerActionTarget,
    action: (id: string) => Promise<unknown>,
    options?: {
      kind?: ContainerActionKind;
      containerId?: string;
      reloadContainers?: boolean;
      successMessage?: string;
      staleMessage?: string;
      treatNoUpdateAsStale?: boolean;
      pendingLifecycleMode?: PendingActionLifecycleMode;
    },
  ) => Promise<boolean>;
  forceUpdate: (target: ContainerActionTarget) => Promise<void>;
  deleteContainer: (target: ContainerActionTarget) => Promise<boolean>;
  clearPolicySelected: () => Promise<void>;
  selectedContainer: Readonly<Ref<Container | null | undefined>>;
  rollbackToBackup: (backupId?: string) => Promise<void>;
  t: TranslateFn;
}) {
  function confirmStop(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    args.confirm.require({
      header: args.t('containerComponents.confirmDialogs.stop.header'),
      message: args.t('containerComponents.confirmDialogs.stop.message', { name }),
      rejectLabel: args.t('containerComponents.confirmDialogs.cancel'),
      acceptLabel: args.t('containerComponents.confirmDialogs.stop.acceptLabel'),
      severity: 'danger',
      accept: () =>
        args.executeAction(target, apiStopContainer, {
          kind: 'lifecycle',
          successMessage: args.t('containerComponents.confirmDialogs.stop.successMessage', {
            name,
          }),
        }) as unknown as Promise<void>,
    });
  }

  function confirmRestart(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    args.confirm.require({
      header: args.t('containerComponents.confirmDialogs.restart.header'),
      message: args.t('containerComponents.confirmDialogs.restart.message', { name }),
      rejectLabel: args.t('containerComponents.confirmDialogs.cancel'),
      acceptLabel: args.t('containerComponents.confirmDialogs.restart.acceptLabel'),
      severity: 'warn',
      accept: () =>
        args.executeAction(target, apiRestartContainer, {
          kind: 'lifecycle',
          successMessage: args.t('containerComponents.confirmDialogs.restart.successMessage', {
            name,
          }),
        }) as unknown as Promise<void>,
    });
  }

  function confirmForceUpdate(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    args.confirm.require({
      header: args.t('containerComponents.confirmDialogs.forceUpdate.header'),
      message: args.t('containerComponents.confirmDialogs.forceUpdate.message', { name }),
      rejectLabel: args.t('containerComponents.confirmDialogs.cancel'),
      acceptLabel: args.t('containerComponents.confirmDialogs.forceUpdate.acceptLabel'),
      severity: 'warn',
      accept: () => args.forceUpdate(target),
    });
  }

  function confirmUpdate(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    const container = args.selectedContainer.value;
    // Prefer the explicit target's eligibility (from the row) over the side-panel's
    // selected-container view, which can be a different container when the user clicks
    // Update from a row in a non-selected stack.
    const eligibility =
      typeof target === 'object' && target
        ? target.updateEligibility
        : container?.updateEligibility;
    const hardBlocker = getPrimaryHardBlocker(eligibility);
    if (hardBlocker) {
      useToast().warning(hardBlocker.message);
      return;
    }

    let message = args.t('containerComponents.confirmDialogs.update.messageLatest', { name });
    if (container && container.currentTag && container.newTag) {
      const isTagChange = container.updateKind !== 'digest';
      if (isTagChange) {
        const kind = container.updateKind ? ` (${container.updateKind})` : '';
        message = args.t('containerComponents.confirmDialogs.update.messageTagChange', {
          name,
          currentTag: container.currentTag,
          newTag: container.newTag,
          kind,
        });
      } else {
        message = args.t('containerComponents.confirmDialogs.update.messageDigestChange', {
          name,
          currentTag: container.currentTag,
        });
      }
    }

    // Surface soft blockers so the user knows they're overriding a policy gate
    // (snooze, threshold, maturity, skip-tag/digest, trigger-not-included/excluded).
    const softBlockers = getSoftBlockers(eligibility);
    if (softBlockers.length > 0) {
      const list = softBlockers.map((b) => `• ${b.message}`).join('\n');
      message = `${message}${args.t('containerComponents.confirmDialogs.update.softBlockerSuffix', { list })}`;
    }

    args.confirm.require({
      header: args.t('containerComponents.confirmDialogs.update.header'),
      message,
      rejectLabel: args.t('containerComponents.confirmDialogs.cancel'),
      acceptLabel:
        softBlockers.length > 0
          ? args.t('containerComponents.confirmDialogs.update.acceptLabelOverride')
          : args.t('containerComponents.confirmDialogs.update.acceptLabel'),
      severity: 'warn',
      accept: () =>
        args.executeAction(target, apiUpdateContainer, {
          kind: 'update',
          successMessage: getContainerUpdateStartedMessage(name, args.t),
          treatNoUpdateAsStale: true,
          pendingLifecycleMode: 'update',
        }) as unknown as Promise<void>,
    });
  }

  function confirmDelete(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    args.confirm.require({
      header: args.t('containerComponents.confirmDialogs.delete.header'),
      message: args.t('containerComponents.confirmDialogs.delete.message', { name }),
      rejectLabel: args.t('containerComponents.confirmDialogs.cancel'),
      acceptLabel: args.t('containerComponents.confirmDialogs.delete.acceptLabel'),
      severity: 'danger',
      accept: () => args.deleteContainer(target) as unknown as Promise<void>,
    });
  }

  function confirmClearPolicy() {
    const containerName = args.selectedContainer.value?.name;
    if (!containerName) {
      return;
    }
    args.confirm.require({
      header: args.t('containerComponents.confirmDialogs.clearPolicy.header'),
      message: args.t('containerComponents.confirmDialogs.clearPolicy.message', {
        name: containerName,
      }),
      rejectLabel: args.t('containerComponents.confirmDialogs.cancel'),
      acceptLabel: args.t('containerComponents.confirmDialogs.clearPolicy.acceptLabel'),
      severity: 'warn',
      accept: () => args.clearPolicySelected(),
    });
  }

  function confirmRollback(backupId?: string) {
    const containerName = args.selectedContainer.value?.name;
    if (!containerName) {
      return;
    }
    args.confirm.require({
      header: args.t('containerComponents.confirmDialogs.rollback.header'),
      message: backupId
        ? args.t('containerComponents.confirmDialogs.rollback.messageSelected', {
            name: containerName,
          })
        : args.t('containerComponents.confirmDialogs.rollback.messageLatest', {
            name: containerName,
          }),
      rejectLabel: args.t('containerComponents.confirmDialogs.cancel'),
      acceptLabel: args.t('containerComponents.confirmDialogs.rollback.acceptLabel'),
      severity: 'danger',
      accept: () => args.rollbackToBackup(backupId),
    });
  }

  return {
    confirmClearPolicy,
    confirmDelete,
    confirmForceUpdate,
    confirmRestart,
    confirmRollback,
    confirmStop,
    confirmUpdate,
  };
}

function createContainerActionHandlers(args: {
  executeAction: (
    target: ContainerActionTarget,
    action: (id: string) => Promise<unknown>,
    options?: {
      kind?: ContainerActionKind;
      containerId?: string;
      reloadContainers?: boolean;
      successMessage?: string;
      staleMessage?: string;
      treatNoUpdateAsStale?: boolean;
      pendingLifecycleMode?: PendingActionLifecycleMode;
    },
  ) => Promise<boolean>;
  applyPolicy: (
    target: ContainerActionTarget,
    action: string,
    payload: Record<string, unknown>,
    message: string,
  ) => Promise<boolean>;
  skippedUpdates: Ref<Set<string>>;
  selectedContainer: Readonly<Ref<Container | null | undefined>>;
  activeDetailTab: Readonly<Ref<string>>;
  refreshActionTabData: () => Promise<void>;
  containerIdMap: Readonly<Ref<Record<string, string>>>;
  containerActionsEnabled: Readonly<Ref<boolean>>;
  containerActionsDisabledReason: Readonly<Ref<string>>;
  inputError: Ref<string | null>;
  markScanStarted: (containerId: string | undefined) => void;
  markScanCompleted: (containerId: string | undefined) => void;
  recheckingContainerId: Ref<string | null>;
  t: TranslateFn;
}) {
  async function startContainer(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    await args.executeAction(target, apiStartContainer, {
      kind: 'lifecycle',
      successMessage: args.t('containerComponents.actionToasts.started', { name }),
    });
  }

  async function updateContainer(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    await args.executeAction(target, apiUpdateContainer, {
      kind: 'update',
      successMessage: getContainerUpdateStartedMessage(name, args.t),
      staleMessage: getContainerAlreadyUpToDateMessage(name, args.t),
      treatNoUpdateAsStale: true,
      pendingLifecycleMode: 'update',
    });
  }

  async function scanContainer(target: ContainerActionTarget) {
    if (!args.containerActionsEnabled.value) {
      args.inputError.value = args.containerActionsDisabledReason.value;
      return;
    }
    const { containerId, name } = resolveContainerActionTarget(target, args.containerIdMap.value);
    if (!containerId) {
      return;
    }
    // Anchor the per-row Scanning chip to this container immediately and let
    // the SSE dd:scan-completed event (or the safety timeout) clear it. We
    // intentionally do NOT clear it in the HTTP finally — the response and
    // the completion event arrive together when the backend finishes scanning,
    // but driving the lifecycle from SSE keeps the row spinner correctly
    // anchored even when scheduled scans (no HTTP click) start the work.
    args.markScanStarted(containerId);
    args.inputError.value = null;
    try {
      await apiScanContainer(containerId);
      const toast = useToast();
      toast.success(args.t('containerComponents.actionToasts.scanTriggered', { name }));
    } catch (e: unknown) {
      args.markScanCompleted(containerId);
      const msg = errorMessage(
        e,
        args.t('containerComponents.actionToasts.scanFailedDetail', { name }),
      );
      args.inputError.value = msg;
      const toast = useToast();
      toast.error(args.t('containerComponents.actionToasts.scanFailedTitle', { name }), msg);
    }
  }

  async function recheckContainer(target: ContainerActionTarget) {
    const { containerId, name } = resolveContainerActionTarget(target, args.containerIdMap.value);
    if (!containerId) {
      return;
    }
    args.recheckingContainerId.value = containerId;
    args.inputError.value = null;
    const toast = useToast();
    try {
      const result = await apiRefreshContainer(containerId);
      if (result === undefined) {
        toast.warning(args.t('containerComponents.actionToasts.recheckNotFound', { name }));
        return;
      }
      toast.success(args.t('containerComponents.actionToasts.recheckComplete', { name }));
    } catch (e: unknown) {
      const msg = errorMessage(
        e,
        args.t('containerComponents.actionToasts.recheckFailedDetail', { name }),
      );
      args.inputError.value = msg;
      toast.error(args.t('containerComponents.actionToasts.recheckFailedTitle', { name }), msg);
    } finally {
      args.recheckingContainerId.value = null;
    }
  }

  async function skipUpdate(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    const targetKey = resolveContainerActionTargetKey(target);
    const applied = await args.applyPolicy(
      target,
      'skip-current',
      {},
      args.t('containerComponents.policy.toasts.skipped', { name }),
    );
    if (applied) {
      args.skippedUpdates.value.add(targetKey);
      const selectedKey = args.selectedContainer.value
        ? resolveContainerActionTargetKey(args.selectedContainer.value)
        : undefined;
      if (selectedKey === targetKey && args.activeDetailTab.value === 'actions') {
        await args.refreshActionTabData();
      }
    }
  }

  async function forceUpdate(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    await args.applyPolicy(
      target,
      'clear',
      {},
      args.t('containerComponents.policy.toasts.clearPolicy'),
    );
    await args.executeAction(target, apiUpdateContainer, {
      kind: 'update',
      successMessage: getForceContainerUpdateStartedMessage(name, args.t),
      staleMessage: getContainerAlreadyUpToDateMessage(name, args.t),
      treatNoUpdateAsStale: true,
      pendingLifecycleMode: 'update',
    });
  }

  return {
    forceUpdate,
    recheckContainer,
    scanContainer,
    skipUpdate,
    startContainer,
    updateContainer,
  };
}

export function useContainerActions(input: UseContainerActionsInput) {
  const confirm = useConfirmDialog();
  const { t } = useI18n();
  const { getDisplayUpdateOperation, projectContainerDisplayState } = useOperationDisplayHold();
  const { containerActionsEnabled, containerActionsDisabledReason } = useServerFeatures();
  const scanLifecycle = useScanLifecycle();

  const skippedUpdates = ref(new Set<string>());
  const selectedContainerKey = computed(() =>
    input.selectedContainer.value
      ? resolveContainerActionTargetKey(input.selectedContainer.value)
      : undefined,
  );

  let actionTabDetailRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  function clearActionTabDetailRefreshTimer() {
    if (actionTabDetailRefreshTimer === undefined) {
      return;
    }
    clearTimeout(actionTabDetailRefreshTimer);
    actionTabDetailRefreshTimer = undefined;
  }

  const preview = useContainerPreview({
    selectedContainerId: input.selectedContainerId,
  });

  const refreshActionTabData = async () => {
    await Promise.all([
      triggers.loadDetailTriggers(),
      backups.loadDetailBackups(),
      backups.loadDetailUpdateOperations(),
    ]);
  };

  const triggers = useContainerTriggers({
    selectedContainerId: input.selectedContainerId,
    containerActionsEnabled,
    containerActionsDisabledReason,
    loadContainers: input.loadContainers,
    refreshActionTabData,
  });

  const backups = useContainerBackups({
    selectedContainerId: input.selectedContainerId,
    selectedContainerKey,
    skippedUpdates,
    containerActionsEnabled,
    containerActionsDisabledReason,
    loadContainers: input.loadContainers,
  });

  const policy = useContainerPolicy({
    selectedContainer: input.selectedContainer,
    containerMetaMap: input.containerMetaMap,
    containerIdMap: input.containerIdMap,
    loadContainers: input.loadContainers,
    skippedUpdates,
    containerActionsEnabled,
    containerActionsDisabledReason,
    refreshActionTabData,
  });

  function scheduleActionTabDataRefresh() {
    clearActionTabDetailRefreshTimer();
    actionTabDetailRefreshTimer = setTimeout(() => {
      actionTabDetailRefreshTimer = undefined;
      void refreshActionTabData();
    }, ACTION_TAB_DETAIL_REFRESH_DEBOUNCE_MS);
  }

  watch(
    () => [selectedContainerKey.value, input.activeDetailTab.value],
    ([containerKey, tabName]) => {
      preview.resetPreview();

      if (!containerKey) {
        clearActionTabDetailRefreshTimer();
        triggers.clearTriggerDetails();
        backups.clearBackupsDetails();
        triggers.resetTriggerMessages();
        backups.resetBackupsMessages();
        policy.resetPolicyMessages();
        return;
      }

      if (tabName === 'actions') {
        triggers.resetTriggerMessages();
        backups.resetBackupsMessages();
        policy.resetPolicyMessages();
        scheduleActionTabDataRefresh();
        return;
      }

      clearActionTabDetailRefreshTimer();
    },
    { immediate: true },
  );

  const recheckingContainerId = ref<string | null>(null);
  const actionInProgress = ref(new Map<string, ContainerActionKind>());
  const actionPending = ref<Map<string, Container>>(new Map());
  const actionPendingStartTimes = ref<Map<string, number>>(new Map());
  const actionPendingLifecycleModes = ref<Map<string, PendingActionLifecycleMode>>(new Map());
  const actionPendingLifecycleObserved = ref<Set<string>>(new Set());
  const pendingActionsPollTimer = ref<ReturnType<typeof setTimeout> | null>(null);
  const pendingActionsPollIntervalMs = ref(PENDING_ACTIONS_POLL_INTERVAL_MS);
  const pendingActionsPollInFlight = ref(false);
  const POLL_TIMEOUT = 30000;
  const { captureBatch, clearBatch } = useUpdateBatches();

  function stopPendingActionsPolling() {
    stopPendingActionsPollingState(pendingActionsPollTimer, pendingActionsPollIntervalMs);
  }

  function prunePendingActions(now: number) {
    prunePendingActionsState({
      now,
      containers: input.containers,
      actionPending,
      actionPendingStartTimes,
      actionPendingLifecycleModes,
      actionPendingLifecycleObserved,
      pollTimeout: POLL_TIMEOUT,
      stopPendingActionsPolling,
    });
  }

  async function pollPendingActions() {
    await pollPendingActionsState({
      pendingActionsPollInFlight,
      loadContainers: input.loadContainers,
      prunePendingActions,
    });
  }

  function startPolling(pendingKey: string) {
    startPollingState({
      pendingKey,
      actionPending,
      actionPendingStartTimes,
      pendingActionsPollTimer,
      pendingActionsPollIntervalMs,
      initialPollInterval: PENDING_ACTIONS_POLL_INTERVAL_MS,
      maxPollInterval: PENDING_ACTIONS_POLL_MAX_INTERVAL_MS,
      pollBackoffFactor: PENDING_ACTIONS_POLL_BACKOFF_FACTOR,
      pollPendingActions,
    });
  }

  onUnmounted(() => {
    clearActionTabDetailRefreshTimer();
    stopPendingActionsPolling();
  });

  watch(
    () => input.containers.value,
    () => {
      if (actionPending.value.size === 0) {
        return;
      }
      prunePendingActions(Date.now());
    },
  );

  function hasOtherLocalTrackedAction(target: Exclude<ContainerActionTarget, string>) {
    const targetKey = resolveContainerActionTargetKey(target);
    return [...actionInProgress.value.keys()].some((actionKey) => actionKey !== targetKey);
  }

  function getDisplayContainers() {
    return input.containers.value.map(projectContainerDisplayState);
  }

  function isContainerUpdateInProgress(target: ContainerActionTarget) {
    const hasTrackedAction = hasTrackedContainerActionOfKind(
      actionInProgress.value,
      typeof target === 'string' ? { name: target } : target,
      'update',
    );
    if (hasTrackedAction) {
      return true;
    }
    const displayContainers = getDisplayContainers();
    if (typeof target !== 'string') {
      const freshContainer = displayContainers.find((c) => c.id === target.id);
      const liveOperation = freshContainer?.updateOperation ?? getDisplayUpdateOperation(target);
      if (liveOperation?.status === 'in-progress') {
        return true;
      }
      if (!liveOperation && hasPendingContainerAction(target, actionPending)) {
        return true;
      }
      if (
        shouldRenderStandaloneQueuedUpdateAsUpdating({
          containers: displayContainers,
          hasExternalActiveHead: hasOtherLocalTrackedAction(target),
          operation: liveOperation,
          targetId: target.id,
        })
      ) {
        return true;
      }
      return false;
    }
    return (
      hasPendingContainerAction(target, actionPending) ||
      hasInProgressUpdateOperationByIdentityKey(target, displayContainers)
    );
  }

  function isContainerUpdateQueued(target: ContainerActionTarget) {
    if (typeof target === 'string') {
      return false;
    }
    const hasTrackedUpdateAction = hasTrackedContainerActionOfKind(
      actionInProgress.value,
      target,
      'update',
    );
    if (hasTrackedUpdateAction) {
      return false;
    }
    const hasAnyTrackedAction = hasTrackedContainerAction(actionInProgress.value, target);
    if (hasAnyTrackedAction) {
      return false;
    }
    const displayContainers = getDisplayContainers();
    const freshContainer = displayContainers.find((container) => container.id === target.id);
    const liveOperation = freshContainer?.updateOperation ?? getDisplayUpdateOperation(target);
    if (liveOperation?.status === 'in-progress') {
      return false;
    }
    if (
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        containers: displayContainers,
        hasExternalActiveHead: hasOtherLocalTrackedAction(target),
        operation: liveOperation,
        targetId: target.id,
      })
    ) {
      return false;
    }
    return liveOperation?.status === 'queued';
  }

  function isContainerScanInProgress(target: ContainerActionTarget) {
    if (typeof target !== 'string' && target.id && scanLifecycle.isScanInFlight(target.id)) {
      return true;
    }
    if (typeof target === 'string') {
      // Caller may pass either a container name (resolve via map) or a raw id —
      // try both since the SSE-driven set is keyed by container id.
      const resolvedId = input.containerIdMap.value[target];
      if (resolvedId && scanLifecycle.isScanInFlight(resolvedId)) {
        return true;
      }
      if (scanLifecycle.isScanInFlight(target)) {
        return true;
      }
    }
    return hasTrackedContainerActionOfKind(
      actionInProgress.value,
      typeof target === 'string' ? { name: target } : target,
      'scan',
    );
  }

  function isContainerRowLocked(target: ContainerActionTarget) {
    return isContainerUpdateInProgress(target) || isContainerUpdateQueued(target);
  }

  async function executeAction(
    target: ContainerActionTarget,
    action: (id: string) => Promise<unknown>,
    options?: {
      kind?: ContainerActionKind;
      containerId?: string;
      reloadContainers?: boolean;
      successMessage?: string;
      staleMessage?: string;
      treatNoUpdateAsStale?: boolean;
      pendingLifecycleMode?: PendingActionLifecycleMode;
    },
  ) {
    const { containerId, name } = resolveContainerActionTarget(
      target,
      input.containerIdMap.value,
      options?.containerId,
    );
    const actionKey = containerId ?? resolveContainerActionTargetKey(target);
    const pendingKey = resolveContainerActionTargetKey(target);
    return executeContainerActionState({
      containerActionsEnabled: containerActionsEnabled.value,
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containerId,
      actionKey,
      pendingKey,
      name,
      kind: options?.kind ?? 'lifecycle',
      actionInProgress,
      inputError: input.error,
      containers: input.containers,
      action,
      loadContainers: input.loadContainers,
      reloadContainers: options?.reloadContainers,
      actionPending,
      actionPendingLifecycleModes,
      actionPendingLifecycleObserved,
      startPolling,
      selectedContainerId: input.selectedContainer.value?.id,
      activeDetailTab: input.activeDetailTab.value,
      refreshActionTabData,
      successMessage: options?.successMessage,
      staleMessage: options?.staleMessage,
      treatNoUpdateAsStale: options?.treatNoUpdateAsStale,
      pendingLifecycleMode: options?.pendingLifecycleMode,
      t: t as TranslateFn,
    });
  }

  async function updateAllInGroup(group: ContainerActionGroup) {
    await updateAllInGroupState({
      containerActionsEnabled: containerActionsEnabled.value,
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containers: input.containers,
      projectContainerDisplayState,
      inputError: input.error,
      actionInProgress,
      actionPending,
      actionPendingLifecycleModes,
      actionPendingLifecycleObserved,
      startPolling,
      group,
      loadContainers: input.loadContainers,
      captureBatch,
      clearBatch,
      alreadyInProgressMessage: t('containersView.toast.updateAlreadyInProgress'),
      t: t as TranslateFn,
    });
  }

  const {
    forceUpdate,
    recheckContainer,
    scanContainer,
    skipUpdate,
    startContainer,
    updateContainer,
  } = createContainerActionHandlers({
    executeAction,
    applyPolicy: policy.applyPolicy,
    skippedUpdates,
    selectedContainer: input.selectedContainer,
    activeDetailTab: input.activeDetailTab,
    refreshActionTabData,
    containerIdMap: input.containerIdMap,
    containerActionsEnabled,
    containerActionsDisabledReason,
    inputError: input.error,
    markScanStarted: scanLifecycle.markScanStarted,
    markScanCompleted: scanLifecycle.markScanCompleted,
    recheckingContainerId,
    t: t as TranslateFn,
  });

  async function cancelUpdate(target: Pick<Container, 'id' | 'name' | 'updateOperation'>) {
    const { name } = target;
    const operationId = target.updateOperation?.id;
    if (!operationId) {
      return;
    }
    const toast = useToast();
    try {
      const outcome = await apiCancelUpdateOperation(operationId);
      if (outcome === 'cancel-requested') {
        toast.success(t('containerComponents.actionToasts.cancellationRequested', { name }));
      } else {
        toast.success(t('containerComponents.actionToasts.cancelled', { name }));
      }
      await input.loadContainers();
    } catch (e: unknown) {
      const statusCode = (e as { statusCode?: number }).statusCode;
      if (statusCode === 409) {
        toast.warning(t('containerComponents.actionToasts.cancelAlreadyFinished', { name }));
      } else if (statusCode === 404) {
        toast.error(t('containerComponents.actionToasts.cancelOperationNotFound', { name }));
      } else {
        toast.error(errorMessage(e, t('containerComponents.actionToasts.cancelFailed', { name })));
      }
    }
  }

  async function deleteContainer(target: ContainerActionTarget) {
    const { containerId, name } = resolveContainerActionTarget(target, input.containerIdMap.value);
    const actionKey = containerId ?? resolveContainerActionTargetKey(target);
    return deleteContainerState({
      containerActionsEnabled: containerActionsEnabled.value,
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containerId,
      actionKey,
      name,
      skipKey: resolveContainerActionTargetKey(target),
      actionInProgress,
      inputError: input.error,
      skippedUpdates,
      selectedContainerId: input.selectedContainer.value?.id,
      closeFullPage: input.closeFullPage,
      closePanel: input.closePanel,
      loadContainers: input.loadContainers,
      t: t as TranslateFn,
    });
  }

  const {
    confirmClearPolicy,
    confirmDelete,
    confirmForceUpdate,
    confirmRestart,
    confirmRollback,
    confirmStop,
    confirmUpdate,
  } = createConfirmHandlers({
    confirm,
    executeAction,
    forceUpdate,
    deleteContainer,
    clearPolicySelected: policy.clearPolicySelected,
    selectedContainer: input.selectedContainer,
    rollbackToBackup: backups.rollbackToBackup,
    t: t as TranslateFn,
  });

  return {
    actionInProgress,
    actionPending,
    backupsLoading: backups.backupsLoading,
    cancelUpdate,
    containerActionsDisabledReason,
    containerActionsEnabled,
    confirmClearPolicy,
    clearPolicySelected: policy.clearPolicySelected,
    clearMaturityPolicySelected: policy.clearMaturityPolicySelected,
    clearSkipsSelected: policy.clearSkipsSelected,
    maturityMinAgeDaysInput: policy.maturityMinAgeDaysInput,
    maturityModeInput: policy.maturityModeInput,
    confirmDelete,
    confirmForceUpdate,
    confirmUpdate,
    confirmRollback,
    confirmRestart,
    confirmStop,
    containerPolicyTooltip: policy.containerPolicyTooltip,
    detailBackups: backups.detailBackups,
    detailComposePreview: preview.detailComposePreview,
    detailPreview: preview.detailPreview,
    detailTriggers: triggers.detailTriggers,
    detailUpdateOperations: backups.detailUpdateOperations,
    executeAction,
    formatOperationPhase: backups.formatOperationPhase,
    formatOperationStatus: backups.formatOperationStatus,
    formatRollbackReason: backups.formatRollbackReason,
    formatTimestamp: backups.formatTimestamp,
    getContainerListPolicyState: policy.getContainerListPolicyState,
    getOperationStatusStyle: backups.getOperationStatusStyle,
    getTriggerKey: triggers.getTriggerKey,
    isContainerRowLocked,
    isContainerScanInProgress,
    isContainerUpdateInProgress,
    isContainerUpdateQueued,
    policyError: policy.policyError,
    policyInProgress: policy.policyInProgress,
    policyMessage: policy.policyMessage,
    previewError: preview.previewError,
    previewLoading: preview.previewLoading,
    removeSkipDigestSelected: policy.removeSkipDigestSelected,
    removeSkipTagSelected: policy.removeSkipTagSelected,
    revertPolicySelected: policy.revertPolicySelected,
    rollbackError: backups.rollbackError,
    rollbackInProgress: backups.rollbackInProgress,
    rollbackMessage: backups.rollbackMessage,
    rollbackToBackup: backups.rollbackToBackup,
    runAssociatedTrigger: triggers.runAssociatedTrigger,
    runContainerPreview: preview.runContainerPreview,
    recheckContainer,
    recheckingContainerId,
    scanContainer,
    selectedHasMaturityPolicy: policy.selectedHasMaturityPolicy,
    selectedMaturityMinAgeDays: policy.selectedMaturityMinAgeDays,
    selectedMaturityMode: policy.selectedMaturityMode,
    selectedPolicyOverriddenFields: policy.selectedPolicyOverriddenFields,
    selectedPolicyOverrideFields: policy.selectedPolicyOverrideFields,
    selectedSkipDigests: policy.selectedSkipDigests,
    selectedSkipTags: policy.selectedSkipTags,
    selectedSnoozeUntil: policy.selectedSnoozeUntil,
    selectedUpdatePolicy: policy.selectedUpdatePolicy,
    setMaturityPolicySelected: policy.setMaturityPolicySelected,
    skipCurrentForSelected: policy.skipCurrentForSelected,
    skipUpdate,
    skippedUpdates,
    snoozeDateInput: policy.snoozeDateInput,
    snoozeSelected: policy.snoozeSelected,
    snoozeSelectedUntilDate: policy.snoozeSelectedUntilDate,
    startContainer,
    triggerError: triggers.triggerError,
    triggerMessage: triggers.triggerMessage,
    triggerRunInProgress: triggers.triggerRunInProgress,
    triggersLoading: triggers.triggersLoading,
    unsnoozeSelected: policy.unsnoozeSelected,
    updateAllInGroup,
    updateContainer,
    updateOperationsError: backups.updateOperationsError,
    updateOperationsLoading: backups.updateOperationsLoading,
  };
}
