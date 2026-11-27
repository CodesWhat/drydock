import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import type { Container } from '../../../model/container.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface SignalConfiguration extends TriggerConfiguration {
  url: string;
  number: string;
  recipients: string;
  apikey?: string;
}

/**
 * Signal Trigger implementation (signal-cli-rest-api).
 */
class Signal extends Trigger<SignalConfiguration> {
  getConfigurationSchema() {
    return this.joi.object().keys({
      url: this.joi
        .string()
        .uri({ scheme: ['http', 'https'] })
        .replace(/\/$/, '')
        .required(),
      number: this.joi.string().required(),
      recipients: this.joi.string().required(),
      apikey: this.joi.string(),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  maskConfiguration() {
    return this.maskFields(['number', 'recipients', 'apikey']);
  }

  async trigger(container: Container) {
    return this.sendMessage(this.composeMessage(container));
  }

  async triggerBatch(containers: Container[], runtimeContext?: BatchRuntimeContext) {
    return this.sendMessage(this.composeBatchMessage(containers, runtimeContext));
  }

  /**
   * Send a message through the signal-cli-rest-api `/v2/send` endpoint.
   */
  async sendMessage(text: string) {
    const recipients = this.configuration.recipients
      .split(',')
      .map((recipient) => recipient.trim())
      .filter((recipient) => recipient.length > 0);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.configuration.apikey) {
      headers.Authorization = `Bearer ${this.configuration.apikey}`;
    }
    const response = await axios.post(
      `${this.configuration.url}/v2/send`,
      { message: text, number: this.configuration.number, recipients },
      { headers, timeout: getOutboundHttpTimeoutMs() },
    );
    return response.data;
  }
}

export default Signal;
