import { buildContainerLockKey } from '../../../updates/update-locks.js';

interface MonitoredContainerReference {
  name: string;
  watcher: string;
}

const activeMonitors = new Map<string, AbortController>();

/**
 * Track the monitor armed for a container so a later update or a manual
 * rollback can cancel it. A container has one live monitor: arming a new one
 * supersedes the old.
 */
export function registerRollbackMonitor(
  container: MonitoredContainerReference,
  controller: AbortController,
): void {
  const key = buildContainerLockKey(container);
  activeMonitors.get(key)?.abort();
  activeMonitors.set(key, controller);
}

/**
 * Cancel the monitor watching a container, if any. Returns whether one was
 * active. A rollback already running is not interrupted; it checks the same
 * signal once it holds the update lock and stands down if it was cancelled
 * while queued.
 */
export function cancelRollbackMonitor(container: MonitoredContainerReference): boolean {
  const key = buildContainerLockKey(container);
  const controller = activeMonitors.get(key);
  if (!controller) {
    return false;
  }
  activeMonitors.delete(key);
  controller.abort();
  return true;
}
