import type { Container } from '../types/container';

/**
 * Hide Pinned is a decluttering filter for static pinned containers the user
 * doesn't expect to rotate (databases, infra services pinned to specific
 * versions). It should NOT hide a pinned container that has a pending update,
 * because that update is exactly the signal the user is watching for — pinning
 * to `12.3.2` to wait out a regression is common, and the point is to notice
 * when `12.3.3` ships. See #293.
 */
export function matchesHidePinnedFilter(container: Container, hidePinned: boolean): boolean {
  if (!hidePinned) {
    return true;
  }
  if (container.tagPinned !== true) {
    return true;
  }
  return Boolean(container.newTag);
}

export function filterContainersByHidePinned(
  containers: readonly Container[],
  hidePinned: boolean,
): Container[] {
  return containers.filter((container) => matchesHidePinnedFilter(container, hidePinned));
}
