import type Joi from 'joi';
import {
  type ContainerStateAlertEventPayload,
  emitContainerStateAlert,
} from '../../../event/index.js';
import { type Container, isRollbackContainerName } from '../../../model/container.js';
import { getContainer } from '../../../store/container.js';
import { getOperationsByContainerId } from '../../../store/update-operation.js';
import { getErrorMessage } from '../../../util/error.js';

/** Restarts (crashes) inside the window that make a restart loop. */
const DEFAULT_RESTART_LOOP_THRESHOLD = 3;
/** Restart loop window, in seconds. */
const DEFAULT_RESTART_LOOP_WINDOW_SECONDS = 300;
/**
 * Docker emits `oom`, `die` and (for an explicit stop) `stop` within milliseconds of each
 * other, in that order. Wait this long after the first of them before classifying, so one
 * crash produces one alert whichever of the three arrives first.
 */
export const STATE_ALERT_SETTLE_MS = 1500;
/** Updates and rollbacks keep stopping and recreating containers shortly after they end. */
const DRYDOCK_OPERATION_GRACE_MS = 60 * 1000;

export interface RestartLoopConfiguration {
  threshold?: number;
  window?: number;
}

export function getRestartLoopConfigurationSchema(joi: typeof Joi) {
  return joi.object({
    threshold: joi.number().integer().min(2),
    window: joi.number().integer().min(1),
  });
}

type UnknownRecord = Record<string, unknown>;

interface PendingStateEvent {
  exitCode?: number;
  oom: boolean;
  stopped: boolean;
  timer: ReturnType<typeof setTimeout>;
}

interface ContainerStateAlertLog {
  debug: (message: string) => void;
}

export interface ContainerStateAlertDependencies {
  getContainer: (containerId: string) => Container | undefined;
  inspectContainer: (containerId: string) => Promise<unknown>;
  /** True when Drydock itself is stopping/recreating this container (update or rollback). */
  isDrydockInitiated: (container: Container) => boolean;
  emit: (payload: ContainerStateAlertEventPayload) => Promise<void>;
  log: ContainerStateAlertLog;
  now?: () => number;
}

export interface ContainerStateAlertOptions {
  restartLoopThreshold?: number;
  restartLoopWindowSeconds?: number;
  settleMs?: number;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' ? (value as UnknownRecord) : undefined;
}

function resolveContainerId(dockerEvent: UnknownRecord): string | undefined {
  if (typeof dockerEvent.id === 'string' && dockerEvent.id !== '') {
    return dockerEvent.id;
  }
  const actorId = asRecord(dockerEvent.Actor)?.ID;
  return typeof actorId === 'string' && actorId !== '' ? actorId : undefined;
}

function parseExitCode(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) ? parsed : undefined;
}

function describeExit(exitCode: number | undefined): string {
  return exitCode === undefined ? 'exited' : `exit code ${exitCode}`;
}

/**
 * Turns Docker `die` / `oom` / `stop` events into container state alerts: stopped, exited
 * non-zero, OOM-killed, restart loop.
 *
 * Only containers in the store (the ones Drydock watches) alert, and never while Drydock is
 * itself replacing the container. The three raw events for one crash are coalesced into one
 * alert. Once a restart loop is reported, the per-crash alerts for that container pause
 * until the window passes, so a crash-looping container sends one message, not one per
 * crash.
 */
export class ContainerStateAlertTracker {
  private readonly pending = new Map<string, PendingStateEvent>();

  private readonly crashTimes = new Map<string, number[]>();

  private readonly loopAlertedAt = new Map<string, number>();

  private readonly threshold: number;

  private readonly windowMs: number;

  private readonly settleMs: number;

  private disposed = false;

  constructor(
    private readonly deps: ContainerStateAlertDependencies,
    options: ContainerStateAlertOptions = {},
  ) {
    this.threshold = options.restartLoopThreshold ?? DEFAULT_RESTART_LOOP_THRESHOLD;
    this.windowMs =
      (options.restartLoopWindowSeconds ?? DEFAULT_RESTART_LOOP_WINDOW_SECONDS) * 1000;
    this.settleMs = options.settleMs ?? STATE_ALERT_SETTLE_MS;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  observe(dockerEvent: unknown): void {
    const record = asRecord(dockerEvent);
    if (!record || this.disposed) {
      return;
    }
    const action = record.Action ?? record.status;
    if (action !== 'die' && action !== 'oom' && action !== 'stop') {
      return;
    }
    const containerId = resolveContainerId(record);
    if (!containerId) {
      return;
    }

    let entry = this.pending.get(containerId);
    if (!entry) {
      if (action === 'stop') {
        // A `stop` with no `die` ahead of it is not a state change we have not seen.
        return;
      }
      entry = {
        oom: false,
        stopped: false,
        timer: setTimeout(() => {
          void this.settle(containerId);
        }, this.settleMs),
      };
      this.pending.set(containerId, entry);
    }

    if (action === 'oom') {
      entry.oom = true;
    } else if (action === 'stop') {
      entry.stopped = true;
    } else {
      const attributes = asRecord(asRecord(record.Actor)?.Attributes);
      entry.exitCode = parseExitCode(attributes?.exitCode);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
    this.crashTimes.clear();
    this.loopAlertedAt.clear();
  }

  private async settle(containerId: string): Promise<void> {
    // The timer only exists while the entry does, and dispose() clears every timer.
    const entry = this.pending.get(containerId) as PendingStateEvent;
    this.pending.delete(containerId);
    try {
      await this.classify(containerId, entry);
    } catch (e: unknown) {
      this.deps.log.debug(
        `Unable to evaluate state alert for container id=[${containerId}] (${getErrorMessage(e)})`,
      );
    }
  }

  private async classify(containerId: string, entry: PendingStateEvent): Promise<void> {
    const container = this.deps.getContainer(containerId);
    if (!container) {
      return;
    }
    if (isRollbackContainerName(container.name) || this.deps.isDrydockInitiated(container)) {
      return;
    }

    let { exitCode } = entry;
    let oomKilled = entry.oom;
    try {
      const state = asRecord(asRecord(await this.deps.inspectContainer(containerId))?.State);
      oomKilled = oomKilled || state?.OOMKilled === true;
      exitCode = exitCode ?? parseExitCode(state?.ExitCode);
    } catch {
      // The container may already be gone (auto-remove); the events carry enough to classify.
    }

    const now = this.now();
    const base = { containerName: container.name, container, exitCode };

    if (!entry.stopped) {
      const loop = this.recordCrash(containerId, now);
      if (loop !== undefined) {
        await this.deps.emit({
          ...base,
          kind: 'container-restart-loop',
          reason: 'restart loop',
          restartCount: loop,
          windowSeconds: this.windowMs / 1000,
        });
        return;
      }
      if (this.isLoopActive(containerId, now)) {
        return;
      }
    }

    if (oomKilled) {
      await this.deps.emit({ ...base, kind: 'container-oom-killed', reason: 'out of memory' });
      return;
    }
    if (entry.stopped || exitCode === 0) {
      await this.deps.emit({ ...base, kind: 'container-stopped', reason: describeExit(exitCode) });
      return;
    }
    await this.deps.emit({ ...base, kind: 'container-exited', reason: describeExit(exitCode) });
  }

  /** Record a crash; returns the crash count when it newly completes a restart loop. */
  private recordCrash(containerId: string, now: number): number | undefined {
    const recent = (this.crashTimes.get(containerId) ?? []).filter(
      (at) => now - at < this.windowMs,
    );
    recent.push(now);
    this.crashTimes.set(containerId, recent);
    if (recent.length < this.threshold || this.isLoopActive(containerId, now)) {
      return undefined;
    }
    this.loopAlertedAt.set(containerId, now);
    return recent.length;
  }

  private isLoopActive(containerId: string, now: number): boolean {
    const alertedAt = this.loopAlertedAt.get(containerId);
    return alertedAt !== undefined && now - alertedAt < this.windowMs;
  }
}

/**
 * A container Drydock is updating or rolling back is stopped and recreated on purpose.
 * That covers an operation still running and one that ended moments ago, because the
 * replacement container keeps starting and stopping for a short while after the terminal
 * state is written.
 */
export function isDrydockInitiatedStateChange(container: Container, nowMs = Date.now()): boolean {
  return getOperationsByContainerId(container.id).some((operation) => {
    if (operation.status === 'queued') {
      return false;
    }
    if (operation.completedAt === undefined) {
      return true;
    }
    return nowMs - Date.parse(operation.completedAt) < DRYDOCK_OPERATION_GRACE_MS;
  });
}

interface ContainerStateAlertWatcher {
  dockerApi: { getContainer: (containerId: string) => { inspect: () => Promise<unknown> } };
  log: ContainerStateAlertLog;
  configuration: { restartloop?: RestartLoopConfiguration };
}

export function createContainerStateAlertTracker(
  watcher: ContainerStateAlertWatcher,
): ContainerStateAlertTracker {
  return new ContainerStateAlertTracker(
    {
      getContainer: (containerId) => getContainer(containerId),
      inspectContainer: async (containerId) =>
        watcher.dockerApi.getContainer(containerId).inspect(),
      isDrydockInitiated: (container) => isDrydockInitiatedStateChange(container),
      emit: (payload) => emitContainerStateAlert(payload),
      log: { debug: (message) => watcher.log.debug(message) },
    },
    {
      restartLoopThreshold: watcher.configuration.restartloop?.threshold,
      restartLoopWindowSeconds: watcher.configuration.restartloop?.window,
    },
  );
}
