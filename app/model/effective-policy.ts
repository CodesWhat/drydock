/**
 * The effective-policy resolver (spec 7.3 slice 2b): where each update-policy field and each
 * action restriction on one container comes from, and what dispatch will do with it.
 *
 * It is a read of the same functions dispatch runs, never a second implementation of them.
 * Update-policy values come from `resolveUpdatePolicyLayers`, which the store calls on every
 * write. The ceiling comes from `resolveUpdateModeCeiling`. The trigger verdict comes from
 * `selectActionTrigger` and `resolveForTrigger` beneath it, and the automatic verdict from
 * `isAutoDispatchable`, which approvals use to ask the same question the trigger paths do.
 *
 * Pure: the caller supplies the container as it stands now (with the group snapshot already
 * current), the global update mode and the registered triggers.
 */
import type { UpdateMode } from '../store/settings.js';
import { type ActionPolicyTrigger, selectActionTrigger } from './action-policy.js';
import { isAutoDispatchable } from './approval.js';
import type {
  Container,
  ContainerDeclarativeUpdatePolicy,
  ContainerUpdatePolicy,
  ContainerUpdatePolicySource,
} from './container.js';
import { getContainerGroupIdentity } from './container-group.js';
import { getGroupExcludeEntries, resolveUpdateModeCeiling } from './group-policy.js';
import { DEFAULT_MATURITY_MIN_AGE_DAYS } from './maturity-policy.js';
import {
  DECLARATIVE_UPDATE_POLICY_FIELDS,
  type DeclarativeUpdatePolicyField,
  getUpdatePolicyOverrides,
  resolveUpdatePolicyLayers,
} from './update-policy.js';

type EffectivePolicySource = 'default' | ContainerUpdatePolicySource;

interface EffectivePolicyField<T> {
  value: T;
  source: EffectivePolicySource;
  /** The value each layer that sets this field holds, so a shadowed layer is still visible. */
  layers: Partial<Record<ContainerUpdatePolicySource, T>>;
}

interface EffectiveUpdatePolicy {
  maturityMode: EffectivePolicyField<'all' | 'mature'>;
  maturityMinAgeDays: EffectivePolicyField<number>;
  skipTags: EffectivePolicyField<string[]>;
  skipDigests: EffectivePolicyField<string[]>;
  snoozeUntil: { value: string | null; source: 'default' | 'override' };
}

type ManualUpdateBlocker =
  | 'group-notify-only'
  | 'global-notify'
  | 'trigger-excluded'
  | 'no-trigger';

export interface EffectiveContainerPolicy {
  group: {
    name: string;
    label: string;
    policyId: string | null;
    revision: number | null;
  } | null;
  updatePolicy: EffectiveUpdatePolicy;
  actions: {
    updateMode: {
      value: UpdateMode;
      /** `group` only when the group is strictly more restrictive than global. */
      source: 'global' | 'group';
      global: UpdateMode;
      group?: 'manual' | 'notify';
    };
    exclude: {
      /** The container's own `dd.action.exclude`, whichever of label or override supplied it. */
      label?: string;
      labelSource?: 'label' | 'override';
      group: string[];
    };
    dispatch: {
      /** Whether the automatic paths will apply an update to this container on their own. */
      automatic: boolean;
      /** The action trigger the resolver selects, or null when none is authorized. */
      trigger: {
        id: string;
        state: 'blocked' | 'manual' | 'auto';
        reason?: 'excluded' | 'not-included';
        excludedBy?: 'label' | 'group';
      } | null;
      manualUpdate: { allowed: boolean; blockedBy?: ManualUpdateBlocker };
    };
  };
}

export interface EffectivePolicyContext {
  globalUpdateMode: UpdateMode;
  triggers: Record<string, ActionPolicyTrigger> | undefined;
}

/** What a field is when no layer sets it. */
const FIELD_DEFAULTS = {
  maturityMode: 'all',
  maturityMinAgeDays: DEFAULT_MATURITY_MIN_AGE_DAYS,
  skipTags: [],
  skipDigests: [],
} as const;

function cloneValue<T>(value: T): T {
  return Array.isArray(value) ? ([...value] as T) : value;
}

function resolveField<F extends DeclarativeUpdatePolicyField>(
  field: F,
  layers: Record<
    'env' | 'group' | 'label' | 'override',
    ContainerDeclarativeUpdatePolicy | undefined
  >,
  resolved: ReturnType<typeof resolveUpdatePolicyLayers>,
): EffectivePolicyField<NonNullable<ContainerDeclarativeUpdatePolicy[F]>> {
  const fieldLayers: Record<string, unknown> = {};
  for (const [name, layer] of Object.entries(layers)) {
    if (layer && Object.hasOwn(layer, field)) {
      fieldLayers[name] = cloneValue(layer[field]);
    }
  }
  const source = resolved.updatePolicySources[field];
  const value = resolved.updatePolicy?.[field] ?? FIELD_DEFAULTS[field];
  return {
    value: cloneValue(value),
    source: source ?? 'default',
    layers: fieldLayers,
  } as EffectivePolicyField<NonNullable<ContainerDeclarativeUpdatePolicy[F]>>;
}

function resolveEffectiveUpdatePolicy(container: Container): EffectiveUpdatePolicy {
  const declarative = container.updatePolicyDeclarative ?? { env: {}, label: {} };
  const overrides: ContainerUpdatePolicy = getUpdatePolicyOverrides(container);
  const group = container.groupPolicy?.updatePolicy;
  const resolved = resolveUpdatePolicyLayers(declarative, overrides, group);
  const layers = { env: declarative.env, group, label: declarative.label, override: overrides };
  const [maturityMode, maturityMinAgeDays, skipTags, skipDigests] =
    DECLARATIVE_UPDATE_POLICY_FIELDS.map((field) => resolveField(field, layers, resolved));
  const snoozeUntil = resolved.updatePolicy?.snoozeUntil;
  return {
    maturityMode,
    maturityMinAgeDays,
    skipTags,
    skipDigests,
    snoozeUntil:
      snoozeUntil === undefined
        ? { value: null, source: 'default' }
        : { value: snoozeUntil, source: 'override' },
  } as EffectiveUpdatePolicy;
}

type ContainerWithApiLabelOwned = Container & {
  /** The API projection of `labelOwned.sources`, which is all an API container carries. */
  labelOwnedSources?: Partial<Record<string, string>>;
};

function resolveExclude(container: ContainerWithApiLabelOwned) {
  const label = container.actionTriggerExclude;
  const owned =
    (container.labelOwned?.sources.actionTriggerExclude ??
      container.labelOwnedSources?.actionTriggerExclude) === 'override';
  return {
    ...(label === undefined ? {} : { label }),
    // An override that cleared the exclusion leaves no value but is still the owner.
    ...(label !== undefined || owned ? { labelSource: owned ? 'override' : 'label' } : {}),
    group: [...getGroupExcludeEntries(container)],
  } as EffectiveContainerPolicy['actions']['exclude'];
}

function resolveDispatch(
  container: Container,
  context: EffectivePolicyContext,
  ceilingValue: UpdateMode,
): EffectiveContainerPolicy['actions']['dispatch'] {
  const selected = selectActionTrigger(context.triggers, container);
  const trigger = selected
    ? {
        id: selected.triggerId,
        state: selected.state,
        ...(selected.reason === undefined ? {} : { reason: selected.reason }),
        ...(selected.excludedBy === undefined ? {} : { excludedBy: selected.excludedBy }),
      }
    : null;

  let blockedBy: ManualUpdateBlocker | undefined;
  if (container.groupPolicy?.actions.updateMode === 'notify') {
    blockedBy = 'group-notify-only';
  } else if (ceilingValue === 'notify') {
    blockedBy = 'global-notify';
  } else if (trigger === null) {
    blockedBy = 'no-trigger';
  } else if (trigger.state === 'blocked') {
    blockedBy = 'trigger-excluded';
  }

  return {
    automatic: isAutoDispatchable(container, context.triggers, context.globalUpdateMode),
    trigger,
    manualUpdate: blockedBy === undefined ? { allowed: true } : { allowed: false, blockedBy },
  };
}

export function resolveEffectiveContainerPolicy(
  container: ContainerWithApiLabelOwned,
  context: EffectivePolicyContext,
): EffectiveContainerPolicy {
  const identity = getContainerGroupIdentity(container);
  const ceiling = resolveUpdateModeCeiling(container, context.globalUpdateMode);
  const groupMode = container.groupPolicy?.actions.updateMode;
  return {
    group:
      identity === null
        ? null
        : {
            name: identity.name,
            label: identity.label,
            policyId: container.groupPolicy?.id ?? null,
            revision: container.groupPolicy?.revision ?? null,
          },
    updatePolicy: resolveEffectiveUpdatePolicy(container),
    actions: {
      updateMode: {
        value: ceiling.value,
        source: ceiling.source,
        global: context.globalUpdateMode,
        ...(groupMode === undefined ? {} : { group: groupMode }),
      },
      exclude: resolveExclude(container),
      dispatch: resolveDispatch(container, context, ceiling.value),
    },
  };
}
