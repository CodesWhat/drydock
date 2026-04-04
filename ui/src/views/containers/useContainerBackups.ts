import { type Ref, ref } from 'vue';
import { useToast } from '../../composables/useToast';
import { getBackups, rollback } from '../../services/backup';
import { getContainerUpdateOperations as fetchContainerUpdateOperations } from '../../services/container';
import type { ApiContainerUpdateOperation } from '../../types/api';
import { errorMessage } from '../../utils/error';
import { loadContainerDetailListState } from './loadContainerDetailListState';

interface UseContainerBackupsInput {
  selectedContainerId: Readonly<Ref<string | undefined>>;
  selectedContainerKey: Readonly<Ref<string | undefined>>;
  skippedUpdates: Ref<Set<string>>;
  containerActionsEnabled: Readonly<Ref<boolean>>;
  containerActionsDisabledReason: Readonly<Ref<string>>;
  loadContainers: () => Promise<void>;
}

export function formatTimestamp(timestamp: string | undefined): string {
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

export function formatOperationPhase(phase: unknown): string {
  return formatOperationValue(phase);
}

export function formatRollbackReason(reason: unknown): string {
  return formatOperationValue(reason);
}

export function formatOperationStatus(status: unknown): string {
  return formatOperationValue(status);
}

export function getOperationStatusStyle(status: unknown) {
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

async function loadDetailUpdateOperationsState(args: {
  containerId: string | undefined;
  detailUpdateOperations: Ref<ApiContainerUpdateOperation[]>;
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

async function rollbackToBackupState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerId: string | undefined;
  backupId?: string;
  rollbackInProgress: Ref<string | null>;
  rollbackMessage: Ref<string | null>;
  rollbackError: Ref<string | null>;
  skippedUpdates: Ref<Set<string>>;
  selectedContainerKey: string | undefined;
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
    const successMessage = args.backupId
      ? 'Rollback completed from selected backup'
      : 'Rollback completed from latest backup';
    args.rollbackMessage.value = successMessage;
    const toast = useToast();
    toast.success(successMessage);
    args.skippedUpdates.value.delete(args.selectedContainerKey || '');
    await args.loadContainers();
    await Promise.all([args.loadDetailBackups(), args.loadDetailUpdateOperations()]);
  } catch (e: unknown) {
    const msg = errorMessage(e, 'Rollback failed');
    args.rollbackError.value = msg;
    const toast = useToast();
    toast.error('Rollback failed', msg);
  } finally {
    args.rollbackInProgress.value = null;
  }
}

export function useContainerBackups(input: UseContainerBackupsInput) {
  const detailBackups = ref<Record<string, unknown>[]>([]);
  const backupsLoading = ref(false);
  const rollbackInProgress = ref<string | null>(null);
  const rollbackMessage = ref<string | null>(null);
  const rollbackError = ref<string | null>(null);
  const detailUpdateOperations = ref<ApiContainerUpdateOperation[]>([]);
  const updateOperationsLoading = ref(false);
  const updateOperationsError = ref<string | null>(null);

  function clearBackupsDetails() {
    detailBackups.value = [];
    detailUpdateOperations.value = [];
    updateOperationsError.value = null;
  }

  function resetBackupsMessages() {
    rollbackMessage.value = null;
    rollbackError.value = null;
    updateOperationsError.value = null;
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

  async function rollbackToBackup(backupId?: string) {
    await rollbackToBackupState({
      containerActionsEnabled: input.containerActionsEnabled.value,
      containerActionsDisabledReason: input.containerActionsDisabledReason.value,
      containerId: input.selectedContainerId.value,
      backupId,
      rollbackInProgress,
      rollbackMessage,
      rollbackError,
      skippedUpdates: input.skippedUpdates,
      selectedContainerKey: input.selectedContainerKey.value,
      loadContainers: input.loadContainers,
      loadDetailBackups,
      loadDetailUpdateOperations,
    });
  }

  return {
    backupsLoading,
    clearBackupsDetails,
    detailBackups,
    detailUpdateOperations,
    formatOperationPhase,
    formatOperationStatus,
    formatRollbackReason,
    formatTimestamp,
    getOperationStatusStyle,
    loadDetailBackups,
    loadDetailUpdateOperations,
    resetBackupsMessages,
    rollbackError,
    rollbackInProgress,
    rollbackMessage,
    rollbackToBackup,
    updateOperationsError,
    updateOperationsLoading,
  };
}
