/**
 * Group policies (spec 7.3): one Drydock-owned policy per exact server-derived group name
 * (`getContainerGroup`). Types, validation and normalization only. The store applies the
 * update-policy layer (`app/store/container.ts`), and nothing here reads or writes state.
 */
import type { UpdateMode } from '../store/settings.js';
import { SUPPORTED_THRESHOLDS } from '../triggers/providers/trigger-threshold.js';
import { uniqStrings } from '../util/string-array.js';
import {
  type Container,
  type ContainerDeclarativeUpdatePolicy,
  type ContainerGroupPolicyActions,
  type ContainerGroupPolicySnapshot,
  containerDeclarativeUpdatePolicySchema,
  containerGroupPolicyActionsSchema,
} from './container.js';
import { normalizeMaturityMode, parseMaturityMinAgeDays } from './maturity-policy.js';

export type GroupPolicyUpdatePolicy = ContainerDeclarativeUpdatePolicy;
export type GroupPolicyActions = ContainerGroupPolicyActions;

export interface GroupPolicy {
  id: string;
  /** The exact group name, matched without trimming or case folding. */
  group: string;
  revision: number;
  updatePolicy: GroupPolicyUpdatePolicy;
  actions: GroupPolicyActions;
  createdAt: string;
  /** Principal: `user:<name>` or `api-key:<keyId>`. */
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface GroupPolicyBody {
  updatePolicy: GroupPolicyUpdatePolicy;
  actions: GroupPolicyActions;
}

/** A policy body that failed validation. The message is safe to return to a client. */
export class GroupPolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupPolicyValidationError';
  }
}

/**
 * A policy name is a non-empty string that is not only whitespace, the same rule as a
 * notification `GROUP`. So a container whose `dd.group` is `""` can never match a policy,
 * which is the documented per-container opt-out from a Compose project's policy.
 */
export function isValidGroupPolicyName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSkipList(values: unknown): string[] | undefined {
  const list = uniqStrings(values, { trim: true, removeEmpty: true });
  return list.length > 0 ? list : undefined;
}

/**
 * Validate a group's update-policy body against the container's declarative layer schema
 * and normalize it. An empty skip list is dropped: the only layer below a group is the
 * watcher env layer, which has no skip lists, so an empty one could not mean anything.
 * `maturityMode: 'all'` is kept because it deliberately shadows a watcher `mature` default.
 */
export function normalizeGroupPolicyUpdatePolicy(input: unknown): GroupPolicyUpdatePolicy {
  if (input === undefined) {
    return {};
  }
  const { error, value } = containerDeclarativeUpdatePolicySchema.validate(input, {
    convert: false,
  });
  if (error) {
    throw new GroupPolicyValidationError(`Invalid group update policy: ${error.message}`);
  }
  const normalized: GroupPolicyUpdatePolicy = {};
  const maturityMode = normalizeMaturityMode(value.maturityMode);
  if (maturityMode) {
    normalized.maturityMode = maturityMode;
  }
  const maturityMinAgeDays = parseMaturityMinAgeDays(value.maturityMinAgeDays);
  if (maturityMinAgeDays !== undefined) {
    normalized.maturityMinAgeDays = maturityMinAgeDays;
  }
  const skipTags = normalizeSkipList(value.skipTags);
  if (skipTags) {
    normalized.skipTags = skipTags;
  }
  const skipDigests = normalizeSkipList(value.skipDigests);
  if (skipDigests) {
    normalized.skipDigests = skipDigests;
  }
  return normalized;
}

const SUPPORTED_THRESHOLD_NAMES: readonly string[] = SUPPORTED_THRESHOLDS;

/**
 * An exclusion is one `dd.action.exclude` reference: a trigger id or name with an optional
 * `:threshold`. Runtime matching stays lenient (an unknown suffix reads as `all`), but a
 * stored rule must say what it means, so an entry that is empty, holds a comma or carries
 * a suffix outside the supported thresholds is refused.
 */
function assertValidExcludeEntry(entry: string): void {
  const parts = entry.split(':');
  const [name, threshold] = parts;
  const thresholdOk =
    parts.length === 1 ||
    (parts.length === 2 && SUPPORTED_THRESHOLD_NAMES.includes(threshold.trim().toLowerCase()));
  if (name.trim() === '' || entry.includes(',') || !thresholdOk) {
    throw new GroupPolicyValidationError(
      `Invalid group action rules: "${entry}" is not a trigger reference. Use a trigger id or name, optionally followed by :threshold`,
    );
  }
}

/**
 * Validate a group's action rules. A group can only restrict: `auto` is refused with its
 * own message rather than the generic one, since it is the value an operator is most
 * likely to try.
 */
export function normalizeGroupPolicyActions(input: unknown): GroupPolicyActions {
  if (input === undefined) {
    return {};
  }
  if ((input as { updateMode?: unknown } | null)?.updateMode === 'auto') {
    throw new GroupPolicyValidationError(
      'Group policies can only restrict updates: updateMode must be "manual" or "notify"',
    );
  }
  const { error, value } = containerGroupPolicyActionsSchema.validate(input, { convert: false });
  if (error) {
    throw new GroupPolicyValidationError(`Invalid group action rules: ${error.message}`);
  }
  for (const entry of value.exclude ?? []) {
    assertValidExcludeEntry(entry);
  }
  const normalized: GroupPolicyActions = {};
  if (value.updateMode) {
    normalized.updateMode = value.updateMode;
  }
  const exclude = normalizeSkipList(value.exclude);
  if (exclude) {
    normalized.exclude = exclude;
  }
  return normalized;
}

/** Normalize both parts of a policy and refuse one that sets nothing (that is a delete). */
export function normalizeGroupPolicyBody(input: {
  updatePolicy?: unknown;
  actions?: unknown;
}): GroupPolicyBody {
  const updatePolicy = normalizeGroupPolicyUpdatePolicy(input.updatePolicy);
  const actions = normalizeGroupPolicyActions(input.actions);
  if (Object.keys(updatePolicy).length === 0 && Object.keys(actions).length === 0) {
    throw new GroupPolicyValidationError('A group policy must set at least one field');
  }
  return { updatePolicy, actions };
}

/** The part of a policy a container write records alongside the layer it applied. */
export function toContainerGroupPolicySnapshot(policy: GroupPolicy): ContainerGroupPolicySnapshot {
  return {
    id: policy.id,
    group: policy.group,
    revision: policy.revision,
    updatePolicy: structuredClone(policy.updatePolicy),
    actions: structuredClone(policy.actions),
  };
}

const UPDATE_MODE_RANK: Record<UpdateMode, number> = { notify: 0, manual: 1, auto: 2 };

/** The more restrictive of two update modes, ordered `notify < manual < auto`. */
export function mostRestrictiveUpdateMode(a: UpdateMode, b: UpdateMode): UpdateMode {
  return UPDATE_MODE_RANK[a] <= UPDATE_MODE_RANK[b] ? a : b;
}

export interface UpdateModeCeiling {
  value: UpdateMode;
  /** `group` only when the group is strictly more restrictive. Otherwise global is what binds. */
  source: 'global' | 'group';
  group?: string;
  policyId?: string;
}

/**
 * The update mode that binds a container: the more restrictive of the global mode and its
 * group's `actions.updateMode`. A group can lower the mode but never raise it, so a group
 * `manual` under global `notify` stays `notify`. It reads the snapshot the container's last
 * store write recorded, so it agrees with what dispatch sees.
 */
export function resolveUpdateModeCeiling(
  container: Pick<Container, 'groupPolicy'>,
  globalMode: UpdateMode,
): UpdateModeCeiling {
  const policy = container.groupPolicy;
  const groupMode = policy?.actions.updateMode;
  if (!policy || !groupMode || UPDATE_MODE_RANK[groupMode] >= UPDATE_MODE_RANK[globalMode]) {
    return { value: globalMode, source: 'global' };
  }
  return { value: groupMode, source: 'group', group: policy.group, policyId: policy.id };
}

/** The client-facing reason an admission is refused because of a group's update mode. */
export function groupUpdateModeRejectionMessage(group: string, mode: 'manual' | 'notify'): string {
  return `Group policy '${group}' allows ${mode === 'manual' ? 'manual updates' : 'notifications'} only`;
}

/** The group's `dd.action.exclude`-grammar references, or none. */
export function getGroupExcludeEntries(container: Pick<Container, 'groupPolicy'>): string[] {
  return container.groupPolicy?.actions.exclude ?? [];
}
