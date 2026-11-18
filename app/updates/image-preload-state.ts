import type { Container } from '../model/container.js';

type ImagePreloadStatus = 'pending' | 'done' | 'failed';

/** What the API reports for a container. Absent means no preload (status "none"). */
export interface ImagePreloadState {
  status: ImagePreloadStatus;
  /** Candidate image reference that was (or is being) pulled. */
  image: string;
  /** Immutable digest the candidate was pinned to, when the registry reported one. */
  digest?: string;
  /** The candidate identity (digest, else tag) the entry was recorded against. */
  candidate: string;
  /** Docker host (watcher) the image was pulled onto. Used to bound disk use per host. */
  host: string;
  updatedAt: string;
  error?: string;
}

const states = new Map<string, ImagePreloadState>();

function keyOf(container: Pick<Container, 'id' | 'identityKey'>) {
  return container.identityKey ?? container.id;
}

/** Candidate identity of a container: the digest when known, else the tag. */
export function getPreloadCandidate(container: Container): string | undefined {
  return container.result?.digest ?? container.result?.tag;
}

export function setImagePreload(
  container: Container,
  state: Omit<ImagePreloadState, 'updatedAt'>,
): void {
  states.set(keyOf(container), { ...state, updatedAt: new Date().toISOString() });
}

export function clearImagePreload(container: Container): void {
  states.delete(keyOf(container));
}

/** Raw recorded state, including entries that no longer match the candidate. */
export function peekImagePreload(container: Container): ImagePreloadState | undefined {
  return states.get(keyOf(container));
}

/**
 * The preload state the API exposes. An entry recorded for a candidate that is no longer the
 * container's current candidate is stale and reads as none, so a changed candidate is never
 * reported as preloaded.
 */
export function getImagePreload(container: Container): ImagePreloadState | undefined {
  const state = states.get(keyOf(container));
  if (!state || state.candidate !== getPreloadCandidate(container)) {
    return undefined;
  }
  return state;
}

/** Public shape of {@link getImagePreload}: the internal host and candidate keys are not exposed. */
export function getImagePreloadView(
  container: Container,
): Omit<ImagePreloadState, 'host' | 'candidate'> | undefined {
  const state = getImagePreload(container);
  if (!state) {
    return undefined;
  }
  const { host: _host, candidate: _candidate, ...view } = state;
  return view;
}

/** Recorded preloads (pending or done) on a host, excluding the given container's own. */
export function countImagePreloads(host: string, except?: Container): number {
  const exceptKey = except ? keyOf(except) : undefined;
  let count = 0;
  for (const [key, state] of states) {
    if (key !== exceptKey && state.host === host && state.status !== 'failed') {
      count++;
    }
  }
  return count;
}

export function resetImagePreloads(): void {
  states.clear();
}
