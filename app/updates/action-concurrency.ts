import { parseEnvNonNegativeInteger } from '../util/parse.js';

/**
 * Default action concurrency when neither DD_UPDATE_CONCURRENCY nor a
 * per-action `concurrency` override is set. 1 keeps the historical
 * one-at-a-time semantics for anyone who never opts in, since the value
 * feeds a real concurrency cap (unlike DD_UPDATE_MAX_CONCURRENT in
 * update-locks.ts, which guards a separate, unrelated self-update
 * exclusivity gate and defaults to unlimited).
 */
const DEFAULT_UPDATE_CONCURRENCY = 1;

/**
 * Parse a concurrency env var as a required-positive integer.
 *
 * Reuses parseEnvNonNegativeInteger's format/overflow checks, then rejects 0
 * on top: unlike DD_UPDATE_MAX_CONCURRENT, this value feeds a real fan-out
 * limiter, so "0 means unlimited" would be a footgun for large fleets.
 * Operators who want no cap leave the variable unset instead.
 *
 * Returns `undefined` when the variable is absent or empty, so callers can
 * fall back to a default. Throws a descriptive Error for invalid values so
 * the process fails fast at startup rather than silently ignoring operator
 * intent.
 */
export function parseUpdateConcurrencyEnv(
  rawValue: string | undefined,
  envName: string,
): number | undefined {
  const parsed = parseEnvNonNegativeInteger(rawValue, envName);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed === 0) {
    throw new Error(`${envName} must be a positive integer (got "${rawValue}")`);
  }
  return parsed;
}

const globalUpdateConcurrency =
  parseUpdateConcurrencyEnv(process.env.DD_UPDATE_CONCURRENCY, 'DD_UPDATE_CONCURRENCY') ??
  DEFAULT_UPDATE_CONCURRENCY;

/**
 * The fleet-wide default action concurrency, from DD_UPDATE_CONCURRENCY
 * (default 1). Read once at module load, matching the fail-fast-at-startup
 * convention DD_UPDATE_MAX_CONCURRENT already uses in update-locks.ts.
 */
export function getGlobalUpdateConcurrency(): number {
  return globalUpdateConcurrency;
}

/**
 * Configuration shape every action-type trigger (docker, dockercompose,
 * command) exposes a `concurrency` key on, via its own Joi schema. Kept
 * minimal here so this module has no dependency on any one provider's
 * configuration type.
 */
export interface ActionConcurrencyConfiguration {
  concurrency?: number;
}

/**
 * Resolve the concurrency an action instance should run its update work at:
 * its own DD_ACTION_<TYPE>_<NAME>_CONCURRENCY override when set (parsed and
 * validated as a positive integer by the action's Joi configuration schema),
 * else the DD_UPDATE_CONCURRENCY global default.
 */
export function resolveActionConcurrency(configuration: ActionConcurrencyConfiguration): number {
  return configuration.concurrency ?? globalUpdateConcurrency;
}
