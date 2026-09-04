import type { Container } from './container.js';

/**
 * Accepted values for `DD_WATCHER_{name}_MAINTENANCE_WINDOW_SCOPE`.
 *
 * - `install`: the window gates automatic installation only. The scheduled scan keeps running
 *   on its own cron, so discovery, registry checks, container-state refresh and update
 *   notifications behave as if no window were configured. This is the default.
 * - `scan`: the window gates the whole scheduled scan, which is what every release before
 *   v1.8.0 did: outside the window nothing is looked at, and one pending scan is queued and
 *   replayed when the window opens.
 */
export const MAINTENANCE_WINDOW_SCOPES = ['install', 'scan'] as const;

export type MaintenanceWindowScope = (typeof MAINTENANCE_WINDOW_SCOPES)[number];

export const DEFAULT_MAINTENANCE_WINDOW_SCOPE: MaintenanceWindowScope = 'install';

/**
 * Normalize a configured (or agent-reported, and therefore unvalidated) scope value.
 * Anything other than the literal `'scan'` resolves to the default, so a watcher whose
 * configuration predates the option (or a masked remote watcher that does not report it)
 * gets the new install-scoped behaviour rather than failing closed on the scan gate.
 */
export function resolveMaintenanceWindowScope(value: unknown): MaintenanceWindowScope {
  return value === 'scan' ? 'scan' : DEFAULT_MAINTENANCE_WINDOW_SCOPE;
}

/**
 * The subset of a registered watcher that maintenance-window consumers touch.
 *
 * `type`/`name` are declared required because every entry this resolves from the component
 * registry is a registered `Component`, which always carries both; the masked shape a remote
 * agent reports only ever reaches the `configuration` fields below.
 */
export interface MaintenanceWindowWatcher {
  type: string;
  name: string;
  configuration?: {
    maintenancewindowopen?: unknown;
    maintenancewindowscope?: unknown;
  };
  isMaintenanceWindowOpen?: () => boolean;
  queueMaintenanceWindowWatch?: () => void;
  /**
   * Set by the watcher's own teardown, before `registry.deregisterComponent` removes it from
   * the state map, so an entry read from the registry can still be a torn-down watcher.
   */
  isWatcherDeregistered?: boolean;
}

/**
 * The component-registry key of the watcher that owns a container, or undefined when the
 * container names no watcher. Matches `Component.getId()` for a docker watcher, so it is
 * also what a watcher-scoped event carries to identify itself to a trigger.
 */
export function getContainerWatcherRegistryId(
  container: Pick<Container, 'agent' | 'watcher'>,
): string | undefined {
  const watcherName = typeof container.watcher === 'string' ? container.watcher.trim() : '';
  if (!watcherName) {
    return undefined;
  }

  const agentName = typeof container.agent === 'string' ? container.agent.trim() : '';
  return `${agentName ? `${agentName}.` : ''}docker.${watcherName}`;
}

/**
 * Resolve the watcher that owns a container from the component-registry watcher state.
 * Returns undefined when the container names no watcher, or when the registry holds no
 * entry under the derived id (deregistered watcher, agent mid-handshake).
 */
export function getContainerMaintenanceWindowWatcher(
  container: Pick<Container, 'agent' | 'watcher'>,
  watchers: Readonly<Record<string, unknown>> | undefined,
): MaintenanceWindowWatcher | undefined {
  const watcherId = getContainerWatcherRegistryId(container);
  if (!watcherId) {
    return undefined;
  }

  return watchers?.[watcherId] as MaintenanceWindowWatcher | undefined;
}

/**
 * Resolve the live maintenance-window state exposed by a container's owning watcher.
 * Missing watcher state intentionally returns undefined so eligibility remains fail-open.
 */
export function getContainerMaintenanceWindowOpen(
  container: Pick<Container, 'agent' | 'watcher'>,
  watchers: Readonly<Record<string, unknown>> | undefined,
): boolean | undefined {
  const watcher = getContainerMaintenanceWindowWatcher(container, watchers);
  if (typeof watcher?.isMaintenanceWindowOpen === 'function') {
    return watcher.isMaintenanceWindowOpen();
  }

  const maskedState = watcher?.configuration?.maintenancewindowopen;
  return typeof maskedState === 'boolean' ? maskedState : undefined;
}
