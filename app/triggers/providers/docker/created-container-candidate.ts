import { getErrorMessage } from '../../../util/error.js';

const CLEANUP_OPERATION_TIMEOUT_MS = 10_000;

function withCleanupTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`operation timed out after ${CLEANUP_OPERATION_TIMEOUT_MS}ms`));
    }, CLEANUP_OPERATION_TIMEOUT_MS);

    operation.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/**
 * Shared "orphaned replacement container" channel for Docker recreate paths.
 * `Docker.createContainer` creates the replacement container and
 * then connects it to any additional networks; if a network connect fails after
 * the container was created, the handle would otherwise be lost to the caller,
 * leaving the orphan squatting the canonical container name with no way to clean
 * it up. `attachCreatedContainerCandidate` stashes the handle on the thrown error
 * so any consumer up the call stack can recover it via `getCreatedContainerCandidate`
 * and best-effort clean it up before proceeding with rollback/rename.
 *
 * Docker and Docker Compose consumers use the same channel so cleanup behavior
 * cannot diverge between recreate paths.
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
      await withCleanupTimeout(candidate.stop());
    } catch (stopError: unknown) {
      logContainer.warn(
        `Unable to stop orphaned replacement container ${containerName} (${getErrorMessage(stopError)})`,
      );
    }
  }

  if (typeof candidate.remove === 'function') {
    try {
      await withCleanupTimeout(candidate.remove({ force: true }));
    } catch (removeError: unknown) {
      logContainer.warn(
        `Unable to remove orphaned replacement container ${containerName} (${getErrorMessage(removeError)})`,
      );
    }
  }
}
