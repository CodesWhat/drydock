import cron, { type ScheduledTask } from 'node-cron';
import { usesLegacyTriggerPrefix } from '../../configuration/index.js';
import * as event from '../../event/index.js';
import {
  type Container,
  fullName,
  isRollbackContainer as isRollbackContainerHelper,
} from '../../model/container.js';

const RECREATED_ALIAS_RE = /^[a-f0-9]{12}_(.+)$/i;

import { getTriggerCounter } from '../../prometheus/trigger.js';
import Component, { type ComponentConfiguration } from '../../registry/Component.js';
import * as storeContainer from '../../store/container.js';
import * as notificationStore from '../../store/notification.js';
import { renderBatch, renderSimple } from './trigger-expression-parser.js';
import {
  isThresholdReached as isThresholdReachedHelper,
  parseThresholdWithDigestBehavior as parseThresholdWithDigestBehaviorHelper,
  SUPPORTED_THRESHOLDS,
} from './trigger-threshold.js';

type SupportedThreshold = (typeof SUPPORTED_THRESHOLDS)[number];
type TriggerAutoMode = 'all' | 'oninclude' | 'none';
type NotificationRuleId =
  | 'update-available'
  | 'update-applied'
  | 'update-failed'
  | 'security-alert'
  | 'agent-disconnect'
  | 'agent-reconnect';

interface ContainerUpdateFailedPayload {
  containerName: string;
  error: string;
}

interface SecurityAlertPayload {
  containerName: string;
  details: string;
  status?: string;
  summary?: {
    unknown: number;
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  blockingCount?: number;
  container?: Container;
}

interface AgentDisconnectedPayload {
  agentName: string;
  reason?: string;
}

interface AgentConnectedPayload {
  agentName: string;
  reconnected: boolean;
}

interface TriggerNotificationEvent {
  kind: 'agent-disconnect' | 'agent-reconnect';
  agentName: string;
  reason?: string;
}

interface EventDispatchOptions extends notificationStore.NotificationRuleDispatchOptions {
  skipThreshold?: boolean;
}

const AUTO_TRIGGER_ERROR_SUPPRESSION_WINDOW_MS = 15_000;
const AUTO_TRIGGER_ERROR_SUPPRESSION_RETENTION_MS = AUTO_TRIGGER_ERROR_SUPPRESSION_WINDOW_MS * 4;
const AUTO_EVENT_BATCH_FLUSH_DELAY_MS = 250;
const TRIGGER_RELEASE_NOTES_BODY_MAX_LENGTH = 500;
const ACTION_TRIGGER_TYPES = new Set(['command', 'docker', 'dockercompose']);
export function buildLiteralTemplateExpression(expression: string): string {
  return `\${${expression}}`;
}

const AGENT_DISCONNECT_SIMPLE_TITLE_TEMPLATE = `Agent ${buildLiteralTemplateExpression('event.agentName')} disconnected`;
const AGENT_DISCONNECT_SIMPLE_BODY_TEMPLATE = `Agent ${buildLiteralTemplateExpression('event.agentName')} disconnected${buildLiteralTemplateExpression('event.reason ? ": " + event.reason : ""')}`;
const AGENT_RECONNECT_SIMPLE_TITLE_TEMPLATE = `Agent ${buildLiteralTemplateExpression('event.agentName')} reconnected`;
const AGENT_RECONNECT_SIMPLE_BODY_TEMPLATE = `Agent ${buildLiteralTemplateExpression('event.agentName')} reconnected`;
const AGENT_SIMPLE_TITLE_TEMPLATES: Record<TriggerNotificationEvent['kind'], string> = {
  'agent-disconnect': AGENT_DISCONNECT_SIMPLE_TITLE_TEMPLATE,
  'agent-reconnect': AGENT_RECONNECT_SIMPLE_TITLE_TEMPLATE,
};
const AGENT_SIMPLE_BODY_TEMPLATES: Record<TriggerNotificationEvent['kind'], string> = {
  'agent-disconnect': AGENT_DISCONNECT_SIMPLE_BODY_TEMPLATE,
  'agent-reconnect': AGENT_RECONNECT_SIMPLE_BODY_TEMPLATE,
};

function truncateReleaseNotesBody(body: string, maxLength: number) {
  if (body.length <= maxLength) {
    return body;
  }
  return body.slice(0, maxLength);
}

function buildAgentContainer(
  agentName: string,
  state: 'connected' | 'disconnected',
  eventKind: TriggerNotificationEvent['kind'],
  reason?: string,
): Container {
  return {
    id: `agent-${agentName}`,
    name: agentName,
    displayName: agentName,
    displayIcon: state === 'disconnected' ? 'mdi:server-network-off' : 'mdi:server-network',
    status: state,
    watcher: 'agent',
    image: {
      id: `agent-image-${agentName}`,
      registry: {
        name: 'agent',
        url: 'agent://local',
      },
      name: agentName,
      tag: {
        value: state,
        semver: false,
      },
      digest: {
        watch: false,
      },
      architecture: 'unknown',
      os: 'unknown',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'unknown',
      semverDiff: 'unknown',
    },
    error: reason
      ? {
          message: reason,
        }
      : undefined,
    notificationEvent: {
      kind: eventKind,
      agentName,
      reason: eventKind === 'agent-disconnect' ? reason : undefined,
    },
  } as Container;
}

function buildAgentDisconnectedContainer(agentName: string, reason?: string): Container {
  return buildAgentContainer(agentName, 'disconnected', 'agent-disconnect', reason);
}

function buildAgentReconnectedContainer(agentName: string): Container {
  return buildAgentContainer(agentName, 'connected', 'agent-reconnect');
}

export function getNotificationEvent(container: Container): TriggerNotificationEvent | undefined {
  const notificationEvent = Reflect.get(new Object(container), 'notificationEvent');
  if (!notificationEvent || typeof notificationEvent !== 'object') {
    return undefined;
  }

  const agentName = Reflect.get(new Object(notificationEvent), 'agentName');
  const reason = Reflect.get(new Object(notificationEvent), 'reason');
  if (typeof agentName !== 'string' || agentName.length === 0) {
    return undefined;
  }

  const kind = Reflect.get(new Object(notificationEvent), 'kind');
  if (kind !== 'agent-disconnect' && kind !== 'agent-reconnect') {
    return undefined;
  }

  return {
    kind,
    agentName,
    reason:
      kind === 'agent-disconnect' && typeof reason === 'string' && reason.length > 0
        ? reason
        : undefined,
  };
}

export function resolveNotificationTemplate(
  notificationEvent: TriggerNotificationEvent | undefined,
  templates: Record<TriggerNotificationEvent['kind'], string>,
  fallback: string,
) {
  if (!notificationEvent) {
    return fallback;
  }
  return templates[notificationEvent.kind] ?? fallback;
}

function isSupportedThreshold(value: string): value is SupportedThreshold {
  return SUPPORTED_THRESHOLDS.includes(value as SupportedThreshold);
}

export interface TriggerConfiguration extends ComponentConfiguration {
  auto?: boolean | TriggerAutoMode;
  order?: number;
  threshold?: string;
  mode?: string;
  once?: boolean;
  disabletitle?: boolean;
  simpletitle?: string;
  simplebody?: string;
  batchtitle?: string;
  digestcron?: string;
  resolvenotifications?: boolean;
}

interface ContainerReport {
  container: Container;
  changed: boolean;
}

interface EventBatchDispatchState {
  containers: Map<string, Container>;
  timer?: ReturnType<typeof setTimeout>;
}

function splitAndTrimCommaSeparatedList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Trigger base component.
 */
class Trigger extends Component {
  public configuration: TriggerConfiguration = {};
  public strictAgentMatch = false;
  private unregisterContainerReport?: () => void;
  private unregisterContainerReports?: () => void;
  private unregisterContainerUpdateAppliedForAutoDispatch?: () => void;
  private unregisterContainerUpdateFailed?: () => void;
  private unregisterSecurityAlert?: () => void;
  private unregisterAgentConnected?: () => void;
  private unregisterAgentDisconnected?: () => void;
  private unregisterContainerUpdateAppliedForResolution?: () => void;
  private readonly notificationResults: Map<string, unknown> = new Map();
  private readonly autoTriggerErrorSeenAt: Map<string, number> = new Map();
  private readonly digestBuffer: Map<string, Container> = new Map();
  private readonly eventBatchDispatches: Map<NotificationRuleId, EventBatchDispatchState> =
    new Map();
  private digestCronTask?: ScheduledTask;
  private isDigestFlushInProgress = false;

  static getSupportedThresholds() {
    return [...SUPPORTED_THRESHOLDS];
  }

  static parseThresholdWithDigestBehavior(threshold: string | undefined) {
    return parseThresholdWithDigestBehaviorHelper(threshold);
  }

  private static normalizeAutoMode(auto: TriggerConfiguration['auto']): TriggerAutoMode {
    if (auto === false) {
      return 'none';
    }
    if (auto === true || auto === undefined) {
      return 'all';
    }
    return auto.toLowerCase() as TriggerAutoMode;
  }

  private static normalizeMode(mode: TriggerConfiguration['mode']): string | undefined {
    return typeof mode === 'string' ? mode.toLowerCase() : undefined;
  }

  private static isBatchCapableMode(mode: TriggerConfiguration['mode']): boolean {
    const normalizedMode = Trigger.normalizeMode(mode);
    return normalizedMode === 'batch' || normalizedMode === 'batch+digest';
  }

  private static isDigestCapableMode(mode: TriggerConfiguration['mode']): boolean {
    const normalizedMode = Trigger.normalizeMode(mode);
    return normalizedMode === 'digest' || normalizedMode === 'batch+digest';
  }

  private getCategory() {
    return ACTION_TRIGGER_TYPES.has(this.type.toLowerCase()) ? 'action' : 'notification';
  }

  private getAutoMode() {
    return Trigger.normalizeAutoMode(this.configuration.auto);
  }

  private static getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'symbol') {
      return String(error);
    }
    return `${error}`;
  }

  /**
   * Return true if update reaches trigger threshold.
   * @param containerResult
   * @param threshold
   * @returns {boolean}
   */
  static isThresholdReached(containerResult: Container, threshold: string) {
    return isThresholdReachedHelper(containerResult, threshold);
  }

  /**
   * Parse $name:$threshold string.
   * @param {*} includeOrExcludeTriggerString
   * @returns
   */
  static parseIncludeOrIncludeTriggerString(includeOrExcludeTriggerString: string) {
    const hasThresholdSeparator = includeOrExcludeTriggerString.includes(':');
    const separatorIndex = hasThresholdSeparator ? includeOrExcludeTriggerString.indexOf(':') : -1;
    const hasMultipleSeparators =
      hasThresholdSeparator &&
      includeOrExcludeTriggerString.slice(separatorIndex + 1).includes(':');

    const triggerId = hasThresholdSeparator
      ? includeOrExcludeTriggerString.slice(0, separatorIndex).trim()
      : includeOrExcludeTriggerString.trim();
    const includeOrExcludeTrigger: { id: string; threshold: SupportedThreshold } = {
      id: triggerId,
      threshold: 'all',
    };

    if (hasThresholdSeparator && !hasMultipleSeparators) {
      const thresholdCandidate = includeOrExcludeTriggerString
        .slice(separatorIndex + 1)
        .trim()
        .toLowerCase();
      if (isSupportedThreshold(thresholdCandidate)) {
        includeOrExcludeTrigger.threshold = thresholdCandidate;
      }
    }

    return includeOrExcludeTrigger;
  }

  /**
   * Return true when a trigger reference matches a trigger id.
   * A reference can be either:
   * - full trigger id: docker.update
   * - trigger name only: update
   * @param triggerReference
   * @param triggerId
   */
  static doesReferenceMatchId(triggerReference: string, triggerId: string) {
    const triggerReferenceNormalized = triggerReference.toLowerCase();
    const triggerIdNormalized = triggerId.toLowerCase();

    if (triggerReferenceNormalized === triggerIdNormalized) {
      return true;
    }

    const triggerIdParts = triggerIdNormalized.split('.');
    const triggerName = triggerIdParts.at(-1);
    if (!triggerName) {
      return false;
    }
    if (triggerReferenceNormalized === triggerName) {
      return true;
    }

    if (triggerIdParts.length >= 2) {
      const provider = triggerIdParts.at(-2);
      const providerAndName = `${provider}.${triggerName}`;
      if (triggerReferenceNormalized === providerAndName) {
        return true;
      }
    }

    return false;
  }

  private isTriggerEnabledForRule(
    ruleId: NotificationRuleId,
    options: notificationStore.NotificationRuleDispatchOptions = {},
  ) {
    return notificationStore.isTriggerEnabledForRule(ruleId, this.getId(), options);
  }

  private findContainerByBusinessId(containerName: string): Container | undefined {
    return storeContainer
      .getContainers()
      .find((container) => fullName(container) === containerName);
  }

  private buildAutoTriggerErrorSignature(
    ruleId: NotificationRuleId,
    container: Container | undefined,
    errorMessage: string,
  ) {
    return `${this.getId()}|${ruleId}|${container?.watcher ?? 'unknown'}|${errorMessage}`;
  }

  private pruneAutoTriggerErrorCache(now: number) {
    const oldestAllowedTimestamp = now - AUTO_TRIGGER_ERROR_SUPPRESSION_RETENTION_MS;
    for (const [signature, seenAt] of this.autoTriggerErrorSeenAt.entries()) {
      if (seenAt < oldestAllowedTimestamp) {
        this.autoTriggerErrorSeenAt.delete(signature);
      }
    }
  }

  private shouldSuppressAutoTriggerError(
    ruleId: NotificationRuleId,
    container: Container | undefined,
    errorMessage: string,
  ) {
    const now = Date.now();
    const signature = this.buildAutoTriggerErrorSignature(ruleId, container, errorMessage);
    const previousSeenAt = this.autoTriggerErrorSeenAt.get(signature);
    this.autoTriggerErrorSeenAt.set(signature, now);
    this.pruneAutoTriggerErrorCache(now);

    return (
      previousSeenAt !== undefined &&
      now - previousSeenAt < AUTO_TRIGGER_ERROR_SUPPRESSION_WINDOW_MS
    );
  }

  private getOrCreateEventBatchDispatch(ruleId: NotificationRuleId): EventBatchDispatchState {
    const existing = this.eventBatchDispatches.get(ruleId);
    if (existing) {
      return existing;
    }

    const created: EventBatchDispatchState = {
      containers: new Map(),
    };
    this.eventBatchDispatches.set(ruleId, created);
    return created;
  }

  private buildEventBatchDispatchKey(container: Container): string {
    return container.id || fullName(container);
  }

  private async flushEventBatchDispatch(ruleId: NotificationRuleId, containers: Container[]) {
    if (containers.length === 0) {
      return;
    }

    try {
      await this.triggerBatch(containers);
    } catch (e: unknown) {
      const errorMessage = Trigger.getErrorMessage(e);
      const firstContainer = containers[0];
      if (this.shouldSuppressAutoTriggerError(ruleId, firstContainer, errorMessage)) {
        this.log.debug(`Suppressed repeated error handling ${ruleId} event (${errorMessage})`);
      } else {
        this.log.warn(`Error handling ${ruleId} event (${errorMessage})`);
      }
      this.log.debug(e);
    }
  }

  private queueEventBatchDispatch(ruleId: NotificationRuleId, container: Container) {
    const eventBatchDispatch = this.getOrCreateEventBatchDispatch(ruleId);
    eventBatchDispatch.containers.set(this.buildEventBatchDispatchKey(container), container);

    if (eventBatchDispatch.timer) {
      clearTimeout(eventBatchDispatch.timer);
    }

    eventBatchDispatch.timer = setTimeout(() => {
      const containers = Array.from(eventBatchDispatch.containers.values());
      eventBatchDispatch.containers.clear();
      eventBatchDispatch.timer = undefined;
      void this.flushEventBatchDispatch(ruleId, containers);
    }, AUTO_EVENT_BATCH_FLUSH_DELAY_MS);
  }

  private clearEventBatchDispatches() {
    for (const eventBatchDispatch of this.eventBatchDispatches.values()) {
      if (eventBatchDispatch.timer) {
        clearTimeout(eventBatchDispatch.timer);
      }
      eventBatchDispatch.containers.clear();
      eventBatchDispatch.timer = undefined;
    }
    this.eventBatchDispatches.clear();
  }

  private async dispatchContainerForEvent(
    ruleId: NotificationRuleId,
    container: Container | undefined,
    options: EventDispatchOptions = {},
  ) {
    if (!this.isTriggerEnabledForRule(ruleId, options)) {
      return;
    }

    if (!container) {
      this.log.debug(`No container found for ${ruleId} event => ignore`);
      return;
    }

    const threshold = (this.configuration.threshold ?? 'all').toLowerCase();
    if (!options.skipThreshold && !Trigger.isThresholdReached(container, threshold)) {
      this.log.debug(`Threshold not reached for ${ruleId} event => ignore`);
      return;
    }

    if (!this.mustTrigger(container)) {
      this.log.debug(`Trigger conditions not met for ${ruleId} event => ignore`);
      return;
    }

    try {
      // Agent connectivity notifications synthesize one-off container payloads and should always
      // dispatch immediately, even when the trigger itself is configured for batch updates.
      const shouldUseBatchMode =
        Trigger.isBatchCapableMode(this.configuration.mode) &&
        getNotificationEvent(container) === undefined;
      if (shouldUseBatchMode) {
        this.queueEventBatchDispatch(ruleId, container);
      } else {
        await this.trigger(container);
      }
    } catch (e: unknown) {
      const errorMessage = Trigger.getErrorMessage(e);
      if (this.shouldSuppressAutoTriggerError(ruleId, container, errorMessage)) {
        this.log.debug(`Suppressed repeated error handling ${ruleId} event (${errorMessage})`);
      } else {
        this.log.warn(`Error handling ${ruleId} event (${errorMessage})`);
      }
      this.log.debug(e);
    }
  }

  async handleContainerUpdateAppliedEvent(containerName: string) {
    // Evict from digest buffer — container is already updated, no need to notify.
    // containerName is the full business ID (watcher_name), matching the buffer key.
    if (this.digestBuffer.delete(containerName)) {
      this.log.debug(`Evicted ${containerName} from digest buffer (update applied)`);
    }

    await this.dispatchContainerForEvent(
      'update-applied',
      this.findContainerByBusinessId(containerName),
      {
        allowAllWhenNoTriggers: false,
        defaultWhenRuleMissing: false,
      },
    );
  }

  async handleContainerUpdateFailedEvent(payload: ContainerUpdateFailedPayload) {
    await this.dispatchContainerForEvent(
      'update-failed',
      this.findContainerByBusinessId(payload.containerName),
      {
        allowAllWhenNoTriggers: false,
        defaultWhenRuleMissing: false,
      },
    );
  }

  async handleSecurityAlertEvent(payload: SecurityAlertPayload) {
    const container = payload.container || this.findContainerByBusinessId(payload.containerName);
    await this.dispatchContainerForEvent('security-alert', container, {
      allowAllWhenNoTriggers: false,
      defaultWhenRuleMissing: false,
    });
  }

  async handleAgentDisconnectedEvent(payload: AgentDisconnectedPayload) {
    await this.dispatchContainerForEvent(
      'agent-disconnect',
      buildAgentDisconnectedContainer(payload.agentName, payload.reason),
      {
        allowAllWhenNoTriggers: false,
        defaultWhenRuleMissing: false,
        skipThreshold: true,
      },
    );
  }

  async handleAgentConnectedEvent(payload: AgentConnectedPayload) {
    if (!payload.reconnected) {
      return;
    }

    await this.dispatchContainerForEvent(
      'agent-reconnect',
      buildAgentReconnectedContainer(payload.agentName),
      {
        allowAllWhenNoTriggers: false,
        defaultWhenRuleMissing: false,
        skipThreshold: true,
      },
    );
  }

  private isUpdateAvailableAutoTriggerEnabled() {
    // Keep backward compatibility: if update-available has no explicit trigger
    // allow-list yet, legacy auto trigger behavior remains enabled.
    return this.isTriggerEnabledForRule('update-available', {
      allowAllWhenNoTriggers: true,
      defaultWhenRuleMissing: true,
    });
  }

  private shouldHandleSimpleContainerReport(containerReport: ContainerReport) {
    return (
      (containerReport.changed || !this.configuration.once) &&
      containerReport.container.updateAvailable
    );
  }

  private getContainerLogger(container: Container): Component['log'] {
    return (
      this.log.child({
        container: fullName(container),
      }) || this.log
    );
  }

  private getSimpleModeThreshold() {
    return (this.configuration.threshold ?? 'all').toLowerCase();
  }

  private async runUpdateAvailableSimpleTrigger(
    container: Container,
    logContainer: Component['log'],
  ) {
    if (!Trigger.isThresholdReached(container, this.getSimpleModeThreshold())) {
      logContainer.debug('Threshold not reached => ignore');
      return;
    }

    if (!this.mustTrigger(container)) {
      logContainer.debug('Trigger conditions not met => ignore');
      return;
    }

    logContainer.debug('Run');
    const result = await this.trigger(container);
    if (this.configuration.resolvenotifications && result) {
      this.notificationResults.set(fullName(container), result);
    }
  }

  private handleUpdateAvailableSimpleTriggerError(
    error: unknown,
    container: Container,
    logContainer: Component['log'],
  ) {
    const errorMessage = Trigger.getErrorMessage(error);
    if (this.shouldSuppressAutoTriggerError('update-available', container, errorMessage)) {
      logContainer.debug(`Suppressed repeated error (${errorMessage})`);
    } else {
      logContainer.warn(`Error (${errorMessage})`);
    }
    logContainer.debug(error);
  }

  private incrementTriggerCounter(status: 'success' | 'error') {
    getTriggerCounter()?.inc({
      type: this.type,
      name: this.name,
      status,
    });
  }

  /**
   * Handle container report (simple mode).
   * @param containerReport
   * @returns {Promise<void>}
   */
  async handleContainerReport(containerReport: ContainerReport) {
    if (!this.isUpdateAvailableAutoTriggerEnabled()) {
      return;
    }

    // Strip Docker recreate alias prefixes before any trigger processing
    Trigger.canonicalizeReportName(containerReport);

    // Filter on changed containers with update available and passing trigger threshold
    if (!this.shouldHandleSimpleContainerReport(containerReport)) {
      return;
    }

    const { container } = containerReport;
    const logContainer = this.getContainerLogger(container);
    let status: 'success' | 'error' = 'error';
    try {
      await this.runUpdateAvailableSimpleTrigger(container, logContainer);
      status = 'success';
    } catch (e: unknown) {
      this.handleUpdateAvailableSimpleTriggerError(e, container, logContainer);
    } finally {
      this.incrementTriggerCounter(status);
    }
  }

  /**
   * Handle container reports (batch mode).
   * @param containerReports
   * @returns {Promise<void>}
   */
  async handleContainerReports(containerReports: ContainerReport[]) {
    if (!this.isUpdateAvailableAutoTriggerEnabled()) {
      return;
    }

    // Strip Docker recreate alias prefixes before any trigger processing
    for (const report of containerReports) {
      Trigger.canonicalizeReportName(report);
    }

    // Filter on containers with update available and passing trigger threshold
    try {
      const containerReportsFiltered = containerReports
        .filter((containerReport) => containerReport.changed || !this.configuration.once)
        .filter((containerReport) => containerReport.container.updateAvailable)
        .filter((containerReport) => this.mustTrigger(containerReport.container))
        .filter((containerReport) =>
          Trigger.isThresholdReached(
            containerReport.container,
            (this.configuration.threshold || 'all').toLowerCase(),
          ),
        );
      const containersFiltered = containerReportsFiltered.map(
        (containerReport) => containerReport.container,
      );
      if (containersFiltered.length > 0) {
        this.log.debug('Run batch');
        await this.triggerBatch(containersFiltered);
      }
    } catch (e: unknown) {
      const errorMessage = Trigger.getErrorMessage(e);
      if (this.shouldSuppressAutoTriggerError('update-available', undefined, errorMessage)) {
        this.log.debug(`Suppressed repeated error (${errorMessage})`);
      } else {
        this.log.warn(`Error (${errorMessage})`);
      }
      this.log.debug(e);
    }
  }

  /**
   * Buffer a container for digest mode. Keyed by full name so the latest
   * update for each container wins if multiple scans fire before the digest
   * cron flushes.
   */
  private bufferContainerForDigest(container: Container) {
    this.digestBuffer.set(fullName(container), container);
    this.log.debug(
      `Buffered ${fullName(container)} for digest (${this.digestBuffer.size} buffered)`,
    );
  }

  /**
   * Handle container report (digest mode — single container from simple event).
   */
  async handleContainerReportDigest(containerReport: ContainerReport) {
    if (!this.isUpdateAvailableAutoTriggerEnabled()) {
      return;
    }
    if (!this.shouldHandleSimpleContainerReport(containerReport)) {
      return;
    }
    const { container } = containerReport;
    if (!Trigger.isThresholdReached(container, this.getSimpleModeThreshold())) {
      return;
    }
    if (!this.mustTrigger(container)) {
      return;
    }
    this.bufferContainerForDigest(container);
  }

  /**
   * Flush the digest buffer: send a single batch notification with all
   * accumulated containers, then clear the buffer.
   */
  async flushDigestBuffer() {
    if (this.isDigestFlushInProgress) {
      this.log.debug('Digest flush already in progress');
      return;
    }
    if (this.digestBuffer.size === 0) {
      this.log.debug('Digest cron fired — buffer empty, nothing to send');
      return;
    }
    const bufferedEntries = Array.from(this.digestBuffer.entries());
    const containers = bufferedEntries.map(([, container]) => container);
    this.log.info(`Digest flush: sending ${containers.length} update(s)`);
    let status: 'success' | 'error' = 'error';
    this.isDigestFlushInProgress = true;
    try {
      await this.triggerBatch(containers);
      status = 'success';
      for (const [containerName, bufferedContainer] of bufferedEntries) {
        if (this.digestBuffer.get(containerName) === bufferedContainer) {
          this.digestBuffer.delete(containerName);
        }
      }
    } catch (e: unknown) {
      this.log.warn(`Digest flush failed (${Trigger.getErrorMessage(e)})`);
      this.log.debug(e);
    } finally {
      this.isDigestFlushInProgress = false;
      this.incrementTriggerCounter(status);
    }
  }

  isTriggerIncludedOrExcluded(containerResult: Container, trigger: string) {
    const triggerId = this.getId().toLowerCase();
    const triggers = splitAndTrimCommaSeparatedList(trigger).map((triggerToMatch) =>
      Trigger.parseIncludeOrIncludeTriggerString(triggerToMatch),
    );
    const triggerMatched = triggers.find((triggerToMatch) =>
      Trigger.doesReferenceMatchId(triggerToMatch.id, triggerId),
    );
    if (!triggerMatched) {
      return false;
    }
    return Trigger.isThresholdReached(containerResult, triggerMatched.threshold.toLowerCase());
  }

  isTriggerIncluded(containerResult: Container, triggerInclude: string | undefined) {
    if (!triggerInclude) {
      return this.getAutoMode() !== 'oninclude';
    }
    return this.isTriggerIncludedOrExcluded(containerResult, triggerInclude);
  }

  isTriggerExcluded(containerResult: Container, triggerExclude: string | undefined) {
    if (!triggerExclude) {
      return false;
    }
    return this.isTriggerIncludedOrExcluded(containerResult, triggerExclude);
  }

  /**
   * Return true if must trigger on this container.
   * @param containerResult
   * @returns {boolean}
   */
  /**
   * Strip Docker recreate alias prefix from a container report's name.
   * Belt-and-suspenders guard — the watcher should have already canonicalized,
   * but this catches any remaining leaks regardless of environment quirks.
   */
  static canonicalizeReportName(report: ContainerReport): void {
    const name = report.container?.name;
    if (typeof name !== 'string') return;
    const match = name.match(RECREATED_ALIAS_RE);
    if (match) {
      report.container.name = match[1];
    }
  }

  static isRollbackContainer(container: { name?: unknown }): boolean {
    return isRollbackContainerHelper(container);
  }

  mustTrigger(containerResult: Container) {
    if (Trigger.isRollbackContainer(containerResult)) {
      return false;
    }
    if (this.agent && this.agent !== containerResult.agent) {
      return false;
    }
    if (this.strictAgentMatch && this.agent !== containerResult.agent) {
      return false;
    }
    const { triggerInclude, triggerExclude } = containerResult;
    return (
      this.isTriggerIncluded(containerResult, triggerInclude) &&
      !this.isTriggerExcluded(containerResult, triggerExclude)
    );
  }

  /**
   * Init the Trigger.
   */
  async init() {
    await this.initTrigger();
    if (this.getAutoMode() !== 'none') {
      const autoMode = this.getAutoMode();
      const normalizedMode = Trigger.normalizeMode(this.configuration.mode);
      const shouldRegisterBatchHandler = Trigger.isBatchCapableMode(this.configuration.mode);
      const shouldRegisterDigestHandler = Trigger.isDigestCapableMode(this.configuration.mode);
      this.log.info(
        autoMode === 'oninclude'
          ? 'Registering for auto execution (only containers with explicit include labels)'
          : 'Registering for auto execution (all watched containers)',
      );
      if (normalizedMode === 'simple') {
        this.unregisterContainerReport = event.registerContainerReport(
          async (containerReport) => this.handleContainerReport(containerReport),
          {
            id: this.getId(),
            order: this.configuration.order,
          },
        );
      }
      if (shouldRegisterBatchHandler) {
        this.unregisterContainerReports = event.registerContainerReports(
          async (containersReports) => this.handleContainerReports(containersReports),
          {
            id: this.getId(),
            order: this.configuration.order,
          },
        );
      }
      if (shouldRegisterDigestHandler) {
        this.unregisterContainerReport = event.registerContainerReport(
          async (containerReport) => this.handleContainerReportDigest(containerReport),
          {
            id: this.getId(),
            order: this.configuration.order,
          },
        );
        const digestCronExpression = this.configuration.digestcron ?? '0 8 * * *';
        this.digestCronTask = cron.schedule(digestCronExpression, () => {
          void this.flushDigestBuffer();
        });
        this.log.info(`Digest scheduled (${digestCronExpression})`);
      }

      this.unregisterContainerUpdateAppliedForAutoDispatch = event.registerContainerUpdateApplied(
        async (containerName) => this.handleContainerUpdateAppliedEvent(containerName),
        {
          id: this.getId(),
          order: this.configuration.order,
        },
      );
      this.unregisterContainerUpdateFailed = event.registerContainerUpdateFailed(
        async (payload) => this.handleContainerUpdateFailedEvent(payload),
        {
          id: this.getId(),
          order: this.configuration.order,
        },
      );
      this.unregisterSecurityAlert = event.registerSecurityAlert(
        async (payload) => this.handleSecurityAlertEvent(payload),
        {
          id: this.getId(),
          order: this.configuration.order,
        },
      );
      this.unregisterAgentConnected = event.registerAgentConnected(
        async (payload) => this.handleAgentConnectedEvent(payload),
        {
          id: this.getId(),
          order: this.configuration.order,
        },
      );
      this.unregisterAgentDisconnected = event.registerAgentDisconnected(
        async (payload) => this.handleAgentDisconnectedEvent(payload),
        {
          id: this.getId(),
          order: this.configuration.order,
        },
      );
    } else {
      this.log.info(`Registering for manual execution`);
    }
    if (this.configuration.resolvenotifications) {
      this.log.info('Registering for notification resolution');
      this.unregisterContainerUpdateAppliedForResolution = event.registerContainerUpdateApplied(
        async (containerId) => this.handleContainerUpdateApplied(containerId),
      );
    }
  }

  async deregisterComponent(): Promise<void> {
    this.unregisterContainerReport?.();
    this.unregisterContainerReport = undefined;

    this.unregisterContainerReports?.();
    this.unregisterContainerReports = undefined;

    this.unregisterContainerUpdateAppliedForAutoDispatch?.();
    this.unregisterContainerUpdateAppliedForAutoDispatch = undefined;

    this.unregisterContainerUpdateFailed?.();
    this.unregisterContainerUpdateFailed = undefined;

    this.unregisterSecurityAlert?.();
    this.unregisterSecurityAlert = undefined;

    this.unregisterAgentConnected?.();
    this.unregisterAgentConnected = undefined;

    this.unregisterAgentDisconnected?.();
    this.unregisterAgentDisconnected = undefined;

    this.unregisterContainerUpdateAppliedForResolution?.();
    this.unregisterContainerUpdateAppliedForResolution = undefined;

    this.digestCronTask?.stop();
    this.digestCronTask = undefined;
    this.isDigestFlushInProgress = false;
    this.digestBuffer.clear();
    this.clearEventBatchDispatches();

    this.autoTriggerErrorSeenAt.clear();
  }

  /**
   * Override method to merge with common Trigger options (threshold...).
   * @param configuration
   * @returns {*}
   */
  validateConfiguration(configuration: TriggerConfiguration): TriggerConfiguration {
    const schema = this.getConfigurationSchema() as ReturnType<typeof this.joi.object>;
    const schemaWithDefaultOptions = schema.append({
      auto: this.joi
        .alternatives()
        .try(this.joi.bool(), this.joi.string().insensitive().valid('all', 'oninclude', 'none'))
        .default(this.getCategory() === 'action' ? 'oninclude' : true),
      order: this.joi.number().default(100),
      threshold: this.joi
        .string()
        .insensitive()
        .valid(...Trigger.getSupportedThresholds())
        .default('all'),
      mode: this.joi
        .string()
        .insensitive()
        .valid('simple', 'batch', 'digest', 'batch+digest')
        .default('simple'),
      once: this.joi.boolean().default(true),
      digestcron: this.joi
        .string()
        .default('0 8 * * *')
        .custom((value, helpers) => {
          if (!cron.validate(value)) {
            return helpers.error('string.pattern.base', { value });
          }
          return value;
        })
        .messages({ 'string.pattern.base': 'digestcron must be a valid cron expression' }),
      simpletitle: this.joi
        .string()
        .default('New ${container.updateKind.kind} found for container ${container.name}'),
      simplebody: this.joi
        .string()
        .default(
          'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',
        ),
      batchtitle: this.joi.string().default('${containers.length} updates available'),
      resolvenotifications: this.joi.boolean().default(false),
    });
    const schemaValidated = schemaWithDefaultOptions.validate(configuration);
    if (schemaValidated.error) {
      throw schemaValidated.error;
    }
    const normalizedConfiguration = schemaValidated.value as TriggerConfiguration;
    normalizedConfiguration.auto = Trigger.normalizeAutoMode(normalizedConfiguration.auto);
    return normalizedConfiguration;
  }

  /**
   * Init Trigger. Can be overridden in trigger implementation class.
   */

  initTrigger(): void | Promise<void> {
    // do nothing by default
  }

  /**
   * Preview what an update would do without performing it.
   * Can be overridden in trigger implementation class.
   */
  async preview(_container: Container): Promise<Record<string, unknown>> {
    return {};
  }

  /**
   * Trigger method. Must be overridden in trigger implementation class.
   */
  async trigger(containerWithResult: Container): Promise<unknown> {
    // do nothing by default
    this.log.warn('Cannot trigger container result; this trigger does not implement "simple" mode');
    return containerWithResult;
  }

  /**
   * Trigger batch method. Must be overridden in trigger implementation class.
   * @param containersWithResult
   * @returns {*}
   */
  async triggerBatch(containersWithResult: Container[]): Promise<unknown> {
    // do nothing by default
    this.log.warn('Cannot trigger container results; this trigger does not implement "batch" mode');
    return containersWithResult;
  }

  getMetadata(): Record<string, unknown> {
    return {
      category: this.getCategory(),
      usesLegacyPrefix: usesLegacyTriggerPrefix(this.type, this.name),
    };
  }

  /**
   * Handle container update applied event.
   * Dismiss the stored notification for the updated container.
   * @param containerId
   */
  async handleContainerUpdateApplied(containerId: string) {
    const triggerResult = this.notificationResults.get(containerId);
    if (!triggerResult) {
      return;
    }
    try {
      this.log.info(`Dismissing notification for container ${containerId}`);
      await this.dismiss(containerId, triggerResult);
    } catch (e: unknown) {
      this.log.warn(
        `Error dismissing notification for container ${containerId} (${Trigger.getErrorMessage(e)})`,
      );
      this.log.debug(e);
    } finally {
      this.notificationResults.delete(containerId);
    }
  }

  /**
   * Dismiss a previously sent notification.
   * Override in trigger implementations that support notification deletion.
   * @param containerId the container identifier
   * @param triggerResult the result returned by trigger() when the notification was sent
   */
  async dismiss(_containerId: string, _triggerResult: unknown): Promise<void> {
    // do nothing by default
  }

  /**
   * Compose a single-container message with optional title.
   * Providers needing custom formatting should override formatTitleAndBody().
   */
  protected composeMessage(container: Container): string {
    const body = this.renderSimpleBody(container);
    if (this.configuration.disabletitle) {
      return body;
    }
    const title = this.renderSimpleTitle(container);
    return this.formatTitleAndBody(title, body);
  }

  /**
   * Compose a batch message with optional title.
   * Providers needing custom formatting should override formatTitleAndBody().
   */
  protected composeBatchMessage(containers: Container[]): string {
    const body = this.renderBatchBody(containers);
    if (this.configuration.disabletitle) {
      return body;
    }
    const title = this.renderBatchTitle(containers);
    return this.formatTitleAndBody(title, body);
  }

  /**
   * Format title and body into a single message string.
   * Override in subclasses for custom formatting (e.g. bold, markdown).
   */
  protected formatTitleAndBody(title: string, body: string): string {
    return `${title}\n\n${body}`;
  }

  /**
   * Mask the specified fields in the configuration, returning a copy.
   * For simple flat-field masking; providers with nested fields should
   * override maskConfiguration() directly.
   */
  protected maskFields(fieldsToMask: string[]): Record<string, unknown> {
    const masked: Record<string, unknown> = { ...this.configuration };
    for (const field of fieldsToMask) {
      const value = masked[field];
      if (typeof value === 'string' && value.length > 0) {
        masked[field] = (this.constructor as typeof Trigger).mask(value);
      }
    }
    return masked;
  }

  /**
   * Build the container template context used by trigger body/title rendering.
   * Release notes bodies are shortened for notifications to avoid excessively long payloads.
   */
  private getTemplateContainer(container: Container): Container {
    const releaseNotes = container.result?.releaseNotes;
    if (!releaseNotes || typeof releaseNotes.body !== 'string') {
      return container;
    }

    return {
      ...container,
      result: {
        ...container.result,
        releaseNotes: {
          ...releaseNotes,
          body: truncateReleaseNotesBody(releaseNotes.body, TRIGGER_RELEASE_NOTES_BODY_MAX_LENGTH),
        },
      },
    };
  }

  /**
   * Render trigger title simple.
   * @param container
   * @returns {*}
   */
  renderSimpleTitle(container: Container) {
    const notificationEvent = getNotificationEvent(container);
    const template = resolveNotificationTemplate(
      notificationEvent,
      AGENT_SIMPLE_TITLE_TEMPLATES,
      this.configuration.simpletitle ?? '',
    );
    return renderSimple(template, this.getTemplateContainer(container));
  }

  /**
   * Render trigger body simple.
   * @param container
   * @returns {*}
   */
  renderSimpleBody(container: Container) {
    const notificationEvent = getNotificationEvent(container);
    const template = resolveNotificationTemplate(
      notificationEvent,
      AGENT_SIMPLE_BODY_TEMPLATES,
      this.configuration.simplebody ?? '',
    );
    return renderSimple(template, this.getTemplateContainer(container));
  }

  /**
   * Render trigger title batch.
   * @param containers
   * @returns {*}
   */
  renderBatchTitle(containers: Container[]) {
    return renderBatch(this.configuration.batchtitle ?? '', containers);
  }

  /**
   * Render trigger body batch.
   * @param containers
   * @returns {*}
   */
  renderBatchBody(containers: Container[]) {
    return containers.map((container) => `- ${this.renderSimpleBody(container)}\n`).join('\n');
  }
}

export default Trigger;
