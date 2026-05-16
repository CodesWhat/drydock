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

// Cache for the socket-mode stat result. The socket's existence is invariant
// for the process lifetime, so we only need to perform the syscall once.
// TCP-mode and undefined early-returns are NOT cached — only the socket stat.
let socketAvailabilityCache: boolean | undefined = undefined;
let socketCachePopulated = false;

/** @internal Test-only: clear the socket availability cache between test cases. */
export function __resetSelfUpdateAvailabilityCacheForTest(): void {
  socketAvailabilityCache = undefined;
  socketCachePopulated = false;
}

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

  // TCP mode: the helper container connects over the network — always available.
  // Not cached: TCP host is per-watcher config and not a one-time OS check.
  if (typeof modem?.host === 'string' && modem.host.length > 0) {
    return true;
  }

  // Socket mode: available only when /var/run/docker.sock is present and is a
  // socket. The result is memoized because the socket's existence is invariant
  // for the process lifetime, and this function is called once per container on
  // every GET /api/containers poll.
  if (!socketCachePopulated) {
    try {
      socketAvailabilityCache = fs.statSync('/var/run/docker.sock').isSocket();
    } catch {
      socketAvailabilityCache = false;
    }
    socketCachePopulated = true;
  }
  return socketAvailabilityCache;
}
