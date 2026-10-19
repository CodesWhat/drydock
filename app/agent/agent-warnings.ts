import semver from 'semver';

export type AgentWarning = 'hook-labels-trusted';

// Agents older than 1.7.0-rc.20 still run lifecycle hook labels baked into an
// image (GHSA-prfp-h8qf-63jg), whatever the controller version is.
const HOOK_LABEL_FIX_VERSION = '1.7.0-rc.20';

export function agentTrustsImageHookLabels(
  info: { version?: string; build?: string } | undefined,
): boolean {
  const reported = info?.build ?? info?.version;
  if (!reported || !semver.valid(reported)) {
    return false;
  }
  return semver.lt(reported, HOOK_LABEL_FIX_VERSION);
}

export function getAgentWarnings(
  info: { version?: string; build?: string } | undefined,
): AgentWarning[] {
  return agentTrustsImageHookLabels(info) ? ['hook-labels-trusted'] : [];
}
