import { computed, type Ref, ref } from 'vue';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import { useDependencyGraph } from '../../composables/useDependencyGraph';
import type { UpdateMode } from '../../services/settings';
import type { Container } from '../../types/container';
import {
  type BulkRowState,
  type BulkUpdatePlan,
  planBulkUpdate,
} from '../../utils/bulk-update-plan';
import type { TranslateFn } from '../../utils/container-update';
import { resolveSnoozeUntilFromInput } from '../../utils/snooze-date';
import { hasRawUpdateCandidate, updateButtonState } from '../../utils/update-eligibility';
import {
  type BulkSnoozeDuration,
  type BulkSnoozeTarget,
  useBulkContainerSnooze,
} from './useBulkContainerSnooze';

export function useFleetBulkActions(input: {
  containers: Readonly<Ref<Container[]>>;
  scope: Readonly<Ref<Container[]>>;
  containerActionsEnabled: Readonly<Ref<boolean>>;
  busy: Readonly<Ref<boolean>>;
  updateMode: Readonly<Ref<UpdateMode>>;
  isContainerRowLocked: (container: Container) => boolean;
  isContainerUpdateInProgress: (container: Container) => boolean;
  isContainerUpdateQueued: (container: Container) => boolean;
  groupKeyForContainer: (container: Container) => string | undefined;
  confirmBulkUpdate: (plan: BulkUpdatePlan) => void;
  loadContainers: () => Promise<void>;
  t: TranslateFn;
}) {
  const confirm = useConfirmDialog();
  const { adjacency } = useDependencyGraph();
  const core = useBulkContainerSnooze(input);
  const duration = ref<'1' | '7' | '30' | 'date'>('7');
  const date = ref('');
  const summary = ref('');
  const summaryWarning = ref(false);
  const busy = computed(() => input.busy.value || core.inProgress.value);
  const unavailable = computed(
    () => !input.containerActionsEnabled.value || busy.value || confirm.visible.value,
  );
  const locked = (container: Container) =>
    input.isContainerRowLocked(container) ||
    input.isContainerUpdateInProgress(container) ||
    input.isContainerUpdateQueued(container);
  function rowState(container: Container): BulkRowState {
    if (container.bouncer === 'blocked') return 'blocked';
    return updateButtonState(
      container.updateEligibility,
      hasRawUpdateCandidate(container),
      locked(container),
      input.updateMode.value,
    );
  }
  const plan = computed(() =>
    planBulkUpdate({
      selectedIds: new Set(input.scope.value.map((container) => container.id)),
      containers: input.scope.value,
      allContainers: input.containers.value,
      adjacency: adjacency.value,
      rowState,
      isRowLocked: locked,
      groupKeyForContainer: input.groupKeyForContainer,
      t: input.t,
    }),
  );
  const patchTargets = computed(() => [
    ...new Map(
      input.scope.value
        .filter(
          (container) =>
            container.updateKind === 'patch' &&
            hasRawUpdateCandidate(container) &&
            !locked(container),
        )
        .map((container) => [container.id, container]),
    ).values(),
  ]);
  const validDuration = computed(
    () => duration.value !== 'date' || Boolean(resolveSnoozeUntilFromInput(date.value)),
  );
  const canUpdate = computed(() => !unavailable.value && plan.value.dispatch.length > 0);
  const canSnooze = computed(
    () => !unavailable.value && validDuration.value && patchTargets.value.length > 0,
  );
  const patchCount = computed(() => patchTargets.value.length);
  const updateCount = computed(() => plan.value.dispatch.length);

  function updateAll() {
    if (canUpdate.value) input.confirmBulkUpdate(plan.value);
  }
  function targetLabel(target: BulkSnoozeTarget) {
    return `${target.name} (${target.agent || input.t('containerComponents.fleetDimensions.local')}; ${target.id})`;
  }
  function snoozeAllPatch() {
    if (!canSnooze.value) return;
    const targets = patchTargets.value.map(({ id, name, agent, identityKey }) => ({
      id,
      name,
      agent,
      identityKey,
    }));
    const frozenDuration: BulkSnoozeDuration =
      duration.value === 'date' ? { date: date.value } : { days: Number(duration.value) };
    const until =
      duration.value === 'date'
        ? date.value
        : input.t('containerComponents.fleetBulk.days', { count: Number(duration.value) });
    let accepted = false;
    confirm.require({
      header: input.t('containerComponents.fleetBulk.snoozeConfirm', { count: targets.length }),
      message: [
        input.t('containerComponents.fleetBulk.snoozeScope', { duration: until }),
        ...targets.map((target) => `• ${targetLabel(target)}`),
      ].join('\n'),
      acceptLabel: input.t('containerComponents.fleetBulk.snoozePatch'),
      rejectLabel: input.t('containerComponents.confirmDialogs.cancel'),
      accept: async () => {
        if (accepted) return;
        accepted = true;
        if (input.busy.value) {
          summary.value = input.t('containerComponents.fleetBulk.busy');
          summaryWarning.value = true;
          return;
        }
        const result = await core.snooze(targets, frozenDuration);
        if (result.status !== 'completed') {
          summary.value = input.t(`containerComponents.fleetBulk.${result.status}`);
          summaryWarning.value = true;
          return;
        }
        summaryWarning.value = result.failed.length > 0 || Boolean(result.reloadFailure);
        summary.value = [
          input.t('containerComponents.fleetBulk.snoozeResult', {
            succeeded: result.succeeded.length,
            failed: result.failed.length,
          }),
          ...result.failed.map(({ target }) => targetLabel(target)),
          ...(result.reloadFailure ? [input.t('containerComponents.fleetBulk.refreshFailed')] : []),
        ].join('\n');
      },
    });
  }
  return {
    duration,
    date,
    summary,
    summaryWarning,
    busy,
    canUpdate,
    canSnooze,
    patchCount,
    updateCount,
    updateAll,
    snoozeAllPatch,
  };
}
