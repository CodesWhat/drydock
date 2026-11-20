import { emitContainerStateAlert } from '../event/index.js';
import type { Container } from '../model/container.js';
import { getContainer } from '../store/container.js';
import {
  ContainerStateAlertTracker,
  isDrydockInitiatedStateChange,
  type RestartLoopConfiguration,
} from '../watchers/providers/docker/container-state-alerts.js';

/** Edge tunnel message type and Standard-mode SSE event type Portwing sends. */
export const PORTWING_CONTAINER_EVENT = 'dd:container-event';

const TRACKED_ACTIONS: ReadonlySet<string> = new Set(['die', 'oom', 'stop']);

interface PortwingStateAlertLog {
  debug: (message: string) => void;
}

/**
 * Portwing agents forward raw Docker die/oom/stop/start/restart events (lossy on Edge, no
 * replay after a Docker stream reconnect) for every inventoried container. The
 * controller classifies them with the same tracker local watchers use, so one crash is
 * one alert, restart loops and Drydock's own updates and rollbacks behave identically.
 * `start` and `restart` carry no crash signal and are accepted but not counted.
 */
export class PortwingStateAlerts {
  private readonly tracker: ContainerStateAlertTracker;

  constructor(
    private readonly agentName: string,
    log: PortwingStateAlertLog,
    restartLoop: RestartLoopConfiguration = {},
  ) {
    this.tracker = new ContainerStateAlertTracker(
      {
        // The store holds only containers Drydock watches (its own watch/include rules
        // already applied to the agent inventory), and an id from another agent never matches.
        getContainer: (containerId): Container | undefined => {
          const stored = getContainer(containerId);
          return stored?.agent === this.agentName ? stored : undefined;
        },
        // The controller has no Docker handle here; the events carry the exit code and OOM flag.
        inspectContainer: async () => undefined,
        isDrydockInitiated: (container) => isDrydockInitiatedStateChange(container),
        emit: (payload) => emitContainerStateAlert(payload),
        log,
      },
      { restartLoopThreshold: restartLoop.threshold, restartLoopWindowSeconds: restartLoop.window },
    );
  }

  /** Feed one `dd:container-event` payload; malformed or non-crash events are ignored. */
  observe(data: unknown): void {
    if (!data || typeof data !== 'object') {
      return;
    }
    const payload = data as Record<string, unknown>;
    const { containerId, action, exitCode } = payload;
    if (
      typeof containerId !== 'string' ||
      containerId.length === 0 ||
      typeof action !== 'string' ||
      !TRACKED_ACTIONS.has(action)
    ) {
      return;
    }
    this.tracker.observe({
      Action: action,
      id: containerId,
      Actor: {
        ID: containerId,
        Attributes: Number.isInteger(exitCode) ? { exitCode } : {},
      },
    });
  }

  dispose(): void {
    this.tracker.dispose();
  }
}
