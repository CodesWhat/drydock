import { computed, onUnmounted, type Ref, ref, watch } from 'vue';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import { useServerFeatures } from '../../composables/useServerFeatures';
import { useToast } from '../../composables/useToast';
import { useUpdateBatches } from '../../composables/useUpdateBatches';
import {
  deleteContainer as apiDeleteContainer,
  scanContainer as apiScanContainer,
} from '../../services/container';
import {
  restartContainer as apiRestartContainer,
  startContainer as apiStartContainer,
  stopContainer as apiStopContainer,
  updateContainer as apiUpdateContainer,
  updateContainers as apiUpdateContainers,
} from '../../services/container-actions';
import type { Container } from '../../types/container';
import {
  getContainerActionIdentityKey,
  getContainerActionKey,
  hasTrackedContainerAction,
} from '../../utils/container-action-key';
import {
  formatContainerUpdateStartedCountMessage,
  getContainerAlreadyUpToDateMessage,
  getContainerUpdateStartedMessage,
  getForceContainerUpdateStartedMessage,
  isStaleContainerUpdateError,
  runContainerUpdateRequest,
  shouldRenderStandaloneQueuedUpdateAsUpdating,
} from '../../utils/container-update';
import { errorMessage } from '../../utils/error';
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
  | Pick<Container, 'id' | 'name' | 'identityKey' | 'updateOperation'>;

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
  containers: Readonly<Ref<Container[]>>,
) {
  return containers.value.some((container) => {
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
  actionInProgress: Ref<Set<string>>;
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
}): Promise<boolean> {
  if (!args.containerActionsEnabled) {
    args.inputError.value = args.containerActionsDisabledReason;
    return false;
  }
  const containerId = args.containerId;
  if (!containerId || args.actionInProgress.value.has(args.actionKey)) {
    return false;
  }
  const next = new Set(args.actionInProgress.value);
  next.add(args.actionKey);
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
    const msg = errorMessage(e, `Action failed for ${args.name}`);
    args.inputError.value = msg;
    const toast = useToast();
    toast.error(`Update failed: ${args.name}`, msg);
    if (shouldReloadContainers) {
      await args.loadContainers();
    }
    return false;
  } finally {
    const next = new Set(args.actionInProgress.value);
    next.delete(args.actionKey);
    args.actionInProgress.value = next;
  }
}

async function updateAllInGroupState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containers: Readonly<Ref<Container[]>>;
  inputError: Ref<string | null>;
  actionInProgress: Ref<Set<string>>;
  actionPending: Ref<Map<string, Container>>;
  actionPendingLifecycleModes: Ref<Map<string, PendingActionLifecycleMode>>;
  actionPendingLifecycleObserved: Ref<Set<string>>;
  startPolling: (pendingKey: string) => void;
  group: ContainerActionGroup;
  loadContainers: () => Promise<void>;
  captureBatch: (groupKey: string, frozenTotal: number) => void;
  clearBatch: (groupKey: string) => void;
}) {
  if (!args.containerActionsEnabled) {
    args.inputError.value = args.containerActionsDisabledReason;
    return;
  }
  const updatableContainers = args.group.containers.filter((container) => {
    return container.newTag && container.bouncer !== 'blocked';
  });
  if (
    updatableContainers.some((container) => {
      const liveContainer = args.containers.value.find((entry) => entry.id === container.id);
      const operation = liveContainer?.updateOperation ?? container.updateOperation;
      return (
        operation?.status === 'queued' ||
        operation?.status === 'in-progress' ||
        args.actionInProgress.value.has(container.id)
      );
    })
  ) {
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
  const headActionInProgress = new Set(args.actionInProgress.value);
  headActionInProgress.add(firstTargetActionKey);
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
      toast.error(`Failed to update ${rejected.containerName}: ${rejected.message}`);
    }

    await args.loadContainers();
    for (const container of updatableContainers) {
      if (!acceptedTargetIdSet.has(container.id)) {
        continue;
      }
      const liveContainer = args.containers.value.find((entry) => entry.id === container.id);
      const operation = liveContainer?.updateOperation;
      if (operation?.status === 'queued' || operation?.status === 'in-progress') {
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
        `${formatContainerUpdateStartedCountMessage(acceptedTargetIds.length)} in ${args.group.key}`,
      );
    }
  } catch (error: unknown) {
    args.clearBatch(args.group.key);
    useToast().error(errorMessage(error, `Failed to update ${args.group.key}`));
  } finally {
    if (acceptedTargetIds.length === 0) {
      args.clearBatch(args.group.key);
    }
    const nextActionInProgress = new Set(args.actionInProgress.value);
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
  actionInProgress: Ref<Set<string>>;
  inputError: Ref<string | null>;
  skippedUpdates: Ref<Set<string>>;
  selectedContainerId: string | undefined;
  closeFullPage: () => void;
  closePanel: () => void;
  loadContainers: () => Promise<void>;
}): Promise<boolean> {
  if (!args.containerActionsEnabled) {
    args.inputError.value = args.containerActionsDisabledReason;
    return false;
  }
  const containerId = args.containerId;
  if (!containerId || args.actionInProgress.value.has(args.actionKey)) {
    return false;
  }
  const next = new Set(args.actionInProgress.value);
  next.add(args.actionKey);
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
    toast.success(`Deleted: ${args.name}`);
    return true;
  } catch (e: unknown) {
    const msg = errorMessage(e, `Failed to delete ${args.name}`);
    args.inputError.value = msg;
    const toast = useToast();
    toast.error(`Delete failed: ${args.name}`, msg);
    return false;
  } finally {
    const next = new Set(args.actionInProgress.value);
    next.delete(args.actionKey);
    args.actionInProgress.value = next;
  }
}

function stopPendingActionsPollingState(
  pendingActionsPollTimer: Ref<ReturnType<typeof setInterval> | null>,
) {
  if (!pendingActionsPollTimer.value) {
    return;
  }
  clearInterval(pendingActionsPollTimer.value);
  pendingActionsPollTimer.value = null;
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
    const timedOut = args.now - startTime > args.pollTimeout;
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

async function pollPendingActionsState(args: {
  pendingActionsPollInFlight: Ref<boolean>;
  loadContainers: () => Promise<void>;
  prunePendingActions: (now: number) => void;
}) {
  if (args.pendingActionsPollInFlight.value) {
    return;
  }
  args.pendingActionsPollInFlight.value = true;
  try {
    await args.loadContainers();
  } finally {
    args.prunePendingActions(Date.now());
    args.pendingActionsPollInFlight.value = false;
  }
}

function startPollingState(args: {
  pendingKey: string;
  actionPendingStartTimes: Ref<Map<string, number>>;
  pendingActionsPollTimer: Ref<ReturnType<typeof setInterval> | null>;
  pollInterval: number;
  pollPendingActions: () => Promise<void>;
}) {
  if (!args.actionPendingStartTimes.value.has(args.pendingKey)) {
    args.actionPendingStartTimes.value.set(args.pendingKey, Date.now());
  }
  if (args.pendingActionsPollTimer.value) {
    return;
  }
  args.pendingActionsPollTimer.value = setInterval(() => {
    void args.pollPendingActions();
  }, args.pollInterval);
}

function createConfirmHandlers(args: {
  confirm: ReturnType<typeof useConfirmDialog>;
  executeAction: (
    target: ContainerActionTarget,
    action: (id: string) => Promise<unknown>,
    options?: {
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
}) {
  function confirmStop(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    args.confirm.require({
      header: 'Stop Container',
      message: `Stop ${name}?`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Stop',
      severity: 'danger',
      accept: () =>
        args.executeAction(target, apiStopContainer, {
          successMessage: `Stopped: ${name}`,
        }) as unknown as Promise<void>,
    });
  }

  function confirmRestart(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    args.confirm.require({
      header: 'Restart Container',
      message: `Restart ${name}?`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Restart',
      severity: 'warn',
      accept: () =>
        args.executeAction(target, apiRestartContainer, {
          successMessage: `Restarted: ${name}`,
        }) as unknown as Promise<void>,
    });
  }

  function confirmForceUpdate(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    args.confirm.require({
      header: 'Force Update',
      message: `Force update ${name}? This clears skip/snooze policy before attempting update.`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Force Update',
      severity: 'warn',
      accept: () => args.forceUpdate(target),
    });
  }

  function confirmUpdate(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    const container = args.selectedContainer.value;
    let message = `Update ${name} now? This will apply the latest discovered image.`;
    if (container && container.currentTag && container.newTag) {
      const isTagChange = container.updateKind !== 'digest';
      if (isTagChange) {
        const kind = container.updateKind ? ` (${container.updateKind})` : '';
        message = `Update ${name}? This will change the image tag from :${container.currentTag} to :${container.newTag}${kind}.`;
      } else {
        message = `Update ${name}? A newer build of :${container.currentTag} is available (digest change).`;
      }
    }
    args.confirm.require({
      header: 'Update Container',
      message,
      rejectLabel: 'Cancel',
      acceptLabel: 'Update',
      severity: 'warn',
      accept: () =>
        args.executeAction(target, apiUpdateContainer, {
          successMessage: getContainerUpdateStartedMessage(name),
          treatNoUpdateAsStale: true,
          pendingLifecycleMode: 'update',
        }) as unknown as Promise<void>,
    });
  }

  function confirmDelete(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    args.confirm.require({
      header: 'Delete Container',
      message: `Delete ${name}? This will remove it from Drydock tracking until rediscovered.`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Delete',
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
      header: 'Clear Update Policy',
      message: `Clear all update policy for ${containerName}? This removes skips, snooze, and maturity settings.`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Clear Policy',
      severity: 'warn',
      accept: () => args.clearPolicySelected(),
    });
  }

  function confirmRollback(backupId?: string) {
    const containerName = args.selectedContainer.value?.name;
    if (!containerName) {
      return;
    }
    const rollbackTarget = backupId ? 'the selected backup image' : 'the latest backup image';
    args.confirm.require({
      header: 'Rollback Container',
      message: `Rollback ${containerName} to ${rollbackTarget}? This will replace the running container image.`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Rollback',
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
}) {
  async function startContainer(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    await args.executeAction(target, apiStartContainer, { successMessage: `Started: ${name}` });
  }

  async function updateContainer(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    await args.executeAction(target, apiUpdateContainer, {
      successMessage: getContainerUpdateStartedMessage(name),
      staleMessage: getContainerAlreadyUpToDateMessage(name),
      treatNoUpdateAsStale: true,
      pendingLifecycleMode: 'update',
    });
  }

  async function scanContainer(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    await args.executeAction(target, apiScanContainer, {
      successMessage: `Scan triggered: ${name}`,
    });
  }

  async function skipUpdate(target: ContainerActionTarget) {
    const name = typeof target === 'string' ? target : target.name;
    const targetKey = resolveContainerActionTargetKey(target);
    const applied = await args.applyPolicy(
      target,
      'skip-current',
      {},
      `Skipped current update for ${name}`,
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
    await args.applyPolicy(target, 'clear', {}, `Cleared update policy for ${name}`);
    await args.executeAction(target, apiUpdateContainer, {
      successMessage: getForceContainerUpdateStartedMessage(name),
      staleMessage: getContainerAlreadyUpToDateMessage(name),
      treatNoUpdateAsStale: true,
      pendingLifecycleMode: 'update',
    });
  }

  return {
    forceUpdate,
    scanContainer,
    skipUpdate,
    startContainer,
    updateContainer,
  };
}

export function useContainerActions(input: UseContainerActionsInput) {
  const confirm = useConfirmDialog();
  const { containerActionsEnabled, containerActionsDisabledReason } = useServerFeatures();

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

  const actionInProgress = ref(new Set<string>());
  const actionPending = ref<Map<string, Container>>(new Map());
  const actionPendingStartTimes = ref<Map<string, number>>(new Map());
  const actionPendingLifecycleModes = ref<Map<string, PendingActionLifecycleMode>>(new Map());
  const actionPendingLifecycleObserved = ref<Set<string>>(new Set());
  const pendingActionsPollTimer = ref<ReturnType<typeof setInterval> | null>(null);
  const pendingActionsPollInFlight = ref(false);
  const POLL_TIMEOUT = 30000;
  const { captureBatch, clearBatch } = useUpdateBatches();

  function stopPendingActionsPolling() {
    stopPendingActionsPollingState(pendingActionsPollTimer);
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
      actionPendingStartTimes,
      pendingActionsPollTimer,
      pollInterval: PENDING_ACTIONS_POLL_INTERVAL_MS,
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
    return [...actionInProgress.value].some((actionKey) => actionKey !== targetKey);
  }

  function isContainerUpdateInProgress(target: ContainerActionTarget) {
    const hasTrackedAction = hasTrackedContainerAction(
      actionInProgress.value,
      typeof target === 'string' ? { name: target } : target,
    );
    if (hasTrackedAction) {
      return true;
    }
    if (typeof target !== 'string') {
      const freshContainer = input.containers.value.find((c) => c.id === target.id);
      const liveOperation = freshContainer?.updateOperation ?? target.updateOperation;
      if (liveOperation?.status === 'in-progress') {
        return true;
      }
      if (!liveOperation && hasPendingContainerAction(target, actionPending)) {
        return true;
      }
      if (
        shouldRenderStandaloneQueuedUpdateAsUpdating({
          containers: input.containers.value,
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
      hasInProgressUpdateOperationByIdentityKey(target, input.containers)
    );
  }

  function isContainerUpdateQueued(target: ContainerActionTarget) {
    if (typeof target === 'string') {
      return false;
    }
    const hasTrackedAction = hasTrackedContainerAction(actionInProgress.value, target);
    if (hasTrackedAction) {
      return false;
    }
    const freshContainer = input.containers.value.find((container) => container.id === target.id);
    const liveOperation = freshContainer?.updateOperation ?? target.updateOperation;
    if (liveOperation?.status === 'in-progress') {
      return false;
    }
    if (
      shouldRenderStandaloneQueuedUpdateAsUpdating({
        containers: input.containers.value,
        hasExternalActiveHead: hasOtherLocalTrackedAction(target),
        operation: liveOperation,
        targetId: target.id,
      })
    ) {
      return false;
    }
    return liveOperation?.status === 'queued';
  }

  async function executeAction(
    target: ContainerActionTarget,
    action: (id: string) => Promise<unknown>,
    options?: {
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
    });
  }

  async function updateAllInGroup(group: ContainerActionGroup) {
    await updateAllInGroupState({
      containerActionsEnabled: containerActionsEnabled.value,
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containers: input.containers,
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
    });
  }

  const { forceUpdate, scanContainer, skipUpdate, startContainer, updateContainer } =
    createContainerActionHandlers({
      executeAction,
      applyPolicy: policy.applyPolicy,
      skippedUpdates,
      selectedContainer: input.selectedContainer,
      activeDetailTab: input.activeDetailTab,
      refreshActionTabData,
    });

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
  });

  return {
    actionInProgress,
    actionPending,
    backupsLoading: backups.backupsLoading,
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
    isContainerUpdateInProgress,
    isContainerUpdateQueued,
    policyError: policy.policyError,
    policyInProgress: policy.policyInProgress,
    policyMessage: policy.policyMessage,
    previewError: preview.previewError,
    previewLoading: preview.previewLoading,
    removeSkipDigestSelected: policy.removeSkipDigestSelected,
    removeSkipTagSelected: policy.removeSkipTagSelected,
    rollbackError: backups.rollbackError,
    rollbackInProgress: backups.rollbackInProgress,
    rollbackMessage: backups.rollbackMessage,
    rollbackToBackup: backups.rollbackToBackup,
    runAssociatedTrigger: triggers.runAssociatedTrigger,
    runContainerPreview: preview.runContainerPreview,
    scanContainer,
    selectedHasMaturityPolicy: policy.selectedHasMaturityPolicy,
    selectedMaturityMinAgeDays: policy.selectedMaturityMinAgeDays,
    selectedMaturityMode: policy.selectedMaturityMode,
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
