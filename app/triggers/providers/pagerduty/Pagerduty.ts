import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import type { Container } from '../../../model/container.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

const PAGERDUTY_EVENTS_API = 'https://events.pagerduty.com/v2/enqueue';

interface PagerdutyConfiguration extends TriggerConfiguration {
  routingkey: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  source: string;
}

/**
 * PagerDuty Trigger implementation (Events API v2).
 */
class Pagerduty extends Trigger<PagerdutyConfiguration> {
  getConfigurationSchema() {
    return this.joi.object().keys({
      routingkey: this.joi.string().trim().required(),
      severity: this.joi.string().valid('info', 'warning', 'error', 'critical').default('info'),
      source: this.joi.string().default('drydock'),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  maskConfiguration() {
    return this.maskFields(['routingkey']);
  }

  async trigger(container: Container) {
    const summary = this.configuration.disabletitle
      ? `Update available for ${container.name}`
      : this.renderSimpleTitle(container);
    return this.sendEvent(summary, this.renderSimpleBody(container), container);
  }

  async triggerBatch(containers: Container[], runtimeContext?: BatchRuntimeContext) {
    const summary = this.configuration.disabletitle
      ? `${containers.length} container updates available`
      : this.renderBatchTitle(containers, runtimeContext);
    return this.sendEvent(summary, this.renderBatchBody(containers, runtimeContext));
  }

  /**
   * Send an event to the PagerDuty Events API v2.
   */
  async sendEvent(summary: string, details: string, container?: Container) {
    const customDetails: Record<string, unknown> = { message: details };
    if (container) {
      customDetails.containerName = container.name;
      customDetails.watcher = container.watcher;
      if (container.updateKind) {
        customDetails.local = container.updateKind.localValue;
        customDetails.remote = container.updateKind.remoteValue;
      }
      if (container.result?.link) {
        customDetails.link = container.result.link;
      }
    }
    const response = await axios.post(
      PAGERDUTY_EVENTS_API,
      {
        routing_key: this.configuration.routingkey,
        event_action: 'trigger',
        payload: {
          summary,
          source: this.configuration.source,
          severity: this.configuration.severity,
          custom_details: customDetails,
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: getOutboundHttpTimeoutMs(),
      },
    );
    return response.data;
  }
}

export default Pagerduty;
