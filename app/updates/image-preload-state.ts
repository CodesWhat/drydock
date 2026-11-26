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
export type ImagePreloadView = Omit<ImagePreloadState, 'host' | 'candidate'>;

export function getImagePreloadView(container: Container): ImagePreloadView | undefined {
  const state = getImagePreload(container);
  if (!state) {
    return undefined;
  }
  const { host: _host, candidate: _candidate, ...view } = state;
  return view;
}

/**
 * Image references a host holds because of a preload, with the containers that own each. A
 * reference outlives its owner's status entry when the candidate moves on and the image could
 * not be removed yet, so the per-host cap counts these distinct references, not entries.
 */
const retained = new Map<string, Map<string, Set<string>>>();

export function retainImagePreload(host: string, image: string, container: Container): void {
  let refs = retained.get(host);
  if (!refs) {
    refs = new Map();
    retained.set(host, refs);
  }
  let owners = refs.get(image);
  if (!owners) {
    owners = new Set();
    refs.set(image, owners);
  }
  owners.add(keyOf(container));
}

/**
 * Drop a container's claim on a retained reference. Returns true only when that was the last
 * claim, meaning the image is now unowned and the caller may remove it from the host.
 */
export function releaseImagePreload(host: string, image: string, container: Container): boolean {
  const refs = retained.get(host);
  const owners = refs?.get(image);
  if (!refs || !owners?.delete(keyOf(container))) {
    return false;
  }
  if (owners.size > 0) {
    return false;
  }
  refs.delete(image);
  if (refs.size === 0) {
    retained.delete(host);
  }
  return true;
}

export function hasRetainedImagePreload(host: string, image: string): boolean {
  return retained.get(host)?.has(image) === true;
}

/** Distinct preload image references held on a host. */
export function countRetainedImagePreloads(host: string): number {
  return retained.get(host)?.size ?? 0;
}

export function resetImagePreloads(): void {
  states.clear();
  retained.clear();
}
