import cron, { type ScheduledTask } from 'node-cron';
import { getAgents } from '../../agent/manager.js';
import { getServerName, usesLegacyTriggerPrefix } from '../../configuration/index.js';
import * as event from '../../event/index.js';
import {
  type Container,
  fullName,
  isRollbackContainer as isRollbackContainerHelper,
} from '../../model/container.js';

const RECREATED_ALIAS_RE = /^[a-f0-9]{12}_(.+)$/i;

import { getTriggerCounter } from '../../prometheus/trigger.js';
import Component, { type ComponentConfiguration } from '../../registry/Component.js';
import * as auditStore from '../../store/audit.js';
import * as storeContainer from '../../store/container.js';
import * as notificationStore from '../../store/notification.js';
import * as notificationHistoryStore from '../../store/notification-history.js';
import {
  enqueueContainerUpdate,
  enqueueContainerUpdates,
  runAcceptedContainerUpdates,
  UpdateRequestError,
} from '../../updates/request-update.js';
import { renderBatch, renderSimple } from './trigger-expression-parser.js';
import {
  isThresholdReached as isThresholdReachedHelper,
  parseThresholdWithDigestBehavior as parseThresholdWithDigestBehaviorHelper,
  SUPPORTED_THRESHOLDS,
} from './trigger-threshold.js';

type SupportedThreshold = (typeof SUPPORTED_THRESHOLDS)[number];
type TriggerAutoMode = 'all' | 'oninclude' | 'none';
type DigestEventKind = 'update-available-digest' | 'security-alert-digest';
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

interface SecurityAlertSummary {
  unknown: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

interface SecurityAlertPayload {
  containerName: string;
  details: string;
  status?: string;
  summary?: SecurityAlertSummary;
  blockingCount?: number;
  container?: Container;
  cycleId?: string;
}

interface AgentDisconnectedPayload {
  agentName: string;
  reason?: string;
}

interface AgentConnectedPayload {
  agentName: string;
  reconnected: boolean;
}

type ContainerUpdateAppliedEventPayload = event.ContainerUpdateAppliedEvent;

interface UpdateAppliedNotificationEvent {
  kind: 'update-applied';
}

interface UpdateFailedNotificationEvent {
  kind: 'update-failed';
  error?: string;
}

interface SecurityAlertNotificationEvent {
  kind: 'security-alert';
  details?: string;
  status?: string;
  summary?: SecurityAlertPayload['summary'];
  blockingCount?: number;
}

interface AgentDisconnectedNotificationEvent {
  kind: 'agent-disconnect';
  agentName: string;
  reason?: string;
}

interface AgentReconnectedNotificationEvent {
  kind: 'agent-reconnect';
  agentName: string;
}

type TriggerNotificationEvent =
  | UpdateAppliedNotificationEvent
  | UpdateFailedNotificationEvent
  | SecurityAlertNotificationEvent
  | AgentDisconnectedNotificationEvent
  | AgentReconnectedNotificationEvent;

type TriggerContainer = Container & {
  notificationEvent?: TriggerNotificationEvent;
};

export type TriggerNotificationContainer = Container & {
  notificationEvent: TriggerNotificationEvent;
};

type TriggerTemplateContainer = Container & {
  notificationWatcherSuffix: string;
  notificationAgentPrefix: string;
  notificationServerName: string;
};

interface EventDispatchOptions extends notificationStore.NotificationRuleDispatchOptions {
  skipThreshold?: boolean;
}

const AUTO_TRIGGER_ERROR_SUPPRESSION_WINDOW_MS = 15_000;
const AUTO_TRIGGER_ERROR_SUPPRESSION_RETENTION_MS = AUTO_TRIGGER_ERROR_SUPPRESSION_WINDOW_MS * 4;
const AUTO_EVENT_BATCH_FLUSH_DELAY_MS = 250;
const UPDATE_ACTION_TRIGGER_TYPES = new Set(['docker', 'dockercompose']);

function getContainerNotificationKey(
  container: Pick<Container, 'id' | 'name' | 'watcher'> | undefined,
): string | undefined {
  if (!container || typeof container !== 'object') {
    return undefined;
  }

  if (typeof container.id === 'string' && container.id !== '') {
    return container.id;
  }

  if (
    typeof container.watcher === 'string' &&
    container.watcher !== '' &&
    typeof container.name === 'string' &&
    container.name !== ''
  ) {
    return fullName(container as Container);
  }

  return undefined;
}

function getContainerUpdateAppliedEventContainerName(
  payload: ContainerUpdateAppliedEventPayload,
): string | undefined {
  if (typeof payload === 'string') {
    return payload || undefined;
  }

  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  return typeof payload.containerName === 'string' && payload.containerName !== ''
    ? payload.containerName
    : undefined;
}

function getContainerUpdateAppliedEventNotificationKey(
  payload: ContainerUpdateAppliedEventPayload,
): string | undefined {
  if (typeof payload === 'string') {
    return payload || undefined;
  }

  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const payloadContainer =
    'container' in payload ? (payload.container as Container | undefined) : undefined;

  return (
    getContainerNotificationKey(payloadContainer) ??
    getContainerUpdateAppliedEventContainerName(payload)
  );
}
const TRIGGER_RELEASE_NOTES_BODY_MAX_LENGTH = 500;
const ACTION_TRIGGER_TYPES = new Set(['command', 'docker', 'dockercompose']);
export function buildLiteralTemplateExpression(expression: string): string {
  return `\${${expression}}`;
}

const DEFAULT_SIMPLE_TITLE_DIGEST_EXPRESSION =
  'container.notificationAgentPrefix + "New image available for container " + container.name + container.notificationWatcherSuffix + " (tag " + currentTag + ")"';
const DEFAULT_SIMPLE_TITLE_UPDATE_EXPRESSION =
  'container.notificationAgentPrefix + "New " + container.updateKind.kind + " found for container " + container.name + container.notificationWatcherSuffix';
const DEFAULT_SIMPLE_BODY_DIGEST_EXPRESSION =
  '"Container " + container.name + container.notificationWatcherSuffix + " running tag " + currentTag + " has a newer image available"';
const DEFAULT_SIMPLE_BODY_UPDATE_EXPRESSION =
  '"Container " + container.name + container.notificationWatcherSuffix + " running with " + container.updateKind.kind + " " + container.updateKind.localValue + " can be updated to " + container.updateKind.kind + " " + container.updateKind.remoteValue';
const DEFAULT_SIMPLE_BODY_RESULT_LINK_EXPRESSION =
  'container.result && container.result.link ? "\\n" + container.result.link : ""';
const DEFAULT_SIMPLE_TITLE_TEMPLATE = buildLiteralTemplateExpression(
  `isDigestUpdate ? ${DEFAULT_SIMPLE_TITLE_DIGEST_EXPRESSION} : ${DEFAULT_SIMPLE_TITLE_UPDATE_EXPRESSION}`,
);
const DEFAULT_SIMPLE_BODY_TEMPLATE = `${buildLiteralTemplateExpression(
  `isDigestUpdate ? ${DEFAULT_SIMPLE_BODY_DIGEST_EXPRESSION} : ${DEFAULT_SIMPLE_BODY_UPDATE_EXPRESSION}`,
)}${buildLiteralTemplateExpression(DEFAULT_SIMPLE_BODY_RESULT_LINK_EXPRESSION)}`;

const AGENT_DISCONNECT_SIMPLE_TITLE_TEMPLATE = `Agent ${buildLiteralTemplateExpression('event.agentName')} disconnected`;
const AGENT_DISCONNECT_SIMPLE_BODY_TEMPLATE = `Agent ${buildLiteralTemplateExpression('event.agentName')} disconnected${buildLiteralTemplateExpression('event.reason ? ": " + event.reason : ""')}`;
const AGENT_RECONNECT_SIMPLE_TITLE_TEMPLATE = `Agent ${buildLiteralTemplateExpression('event.agentName')} reconnected`;
const AGENT_RECONNECT_SIMPLE_BODY_TEMPLATE = `Agent ${buildLiteralTemplateExpression('event.agentName')} reconnected`;
const UPDATE_APPLIED_SIMPLE_TITLE_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Container ${buildLiteralTemplateExpression('container.name')} updated successfully`;
const UPDATE_APPLIED_SIMPLE_BODY_TEMPLATE = `Container ${buildLiteralTemplateExpression('container.name')} updated successfully`;
const UPDATE_FAILED_SIMPLE_TITLE_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Container ${buildLiteralTemplateExpression('container.name')} update failed`;
const UPDATE_FAILED_SIMPLE_BODY_TEMPLATE = `Container ${buildLiteralTemplateExpression('container.name')} update failed${buildLiteralTemplateExpression('event.error ? ": " + event.error : ""')}`;
const SECURITY_ALERT_SIMPLE_TITLE_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Security alert for container ${buildLiteralTemplateExpression('container.name')}`;
const SECURITY_ALERT_SIMPLE_BODY_TEMPLATE = `Security alert for container ${buildLiteralTemplateExpression('container.name')}${buildLiteralTemplateExpression('event.blockingCount ? " (" + event.blockingCount + " blocking vulnerabilities)" : ""')}${buildLiteralTemplateExpression('event.details ? "\\n" + event.details : ""')}`;
const NOTIFICATION_SIMPLE_TITLE_TEMPLATES: Partial<
  Record<TriggerNotificationEvent['kind'], string>
> = {
  'update-applied': UPDATE_APPLIED_SIMPLE_TITLE_TEMPLATE,
  'update-failed': UPDATE_FAILED_SIMPLE_TITLE_TEMPLATE,
  'security-alert': SECURITY_ALERT_SIMPLE_TITLE_TEMPLATE,
  'agent-disconnect': AGENT_DISCONNECT_SIMPLE_TITLE_TEMPLATE,
  'agent-reconnect': AGENT_RECONNECT_SIMPLE_TITLE_TEMPLATE,
};
const NOTIFICATION_SIMPLE_BODY_TEMPLATES: Partial<
  Record<TriggerNotificationEvent['kind'], string>
> = {
  'update-applied': UPDATE_APPLIED_SIMPLE_BODY_TEMPLATE,
  'update-failed': UPDATE_FAILED_SIMPLE_BODY_TEMPLATE,
  'security-alert': SECURITY_ALERT_SIMPLE_BODY_TEMPLATE,
  'agent-disconnect': AGENT_DISCONNECT_SIMPLE_BODY_TEMPLATE,
  'agent-reconnect': AGENT_RECONNECT_SIMPLE_BODY_TEMPLATE,
};
const NOTIFICATION_BATCH_TITLE_TEMPLATES: Partial<
  Record<TriggerNotificationEvent['kind'], string>
> = {
  'update-applied': `${buildLiteralTemplateExpression('containers.length')} updates applied`,
  'update-failed': `${buildLiteralTemplateExpression('containers.length')} updates failed`,
  'security-alert': `${buildLiteralTemplateExpression('containers.length')} security alerts`,
};

/** Per-container row used in the security digest body template. */
interface SecurityDigestContainerRow {
  name: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

/**
 * Context passed to formatDigestTitle / formatDigestBody.
 * Discriminated on `kind` so each branch has access to exactly the fields it needs.
 */
type UpdateDigestContext = {
  kind: 'update';
  containers: Container[];
};

type SecurityDigestContext = {
  kind: 'security';
  containers: SecurityDigestContainerRow[];
  scannedCount: number;
  alertCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  unknownCount: number;
  startedAt: string;
  completedAt: string;
  cycleId: string;
};

type DigestContext = UpdateDigestContext | SecurityDigestContext;

const DEFAULT_SECURITY_DIGEST_TITLE_TEMPLATE = `Security scan complete: \${scan.alertCount} container\${scan.alertCount === 1 ? '' : 's'} with findings`;

const DEFAULT_SECURITY_DIGEST_BODY_TEMPLATE = `Security scan complete: \${scan.alertCount} of \${scan.scannedCount} containers have findings.

CRITICAL (\${scan.criticalCount}):
\${scan.containers.filter(c => c.critical > 0).map(c => '- ' + c.name + ': critical=' + c.critical + ', high=' + c.high).join('\\n')}

HIGH (\${scan.highCount}):
\${scan.containers.filter(c => c.critical === 0 && c.high > 0).map(c => '- ' + c.name + ': high=' + c.high + ', medium=' + c.medium).join('\\n')}

Scan ran from \${scan.startedAt} to \${scan.completedAt}.`;

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
): TriggerNotificationContainer {
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
  };
}

function buildAgentDisconnectedContainer(
  agentName: string,
  reason?: string,
): TriggerNotificationContainer {
  return buildAgentContainer(agentName, 'disconnected', 'agent-disconnect', reason);
}

function buildAgentReconnectedContainer(agentName: string): TriggerNotificationContainer {
  return buildAgentContainer(agentName, 'connected', 'agent-reconnect');
}

function withNotificationEvent(
  container: Container,
  notificationEvent: TriggerNotificationEvent,
): TriggerNotificationContainer {
  return {
    ...container,
    notificationEvent,
  };
}

function safeGet(target: unknown, property: string): unknown {
  return Reflect.get(Object(target), property);
}

function getNonEmptyString(target: unknown, property: string): string | undefined {
  const value = safeGet(target, property);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getFiniteNumber(target: unknown, property: string): number | undefined {
  const value = safeGet(target, property);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getObjectProperty<T extends object>(target: unknown, property: string): T | undefined {
  const value = safeGet(target, property);
  return value && typeof value === 'object' ? (value as T) : undefined;
}

function getUpdateFailedNotificationEvent(
  notificationEvent: unknown,
): UpdateFailedNotificationEvent {
  return {
    kind: 'update-failed',
    error: getNonEmptyString(notificationEvent, 'error'),
  };
}

function getSecurityAlertNotificationEvent(
  notificationEvent: unknown,
): SecurityAlertNotificationEvent {
  return {
    kind: 'security-alert',
    details: getNonEmptyString(notificationEvent, 'details'),
    status: getNonEmptyString(notificationEvent, 'status'),
    summary: getObjectProperty<SecurityAlertPayload['summary']>(notificationEvent, 'summary'),
    blockingCount: getFiniteNumber(notificationEvent, 'blockingCount'),
  };
}

function getAgentNotificationEvent(
  kind: unknown,
  notificationEvent: unknown,
): AgentDisconnectedNotificationEvent | AgentReconnectedNotificationEvent | undefined {
  const agentName = getNonEmptyString(notificationEvent, 'agentName');
  if (!agentName) {
    return undefined;
  }

  if (kind !== 'agent-disconnect' && kind !== 'agent-reconnect') {
    return undefined;
  }

  return {
    kind,
    agentName,
    reason:
      kind === 'agent-disconnect' ? getNonEmptyString(notificationEvent, 'reason') : undefined,
  };
}

export function getNotificationEvent(
  container: TriggerContainer,
): TriggerNotificationEvent | undefined {
  const notificationEvent = getObjectProperty<Record<string, unknown>>(
    container,
    'notificationEvent',
  );
  if (!notificationEvent || typeof notificationEvent !== 'object') {
    return undefined;
  }

  const kind = safeGet(notificationEvent, 'kind');
  if (kind === 'update-applied') {
    return { kind };
  }

  if (kind === 'update-failed') {
    return getUpdateFailedNotificationEvent(notificationEvent);
  }

  if (kind === 'security-alert') {
    return getSecurityAlertNotificationEvent(notificationEvent);
  }

  return getAgentNotificationEvent(kind, notificationEvent);
}

export function resolveNotificationTemplate(
  notificationEvent: TriggerNotificationEvent | undefined,
  templates: Partial<Record<TriggerNotificationEvent['kind'], string>>,
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
  securitymode?: string;
  securitydigesttitle?: string;
  securitydigestbody?: string;
}

interface ContainerReport {
  container: Container;
  changed: boolean;
}

interface EventBatchDispatchState {
  containers: Map<string, Container>;
  timer?: ReturnType<typeof setTimeout>;
}

type BufferedContainerMap = Map<string, Container>;
type BufferedContainerTimestamps = Map<string, number>;

/**
 * Entry stored in the security digest buffer while waiting for cycle-complete.
 */
interface SecurityDigestEntry {
  containerName: string;
  summary: SecurityAlertSummary;
  status?: string;
  bufferedAt: string;
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
class Trigger<
  TConfiguration extends TriggerConfiguration = TriggerConfiguration,
> extends Component<TConfiguration> {
  public configuration = {} as TConfiguration;
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
  private readonly notificationRuleWarningsSeen: Set<string> = new Set();
  private readonly digestBuffer: Map<string, Container> = new Map();
  private readonly batchRetryBuffer: Map<string, Container> = new Map();
  /**
   * Security digest buffer. Keyed by cycleId → (containerKey → SecurityDigestEntry).
   * Separate from the update digestBuffer so the two paths never share state.
   */
  private readonly securityDigestBuffer: Map<string, Map<string, SecurityDigestEntry>> = new Map();
  private digestBufferUpdatedAt: Map<string, number> = new Map();
  private batchRetryBufferUpdatedAt: Map<string, number> = new Map();
  private bufferEntryRetentionMs = 7 * 24 * 60 * 60 * 1000;
  private digestBufferMaxEntries = 5_000;
  private batchRetryBufferMaxEntries = 5_000;
  private readonly eventBatchDispatches: Map<NotificationRuleId, EventBatchDispatchState> =
    new Map();
  private digestCronTask?: ScheduledTask;
  private isDigestFlushInProgress = false;
  private unregisterSecurityScanCycleComplete?: () => void;

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

  private static normalizeSecurityMode(securitymode: TriggerConfiguration['securitymode']): string {
    return typeof securitymode === 'string' ? securitymode.toLowerCase() : 'simple';
  }

  private static isSecurityDigestCapableMode(
    securitymode: TriggerConfiguration['securitymode'],
  ): boolean {
    const normalized = Trigger.normalizeSecurityMode(securitymode);
    return normalized === 'digest' || normalized === 'batch+digest';
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

  private getUpdateAvailableAutoTriggerDispatchDecision() {
    const dispatchDecision = notificationStore.getTriggerDispatchDecisionForRule(
      'update-available',
      this.getId(),
      {
        // Keep backward compatibility: if update-available has no explicit trigger
        // allow-list yet, legacy auto trigger behavior remains enabled.
        allowAllWhenNoTriggers: true,
        defaultWhenRuleMissing: true,
      },
    );
    this.warnIfDigestRoutingIsSuppressed(dispatchDecision);
    return dispatchDecision;
  }

  private findContainerByBusinessId(containerName: string): Container | undefined {
    return storeContainer.getContainersRaw().find((container) => {
      const notificationKey = getContainerNotificationKey(container);
      return notificationKey === containerName || fullName(container) === containerName;
    });
  }

  private buildAutoTriggerErrorSignature(
    ruleId: NotificationRuleId,
    container: Container | undefined,
    errorMessage: string,
  ) {
    // Intentionally coarse: key on watcher (not container ID) so a burst of
    // identical errors from one system-level condition (SMTP down, agent
    // disconnected) produces a single warn log rather than one per container.
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
    return getContainerNotificationKey(container) || fullName(container);
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

  private deleteBufferedContainerEntry(
    buffer: BufferedContainerMap,
    timestamps: BufferedContainerTimestamps,
    key: string,
  ) {
    const deleted = buffer.delete(key);
    timestamps.delete(key);
    return deleted;
  }

  private pruneStaleBufferedContainerEntries(
    bufferName: string,
    buffer: BufferedContainerMap,
    timestamps: BufferedContainerTimestamps,
    now: number,
  ) {
    if (this.bufferEntryRetentionMs <= 0) {
      return;
    }

    const oldestAllowedTimestamp = now - this.bufferEntryRetentionMs;
    for (const key of buffer.keys()) {
      const updatedAt = timestamps.get(key);
      if (updatedAt === undefined) {
        timestamps.set(key, now);
        continue;
      }

      if (updatedAt < oldestAllowedTimestamp) {
        this.deleteBufferedContainerEntry(buffer, timestamps, key);
        this.log.debug(`Evicted stale ${bufferName} entry ${key}`);
      }
    }
  }

  private enforceBufferedContainerLimit(
    bufferName: string,
    buffer: BufferedContainerMap,
    timestamps: BufferedContainerTimestamps,
    maxEntries: number,
  ) {
    if (maxEntries <= 0) {
      buffer.clear();
      timestamps.clear();
      return;
    }

    while (buffer.size > maxEntries) {
      let oldestKey: string | undefined;
      let oldestUpdatedAt = Number.POSITIVE_INFINITY;

      for (const key of buffer.keys()) {
        const updatedAt = timestamps.get(key) ?? 0;
        if (updatedAt < oldestUpdatedAt) {
          oldestUpdatedAt = updatedAt;
          oldestKey = key;
        }
      }

      if (!oldestKey) {
        break;
      }

      this.deleteBufferedContainerEntry(buffer, timestamps, oldestKey);
      this.log.warn(
        `Evicted oldest ${bufferName} entry ${oldestKey} after reaching the ${maxEntries}-entry limit`,
      );
    }
  }

  private setBufferedContainerEntry(
    bufferName: string,
    buffer: BufferedContainerMap,
    timestamps: BufferedContainerTimestamps,
    key: string,
    container: Container,
    maxEntries: number,
    now = Date.now(),
  ) {
    this.pruneStaleBufferedContainerEntries(bufferName, buffer, timestamps, now);
    buffer.set(key, container);
    timestamps.set(key, now);
    this.enforceBufferedContainerLimit(bufferName, buffer, timestamps, maxEntries);
  }

  private pruneDigestBuffer(now = Date.now()) {
    this.pruneStaleBufferedContainerEntries(
      'digest buffer',
      this.digestBuffer,
      this.digestBufferUpdatedAt,
      now,
    );
    this.enforceBufferedContainerLimit(
      'digest buffer',
      this.digestBuffer,
      this.digestBufferUpdatedAt,
      this.digestBufferMaxEntries,
    );
  }

  private pruneBatchRetryBuffer(now = Date.now()) {
    this.pruneStaleBufferedContainerEntries(
      'batch retry buffer',
      this.batchRetryBuffer,
      this.batchRetryBufferUpdatedAt,
      now,
    );
    this.enforceBufferedContainerLimit(
      'batch retry buffer',
      this.batchRetryBuffer,
      this.batchRetryBufferUpdatedAt,
      this.batchRetryBufferMaxEntries,
    );
  }

  private shouldDispatchNotificationEventInBatch(
    notificationEvent: TriggerNotificationEvent | undefined,
  ) {
    return (
      notificationEvent?.kind !== 'agent-disconnect' &&
      notificationEvent?.kind !== 'agent-reconnect'
    );
  }

  private async dispatchContainerForEvent(
    ruleId: NotificationRuleId,
    container: TriggerContainer | undefined,
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

    const mustTriggerDecision = this.getMustTriggerDecision(container);
    if (!mustTriggerDecision.allowed) {
      this.log.debug(
        `Trigger conditions not met for ${ruleId} event => ignore (${mustTriggerDecision.reason})`,
      );
      return;
    }

    try {
      const notificationEvent = getNotificationEvent(container);
      // Agent connectivity notifications synthesize one-off container payloads and should always
      // dispatch immediately, even when the trigger itself is configured for batch updates.
      const shouldUseBatchMode =
        Trigger.isBatchCapableMode(this.configuration.mode) &&
        this.shouldDispatchNotificationEventInBatch(notificationEvent);
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

  async handleContainerUpdateAppliedEvent(payload: ContainerUpdateAppliedEventPayload) {
    const containerName = getContainerUpdateAppliedEventContainerName(payload);
    if (!containerName) {
      this.log.debug('Skipping update-applied event because container name is missing');
      return;
    }

    const payloadContainer =
      typeof payload === 'object' && payload !== null && 'container' in payload
        ? (payload.container as Container | undefined)
        : undefined;
    const container = payloadContainer || this.findContainerByBusinessId(containerName);
    const notificationKey = getContainerNotificationKey(container) || containerName;

    // Evict from digest buffer — container is already updated, no need to notify.
    let evictedBufferedUpdate = this.deleteBufferedContainerEntry(
      this.digestBuffer,
      this.digestBufferUpdatedAt,
      notificationKey,
    );
    if (!evictedBufferedUpdate && containerName !== notificationKey) {
      evictedBufferedUpdate = this.deleteBufferedContainerEntry(
        this.digestBuffer,
        this.digestBufferUpdatedAt,
        containerName,
      );
    }
    if (!evictedBufferedUpdate) {
      for (const [bufferKey, bufferedContainer] of this.digestBuffer.entries()) {
        if (fullName(bufferedContainer) === containerName) {
          this.deleteBufferedContainerEntry(
            this.digestBuffer,
            this.digestBufferUpdatedAt,
            bufferKey,
          );
          evictedBufferedUpdate = true;
        }
      }
    }
    if (evictedBufferedUpdate) {
      this.log.debug(`Evicted ${notificationKey} from digest buffer (update applied)`);
    }

    // Clear update-available notification history for this container — the
    // update has been applied so the next detected update (even at the same
    // hash by coincidence) should notify again. Clear both the simple/batch
    // channel and the digest channel so every subscriber can re-fire.
    const containerIdForHistory =
      typeof container?.id === 'string' && container.id !== '' ? container.id : undefined;
    if (containerIdForHistory) {
      notificationHistoryStore.clearNotificationsForContainerAndEvent(
        containerIdForHistory,
        'update-available',
      );
      notificationHistoryStore.clearNotificationsForContainerAndEvent(
        containerIdForHistory,
        'update-available-digest',
      );
    }

    const notificationContainer = container
      ? withNotificationEvent(container, { kind: 'update-applied' })
      : undefined;

    await this.dispatchContainerForEvent('update-applied', notificationContainer, {
      allowAllWhenNoTriggers: false,
      defaultWhenRuleMissing: false,
    });
  }

  async handleContainerUpdateFailedEvent(payload: ContainerUpdateFailedPayload) {
    const container = this.findContainerByBusinessId(payload.containerName);
    const notificationContainer = container
      ? withNotificationEvent(container, {
          kind: 'update-failed',
          error: payload.error,
        })
      : undefined;

    await this.dispatchContainerForEvent('update-failed', notificationContainer, {
      allowAllWhenNoTriggers: false,
      defaultWhenRuleMissing: false,
    });
  }

  async handleSecurityAlertEvent(payload: SecurityAlertPayload) {
    const securityMode = Trigger.normalizeSecurityMode(this.configuration.securitymode);

    // Digest mode: buffer the alert for the cycle-complete flush.
    if ((securityMode === 'digest' || securityMode === 'batch+digest') && payload.cycleId) {
      const cycleId = payload.cycleId;
      const container = payload.container || this.findContainerByBusinessId(payload.containerName);
      const containerKey =
        (container ? getContainerNotificationKey(container) : undefined) ?? payload.containerName;
      const containerName = (container ? fullName(container) : undefined) ?? payload.containerName;

      if (!this.securityDigestBuffer.has(cycleId)) {
        this.securityDigestBuffer.set(cycleId, new Map());
      }
      // Last-write-wins within same cycle.
      this.securityDigestBuffer.get(cycleId)!.set(containerKey, {
        containerName,
        summary: payload.summary ?? { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
        status: payload.status,
        bufferedAt: new Date().toISOString(),
      });
      this.log.debug(
        `Buffered security alert for ${containerName} in cycle ${cycleId} (cycle buffer size: ${this.securityDigestBuffer.get(cycleId)!.size})`,
      );
      return;
    }

    // Simple / batch modes: immediate dispatch (unchanged behavior).
    const container = payload.container || this.findContainerByBusinessId(payload.containerName);
    await this.dispatchContainerForEvent(
      'security-alert',
      container
        ? withNotificationEvent(container, {
            kind: 'security-alert',
            details: payload.details,
            status: payload.status,
            summary: payload.summary,
            blockingCount: payload.blockingCount,
          })
        : undefined,
      {
        allowAllWhenNoTriggers: false,
        defaultWhenRuleMissing: false,
      },
    );
  }

  /**
   * Handle a security scan cycle-complete event.
   * For security-digest-capable triggers: flush buffered alerts for this cycle.
   * Idempotent: second call with same cycleId is a no-op (buffer already drained).
   */
  async handleSecurityScanCycleCompleteEvent(
    payload: event.SecurityScanCycleCompleteEventPayload,
  ): Promise<void> {
    if (!Trigger.isSecurityDigestCapableMode(this.configuration.securitymode)) {
      return;
    }
    await this.flushDigestBuffer({
      eventKind: 'security-alert-digest',
      cycleId: payload.cycleId,
      cyclePayload: payload,
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
    return this.getUpdateAvailableAutoTriggerDispatchDecision().enabled;
  }

  private warnIfDigestRoutingIsSuppressed(
    dispatchDecision: notificationStore.NotificationRuleDispatchDecision,
  ) {
    if (!Trigger.isDigestCapableMode(this.configuration.mode) || dispatchDecision.enabled) {
      return;
    }

    let message: string | undefined;
    if (dispatchDecision.reason === 'rule-disabled') {
      message =
        `Digest mode is configured for ${this.getId()}, but the update-available notification rule is disabled; ` +
        'no update-available events will be buffered until the rule is enabled.';
    } else if (dispatchDecision.reason === 'excluded-from-allow-list') {
      message =
        `Digest mode is configured for ${this.getId()}, but the update-available notification rule excludes this trigger; ` +
        'no update-available events will be buffered. Add this trigger to the rule or clear the rule trigger assignments to allow all notification triggers.';
    }

    if (!message) {
      return;
    }

    const warningKey = `update-available|${dispatchDecision.reason}|${this.getId()}`;
    if (this.notificationRuleWarningsSeen.has(warningKey)) {
      return;
    }
    this.notificationRuleWarningsSeen.add(warningKey);
    this.log.warn(message);
  }

  private hasAlreadyNotifiedForResult(
    container: Container,
    eventKind: notificationHistoryStore.NotificationEventKind,
  ): boolean {
    const containerId =
      typeof container?.id === 'string' && container.id !== '' ? container.id : undefined;
    if (!containerId) {
      // No stable id — fall back to permissive "not notified" so we don't
      // silently swallow legitimate events on degenerate records.
      return false;
    }
    const currentHash = notificationHistoryStore.computeResultHash(container);
    const lastHash = notificationHistoryStore.getLastNotifiedHash(
      this.getId(),
      containerId,
      eventKind,
    );
    return lastHash !== undefined && lastHash === currentHash;
  }

  private recordNotifiedForResult(
    container: Container,
    eventKind: notificationHistoryStore.NotificationEventKind,
  ) {
    const containerId =
      typeof container?.id === 'string' && container.id !== '' ? container.id : undefined;
    if (!containerId) {
      return;
    }
    notificationHistoryStore.recordNotification(
      this.getId(),
      containerId,
      eventKind,
      notificationHistoryStore.computeResultHash(container),
    );
  }

  /**
   * Seed notification history from the persisted container store on init so
   * that containers already showing `updateAvailable=true` before this trigger
   * came online are NOT re-notified on the first scan cycle after a restart
   * or config change. If the store already holds a history entry for the
   * (trigger, container, event) tuple, it wins — seed only fills gaps.
   */
  private seedNotificationHistoryFromStore() {
    if (!this.configuration.once) {
      return;
    }
    const triggerId = this.getId();
    // Only seed the simple/batch channel. The digest channel must NOT be
    // seeded from store state: an entry in `update-available-digest` history
    // semantically means "a digest email was sent for this hash", and seeding
    // it conflates "update existed in store at startup" with "digest sent".
    // That false equivalence caused #282 on rc.9 — a container that was never
    // digested would be suppressed because its store hash matched the seeded
    // history hash, leaving the morning cron with an empty buffer. The digest
    // channel is populated exclusively by `flushUpdateDigestBuffer` after a
    // successful send; the first cron after startup therefore sends a
    // catch-up digest of everything in the buffer, which matches the
    // "periodic summary" semantics of digest mode.
    const kindsToSeed: notificationHistoryStore.NotificationEventKind[] = ['update-available'];
    if (Trigger.isSecurityDigestCapableMode(this.configuration.securitymode)) {
      kindsToSeed.push('security-alert-digest');
    }
    let seeded = 0;
    for (const rawContainer of storeContainer.getContainersRaw()) {
      const container = rawContainer as Container;
      if (!container.updateAvailable) {
        continue;
      }
      const containerId =
        typeof container.id === 'string' && container.id !== '' ? container.id : undefined;
      if (!containerId) {
        continue;
      }
      const resultHash = notificationHistoryStore.computeResultHash(container);
      const notifiedAt = container.updateDetectedAt ?? new Date().toISOString();
      for (const kind of kindsToSeed) {
        const existing = notificationHistoryStore.getLastNotifiedHash(triggerId, containerId, kind);
        if (existing !== undefined) {
          continue;
        }
        notificationHistoryStore.recordNotification(
          triggerId,
          containerId,
          kind,
          resultHash,
          notifiedAt,
        );
        seeded += 1;
      }
    }
    if (seeded > 0) {
      this.log.debug(
        `Seeded notification history with ${seeded} pre-existing update-available entr${seeded === 1 ? 'y' : 'ies'}`,
      );
    }
  }

  private shouldHandleSimpleContainerReport(containerReport: ContainerReport) {
    if (!containerReport.container.updateAvailable) {
      return false;
    }
    if (!this.configuration.once) {
      return true;
    }
    return !this.hasAlreadyNotifiedForResult(containerReport.container, 'update-available');
  }

  private shouldHandleDigestContainerReport(
    containerReport: ContainerReport,
    eventKind: DigestEventKind = 'update-available-digest',
  ) {
    if (!containerReport.container.updateAvailable) {
      return false;
    }
    if (!this.configuration.once) {
      return true;
    }
    return !this.hasAlreadyNotifiedForResult(containerReport.container, eventKind);
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

  private getMustTriggerDecision(containerResult: Container) {
    if (Trigger.isRollbackContainer(containerResult)) {
      return {
        allowed: false,
        reason: 'rollback-container',
      };
    }
    if (this.agent && this.agent !== containerResult.agent) {
      return {
        allowed: false,
        reason: `agent mismatch expected=${this.agent} actual=${containerResult.agent ?? '<none>'}`,
      };
    }
    if (this.strictAgentMatch && this.agent !== containerResult.agent) {
      return {
        allowed: false,
        reason: `strict agent mismatch expected=${this.agent ?? '<none>'} actual=${containerResult.agent ?? '<none>'}`,
      };
    }

    const { triggerInclude, triggerExclude } = containerResult;
    const included = this.isTriggerIncluded(containerResult, triggerInclude);
    const excluded = this.isTriggerExcluded(containerResult, triggerExclude);

    if (!included || excluded) {
      return {
        allowed: false,
        reason: `triggerInclude=${triggerInclude ?? '<none>'}, triggerExclude=${triggerExclude ?? '<none>'}, included=${included}, excluded=${excluded}`,
      };
    }

    return {
      allowed: true,
    };
  }

  private isPureBatchMode() {
    return Trigger.normalizeMode(this.configuration.mode) === 'batch';
  }

  private shouldDispatchUpdateAvailableContainer(container: Container) {
    return (
      container.updateAvailable &&
      Trigger.isThresholdReached(container, this.getSimpleModeThreshold()) &&
      this.mustTrigger(container)
    );
  }

  private shouldHandleBatchContainerReport(containerReport: ContainerReport) {
    if (!this.shouldDispatchUpdateAvailableContainer(containerReport.container)) {
      return false;
    }
    if (!this.configuration.once) {
      return true;
    }
    return !this.hasAlreadyNotifiedForResult(containerReport.container, 'update-available');
  }

  private getBatchRetryContainers(containerReports: ContainerReport[]) {
    if (!this.isPureBatchMode() || this.batchRetryBuffer.size === 0) {
      return [];
    }

    const now = Date.now();
    this.pruneBatchRetryBuffer(now);

    const currentReportsByBusinessId = new Map<string, ContainerReport>(
      containerReports.map(
        (containerReport) =>
          [
            getContainerNotificationKey(containerReport.container) ||
              fullName(containerReport.container),
            containerReport,
          ] as const,
      ),
    );
    const currentContainersByBusinessId = new Map<string, Container>(
      storeContainer
        .getContainersRaw()
        .map(
          (container) =>
            [
              getContainerNotificationKey(container as Container) ||
                fullName(container as Container),
              container as Container,
            ] as const,
        ),
    );

    for (const [containerName, bufferedContainer] of this.batchRetryBuffer.entries()) {
      const currentContainer =
        currentReportsByBusinessId.get(containerName)?.container ??
        currentContainersByBusinessId.get(containerName);

      if (!currentContainer || !this.shouldDispatchUpdateAvailableContainer(currentContainer)) {
        if (this.batchRetryBuffer.get(containerName) === bufferedContainer) {
          this.deleteBufferedContainerEntry(
            this.batchRetryBuffer,
            this.batchRetryBufferUpdatedAt,
            containerName,
          );
        }
        continue;
      }

      this.setBufferedContainerEntry(
        'batch retry buffer',
        this.batchRetryBuffer,
        this.batchRetryBufferUpdatedAt,
        containerName,
        currentContainer,
        this.batchRetryBufferMaxEntries,
        now,
      );
    }

    return Array.from(this.batchRetryBuffer.values());
  }

  private recordBatchDeliveryFailure(containers: Container[], errorMessage: string) {
    const timestamp = new Date().toISOString();

    for (const container of containers) {
      auditStore.insertAudit({
        id: '',
        timestamp,
        action: 'notification-delivery-failed',
        containerName: fullName(container),
        containerImage: container.image?.name,
        fromVersion: container.updateKind?.localValue,
        toVersion: container.updateKind?.remoteValue,
        triggerName: this.getId(),
        status: 'error',
        details: errorMessage,
      });
    }
  }

  private async runUpdateAvailableSimpleTrigger(
    container: Container,
    logContainer: Component['log'],
  ) {
    if (!Trigger.isThresholdReached(container, this.getSimpleModeThreshold())) {
      logContainer.debug(
        `Threshold not reached => ignore (threshold=${this.getSimpleModeThreshold()}, updateKind=${container.updateKind?.kind ?? 'unknown'}, semverDiff=${container.updateKind?.semverDiff ?? 'unknown'})`,
      );
      return;
    }

    const mustTriggerDecision = this.getMustTriggerDecision(container);
    if (!mustTriggerDecision.allowed) {
      logContainer.debug(`Trigger conditions not met => ignore (${mustTriggerDecision.reason})`);
      return;
    }

    logContainer.debug('Run');
    if (this.isUpdateActionTrigger()) {
      const accepted = await enqueueContainerUpdate(container, {
        trigger: this as unknown as {
          type: string;
          trigger: (container: Container, runtimeContext?: unknown) => Promise<unknown>;
        },
      });
      await runAcceptedContainerUpdates([accepted]);
      return;
    }

    const result = await this.trigger(container);
    if (this.configuration.resolvenotifications && result) {
      this.notificationResults.set(
        getContainerNotificationKey(container) || fullName(container),
        result,
      );
    }
    this.recordNotifiedForResult(container, 'update-available');
  }

  private handleUpdateAvailableSimpleTriggerError(
    error: unknown,
    container: Container,
    logContainer: Component['log'],
  ) {
    if (error instanceof UpdateRequestError) {
      logContainer.debug(`Skipped auto update (${error.message})`);
      return;
    }

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
    // Strip Docker recreate alias prefixes before any trigger processing
    Trigger.canonicalizeReportName(containerReport);

    const dispatchDecision = this.getUpdateAvailableAutoTriggerDispatchDecision();
    if (!dispatchDecision.enabled) {
      this.log.debug(
        `Skipping update-available notification for ${fullName(containerReport.container)} (${dispatchDecision.reason})`,
      );
      return;
    }

    // Filter on containers with update available that we haven't already notified for this exact result
    if (!this.shouldHandleSimpleContainerReport(containerReport)) {
      const alreadyNotified =
        containerReport.container.updateAvailable &&
        this.configuration.once === true &&
        this.hasAlreadyNotifiedForResult(containerReport.container, 'update-available');
      this.log.debug(
        `Skipping update-available notification for ${fullName(containerReport.container)} (once=${this.configuration.once ?? false}, updateAvailable=${containerReport.container.updateAvailable}, alreadyNotified=${alreadyNotified})`,
      );
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
    const containersToSendByBusinessId = new Map<string, Container>();
    for (const container of this.getBatchRetryContainers(containerReports)) {
      containersToSendByBusinessId.set(
        getContainerNotificationKey(container) || fullName(container),
        container,
      );
    }
    for (const containerReport of containerReports) {
      if (this.shouldHandleBatchContainerReport(containerReport)) {
        containersToSendByBusinessId.set(
          getContainerNotificationKey(containerReport.container) ||
            fullName(containerReport.container),
          containerReport.container,
        );
      }
    }
    const containersToSend = Array.from(containersToSendByBusinessId.values());
    if (containersToSend.length === 0) {
      return;
    }

    let status: 'success' | 'error' = 'error';
    try {
      this.log.debug('Run batch');
      if (this.isUpdateActionTrigger()) {
        await this.runAcceptedUpdateBatch(containersToSend);
      } else {
        await this.triggerBatch(containersToSend);
      }
      status = 'success';
      for (const container of containersToSend) {
        this.recordNotifiedForResult(container, 'update-available');
      }
      if (this.batchRetryBuffer.size > 0) {
        for (const container of containersToSend) {
          this.deleteBufferedContainerEntry(
            this.batchRetryBuffer,
            this.batchRetryBufferUpdatedAt,
            getContainerNotificationKey(container) || fullName(container),
          );
        }
      }
    } catch (e: unknown) {
      const errorMessage = Trigger.getErrorMessage(e);
      if (this.isPureBatchMode()) {
        for (const container of containersToSend) {
          this.setBufferedContainerEntry(
            'batch retry buffer',
            this.batchRetryBuffer,
            this.batchRetryBufferUpdatedAt,
            getContainerNotificationKey(container) || fullName(container),
            container,
            this.batchRetryBufferMaxEntries,
          );
        }
      }
      this.recordBatchDeliveryFailure(containersToSend, errorMessage);
      if (
        this.shouldSuppressAutoTriggerError('update-available', containersToSend[0], errorMessage)
      ) {
        this.log.debug(`Suppressed repeated error (${errorMessage})`);
      } else {
        this.log.warn(`Error (${errorMessage})`);
      }
      this.log.debug(e);
    } finally {
      this.incrementTriggerCounter(status);
    }
  }

  /**
   * Buffer a container for digest mode. Keyed by stable container identity
   * so same-name siblings do not overwrite each other before the digest cron
   * flushes.
   */
  private bufferContainerForDigest(container: Container) {
    const containerKey = getContainerNotificationKey(container) || fullName(container);
    this.setBufferedContainerEntry(
      'digest buffer',
      this.digestBuffer,
      this.digestBufferUpdatedAt,
      containerKey,
      container,
      this.digestBufferMaxEntries,
    );
    this.log.debug(`Buffered ${containerKey} for digest (${this.digestBuffer.size} buffered)`);
  }

  /**
   * Handle container report (digest mode — single container from simple event).
   */
  async handleContainerReportDigest(containerReport: ContainerReport) {
    Trigger.canonicalizeReportName(containerReport);

    const { container } = containerReport;
    const containerName = getContainerNotificationKey(container) || fullName(container);

    if (!container.updateAvailable) {
      if (
        this.deleteBufferedContainerEntry(
          this.digestBuffer,
          this.digestBufferUpdatedAt,
          containerName,
        )
      ) {
        this.log.debug(`Evicted ${containerName} from digest buffer (update no longer available)`);
      }
      return;
    }

    if (!this.isUpdateAvailableAutoTriggerEnabled()) {
      return;
    }
    if (!this.shouldHandleDigestContainerReport(containerReport)) {
      const alreadyBuffered = this.hasAlreadyNotifiedForResult(
        container,
        'update-available-digest',
      );
      this.log.debug(
        `Skipping update-available digest buffer for ${containerName} (once=${this.configuration.once === true}, updateAvailable=${container.updateAvailable}, alreadyBuffered=${alreadyBuffered})`,
      );
      return;
    }
    if (!Trigger.isThresholdReached(container, this.getSimpleModeThreshold())) {
      return;
    }
    if (!this.mustTrigger(container)) {
      return;
    }
    this.bufferContainerForDigest(container);
  }

  /**
   * Format the digest title for a given event kind and context.
   * Pure helper — does not touch instance state.
   */
  private formatDigestTitle(eventKind: DigestEventKind, ctx: DigestContext): string {
    if (eventKind === 'update-available-digest') {
      // Update digest uses the batch title template (same as today).
      const containers = (ctx as UpdateDigestContext).containers;
      return this.renderBatchTitle(containers);
    }
    // Security digest — use configured or default title template.
    const secCtx = ctx as SecurityDigestContext;
    const titleTemplate =
      this.configuration.securitydigesttitle ?? DEFAULT_SECURITY_DIGEST_TITLE_TEMPLATE;
    return this.renderSecurityDigestTemplate(titleTemplate, secCtx);
  }

  /**
   * Format the digest body for a given event kind and context.
   * Pure helper — does not touch instance state.
   */
  private formatDigestBody(eventKind: DigestEventKind, ctx: DigestContext): string {
    if (eventKind === 'update-available-digest') {
      const containers = (ctx as UpdateDigestContext).containers;
      return this.renderBatchBody(containers);
    }
    const secCtx = ctx as SecurityDigestContext;
    const bodyTemplate =
      this.configuration.securitydigestbody ?? DEFAULT_SECURITY_DIGEST_BODY_TEMPLATE;
    return this.renderSecurityDigestTemplate(bodyTemplate, secCtx);
  }

  /**
   * Render a security digest template string, substituting `scan.*` variables.
   */
  private renderSecurityDigestTemplate(template: string, ctx: SecurityDigestContext): string {
    const scan = {
      alertCount: ctx.alertCount,
      scannedCount: ctx.scannedCount,
      criticalCount: ctx.criticalCount,
      highCount: ctx.highCount,
      mediumCount: ctx.mediumCount,
      lowCount: ctx.lowCount,
      unknownCount: ctx.unknownCount,
      startedAt: ctx.startedAt,
      completedAt: ctx.completedAt,
      cycleId: ctx.cycleId,
      containers: ctx.containers,
    };
    try {
      // Template variables use ${...} syntax — evaluate as a template literal body.
      const renderFn = new Function('scan', `return \`${template}\`;`);
      return renderFn(scan) as string;
    } catch {
      return template;
    }
  }

  /**
   * Flush the update-available digest buffer (update-available-digest path).
   * Called by the digest cron and by the explicit options-based flush.
   */
  private async flushUpdateDigestBuffer(): Promise<void> {
    if (this.isDigestFlushInProgress) {
      this.log.debug('Digest flush already in progress');
      return;
    }
    if (this.digestBuffer.size === 0) {
      this.log.debug('Digest cron fired — buffer empty, nothing to send');
      return;
    }
    this.pruneDigestBuffer();
    if (this.digestBuffer.size === 0) {
      this.log.debug('Digest cron fired — no buffered updates remain after eviction');
      return;
    }
    const bufferedEntries = Array.from(this.digestBuffer.entries());
    const currentContainersByBusinessId = new Map<string, Container>(
      storeContainer
        .getContainersRaw()
        .map(
          (container) =>
            [
              getContainerNotificationKey(container as Container) ||
                fullName(container as Container),
              container as Container,
            ] as const,
        ),
    );
    const dispatchEntries = bufferedEntries.flatMap(([containerName, bufferedContainer]) => {
      const currentContainer = currentContainersByBusinessId.get(containerName);

      if (!currentContainer) {
        return [
          {
            containerName,
            bufferedContainer,
            currentContainer: bufferedContainer,
          },
        ];
      }

      if (currentContainer.updateAvailable) {
        return [
          {
            containerName,
            bufferedContainer,
            currentContainer,
          },
        ];
      }

      if (this.digestBuffer.get(containerName) === bufferedContainer) {
        this.deleteBufferedContainerEntry(
          this.digestBuffer,
          this.digestBufferUpdatedAt,
          containerName,
        );
      }
      return [];
    });

    if (dispatchEntries.length === 0) {
      this.log.debug('Digest cron fired — no buffered updates remain after revalidation');
      return;
    }

    const containers = dispatchEntries.map(({ currentContainer }) => currentContainer);
    this.log.info(`Digest flush: sending ${containers.length} update(s)`);
    let status: 'success' | 'error' = 'error';
    this.isDigestFlushInProgress = true;
    try {
      if (this.isUpdateActionTrigger()) {
        await this.runAcceptedUpdateBatch(containers);
      } else {
        await this.triggerBatch(containers);
      }
      status = 'success';
      for (const container of containers) {
        this.recordNotifiedForResult(container, 'update-available-digest');
      }
      for (const { containerName, bufferedContainer } of dispatchEntries) {
        if (this.digestBuffer.get(containerName) === bufferedContainer) {
          this.deleteBufferedContainerEntry(
            this.digestBuffer,
            this.digestBufferUpdatedAt,
            containerName,
          );
        }
      }
    } catch (e: unknown) {
      const errorMessage = Trigger.getErrorMessage(e);
      this.recordBatchDeliveryFailure(containers, errorMessage);
      this.log.warn(`Digest flush failed (${errorMessage})`);
      this.log.debug(e);
    } finally {
      this.isDigestFlushInProgress = false;
      this.incrementTriggerCounter(status);
    }
  }

  /**
   * Flush the security digest buffer for a specific cycleId.
   * No-op when the cycle has no buffered entries (zero-alert cycle suppression per Section 7.5).
   * Idempotent: a second call with the same cycleId is a no-op (entries already drained).
   */
  private async flushSecurityDigestBuffer(
    cycleId: string,
    cyclePayload: event.SecurityScanCycleCompleteEventPayload,
  ): Promise<void> {
    const cycleEntries = this.securityDigestBuffer.get(cycleId);
    if (!cycleEntries || cycleEntries.size === 0) {
      this.log.debug(
        `Security digest cycle-complete for ${cycleId} — no buffered entries, suppressing notification`,
      );
      return;
    }

    const rows: SecurityDigestContainerRow[] = Array.from(cycleEntries.values()).map((entry) => ({
      name: entry.containerName,
      critical: entry.summary.critical,
      high: entry.summary.high,
      medium: entry.summary.medium,
      low: entry.summary.low,
      unknown: entry.summary.unknown,
    }));

    // Sort by severity descending: critical → high → medium → low → unknown
    rows.sort(
      (a, b) =>
        b.critical - a.critical ||
        b.high - a.high ||
        b.medium - a.medium ||
        b.low - a.low ||
        b.unknown - a.unknown,
    );

    const alertCount = rows.length;
    const criticalCount = rows.reduce((s, r) => s + (r.critical > 0 ? 1 : 0), 0);
    const highCount = rows.reduce((s, r) => s + (r.critical === 0 && r.high > 0 ? 1 : 0), 0);
    const mediumCount = rows.reduce(
      (s, r) => s + (r.critical === 0 && r.high === 0 && r.medium > 0 ? 1 : 0),
      0,
    );
    const lowCount = rows.reduce(
      (s, r) => s + (r.critical === 0 && r.high === 0 && r.medium === 0 && r.low > 0 ? 1 : 0),
      0,
    );
    const unknownCount = rows.reduce(
      (s, r) =>
        s +
        (r.critical === 0 && r.high === 0 && r.medium === 0 && r.low === 0 && r.unknown > 0
          ? 1
          : 0),
      0,
    );

    const now = new Date().toISOString();
    const secCtx: SecurityDigestContext = {
      kind: 'security',
      containers: rows,
      scannedCount: cyclePayload.scannedCount,
      alertCount,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      unknownCount,
      startedAt: cyclePayload.startedAt ?? now,
      completedAt: cyclePayload.completedAt ?? now,
      cycleId,
    };

    this.log.info(`Security digest flush for cycle ${cycleId}: sending ${alertCount} finding(s)`);
    let status: 'success' | 'error' = 'error';
    try {
      await this.triggerBatch(rows as unknown as Container[], {
        eventKind: 'security-alert-digest' as DigestEventKind,
        title: this.formatDigestTitle('security-alert-digest', secCtx),
        body: this.formatDigestBody('security-alert-digest', secCtx),
      });
      status = 'success';
      // Drain the cycle's entries after successful flush.
      this.securityDigestBuffer.delete(cycleId);
    } catch (e: unknown) {
      const errorMessage = Trigger.getErrorMessage(e);
      this.log.warn(`Security digest flush failed for cycle ${cycleId} (${errorMessage})`);
      this.log.debug(e);
    } finally {
      this.incrementTriggerCounter(status);
    }
  }

  /**
   * Public entry-point for the digest flush — parameterized on eventKind.
   * The update-digest path (`'update-available-digest'`) ignores cycleId and
   * flushes the entire update buffer (preserving pre-existing cron behavior).
   * The security-digest path (`'security-alert-digest'`) requires cycleId and
   * flushes only entries for that cycle (cycle-partitioned flush).
   */
  async flushDigestBuffer(options?: {
    eventKind?: DigestEventKind;
    cycleId?: string;
    cyclePayload?: event.SecurityScanCycleCompleteEventPayload;
  }): Promise<void> {
    const eventKind = options?.eventKind ?? 'update-available-digest';
    if (eventKind === 'update-available-digest') {
      return this.flushUpdateDigestBuffer();
    }
    // security-alert-digest
    const cycleId = options?.cycleId;
    const cyclePayload = options?.cyclePayload;
    if (!cycleId || !cyclePayload) {
      this.log.warn(
        'flushDigestBuffer called for security-alert-digest without cycleId/cyclePayload — skipping',
      );
      return;
    }
    return this.flushSecurityDigestBuffer(cycleId, cyclePayload);
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
    return this.getMustTriggerDecision(containerResult).allowed;
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
          void this.flushDigestBuffer({ eventKind: 'update-available-digest' });
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
      this.unregisterSecurityScanCycleComplete = event.registerSecurityScanCycleComplete(
        async (payload) => this.handleSecurityScanCycleCompleteEvent(payload),
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

      this.seedNotificationHistoryFromStore();
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

    this.unregisterSecurityScanCycleComplete?.();
    this.unregisterSecurityScanCycleComplete = undefined;

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
    this.digestBufferUpdatedAt.clear();
    this.securityDigestBuffer.clear();
    this.batchRetryBuffer.clear();
    this.batchRetryBufferUpdatedAt.clear();
    this.clearEventBatchDispatches();

    this.autoTriggerErrorSeenAt.clear();
    this.notificationRuleWarningsSeen.clear();
  }

  /**
   * Override method to merge with common Trigger options (threshold...).
   * @param configuration
   * @returns {*}
   */
  validateConfiguration(configuration: TConfiguration): TConfiguration {
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
      simpletitle: this.joi.string().default(DEFAULT_SIMPLE_TITLE_TEMPLATE),
      simplebody: this.joi.string().default(DEFAULT_SIMPLE_BODY_TEMPLATE),
      batchtitle: this.joi.string().default('${containers.length} updates available'),
      resolvenotifications: this.joi.boolean().default(false),
      securitymode: this.joi
        .string()
        .insensitive()
        .valid('simple', 'batch', 'digest', 'batch+digest')
        .default('simple'),
      securitydigesttitle: this.joi.string().optional(),
      securitydigestbody: this.joi.string().optional(),
    });
    const schemaValidated = schemaWithDefaultOptions.validate(configuration);
    if (schemaValidated.error) {
      throw schemaValidated.error;
    }
    const normalizedConfiguration = schemaValidated.value as TConfiguration;
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
  async triggerBatch(
    containersWithResult: Container[],
    _runtimeContext?: unknown,
  ): Promise<unknown> {
    // do nothing by default
    this.log.warn('Cannot trigger container results; this trigger does not implement "batch" mode');
    return containersWithResult;
  }

  private isUpdateActionTrigger(): boolean {
    return UPDATE_ACTION_TRIGGER_TYPES.has(this.type.toLowerCase());
  }

  private async runAcceptedUpdateBatch(containers: Container[]): Promise<void> {
    const { accepted, rejected } = await enqueueContainerUpdates(containers, {
      trigger: this as unknown as {
        type: string;
        trigger: (container: Container, runtimeContext?: unknown) => Promise<unknown>;
      },
    });

    for (const entry of rejected) {
      this.log.debug(
        `Skipped batched auto update for ${getContainerNotificationKey(entry.container) || fullName(entry.container)} (${entry.message})`,
      );
    }

    if (accepted.length === 0) {
      return;
    }

    await runAcceptedContainerUpdates(accepted);
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
  async handleContainerUpdateApplied(payload: ContainerUpdateAppliedEventPayload) {
    const containerName = getContainerUpdateAppliedEventContainerName(payload);
    const payloadContainer =
      typeof payload === 'object' && payload !== null && 'container' in payload
        ? (payload.container as Container | undefined)
        : undefined;
    const containerId =
      getContainerNotificationKey(payloadContainer) ||
      (containerName
        ? getContainerNotificationKey(this.findContainerByBusinessId(containerName))
        : undefined) ||
      getContainerUpdateAppliedEventNotificationKey(payload);
    if (!containerId) {
      return;
    }

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
  protected maskFields(fieldsToMask: string[]): TConfiguration {
    const masked = { ...this.configuration } as Record<string, unknown>;
    for (const field of fieldsToMask) {
      const value = masked[field];
      if (typeof value === 'string' && value.length > 0) {
        masked[field] = (this.constructor as typeof Trigger).mask(value);
      }
    }
    return masked as TConfiguration;
  }

  /**
   * Build the container template context used by trigger body/title rendering.
   * Release notes bodies are shortened for notifications to avoid excessively long payloads.
   */
  private getNotificationServerName(container: Container): string {
    const agent = typeof container.agent === 'string' ? container.agent.trim() : '';
    return agent || getServerName();
  }

  private getNotificationWatcherSuffix(
    container: Container,
    notificationAgentPrefix: string,
    notificationServerName: string,
  ): string {
    const watcher = typeof container.watcher === 'string' ? container.watcher.trim() : '';
    if (!watcher || watcher === 'local' || watcher === 'agent') {
      return '';
    }

    if (
      notificationAgentPrefix &&
      watcher.toLowerCase() === notificationServerName.trim().toLowerCase()
    ) {
      return '';
    }

    return ` (${watcher})`;
  }

  private getNotificationAgentPrefix(container: Container): string {
    const agent = typeof container.agent === 'string' ? container.agent.trim() : '';
    if (agent) {
      return `[${agent}] `;
    }
    if (getAgents().length > 0) {
      return `[${getServerName()}] `;
    }
    return '';
  }

  private getTemplateContainer(container: Container): TriggerTemplateContainer {
    const notificationAgentPrefix = this.getNotificationAgentPrefix(container);
    const notificationServerName = this.getNotificationServerName(container);
    const notificationWatcherSuffix = this.getNotificationWatcherSuffix(
      container,
      notificationAgentPrefix,
      notificationServerName,
    );
    const releaseNotes = container.result?.releaseNotes;
    if (!releaseNotes || typeof releaseNotes.body !== 'string') {
      return {
        ...container,
        notificationWatcherSuffix,
        notificationAgentPrefix,
        notificationServerName,
      };
    }

    return {
      ...container,
      notificationWatcherSuffix,
      notificationAgentPrefix,
      notificationServerName,
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
      NOTIFICATION_SIMPLE_TITLE_TEMPLATES,
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
      NOTIFICATION_SIMPLE_BODY_TEMPLATES,
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
    const notificationEvent =
      containers.length > 0 ? getNotificationEvent(containers[0]) : undefined;
    const template = resolveNotificationTemplate(
      notificationEvent,
      NOTIFICATION_BATCH_TITLE_TEMPLATES,
      this.configuration.batchtitle ?? '',
    );
    return renderBatch(template, containers);
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
