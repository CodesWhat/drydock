import { computed, onUnmounted, type Ref, ref, watch } from 'vue';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import { useServerFeatures } from '../../composables/useServerFeatures';
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
import type { ContainerComposePreview, ContainerPreviewPayload } from '../../services/preview';
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
const ACTION_TAB_DETAIL_REFRESH_DEBOUNCE_MS = 250;

function buildDetailComposePreview(
  preview: ContainerPreviewPayload | null,
): ContainerComposePreview | null {
  const compose = preview?.compose;
  if (!compose || typeof compose !== 'object') {
    return null;
  }

  const files = Array.isArray(compose.files)
    ? compose.files
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];
  const service =
    typeof compose.service === 'string' && compose.service.trim().length > 0
      ? compose.service.trim()
      : undefined;
  const writableFile =
    typeof compose.writableFile === 'string' && compose.writableFile.trim().length > 0
      ? compose.writableFile.trim()
      : undefined;
  const patch =
    typeof compose.patch === 'string' && compose.patch.trim().length > 0
      ? compose.patch
      : undefined;
  const willWrite = typeof compose.willWrite === 'boolean' ? compose.willWrite : undefined;

  const hasComposePreviewContent = [
    files.length > 0,
    service !== undefined,
    writableFile !== undefined,
    patch !== undefined,
    willWrite !== undefined,
  ].some(Boolean);

  if (!hasComposePreviewContent) {
    return null;
  }

  return {
    files,
    ...(service ? { service } : {}),
    ...(writableFile ? { writableFile } : {}),
    ...(willWrite !== undefined ? { willWrite } : {}),
    ...(patch ? { patch } : {}),
  };
}

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

function getTriggerKey(trigger: ApiContainerTrigger): string {
  if (trigger.id) {
    return trigger.id;
  }
  const prefix = trigger.agent ? `${trigger.agent}.` : '';
  return `${prefix}${trigger.type}.${trigger.name}`;
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

function normalizePolicyEntries(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function deriveContainerListPolicyState(
  containerMetaMap: Record<string, unknown>,
  containerName: string,
): ContainerListPolicyState {
  const meta = containerMetaMap[containerName];
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

function buildContainerPolicyTooltip(
  state: ContainerListPolicyState,
  kind: 'snoozed' | 'skipped',
): string {
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

function resetDetailMessagesState(state: {
  triggerMessage: Ref<string | null>;
  triggerError: Ref<string | null>;
  rollbackMessage: Ref<string | null>;
  rollbackError: Ref<string | null>;
  policyMessage: Ref<string | null>;
  policyError: Ref<string | null>;
  updateOperationsError: Ref<string | null>;
}) {
  state.triggerMessage.value = null;
  state.triggerError.value = null;
  state.rollbackMessage.value = null;
  state.rollbackError.value = null;
  state.policyMessage.value = null;
  state.policyError.value = null;
  state.updateOperationsError.value = null;
}

function handleSelectedContainerOrTabChange(args: {
  containerName: string | undefined;
  tabName: string;
  detailPreview: Ref<ContainerPreviewPayload | null>;
  previewError: Ref<string | null>;
  detailTriggers: Ref<Record<string, unknown>[]>;
  detailBackups: Ref<Record<string, unknown>[]>;
  detailUpdateOperations: Ref<Record<string, unknown>[]>;
  updateOperationsError: Ref<string | null>;
  clearActionTabDetailRefreshTimer: () => void;
  resetDetailMessages: () => void;
  scheduleActionTabDataRefresh: () => void;
}) {
  args.detailPreview.value = null;
  args.previewError.value = null;
  if (!args.containerName) {
    args.clearActionTabDetailRefreshTimer();
    args.detailTriggers.value = [];
    args.detailBackups.value = [];
    args.detailUpdateOperations.value = [];
    args.updateOperationsError.value = null;
    args.resetDetailMessages();
    return;
  }
  if (args.tabName === 'actions') {
    args.resetDetailMessages();
    args.scheduleActionTabDataRefresh();
    return;
  }
  args.clearActionTabDetailRefreshTimer();
}

async function loadDetailUpdateOperationsState(args: {
  containerId: string | undefined;
  detailUpdateOperations: Ref<Record<string, unknown>[]>;
  updateOperationsLoading: Ref<boolean>;
  updateOperationsError: Ref<string | null>;
}) {
  if (!args.containerId) {
    args.detailUpdateOperations.value = [];
    args.updateOperationsError.value = null;
    return;
  }

  args.updateOperationsLoading.value = true;
  args.updateOperationsError.value = null;
  try {
    args.detailUpdateOperations.value = await fetchContainerUpdateOperations(args.containerId);
  } catch (e: unknown) {
    args.detailUpdateOperations.value = [];
    args.updateOperationsError.value = errorMessage(e, 'Failed to load update operation history');
  } finally {
    args.updateOperationsLoading.value = false;
  }
}

async function loadContainerDetailListState(args: {
  containerId: string | undefined;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  value: Ref<Record<string, unknown>[]>;
  loader: (containerId: string) => Promise<Record<string, unknown>[]>;
  failureMessage: string;
}) {
  if (!args.containerId) {
    args.value.value = [];
    return;
  }

  args.loading.value = true;
  args.error.value = null;
  try {
    args.value.value = await args.loader(args.containerId);
  } catch (e: unknown) {
    args.value.value = [];
    args.error.value = errorMessage(e, args.failureMessage);
  } finally {
    args.loading.value = false;
  }
}

async function runContainerPreviewState(args: {
  containerId: string | undefined;
  previewLoading: Ref<boolean>;
  previewError: Ref<string | null>;
  detailPreview: Ref<ContainerPreviewPayload | null>;
}) {
  if (!args.containerId || args.previewLoading.value) {
    return;
  }
  args.previewLoading.value = true;
  args.previewError.value = null;
  try {
    args.detailPreview.value = await previewContainer(args.containerId);
  } catch (e: unknown) {
    args.detailPreview.value = null;
    args.previewError.value = errorMessage(e, 'Failed to generate update preview');
  } finally {
    args.previewLoading.value = false;
  }
}

async function runAssociatedTriggerState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerId: string | undefined;
  trigger: ApiContainerTrigger;
  triggerRunInProgress: Ref<string | null>;
  triggerMessage: Ref<string | null>;
  triggerError: Ref<string | null>;
  loadContainers: () => Promise<void>;
  refreshActionTabData: () => Promise<void>;
}) {
  if (!args.containerActionsEnabled) {
    args.triggerMessage.value = null;
    args.triggerError.value = args.containerActionsDisabledReason;
    return;
  }
  if (!args.containerId || args.triggerRunInProgress.value) {
    return;
  }
  const triggerKey = getTriggerKey(args.trigger);
  args.triggerRunInProgress.value = triggerKey;
  args.triggerMessage.value = null;
  args.triggerError.value = null;
  try {
    await runContainerTrigger({
      containerId: args.containerId,
      triggerType: args.trigger.type,
      triggerName: args.trigger.name,
      triggerAgent: args.trigger.agent,
    });
    args.triggerMessage.value = `Trigger ${triggerKey} ran successfully`;
    await args.loadContainers();
    await args.refreshActionTabData();
  } catch (e: unknown) {
    args.triggerError.value = errorMessage(e, `Failed to run ${triggerKey}`);
  } finally {
    args.triggerRunInProgress.value = null;
  }
}

async function rollbackToBackupState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerId: string | undefined;
  backupId?: string;
  rollbackInProgress: Ref<string | null>;
  rollbackMessage: Ref<string | null>;
  rollbackError: Ref<string | null>;
  skippedUpdates: Ref<Set<string>>;
  selectedContainerName: string | undefined;
  loadContainers: () => Promise<void>;
  loadDetailBackups: () => Promise<void>;
  loadDetailUpdateOperations: () => Promise<void>;
}) {
  if (!args.containerActionsEnabled) {
    args.rollbackMessage.value = null;
    args.rollbackError.value = args.containerActionsDisabledReason;
    return;
  }
  if (!args.containerId || args.rollbackInProgress.value) {
    return;
  }
  args.rollbackInProgress.value = args.backupId || 'latest';
  args.rollbackMessage.value = null;
  args.rollbackError.value = null;
  try {
    await rollback(args.containerId, args.backupId);
    args.rollbackMessage.value = args.backupId
      ? 'Rollback completed from selected backup'
      : 'Rollback completed from latest backup';
    args.skippedUpdates.value.delete(args.selectedContainerName || '');
    await args.loadContainers();
    await Promise.all([args.loadDetailBackups(), args.loadDetailUpdateOperations()]);
  } catch (e: unknown) {
    args.rollbackError.value = errorMessage(e, 'Rollback failed');
  } finally {
    args.rollbackInProgress.value = null;
  }
}

async function applyPolicyState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerIdMap: Record<string, string>;
  name: string;
  action: string;
  payload: Record<string, unknown>;
  message: string;
  policyInProgress: Ref<string | null>;
  policyMessage: Ref<string | null>;
  policyError: Ref<string | null>;
  loadContainers: () => Promise<void>;
}): Promise<boolean> {
  if (!args.containerActionsEnabled) {
    args.policyMessage.value = null;
    args.policyError.value = args.containerActionsDisabledReason;
    return false;
  }
  const containerId = args.containerIdMap[args.name];
  if (!containerId || args.policyInProgress.value) {
    return false;
  }
  args.policyInProgress.value = `${args.action}:${args.name}`;
  args.policyError.value = null;
  try {
    await updateContainerPolicy(containerId, args.action, args.payload);
    args.policyMessage.value = args.message;
    await args.loadContainers();
    return true;
  } catch (e: unknown) {
    args.policyError.value = errorMessage(e, 'Failed to update policy');
    return false;
  } finally {
    args.policyInProgress.value = null;
  }
}

async function executeContainerActionState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerIdMap: Record<string, string>;
  name: string;
  actionInProgress: Ref<string | null>;
  inputError: Ref<string | null>;
  containers: Readonly<Ref<Container[]>>;
  action: (id: string) => Promise<unknown>;
  loadContainers: () => Promise<void>;
  actionPending: Ref<Map<string, Container>>;
  startPolling: (name: string) => void;
  selectedContainerName: string | undefined;
  activeDetailTab: string;
  refreshActionTabData: () => Promise<void>;
}): Promise<boolean> {
  if (!args.containerActionsEnabled) {
    args.inputError.value = args.containerActionsDisabledReason;
    return false;
  }
  const containerId = args.containerIdMap[args.name];
  if (!containerId || args.actionInProgress.value) {
    return false;
  }
  args.actionInProgress.value = args.name;
  args.inputError.value = null;
  const snapshot = args.containers.value.find((container) => container.name === args.name);
  try {
    await args.action(containerId);
    await args.loadContainers();
    const stillPresent = args.containers.value.find((container) => container.name === args.name);
    if (!stillPresent && snapshot) {
      args.actionPending.value.set(args.name, snapshot);
      args.startPolling(args.name);
    }
    if (args.selectedContainerName === args.name && args.activeDetailTab === 'actions') {
      await args.refreshActionTabData();
    }
    return true;
  } catch (e: unknown) {
    args.inputError.value = errorMessage(e, `Action failed for ${args.name}`);
    return false;
  } finally {
    args.actionInProgress.value = null;
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
  inputError: Ref<string | null>;
  groupUpdateInProgress: Ref<Set<string>>;
  group: ContainerActionGroup;
  executeAction: (name: string, action: (id: string) => Promise<unknown>) => Promise<boolean>;
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
  if (updatableContainers.length === 0) {
    return;
  }
  setGroupUpdateStateValue(args.groupUpdateInProgress, args.group.key, true);
  try {
    for (const container of updatableContainers) {
      await args.executeAction(container.name, apiUpdateContainer);
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
  actionInProgress: Ref<string | null>;
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
  if (!containerId || args.actionInProgress.value) {
    return false;
  }
  args.actionInProgress.value = args.name;
  try {
    await apiDeleteContainer(containerId);
    args.skippedUpdates.value.delete(args.name);
    if (args.selectedContainerName === args.name) {
      args.closeFullPage();
      args.closePanel();
    }
    await args.loadContainers();
    return true;
  } catch (e: unknown) {
    args.inputError.value = errorMessage(e, `Failed to delete ${args.name}`);
    return false;
  } finally {
    args.actionInProgress.value = null;
  }
}

async function runForSelectedContainer(
  selectedContainer: Readonly<Ref<Container | null | undefined>>,
  run: (containerName: string) => Promise<void>,
) {
  const containerName = selectedContainer.value?.name;
  if (!containerName) {
    return;
  }
  await run(containerName);
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

function createSelectedPolicyActions(args: {
  selectedContainer: Readonly<Ref<Container | null | undefined>>;
  skippedUpdates: Ref<Set<string>>;
  applyPolicy: (
    name: string,
    action: string,
    payload: Record<string, unknown>,
    message: string,
  ) => Promise<boolean>;
  refreshActionTabData: () => Promise<void>;
  policyError: Ref<string | null>;
  snoozeDateInput: Ref<string>;
}) {
  async function skipCurrentForSelected() {
    await runForSelectedContainer(args.selectedContainer, async (containerName) => {
      const applied = await args.applyPolicy(
        containerName,
        'skip-current',
        {},
        `Skipped current update for ${containerName}`,
      );
      if (applied) {
        args.skippedUpdates.value.add(containerName);
        await args.refreshActionTabData();
      }
    });
  }

  async function snoozeSelected(days: number) {
    await runForSelectedContainer(args.selectedContainer, async (containerName) => {
      await args.applyPolicy(
        containerName,
        'snooze',
        { days },
        `Snoozed updates for ${days} day${days === 1 ? '' : 's'}`,
      );
    });
  }

  async function snoozeSelectedUntilDate() {
    const snoozeUntil = resolveSnoozeUntilFromInput(args.snoozeDateInput.value);
    if (!snoozeUntil) {
      args.policyError.value = 'Select a valid snooze date';
      return;
    }
    await runForSelectedContainer(args.selectedContainer, async (containerName) => {
      await args.applyPolicy(
        containerName,
        'snooze',
        { snoozeUntil },
        `Snoozed until ${args.snoozeDateInput.value}`,
      );
    });
  }

  async function unsnoozeSelected() {
    await runForSelectedContainer(args.selectedContainer, async (containerName) => {
      await args.applyPolicy(containerName, 'unsnooze', {}, 'Snooze cleared');
    });
  }

  async function clearSkipsSelected() {
    await runForSelectedContainer(args.selectedContainer, async (containerName) => {
      args.skippedUpdates.value.delete(containerName);
      await args.applyPolicy(containerName, 'clear-skips', {}, 'Skipped updates cleared');
    });
  }

  async function clearPolicySelected() {
    await runForSelectedContainer(args.selectedContainer, async (containerName) => {
      args.skippedUpdates.value.delete(containerName);
      await args.applyPolicy(containerName, 'clear', {}, 'Update policy cleared');
    });
  }

  async function removeSkipSelected(kind: 'tag' | 'digest', value: string) {
    if (!value) {
      return;
    }
    await runForSelectedContainer(args.selectedContainer, async (containerName) => {
      args.skippedUpdates.value.delete(containerName);
      await args.applyPolicy(
        containerName,
        'remove-skip',
        { kind, value },
        `Removed skipped ${kind} ${value}`,
      );
    });
  }

  async function removeSkipTagSelected(value: string) {
    await removeSkipSelected('tag', value);
  }

  async function removeSkipDigestSelected(value: string) {
    await removeSkipSelected('digest', value);
  }

  return {
    clearPolicySelected,
    clearSkipsSelected,
    removeSkipDigestSelected,
    removeSkipTagSelected,
    skipCurrentForSelected,
    snoozeSelected,
    snoozeSelectedUntilDate,
    unsnoozeSelected,
  };
}

function createConfirmHandlers(args: {
  confirm: ReturnType<typeof useConfirmDialog>;
  executeAction: (name: string, action: (id: string) => Promise<unknown>) => Promise<boolean>;
  forceUpdate: (name: string) => Promise<void>;
  deleteContainer: (name: string) => Promise<boolean>;
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
      accept: () => args.executeAction(name, apiStopContainer),
    });
  }

  function confirmRestart(name: string) {
    args.confirm.require({
      header: 'Restart Container',
      message: `Restart ${name}?`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Restart',
      severity: 'warn',
      accept: () => args.executeAction(name, apiRestartContainer),
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
    args.confirm.require({
      header: 'Update Container',
      message: `Update ${name} now? This will apply the latest discovered image.`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Update',
      severity: 'warn',
      accept: () => args.executeAction(name, apiUpdateContainer),
    });
  }

  function confirmDelete(name: string) {
    args.confirm.require({
      header: 'Delete Container',
      message: `Delete ${name}? This will remove it from Drydock tracking until rediscovered.`,
      rejectLabel: 'Cancel',
      acceptLabel: 'Delete',
      severity: 'danger',
      accept: () => args.deleteContainer(name),
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
    confirmDelete,
    confirmForceUpdate,
    confirmRestart,
    confirmRollback,
    confirmStop,
    confirmUpdate,
  };
}

function createContainerActionHandlers(args: {
  executeAction: (name: string, action: (id: string) => Promise<unknown>) => Promise<boolean>;
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
    await args.executeAction(name, apiStartContainer);
  }

  async function updateContainer(name: string) {
    await args.executeAction(name, apiUpdateContainer);
  }

  async function scanContainer(name: string) {
    await args.executeAction(name, apiScanContainer);
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
    await args.executeAction(name, apiUpdateContainer);
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

  const detailPreview = ref<ContainerPreviewPayload | null>(null);
  const detailComposePreview = computed<ContainerComposePreview | null>(() =>
    buildDetailComposePreview(detailPreview.value),
  );
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

  function isContainerActionsEnabled(): boolean {
    return containerActionsEnabled.value;
  }

  function resetDetailMessages() {
    resetDetailMessagesState({
      triggerMessage,
      triggerError,
      rollbackMessage,
      rollbackError,
      policyMessage,
      policyError,
      updateOperationsError,
    });
  }

  async function loadDetailTriggers() {
    await loadContainerDetailListState({
      containerId: input.selectedContainerId.value,
      loading: triggersLoading,
      error: triggerError,
      value: detailTriggers,
      loader: getContainerTriggers,
      failureMessage: 'Failed to load associated triggers',
    });
  }

  async function loadDetailBackups() {
    await loadContainerDetailListState({
      containerId: input.selectedContainerId.value,
      loading: backupsLoading,
      error: rollbackError,
      value: detailBackups,
      loader: getBackups,
      failureMessage: 'Failed to load backups',
    });
  }

  async function loadDetailUpdateOperations() {
    await loadDetailUpdateOperationsState({
      containerId: input.selectedContainerId.value,
      detailUpdateOperations,
      updateOperationsLoading,
      updateOperationsError,
    });
  }

  async function refreshActionTabData() {
    await Promise.all([loadDetailTriggers(), loadDetailBackups(), loadDetailUpdateOperations()]);
  }

  let actionTabDetailRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  function clearActionTabDetailRefreshTimer() {
    if (actionTabDetailRefreshTimer === undefined) {
      return;
    }
    clearTimeout(actionTabDetailRefreshTimer);
    actionTabDetailRefreshTimer = undefined;
  }

  function scheduleActionTabDataRefresh() {
    clearActionTabDetailRefreshTimer();
    actionTabDetailRefreshTimer = setTimeout(() => {
      actionTabDetailRefreshTimer = undefined;
      void refreshActionTabData();
    }, ACTION_TAB_DETAIL_REFRESH_DEBOUNCE_MS);
  }

  async function runContainerPreview() {
    await runContainerPreviewState({
      containerId: input.selectedContainerId.value,
      previewLoading,
      previewError,
      detailPreview,
    });
  }

  async function runAssociatedTrigger(trigger: ApiContainerTrigger) {
    await runAssociatedTriggerState({
      containerActionsEnabled: isContainerActionsEnabled(),
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containerId: input.selectedContainerId.value,
      trigger,
      triggerRunInProgress,
      triggerMessage,
      triggerError,
      loadContainers: input.loadContainers,
      refreshActionTabData,
    });
  }

  async function rollbackToBackup(backupId?: string) {
    await rollbackToBackupState({
      containerActionsEnabled: isContainerActionsEnabled(),
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containerId: input.selectedContainerId.value,
      backupId,
      rollbackInProgress,
      rollbackMessage,
      rollbackError,
      skippedUpdates,
      selectedContainerName: input.selectedContainer.value?.name,
      loadContainers: input.loadContainers,
      loadDetailBackups,
      loadDetailUpdateOperations,
    });
  }

  async function applyPolicy(
    name: string,
    action: string,
    payload: Record<string, unknown> = {},
    message: string,
  ) {
    return applyPolicyState({
      containerActionsEnabled: isContainerActionsEnabled(),
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containerIdMap: input.containerIdMap.value,
      name,
      action,
      payload,
      message,
      policyInProgress,
      policyMessage,
      policyError,
      loadContainers: input.loadContainers,
    });
  }

  const {
    clearPolicySelected,
    clearSkipsSelected,
    removeSkipDigestSelected,
    removeSkipTagSelected,
    skipCurrentForSelected,
    snoozeSelected,
    snoozeSelectedUntilDate,
    unsnoozeSelected,
  } = createSelectedPolicyActions({
    selectedContainer: input.selectedContainer,
    skippedUpdates,
    applyPolicy,
    refreshActionTabData,
    policyError,
    snoozeDateInput,
  });

  watch(
    () => [input.selectedContainer.value?.name, input.activeDetailTab.value],
    ([containerName, tabName]) => {
      handleSelectedContainerOrTabChange({
        containerName,
        tabName,
        detailPreview,
        previewError,
        detailTriggers,
        detailBackups,
        detailUpdateOperations,
        updateOperationsError,
        clearActionTabDetailRefreshTimer,
        resetDetailMessages,
        scheduleActionTabDataRefresh,
      });
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
      pollInterval: POLL_INTERVAL,
      pollPendingActions,
    });
  }

  onUnmounted(() => {
    clearActionTabDetailRefreshTimer();
    stopPendingActionsPolling();
  });

  async function executeAction(name: string, action: (id: string) => Promise<unknown>) {
    return executeContainerActionState({
      containerActionsEnabled: isContainerActionsEnabled(),
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      containerIdMap: input.containerIdMap.value,
      name,
      actionInProgress,
      inputError: input.error,
      containers: input.containers,
      action,
      loadContainers: input.loadContainers,
      actionPending,
      startPolling,
      selectedContainerName: input.selectedContainer.value?.name,
      activeDetailTab: input.activeDetailTab.value,
      refreshActionTabData,
    });
  }

  async function updateAllInGroup(group: ContainerActionGroup) {
    await updateAllInGroupState({
      containerActionsEnabled: isContainerActionsEnabled(),
      containerActionsDisabledReason: containerActionsDisabledReason.value,
      inputError: input.error,
      groupUpdateInProgress,
      group,
      executeAction,
    });
  }

  const { forceUpdate, scanContainer, skipUpdate, startContainer, updateContainer } =
    createContainerActionHandlers({
      executeAction,
      applyPolicy,
      skippedUpdates,
      selectedContainer: input.selectedContainer,
      activeDetailTab: input.activeDetailTab,
      refreshActionTabData,
    });

  async function deleteContainer(name: string) {
    return deleteContainerState({
      containerActionsEnabled: isContainerActionsEnabled(),
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
    selectedContainer: input.selectedContainer,
    rollbackToBackup,
  });

  function getContainerListPolicyState(containerName: string): ContainerListPolicyState {
    return deriveContainerListPolicyState(input.containerMetaMap.value, containerName);
  }

  function containerPolicyTooltip(containerName: string, kind: 'snoozed' | 'skipped'): string {
    const state = getContainerListPolicyState(containerName);
    return buildContainerPolicyTooltip(state, kind);
  }

  return {
    actionInProgress,
    actionPending,
    backupsLoading,
    containerActionsDisabledReason,
    containerActionsEnabled,
    clearPolicySelected,
    clearSkipsSelected,
    confirmDelete,
    confirmForceUpdate,
    confirmUpdate,
    confirmRollback,
    confirmRestart,
    confirmStop,
    containerPolicyTooltip,
    detailBackups,
    detailComposePreview,
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
