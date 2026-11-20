import joi from 'joi';
import cron from 'node-cron';
import { ddEnvVars, get } from '../configuration/index.js';
import type { CleanupPolicy } from './types.js';

const DEFAULT_CHECK_CRON = '*/15 * * * *';
const DEFAULT_PROTECT_HOURS = 168;

const cronExpression = joi
  .string()
  .allow('')
  .custom((value: string, helpers) =>
    value === '' || cron.validate(value) ? value : helpers.error('any.invalid'),
  );

const policySchema = joi.object().keys({
  cron: cronExpression.default(''),
  checkcron: cronExpression.default(DEFAULT_CHECK_CRON),
  thresholdbytes: joi.number().integer().min(1),
  hosts: joi.string().allow('').default(''),
  danglingimages: joi.boolean().default(false),
  unusedimages: joi.boolean().default(false),
  unusedimagesolderthanhours: joi.number().integer().min(0).default(0),
  stoppedcontainers: joi.boolean().default(false),
  networks: joi.boolean().default(false),
  buildcache: joi.boolean().default(false),
  volumes: joi.boolean().default(false),
  volumesconfirm: joi.boolean().default(false),
  protecthours: joi.number().integer().min(0).default(DEFAULT_PROTECT_HOURS),
  dryrun: joi.boolean().default(false),
});

function toPolicy(name: string, rawConfiguration: unknown): CleanupPolicy {
  const validated = policySchema.validate(rawConfiguration);
  if (validated.error) {
    throw new Error(
      `Invalid DD_CLEANUP_${name.toUpperCase()}_* configuration: ${validated.error.message}`,
    );
  }
  const value = validated.value;
  const label = `DD_CLEANUP_${name.toUpperCase()}`;

  if (value.volumes && !value.volumesconfirm) {
    throw new Error(
      `${label}_VOLUMES=true also requires ${label}_VOLUMESCONFIRM=true. Volume cleanup can delete data.`,
    );
  }
  if (!value.cron && value.thresholdbytes === undefined) {
    throw new Error(`${label} needs ${label}_CRON, ${label}_THRESHOLDBYTES or both`);
  }

  const policy: CleanupPolicy = {
    name,
    cron: value.cron,
    checkCron: value.checkcron,
    hosts: String(value.hosts)
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0),
    types: {
      danglingImages: value.danglingimages,
      unusedImages: value.unusedimages,
      stoppedContainers: value.stoppedcontainers,
      networks: value.networks,
      buildCache: value.buildcache,
      volumes: value.volumes,
    },
    unusedImagesOlderThanHours: value.unusedimagesolderthanhours,
    protectHours: value.protecthours,
    dryRun: value.dryrun,
  };
  if (value.thresholdbytes !== undefined) {
    policy.thresholdBytes = value.thresholdbytes;
  }
  if (!Object.values(policy.types).some(Boolean)) {
    throw new Error(`${label} enables no prune type`);
  }
  return policy;
}

/**
 * Cleanup policies from `DD_CLEANUP_<POLICY>_*`. Option names are single
 * lowercase words because an underscore in an env name nests a level.
 */
export function getCleanupPolicies(): CleanupPolicy[] {
  const configurations = get('dd.cleanup', ddEnvVars) as Record<string, unknown>;
  return Object.entries(configurations).map(([name, raw]) => toPolicy(name, raw));
}
