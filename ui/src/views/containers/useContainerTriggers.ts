import { type Ref, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '../../composables/useToast';
import {
  getContainerTriggersWithReasons,
  runTrigger as runContainerTrigger,
} from '../../services/container';
import type { ApiContainerTrigger, ApiUnassociatedContainerTrigger } from '../../types/api';
import { errorMessage } from '../../utils/error';

interface UseContainerTriggersInput {
  selectedContainerId: Readonly<Ref<string | undefined>>;
  containerActionsEnabled: Readonly<Ref<boolean>>;
  containerActionsDisabledReason: Readonly<Ref<string>>;
  loadContainers: () => Promise<void>;
  refreshActionTabData: () => Promise<void>;
}

function getTriggerKey(trigger: ApiContainerTrigger): string {
  if (trigger.id) {
    return trigger.id;
  }
  const prefix = trigger.agent ? `${trigger.agent}.` : '';
  return `${prefix}${trigger.type}.${trigger.name}`;
}

export function findDryRunActionTrigger(
  triggers: readonly ApiContainerTrigger[],
): ApiContainerTrigger | undefined {
  return triggers.find(isDryRunActionTrigger);
}

export function isDryRunActionTrigger(trigger: ApiContainerTrigger): boolean {
  return (
    (trigger.type === 'docker' || trigger.type === 'dockercompose') &&
    trigger.configuration?.dryrun === true
  );
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
  t: (key: string, params?: Record<string, unknown>) => string;
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
    args.triggerMessage.value = args.t('containerComponents.triggers.toasts.ranSuccessfully', {
      key: triggerKey,
    });
    const toast = useToast();
    toast.success(args.t('containerComponents.triggers.toasts.ran', { key: triggerKey }));
    await args.loadContainers();
    await args.refreshActionTabData();
  } catch (e: unknown) {
    const msg = errorMessage(
      e,
      args.t('containerComponents.triggers.toasts.failedDetail', { key: triggerKey }),
    );
    args.triggerError.value = msg;
    const toast = useToast();
    toast.error(args.t('containerComponents.triggers.toasts.failed', { key: triggerKey }), msg);
  } finally {
    args.triggerRunInProgress.value = null;
  }
}

export function useContainerTriggers(input: UseContainerTriggersInput) {
  const { t } = useI18n();
  const detailTriggers = ref<ApiContainerTrigger[]>([]);
  // Triggers that do not apply to the selected container, each with a reason (DR-78).
  const unassociatedTriggers = ref<ApiUnassociatedContainerTrigger[]>([]);
  const triggersLoading = ref(false);
  const triggerRunInProgress = ref<string | null>(null);
  const triggerMessage = ref<string | null>(null);
  const triggerError = ref<string | null>(null);

  function clearTriggerDetails() {
    detailTriggers.value = [];
    unassociatedTriggers.value = [];
  }

  function resetTriggerMessages() {
    triggerMessage.value = null;
    triggerError.value = null;
  }

  async function loadDetailTriggers() {
    const containerId = input.selectedContainerId.value;
    if (!containerId) {
      detailTriggers.value = [];
      unassociatedTriggers.value = [];
      return;
    }

    triggersLoading.value = true;
    triggerError.value = null;
    try {
      const { data, unassociatedTriggers: reasons } =
        await getContainerTriggersWithReasons(containerId);
      if (input.selectedContainerId.value !== containerId) {
        // The selected container changed while the request was in flight; a newer load
        // already owns (or will own) these refs, so this stale response is dropped.
        return;
      }
      detailTriggers.value = data;
      unassociatedTriggers.value = reasons;
    } catch (e: unknown) {
      if (input.selectedContainerId.value !== containerId) {
        return;
      }
      detailTriggers.value = [];
      unassociatedTriggers.value = [];
      triggerError.value = errorMessage(e, t('containerComponents.triggers.toasts.loadFailed'));
    } finally {
      if (input.selectedContainerId.value === containerId) {
        triggersLoading.value = false;
      }
    }
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
      t,
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
    unassociatedTriggers,
  };
}
