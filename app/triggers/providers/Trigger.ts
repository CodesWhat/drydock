import cron, { type ScheduledTask } from 'node-cron';
import { getAgents } from '../../agent/manager.js';
import { getServerName } from '../../configuration/index.js';
import {
  buildDependencyGraph,
  buildDependentsByDependency,
  collectTransitiveDependents,
} from '../../dependencies/dependency-graph.js';
import * as event from '../../event/index.js';
import {
  type ActionPolicyTrigger,
  findInertAutoLabelContainers,
  findOnincludeAutoMigrationGaps,
  selectActionTrigger,
} from '../../model/action-policy.js';
import {
  type Container,
  fullName,
  isRollbackContainer as isRollbackContainerHelper,
} from '../../model/container.js';

const RECREATED_ALIAS_RE = /^[a-f0-9]{12}_(.+)$/i;

import type { NotificationOutboxEntry } from '../../model/notification-outbox.js';
import { getTriggerCounter } from '../../prometheus/trigger.js';
import Component, { type ComponentConfiguration } from '../../registry/Component.js';
import * as registry from '../../registry/index.js';
import { redactTriggerConfigurationInfrastructureDetails } from '../../registry/trigger-config-redaction.js';
import * as auditStore from '../../store/audit.js';
import * as storeContainer from '../../store/container.js';
import * as notificationStore from '../../store/notification.js';
import * as notificationHistoryStore from '../../store/notification-history.js';
import { enqueueOutboxEntry } from '../../store/notification-outbox.js';
import { getUpdateMode } from '../../store/settings.js';
import { listRecentSucceededOperations } from '../../store/update-operation.js';
import {
  dispatchAccepted,
  enqueueContainerUpdate,
  enqueueContainerUpdates,
  isUpdateModeAdmissionRejection,
  UpdateRequestError,
} from '../../updates/request-update.js';
import {
  getContainerTriggerFiltersForCategory,
  getTriggerCategoryForType,
} from '../trigger-category.js';
import { BatchDispatcher } from './trigger-batch-dispatcher.js';
import { OneShotKeyTracker, RecentSignatureSuppressor } from './trigger-deduplicator.js';
import { DigestBuffer } from './trigger-digest-buffer.js';
import { renderBatch, renderSimple, renderTemplate } from './trigger-expression-parser.js';
import {
  doesReferenceMatchId as doesReferenceMatchIdHelper,
  matchesTriggerReferenceList,
  parseIncludeOrIncludeTriggerString as parseIncludeOrIncludeTriggerStringHelper,
} from './trigger-reference-matching.js';
import {
  isThresholdReached as isThresholdReachedHelper,
  parseThresholdWithDigestBehavior as parseThresholdWithDigestBehaviorHelper,
  SUPPORTED_THRESHOLDS,
} from './trigger-threshold.js';

type TriggerAutoMode = 'all' | 'oninclude' | 'onauto' | 'none';
type DigestEventKind = 'update-available-digest' | 'security-alert-digest';

/**
 * Context forwarded by the framework to a provider's `triggerBatch` when the
 * caller has already resolved the title/body for a batch dispatch — most
 * notably the security-alert digest, whose template space is disjoint from the
 * update-available templates and whose rows are not real Containers. Providers
 * MUST forward this to `renderBatchTitle` / `renderBatchBody` /
 * `composeBatchMessage` so the prerendered strings are used verbatim instead
 * of being re-rendered with the wrong template against stub objects (#328).
 */
export interface BatchRuntimeContext {
  eventKind?: DigestEventKind;
  title?: string;
  body?: string;
}

function isBatchRuntimeContext(value: unknown): value is BatchRuntimeContext {
  return typeof value === 'object' && value !== null;
}

function getRuntimeContextString(
  runtimeContext: unknown,
  field: 'title' | 'body',
): string | undefined {
  if (!isBatchRuntimeContext(runtimeContext)) {
    return undefined;
  }
  const value = runtimeContext[field];
  return typeof value === 'string' ? value : undefined;
}
type NotificationRuleId =
  | 'update-available'
  | 'update-applied'
  | 'update-failed'
  | 'security-alert'
  | 'agent-disconnect'
  | 'agent-reconnect'
  | 'container-unhealthy'
  | 'maturity-cleared';

const NOTIFICATION_RULE_IDS = new Set<NotificationRuleId>([
  'update-available',
  'update-applied',
  'update-failed',
  'security-alert',
  'agent-disconnect',
  'agent-reconnect',
  'container-unhealthy',
  'maturity-cleared',
]);

type ContainerUpdateFailedPayload = event.ContainerUpdateFailedEventPayload;

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

interface ContainerUnhealthyNotificationEvent {
  kind: 'container-unhealthy';
  previousHealth?: string;
}

interface MaturityGateClearedNotificationEvent {
  kind: 'maturity-cleared';
  pendingSince?: string;
  minAgeDays?: number;
  clockSource?: string;
}

type TriggerNotificationEvent =
  | UpdateAppliedNotificationEvent
  | UpdateFailedNotificationEvent
  | SecurityAlertNotificationEvent
  | AgentDisconnectedNotificationEvent
  | AgentReconnectedNotificationEvent
  | ContainerUnhealthyNotificationEvent
  | MaturityGateClearedNotificationEvent;

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
/**
 * How far back to look for recently-succeeded operations when seeding the
 * `recentlyAppliedContainerKeys` suppression set on controller startup.
 *
 * Must comfortably exceed the worst-case watcher confirmation latency after an
 * update (i.e. how long it can take for the watcher to re-scan and report
 * `updateAvailable=false` after a container is recreated). A 60-minute window
 * is generous relative to the typical Docker watcher poll interval (minutes)
 * while still being tight enough to avoid re-suppressing containers from truly
 * completed update cycles hours in the past (#408 restart amnesia).
 */
const RECENT_APPLICATION_SEED_WINDOW_MS = 60 * 60 * 1000;
export const BUFFER_ENTRY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Trigger types that **execute** a container update (pull-and-recreate or
 * compose-pull-and-up). Used by `isUpdateActionTrigger()` to route containers
 * through the admission queue instead of the notification dispatch path.
 *
 * Intentionally does NOT include `'command'`. A command trigger invokes an
 * arbitrary shell command configured by the user — it is classified as an
 * "action" for configuration-taxonomy purposes (so its `auto` default is
 * `'oninclude'`), but it does not execute the Docker update lifecycle itself
 * and therefore must NOT be routed through the admission/accept queue.
 *
 * If you add a new update-executing type here, also add it to
 * `ACTION_TRIGGER_TYPES` in `triggers/trigger-category.ts` so the category
 * taxonomy stays in sync. That module owns the action/notification split; this
 * set is the narrower "actually runs the Docker update lifecycle" subset.
 */
const UPDATE_ACTION_TRIGGER_TYPES = new Set(['docker', 'dockercompose', 'portainer']);

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
export function buildLiteralTemplateExpression(expression: string): string {
  return `\${${expression}}`;
}

const DEFAULT_SIMPLE_TITLE_DIGEST_EXPRESSION =
  'container.notificationAgentPrefix + "New image available for container " + container.name + container.notificationWatcherSuffix + " (tag " + currentTag + ")"';
const DEFAULT_SIMPLE_TITLE_UPDATE_EXPRESSION =
  'container.notificationAgentPrefix + "New " + container.updateKind.kind + " found for container " + container.name + container.notificationWatcherSuffix';
const DEFAULT_SIMPLE_BODY_DIGEST_EXPRESSION =
  'container.notificationAgentPrefix + "Container " + container.name + container.notificationWatcherSuffix + " running tag " + currentTag + " has a newer image available"';
const DEFAULT_SIMPLE_BODY_UPDATE_EXPRESSION =
  'container.notificationAgentPrefix + "Container " + container.name + container.notificationWatcherSuffix + " running with " + container.updateKind.kind + " " + container.updateKind.localValue + " can be updated to " + container.updateKind.kind + " " + container.updateKind.remoteValue';
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
const UPDATE_APPLIED_SIMPLE_BODY_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Container ${buildLiteralTemplateExpression('container.name')} updated successfully`;
const UPDATE_FAILED_SIMPLE_TITLE_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Container ${buildLiteralTemplateExpression('container.name')} update failed`;
const UPDATE_FAILED_SIMPLE_BODY_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Container ${buildLiteralTemplateExpression('container.name')} update failed${buildLiteralTemplateExpression('event.error ? ": " + event.error : ""')}`;
const SECURITY_ALERT_SIMPLE_TITLE_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Security alert for container ${buildLiteralTemplateExpression('container.name')}`;
const SECURITY_ALERT_SIMPLE_BODY_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Security alert for container ${buildLiteralTemplateExpression('container.name')}${buildLiteralTemplateExpression('event.blockingCount ? " (" + event.blockingCount + " blocking vulnerabilities)" : ""')}${buildLiteralTemplateExpression('event.details ? "\\n" + event.details : ""')}`;
const CONTAINER_UNHEALTHY_SIMPLE_TITLE_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Container ${buildLiteralTemplateExpression('container.name')} is unhealthy`;
const CONTAINER_UNHEALTHY_SIMPLE_BODY_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Container ${buildLiteralTemplateExpression('container.name')} has entered the unhealthy state${buildLiteralTemplateExpression('event.previousHealth ? " (was " + event.previousHealth + ")" : ""')}`;
const MATURITY_GATE_CLEARED_SIMPLE_TITLE_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Update ready for container ${buildLiteralTemplateExpression('container.name')}${buildLiteralTemplateExpression('container.notificationWatcherSuffix')}`;
const MATURITY_GATE_CLEARED_SIMPLE_BODY_TEMPLATE = `${buildLiteralTemplateExpression('container.notificationAgentPrefix')}Container ${buildLiteralTemplateExpression('container.name')}${buildLiteralTemplateExpression('container.notificationWatcherSuffix')} can now be updated to ${buildLiteralTemplateExpression('container.result.tag ? container.result.tag : container.result.digest')}: the maturity period has passed${buildLiteralTemplateExpression('event.minAgeDays ? " (" + event.minAgeDays + " day minimum)" : ""')}`;
const NOTIFICATION_SIMPLE_TITLE_TEMPLATES: Partial<
  Record<TriggerNotificationEvent['kind'], string>
> = {
  'update-applied': UPDATE_APPLIED_SIMPLE_TITLE_TEMPLATE,
  'update-failed': UPDATE_FAILED_SIMPLE_TITLE_TEMPLATE,
  'security-alert': SECURITY_ALERT_SIMPLE_TITLE_TEMPLATE,
  'agent-disconnect': AGENT_DISCONNECT_SIMPLE_TITLE_TEMPLATE,
  'agent-reconnect': AGENT_RECONNECT_SIMPLE_TITLE_TEMPLATE,
  'container-unhealthy': CONTAINER_UNHEALTHY_SIMPLE_TITLE_TEMPLATE,
  'maturity-cleared': MATURITY_GATE_CLEARED_SIMPLE_TITLE_TEMPLATE,
};
const NOTIFICATION_SIMPLE_BODY_TEMPLATES: Partial<
  Record<TriggerNotificationEvent['kind'], string>
> = {
  'update-applied': UPDATE_APPLIED_SIMPLE_BODY_TEMPLATE,
  'update-failed': UPDATE_FAILED_SIMPLE_BODY_TEMPLATE,
  'security-alert': SECURITY_ALERT_SIMPLE_BODY_TEMPLATE,
  'agent-disconnect': AGENT_DISCONNECT_SIMPLE_BODY_TEMPLATE,
  'agent-reconnect': AGENT_RECONNECT_SIMPLE_BODY_TEMPLATE,
  'container-unhealthy': CONTAINER_UNHEALTHY_SIMPLE_BODY_TEMPLATE,
  'maturity-cleared': MATURITY_GATE_CLEARED_SIMPLE_BODY_TEMPLATE,
};
const NOTIFICATION_BATCH_TITLE_TEMPLATES: Partial<
  Record<TriggerNotificationEvent['kind'], string>
> = {
  'update-applied': `${buildLiteralTemplateExpression('containers.length')} updates applied`,
  'update-failed': `${buildLiteralTemplateExpression('containers.length')} updates failed`,
  'security-alert': `${buildLiteralTemplateExpression('containers.length')} security alerts`,
  'container-unhealthy': `${buildLiteralTemplateExpression('containers.length')} containers became unhealthy`,
  'maturity-cleared': `${buildLiteralTemplateExpression('containers.length')} updates ready to apply`,
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

const DEFAULT_SECURITY_DIGEST_TITLE_TEMPLATE = `Security scan complete: \${scan.alertCount} \${scan.containerNoun} with findings`;

const DEFAULT_SECURITY_DIGEST_BODY_TEMPLATE = `Security scan complete: \${scan.alertCount} of \${scan.scannedCount} containers have findings.

CRITICAL (\${scan.criticalCount}):
\${scan.criticalList}

HIGH (\${scan.highCount}):
\${scan.highList}

Scan ran from \${scan.startedAt} to \${scan.completedAt}.`;

function truncateReleaseNotesBody(body: string, maxLength: number) {
  if (body.length <= maxLength) {
    return body;
  }
  return `${body.slice(0, maxLength)}...`;
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

function getContainerUnhealthyNotificationEvent(
  notificationEvent: unknown,
): ContainerUnhealthyNotificationEvent {
  return {
    kind: 'container-unhealthy',
    previousHealth: getNonEmptyString(notificationEvent, 'previousHealth'),
  };
}

function getMaturityGateClearedNotificationEvent(
  notificationEvent: unknown,
): MaturityGateClearedNotificationEvent {
  return {
    kind: 'maturity-cleared',
    pendingSince: getNonEmptyString(notificationEvent, 'pendingSince'),
    minAgeDays: getFiniteNumber(notificationEvent, 'minAgeDays'),
    clockSource: getNonEmptyString(notificationEvent, 'clockSource'),
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

  if (kind === 'container-unhealthy') {
    return getContainerUnhealthyNotificationEvent(notificationEvent);
  }

  if (kind === 'maturity-cleared') {
    return getMaturityGateClearedNotificationEvent(notificationEvent);
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

/**
 * Entry stored in the security digest buffer while waiting for cycle-complete.
 */
interface SecurityDigestEntry {
  containerName: string;
  summary: SecurityAlertSummary;
  status?: string;
  bufferedAt: string;
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
  private unregisterDigestContainerReport?: () => void;
  private unregisterContainerReports?: () => void;
  private unregisterContainerUpdateAppliedForAutoDispatch?: () => void;
  private unregisterContainerUpdateFailed?: () => void;
  private unregisterSecurityAlert?: () => void;
  private unregisterAgentConnected?: () => void;
  private unregisterAgentDisconnected?: () => void;
  private unregisterContainerHealthTransition?: () => void;
  private unregisterMaturityGateCleared?: () => void;
  private unregisterContainerUpdateAppliedForResolution?: () => void;
  private readonly notificationResults: Map<string, unknown> = new Map();
  /**
   * Keys of containers whose update was just applied but whose watcher report
   * hasn't yet confirmed `updateAvailable=false`. This guards against the race
   * where `handleContainerUpdateAppliedEvent` clears notification history (so
   * the `once` gate re-opens) while the container still reports
   * `updateAvailable=true` in the next scan — which would fire a spurious
   * "update available" notification (#408).
   *
   * Key derivation matches the rest of the class: `getContainerNotificationKey`
   * (container.id when present, else `watcher.name` fullName).
   *
   * Cleared per-key when a container report arrives with `updateAvailable=false`
   * (confirmed post-update state), so future real updates still notify.
   *
   * Stored as `Map<string, number>` (key → addedAt epoch ms) rather than a plain
   * Set so entries can be given a TTL. Entries older than
   * `RECENT_APPLICATION_SEED_WINDOW_MS` (60 min) are treated as absent and
   * pruned lazily on each add or lookup. This prevents containers that are
   * permanently deleted or whose agents disconnect from leaking entries forever.
   * Pruning is lazy (no timer) because the map is small in practice.
   * The map is also cleared on `deregisterComponent` to release memory promptly
   * when the trigger is torn down.
   */
  private readonly recentlyAppliedContainerKeys: Map<string, number> = new Map();
  private readonly autoTriggerErrorSeenAt: Map<string, number> = new Map();
  private readonly notificationRuleWarningsSeen: Set<string> = new Set();
  /**
   * Reservations for a `once=true` history key currently being evaluated for
   * send, keyed by triggerId::containerId::eventKind::resultHash. See
   * `reserveOnceNotificationSlot` / `releaseOnceNotificationSlot` (#972).
   */
  private readonly inFlightOnceNotificationKeys: Set<string> = new Set();
  private readonly autoUpdateBlockedSeen: Set<string> = new Set();
  private readonly autoTriggerErrorSuppressor = new RecentSignatureSuppressor({
    seenAt: this.autoTriggerErrorSeenAt,
    suppressionWindowMs: AUTO_TRIGGER_ERROR_SUPPRESSION_WINDOW_MS,
    retentionMs: AUTO_TRIGGER_ERROR_SUPPRESSION_RETENTION_MS,
  });
  private readonly autoUpdateBlockedTracker = new OneShotKeyTracker({
    seenKeys: this.autoUpdateBlockedSeen,
  });
  private readonly digestBuffer: Map<string, Container> = new Map();
  private readonly batchRetryBuffer: Map<string, Container> = new Map();
  /**
   * Security digest buffer. Keyed by cycleId → (containerKey → SecurityDigestEntry).
   * Separate from the update digestBuffer so the two paths never share state.
   */
  private readonly securityDigestBuffer: Map<string, Map<string, SecurityDigestEntry>> = new Map();
  private digestBufferUpdatedAt: Map<string, number> = new Map();
  private batchRetryBufferUpdatedAt: Map<string, number> = new Map();
  private securityDigestBufferUpdatedAt: Map<string, number> = new Map();
  private bufferEntryRetentionMs = BUFFER_ENTRY_RETENTION_MS;
  private digestBufferMaxEntries = 5_000;
  private batchRetryBufferMaxEntries = 5_000;
  private securityDigestBufferMaxCycles = 100;
  private securityDigestCycleMaxEntries = 5_000;
  private readonly digestBufferStore = new DigestBuffer<Container>({
    name: 'digest buffer',
    entries: this.digestBuffer,
    timestamps: this.digestBufferUpdatedAt,
    retentionMs: () => this.bufferEntryRetentionMs,
    maxEntries: () => this.digestBufferMaxEntries,
    log: {
      debug: (message) => this.log.debug(message),
      warn: (message) => this.log.warn(message),
    },
  });
  private readonly batchRetryBufferStore = new DigestBuffer<Container>({
    name: 'batch retry buffer',
    entries: this.batchRetryBuffer,
    timestamps: this.batchRetryBufferUpdatedAt,
    retentionMs: () => this.bufferEntryRetentionMs,
    maxEntries: () => this.batchRetryBufferMaxEntries,
    log: {
      debug: (message) => this.log.debug(message),
      warn: (message) => this.log.warn(message),
    },
  });
  private readonly securityDigestBufferStore = new DigestBuffer<Map<string, SecurityDigestEntry>>({
    name: 'security digest cycle buffer',
    entries: this.securityDigestBuffer,
    timestamps: this.securityDigestBufferUpdatedAt,
    retentionMs: () => this.bufferEntryRetentionMs,
    maxEntries: () => this.securityDigestBufferMaxCycles,
    log: {
      debug: (message) => this.log.debug(message),
      warn: (message) => this.log.warn(message),
    },
  });
  private readonly eventBatchDispatcher = new BatchDispatcher<NotificationRuleId, Container>({
    flushDelayMs: AUTO_EVENT_BATCH_FLUSH_DELAY_MS,
    getKey: (container) => this.buildEventBatchDispatchKey(container),
    flush: (ruleId, containers) => this.flushEventBatchDispatch(ruleId, containers),
    onUnexpectedError: (ruleId, e) => {
      this.log.warn(
        `Unexpected error flushing ${ruleId} event batch (${Trigger.getErrorMessage(e)})`,
      );
      this.log.debug(e);
    },
  });
  private digestCronTask?: ScheduledTask;
  private isDigestFlushInProgress = false;
  private unregisterSecurityScanCycleComplete?: () => void;

  static getSupportedThresholds() {
    return [...SUPPORTED_THRESHOLDS];
  }

  protected override maskRegistrationLogConfiguration(configuration: unknown): unknown {
    return redactTriggerConfigurationInfrastructureDetails(configuration);
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
    return getTriggerCategoryForType(this.type);
  }

  private isAutomaticActionDispatchBlocked() {
    return this.getCategory() === 'action' && getUpdateMode() !== 'auto';
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
    return parseIncludeOrIncludeTriggerStringHelper(includeOrExcludeTriggerString);
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
    return doesReferenceMatchIdHelper(triggerReference, triggerId);
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
    if (
      !dispatchDecision.enabled &&
      dispatchDecision.reason === 'excluded-from-allow-list' &&
      getTriggerCategoryForType(this.type) === 'action'
    ) {
      // #623: the update-available rule's trigger allow-list can only ever contain
      // notification triggers (the API validator and the UI picker both bar action
      // types), so membership can never be granted to an action trigger. Treat
      // non-membership as exempt; rule.enabled stays authoritative as the kill switch.
      return {
        enabled: true,
        reason: 'action-trigger-exempt-from-allow-list',
      };
    }
    this.warnIfDigestRoutingIsSuppressed(dispatchDecision);
    return dispatchDecision;
  }

  private findContainerByBusinessId(containerName: string): Container | undefined {
    const container = storeContainer.getContainersRaw().find((container) => {
      const notificationKey = getContainerNotificationKey(container);
      return notificationKey === containerName || fullName(container) === containerName;
    });
    return container ? storeContainer.cloneContainer(container) : undefined;
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

  private shouldSuppressAutoTriggerError(
    ruleId: NotificationRuleId,
    container: Container | undefined,
    errorMessage: string,
  ) {
    const now = Date.now();
    const signature = this.buildAutoTriggerErrorSignature(ruleId, container, errorMessage);
    return this.autoTriggerErrorSuppressor.shouldSuppress(signature, now);
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
      for (const container of containers) {
        this.recordEventDeliverySuccess(ruleId, container);
      }
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
    this.eventBatchDispatcher.queue(ruleId, container);
  }

  private clearEventBatchDispatches() {
    this.eventBatchDispatcher.clear();
  }

  private pruneDigestBuffer(now = Date.now()) {
    this.digestBufferStore.prune(now);
  }

  private pruneBatchRetryBuffer(now = Date.now()) {
    this.batchRetryBufferStore.prune(now);
  }

  private pruneSecurityDigestBuffer(now = Date.now()) {
    this.securityDigestBufferStore.prune(now);
  }

  private bufferSecurityDigestEntry(
    cycleId: string,
    containerKey: string,
    entry: Omit<SecurityDigestEntry, 'bufferedAt'>,
  ): number {
    const now = Date.now();
    const cycleEntries = this.securityDigestBuffer.get(cycleId) ?? new Map();
    cycleEntries.delete(containerKey);
    cycleEntries.set(containerKey, {
      ...entry,
      bufferedAt: new Date(now).toISOString(),
    });
    this.securityDigestBufferStore.set(cycleId, cycleEntries, now);

    while (cycleEntries.size > this.securityDigestCycleMaxEntries) {
      const oldestContainerKey = cycleEntries.keys().next().value as string;
      cycleEntries.delete(oldestContainerKey);
      this.log.warn(
        `Evicted oldest security digest entry ${cycleId}/${oldestContainerKey} after reaching the ${this.securityDigestCycleMaxEntries}-entry cycle limit`,
      );
    }
    if (cycleEntries.size === 0) {
      this.securityDigestBufferStore.delete(cycleId);
    }
    return cycleEntries.size;
  }

  private shouldDispatchNotificationEventInBatch(
    notificationEvent: TriggerNotificationEvent | undefined,
  ) {
    return (
      notificationEvent?.kind !== 'agent-disconnect' &&
      notificationEvent?.kind !== 'agent-reconnect'
    );
  }

  /**
   * Called once a dispatch has actually been delivered (optimistic
   * dispatch's `this.trigger()` resolved, or a batch flush's
   * `this.triggerBatch()` resolved) — never on a merely-accepted/queued
   * dispatch. `maturity-cleared`'s symmetric dedup recording must wait for
   * this signal so a failed delivery does not suppress the generic
   * `update-available` retry on the next scan.
   */
  private recordEventDeliverySuccess(ruleId: NotificationRuleId, container: Container) {
    if (ruleId !== 'maturity-cleared') {
      return;
    }
    this.recordNotifiedForResult(container, 'maturity-cleared');
    this.recordNotifiedForResult(container, 'update-available');
  }

  private async dispatchContainerForEvent(
    ruleId: NotificationRuleId,
    container: TriggerContainer | undefined,
    options: EventDispatchOptions = {},
  ): Promise<boolean> {
    // Update-action triggers (docker, dockercompose, portainer) implement `trigger()` as
    // the full pull-scan-recreate update lifecycle. Lifecycle handlers route
    // here for notification dispatch; calling `trigger()` from this path
    // re-executes the update lifecycle in response to security-alert /
    // update-applied / update-failed / agent-* events — the root cause of
    // "Scan now caused my container to be recreated" (post-#357 fallout).
    // The legitimate auto-update path (`runUpdateAvailableSimpleTrigger` /
    // `runAcceptedUpdateBatch`) routes update-action triggers through the
    // admission queue and never enters `dispatchContainerForEvent` for
    // `update-available`. The `ruleId !== 'update-available'` clause
    // remains as forward-compatible defense against future regressions.
    if (this.isUpdateActionTrigger() && ruleId !== 'update-available') {
      this.log.debug(
        `Skipping ${ruleId} dispatch for update-action trigger (lifecycle events do not invoke update lifecycle)`,
      );
      return false;
    }

    if (!this.isTriggerEnabledForRule(ruleId, options)) {
      return false;
    }

    if (!container) {
      this.log.debug(`No container found for ${ruleId} event => ignore`);
      return false;
    }

    const threshold = (this.configuration.threshold ?? 'all').toLowerCase();
    if (!options.skipThreshold && !Trigger.isThresholdReached(container, threshold)) {
      this.log.debug(`Threshold not reached for ${ruleId} event => ignore`);
      return false;
    }

    const mustTriggerDecision = this.getMustTriggerDecision(container);
    if (!mustTriggerDecision.allowed) {
      this.log.debug(
        `Trigger conditions not met for ${ruleId} event => ignore (${mustTriggerDecision.reason})`,
      );
      return false;
    }

    const notificationEvent = getNotificationEvent(container);
    // Agent connectivity notifications synthesize one-off container payloads and should always
    // dispatch immediately, even when the trigger itself is configured for batch updates.
    const shouldUseBatchMode =
      Trigger.isBatchCapableMode(this.configuration.mode) &&
      this.shouldDispatchNotificationEventInBatch(notificationEvent);
    if (shouldUseBatchMode) {
      this.queueEventBatchDispatch(ruleId, container);
      return true;
    }
    this.dispatchToTriggerOptimistically(ruleId, container);
    return true;
  }

  /**
   * Optimistic dispatch with durable fallback. Calls this.trigger(container)
   * fire-and-forget. On failure, persists a delivery intent to the
   * notification outbox so the outbox worker can retry with backoff and
   * eventually move the entry to dead-letter on persistent failure.
   *
   * The lifecycle (and watcher cron) is never blocked on the provider call.
   */
  private dispatchToTriggerOptimistically(ruleId: NotificationRuleId, container: Container): void {
    const triggerId = this.getId();
    void Promise.resolve()
      .then(() => this.trigger(container))
      .then(
        () => {
          this.recordEventDeliverySuccess(ruleId, container);
        },
        (err: unknown) => {
          const errorMessage = Trigger.getErrorMessage(err);
          if (this.shouldSuppressAutoTriggerError(ruleId, container, errorMessage)) {
            this.log.debug(`Suppressed repeated error handling ${ruleId} event (${errorMessage})`);
          } else {
            this.log.warn(`Error handling ${ruleId} event (${errorMessage})`);
          }
          this.log.debug(err);
          enqueueOutboxEntry({
            eventName: ruleId,
            payload: { container },
            triggerId,
            containerId: container.id,
          });
        },
      );
  }

  /**
   * Default outbox delivery hook. The outbox worker calls this to retry a
   * persisted notification intent. Subclasses may override to handle custom
   * payload shapes or batched events.
   */
  async dispatchOutboxEntry(entry: NotificationOutboxEntry): Promise<void> {
    const payload = entry.payload as { container?: Container };
    const container = payload?.container;
    if (!container) {
      throw new Error(`Outbox entry ${entry.id} missing container payload`);
    }
    await this.trigger(container);
  }

  async handleContainerUpdateAppliedEvent(payload: ContainerUpdateAppliedEventPayload) {
    const containerName = getContainerUpdateAppliedEventContainerName(payload);
    if (!containerName) {
      this.log.debug('Skipping update-applied event because container name is missing');
      return;
    }

    const payloadContainer =
      typeof payload === 'object' && payload !== null
        ? (payload as event.ContainerUpdateAppliedEventPayload).container
        : undefined;
    const container = payloadContainer || this.findContainerByBusinessId(containerName);
    const notificationKey = getContainerNotificationKey(container) || containerName;

    // Evict from digest buffer — container is already updated, no need to notify.
    let evictedBufferedUpdate = this.digestBufferStore.delete(notificationKey);
    if (!evictedBufferedUpdate && containerName !== notificationKey) {
      evictedBufferedUpdate = this.digestBufferStore.delete(containerName);
    }
    if (!evictedBufferedUpdate) {
      for (const [bufferKey, bufferedContainer] of this.digestBuffer.entries()) {
        if (fullName(bufferedContainer) === containerName) {
          this.digestBufferStore.delete(bufferKey);
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

    // Guard against the spurious-notification race (#408): clearing history
    // re-opens the `once` gate, but the watcher's next scan may still report
    // `updateAvailable=true` for the already-updated container before the
    // watcher sets it to false. Track this key so
    // `shouldHandleSimpleContainerReport` suppresses the spurious notification
    // until the watcher confirms `updateAvailable=false`.
    this.pruneExpiredRecentApplicationKeys();
    this.recentlyAppliedContainerKeys.set(notificationKey, Date.now());
    this.log.debug(`Added ${notificationKey} to recently-applied suppression set`);

    // Also register a name-based key so post-recreate reports match (#408 variant):
    // a docker/dockercompose action recreates the container with a NEW Docker ID,
    // so the watcher's next report carries a different ID. The lookup in
    // isSuppressedByRecentApplication falls back to fullName only when the
    // container has NO id — which is not the case for fresh containers — so the
    // ID-keyed entry above would miss. Adding the name key (watcher_name) makes
    // the add and lookup symmetric across the recreate boundary.
    const nameKey =
      container && typeof container.watcher === 'string' && container.watcher !== ''
        ? fullName(container)
        : undefined;
    if (nameKey && nameKey !== notificationKey) {
      this.recentlyAppliedContainerKeys.set(nameKey, Date.now());
      this.log.debug(`Added name-key ${nameKey} to recently-applied suppression set`);
    }

    const notificationContainer = container
      ? withNotificationEvent(container, { kind: 'update-applied' })
      : undefined;

    // Lifecycle dispatch defaults to permissive (allowAllWhenNoTriggers / defaultWhenRuleMissing
    // = true) to match update-available. A user with the trigger configured at all should
    // receive lifecycle notifications unless they explicitly opted out via the rule's
    // allow-list. Issue #317 — strict defaults silently dropped Pushover update-applied toasts
    // for any user who hadn't yet built an allow-list.
    // skipThreshold: true — the threshold is meaningful only for "update available" decisions
    // (should we notify about this pending update?). update-applied reports what already happened,
    // so gating it on semver threshold would silently drop lifecycle notifications for containers
    // whose updateKind.kind is 'unknown' (e.g. digest-only updates) when threshold='major'.
    await this.dispatchContainerForEvent('update-applied', notificationContainer, {
      allowAllWhenNoTriggers: true,
      defaultWhenRuleMissing: true,
      skipThreshold: true,
    });
  }

  async handleContainerUpdateFailedEvent(payload: ContainerUpdateFailedPayload) {
    // Mirror handleContainerUpdateAppliedEvent: prefer the container carried
    // on the payload (set by UpdateLifecycleExecutor), fall back to the store
    // lookup. Without the payload fallback, a post-failure prune / agent-push
    // race can leave the controller's raw store without the container at the
    // exact moment update-failed arrives, dropping the notification silently
    // — see issue #355.
    const container = payload.container || this.findContainerByBusinessId(payload.containerName);
    const notificationContainer = container
      ? withNotificationEvent(container, {
          kind: 'update-failed',
          error: payload.error,
        })
      : undefined;

    // skipThreshold: true — same rationale as update-applied; the failure already happened,
    // so suppressing the notification based on semver threshold is not meaningful.
    await this.dispatchContainerForEvent('update-failed', notificationContainer, {
      allowAllWhenNoTriggers: true,
      defaultWhenRuleMissing: true,
      skipThreshold: true,
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

      // Last-write-wins within same cycle.
      const cycleBufferSize = this.bufferSecurityDigestEntry(cycleId, containerKey, {
        containerName,
        summary: payload.summary ?? { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
        status: payload.status,
      });
      this.log.debug(
        `Buffered security alert for ${containerName} in cycle ${cycleId} (cycle buffer size: ${cycleBufferSize})`,
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
        allowAllWhenNoTriggers: true,
        defaultWhenRuleMissing: true,
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
        allowAllWhenNoTriggers: true,
        defaultWhenRuleMissing: true,
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
        allowAllWhenNoTriggers: true,
        defaultWhenRuleMissing: true,
        skipThreshold: true,
      },
    );
  }

  async handleContainerHealthTransitionEvent(payload: event.ContainerHealthTransitionEventPayload) {
    const container = payload.container || this.findContainerByBusinessId(payload.containerName);
    const notificationContainer = container
      ? withNotificationEvent(container, {
          kind: 'container-unhealthy',
          previousHealth: payload.previousHealth,
        })
      : undefined;

    await this.dispatchContainerForEvent('container-unhealthy', notificationContainer, {
      allowAllWhenNoTriggers: true,
      defaultWhenRuleMissing: true,
      skipThreshold: true,
    });
  }

  /**
   * Handle the maturity-cleared event: a previously maturity-suppressed
   * update has become applicable. Gating mirrors `update-available` (auto
   * mode via the registration gate, threshold, include/exclude + agent
   * filters, rollback exclusion, `once`) rather than the lifecycle-style
   * skipThreshold pattern — this notification is a specialization of "update
   * available", so a trigger that would never have announced this update
   * must not announce its maturity either.
   *
   * Symmetric dedup: records notification-history hashes for BOTH
   * `maturity-cleared` and `update-available` once delivery is actually
   * confirmed (`recordEventDeliverySuccess`, invoked from the optimistic
   * dispatch/batch-flush completion paths — never optimistically on mere
   * dispatch acceptance), so the generic update-available dispatch on the
   * next scan does not double-notify a successfully-delivered update, but a
   * failed delivery still gets a natural retry. Before firing, skips if
   * either kind was already recorded for the same result hash — covers the
   * race where the generic notification beat us (e.g. an agent-container
   * scan landing before the sweep).
   */
  async handleMaturityGateClearedEvent(payload: event.MaturityGateClearedEventPayload) {
    const { container } = payload;

    if (
      container &&
      this.configuration.once &&
      (this.hasAlreadyNotifiedForResult(container, 'maturity-cleared') ||
        this.hasAlreadyNotifiedForResult(container, 'update-available'))
    ) {
      this.log.debug(
        `Skipping maturity-cleared notification for ${fullName(container)} (already notified)`,
      );
      return;
    }

    const notificationContainer = container
      ? withNotificationEvent(container, {
          kind: 'maturity-cleared',
          pendingSince: payload.pendingSince,
          minAgeDays: payload.minAgeDays,
          clockSource: payload.clockSource,
        })
      : undefined;

    await this.dispatchContainerForEvent('maturity-cleared', notificationContainer, {
      allowAllWhenNoTriggers: true,
      defaultWhenRuleMissing: true,
    });
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
   * Atomic check-and-reserve for the `once=true` history gate, used by the
   * simple, batch and digest update-available paths.
   * `hasAlreadyNotifiedForResult` is a pure read, and
   * the write (`recordNotifiedForResult`) only lands after the trigger's send
   * resolves, an `await` away. Two overlapping cron scans (#972) can both
   * evaluate the same first-seen candidate for the same trigger in that
   * window: both read "not notified yet" and both send, one every few hours
   * whenever a transient digest 429 happened to straddle the scans.
   *
   * This closes the window by adding the reservation key synchronously, in
   * the same call that does the "already notified" read, nothing can run
   * between those two statements in JS, so a second concurrent evaluation of
   * the exact same (trigger, container, event, result) sees the key already
   * held and is turned away here rather than racing the send. The caller
   * MUST release the reservation via `releaseOnceNotificationSlot` once this
   * evaluation is done, whether or not it actually sent, so a later
   * genuinely-new result (different resultHash) is never blocked by it.
   * @returns {boolean} true if this evaluation may proceed to send.
   */
  private reserveOnceNotificationSlot(
    container: Container,
    eventKind: notificationHistoryStore.NotificationEventKind,
  ): boolean {
    if (this.hasAlreadyNotifiedForResult(container, eventKind)) {
      return false;
    }
    const containerId =
      typeof container?.id === 'string' && container.id !== '' ? container.id : undefined;
    if (!containerId) {
      // No stable id to key a reservation on, same permissive fallback as
      // hasAlreadyNotifiedForResult; nothing to dedup against.
      return true;
    }
    const key = `${this.getId()}::${containerId}::${eventKind}::${notificationHistoryStore.computeResultHash(container)}`;
    if (this.inFlightOnceNotificationKeys.has(key)) {
      return false;
    }
    this.inFlightOnceNotificationKeys.add(key);
    return true;
  }

  /**
   * Release a reservation taken by `reserveOnceNotificationSlot`. Safe to
   * call even when no reservation was taken (e.g. `once=false`, or no stable
   * container id), deleting an absent key is a no-op.
   */
  private releaseOnceNotificationSlot(
    container: Container,
    eventKind: notificationHistoryStore.NotificationEventKind,
  ): void {
    const containerId =
      typeof container?.id === 'string' && container.id !== '' ? container.id : undefined;
    if (!containerId) {
      return;
    }
    const key = `${this.getId()}::${containerId}::${eventKind}::${notificationHistoryStore.computeResultHash(container)}`;
    this.inFlightOnceNotificationKeys.delete(key);
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

  /**
   * Re-populate `recentlyAppliedContainerKeys` from persisted store state after
   * a controller restart (restart-amnesia guard, #408).
   *
   * A successful update writes a `succeeded` operation row to the store. If the
   * controller restarts before the watcher's next scan sets `updateAvailable=false`,
   * the in-memory suppression set is empty and the first scan fires a spurious
   * "update available" notification for the already-updated container. Seeding
   * the set from recent succeeded operations closes the amnesia window.
   *
   * Key derivation mirrors `handleContainerUpdateAppliedEvent` exactly:
   *   - ID key: `getContainerNotificationKey(container) ?? containerName`
   *   - Name key: `fullName(container)` when the container snapshot has a
   *     non-empty `watcher` string (and differs from the ID key).
   *
   * Both keys are required so post-recreate containers (which arrive with a NEW
   * Docker ID) match the name-keyed entry when the ID-keyed one misses.
   *
   * The `liftSuppressionIfConfirmed` path clears these seeded keys exactly as it
   * would clear in-process entries — no special handling needed.
   *
   * Operations with no usable container identity (no container snapshot and no
   * non-empty containerName) are skipped.
   */
  private seedRecentApplicationSuppressionFromStore(): void {
    const ops = listRecentSucceededOperations(RECENT_APPLICATION_SEED_WINDOW_MS);
    let seeded = 0;
    for (const op of ops) {
      const { container, containerName } = op;
      const idKey = this.resolveRecentApplicationKey(container, containerName);
      if (!idKey) {
        continue;
      }
      this.recentlyAppliedContainerKeys.set(idKey, Date.now());
      // Also add the name key — matches handleContainerUpdateAppliedEvent exactly.
      const nameKey =
        container && typeof container.watcher === 'string' && container.watcher !== ''
          ? fullName(container)
          : undefined;
      if (nameKey && nameKey !== idKey) {
        this.recentlyAppliedContainerKeys.set(nameKey, Date.now());
      }
      seeded += 1;
    }
    if (seeded > 0) {
      this.log.debug(
        `Seeded recently-applied suppression set with ${seeded} persisted succeeded operation${seeded === 1 ? '' : 's'} (restart-amnesia guard #408)`,
      );
    }
  }

  /**
   * Derive the primary notification key for a recently-applied store operation.
   *
   * Extracted as a private helper so `seedRecentApplicationSuppressionFromStore`
   * and any future callers use an identical derivation path, preventing the two
   * from silently diverging.
   *
   * Mirrors `handleContainerUpdateAppliedEvent`:
   *   - prefer `getContainerNotificationKey(container)` (container.id when set,
   *     else `watcher_name` fullName when watcher+name are present)
   *   - fall back to the raw `containerName` string on the operation row
   *   - return `undefined` when neither yields a non-empty value
   */
  private resolveRecentApplicationKey(
    container: Container | undefined,
    containerName: string,
  ): string | undefined {
    const keyFromContainer = getContainerNotificationKey(container);
    const key = keyFromContainer ?? (containerName !== '' ? containerName : undefined);
    return key;
  }

  /**
   * Sweep `recentlyAppliedContainerKeys` and delete any entries that were added
   * more than `RECENT_APPLICATION_SEED_WINDOW_MS` ago. Called lazily on every
   * add and every lookup so no background timer is required.
   */
  private pruneExpiredRecentApplicationKeys(): void {
    const now = Date.now();
    for (const [k, addedAt] of this.recentlyAppliedContainerKeys) {
      if (now - addedAt > RECENT_APPLICATION_SEED_WINDOW_MS) {
        this.recentlyAppliedContainerKeys.delete(k);
      }
    }
  }

  /**
   * Check whether a container is suppressed by the recently-applied guard (#408).
   *
   * Called by all three `shouldHandle*ContainerReport` methods. Returns `true`
   * when the container's notification key is in `recentlyAppliedContainerKeys`,
   * meaning an update was just applied and the watcher has not yet confirmed the
   * post-update state (`updateAvailable=false`). The `suppressLogContext` string
   * is embedded in the debug log so each call site retains its distinct message.
   *
   * **Does NOT lift the suppression key** — that is the responsibility of the
   * callers that observe `updateAvailable=false` reports:
   *   - `shouldHandleSimpleContainerReport` (via `liftSuppressionIfConfirmed`)
   *   - `handleContainerReportDigest` (direct, before delegating here)
   *   - `handleContainerReports` (direct loop, batch path)
   */
  private isSuppressedByRecentApplication(
    container: Container,
    suppressLogContext: string,
  ): boolean {
    // Prune stale entries lazily before every lookup.
    this.pruneExpiredRecentApplicationKeys();

    const primaryKey = getContainerNotificationKey(container) || fullName(container);
    // After a docker/dockercompose recreate the watcher reports the container
    // with a NEW Docker ID. The primary key resolves to that new ID, which was
    // never added to the suppression map — only the OLD ID and the name-key were.
    // So we must also probe the name-based key when the primary probe misses.
    const nameKey =
      typeof container.watcher === 'string' && container.watcher !== ''
        ? fullName(container)
        : undefined;

    const matchedKey = this.recentlyAppliedContainerKeys.has(primaryKey)
      ? primaryKey
      : nameKey && this.recentlyAppliedContainerKeys.has(nameKey)
        ? nameKey
        : undefined;

    if (!matchedKey) {
      return false;
    }
    this.log.debug(
      `${suppressLogContext} ${matchedKey}: update just applied, waiting for watcher confirmation`,
    );
    return true;
  }

  /**
   * Lift the recently-applied suppression key for a container when the watcher
   * has confirmed the post-update state (`updateAvailable=false`).
   *
   * Called by paths that observe `updateAvailable=false` reports — currently:
   *   - `shouldHandleSimpleContainerReport` (simple mode)
   *   - `handleContainerReportDigest` (digest mode, before calling
   *     `shouldHandleDigestContainerReport`)
   *   - `handleContainerReports` (batch mode loop)
   *
   * The `liftLogContext` string is embedded in the debug log so each call site
   * retains its distinct message.
   */
  private liftSuppressionIfConfirmed(container: Container, liftLogContext: string): void {
    const key = getContainerNotificationKey(container) || fullName(container);
    // Also derive the name-based key so post-recreate containers (which arrive
    // with a NEW Docker ID that was never added to the set) still clear the
    // name-keyed suppression entry that was paired with the old ID on insert.
    const nameKey =
      typeof container.watcher === 'string' && container.watcher !== ''
        ? fullName(container)
        : undefined;

    const hasIdKey = this.recentlyAppliedContainerKeys.has(key);
    const hasNameKey = nameKey !== undefined && this.recentlyAppliedContainerKeys.has(nameKey);

    if (!hasIdKey && !hasNameKey) {
      return;
    }
    if (hasIdKey) {
      this.recentlyAppliedContainerKeys.delete(key);
      this.log.debug(`Cleared ${key} from recently-applied suppression set (${liftLogContext})`);
    }
    if (hasNameKey && nameKey !== key) {
      this.recentlyAppliedContainerKeys.delete(nameKey!);
      this.log.debug(
        `Cleared name-key ${nameKey} from recently-applied suppression set (${liftLogContext})`,
      );
    }
  }

  private shouldHandleSimpleContainerReport(containerReport: ContainerReport) {
    const { container } = containerReport;

    if (!container.updateAvailable) {
      // Watcher confirmed post-update state: lift the recently-applied
      // suppression so future real updates can notify again.
      this.liftSuppressionIfConfirmed(container, 'update confirmed');
      return false;
    }

    // Suppress the spurious "update available" that fires between
    // handleContainerUpdateAppliedEvent (which clears history and re-opens the
    // `once` gate) and the watcher's next scan that sets updateAvailable=false.
    // Without this guard, a concurrent report still carrying updateAvailable=true
    // passes the `once` check and fires a duplicate notification (#408).
    if (this.isSuppressedByRecentApplication(container, 'Suppressing update-available for')) {
      return false;
    }

    if (!this.configuration.once) {
      return true;
    }
    // Reserve, not just check: closes the race documented on
    // reserveOnceNotificationSlot() where two overlapping scans both read
    // "not notified yet" for the same candidate (#972). The caller
    // (handleContainerReport) releases this in a finally once the
    // evaluation is done.
    return this.reserveOnceNotificationSlot(container, 'update-available');
  }

  private shouldHandleDigestContainerReport(
    containerReport: ContainerReport,
    eventKind: DigestEventKind = 'update-available-digest',
  ) {
    if (!containerReport.container.updateAvailable) {
      // The caller (handleContainerReportDigest) handles the lift before
      // invoking this method — no lift here so the concerns stay separated.
      return false;
    }

    // Mirror the simple-path guard (#408): suppress the spurious
    // "update available" that arrives between
    // handleContainerUpdateAppliedEvent (which clears history and re-opens the
    // `once` gate) and the watcher's next scan that sets updateAvailable=false.
    // Without this guard a concurrent digest report still carrying
    // updateAvailable=true passes the `once` check and re-buffers the container
    // for a spurious digest notification.
    if (
      this.isSuppressedByRecentApplication(
        containerReport.container,
        'Suppressing digest buffer for',
      )
    ) {
      return false;
    }

    if (!this.configuration.once) {
      return true;
    }
    // Reserve, not just check (#972): the digest send records history only
    // after `flushUpdateDigestBuffer` awaits `triggerBatch()`, so a report
    // arriving mid-flush used to read "not digested yet", replace the buffer
    // entry behind the send, and get the same result sent again on the next
    // flush. `handleContainerReportDigest` releases the reservation it took,
    // in its finally; the flush holds its own across the send.
    return this.reserveOnceNotificationSlot(containerReport.container, eventKind);
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

    const category = this.getCategory();

    // Update-action triggers (docker/dockercompose/portainer) route auto-dispatch
    // eligibility entirely through the action-policy resolver's hybrid
    // specificity walk (spec-6.0.1-action-policy.md) instead of the plain
    // include/exclude check below. This is a deliberate REPLACEMENT, not an
    // addition, for two reasons:
    //   1. `onauto` access can be granted by a `dd.action.auto` label alone
    //      (no `dd.action.include` needed) — the plain include/exclude check
    //      below has no concept of the auto-label list, so a container
    //      relying on auto-only access would be rejected here before ever
    //      reaching the resolver.
    //   2. The resolver distinguishes 'manual' from 'auto' state (`onauto`
    //      access via include-only, with no matching auto label, resolves to
    //      'manual' — eligible for admission but not for unattended
    //      dispatch). The plain include/exclude check only has a binary
    //      included/excluded concept and cannot express that distinction, so
    //      routing through it would let an include-only `onauto` container
    //      auto-fire, which is exactly the bug this slice closes.
    // Command triggers are `category === 'action'` but NOT update-action
    // triggers (`isUpdateActionTrigger()` is false for them — see
    // `UPDATE_ACTION_TRIGGER_TYPES`), so they fall through to the unchanged
    // plain include/exclude path below, preserving today's behavior exactly.
    if (category === 'action' && this.isUpdateActionTrigger()) {
      if (!this.isActionPolicyDispatchWinner(containerResult)) {
        return {
          allowed: false,
          reason: 'action policy resolver did not select this trigger for automatic dispatch',
        };
      }
      return {
        allowed: true,
      };
    }

    const { include: triggerInclude, exclude: triggerExclude } =
      getContainerTriggerFiltersForCategory(containerResult, category);
    const included = this.isTriggerIncluded(containerResult, triggerInclude);
    const excluded = this.isTriggerExcluded(containerResult, triggerExclude);

    if (!included || excluded) {
      return {
        allowed: false,
        reason: `category=${category}, triggerInclude=${triggerInclude ?? '<none>'}, triggerExclude=${triggerExclude ?? '<none>'}, included=${included}, excluded=${excluded}`,
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
    // Mirror the simple/digest guard (#408): suppress the spurious
    // "update available" that fires between handleContainerUpdateAppliedEvent
    // (which clears history and re-opens the `once` gate) and the watcher's next
    // scan that sets updateAvailable=false. Without this guard a concurrent batch
    // report still carrying updateAvailable=true re-notifies right after a
    // successful update.
    // Note: `!updateAvailable` is pre-filtered by shouldDispatchUpdateAvailableContainer,
    // so this method never sees it; the lift for batch confirmations lives in the
    // handleContainerReports loop that iterates all reports (including !updateAvailable ones).
    if (
      this.isSuppressedByRecentApplication(
        containerReport.container,
        'Suppressing batch update-available for',
      )
    ) {
      return false;
    }
    if (!this.configuration.once) {
      return true;
    }
    // Reserve, not just check (#972): the batch send records history only
    // after `triggerBatch()` resolves, so a manual scan overlapping a cron
    // scan used to read "not notified yet" for the same candidate in both
    // and send it twice. `handleContainerReports` releases every reservation
    // it took, in its finally.
    return this.reserveOnceNotificationSlot(containerReport.container, 'update-available');
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
              storeContainer.cloneContainer(container as Container),
            ] as const,
        ),
    );

    for (const [containerName, bufferedContainer] of this.batchRetryBuffer.entries()) {
      const currentContainer =
        currentReportsByBusinessId.get(containerName)?.container ??
        currentContainersByBusinessId.get(containerName);

      if (!currentContainer || !this.shouldDispatchUpdateAvailableContainer(currentContainer)) {
        if (this.batchRetryBuffer.get(containerName) === bufferedContainer) {
          this.batchRetryBufferStore.delete(containerName);
        }
        continue;
      }

      // Skip containers that are suppressed by the recently-applied guard (#408):
      // a batch retry must not bypass the same suppression that shouldHandleBatchContainerReport
      // enforces for newly-arriving reports. Without this check, a container whose update
      // was just applied can slip through via the retry buffer before the watcher confirms
      // updateAvailable=false. Evict from the retry buffer as well — a notification for an
      // update that was just applied does not need to be retried.
      if (this.isSuppressedByRecentApplication(currentContainer, 'Suppressing batch retry for')) {
        // c8 ignore next: defensive guard mirrors the identical check in the eligibility branch above
        /* c8 ignore next */
        if (this.batchRetryBuffer.get(containerName) === bufferedContainer) {
          this.batchRetryBufferStore.delete(containerName);
        }
        continue;
      }

      this.batchRetryBufferStore.set(containerName, currentContainer, now);
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

  private emitAutoUpdateBlockedAuditOnTransition(
    container: Container,
    reason: string,
    message: string,
  ) {
    const containerKey = getContainerNotificationKey(container) || fullName(container);
    const seenKey = `${containerKey}|${reason}`;

    if (!this.autoUpdateBlockedTracker.markOnce(seenKey)) {
      return;
    }

    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'auto-update-blocked',
      containerName: fullName(container),
      containerImage: container.image?.name,
      triggerName: this.getId(),
      status: 'info',
      details: `${reason}: ${message}`,
    });
  }

  private clearAutoUpdateBlockedForContainerKey(containerKey: string) {
    this.autoUpdateBlockedTracker.clearByPrefix(`${containerKey}|`);
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
    if (this.isAutomaticActionDispatchBlocked()) {
      logContainer.debug('Global update mode does not allow automatic actions => ignore');
      return;
    }
    if (this.isUpdateActionTrigger()) {
      if (this.isAutoUpdateDeferredByMaintenanceWindow(container)) {
        logContainer.debug(
          'Outside maintenance window, deferring auto update until the window opens',
        );
        return;
      }
      const accepted = await enqueueContainerUpdate(container, {
        trigger: this as unknown as {
          type: string;
          trigger: (container: Container, runtimeContext?: unknown) => Promise<unknown>;
        },
        source: 'automatic',
      });
      dispatchAccepted([accepted]);
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
      this.emitAutoUpdateBlockedAuditOnTransition(container, 'admission-blocked', error.message);
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

    // Confirmation cleanup must run regardless of the current global mode or
    // notification-rule routing. Otherwise an auto -> manual/notify -> auto
    // cycle can retain the recently-applied key forever and suppress the next
    // genuine update. shouldHandleSimpleContainerReport repeats this cleanup
    // on the normal auto-enabled path; liftSuppressionIfConfirmed is idempotent.
    if (!containerReport.container.updateAvailable) {
      this.liftSuppressionIfConfirmed(containerReport.container, 'update confirmed');
    }

    if (this.isAutomaticActionDispatchBlocked()) {
      this.log.debug('Global update mode does not allow automatic actions => ignore');
      return;
    }

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
      // Release the reservation taken by shouldHandleSimpleContainerReport()
      // regardless of how this evaluation ended (sent, threshold/gate
      // declined without sending, or errored) so a later genuinely-new
      // result for this container is never blocked by it.
      this.releaseOnceNotificationSlot(container, 'update-available');
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

    // Mirror the simple/digest suppression-lift (#408): a watcher report
    // confirming updateAvailable=false means the post-update state has landed,
    // so lift the recently-applied guard. Pure batch mode registers no simple or
    // digest handler, so without this the suppression key would never clear and
    // the container's update-available notifications would be muted permanently.
    for (const report of containerReports) {
      if (!report.container.updateAvailable) {
        this.liftSuppressionIfConfirmed(report.container, 'batch update confirmed');
      }
    }

    if (this.isAutomaticActionDispatchBlocked()) {
      this.log.debug('Global update mode does not allow automatic batch actions => ignore');
      return;
    }

    // Filter on containers with update available and passing trigger threshold
    const containersToSendByBusinessId = new Map<string, Container>();
    // Tracked apart from containersToSendByBusinessId: that map is keyed by
    // business id, so two entries resolving to the same key leave only the
    // last one in the map even though both took a reservation, and releasing
    // from the map would strand the one it replaced.
    const reservedContainers: Container[] = [];
    for (const container of this.getBatchRetryContainers(containerReports)) {
      const businessId = getContainerNotificationKey(container) || fullName(container);
      // Retry entries skip the eligibility check - they already passed it when
      // they were first batched - but they take the same reservation, or two
      // overlapping batches both pull the same entry out of the retry buffer
      // and send it twice, which the reservation on the report path alone does
      // not stop. A retry entry only exists because a send failed, so nothing
      // recorded history for it: a reservation that fails means this exact
      // result is already sent or already in flight elsewhere, and the retry is
      // spent. Drop it from this send and clear it; a send that fails again
      // re-buffers it from the catch below.
      if (!this.reserveOnceNotificationSlot(container, 'update-available')) {
        this.batchRetryBufferStore.delete(businessId);
        continue;
      }
      reservedContainers.push(container);
      containersToSendByBusinessId.set(businessId, container);
    }
    for (const containerReport of containerReports) {
      if (this.shouldHandleBatchContainerReport(containerReport)) {
        reservedContainers.push(containerReport.container);
        containersToSendByBusinessId.set(
          getContainerNotificationKey(containerReport.container) ||
            fullName(containerReport.container),
          containerReport.container,
        );
      }
    }
    const containersToSend = Array.from(containersToSendByBusinessId.values());
    // Nothing to release here: every reserved container was also set into the
    // map above, so an empty send list means no reservation was taken.
    if (containersToSend.length === 0) {
      return;
    }

    let status: 'success' | 'error' = 'error';
    try {
      this.log.debug('Run batch');
      if (this.isUpdateActionTrigger()) {
        const dispatched = await this.runAcceptedUpdateBatch(containersToSend);
        if (!dispatched) {
          return;
        }
      } else {
        await this.triggerBatch(containersToSend);
      }
      status = 'success';
      for (const container of containersToSend) {
        this.recordNotifiedForResult(container, 'update-available');
      }
      if (this.batchRetryBuffer.size > 0) {
        for (const container of containersToSend) {
          this.batchRetryBufferStore.delete(
            getContainerNotificationKey(container) || fullName(container),
          );
        }
      }
    } catch (e: unknown) {
      const errorMessage = Trigger.getErrorMessage(e);
      if (this.isPureBatchMode()) {
        for (const container of containersToSend) {
          this.batchRetryBufferStore.set(
            getContainerNotificationKey(container) || fullName(container),
            container,
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
      // Release every reservation shouldHandleBatchContainerReport() took for
      // this batch, however it ended, so a later genuinely-new result for any
      // of these containers is never blocked by it.
      for (const container of reservedContainers) {
        this.releaseOnceNotificationSlot(container, 'update-available');
      }
    }
  }

  /**
   * Buffer a container for digest mode. Keyed by stable container identity
   * so same-name siblings do not overwrite each other before the digest cron
   * flushes.
   */
  private bufferContainerForDigest(container: Container) {
    const containerKey = getContainerNotificationKey(container) || fullName(container);
    this.digestBufferStore.set(containerKey, container);
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
      if (this.digestBufferStore.delete(containerName)) {
        this.log.debug(`Evicted ${containerName} from digest buffer (update no longer available)`);
      }
      // Mirror the simple-path suppression-lift (#408): watcher confirmed the
      // post-update state, so lift the recently-applied guard so future real
      // updates can notify again via the digest path.
      this.liftSuppressionIfConfirmed(container, 'digest update confirmed');
      return;
    }

    if (!this.isUpdateAvailableAutoTriggerEnabled()) {
      return;
    }
    if (this.isAutomaticActionDispatchBlocked()) {
      this.log.debug('Global update mode does not allow automatic digest actions => ignore');
      return;
    }
    // One binding for the kind this method reserves, logs and releases on, so
    // the reserve inside shouldHandleDigestContainerReport() and the release
    // below cannot drift apart: passing a different kind to the eligibility
    // check would otherwise leak the reservation it took.
    const digestEventKind = 'update-available-digest';
    if (!this.shouldHandleDigestContainerReport(containerReport, digestEventKind)) {
      const alreadyBuffered = this.hasAlreadyNotifiedForResult(container, digestEventKind);
      this.log.debug(
        `Skipping update-available digest buffer for ${containerName} (once=${this.configuration.once === true}, updateAvailable=${container.updateAvailable}, alreadyBuffered=${alreadyBuffered})`,
      );
      return;
    }
    try {
      if (!Trigger.isThresholdReached(container, this.getSimpleModeThreshold())) {
        return;
      }
      if (!this.mustTrigger(container)) {
        return;
      }
      this.bufferContainerForDigest(container);
    } finally {
      // Release the reservation taken by shouldHandleDigestContainerReport()
      // above, whether or not this report was buffered, so the next flush can
      // take its own. A report turned away by that check returns before this
      // block and never touches the reservation the flush is holding.
      this.releaseOnceNotificationSlot(container, digestEventKind);
    }
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
      containerNoun: ctx.alertCount === 1 ? 'container' : 'containers',
      criticalList: ctx.containers
        .filter((c) => c.critical > 0)
        .map((c) => `- ${c.name}: critical=${c.critical}, high=${c.high}`)
        .join('\n'),
      highList: ctx.containers
        .filter((c) => c.critical === 0 && c.high > 0)
        .map((c) => `- ${c.name}: high=${c.high}, medium=${c.medium}`)
        .join('\n'),
    };
    return renderTemplate(template, { scan });
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
    if (this.isAutomaticActionDispatchBlocked()) {
      this.log.debug(
        'Global update mode does not allow automatic digest action flushes => preserve buffer',
      );
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
              storeContainer.cloneContainer(container as Container),
            ] as const,
        ),
    );
    const dispatchEntries = bufferedEntries.flatMap(([containerName, bufferedContainer]) => {
      const currentContainer = currentContainersByBusinessId.get(containerName);
      const stillHasUpdate = !currentContainer || currentContainer.updateAvailable;

      if (stillHasUpdate) {
        const evaluatedContainer = currentContainer ?? bufferedContainer;

        // Re-check the action-policy dispatch winner at flush time, not just
        // at buffer time (handleContainerReportDigest / shouldHandleDigest-
        // ContainerReport). A container can sit in the digest buffer across
        // multiple cron ticks; by flush time another registered action
        // trigger may now be the resolver's ranked winner for it (e.g. a
        // more specific trigger registered since buffering, or a config
        // change). Mirrors the isAutomaticActionDispatchBlocked() re-check
        // above the same way: buffering does not freeze the world, so
        // dispatch authorization is re-evaluated at the moment of actual
        // dispatch. A no-op for notification and command triggers — see
        // `isActionPolicyDispatchWinner`.
        if (this.isActionPolicyDispatchWinner(evaluatedContainer)) {
          return [
            {
              containerName,
              bufferedContainer,
              currentContainer: evaluatedContainer,
            },
          ];
        }

        this.log.debug(
          `Evicting ${containerName} from digest buffer at flush (no longer the action-policy dispatch winner)`,
        );
      }

      if (this.digestBuffer.get(containerName) === bufferedContainer) {
        this.digestBufferStore.delete(containerName);
      }
      return [];
    });

    if (dispatchEntries.length === 0) {
      this.log.debug('Digest cron fired — no buffered updates remain after revalidation');
      return;
    }

    // One binding for the kind this flush reserves and releases on, so the two
    // cannot drift apart.
    const digestEventKind = 'update-available-digest';
    // Hold the once-gate reservation for exactly the results being sent, for
    // the whole span between deciding to send and recording the send, so a
    // report that lands mid-flush cannot re-buffer the same result behind it.
    // The answer has to be honoured, not just taken: this flush substitutes the
    // CURRENT store container for the buffered one, and that substitute can be
    // a result already digested on an earlier flush. Sending it anyway repeats
    // that digest, and the post-send delete below then evicts the newer
    // candidate the buffer was actually holding, so the real update is lost.
    // Evict such an entry the same way a revalidation miss does: it describes a
    // candidate the store no longer shows, and a genuinely pending update
    // re-enters the buffer on the next scan's report.
    const reservedEntries = dispatchEntries.filter((entry) => {
      if (this.reserveOnceNotificationSlot(entry.currentContainer, digestEventKind)) {
        return true;
      }
      this.log.debug(
        `Evicting ${entry.containerName} from digest buffer at flush (its current state was already digested)`,
      );
      if (this.digestBuffer.get(entry.containerName) === entry.bufferedContainer) {
        this.digestBufferStore.delete(entry.containerName);
      }
      return false;
    });

    // Every reservation failed, so none is held and there is nothing to release.
    if (reservedEntries.length === 0) {
      this.log.debug('Digest cron fired — every buffered update was already digested');
      return;
    }

    const containers = reservedEntries.map(({ currentContainer }) => currentContainer);
    this.log.info(`Digest flush: sending ${containers.length} update(s)`);
    let status: 'success' | 'error' = 'error';
    this.isDigestFlushInProgress = true;
    try {
      if (this.isUpdateActionTrigger()) {
        const dispatched = await this.runAcceptedUpdateBatch(containers);
        if (!dispatched) {
          return;
        }
      } else {
        await this.triggerBatch(containers);
      }
      status = 'success';
      for (const container of containers) {
        this.recordNotifiedForResult(container, 'update-available-digest');
      }
      for (const { containerName, bufferedContainer } of reservedEntries) {
        if (this.digestBuffer.get(containerName) === bufferedContainer) {
          this.digestBufferStore.delete(containerName);
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
      for (const container of containers) {
        this.releaseOnceNotificationSlot(container, digestEventKind);
      }
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
    this.pruneSecurityDigestBuffer();
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
    rows.sort((a, b) => {
      const byCritical = b.critical - a.critical;
      const byHigh = b.high - a.high;
      const byMedium = b.medium - a.medium;
      const byLow = b.low - a.low;
      const byUnknown = b.unknown - a.unknown;
      const byTopSeverity = byCritical || byHigh || byMedium;
      return byTopSeverity || byLow || byUnknown;
    });

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
    const unknownCount = rows.reduce((s, r) => {
      const noCritical = r.critical === 0;
      const noHigh = r.high === 0;
      const noMedium = r.medium === 0;
      const noLow = r.low === 0;
      const hasUnknown = r.unknown > 0;
      const noHigherSeverity = noCritical && noHigh && noMedium && noLow;
      return s + (noHigherSeverity && hasUnknown ? 1 : 0);
    }, 0);

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
      this.securityDigestBufferStore.delete(cycleId);
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
    return matchesTriggerReferenceList(this.getId(), trigger, containerResult);
  }

  isTriggerIncluded(containerResult: Container, triggerInclude: string | undefined) {
    if (!triggerInclude) {
      // 'onauto' behaves exactly like 'oninclude' here in this slice (closed
      // by default absent an explicit include label) — its real semantics
      // (auto-label-only grants access too) land with the resolver in
      // app/model/action-policy.ts in a later slice.
      const autoMode = this.getAutoMode();
      return autoMode !== 'oninclude' && autoMode !== 'onauto';
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
   * spec-6.0.1-action-policy.md decision 1 migration-checklist startup WARN.
   * Called from `init()` for any action-category trigger configured with the
   * legacy `AUTO=oninclude` value. There is no persisted record of a
   * trigger's *previous* `auto` value, so this can't detect an actual
   * before/after switch — instead it proactively lists, against whatever the
   * store currently knows about (a first-ever boot with an empty store won't
   * surface any names until a later restart), every container this trigger
   * matches on `dd.action.include` but has no matching `dd.action.auto`
   * label for: exactly the containers that would silently lose automatic
   * execution if this trigger's `AUTO` value were switched to `onauto`
   * without also adding an auto label first.
   */
  private warnOnincludeMigrationGap(): void {
    const containers = storeContainer.getContainersRaw() as Container[];
    const gaps = findOnincludeAutoMigrationGaps(this as unknown as ActionPolicyTrigger, containers);
    if (gaps.length === 0) {
      return;
    }
    const names = gaps.map((container) => fullName(container)).join(', ');
    this.log.warn(
      'AUTO=oninclude grants both manual and automatic execution via dd.action.include. ' +
        'The following containers match dd.action.include for this trigger but have no ' +
        `matching dd.action.auto label: ${names}. Switching this trigger to AUTO=onauto ` +
        'without first adding a dd.action.auto label to each would silently drop their ' +
        'automatic execution to manual-only. See the trigger AUTO migration checklist in ' +
        'the drydock triggers configuration docs before switching.',
    );
  }

  /**
   * spec-6.0.1-action-policy.md decision 1 inert-label startup WARN. Called
   * from `init()` for any action-category trigger configured with
   * `AUTO=none`. Lists, against whatever the store currently knows about,
   * every container that carries a `dd.action.auto` label matching this
   * trigger — under `AUTO=none` that label can never grant automatic
   * execution (access is capped at manual, fail closed), so the label is
   * inert for this trigger and almost certainly a misconfiguration.
   */
  private warnInertAutoLabel(): void {
    const containers = storeContainer.getContainersRaw() as Container[];
    const withAutoLabel = findInertAutoLabelContainers(
      this as unknown as ActionPolicyTrigger,
      containers,
    );
    if (withAutoLabel.length === 0) {
      return;
    }
    const names = withAutoLabel.map((container) => fullName(container)).join(', ');
    this.log.warn(
      'AUTO=none never registers automatic execution. The dd.action.auto label on the ' +
        `following containers is inert for this trigger and access stays capped at manual: ${names}.`,
    );
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
        autoMode === 'oninclude' || autoMode === 'onauto'
          ? 'Registering for auto execution (only containers with explicit include labels)'
          : 'Registering for auto execution (all watched containers)',
      );
      if (this.getCategory() === 'action' && autoMode === 'oninclude') {
        this.warnOnincludeMigrationGap();
      }
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
        this.unregisterDigestContainerReport = event.registerContainerReport(
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

      this.unregisterMaturityGateCleared = event.registerMaturityGateCleared(
        async (payload) => this.handleMaturityGateClearedEvent(payload),
        {
          id: this.getId(),
          order: this.configuration.order,
        },
      );

      this.seedNotificationHistoryFromStore();
      this.seedRecentApplicationSuppressionFromStore();
    } else {
      this.log.info('Registering for manual execution (lifecycle notifications still active)');
      if (this.getCategory() === 'action') {
        this.warnInertAutoLabel();
      }
    }

    // Lifecycle event handlers register regardless of `auto` mode. `auto`
    // controls whether the trigger fires on update-available *detection*; it
    // must not silence completion/failure/security/agent notifications, which
    // a manually-triggered or external update still produces. Issue #317.
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
    this.unregisterContainerHealthTransition = event.registerContainerHealthTransition(
      async (payload) => this.handleContainerHealthTransitionEvent(payload),
      {
        id: this.getId(),
        order: this.configuration.order,
      },
    );

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

    this.unregisterDigestContainerReport?.();
    this.unregisterDigestContainerReport = undefined;

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

    this.unregisterContainerHealthTransition?.();
    this.unregisterContainerHealthTransition = undefined;

    this.unregisterMaturityGateCleared?.();
    this.unregisterMaturityGateCleared = undefined;

    this.unregisterContainerUpdateAppliedForResolution?.();
    this.unregisterContainerUpdateAppliedForResolution = undefined;

    this.digestCronTask?.stop();
    this.digestCronTask = undefined;
    this.isDigestFlushInProgress = false;
    this.digestBuffer.clear();
    this.digestBufferUpdatedAt.clear();
    this.securityDigestBuffer.clear();
    this.securityDigestBufferUpdatedAt.clear();
    this.batchRetryBuffer.clear();
    this.batchRetryBufferUpdatedAt.clear();
    this.clearEventBatchDispatches();

    this.autoTriggerErrorSuppressor.clear();
    this.autoUpdateBlockedTracker.clear();
    this.notificationRuleWarningsSeen.clear();
    this.recentlyAppliedContainerKeys.clear();
    this.inFlightOnceNotificationKeys.clear();
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
        .try(
          this.joi.bool(),
          this.joi.string().insensitive().valid('all', 'oninclude', 'onauto', 'none'),
        )
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
   * Trigger method. MUST be overridden in every trigger provider subclass.
   *
   * The base implementation throws unconditionally so that a provider that
   * forgets to override fails loudly at runtime rather than silently doing
   * nothing. In production every concrete provider overrides this method;
   * direct instantiation of the bare `Trigger` class is only valid in tests
   * that mock or spy on this method before invoking it.
   */
  async trigger(_containerWithResult: Container): Promise<unknown> {
    throw new Error(`trigger() not implemented by ${this.type}`);
  }

  /**
   * Trigger batch method. MUST be overridden in every trigger provider subclass.
   *
   * The base implementation throws unconditionally so that a provider that
   * forgets to override fails loudly at runtime rather than silently doing
   * nothing. In production every concrete provider overrides this method;
   * direct instantiation of the bare `Trigger` class is only valid in tests
   * that mock or spy on this method before invoking it.
   *
   * @param containersWithResult
   * @param _runtimeContext optional pre-rendered title/body for digest paths (#328)
   */
  async triggerBatch(
    _containersWithResult: Container[],
    _runtimeContext?: BatchRuntimeContext | unknown,
  ): Promise<unknown> {
    throw new Error(`triggerBatch() not implemented by ${this.type}`);
  }

  private isUpdateActionTrigger(): boolean {
    return UPDATE_ACTION_TRIGGER_TYPES.has(this.type.toLowerCase());
  }

  /**
   * Build the candidate trigger map for the action-policy hybrid specificity
   * walk (`selectActionTrigger`, spec-6.0.1-action-policy.md). Sourced from
   * the live registry (`registry.getState().trigger`) so every other
   * registered docker/dockercompose/portainer trigger competes on equal footing, with
   * `this` unioned in explicitly (self wins any id collision) so the walk
   * always sees this instance as a candidate even if the registry snapshot
   * is momentarily stale (e.g. mid-registration) or, in unit tests, not
   * populated at all — a lone trigger instance must still be able to resolve
   * itself as the winner of a one-candidate walk.
   */
  private getActionPolicyCandidateTriggers(): Record<string, ActionPolicyTrigger> {
    const registered = registry.getState().trigger as unknown as
      | Record<string, ActionPolicyTrigger>
      | undefined;
    return {
      ...registered,
      [this.getId()]: this as unknown as ActionPolicyTrigger,
    };
  }

  /**
   * True when this trigger is the action-policy resolver's winning candidate
   * for `container`, i.e. `selectActionTrigger(..., {requireAuto: true})`
   * resolves to this trigger's id. Closes the pre-existing latent fan-out
   * double-dispatch (spec-6.0.1-action-policy.md): before this gate, every
   * registered action trigger decided independently whether to fire, so two
   * compatible triggers could both run the same update. After this gate,
   * only the resolver's ranked winner fires.
   *
   * A no-op (`true`) for triggers outside the update-action category/type
   * scope (notification triggers, and command triggers — see the call site
   * in `getMustTriggerDecision`), so callers can invoke this unconditionally
   * from shared code paths (e.g. the digest flush re-check below) without
   * re-deriving the category/type guard themselves.
   */
  private isActionPolicyDispatchWinner(container: Container): boolean {
    if (this.getCategory() !== 'action' || !this.isUpdateActionTrigger()) {
      return true;
    }
    const winner = selectActionTrigger(this.getActionPolicyCandidateTriggers(), container, {
      requireAuto: true,
    });
    // `selectActionTrigger`'s hard-stop exclude case returns a result whose
    // `triggerId` identifies the excluding candidate but whose `state` is
    // `'blocked'`, not `'auto'` — a triggerId match alone is not sufficient,
    // the resolved state must also be `'auto'` (requireAuto only skips a
    // `'manual'` verdict to try the next candidate; it does not turn an
    // exclude hard-stop into anything other than blocked).
    return winner?.triggerId === this.getId() && winner.state === 'auto';
  }

  /**
   * Returns true when the owning watcher's maintenance window is currently closed,
   * meaning the auto-apply should be deferred. Fail-open: when the watcher cannot
   * be resolved, or does not expose isMaintenanceWindowOpen, the update proceeds.
   * isMaintenanceWindowOpen() itself returns true when no window is configured,
   * so an unconfigured window also lets updates through.
   */
  private isAutoUpdateDeferredByMaintenanceWindow(container: Container): boolean {
    const watcherName = typeof container.watcher === 'string' ? container.watcher.trim() : '';
    if (watcherName === '') return false;
    const watcherId = container.agent
      ? `${container.agent}.docker.${watcherName}`
      : `docker.${watcherName}`;
    const watcher = registry.getState().watcher[watcherId] as unknown as
      | { isMaintenanceWindowOpen?: () => boolean }
      | undefined;
    if (!watcher || typeof watcher.isMaintenanceWindowOpen !== 'function') return false;
    return !watcher.isMaintenanceWindowOpen();
  }

  private async runAcceptedUpdateBatch(containers: Container[]): Promise<boolean> {
    if (getUpdateMode() !== 'auto') {
      this.log.debug('Global update mode does not allow automatic batch updates => ignore');
      return false;
    }

    const windowDeferred: Container[] = [];
    const deferredIds = new Set<string>();
    for (const container of containers) {
      if (this.isAutoUpdateDeferredByMaintenanceWindow(container)) {
        windowDeferred.push(container);
        deferredIds.add(container.id);
      }
    }

    // A dependent whose own upstream dependency is window-deferred this cycle
    // must not be force-updated out of order (v1.7 Phase 6.1, #219 — design
    // §3): defer it too. It re-enters together with its now-eligible
    // dependency on a later scan once the window opens.
    const dependencyDeferred: Container[] = [];
    if (windowDeferred.length > 0) {
      const { edges } = buildDependencyGraph(containers);
      const dependentsByDependency = buildDependentsByDependency(edges);
      const containerById = new Map(containers.map((container) => [container.id, container]));
      for (const blockedContainer of windowDeferred) {
        for (const dependentId of collectTransitiveDependents(
          blockedContainer.id,
          dependentsByDependency,
        )) {
          if (deferredIds.has(dependentId)) {
            continue;
          }
          const dependent = containerById.get(dependentId);
          /* v8 ignore next 3 -- defensive only: every dependent id originates from
             buildDependencyGraph(containers), so containerById (keyed the same way)
             always has a match. */
          if (!dependent) {
            continue;
          }
          deferredIds.add(dependentId);
          dependencyDeferred.push(dependent);
        }
      }
    }

    const ready = containers.filter((container) => !deferredIds.has(container.id));

    for (const container of windowDeferred) {
      this.log.debug(
        `Outside maintenance window, deferring auto update for ${getContainerNotificationKey(container) || fullName(container)} until the window opens`,
      );
    }
    for (const container of dependencyDeferred) {
      this.log.debug(
        `Deferring auto update for ${getContainerNotificationKey(container) || fullName(container)} because an upstream dependency is outside its maintenance window this cycle`,
      );
    }

    if (ready.length === 0) {
      return true;
    }

    const { accepted, rejected } = await enqueueContainerUpdates(ready, {
      trigger: this as unknown as {
        type: string;
        trigger: (container: Container, runtimeContext?: unknown) => Promise<unknown>;
      },
      source: 'automatic',
    });
    const modeChangedDuringAdmission = rejected.some(isUpdateModeAdmissionRejection);

    for (const entry of rejected) {
      this.log.debug(
        `Skipped batched auto update for ${getContainerNotificationKey(entry.container) || fullName(entry.container)} (${entry.message})`,
      );
      this.emitAutoUpdateBlockedAuditOnTransition(
        entry.container,
        'admission-blocked',
        entry.message,
      );
    }

    if (accepted.length === 0) {
      return !modeChangedDuringAdmission;
    }

    // A mode switch can happen midway through a multi-container admission
    // pass. Dispatch the prefix that was already accepted, but return false so
    // callers retain the complete batch/digest state and do not mark rejected
    // suffix entries as notified. Subsequent watcher state reconciles accepted
    // operations normally while preserving the unaccepted entries for later.
    dispatchAccepted(accepted);
    return !modeChangedDuringAdmission;
  }

  getMetadata(): Record<string, unknown> {
    return {
      category: this.getCategory(),
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
      typeof payload === 'object' && payload !== null
        ? (payload as event.ContainerUpdateAppliedEventPayload).container
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
      // Clear any blocked-audit dedup entries so the next block emits a fresh audit event.
      this.clearAutoUpdateBlockedForContainerKey(containerId);
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
   *
   * `runtimeContext` (when supplied by the caller — e.g. the security-digest
   * cycle flush) carries a prerendered title/body that MUST be used verbatim
   * instead of re-rendering against `containers`, since the rows passed in
   * that path are not real `Container` objects (#328).
   */
  protected composeBatchMessage(
    containers: Container[],
    runtimeContext?: BatchRuntimeContext | unknown,
  ): string {
    const body = this.renderBatchBody(containers, runtimeContext);
    if (this.configuration.disabletitle) {
      return body;
    }
    const title = this.renderBatchTitle(containers, runtimeContext);
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

  private getStoredNotificationTemplate(
    notificationEvent: TriggerNotificationEvent | undefined,
    field: notificationStore.NotificationTemplateField,
    fallback: string,
  ): string {
    const ruleId: NotificationRuleId = notificationEvent?.kind ?? 'update-available';
    return notificationStore.getNotificationTemplate(ruleId, this.getId(), field) ?? fallback;
  }

  private buildNotificationPreviewContainer(ruleId: NotificationRuleId): Container {
    const notificationEvent =
      ruleId === 'update-available'
        ? undefined
        : ruleId === 'update-failed'
          ? { kind: ruleId, error: 'Example update failure', rollbackAttempted: true }
          : ruleId === 'security-alert'
            ? {
                kind: ruleId,
                details: '1 critical vulnerability',
                summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 1 },
                blockingCount: 1,
              }
            : ruleId === 'agent-disconnect'
              ? { kind: ruleId, agentName: 'preview-agent', reason: 'Connection timed out' }
              : ruleId === 'agent-reconnect'
                ? { kind: ruleId, agentName: 'preview-agent' }
                : ruleId === 'container-unhealthy'
                  ? { kind: ruleId, health: 'unhealthy', previousHealth: 'healthy' }
                  : ruleId === 'maturity-cleared'
                    ? { kind: ruleId, pendingSince: '2026-01-01T00:00:00.000Z', minAgeDays: 7 }
                    : { kind: ruleId };

    return {
      id: 'drydock-preview',
      name: 'drydock-preview',
      displayName: 'Drydock Preview',
      displayIcon: '',
      watcher: 'local',
      status: 'running',
      image: {
        id: 'sha256:preview',
        registry: { name: 'ghcr', url: 'https://ghcr.io' },
        name: 'getwud/drydock',
        tag: { value: '1.0.0', semver: true },
        digest: { watch: true, value: 'sha256:current' },
        architecture: 'amd64',
        os: 'linux',
      },
      result: {
        tag: '1.1.0',
        digest: 'sha256:updated',
        link: 'https://github.com/getwud/drydock/releases/tag/v1.1.0',
        releaseNotes: {
          title: 'Drydock 1.1.0',
          body: 'Example release notes for the notification preview.',
          url: 'https://github.com/getwud/drydock/releases/tag/v1.1.0',
          publishedAt: '2026-01-01T00:00:00.000Z',
          provider: 'github',
        },
      },
      security: {
        updateScan: {
          scanner: 'trivy',
          image: 'ghcr.io/getwud/drydock:1.1.0',
          scannedAt: '2026-01-01T00:00:00.000Z',
          status: 'blocked',
          blockSeverities: ['CRITICAL'],
          blockingCount: 1,
          summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 1 },
          vulnerabilities: [
            {
              id: 'CVE-2026-0001',
              packageName: 'example-package',
              installedVersion: '1.0.0',
              fixedVersion: '1.0.1',
              severity: 'CRITICAL',
            },
          ],
        },
      },
      updateAvailable: true,
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '1.1.0',
        semverDiff: 'minor',
      },
      notificationEvent,
    } as Container;
  }

  previewNotificationTemplates(
    ruleId: string,
    templates: notificationStore.NotificationTemplateOverride = {},
  ): Required<notificationStore.NotificationTemplateOverride> {
    if (!NOTIFICATION_RULE_IDS.has(ruleId as NotificationRuleId)) {
      throw new Error(`Unsupported notification rule: ${ruleId}`);
    }
    const previewContainer = this.buildNotificationPreviewContainer(ruleId as NotificationRuleId);
    const previewContainers = [
      previewContainer,
      { ...previewContainer, id: 'drydock-preview-2', name: 'drydock-preview-2' },
    ];
    const notificationEvent = getNotificationEvent(previewContainer);
    const resolvePreviewTemplate = (
      field: notificationStore.NotificationTemplateField,
      defaults: Partial<Record<TriggerNotificationEvent['kind'], string>>,
      fallback: string,
    ) =>
      templates[field] ??
      this.getStoredNotificationTemplate(
        notificationEvent,
        field,
        resolveNotificationTemplate(notificationEvent, defaults, fallback),
      );

    return {
      simpleTitle: renderSimple(
        resolvePreviewTemplate(
          'simpleTitle',
          NOTIFICATION_SIMPLE_TITLE_TEMPLATES,
          this.configuration.simpletitle ?? '',
        ),
        this.getTemplateContainer(previewContainer),
      ),
      simpleBody: renderSimple(
        resolvePreviewTemplate(
          'simpleBody',
          NOTIFICATION_SIMPLE_BODY_TEMPLATES,
          this.configuration.simplebody ?? '',
        ),
        this.getTemplateContainer(previewContainer),
      ),
      batchTitle: renderBatch(
        resolvePreviewTemplate(
          'batchTitle',
          NOTIFICATION_BATCH_TITLE_TEMPLATES,
          this.configuration.batchtitle ?? '',
        ),
        previewContainers,
      ),
    };
  }

  /**
   * Render trigger title simple.
   * @param container
   * @returns {*}
   */
  renderSimpleTitle(container: Container) {
    const notificationEvent = getNotificationEvent(container);
    const defaultTemplate = resolveNotificationTemplate(
      notificationEvent,
      NOTIFICATION_SIMPLE_TITLE_TEMPLATES,
      this.configuration.simpletitle ?? '',
    );
    const template = this.getStoredNotificationTemplate(
      notificationEvent,
      'simpleTitle',
      defaultTemplate,
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
    const defaultTemplate = resolveNotificationTemplate(
      notificationEvent,
      NOTIFICATION_SIMPLE_BODY_TEMPLATES,
      this.configuration.simplebody ?? '',
    );
    const template = this.getStoredNotificationTemplate(
      notificationEvent,
      'simpleBody',
      defaultTemplate,
    );
    return renderSimple(template, this.getTemplateContainer(container));
  }

  /**
   * Render trigger title batch.
   *
   * When `runtimeContext.title` is set the caller has already rendered the
   * title (e.g. security-alert-digest) — return it verbatim. See #328.
   */
  renderBatchTitle(containers: Container[], runtimeContext?: BatchRuntimeContext | unknown) {
    const overrideTitle = getRuntimeContextString(runtimeContext, 'title');
    if (overrideTitle !== undefined) {
      return overrideTitle;
    }
    const notificationEvent =
      containers.length > 0 ? getNotificationEvent(containers[0]) : undefined;
    const defaultTemplate = resolveNotificationTemplate(
      notificationEvent,
      NOTIFICATION_BATCH_TITLE_TEMPLATES,
      this.configuration.batchtitle ?? '',
    );
    const template = this.getStoredNotificationTemplate(
      notificationEvent,
      'batchTitle',
      defaultTemplate,
    );
    return renderBatch(template, containers);
  }

  /**
   * Render trigger body batch.
   *
   * When `runtimeContext.body` is set the caller has already rendered the
   * body (e.g. security-alert-digest) — return it verbatim. See #328.
   */
  renderBatchBody(containers: Container[], runtimeContext?: BatchRuntimeContext | unknown) {
    const overrideBody = getRuntimeContextString(runtimeContext, 'body');
    if (overrideBody !== undefined) {
      return overrideBody;
    }
    return containers.map((container) => `- ${this.renderSimpleBody(container)}\n`).join('\n');
  }
}

export default Trigger;
