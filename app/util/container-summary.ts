interface ContainerStatusLike {
  status?: unknown;
}

interface ContainerStatusSummary {
  total: number;
  running: number;
  stopped: number;
}

export function isContainerRunning(container: ContainerStatusLike): boolean {
  return String(container.status ?? '').toLowerCase() === 'running';
}

export function getContainerStatusSummary(
  containers: ContainerStatusLike[],
): ContainerStatusSummary {
  const total = containers.length;
  const running = containers.filter((container) => isContainerRunning(container)).length;
  return {
    total,
    running,
    stopped: Math.max(total - running, 0),
  };
}
