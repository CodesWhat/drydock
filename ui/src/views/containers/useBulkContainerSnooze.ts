import { type Ref, readonly, ref } from 'vue';
import { updateContainerPolicy } from '../../services/container';
import type { Container } from '../../types/container';
import { resolveSnoozeUntilFromInput } from '../../utils/snooze-date';

export type BulkSnoozeTarget = Pick<Container, 'id' | 'name' | 'agent' | 'identityKey'>;
export type BulkSnoozeDuration = { days: number } | { date: string };
export type BulkSnoozeResult =
  | { status: 'busy' | 'disabled' }
  | { status: 'invalid'; field: 'days' | 'date' }
  | {
      status: 'completed';
      succeeded: BulkSnoozeTarget[];
      failed: { target: BulkSnoozeTarget; error: unknown }[];
      reloadFailure?: { error: unknown };
    };

export function useBulkContainerSnooze(input: {
  containerActionsEnabled: Readonly<Ref<boolean>>;
  loadContainers: () => Promise<void>;
}) {
  const inProgress = ref(false);
  async function snooze(
    targets: readonly BulkSnoozeTarget[],
    duration: BulkSnoozeDuration,
  ): Promise<BulkSnoozeResult> {
    if (inProgress.value) {
      return { status: 'busy' };
    }
    if (!input.containerActionsEnabled.value) {
      return { status: 'disabled' };
    }
    let payload: Record<string, unknown>;
    if ('days' in duration) {
      if (!Number.isFinite(duration.days) || duration.days <= 0 || duration.days > 365) {
        return { status: 'invalid', field: 'days' };
      }
      payload = { days: duration.days };
    } else {
      const snoozeUntil = resolveSnoozeUntilFromInput(duration.date);
      if (!snoozeUntil) {
        return { status: 'invalid', field: 'date' };
      }
      payload = { snoozeUntil };
    }
    const frozenTargets = [
      ...new Map(targets.map((target) => [target.id, { ...target }])).values(),
    ];
    const result: Extract<BulkSnoozeResult, { status: 'completed' }> = {
      status: 'completed',
      succeeded: [],
      failed: [],
    };
    if (frozenTargets.length === 0) {
      return result;
    }
    inProgress.value = true;
    try {
      for (const target of frozenTargets) {
        try {
          await updateContainerPolicy(target.id, 'snooze', payload);
          result.succeeded.push(target);
        } catch (error) {
          result.failed.push({ target, error });
        }
      }
      try {
        await input.loadContainers();
      } catch (error) {
        result.reloadFailure = { error };
      }
      return result;
    } finally {
      inProgress.value = false;
    }
  }
  return { inProgress: readonly(inProgress), snooze };
}
