import log from '../../../log/index.js';
import * as storeContainer from '../../../store/container.js';

const rollbackStateLog = log.child({ component: 'rollback-state' });

interface RollbackCandidateSource {
  result?: { digest?: string; tag?: string };
}

interface StoredContainerReference {
  id?: string;
  name: string;
  watcher: string;
  agent?: string;
}

interface RecordUpdateRollbackOptions {
  /** The candidate the rollback undid, in the form the eligibility gate compares. */
  targetDigest: string;
  reason: string;
  lastError?: string;
}

/**
 * The candidate identity the "last update rolled back" gate compares against:
 * digest when the registry result has one, otherwise the tag. Same precedence
 * as the in-update rollback path and `computeUpdateEligibility`.
 */
export function getRollbackCandidateTarget(
  container: RollbackCandidateSource,
  fallback: string | undefined,
): string {
  return container.result?.digest ?? container.result?.tag ?? fallback ?? '';
}

function findStoredContainer(container: StoredContainerReference) {
  const byId = container.id ? storeContainer.getContainer(container.id) : undefined;
  if (byId) {
    return byId;
  }
  // The update recreated the container, so the id the update ran against may
  // no longer be the one the store holds. Name and watcher are stable.
  return storeContainer
    .getContainers({ name: container.name, watcher: container.watcher })
    .find((candidate) => (candidate.agent ?? undefined) === (container.agent ?? undefined));
}

/**
 * Persist `updateRollback` for a rollback that ran after the update had
 * already succeeded (health or liveness failure, or the manual rollback API).
 * Without it the "last update rolled back" gate has no input and the same bad
 * candidate is re-applied once the recently-applied suppression lapses. A
 * store failure is logged, never thrown: the rollback itself already worked.
 */
export function recordUpdateRollback(
  container: StoredContainerReference,
  options: RecordUpdateRollbackOptions,
): void {
  try {
    const stored = findStoredContainer(container);
    if (!stored) {
      rollbackStateLog.warn(
        `Cannot record rollback state for ${container.name}: container not found in the store`,
      );
      return;
    }
    storeContainer.updateContainer({
      ...stored,
      updateRollback: {
        recordedAt: new Date().toISOString(),
        targetDigest: options.targetDigest,
        reason: options.reason,
        lastError: options.lastError ?? '',
      },
    });
  } catch (error: unknown) {
    rollbackStateLog.warn(
      `Cannot record rollback state for ${container.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
