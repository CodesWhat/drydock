import { type Ref, ref } from 'vue';
import { useI18n } from 'vue-i18n';
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

export function formatTimestamp(
  timestamp: string | undefined,
  t?: (key: string) => string,
): string {
  if (!timestamp) {
    return t ? t('containerComponents.backups.timestampUnknown') : 'Unknown';
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }
  return parsed.toLocaleString();
}

function formatOperationValue(value: unknown, t?: (key: string) => string): string {
  if (typeof value !== 'string') {
    return t ? t('containerComponents.sideTabContent.unknown') : 'unknown';
  }
  return value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

export function formatOperationPhase(phase: unknown, t?: (key: string) => string): string {
  return formatOperationValue(phase, t);
}

export function formatRollbackReason(reason: unknown, t?: (key: string) => string): string {
  return formatOperationValue(reason, t);
}

export function formatOperationStatus(status: unknown, t?: (key: string) => string): string {
  return formatOperationValue(status, t);
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
  t: (key: string) => string;
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
    args.updateOperationsError.value = errorMessage(
      e,
      args.t('containerComponents.backups.operationHistoryLoadFailed'),
    );
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
  t: (key: string) => string;
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
      ? args.t('containerComponents.backups.rollback.completedFromSelected')
      : args.t('containerComponents.backups.rollback.completedFromLatest');
    args.rollbackMessage.value = successMessage;
    const toast = useToast();
    toast.success(successMessage);
    args.skippedUpdates.value.delete(args.selectedContainerKey || '');
    await args.loadContainers();
    await Promise.all([args.loadDetailBackups(), args.loadDetailUpdateOperations()]);
  } catch (e: unknown) {
    const msg = errorMessage(e, args.t('containerComponents.backups.rollback.failedDetail'));
    args.rollbackError.value = msg;
    const toast = useToast();
    toast.error(args.t('containerComponents.backups.rollback.failedTitle'), msg);
  } finally {
    args.rollbackInProgress.value = null;
  }
}

export function useContainerBackups(input: UseContainerBackupsInput) {
  const { t } = useI18n();
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
      failureMessage: t('containerComponents.backups.loadFailed'),
    });
  }

  async function loadDetailUpdateOperations() {
    await loadDetailUpdateOperationsState({
      containerId: input.selectedContainerId.value,
      detailUpdateOperations,
      updateOperationsLoading,
      updateOperationsError,
      t,
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
      t,
    });
  }

  function formatTimestampLocalized(timestamp: string | undefined): string {
    return formatTimestamp(timestamp, t);
  }
  function formatOperationPhaseLocalized(phase: unknown): string {
    return formatOperationPhase(phase, t);
  }
  function formatOperationStatusLocalized(status: unknown): string {
    return formatOperationStatus(status, t);
  }
  function formatRollbackReasonLocalized(reason: unknown): string {
    return formatRollbackReason(reason, t);
  }

  return {
    backupsLoading,
    clearBackupsDetails,
    detailBackups,
    detailUpdateOperations,
    formatOperationPhase: formatOperationPhaseLocalized,
    formatOperationStatus: formatOperationStatusLocalized,
    formatRollbackReason: formatRollbackReasonLocalized,
    formatTimestamp: formatTimestampLocalized,
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
