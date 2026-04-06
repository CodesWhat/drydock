import { computed, onUnmounted, type Ref, ref, watch } from 'vue';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import { useServerFeatures } from '../../composables/useServerFeatures';
import { useToast } from '../../composables/useToast';
import {
  deleteContainer as apiDeleteContainer,
  scanContainer as apiScanContainer,
} from '../../services/container';
import {
  restartContainer as apiRestartContainer,
  startContainer as apiStartContainer,
  stopContainer as apiStopContainer,
  updateContainer as apiUpdateContainer,
} from '../../services/container-actions';
import type { Container } from '../../types/container';
import { getContainerActionKey, hasTrackedContainerAction } from '../../utils/container-action-key';
import { errorMessage, isNoUpdateAvailableError } from '../../utils/error';
import { useContainerBackups } from './useContainerBackups';
import { useContainerPolicy } from './useContainerPolicy';
import { useContainerPreview } from './useContainerPreview';
import { useContainerTriggers } from './useContainerTriggers';

interface ContainerActionGroup {
  key: string;
  containers: Container[];
}

type ContainerActionTarget = string | Pick<Container, 'id' | 'name' | 'updateOperation'>;

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

function isStaleUpdateError(error: unknown): boolean {
  return isNoUpdateAvailableError(error);
}

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
  const name = typeof target === 'string' ? target : target.name;
  return typeof name === 'string' && name.length > 0 && actionPending.value.has(name);
}

function hasInProgressUpdateOperation(
  target: ContainerActionTarget,
  containers: Readonly<Ref<Container[]>>,
) {
  if (typeof target !== 'string' && target.updateOperation?.status === 'in-progress') {
    return true;
  }

  const targetId = typeof target === 'string' ? undefined : target.id;
  const targetName = typeof target === 'string' ? target : target.name;

  return containers.value.some((container) => {
    const matches = targetId ? container.id === targetId : container.name === targetName;
    return matches && container.updateOperation?.status === 'in-progress';
  });
}

function markPendingActionState(args: {
  actionPending: Ref<Map<string, Container>>;
  actionPendingLifecycleModes: Ref<Map<string, PendingActionLifecycleMode>>;
  actionPendingLifecycleObserved: Ref<Set<string>>;
  startPolling: (name: string) => void;
  name: string;
  snapshot?: Container;
  mode: PendingActionLifecycleMode;
}) {
  if (!args.snapshot) {
    return;
  }

  args.actionPending.value.set(args.name, args.snapshot);
  args.actionPendingLifecycleModes.value.set(args.name, args.mode);

  const nextObserved = new Set(args.actionPendingLifecycleObserved.value);
  if (args.mode === 'update') {
    nextObserved.delete(args.name);
  } else {
    nextObserved.add(args.name);
  }
  args.actionPendingLifecycleObserved.value = nextObserved;
  args.startPolling(args.name);
}

async function executeContainerActionState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerId?: string;
  actionKey: string;
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
  startPolling: (name: string) => void;
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
    await args.action(containerId);
    if (args.pendingLifecycleMode === 'update') {
      markPendingActionState({
        actionPending: args.actionPending,
        actionPendingLifecycleModes: args.actionPendingLifecycleModes,
        actionPendingLifecycleObserved: args.actionPendingLifecycleObserved,
        startPolling: args.startPolling,
        name: args.name,
        snapshot,
        mode: 'update',
      });
    }
    if (shouldReloadContainers) {
      await args.loadContainers();
      const stillPresent = args.containers.value.find((container) => container.id === containerId);
      if (!stillPresent && snapshot) {
        markPendingActionState({
          actionPending: args.actionPending,
          actionPendingLifecycleModes: args.actionPendingLifecycleModes,
          actionPendingLifecycleObserved: args.actionPendingLifecycleObserved,
          startPolling: args.startPolling,
          name: args.name,
          snapshot,
          mode: args.pendingLifecycleMode ?? 'presence',
        });
      }
    }
    if (args.selectedContainerId === containerId && args.activeDetailTab === 'actions') {
      await args.refreshActionTabData();
    }
    if (args.successMessage) {
      const toast = useToast();
      toast.success(args.successMessage);
    }
    return true;
  } catch (e: unknown) {
    if (args.treatNoUpdateAsStale && isStaleUpdateError(e)) {
      if (shouldReloadContainers) {
        await args.loadContainers();
      }
      if (args.staleMessage) {
        const toast = useToast();
        toast.info(args.staleMessage);
      }
      return false;
    }
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

function setGroupUpdateStateValue(
  groupUpdateInProgress: Ref<Set<string>>,
  groupKey: string,
  updating: boolean,
) {
  const next = new Set(groupUpdateInProgress.value);
  if (updating) {
    next.add(groupKey);
  } else {
    next.delete(groupKey);
  }
  groupUpdateInProgress.value = next;
}

async function updateAllInGroupState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containers: Readonly<Ref<Container[]>>;
  inputError: Ref<string | null>;
  groupUpdateInProgress: Ref<Set<string>>;
  group: ContainerActionGroup;
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
  loadContainers: () => Promise<void>;
}) {
  if (!args.containerActionsEnabled) {
    args.inputError.value = args.containerActionsDisabledReason;
    return;
  }
  if (args.groupUpdateInProgress.value.has(args.group.key)) {
    return;
  }
  const updatableContainers = args.group.containers.filter((container) => {
    return container.newTag && container.bouncer !== 'blocked';
  });
  const frozenUpdateTargets = updatableContainers.map((container) => ({
    id: container.id,
    name: container.name,
  }));
  if (frozenUpdateTargets.length === 0) {
    return;
  }
  setGroupUpdateStateValue(args.groupUpdateInProgress, args.group.key, true);
  try {
    let updatedCount = 0;
    for (const target of frozenUpdateTargets) {
      const currentContainer = args.containers.value.find(
        (container) => container.id === target.id,
      );
      if (!currentContainer || currentContainer.name !== target.name) {
        continue;
      }

      const updated = await args.executeAction(target, apiUpdateContainer, {
        reloadContainers: false,
        treatNoUpdateAsStale: true,
        pendingLifecycleMode: 'update',
      });
      if (updated) {
        updatedCount += 1;
      }
    }
    await args.loadContainers();
    if (updatedCount > 0) {
      const toast = useToast();
      toast.success(
        `Updated ${updatedCount} container${updatedCount === 1 ? '' : 's'} in ${args.group.key}`,
      );
    }
  } finally {
    setGroupUpdateStateValue(args.groupUpdateInProgress, args.group.key, false);
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
  name: string;
}) {
  args.actionPending.value.delete(args.name);
  args.actionPendingStartTimes.value.delete(args.name);
  args.actionPendingLifecycleModes.value.delete(args.name);
  const nextObserved = new Set(args.actionPendingLifecycleObserved.value);
  nextObserved.delete(args.name);
  args.actionPendingLifecycleObserved.value = nextObserved;
}

export function isPendingUpdateSettled(args: {
  name: string;
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
    args.liveContainer.status !== expectedStatus;
  if (observedLifecycleSignal) {
    const nextObserved = new Set(args.actionPendingLifecycleObserved.value);
    nextObserved.add(args.name);
    args.actionPendingLifecycleObserved.value = nextObserved;
  }

  if (!args.liveContainer) {
    return false;
  }

  if (args.liveContainer.updateOperation?.status === 'in-progress') {
    return false;
  }

  if (args.liveContainer.status !== expectedStatus) {
    return false;
  }

  return (
    args.actionPendingLifecycleObserved.value.has(args.name) ||
    args.now - args.startTime >= PENDING_UPDATE_GRACE_MS
  );
}

function prunePendingActionsState(args: {
  now: number;
  containers: Readonly<Ref<Container[]>>;
  actionPending: Ref<Map<string, Container>>;
  actionPendingStartTimes: Ref<Map<string, number>>;
  actionPendingLifecycleModes: Ref<Map<string, PendingActionLifecycleMode>>;
  actionPendingLifecycleObserved: Ref<Set<string>>;
  pollTimeout: number;
  stopPendingActionsPolling: () => void;
}) {
  const liveContainersByName = new Map(
    args.containers.value.map((container) => [container.name, container] as const),
  );
  for (const [name, startTime] of args.actionPendingStartTimes.value.entries()) {
    const liveContainer = liveContainersByName.get(name);
    const pendingMode = args.actionPendingLifecycleModes.value.get(name);
    const timedOut = args.now - startTime > args.pollTimeout;
    const settled =
      pendingMode === 'update'
        ? isPendingUpdateSettled({
            name,
            now: args.now,
            startTime,
            liveContainer,
            snapshot: args.actionPending.value.get(name),
            actionPendingLifecycleObserved: args.actionPendingLifecycleObserved,
          })
        : Boolean(liveContainer);

    if (timedOut || settled) {
      clearPendingActionState({
        actionPending: args.actionPending,
        actionPendingStartTimes: args.actionPendingStartTimes,
        actionPendingLifecycleModes: args.actionPendingLifecycleModes,
        actionPendingLifecycleObserved: args.actionPendingLifecycleObserved,
        name,
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
  name: string;
  actionPendingStartTimes: Ref<Map<string, number>>;
  pendingActionsPollTimer: Ref<ReturnType<typeof setInterval> | null>;
  pollInterval: number;
  pollPendingActions: () => Promise<void>;
}) {
  if (!args.actionPendingStartTimes.value.has(args.name)) {
    args.actionPendingStartTimes.value.set(args.name, Date.now());
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
          successMessage: `Updated: ${name}`,
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
      successMessage: `Updated: ${name}`,
      staleMessage: `Already up to date: ${name}`,
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
      successMessage: `Force updated: ${name}`,
      staleMessage: `Already up to date: ${name}`,
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
  const groupUpdateInProgress = ref(new Set<string>());
  const POLL_TIMEOUT = 30000;

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

  function startPolling(name: string) {
    startPollingState({
      name,
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

  function isContainerUpdateInProgress(target: ContainerActionTarget) {
    return (
      hasTrackedContainerAction(
        actionInProgress.value,
        typeof target === 'string' ? { name: target } : target,
      ) ||
      hasPendingContainerAction(target, actionPending) ||
      hasInProgressUpdateOperation(target, input.containers)
    );
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
    return executeContainerActionState({
      containerActionsEnabled: containerActionsEnabled.value,
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containerId,
      actionKey,
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
      groupUpdateInProgress,
      group,
      executeAction,
      loadContainers: input.loadContainers,
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
    groupUpdateInProgress,
    isContainerUpdateInProgress,
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
