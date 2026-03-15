import { type Ref, ref } from 'vue';
import { getContainerTriggers, runTrigger as runContainerTrigger } from '../../services/container';
import type { ApiContainerTrigger } from '../../types/api';
import { errorMessage } from '../../utils/error';

interface UseContainerTriggersInput {
  selectedContainerId: Readonly<Ref<string | undefined>>;
  containerActionsEnabled: Readonly<Ref<boolean>>;
  containerActionsDisabledReason: Readonly<Ref<string>>;
  loadContainers: () => Promise<void>;
  refreshActionTabData: () => Promise<void>;
}

async function loadContainerDetailListState(args: {
  containerId: string | undefined;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  value: Ref<Record<string, unknown>[]>;
  loader: (containerId: string) => Promise<unknown[]>;
  failureMessage: string;
}) {
  if (!args.containerId) {
    args.value.value = [];
    return;
  }

  args.loading.value = true;
  args.error.value = null;
  try {
    args.value.value = (await args.loader(args.containerId)) as Record<string, unknown>[];
  } catch (e: unknown) {
    args.value.value = [];
    args.error.value = errorMessage(e, args.failureMessage);
  } finally {
    args.loading.value = false;
  }
}

export function getTriggerKey(trigger: ApiContainerTrigger): string {
  if (trigger.id) {
    return trigger.id;
  }
  const prefix = trigger.agent ? `${trigger.agent}.` : '';
  return `${prefix}${trigger.type}.${trigger.name}`;
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

export function useContainerTriggers(input: UseContainerTriggersInput) {
  const detailTriggers = ref<Record<string, unknown>[]>([]);
  const triggersLoading = ref(false);
  const triggerRunInProgress = ref<string | null>(null);
  const triggerMessage = ref<string | null>(null);
  const triggerError = ref<string | null>(null);

  function clearTriggerDetails() {
    detailTriggers.value = [];
  }

  function resetTriggerMessages() {
    triggerMessage.value = null;
    triggerError.value = null;
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

  async function runAssociatedTrigger(trigger: ApiContainerTrigger) {
    await runAssociatedTriggerState({
      containerActionsEnabled: input.containerActionsEnabled.value,
      containerActionsDisabledReason: input.containerActionsDisabledReason.value,
      containerId: input.selectedContainerId.value,
      trigger,
      triggerRunInProgress,
      triggerMessage,
      triggerError,
      loadContainers: input.loadContainers,
      refreshActionTabData: input.refreshActionTabData,
    });
  }

  return {
    clearTriggerDetails,
    detailTriggers,
    getTriggerKey,
    loadDetailTriggers,
    resetTriggerMessages,
    runAssociatedTrigger,
    triggerError,
    triggerMessage,
    triggerRunInProgress,
    triggersLoading,
  };
}
