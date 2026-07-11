import { getErrorMessage } from '../../../util/error.js';

/**
 * Shared "orphaned replacement container" channel for the Docker (non-compose)
 * recreate path. `Docker.createContainer` creates the replacement container and
 * then connects it to any additional networks; if a network connect fails after
 * the container was created, the handle would otherwise be lost to the caller,
 * leaving the orphan squatting the canonical container name with no way to clean
 * it up. `attachCreatedContainerCandidate` stashes the handle on the thrown error
 * so any consumer up the call stack can recover it via `getCreatedContainerCandidate`
 * and best-effort clean it up before proceeding with rollback/rename.
 *
 * Field name is intentionally distinct from Dockercompose's own
 * `composeCreatedContainerCandidate` channel so the two mechanisms can never be
 * confused with one another.
 */
type CreatedContainerCandidateError = Error & {
  createdContainerCandidate?: unknown;
};

export function attachCreatedContainerCandidate(error: unknown, candidateContainer: unknown): void {
  if (!candidateContainer || !error || typeof error !== 'object') {
    return;
  }
  (error as CreatedContainerCandidateError).createdContainerCandidate = candidateContainer;
}

export function getCreatedContainerCandidate<T = unknown>(error: unknown): T | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  return (error as CreatedContainerCandidateError).createdContainerCandidate as T | undefined;
}

/**
 * Best-effort stop + force-remove of an orphaned replacement container. Tolerant
 * of missing methods and of stop/remove failures — cleanup failures are logged
 * as warnings but never block the caller's rollback from proceeding.
 */
export async function cleanupCreatedContainerCandidate(
  candidateContainer: unknown,
  containerName: string,
  logContainer: { warn: (message: string) => void },
): Promise<void> {
  if (!candidateContainer || typeof candidateContainer !== 'object') {
    return;
  }
  const candidate = candidateContainer as {
    stop?: () => Promise<unknown>;
    remove?: (options?: unknown) => Promise<unknown>;
  };

  if (typeof candidate.stop === 'function') {
    try {
      await candidate.stop();
    } catch (stopError: unknown) {
      logContainer.warn(
        `Unable to stop orphaned replacement container ${containerName} (${getErrorMessage(stopError)})`,
      );
    }
  }

  if (typeof candidate.remove === 'function') {
    try {
      await candidate.remove({ force: true });
    } catch (removeError: unknown) {
      logContainer.warn(
        `Unable to remove orphaned replacement container ${containerName} (${getErrorMessage(removeError)})`,
      );
    }
  }
}
