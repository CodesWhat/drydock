import type { Container } from './container.js';

interface MaintenanceWindowWatcher {
  configuration?: {
    maintenancewindowopen?: unknown;
  };
  isMaintenanceWindowOpen?: () => boolean;
}

/**
 * Resolve the live maintenance-window state exposed by a container's owning watcher.
 * Missing watcher state intentionally returns undefined so eligibility remains fail-open.
 */
export function getContainerMaintenanceWindowOpen(
  container: Pick<Container, 'agent' | 'watcher'>,
  watchers: Readonly<Record<string, unknown>> | undefined,
): boolean | undefined {
  const watcherName = typeof container.watcher === 'string' ? container.watcher.trim() : '';
  if (!watcherName) {
    return undefined;
  }

  const agentName = typeof container.agent === 'string' ? container.agent.trim() : '';
  const watcherId = `${agentName ? `${agentName}.` : ''}docker.${watcherName}`;
  const watcher = watchers?.[watcherId] as MaintenanceWindowWatcher | undefined;
  if (typeof watcher?.isMaintenanceWindowOpen === 'function') {
    return watcher.isMaintenanceWindowOpen();
  }

  const maskedState = watcher?.configuration?.maintenancewindowopen;
  return typeof maskedState === 'boolean' ? maskedState : undefined;
}
