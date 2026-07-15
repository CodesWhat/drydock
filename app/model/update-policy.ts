import type {
  Container,
  ContainerDeclarativeUpdatePolicy,
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

export function resolveUpdatePolicyLayers(
  declarative: ContainerUpdatePolicyDeclarative,
  overrides: ContainerUpdatePolicy = {},
) {
  const updatePolicy: ContainerUpdatePolicy = {};
  const sources: ContainerUpdatePolicySources = {};
  copyDeclarativeFields(updatePolicy, sources, declarative.env, 'env');
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
