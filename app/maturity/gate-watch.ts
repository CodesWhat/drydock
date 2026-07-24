import { redactContainerRuntimeEnv } from '../api/container/shared.js';
import { emitMaturityGateCleared } from '../event/index.js';
import type { Container } from '../model/container.js';
import { hasRawUpdate } from '../model/container.js';
import { resolveMaturityClock, resolveMaturityMinAgeDays } from '../model/maturity-policy.js';
import { clearMaturityGatePendingSince } from '../store/container.js';

function hasMaturityGatePendingSince(container: Container): boolean {
  return (
    typeof container.maturityGatePendingSince === 'string' &&
    container.maturityGatePendingSince.length > 0
  );
}

/**
 * Single choke point for the maturity-cleared notification. Reads the
 * persisted `maturityGatePendingSince` marker and, when the previously
 * maturity-suppressed update has become applicable (for any reason — the
 * clock elapsing, a policy change, an override, or a snooze expiring),
 * clears the marker in the store first (a synchronous op, so a concurrent
 * caller re-reading the container on the single-threaded event loop can
 * only ever observe the transition once) before awaiting the notification
 * emit.
 */
export async function maybeEmitMaturityGateCleared(container: Container): Promise<boolean> {
  if (!hasMaturityGatePendingSince(container)) {
    return false;
  }

  if (!hasRawUpdate(container)) {
    clearMaturityGatePendingSince(container.id);
    return false;
  }

  if (!container.updateAvailable) {
    return false;
  }

  const pendingSince = container.maturityGatePendingSince;
  const clock = resolveMaturityClock(container);
  const minAgeDays = resolveMaturityMinAgeDays(container.updatePolicy?.maturityMinAgeDays);

  if (!clearMaturityGatePendingSince(container.id)) {
    return false;
  }
  await emitMaturityGateCleared({
    container: redactContainerRuntimeEnv({ ...container }),
    clearedAt: new Date().toISOString(),
    pendingSince,
    minAgeDays,
    ...(clock.source ? { clockSource: clock.source } : {}),
  });
  return true;
}
