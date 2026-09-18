import type { Container } from './container.js';

export function getContainerGroup(container: Pick<Container, 'labels'>): string | null {
  return (
    container.labels?.['dd.group'] ??
    container.labels?.['com.docker.compose.project'] ??
    container.labels?.['com.docker.stack.namespace'] ??
    null
  );
}
