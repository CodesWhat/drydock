import * as event from '../../event/index.js';
import { type Container, fullName } from '../../model/container.js';
import { getTriggerCounter } from '../../prometheus/trigger.js';
import Component, { type ComponentConfiguration } from '../../registry/Component.js';
import * as notificationStore from '../../store/notification.js';
import * as storeContainer from '../../store/container.js';
import { renderBatch, renderSimple } from './trigger-expression-parser.js';
import {
  isThresholdReached as isThresholdReachedHelper,
  parseThresholdWithDigestBehavior as parseThresholdWithDigestBehaviorHelper,
  SUPPORTED_THRESHOLDS,
} from './trigger-threshold.js';

type SupportedThreshold = (typeof SUPPORTED_THRESHOLDS)[number];
type NotificationRuleId =
  | 'update-available'
  | 'update-applied'
  | 'update-failed'
  | 'security-alert'
  | 'agent-disconnect';

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

interface EventDispatchOptions extends notificationStore.NotificationRuleDispatchOptions {
  skipThreshold?: boolean;
}

function buildAgentDisconnectedContainer(agentName: string, reason?: string): Container {
  return {
    id: `agent-${agentName}`,
    name: agentName,
    displayName: agentName,
    displayIcon: 'mdi:server-network-off',
    status: 'disconnected',
    watcher: 'agent',
    image: {
      id: `agent-image-${agentName}`,
      registry: {
        name: 'agent',
        url: 'agent://local',
      },
      name: agentName,
      tag: {
        value: 'disconnected',
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
      kind: 'tag',
      localValue: reason || 'disconnected',
      remoteValue: reason || 'disconnected',
      semverDiff: 'patch',
    },
    error: reason
      ? {
          message: reason,
        }
      : undefined,
  };
}

function isSupportedThreshold(value: string): value is SupportedThreshold {
  return SUPPORTED_THRESHOLDS.includes(value as SupportedThreshold);
}

export interface TriggerConfiguration extends ComponentConfiguration {
  auto?: boolean;
  order?: number;
  threshold?: string;
  mode?: string;
  once?: boolean;
  disabletitle?: boolean;
  simpletitle?: string;
  simplebody?: string;
  batchtitle?: string;
  resolvenotifications?: boolean;
}

export interface ContainerReport {
  container: Container;
  changed: boolean;
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
  private unregisterAgentDisconnected?: () => void;
  private unregisterContainerUpdateAppliedForResolution?: () => void;
  private readonly notificationResults: Map<string, any> = new Map();

  static getSupportedThresholds() {
    return [...SUPPORTED_THRESHOLDS];
  }

  static parseThresholdWithDigestBehavior(threshold: string | undefined) {
    return parseThresholdWithDigestBehaviorHelper(threshold);
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
      if (this.configuration.mode?.toLowerCase() === 'batch') {
        await this.triggerBatch([container]);
      } else {
        await this.trigger(container);
      }
    } catch (e: any) {
      this.log.warn(`Error handling ${ruleId} event (${e.message})`);
      this.log.debug(e);
    }
  }

  async handleContainerUpdateAppliedEvent(containerName: string) {
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

  /**
   * Handle container report (simple mode).
   * @param containerReport
   * @returns {Promise<void>}
   */
  async handleContainerReport(containerReport: ContainerReport) {
    // Keep backward compatibility: if update-available has no explicit trigger
    // allow-list yet, legacy auto trigger behavior remains enabled.
    if (
      !this.isTriggerEnabledForRule('update-available', {
        allowAllWhenNoTriggers: true,
        defaultWhenRuleMissing: true,
      })
    ) {
      return;
    }

    // Filter on changed containers with update available and passing trigger threshold
    if (
      (containerReport.changed || !this.configuration.once) &&
      containerReport.container.updateAvailable
    ) {
      const logContainer =
        this.log.child({
          container: fullName(containerReport.container),
        }) || this.log;
      let status = 'error';
      try {
        const thresholdReached = Trigger.isThresholdReached(
          containerReport.container,
          (this.configuration.threshold ?? 'all').toLowerCase(),
        );
        if (!thresholdReached) {
          logContainer.debug('Threshold not reached => ignore');
        } else if (!this.mustTrigger(containerReport.container)) {
          logContainer.debug('Trigger conditions not met => ignore');
        } else {
          logContainer.debug('Run');
          const result = await this.trigger(containerReport.container);
          if (this.configuration.resolvenotifications && result) {
            this.notificationResults.set(fullName(containerReport.container), result);
          }
        }
        status = 'success';
      } catch (e: any) {
        logContainer.warn(`Error (${e.message})`);
        logContainer.debug(e);
      } finally {
        getTriggerCounter()?.inc({
          type: this.type,
          name: this.name,
          status,
        });
      }
    }
  }

  /**
   * Handle container reports (batch mode).
   * @param containerReports
   * @returns {Promise<void>}
   */
  async handleContainerReports(containerReports: ContainerReport[]) {
    // Keep backward compatibility: if update-available has no explicit trigger
    // allow-list yet, legacy auto trigger behavior remains enabled.
    if (
      !this.isTriggerEnabledForRule('update-available', {
        allowAllWhenNoTriggers: true,
        defaultWhenRuleMissing: true,
      })
    ) {
      return;
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
    } catch (e: any) {
      this.log.warn(`Error (${e.message})`);
      this.log.debug(e);
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
      return true;
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
  mustTrigger(containerResult: Container) {
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
    if (this.configuration.auto) {
      this.log.info(`Registering for auto execution`);
      if (this.configuration.mode?.toLowerCase() === 'simple') {
        this.unregisterContainerReport = event.registerContainerReport(
          async (containerReport) => this.handleContainerReport(containerReport),
          {
            id: this.getId(),
            order: this.configuration.order,
          },
        );
      }
      if (this.configuration.mode?.toLowerCase() === 'batch') {
        this.unregisterContainerReports = event.registerContainerReports(
          async (containersReports) => this.handleContainerReports(containersReports),
          {
            id: this.getId(),
            order: this.configuration.order,
          },
        );
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

    this.unregisterAgentDisconnected?.();
    this.unregisterAgentDisconnected = undefined;

    this.unregisterContainerUpdateAppliedForResolution?.();
    this.unregisterContainerUpdateAppliedForResolution = undefined;
  }

  /**
   * Override method to merge with common Trigger options (threshold...).
   * @param configuration
   * @returns {*}
   */
  validateConfiguration(configuration: TriggerConfiguration): TriggerConfiguration {
    const schema = this.getConfigurationSchema();
    const schemaWithDefaultOptions = schema.append({
      auto: this.joi.bool().default(true),
      order: this.joi.number().default(100),
      threshold: this.joi
        .string()
        .insensitive()
        .valid(...Trigger.getSupportedThresholds())
        .default('all'),
      mode: this.joi.string().insensitive().valid('simple', 'batch').default('simple'),
      once: this.joi.boolean().default(true),
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
    return schemaValidated.value;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async preview(container: Container): Promise<Record<string, any>> {
    return {};
  }

  /**
   * Trigger method. Must be overridden in trigger implementation class.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async trigger(containerWithResult: Container) {
    // do nothing by default
    this.log.warn('Cannot trigger container result; this trigger does not implement "simple" mode');
    return containerWithResult;
  }

  /**
   * Trigger batch method. Must be overridden in trigger implementation class.
   * @param containersWithResult
   * @returns {*}
   */
  async triggerBatch(containersWithResult: Container[]) {
    // do nothing by default
    this.log.warn('Cannot trigger container results; this trigger does not implement "batch" mode');
    return containersWithResult;
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
    } catch (e: any) {
      this.log.warn(`Error dismissing notification for container ${containerId} (${e.message})`);
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async dismiss(containerId: string, triggerResult: any): Promise<void> {
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
  protected maskFields(fieldsToMask: string[]): Record<string, any> {
    const masked: Record<string, any> = { ...this.configuration };
    for (const field of fieldsToMask) {
      if (masked[field]) {
        masked[field] = (this.constructor as typeof Trigger).mask(masked[field]);
      }
    }
    return masked;
  }

  /**
   * Render trigger title simple.
   * @param container
   * @returns {*}
   */
  renderSimpleTitle(container: Container) {
    return renderSimple(this.configuration.simpletitle ?? '', container);
  }

  /**
   * Render trigger body simple.
   * @param container
   * @returns {*}
   */
  renderSimpleBody(container: Container) {
    return renderSimple(this.configuration.simplebody ?? '', container);
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
