interface ContainerStatusLike {
  status?: unknown;
  updateAvailable?: boolean;
}

interface ContainerStatusSummary {
  total: number;
  running: number;
  stopped: number;
  updatesAvailable: number;
}

export function isContainerRunning(container: ContainerStatusLike): boolean {
  return String(container.status ?? '').toLowerCase() === 'running';
}

export function getContainerStatusSummary(
  containers: ContainerStatusLike[],
): ContainerStatusSummary {
  const total = containers.length;
  const running = containers.filter((container) => isContainerRunning(container)).length;
  const updatesAvailable = containers.filter(
    (container) => container.updateAvailable === true,
  ).length;
  return {
    total,
    running,
    stopped: Math.max(total - running, 0),
    updatesAvailable,
  };
}
