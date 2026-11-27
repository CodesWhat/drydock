import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import type { Container } from '../../../model/container.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

const OPSGENIE_ENDPOINTS = {
  us: 'https://api.opsgenie.com/v2/alerts',
  eu: 'https://api.eu.opsgenie.com/v2/alerts',
} as const;

interface OpsgenieConfiguration extends TriggerConfiguration {
  apikey: string;
  region: keyof typeof OPSGENIE_ENDPOINTS;
  priority: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  tags: string;
}

/**
 * Opsgenie Trigger implementation (Alerts API v2).
 */
class Opsgenie extends Trigger<OpsgenieConfiguration> {
  getConfigurationSchema() {
    return this.joi.object().keys({
      apikey: this.joi.string().trim().required(),
      region: this.joi.string().valid('us', 'eu').default('us'),
      priority: this.joi.string().valid('P1', 'P2', 'P3', 'P4', 'P5').default('P5'),
      tags: this.joi.string().default('drydock,docker'),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  maskConfiguration() {
    return this.maskFields(['apikey']);
  }

  async trigger(container: Container) {
    const message = this.configuration.disabletitle
      ? 'Container update'
      : this.renderSimpleTitle(container);
    return this.sendAlert(message, this.renderSimpleBody(container), container);
  }

  async triggerBatch(containers: Container[], runtimeContext?: BatchRuntimeContext) {
    const message = this.configuration.disabletitle
      ? 'Container updates available'
      : this.renderBatchTitle(containers, runtimeContext);
    return this.sendAlert(message, this.renderBatchBody(containers, runtimeContext));
  }

  /**
   * Create an alert through the Opsgenie Alerts API.
   */
  async sendAlert(message: string, description: string, container?: Container) {
    const tags = this.configuration.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    const payload: Record<string, unknown> = {
      message,
      description,
      priority: this.configuration.priority,
      source: 'drydock',
      tags,
    };
    if (container) {
      payload.details = {
        containerName: container.name,
        watcher: container.watcher,
        localTag: container.updateKind?.localValue ?? '',
        remoteTag: container.updateKind?.remoteValue ?? '',
      };
    }
    const response = await axios.post(OPSGENIE_ENDPOINTS[this.configuration.region], payload, {
      headers: {
        Authorization: `GenieKey ${this.configuration.apikey}`,
        'Content-Type': 'application/json',
      },
      timeout: getOutboundHttpTimeoutMs(),
    });
    return response.data;
  }
}

export default Opsgenie;
