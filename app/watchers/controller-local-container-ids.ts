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
 * daemon, keyed by that watcher's registry id (`docker.<name>`, a watcher the
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
 *
 * Residual risk: when a watcher's `watchevents` option is off, its set is
 * only replaced on the cron cadence, so a container that appears on the
 * controller's host between ticks does not enter the set (and so cannot be
 * claimed against an agent's report) until the next tick runs.
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
 * Minimal shape of a Docker client this module needs to seed a watcher's id
 * set at startup. Structural, like `ControllerLocalWatcherIdentity`, so this
 * module never has to import `dockerode` or the Docker watcher class.
 */
export type ContainerListingDockerApi = {
  listContainers(options: { all: boolean }): Promise<Array<{ Id?: string }>>;
};

/**
 * Minimal shape of a watcher's logger this module needs to warn about a
 * failed seed. Structural for the same reason as the types above.
 */
export type WarnLogger = {
  warn(message: string): void;
};

/**
 * How long the startup seed waits on `listContainers()` before giving up.
 * `registerWatchers()` awaits every watcher's `init()` in turn, so a daemon
 * that accepts the connection but never answers (a wedged socket proxy, a
 * hung TCP handshake past the point `listContainers()` itself times out)
 * would otherwise block the whole controller from starting. Exported so
 * tests can assert against it instead of a magic number.
 */
export const CONTROLLER_LOCAL_SEED_TIMEOUT_MS = 10_000;

/**
 * Sentinel the timeout race resolves with, distinct from any possible
 * `listContainers()` result so the winner is unambiguous.
 */
const SEED_TIMED_OUT = Symbol('controller-local-seed-timed-out');

/**
 * Seed a controller-local watcher's id set once at startup, before its first
 * scheduled enumeration runs. `Docker.init()` schedules that first watch
 * `START_WATCHER_DELAY_MS` after registration, but `app/index.ts` starts the
 * agent SSE connection as soon as `registry.init()` resolves, and an agent's
 * `dd:ack` runs `handshake()` within tens of milliseconds of connecting. On a
 * fresh store, a controller-host container id could otherwise reach the agent
 * ingestion gate before the scheduled tick ever populates the set, and an
 * empty set is indistinguishable from "no controller watcher owns this id."
 * Calling this from `Docker.init()`, awaited before registration resolves,
 * closes that window.
 *
 * An unreachable daemon at boot must not fail watcher registration, so a
 * `listContainers()` failure here is swallowed and only logged through
 * `logger`, when one is given; the scheduled enumeration still runs on its
 * own cadence regardless of whether the seed succeeded. A `listContainers()`
 * call that never settles gets the same treatment: it is raced against
 * `CONTROLLER_LOCAL_SEED_TIMEOUT_MS`, and a timeout logs the same way a
 * rejection does and resolves without recording, so `Docker.init()` (and the
 * `registerWatchers()` loop awaiting it) still finishes. Ownership checks run
 * permissive against this watcher until its first real scan populates the
 * set. A late resolution after the timeout is not recorded either, since
 * nothing is still awaiting that promise by then, so nothing would call
 * `recordControllerLocalEnumeration()` for it.
 * @param watcher the watcher that will own the seeded ids
 * @param dockerApi the Docker client to enumerate once
 * @param logger the watcher's logger, for a seed failure warning
 */
export async function seedControllerLocalEnumeration(
  watcher: ControllerLocalWatcherIdentity,
  dockerApi: ContainerListingDockerApi,
  logger?: WarnLogger,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<typeof SEED_TIMED_OUT>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(SEED_TIMED_OUT), CONTROLLER_LOCAL_SEED_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([dockerApi.listContainers({ all: true }), timedOut]);
    if (result === SEED_TIMED_OUT) {
      logger?.warn(
        `Controller-local container id seed timed out after ${CONTROLLER_LOCAL_SEED_TIMEOUT_MS}ms; agent ownership checks start permissive until the first scan`,
      );
      return;
    }
    recordControllerLocalEnumeration(
      watcher,
      result.map((container) => container.Id),
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger?.warn(`Unable to seed controller-local container ids at startup (${message})`);
  } finally {
    clearTimeout(timeoutHandle);
  }
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
