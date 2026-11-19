/**
 * Raises an `agent-version-mismatch` alert when an agent connects on a different version
 * than this controller.
 *
 * Versions compare by their base release, so `1.9.0-rc.2` and `1.9.0` match. A major or
 * minor difference alerts; a patch-only difference alerts only when
 * `DD_ALERTS_AGENTVERSIONPATCH=true`. Each agent alerts once per mismatching version: the
 * state is cleared when the agent next connects on a matching version, and an agent that
 * reconnects on the same wrong version stays quiet. A version that is not valid semver
 * (`unknown`, `local`) cannot be compared, so it neither alerts nor clears.
 */
import semver from 'semver';
import { getNotificationAlertsConfiguration, getVersion } from '../configuration/index.js';
import { deriveVersionIdentity } from '../configuration/version-identity.js';
import { type AgentVersionMismatchEventPayload, emitAgentVersionMismatch } from '../event/index.js';
import log from '../log/index.js';
import { getErrorMessage } from '../util/error.js';

const alertLog = log.child({ component: 'agent-version-alerts' });

/** Agent name -> the mismatching version already alerted on. */
const alertedVersions = new Map<string, string>();

function toBaseVersion(version: string | undefined): string | undefined {
  if (typeof version !== 'string') {
    return undefined;
  }
  const base = deriveVersionIdentity(version.trim()).version;
  return semver.valid(base) ?? undefined;
}

function shouldAlertOnPatch(): boolean {
  try {
    return getNotificationAlertsConfiguration().agentversionpatch;
  } catch {
    return false;
  }
}

/**
 * Compare an agent's reported version with the controller's and alert or clear.
 * @returns what happened, for tests and logs
 */
export function checkAgentVersion(
  agentName: string,
  agentVersion: string | undefined,
  controllerVersion: string = getVersion(),
): 'alerted' | 'cleared' | 'unchanged' | 'skipped' {
  const agentBase = toBaseVersion(agentVersion);
  const controllerBase = toBaseVersion(controllerVersion);
  if (!agentBase || !controllerBase) {
    return 'skipped';
  }

  const difference = semver.diff(agentBase, controllerBase);
  const mismatched =
    difference === 'major' ||
    difference === 'minor' ||
    (difference === 'patch' && shouldAlertOnPatch());
  if (!mismatched) {
    return alertedVersions.delete(agentName) ? 'cleared' : 'unchanged';
  }

  if (alertedVersions.get(agentName) === agentBase) {
    return 'unchanged';
  }
  alertedVersions.set(agentName, agentBase);

  const payload: AgentVersionMismatchEventPayload = {
    agentName,
    agentVersion: agentBase,
    controllerVersion: controllerBase,
    difference,
  };
  void emitAgentVersionMismatch(payload).catch((error: unknown) => {
    alertLog.debug(`Failed to emit agent version mismatch (${getErrorMessage(error)})`);
  });
  return 'alerted';
}

export function resetAgentVersionAlertsForTests(): void {
  alertedVersions.clear();
}
