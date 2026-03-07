import { computed, onUnmounted, type Ref, ref, watch } from 'vue';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import { getBackups, rollback } from '../../services/backup';
import {
  deleteContainer as apiDeleteContainer,
  scanContainer as apiScanContainer,
  getContainerUpdateOperations as fetchContainerUpdateOperations,
  getContainerTriggers,
  runTrigger as runContainerTrigger,
  updateContainerPolicy,
} from '../../services/container';
import {
  restartContainer as apiRestartContainer,
  startContainer as apiStartContainer,
  stopContainer as apiStopContainer,
  updateContainer as apiUpdateContainer,
} from '../../services/container-actions';
import { previewContainer } from '../../services/preview';
import type { ApiContainerTrigger } from '../../types/api';
import type { Container } from '../../types/container';
import { errorMessage } from '../../utils/error';

interface ContainerActionGroup {
  key: string;
  containers: Container[];
}

interface ContainerListPolicyState {
  snoozed: boolean;
  skipped: boolean;
  skipCount: number;
  snoozeUntil?: string;
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

const EMPTY_CONTAINER_POLICY_STATE: ContainerListPolicyState = {
  snoozed: false,
  skipped: false,
  skipCount: 0,
};

export function useContainerActions(input: UseContainerActionsInput) {
  const confirm = useConfirmDialog();

  const skippedUpdates = ref(new Set<string>());

  const detailPreview = ref<Record<string, unknown> | null>(null);
  const previewLoading = ref(false);
  const previewError = ref<string | null>(null);

  const detailTriggers = ref<Record<string, unknown>[]>([]);
  const triggersLoading = ref(false);
  const triggerRunInProgress = ref<string | null>(null);
  const triggerMessage = ref<string | null>(null);
  const triggerError = ref<string | null>(null);

  const detailBackups = ref<Record<string, unknown>[]>([]);
  const backupsLoading = ref(false);
  const rollbackInProgress = ref<string | null>(null);
  const rollbackMessage = ref<string | null>(null);
  const rollbackError = ref<string | null>(null);
  const detailUpdateOperations = ref<Record<string, unknown>[]>([]);
  const updateOperationsLoading = ref(false);
  const updateOperationsError = ref<string | null>(null);

  const policyInProgress = ref<string | null>(null);
  const policyMessage = ref<string | null>(null);
  const policyError = ref<string | null>(null);

  const selectedUpdatePolicy = computed<Record<string, unknown>>(() => {
    const selectedName = input.selectedContainer.value?.name;
    if (!selectedName) {
      return {};
    }
    const meta = input.containerMetaMap.value[selectedName];
    if (!meta || typeof meta !== 'object') {
      return {};
    }
    const updatePolicy = (meta as Record<string, unknown>).updatePolicy;
    return updatePolicy && typeof updatePolicy === 'object'
      ? (updatePolicy as Record<string, unknown>)
      : {};
  });

  const selectedSkipTags = computed<string[]>(() =>
    Array.isArray(selectedUpdatePolicy.value.skipTags) ? selectedUpdatePolicy.value.skipTags : [],
  );
  const selectedSkipDigests = computed<string[]>(() =>
    Array.isArray(selectedUpdatePolicy.value.skipDigests)
      ? selectedUpdatePolicy.value.skipDigests
      : [],
  );
  const selectedSnoozeUntil = computed<string | undefined>(
    () => selectedUpdatePolicy.value.snoozeUntil as string | undefined,
  );
  const snoozeDateInput = ref('');

  function formatTimestamp(timestamp: string | undefined): string {
    if (!timestamp) {
      return 'Unknown';
    }
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return timestamp;
    }
    return parsed.toLocaleString();
  }

  function formatOperationValue(value: unknown): string {
    if (typeof value !== 'string') {
      return 'unknown';
    }
    return value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  }

  function formatOperationPhase(phase: unknown): string {
    return formatOperationValue(phase);
  }

  function formatRollbackReason(reason: unknown): string {
    return formatOperationValue(reason);
  }

  function formatOperationStatus(status: unknown): string {
    return formatOperationValue(status);
  }

  function getOperationStatusStyle(status: unknown) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'succeeded') {
      return {
        backgroundColor: 'var(--dd-success-muted)',
        color: 'var(--dd-success)',
      };
    }
    if (normalized === 'rolled-back') {
      return {
        backgroundColor: 'var(--dd-warning-muted)',
        color: 'var(--dd-warning)',
      };
    }
    if (normalized === 'failed') {
      return {
        backgroundColor: 'var(--dd-danger-muted)',
        color: 'var(--dd-danger)',
      };
    }
    return {
      backgroundColor: 'var(--dd-info-muted)',
      color: 'var(--dd-info)',
    };
  }

  function toDateInputValue(timestamp: string | undefined): string {
    if (!timestamp) {
      return '';
    }
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function resetDetailMessages() {
    triggerMessage.value = null;
    triggerError.value = null;
    rollbackMessage.value = null;
    rollbackError.value = null;
    policyMessage.value = null;
    policyError.value = null;
    updateOperationsError.value = null;
  }

  function getTriggerKey(trigger: ApiContainerTrigger): string {
    if (trigger.id) {
      return trigger.id;
    }
    const prefix = trigger.agent ? `${trigger.agent}.` : '';
    return `${prefix}${trigger.type}.${trigger.name}`;
  }

  async function loadDetailTriggers() {
    const containerId = input.selectedContainerId.value;
    if (!containerId) {
      detailTriggers.value = [];
      return;
    }
    triggersLoading.value = true;
    triggerError.value = null;
    try {
      detailTriggers.value = await getContainerTriggers(containerId);
    } catch (e: unknown) {
      detailTriggers.value = [];
      triggerError.value = errorMessage(e, 'Failed to load associated triggers');
    } finally {
      triggersLoading.value = false;
    }
  }

  async function loadDetailBackups() {
    const containerId = input.selectedContainerId.value;
    if (!containerId) {
      detailBackups.value = [];
      return;
    }
    backupsLoading.value = true;
    rollbackError.value = null;
    try {
      detailBackups.value = await getBackups(containerId);
    } catch (e: unknown) {
      detailBackups.value = [];
      rollbackError.value = errorMessage(e, 'Failed to load backups');
    } finally {
      backupsLoading.value = false;
    }
  }

  async function loadDetailUpdateOperations() {
    const containerId = input.selectedContainerId.value;
    if (!containerId) {
      detailUpdateOperations.value = [];
      updateOperationsError.value = null;
      return;
    }

    updateOperationsLoading.value = true;
    updateOperationsError.value = null;
    try {
      detailUpdateOperations.value = await fetchContainerUpdateOperations(containerId);
    } catch (e: unknown) {
      detailUpdateOperations.value = [];
      updateOperationsError.value = errorMessage(e, 'Failed to load update operation history');
    } finally {
      updateOperationsLoading.value = false;
    }
  }

  async function refreshActionTabData() {
    await Promise.all([loadDetailTriggers(), loadDetailBackups(), loadDetailUpdateOperations()]);
  }

  async function runContainerPreview() {
    const containerId = input.selectedContainerId.value;
    if (!containerId || previewLoading.value) {
      return;
    }
    previewLoading.value = true;
    previewError.value = null;
    try {
      detailPreview.value = await previewContainer(containerId);
    } catch (e: unknown) {
      detailPreview.value = null;
      previewError.value = errorMessage(e, 'Failed to generate update preview');
    } finally {
      previewLoading.value = false;
    }
  }

  async function runAssociatedTrigger(trigger: ApiContainerTrigger) {
    const containerId = input.selectedContainerId.value;
    if (!containerId || triggerRunInProgress.value) {
      return;
    }
    const triggerKey = getTriggerKey(trigger);
    triggerRunInProgress.value = triggerKey;
    triggerMessage.value = null;
    triggerError.value = null;
    try {
      await runContainerTrigger({
        containerId,
        triggerType: trigger.type,
        triggerName: trigger.name,
        triggerAgent: trigger.agent,
      });
      triggerMessage.value = `Trigger ${triggerKey} ran successfully`;
      await input.loadContainers();
      await refreshActionTabData();
    } catch (e: unknown) {
      triggerError.value = errorMessage(e, `Failed to run ${triggerKey}`);
    } finally {
      triggerRunInProgress.value = null;
    }
  }

  async function rollbackToBackup(backupId?: string) {
    const containerId = input.selectedContainerId.value;
    if (!containerId || rollbackInProgress.value) {
      return;
    }
    rollbackInProgress.value = backupId || 'latest';
    rollbackMessage.value = null;
    rollbackError.value = null;
    try {
      await rollback(containerId, backupId);
      rollbackMessage.value = backupId
        ? 'Rollback completed from selected backup'
        : 'Rollback completed from latest backup';
      skippedUpdates.value.delete(input.selectedContainer.value?.name || '');
      await input.loadContainers();
      await Promise.all([loadDetailBackups(), loadDetailUpdateOperations()]);
    } catch (e: unknown) {
      rollbackError.value = errorMessage(e, 'Rollback failed');
    } finally {
      rollbackInProgress.value = null;
    }
  }

  async function applyPolicy(
    name: string,
    action: string,
    payload: Record<string, unknown> = {},
    message: string,
  ) {
    const containerId = input.containerIdMap.value[name];
    if (!containerId || policyInProgress.value) {
      return false;
    }
    policyInProgress.value = `${action}:${name}`;
    policyError.value = null;
    try {
      await updateContainerPolicy(containerId, action, payload);
      policyMessage.value = message;
      await input.loadContainers();
      return true;
    } catch (e: unknown) {
      policyError.value = errorMessage(e, 'Failed to update policy');
      return false;
    } finally {
      policyInProgress.value = null;
    }
  }

  async function skipCurrentForSelected() {
    const containerName = input.selectedContainer.value?.name;
    if (!containerName) {
      return;
    }
    const applied = await applyPolicy(
      containerName,
      'skip-current',
      {},
      `Skipped current update for ${containerName}`,
    );
    if (applied) {
      skippedUpdates.value.add(containerName);
      await refreshActionTabData();
    }
  }

  async function snoozeSelected(days: number) {
    const containerName = input.selectedContainer.value?.name;
    if (!containerName) {
      return;
    }
    await applyPolicy(
      containerName,
      'snooze',
      { days },
      `Snoozed updates for ${days} day${days === 1 ? '' : 's'}`,
    );
  }

  function resolveSnoozeUntilFromInput(dateInput: string): string | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      return undefined;
    }
    const parsed = new Date(`${dateInput}T23:59:59`);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed.toISOString();
  }

  async function snoozeSelectedUntilDate() {
    const containerName = input.selectedContainer.value?.name;
    if (!containerName) {
      return;
    }
    const snoozeUntil = resolveSnoozeUntilFromInput(snoozeDateInput.value);
    if (!snoozeUntil) {
      policyError.value = 'Select a valid snooze date';
      return;
    }
    await applyPolicy(
      containerName,
      'snooze',
      { snoozeUntil },
      `Snoozed until ${snoozeDateInput.value}`,
    );
  }

  async function unsnoozeSelected() {
    const containerName = input.selectedContainer.value?.name;
    if (!containerName) {
      return;
    }
    await applyPolicy(containerName, 'unsnooze', {}, 'Snooze cleared');
  }

  async function clearSkipsSelected() {
    const containerName = input.selectedContainer.value?.name;
    if (!containerName) {
      return;
    }
    skippedUpdates.value.delete(containerName);
    await applyPolicy(containerName, 'clear-skips', {}, 'Skipped updates cleared');
  }

  async function clearPolicySelected() {
    const containerName = input.selectedContainer.value?.name;
    if (!containerName) {
      return;
    }
    skippedUpdates.value.delete(containerName);
    await applyPolicy(containerName, 'clear', {}, 'Update policy cleared');
  }

  async function removeSkipSelected(kind: 'tag' | 'digest', value: string) {
    const containerName = input.selectedContainer.value?.name;
    if (!containerName || !value) {
      return;
    }
    skippedUpdates.value.delete(containerName);
    await applyPolicy(
      containerName,
      'remove-skip',
      { kind, value },
      `Removed skipped ${kind} ${value}`,
    );
  }

  async function removeSkipTagSelected(value: string) {
    await removeSkipSelected('tag', value);
  }

  async function removeSkipDigestSelected(value: string) {
    await removeSkipSelected('digest', value);
  }

  watch(
    () => [input.selectedContainer.value?.name, input.activeDetailTab.value],
    ([containerName, tabName]) => {
      detailPreview.value = null;
      previewError.value = null;
      if (!containerName) {
        detailTriggers.value = [];
        detailBackups.value = [];
        detailUpdateOperations.value = [];
        updateOperationsError.value = null;
        resetDetailMessages();
        return;
      }
      if (tabName === 'actions') {
        resetDetailMessages();
        void refreshActionTabData();
      }
    },
    { immediate: true },
  );

  watch(
    () => selectedSnoozeUntil.value,
    (snoozeUntil) => {
      snoozeDateInput.value = toDateInputValue(snoozeUntil);
    },
    { immediate: true },
  );

  const actionInProgress = ref<string | null>(null);
  const actionPending = ref<Map<string, Container>>(new Map());
  const actionPendingStartTimes = ref<Map<string, number>>(new Map());
  const pendingActionsPollTimer = ref<ReturnType<typeof setInterval> | null>(null);
  const pendingActionsPollInFlight = ref(false);
  const groupUpdateInProgress = ref(new Set<string>());
  const POLL_INTERVAL = 2000;
  const POLL_TIMEOUT = 30000;

  function stopPendingActionsPolling() {
    if (!pendingActionsPollTimer.value) {
      return;
    }
    clearInterval(pendingActionsPollTimer.value);
    pendingActionsPollTimer.value = null;
  }

  function clearPendingAction(name: string) {
    actionPending.value.delete(name);
    actionPendingStartTimes.value.delete(name);
  }

  function prunePendingActions(now: number) {
    const liveContainerNames = new Set(input.containers.value.map((container) => container.name));
    for (const [name, startTime] of actionPendingStartTimes.value.entries()) {
      if (liveContainerNames.has(name) || now - startTime > POLL_TIMEOUT) {
        clearPendingAction(name);
      }
    }
    if (actionPending.value.size === 0) {
      stopPendingActionsPolling();
    }
  }

  async function pollPendingActions() {
    if (pendingActionsPollInFlight.value) {
      return;
    }
    pendingActionsPollInFlight.value = true;
    try {
      await input.loadContainers();
    } finally {
      prunePendingActions(Date.now());
      pendingActionsPollInFlight.value = false;
    }
  }

  function startPolling(name: string) {
    if (!actionPendingStartTimes.value.has(name)) {
      actionPendingStartTimes.value.set(name, Date.now());
    }
    if (pendingActionsPollTimer.value) {
      return;
    }
    pendingActionsPollTimer.value = setInterval(() => {
      void pollPendingActions();
    }, POLL_INTERVAL);
  }

  onUnmounted(() => {
    stopPendingActionsPolling();
  });

  async function executeAction(name: string, action: (id: string) => Promise<unknown>) {
    const containerId = input.containerIdMap.value[name];
    if (!containerId || actionInProgress.value) {
      return false;
    }
    actionInProgress.value = name;
    input.error.value = null;
    const snapshot = input.containers.value.find((container) => container.name === name);
    try {
      await action(containerId);
      await input.loadContainers();
      const stillPresent = input.containers.value.find((container) => container.name === name);
      if (!stillPresent && snapshot) {
        actionPending.value.set(name, snapshot);
        startPolling(name);
      }
      if (
        input.selectedContainer.value?.name === name &&
        input.activeDetailTab.value === 'actions'
      ) {
        await refreshActionTabData();
      }
      return true;
    } catch (e: unknown) {
      input.error.value = errorMessage(e, `Action failed for ${name}`);
      return false;
    } finally {
      actionInProgress.value = null;
    }
  }

  function setGroupUpdateState(groupKey: string, updating: boolean) {
    const next = new Set(groupUpdateInProgress.value);
    if (updating) {
      next.add(groupKey);
    } else {
      next.delete(groupKey);
    }
    groupUpdateInProgress.value = next;
  }

  async function updateAllInGroup(group: ContainerActionGroup) {
    if (groupUpdateInProgress.value.has(group.key)) {
      return;
    }
    const updatableContainers = group.containers.filter((container) => {
      return container.newTag && container.bouncer !== 'blocked';
    });
    if (updatableContainers.length === 0) {
      return;
    }
    setGroupUpdateState(group.key, true);
    try {
      for (const container of updatableContainers) {
        await executeAction(container.name, apiUpdateContainer);
      }
    } finally {
      setGroupUpdateState(group.key, false);
    }
  }

  async function startContainer(name: string) {
    await executeAction(name, apiStartContainer);
  }

  async function updateContainer(name: string) {
    await executeAction(name, apiUpdateContainer);
  }

  async function scanContainer(name: string) {
    await executeAction(name, apiScanContainer);
  }

  async function skipUpdate(name: string) {
    const applied = await applyPolicy(
      name,
      'skip-current',
      {},
      `Skipped current update for ${name}`,
    );
    if (applied) {
      skippedUpdates.value.add(name);
      if (
        input.selectedContainer.value?.name === name &&
        input.activeDetailTab.value === 'actions'
      ) {
        await refreshActionTabData();
      }
    }
  }

  async function forceUpdate(name: string) {
    await applyPolicy(name, 'clear', {}, `Cleared update policy for ${name}`);
    await executeAction(name, apiUpdateContainer);
  }

  async function deleteContainer(name: string) {
    const containerId = input.containerIdMap.value[name];
    if (!containerId || actionInProgress.value) {
      return false;
    }
    actionInProgress.value = name;
    try {
      await apiDeleteContainer(containerId);
      skippedUpdates.value.delete(name);
      if (input.selectedContainer.value?.name === name) {
        input.closeFullPage();
        input.closePanel();
      }
      await input.loadContainers();
      return true;
    } catch (e: unknown) {
      input.error.value = errorMessage(e, `Failed to delete ${name}`);
      return false;
    } finally {
      actionInProgress.value = null;
    }
  }

  function normalizePolicyEntries(values: unknown): string[] {
    if (!Array.isArray(values)) {
      return [];
    }
    return values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  function getContainerListPolicyState(containerName: string): ContainerListPolicyState {
    const meta = input.containerMetaMap.value[containerName];
    const updatePolicy =
      meta && typeof meta === 'object' ? (meta as Record<string, unknown>).updatePolicy : undefined;
    if (!updatePolicy || typeof updatePolicy !== 'object') {
      return EMPTY_CONTAINER_POLICY_STATE;
    }

    const policy = updatePolicy as Record<string, unknown>;
    const skipCount =
      normalizePolicyEntries(policy.skipTags).length +
      normalizePolicyEntries(policy.skipDigests).length;

    const rawSnoozeUntil = typeof policy.snoozeUntil === 'string' ? policy.snoozeUntil : undefined;
    const snoozeUntilMs = rawSnoozeUntil ? new Date(rawSnoozeUntil).getTime() : Number.NaN;
    const snoozed = Number.isFinite(snoozeUntilMs) && snoozeUntilMs > Date.now();

    if (!snoozed && skipCount === 0) {
      return EMPTY_CONTAINER_POLICY_STATE;
    }

    return {
      snoozed,
      skipped: skipCount > 0,
      skipCount,
      snoozeUntil: snoozed ? rawSnoozeUntil : undefined,
    };
  }

  function containerPolicyTooltip(containerName: string, kind: 'snoozed' | 'skipped'): string {
    const state = getContainerListPolicyState(containerName);
    if (kind === 'snoozed') {
      return state.snoozeUntil
        ? `Updates snoozed until ${formatTimestamp(state.snoozeUntil)}`
        : 'Updates snoozed';
    }
    if (state.skipCount <= 0) {
      return 'Skipped updates policy active';
    }
    return `Skipped updates policy active (${state.skipCount} entr${state.skipCount === 1 ? 'y' : 'ies'})`;
  }

  function confirmStop(name: string) {
    confirm.require({
      header: 'Stop Container',
      message: `Stop ${name}?`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Stop',
      severity: 'danger',
      accept: () => executeAction(name, apiStopContainer),
    });
  }

  function confirmRestart(name: string) {
    confirm.require({
      header: 'Restart Container',
      message: `Restart ${name}?`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Restart',
      severity: 'warn',
      accept: () => executeAction(name, apiRestartContainer),
    });
  }

  function confirmForceUpdate(name: string) {
    confirm.require({
      header: 'Force Update',
      message: `Force update ${name}? This clears skip/snooze policy before attempting update.`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Force Update',
      severity: 'warn',
      accept: () => forceUpdate(name),
    });
  }

  function confirmDelete(name: string) {
    confirm.require({
      header: 'Delete Container',
      message: `Delete ${name}? This will remove it from Drydock tracking until rediscovered.`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Delete',
      severity: 'danger',
      accept: () => deleteContainer(name),
    });
  }

  return {
    actionInProgress,
    actionPending,
    backupsLoading,
    clearPolicySelected,
    clearSkipsSelected,
    confirmDelete,
    confirmForceUpdate,
    confirmRestart,
    confirmStop,
    containerPolicyTooltip,
    detailBackups,
    detailPreview,
    detailTriggers,
    detailUpdateOperations,
    executeAction,
    formatOperationPhase,
    formatOperationStatus,
    formatRollbackReason,
    formatTimestamp,
    getContainerListPolicyState,
    getOperationStatusStyle,
    getTriggerKey,
    groupUpdateInProgress,
    policyError,
    policyInProgress,
    policyMessage,
    previewError,
    previewLoading,
    removeSkipDigestSelected,
    removeSkipTagSelected,
    rollbackError,
    rollbackInProgress,
    rollbackMessage,
    rollbackToBackup,
    runAssociatedTrigger,
    runContainerPreview,
    scanContainer,
    selectedSkipDigests,
    selectedSkipTags,
    selectedSnoozeUntil,
    selectedUpdatePolicy,
    skipCurrentForSelected,
    skipUpdate,
    skippedUpdates,
    snoozeDateInput,
    snoozeSelected,
    snoozeSelectedUntilDate,
    startContainer,
    triggerError,
    triggerMessage,
    triggerRunInProgress,
    triggersLoading,
    unsnoozeSelected,
    updateAllInGroup,
    updateContainer,
    updateOperationsError,
    updateOperationsLoading,
  };
}
