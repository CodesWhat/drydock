import * as event from '../../../event/index.js';
import { selectActionTrigger } from '../../../model/action-policy.js';
import { classifyApprovalCandidate } from '../../../model/approval.js';
import { type Container, fullName, hasRawUpdate } from '../../../model/container.js';
import {
  computeUpdateEligibility,
  type UpdateBlockerReason,
} from '../../../model/update-eligibility.js';
import { getContainerMaintenanceWindowOpen } from '../../../model/watcher-maintenance-window.js';
import { getState } from '../../../registry/index.js';
import { getUpdateMode } from '../../../store/settings.js';
import { getActiveOperationByContainerId } from '../../../store/update-operation.js';
import {
  clearImagePreload,
  countImagePreloads,
  getPreloadCandidate,
  peekImagePreload,
  setImagePreload,
} from '../../../updates/image-preload-state.js';
import { getErrorMessage } from '../../../util/error.js';

export type PreloadMode = 'off' | 'all' | 'label';

export const DEFAULT_PRELOAD_CONCURRENCY = 1;
export const DEFAULT_PRELOAD_MAX_CANDIDATES = 5;
/** A failed preload of the same candidate is retried no sooner than this. */
export const PRELOAD_RETRY_AFTER_MS = 15 * 60_000;
const PRELOAD_LABEL = 'dd.update.preload';

/**
 * Blockers that mean "held, not refused": the candidate is expected to install later, so its
 * image can be fetched ahead of time. Anything else (snooze, skip lists, a hard blocker, a
 * threshold miss) means the operator or policy does not want this candidate installed.
 */
const HOLD_BLOCKERS = new Set<UpdateBlockerReason>([
  'maturity-not-reached',
  'maturity-releases-not-reached',
  'maintenance-window-closed',
]);

export interface PreloadConfiguration {
  preload?: boolean | 'label';
  preloadconcurrency?: number;
  preloadmaxcandidates?: number;
}

export function resolvePreloadMode(configuration: PreloadConfiguration): PreloadMode {
  if (configuration.preload === 'label') {
    return 'label';
  }
  return configuration.preload === true ? 'all' : 'off';
}

interface PreloadLog {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
}

interface PreloadRegistry {
  getAuthPull: () => Promise<unknown>;
  getImageFullName: (image: Container['image'], tagOrDigest: string) => string;
}

/** The slice of the Docker action trigger the preloader drives. */
export interface ImagePreloaderHost {
  getId: () => string;
  log: PreloadLog;
  configuration: PreloadConfiguration & { order?: number };
  getWatcher: (container: Container) => { dockerApi: unknown };
  resolveRegistryManager: (
    container: Container,
    log: PreloadLog,
    options: { allowAnonymousFallback: boolean },
  ) => PreloadRegistry;
  getNewImageFullName: (registry: PreloadRegistry, container: Container) => string;
  isImageOnHost: (dockerApi: unknown, imageReference: string) => Promise<boolean>;
  pullImage: (dockerApi: unknown, auth: unknown, image: string, log: PreloadLog) => Promise<void>;
}

export type PreloadDecision = { preload: true } | { preload: false; reason: string };

function readLabel(container: Container): boolean | undefined {
  const raw = container.labels?.[PRELOAD_LABEL];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(value)) {
    return false;
  }
  return undefined;
}

/**
 * Optional background download of a held update's candidate image. A held update is one the
 * normal path will not install right now (approval pending, maintenance window closed,
 * maturity not reached, or manual-only). The pull goes through the action's own
 * `pullImage`, so it shares the per-registry pacing, timeout and credentials of a real
 * update, and it never touches the running container. The install path is unchanged: it
 * pulls and scans for itself, so a preload only warms the layer cache.
 */
export default class ImagePreloader {
  private readonly host: ImagePreloaderHost;
  private readonly inFlight = new Map<string, number>();
  private readonly pulling = new Set<Promise<void>>();
  private unregisterReport?: () => void;
  private unregisterRemoved?: () => void;

  constructor(host: ImagePreloaderHost) {
    this.host = host;
  }

  start(): void {
    if (resolvePreloadMode(this.host.configuration) === 'off') {
      return;
    }
    this.unregisterReport = event.registerContainerReport(
      async (report) => this.handleReport(report.container),
      { id: `${this.host.getId()}.preload`, order: this.host.configuration.order },
    );
    this.unregisterRemoved = event.registerContainerRemoved((container) => {
      clearImagePreload(container as unknown as Container);
    });
  }

  stop(): void {
    this.unregisterReport?.();
    this.unregisterReport = undefined;
    this.unregisterRemoved?.();
    this.unregisterRemoved = undefined;
  }

  /** Resolves when every pull started so far has settled (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.pulling]);
  }

  /**
   * Decide whether a container's candidate should be preloaded by this action. Pure with
   * respect to Docker: it reads policy and registry state only.
   */
  evaluate(container: Container): PreloadDecision {
    const mode = resolvePreloadMode(this.host.configuration);
    const label = readLabel(container);
    if (mode === 'off' || label === false || (mode === 'label' && label !== true)) {
      return { preload: false, reason: 'preload not enabled for this container' };
    }
    if (!hasRawUpdate(container)) {
      return { preload: false, reason: 'no update candidate' };
    }
    if (container.agent) {
      return { preload: false, reason: 'agent container (the agent preloads on its own host)' };
    }
    if (container.image?.isLocalImage) {
      return { preload: false, reason: 'local image has no registry candidate' };
    }
    const registryState = getState();
    const winner = selectActionTrigger(registryState.trigger as never, container, {});
    if (winner?.triggerId !== this.host.getId()) {
      return { preload: false, reason: 'another action owns this container' };
    }
    if (winner.state === 'blocked') {
      return { preload: false, reason: `excluded from this action (${winner.reason})` };
    }
    let dockerWatcher: { dockerApi: unknown } | undefined;
    try {
      dockerWatcher = this.host.getWatcher(container);
    } catch {
      dockerWatcher = undefined;
    }
    if (!dockerWatcher?.dockerApi) {
      return { preload: false, reason: 'no Docker watcher owns this container' };
    }
    if (getActiveOperationByContainerId(container.id)) {
      return { preload: false, reason: 'an update is already running' };
    }
    const eligibility = computeUpdateEligibility(container, {
      triggers: registryState.trigger as never,
      updateMode: getUpdateMode(),
      maintenanceWindowOpen: getContainerMaintenanceWindowOpen(container, registryState.watcher),
      getActiveOperation: () => undefined,
    });
    const blockers = eligibility.blockers;
    const refusal = blockers.find((blocker) => !HOLD_BLOCKERS.has(blocker.reason));
    if (refusal) {
      return { preload: false, reason: `update not wanted (${refusal.reason})` };
    }
    const verdict = classifyApprovalCandidate(
      container,
      registryState.trigger as never,
      getUpdateMode(),
    );
    if (verdict === 'no-candidate' || verdict === 'blocked') {
      return { preload: false, reason: `update not wanted (${verdict})` };
    }
    if (verdict === 'auto-dispatch' && blockers.length === 0) {
      return { preload: false, reason: 'update is not held, it installs on its own' };
    }
    return { preload: true };
  }

  /**
   * Evaluate a report and start a background pull when warranted. Returns immediately so a
   * slow pull never holds up the ordered container-report handlers.
   */
  async handleReport(container: Container): Promise<void> {
    if (!hasRawUpdate(container)) {
      clearImagePreload(container);
      return;
    }
    const decision = this.evaluate(container);
    if ('reason' in decision) {
      this.host.log.debug(`Preload skipped for ${fullName(container)}: ${decision.reason}`);
      return;
    }
    const task = this.preload(container).catch((error: unknown) => {
      this.host.log.warn(`Preload failed for ${fullName(container)} (${getErrorMessage(error)})`);
    });
    this.pulling.add(task);
    void task.finally(() => this.pulling.delete(task));
  }

  private async preload(container: Container): Promise<void> {
    const candidate = getPreloadCandidate(container);
    if (!candidate) {
      return;
    }
    const existing = peekImagePreload(container);
    if (existing?.candidate === candidate) {
      const retryDue =
        existing.status === 'failed' &&
        Date.now() - Date.parse(existing.updatedAt) >= PRELOAD_RETRY_AFTER_MS;
      if (existing.status !== 'failed' || !retryDue) {
        return;
      }
    }

    const host = `${container.agent ?? 'local'}.${container.watcher}`;
    const concurrency = this.host.configuration.preloadconcurrency ?? DEFAULT_PRELOAD_CONCURRENCY;
    if ((this.inFlight.get(host) ?? 0) >= concurrency) {
      this.host.log.debug(
        `Preload deferred for ${fullName(container)}: ${concurrency} preload(s) already running on ${host}`,
      );
      return;
    }
    const maxCandidates =
      this.host.configuration.preloadmaxcandidates ?? DEFAULT_PRELOAD_MAX_CANDIDATES;
    if (countImagePreloads(host, container) >= maxCandidates) {
      this.host.log.info(
        `Preload skipped for ${fullName(container)}: ${host} already holds ${maxCandidates} preloaded candidate(s)`,
      );
      return;
    }

    const registry = this.host.resolveRegistryManager(container, this.host.log, {
      allowAnonymousFallback: true,
    });
    const digest = container.result?.digest;
    const image = digest
      ? registry.getImageFullName(container.image, digest)
      : this.host.getNewImageFullName(registry, container);
    const record = { image, digest, candidate, host };

    this.inFlight.set(host, (this.inFlight.get(host) ?? 0) + 1);
    setImagePreload(container, { ...record, status: 'pending' });
    try {
      const { dockerApi } = this.host.getWatcher(container);
      if (await this.host.isImageOnHost(dockerApi, image)) {
        this.settle(container, candidate, { ...record, status: 'done' });
        return;
      }
      const auth = await registry.getAuthPull();
      await this.host.pullImage(dockerApi, auth, image, this.host.log);
      this.settle(container, candidate, { ...record, status: 'done' });
    } catch (error: unknown) {
      this.settle(container, candidate, {
        ...record,
        status: 'failed',
        error: getErrorMessage(error),
      });
      throw error;
    } finally {
      const remaining = (this.inFlight.get(host) as number) - 1;
      if (remaining <= 0) {
        this.inFlight.delete(host);
      } else {
        this.inFlight.set(host, remaining);
      }
    }
  }

  /**
   * Record a finished pull only while it is still the recorded attempt. If the candidate moved
   * on while the pull ran, the newer attempt owns the entry and this result is dropped, so a
   * stale image is never reported as the current preload.
   */
  private settle(
    container: Container,
    candidate: string,
    state: Parameters<typeof setImagePreload>[1],
  ): void {
    if (peekImagePreload(container)?.candidate === candidate) {
      setImagePreload(container, state);
    }
  }
}
