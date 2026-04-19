import type { Container } from '../types/container';

/**
 * Hide Pinned is a simple decluttering filter: when active, hide every
 * container whose tag is a specific/pinned version. A pinned container with a
 * pending update is still pinned — users who want to see it can uncheck the
 * filter. #293 briefly kept such rows visible, but that conflated "declutter"
 * with "surface actionable pins" and broke the filter for reporters combining
 * Hide Pinned with Has Update (#305).
 */
export function matchesHidePinnedFilter(container: Container, hidePinned: boolean): boolean {
  return !hidePinned || container.tagPinned !== true;
}

export function filterContainersByHidePinned(
  containers: readonly Container[],
  hidePinned: boolean,
): Container[] {
  return containers.filter((container) => matchesHidePinnedFilter(container, hidePinned));
}
