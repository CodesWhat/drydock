import { getErrorMessage } from '../util/error.js';

/**
 * A watcher, as far as this module cares: something with a registry id and an
 * optional owning agent. Structural on purpose, so the agent client never has
 * to import the Docker watcher class to read this state.
 */
export type ControllerLocalWatcherIdentity = {
  getId(): string;
  agent?: string;
  log?: {
    warn(message: string): void;
  };
};

/**
 * The subset of the dockerode client `seedControllerLocalEnumeration` needs.
 * Structural on purpose, matching `recordControllerLocalEnumeration`'s own
 * decoupling from the concrete Docker watcher class.
 */
export type ControllerLocalDockerApi = {
  listContainers(options: { all: boolean }): Promise<Array<{ Id?: string }>>;
};

/**
 * Upper bound on how long the startup seed waits for `listContainers()`
 * before giving up. A stalled daemon must not keep `Docker.init()` pending
 * indefinitely: `registerWatchers()` awaits every watcher's `init()`, so one
 * hung seed would block registry initialization for every other component.
 */
export const CONTROLLER_LOCAL_SEED_TIMEOUT_MS = 10_000;

/** Sentinel distinguishing a timed-out race from an actual container list. */
const CONTROLLER_LOCAL_SEED_TIMED_OUT = Symbol('controller-local-seed-timed-out');

/**
 * Container ids each controller-local watcher currently sees on its own Docker
 * daemon, keyed by that watcher's registry id (`docker.<name>`, since a watcher
 * the controller registered itself carries no agent prefix, per
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
 * Record a watcher's enumerated ids once, immediately, ahead of the first
 * scheduled scan. `Docker.init()` only reaches its own `getContainers()`
 * enumeration on the first cron tick, which fires `START_WATCHER_DELAY_MS`
 * after init returns. Agent handshakes are not on that clock: an agent can
 * connect and claim a no-record container id as soon as the controller's
 * registry finishes `init()`, which leaves a window where a container that
 * actually lives on the controller's own host has not been enumerated yet
 * and so is not recorded as claimed. Calling this at the end of `init()`,
 * awaited and before the startup timer is armed, closes that window instead
 * of waiting out the first tick.
 *
 * A daemon that cannot be reached should not fail watcher registration over
 * this: the error is logged and swallowed rather than thrown, and the
 * watcher's regular enumeration cycle gets another chance once it starts.
 *
 * A daemon that never answers gets the same treatment on a clock: `init()`
 * awaits this call, and `registerWatchers()` awaits every watcher's
 * `init()`, so a `listContainers()` that never settles would otherwise hang
 * registry initialization for every other component forever. The seed races
 * the call against `CONTROLLER_LOCAL_SEED_TIMEOUT_MS` and gives up (logging
 * and recording nothing) if the daemon hasn't answered by then; a late
 * answer or error after the timeout has already won is simply ignored, not
 * recorded and not re-thrown.
 * @param watcher the watcher performing the seed enumeration
 * @param dockerApi the dockerode client to enumerate containers from
 */
export async function seedControllerLocalEnumeration(
  watcher: ControllerLocalWatcherIdentity,
  dockerApi: ControllerLocalDockerApi,
): Promise<void> {
  if (typeof watcher.agent === 'string' && watcher.agent.length > 0) {
    return;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutRace = new Promise<typeof CONTROLLER_LOCAL_SEED_TIMED_OUT>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve(CONTROLLER_LOCAL_SEED_TIMED_OUT),
      CONTROLLER_LOCAL_SEED_TIMEOUT_MS,
    );
  });

  try {
    const result = await Promise.race([dockerApi.listContainers({ all: true }), timeoutRace]);
    if (result === CONTROLLER_LOCAL_SEED_TIMED_OUT) {
      watcher.log?.warn(
        `Controller-local container id seed timed out after ${CONTROLLER_LOCAL_SEED_TIMEOUT_MS}ms; ` +
          'agent ownership checks start permissive until the first scan',
      );
      return;
    }
    recordControllerLocalEnumeration(
      watcher,
      result.map((container) => container.Id),
    );
  } catch (e: unknown) {
    watcher.log?.warn(
      `Unable to seed controller-local container ids ahead of the first scan (${getErrorMessage(e)})`,
    );
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
