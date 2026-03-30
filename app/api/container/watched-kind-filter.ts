import type { Container } from '../../model/container.js';

export type ContainerWatchedKind = 'watched' | 'unwatched' | 'all';

export function isContainerWatchedKind(value: unknown): value is ContainerWatchedKind {
  return value === 'watched' || value === 'unwatched' || value === 'all';
}

function isContainerExplicitlyWatched(container: Container): boolean {
  const labels = container.labels;
  if (!labels || typeof labels !== 'object') {
    return false;
  }
  const watchLabel = labels['dd.watch'] ?? labels['wud.watch'];
  return typeof watchLabel === 'string' && watchLabel.toLowerCase() === 'true';
}

export function applyContainerWatchedKindFilter(
  containers: Container[],
  kindFilter: ContainerWatchedKind | undefined,
): Container[] {
  if (!kindFilter || kindFilter === 'all') {
    return containers;
  }
  if (kindFilter === 'watched') {
    return containers.filter((container) => isContainerExplicitlyWatched(container));
  }
  return containers.filter((container) => !isContainerExplicitlyWatched(container));
}
