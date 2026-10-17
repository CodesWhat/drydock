import type { Root } from 'joi';
import { sanitizeLogParam } from '../../../log/sanitize.js';
import type {
  Container,
  ContainerDeclarativeUpdatePolicy,
  ContainerUpdatePolicyDeclarative,
} from '../../../model/container.js';
import {
  MATURITY_MIN_AGE_DAYS_MAX,
  MATURITY_MIN_AGE_DAYS_MIN,
  MATURITY_RELEASE_FALLBACK_DAYS_MAX,
  MATURITY_SKIP_RELEASES_MAX,
  normalizeMaturityMode,
  parseMaturityMinAgeDays,
  parseMaturityReleaseFallbackDays,
  parseMaturitySkipReleases,
} from '../../../model/maturity-policy.js';
import { applyDeclarativeUpdatePolicy } from '../../../model/update-policy.js';
import {
  ddUpdatePolicyMaturityMinAgeDays,
  ddUpdatePolicyMaturityMode,
  ddUpdatePolicyMaturityReleaseFallbackDays,
  ddUpdatePolicyMaturitySkipReleases,
  ddUpdatePolicySkipDigests,
  ddUpdatePolicySkipTags,
} from './label.js';

interface DockerMaturityDefaults {
  maturitymode?: unknown;
  maturityminagedays?: unknown;
  maturityskipreleases?: unknown;
  maturityreleasefallbackdays?: unknown;
}

export function getDockerMaturityConfigurationSchema(joi: Root) {
  return {
    maturitymode: joi.string().valid('all', 'mature'),
    maturityminagedays: joi
      .number()
      .integer()
      .min(MATURITY_MIN_AGE_DAYS_MIN)
      .max(MATURITY_MIN_AGE_DAYS_MAX),
    maturityskipreleases: joi.number().integer().min(0).max(MATURITY_SKIP_RELEASES_MAX),
    maturityreleasefallbackdays: joi
      .number()
      .integer()
      .min(0)
      .max(MATURITY_RELEASE_FALLBACK_DAYS_MAX),
  };
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
      ? `Container "${sanitizeLogParam(options.containerName)}" has`
      : 'Container has';
    options.logger?.warn(
      `${containerContext} invalid ${ddUpdatePolicyMaturityMode} value "${sanitizeLogParam(rawLabelMode)}"; expected "all" or "mature". Ignoring label.`,
    );
  }
  if (envMode) env.maturityMode = envMode;
  if (envDays !== undefined) env.maturityMinAgeDays = envDays;
  if (labelMode) label.maturityMode = labelMode;
  if (labelDays !== undefined) label.maturityMinAgeDays = labelDays;
  const envSkipReleases = parseMaturitySkipReleases(defaults.maturityskipreleases);
  const envFallbackDays = parseMaturityReleaseFallbackDays(defaults.maturityreleasefallbackdays);
  const labelSkipReleases = parseMaturitySkipReleases(labels[ddUpdatePolicyMaturitySkipReleases]);
  const labelFallbackDays = parseMaturityReleaseFallbackDays(
    labels[ddUpdatePolicyMaturityReleaseFallbackDays],
  );
  if (envSkipReleases !== undefined) env.maturitySkipReleases = envSkipReleases;
  if (envFallbackDays !== undefined) env.maturityReleaseFallbackDays = envFallbackDays;
  if (labelSkipReleases !== undefined) label.maturitySkipReleases = labelSkipReleases;
  if (labelFallbackDays !== undefined) label.maturityReleaseFallbackDays = labelFallbackDays;
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
