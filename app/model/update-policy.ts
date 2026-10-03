import type {
  Container,
  ContainerDeclarativeUpdatePolicy,
  ContainerGroupPolicySnapshot,
  ContainerUpdatePolicy,
  ContainerUpdatePolicyDeclarative,
  ContainerUpdatePolicySource,
  ContainerUpdatePolicySources,
} from './container.js';

export const DECLARATIVE_UPDATE_POLICY_FIELDS = [
  'maturityMode',
  'maturityMinAgeDays',
  'skipTags',
  'skipDigests',
] as const;

export type DeclarativeUpdatePolicyField = (typeof DECLARATIVE_UPDATE_POLICY_FIELDS)[number];

function clonePolicyValue(value: unknown) {
  return Array.isArray(value) ? [...value] : value;
}

function copyDeclarativeFields(
  target: ContainerUpdatePolicy,
  sources: ContainerUpdatePolicySources,
  policy: ContainerDeclarativeUpdatePolicy | undefined,
  source: ContainerUpdatePolicySource,
) {
  for (const field of DECLARATIVE_UPDATE_POLICY_FIELDS) {
    if (policy && Object.hasOwn(policy, field)) {
      (target as Record<string, unknown>)[field] = clonePolicyValue(policy[field]);
      sources[field] = source;
    }
  }
}

/**
 * Resolve each field from the last layer that sets it: env, group, label, then override.
 * The group layer is optional so callers that never see a group policy are unchanged; only
 * the store passes one (see `applyGroupUpdatePolicyLayer`).
 */
export function resolveUpdatePolicyLayers(
  declarative: ContainerUpdatePolicyDeclarative,
  overrides: ContainerUpdatePolicy = {},
  group?: ContainerDeclarativeUpdatePolicy,
) {
  const updatePolicy: ContainerUpdatePolicy = {};
  const sources: ContainerUpdatePolicySources = {};
  copyDeclarativeFields(updatePolicy, sources, declarative.env, 'env');
  copyDeclarativeFields(updatePolicy, sources, group, 'group');
  copyDeclarativeFields(updatePolicy, sources, declarative.label, 'label');
  copyDeclarativeFields(updatePolicy, sources, overrides, 'override');
  if (Object.hasOwn(overrides, 'snoozeUntil')) {
    updatePolicy.snoozeUntil = overrides.snoozeUntil;
  }
  return {
    updatePolicy: Object.keys(updatePolicy).length > 0 ? updatePolicy : undefined,
    updatePolicySources: sources,
  };
}

export function getUpdatePolicyOverrides(container: Container): ContainerUpdatePolicy {
  if (container.updatePolicyOverrides !== undefined) {
    return structuredClone(container.updatePolicyOverrides);
  }
  if (container.updatePolicyDeclarative !== undefined || !container.updatePolicy) {
    return {};
  }
  return structuredClone(container.updatePolicy);
}

export function applyDeclarativeUpdatePolicy(
  container: Container,
  declarative: ContainerUpdatePolicyDeclarative,
) {
  const overrides = getUpdatePolicyOverrides(container);
  const resolved = resolveUpdatePolicyLayers(declarative, overrides);
  container.updatePolicy = resolved.updatePolicy;
  container.updatePolicyDeclarative = structuredClone(declarative);
  container.updatePolicyOverrides = overrides;
  container.updatePolicySources = resolved.updatePolicySources;
  return container;
}

export function applyUpdatePolicyOverrides(container: Container, overrides: ContainerUpdatePolicy) {
  const declarative = container.updatePolicyDeclarative ?? { env: {}, label: {} };
  const resolved = resolveUpdatePolicyLayers(declarative, overrides);
  container.updatePolicy = resolved.updatePolicy;
  container.updatePolicyDeclarative = structuredClone(declarative);
  container.updatePolicyOverrides = structuredClone(overrides);
  container.updatePolicySources = resolved.updatePolicySources;
  return container;
}

/**
 * Re-resolve a container's effective policy with `groupPolicy`'s layer, or with none, and
 * record the snapshot it used. The store calls this as the last step before validating a
 * write, and nothing else does.
 *
 * Overrides are read before the declarative layer is filled in. A legacy record has no
 * declarative layer, so `getUpdatePolicyOverrides` reads its whole flat policy as the
 * override layer; once this record carries a declarative layer and its own overrides, the
 * group values merged into `updatePolicy` can never be read back as overrides, which
 * would otherwise freeze them onto the container after the policy changed or went away.
 */
export function applyGroupUpdatePolicyLayer(
  container: Container,
  groupPolicy: ContainerGroupPolicySnapshot | undefined,
) {
  const overrides = getUpdatePolicyOverrides(container);
  const declarative = container.updatePolicyDeclarative ?? { env: {}, label: {} };
  const resolved = resolveUpdatePolicyLayers(declarative, overrides, groupPolicy?.updatePolicy);
  container.updatePolicy = resolved.updatePolicy;
  container.updatePolicyDeclarative = structuredClone(declarative);
  container.updatePolicyOverrides = overrides;
  container.updatePolicySources = resolved.updatePolicySources;
  if (groupPolicy) {
    container.groupPolicy = structuredClone(groupPolicy);
  } else {
    delete container.groupPolicy;
  }
  return container;
}
