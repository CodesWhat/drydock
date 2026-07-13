import type {
  Container,
  ContainerDeclarativeUpdatePolicy,
  ContainerUpdatePolicyDeclarative,
} from '../../../model/container.js';
import { normalizeMaturityMode, parseMaturityMinAgeDays } from '../../../model/maturity-policy.js';
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

export interface DockerUpdatePolicyResolutionOptions {
  logger?: { warn: (message: string) => void };
  containerName?: string;
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

export function resolveDockerDeclarativeUpdatePolicy(
  labels: Record<string, string>,
  defaults: DockerMaturityDefaults = {},
  options: DockerUpdatePolicyResolutionOptions = {},
): ContainerUpdatePolicyDeclarative {
  const env: ContainerDeclarativeUpdatePolicy = {};
  const label: ContainerDeclarativeUpdatePolicy = {};
  const envMode = normalizeMaturityMode(defaults.maturitymode);
  const envDays = parseMaturityMinAgeDays(defaults.maturityminagedays);
  const rawLabelMode = labels[ddUpdatePolicyMaturityMode];
  const labelMode = normalizeMaturityMode(rawLabelMode);
  const labelDays = parseMaturityMinAgeDays(labels[ddUpdatePolicyMaturityMinAgeDays]);
  if (typeof rawLabelMode === 'string' && rawLabelMode.trim() !== '' && !labelMode) {
    const containerContext = options.containerName
      ? `Container "${options.containerName}" has`
      : 'Container has';
    options.logger?.warn(
      `${containerContext} invalid ${ddUpdatePolicyMaturityMode} value "${rawLabelMode}"; expected "all" or "mature". Ignoring label.`,
    );
  }
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
  options: DockerUpdatePolicyResolutionOptions = {},
) {
  return applyDeclarativeUpdatePolicy(
    container,
    resolveDockerDeclarativeUpdatePolicy(labels, defaults, options),
  );
}
