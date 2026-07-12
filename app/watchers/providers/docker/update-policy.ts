import type {
  Container,
  ContainerDeclarativeUpdatePolicy,
  ContainerUpdatePolicyDeclarative,
} from '../../../model/container.js';
import { parseMaturityMinAgeDays } from '../../../model/maturity-policy.js';
import { applyDeclarativeUpdatePolicy } from '../../../model/update-policy.js';
import {
  ddUpdatePolicyMaturityMinAgeDays,
  ddUpdatePolicyMaturityMode,
  ddUpdatePolicySkipDigests,
  ddUpdatePolicySkipTags,
} from './label.js';

interface DockerMaturityDefaults {
  maturitymode?: unknown;
  maturityminagedays?: unknown;
}

function csv(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const entries = [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  return entries.length > 0 ? entries : undefined;
}

function maturityMode(value: unknown) {
  return value === 'all' || value === 'mature' ? value : undefined;
}

export function resolveDockerDeclarativeUpdatePolicy(
  labels: Record<string, string>,
  defaults: DockerMaturityDefaults = {},
): ContainerUpdatePolicyDeclarative {
  const env: ContainerDeclarativeUpdatePolicy = {};
  const label: ContainerDeclarativeUpdatePolicy = {};
  const envMode = maturityMode(defaults.maturitymode);
  const envDays = parseMaturityMinAgeDays(defaults.maturityminagedays);
  const labelMode = maturityMode(labels[ddUpdatePolicyMaturityMode]);
  const labelDays = parseMaturityMinAgeDays(labels[ddUpdatePolicyMaturityMinAgeDays]);
  if (envMode) env.maturityMode = envMode;
  if (envDays !== undefined) env.maturityMinAgeDays = envDays;
  if (labelMode) label.maturityMode = labelMode;
  if (labelDays !== undefined) label.maturityMinAgeDays = labelDays;
  const skipTags = csv(labels[ddUpdatePolicySkipTags]);
  const skipDigests = csv(labels[ddUpdatePolicySkipDigests]);
  if (skipTags) label.skipTags = skipTags;
  if (skipDigests) label.skipDigests = skipDigests;
  return { env, label };
}

export function applyDockerDeclarativeUpdatePolicy(
  container: Container,
  labels: Record<string, string>,
  defaults: DockerMaturityDefaults = {},
) {
  return applyDeclarativeUpdatePolicy(
    container,
    resolveDockerDeclarativeUpdatePolicy(labels, defaults),
  );
}
