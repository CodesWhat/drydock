import fs from 'node:fs';
import type { Container } from '../../../model/container.js';
import * as registry from '../../../registry/index.js';

/**
 * Determines whether the Drydock self-update mechanism can operate for the
 * container's watcher.
 *
 * Returns:
 *   - `true`  — self-update can run (TCP host configured, or socket present on disk)
 *   - `false` — self-update cannot run (socket mode but no socket on disk)
 *   - `undefined` — unknown / fail-open (watcher not resolvable, not a docker watcher,
 *                   or insufficient information to decide)
 */
export function isSelfUpdateAvailable(container: Container): boolean | undefined {
  const watcherName = container.watcher;
  if (typeof watcherName !== 'string' || watcherName === '') {
    return undefined;
  }

  const watchers = registry.getState().watcher;
  const watcher = watchers[watcherName];
  if (!watcher) {
    return undefined;
  }

  // Only docker watchers expose dockerApi
  const dockerApi = (
    watcher as unknown as { dockerApi?: { modem?: { host?: string; socketPath?: string } } }
  ).dockerApi;
  if (!dockerApi) {
    return undefined;
  }

  const modem = dockerApi.modem;

  // TCP mode: the helper container connects over the network — always available
  if (typeof modem?.host === 'string' && modem.host.length > 0) {
    return true;
  }

  // Socket mode: available only when /var/run/docker.sock is present and is a socket
  try {
    return fs.statSync('/var/run/docker.sock').isSocket();
  } catch {
    return false;
  }
}
