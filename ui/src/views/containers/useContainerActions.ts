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
import { errorMessage } from '../../utils/error';
import { useContainerBackups } from './useContainerBackups';
import { useContainerPolicy } from './useContainerPolicy';
import { useContainerPreview } from './useContainerPreview';
import { useContainerTriggers } from './useContainerTriggers';

interface ContainerActionGroup {
  key: string;
  containers: Container[];
}

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

async function executeContainerActionState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerIdMap: Record<string, string>;
  containerId?: string;
  name: string;
  actionInProgress: Ref<Set<string>>;
  inputError: Ref<string | null>;
  containers: Readonly<Ref<Container[]>>;
  action: (id: string) => Promise<unknown>;
  loadContainers: () => Promise<void>;
  reloadContainers?: boolean;
  actionPending: Ref<Map<string, Container>>;
  startPolling: (name: string) => void;
  selectedContainerName: string | undefined;
  activeDetailTab: string;
  refreshActionTabData: () => Promise<void>;
  successMessage?: string;
}): Promise<boolean> {
  if (!args.containerActionsEnabled) {
    args.inputError.value = args.containerActionsDisabledReason;
    return false;
  }
  const containerId = args.containerId ?? args.containerIdMap[args.name];
  if (!containerId || args.actionInProgress.value.has(args.name)) {
    return false;
  }
  const next = new Set(args.actionInProgress.value);
  next.add(args.name);
  args.actionInProgress.value = next;
  args.inputError.value = null;
  const shouldReloadContainers = args.reloadContainers ?? true;
  const snapshot = args.containers.value.find((container) => container.name === args.name);
  try {
    await args.action(containerId);
    if (shouldReloadContainers) {
      await args.loadContainers();
      const stillPresent = args.containers.value.find((container) => container.name === args.name);
      if (!stillPresent && snapshot) {
        args.actionPending.value.set(args.name, snapshot);
        args.startPolling(args.name);
      }
    }
    if (args.selectedContainerName === args.name && args.activeDetailTab === 'actions') {
      await args.refreshActionTabData();
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
    next.delete(args.name);
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
  containerIdMap: Record<string, string>;
  containers: Readonly<Ref<Container[]>>;
  inputError: Ref<string | null>;
  groupUpdateInProgress: Ref<Set<string>>;
  group: ContainerActionGroup;
  executeAction: (
    name: string,
    action: (id: string) => Promise<unknown>,
    options?: { containerId?: string; reloadContainers?: boolean; successMessage?: string },
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
  const frozenUpdateTargets = updatableContainers
    .map((container) => ({
      name: container.name,
      containerId: args.containerIdMap[container.name],
    }))
    .filter(
      (
        target,
      ): target is {
        name: string;
        containerId: string;
      } => typeof target.containerId === 'string' && target.containerId.length > 0,
    );
  if (frozenUpdateTargets.length === 0) {
    return;
  }
  setGroupUpdateStateValue(args.groupUpdateInProgress, args.group.key, true);
  try {
    let updatedAny = false;
    for (const target of frozenUpdateTargets) {
      const currentContainer = args.containers.value.find(
        (container) => container.id === target.containerId,
      );
      if (!currentContainer || currentContainer.name !== target.name) {
        continue;
      }

      const updated = await args.executeAction(target.name, apiUpdateContainer, {
        containerId: target.containerId,
        reloadContainers: false,
      });
      if (updated) {
        updatedAny = true;
      }
    }
    await args.loadContainers();
    if (updatedAny) {
      const toast = useToast();
      const count = frozenUpdateTargets.length;
      toast.success(`Updated ${count} container${count === 1 ? '' : 's'} in ${args.group.key}`);
    }
  } finally {
    setGroupUpdateStateValue(args.groupUpdateInProgress, args.group.key, false);
  }
}

async function deleteContainerState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerIdMap: Record<string, string>;
  name: string;
  actionInProgress: Ref<Set<string>>;
  inputError: Ref<string | null>;
  skippedUpdates: Ref<Set<string>>;
  selectedContainerName: string | undefined;
  closeFullPage: () => void;
  closePanel: () => void;
  loadContainers: () => Promise<void>;
}): Promise<boolean> {
  if (!args.containerActionsEnabled) {
    args.inputError.value = args.containerActionsDisabledReason;
    return false;
  }
  const containerId = args.containerIdMap[args.name];
  if (!containerId || args.actionInProgress.value.has(args.name)) {
    return false;
  }
  const next = new Set(args.actionInProgress.value);
  next.add(args.name);
  args.actionInProgress.value = next;
  try {
    await apiDeleteContainer(containerId);
    args.skippedUpdates.value.delete(args.name);
    if (args.selectedContainerName === args.name) {
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
    next.delete(args.name);
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
  name: string;
}) {
  args.actionPending.value.delete(args.name);
  args.actionPendingStartTimes.value.delete(args.name);
}

function prunePendingActionsState(args: {
  now: number;
  containers: Readonly<Ref<Container[]>>;
  actionPending: Ref<Map<string, Container>>;
  actionPendingStartTimes: Ref<Map<string, number>>;
  pollTimeout: number;
  stopPendingActionsPolling: () => void;
}) {
  const liveContainerNames = new Set(args.containers.value.map((container) => container.name));
  for (const [name, startTime] of args.actionPendingStartTimes.value.entries()) {
    if (liveContainerNames.has(name) || args.now - startTime > args.pollTimeout) {
      clearPendingActionState({
        actionPending: args.actionPending,
        actionPendingStartTimes: args.actionPendingStartTimes,
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
    name: string,
    action: (id: string) => Promise<unknown>,
    options?: { containerId?: string; reloadContainers?: boolean; successMessage?: string },
  ) => Promise<boolean>;
  forceUpdate: (name: string) => Promise<void>;
  deleteContainer: (name: string) => Promise<boolean>;
  clearPolicySelected: () => Promise<void>;
  selectedContainer: Readonly<Ref<Container | null | undefined>>;
  rollbackToBackup: (backupId?: string) => Promise<void>;
}) {
  function confirmStop(name: string) {
    args.confirm.require({
      header: 'Stop Container',
      message: `Stop ${name}?`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Stop',
      severity: 'danger',
      accept: () =>
        args.executeAction(name, apiStopContainer, {
          successMessage: `Stopped: ${name}`,
        }) as unknown as Promise<void>,
    });
  }

  function confirmRestart(name: string) {
    args.confirm.require({
      header: 'Restart Container',
      message: `Restart ${name}?`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Restart',
      severity: 'warn',
      accept: () =>
        args.executeAction(name, apiRestartContainer, {
          successMessage: `Restarted: ${name}`,
        }) as unknown as Promise<void>,
    });
  }

  function confirmForceUpdate(name: string) {
    args.confirm.require({
      header: 'Force Update',
      message: `Force update ${name}? This clears skip/snooze policy before attempting update.`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Force Update',
      severity: 'warn',
      accept: () => args.forceUpdate(name),
    });
  }

  function confirmUpdate(name: string) {
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
        args.executeAction(name, apiUpdateContainer, {
          successMessage: `Updated: ${name}`,
        }) as unknown as Promise<void>,
    });
  }

  function confirmDelete(name: string) {
    args.confirm.require({
      header: 'Delete Container',
      message: `Delete ${name}? This will remove it from Drydock tracking until rediscovered.`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Delete',
      severity: 'danger',
      accept: () => args.deleteContainer(name) as unknown as Promise<void>,
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
    name: string,
    action: (id: string) => Promise<unknown>,
    options?: { containerId?: string; reloadContainers?: boolean; successMessage?: string },
  ) => Promise<boolean>;
  applyPolicy: (
    name: string,
    action: string,
    payload: Record<string, unknown>,
    message: string,
  ) => Promise<boolean>;
  skippedUpdates: Ref<Set<string>>;
  selectedContainer: Readonly<Ref<Container | null | undefined>>;
  activeDetailTab: Readonly<Ref<string>>;
  refreshActionTabData: () => Promise<void>;
}) {
  async function startContainer(name: string) {
    await args.executeAction(name, apiStartContainer, { successMessage: `Started: ${name}` });
  }

  async function updateContainer(name: string) {
    await args.executeAction(name, apiUpdateContainer, { successMessage: `Updated: ${name}` });
  }

  async function scanContainer(name: string) {
    await args.executeAction(name, apiScanContainer, {
      successMessage: `Scan triggered: ${name}`,
    });
  }

  async function skipUpdate(name: string) {
    const applied = await args.applyPolicy(
      name,
      'skip-current',
      {},
      `Skipped current update for ${name}`,
    );
    if (applied) {
      args.skippedUpdates.value.add(name);
      if (args.selectedContainer.value?.name === name && args.activeDetailTab.value === 'actions') {
        await args.refreshActionTabData();
      }
    }
  }

  async function forceUpdate(name: string) {
    await args.applyPolicy(name, 'clear', {}, `Cleared update policy for ${name}`);
    await args.executeAction(name, apiUpdateContainer, {
      successMessage: `Force updated: ${name}`,
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
  const selectedContainerName = computed(() => input.selectedContainer.value?.name);

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
    selectedContainerName,
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
    () => [input.selectedContainer.value?.name, input.activeDetailTab.value],
    ([containerName, tabName]) => {
      preview.resetPreview();

      if (!containerName) {
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

  async function executeAction(
    name: string,
    action: (id: string) => Promise<unknown>,
    options?: { containerId?: string; reloadContainers?: boolean; successMessage?: string },
  ) {
    return executeContainerActionState({
      containerActionsEnabled: containerActionsEnabled.value,
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containerIdMap: input.containerIdMap.value,
      containerId: options?.containerId,
      name,
      actionInProgress,
      inputError: input.error,
      containers: input.containers,
      action,
      loadContainers: input.loadContainers,
      reloadContainers: options?.reloadContainers,
      actionPending,
      startPolling,
      selectedContainerName: input.selectedContainer.value?.name,
      activeDetailTab: input.activeDetailTab.value,
      refreshActionTabData,
      successMessage: options?.successMessage,
    });
  }

  async function updateAllInGroup(group: ContainerActionGroup) {
    await updateAllInGroupState({
      containerActionsEnabled: containerActionsEnabled.value,
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containerIdMap: input.containerIdMap.value,
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

  async function deleteContainer(name: string) {
    return deleteContainerState({
      containerActionsEnabled: containerActionsEnabled.value,
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containerIdMap: input.containerIdMap.value,
      name,
      actionInProgress,
      inputError: input.error,
      skippedUpdates,
      selectedContainerName: input.selectedContainer.value?.name,
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
