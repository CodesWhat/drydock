import type { Container } from '../types/container';

export function matchesHidePinnedFilter(container: Container, hidePinned: boolean): boolean {
  return !hidePinned || container.tagPrecision !== 'specific';
}

export function filterContainersByHidePinned(
  containers: readonly Container[],
  hidePinned: boolean,
): Container[] {
  return containers.filter((container) => matchesHidePinnedFilter(container, hidePinned));
}
