export function usesControllerDockerTransport(type: unknown, configuration: unknown): boolean {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    return false;
  }
  const marker = configuration as Record<string, unknown>;
  return (
    type === 'docker' &&
    marker.transport === 'docker-api' &&
    marker.execution === 'controller' &&
    marker.events === 'portwing'
  );
}
