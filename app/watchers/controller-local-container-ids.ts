/**
 * A watcher, as far as this module cares: something with a registry id and an
 * optional owning agent. Structural on purpose, so the agent client never has
 * to import the Docker watcher class to read this state.
 */
export type ControllerLocalWatcherIdentity = {
  getId(): string;
  agent?: string;
};

/**
 * Container ids each controller-local watcher currently sees on its own Docker
 * daemon, keyed by that watcher's registry id (`docker.<name>` — a watcher the
 * controller registered itself carries no agent prefix, per
 * `Component.getId()`).
 *
 * The agent ingestion gate in `agent/AgentClient.ts` reads this to decide
 * whether an id an agent reports with no store record yet is really the
 * agent's to claim. A watcher *name* is not evidence of ownership: a
 * controller with no `DD_WATCHER_*` registers a default watcher called `local`
 * and the agent quickstart configures `DD_WATCHER_LOCAL_SOCKET` on the agent,
 * so both sides are routinely called `local` while watching entirely different
 * hosts. Container ids are evidence, so ownership is decided on those.
 *
 * Writers replace their whole set on every enumeration, so a container that
 * leaves the controller's host stops being claimed on the next cycle, and the
 * ids are recorded straight off `dockerApi.listContainers()` rather than off
 * the watched/settled subset. That is deliberate: the id has to be known
 * before the discovery settle window elapses and before any store row exists,
 * which is the whole window the gate closes.
 *
 * Lives here rather than on the watcher component so "is this watcher
 * controller-local" is decided once at write time, where the component's own
 * `agent` field is authoritative, instead of being re-derived from a registry
 * key string on every read.
 */
const enumeratedContainerIdsByWatcher = new Map<string, Set<string>>();

/**
 * Replace a watcher's recorded id set with what its latest enumeration
 * returned. A watcher owned by an agent records nothing: a `DD_AGENT_*`
 * controller-Docker-transport watcher runs inside the controller process but
 * enumerates the *agent's* daemon, so recording its ids would make that agent
 * collide with itself and refuse every container it reports.
 * @param watcher the watcher that ran the enumeration
 * @param containerIds every container id the enumeration returned
 */
export function recordControllerLocalEnumeration(
  watcher: ControllerLocalWatcherIdentity,
  containerIds: Iterable<string | undefined>,
): void {
  if (typeof watcher.agent === 'string' && watcher.agent.length > 0) {
    return;
  }
  const ids = new Set<string>();
  for (const containerId of containerIds) {
    if (typeof containerId === 'string' && containerId.length > 0) {
      ids.add(containerId);
    }
  }
  enumeratedContainerIdsByWatcher.set(watcher.getId(), ids);
}

/**
 * Drop a watcher's recorded ids when it is deregistered, so a watcher that no
 * longer exists cannot keep refusing ids on the controller's behalf.
 * @param watcher the watcher being deregistered
 */
export function forgetControllerLocalEnumeration(watcher: ControllerLocalWatcherIdentity): void {
  enumeratedContainerIdsByWatcher.delete(watcher.getId());
}

/**
 * The registry id of the controller-local watcher currently enumerating
 * `containerId`, or undefined when no controller watcher is running it.
 * @param containerId the container id an agent is trying to claim
 */
export function findControllerLocalWatcherClaimingContainerId(
  containerId: string,
): string | undefined {
  for (const [watcherId, containerIds] of enumeratedContainerIdsByWatcher) {
    if (containerIds.has(containerId)) {
      return watcherId;
    }
  }
  return undefined;
}

export function _resetControllerLocalContainerIdsForTests(): void {
  enumeratedContainerIdsByWatcher.clear();
}
