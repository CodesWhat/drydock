import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import type { Container } from '../../../model/container.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface ZulipConfiguration extends TriggerConfiguration {
  url: string;
  botemail: string;
  apikey: string;
  type: 'stream' | 'direct';
  to: string;
  topic: string;
}

/**
 * Zulip Trigger implementation.
 */
class Zulip extends Trigger<ZulipConfiguration> {
  getConfigurationSchema() {
    return this.joi.object().keys({
      url: this.joi
        .string()
        .uri({ scheme: ['http', 'https'] })
        .replace(/\/$/, '')
        .required(),
      botemail: this.joi.string().required(),
      apikey: this.joi.string().trim().required(),
      type: this.joi.string().valid('stream', 'direct').default('stream'),
      to: this.joi.string().required(),
      topic: this.joi.string().default('Drydock Updates'),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  maskConfiguration() {
    return this.maskFields(['apikey']);
  }

  protected override formatTitleAndBody(title: string, body: string): string {
    return `**${title}**\n\n${body}`;
  }

  async trigger(container: Container) {
    return this.sendMessage(this.composeMessage(container));
  }

  async triggerBatch(containers: Container[], runtimeContext?: BatchRuntimeContext) {
    return this.sendMessage(this.composeBatchMessage(containers, runtimeContext));
  }

  /**
   * Post a message through the Zulip `/api/v1/messages` endpoint.
   */
  async sendMessage(text: string) {
    const params = new URLSearchParams();
    params.append('type', this.configuration.type);
    params.append('to', this.configuration.to);
    if (this.configuration.type === 'stream') {
      params.append('topic', this.configuration.topic);
    }
    params.append('content', text);
    const credentials = Buffer.from(
      `${this.configuration.botemail}:${this.configuration.apikey}`,
    ).toString('base64');
    const response = await axios.post(
      `${this.configuration.url}/api/v1/messages`,
      params.toString(),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: getOutboundHttpTimeoutMs(),
      },
    );
    return response.data;
  }
}

export default Zulip;
